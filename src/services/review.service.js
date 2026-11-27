import { db } from '../db/index.js';
import {
  eventReviews,
  reviewHelpfulness,
  organizerReviews,
  events,
  purchasedTickets,
  users,
  organizers,
  venues,
} from '../db/schema/index.js';
import { eq, and, desc, count, gte, lte, sql, isNull, inArray } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

/** Ended events stay in a ticket holder's pending-review list this long. */
const PROMPT_WINDOW_DAYS = 30;
/** users.preferences key holding the event ids whose review prompt was dismissed. */
const DISMISSED_KEY = 'dismissedReviewPromptEventIds';

async function dismissedEventIds(userId) {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  const ids = row?.preferences?.[DISMISSED_KEY];
  return new Set(Array.isArray(ids) ? ids : []);
}

export class ReviewService {
  /**
   * Events the user held an active ticket for that have ended (within the
   * last PROMPT_WINDOW_DAYS) and that they haven't reviewed or dismissed.
   * Prompts are computed live, so they only ever appear after the event ends.
   */
  static async getPendingPrompts(userId) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - PROMPT_WINDOW_DAYS * 86_400_000);

    const rows = await db
      .selectDistinctOn([events.id], {
        id: events.id,
        title: events.title,
        startDate: events.startDate,
        endDate: events.endDate,
        organizerBusinessName: organizers.businessName,
        venueName: venues.name,
      })
      .from(purchasedTickets)
      .innerJoin(events, eq(events.id, purchasedTickets.eventId))
      .leftJoin(organizers, eq(organizers.id, events.organizerId))
      .leftJoin(venues, eq(venues.id, events.venueId))
      .leftJoin(
        eventReviews,
        and(eq(eventReviews.eventId, events.id), eq(eventReviews.userId, userId))
      )
      .where(
        and(
          eq(purchasedTickets.userId, userId),
          eq(purchasedTickets.status, 'active'),
          isNull(events.deletedAt),
          lte(events.endDate, now),
          gte(events.endDate, windowStart),
          isNull(eventReviews.id)
        )
      )
      .orderBy(events.id);

    const dismissed = await dismissedEventIds(userId);

    return rows
      .filter(r => !dismissed.has(r.id))
      .sort((a, b) => new Date(b.endDate) - new Date(a.endDate))
      .map(r => ({
        id: r.id,
        eventId: r.id,
        userId,
        event: {
          id: r.id,
          title: r.title,
          startDate: r.startDate,
          endDate: r.endDate,
          organizer: { businessName: r.organizerBusinessName ?? '' },
          venue: r.venueName ? { name: r.venueName } : undefined,
        },
      }));
  }

  /** Hide an event's review prompt for this user. Idempotent. */
  static async dismissPrompt(userId, eventId) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true },
    });
    if (!event) throw new ApiError(404, 'Event not found');

    // Append atomically so concurrent dismissals don't overwrite each other
    await db
      .update(users)
      .set({
        preferences: sql`jsonb_set(
          coalesce(${users.preferences}, '{}'::jsonb),
          ${`{${DISMISSED_KEY}}`}::text[],
          coalesce(${users.preferences} -> ${DISMISSED_KEY}, '[]'::jsonb) || to_jsonb(${eventId}::text)
        )`,
      })
      .where(
        and(
          eq(users.id, userId),
          sql`not coalesce(${users.preferences} -> ${DISMISSED_KEY}, '[]'::jsonb) ? ${eventId}`
        )
      );

    return { eventId, dismissed: true };
  }

  /**
   * Prompts are derived from tickets + reviews at read time, so there is
   * nothing to insert. This reports how many attendees currently have a
   * pending prompt for the event (0 until the event has ended).
   */
  static async createReviewPrompts(eventId) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), isNull(events.deletedAt)),
      columns: { id: true, endDate: true },
    });
    if (!event) throw new ApiError(404, 'Event not found');

    if (new Date(event.endDate) > new Date()) {
      return { eventId, eventEnded: false, eligibleAttendees: 0 };
    }

    const holders = await db
      .selectDistinct({ userId: purchasedTickets.userId })
      .from(purchasedTickets)
      .where(and(eq(purchasedTickets.eventId, eventId), eq(purchasedTickets.status, 'active')));
    const holderIds = holders.map(h => h.userId);
    if (!holderIds.length) return { eventId, eventEnded: true, eligibleAttendees: 0 };

    const [reviewed, dismissedRows] = await Promise.all([
      db
        .select({ userId: eventReviews.userId })
        .from(eventReviews)
        .where(and(eq(eventReviews.eventId, eventId), inArray(eventReviews.userId, holderIds))),
      db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, holderIds),
            sql`coalesce(${users.preferences} -> ${DISMISSED_KEY}, '[]'::jsonb) ? ${eventId}`
          )
        ),
    ]);
    const excluded = new Set([...reviewed.map(r => r.userId), ...dismissedRows.map(r => r.id)]);

    return {
      eventId,
      eventEnded: true,
      eligibleAttendees: holderIds.filter(id => !excluded.has(id)).length,
    };
  }

  /**
   * Check if user should be prompted to review an event
   */
  static async shouldShowReviewPrompt(userId, eventId) {
    try {
      if (!userId || !eventId) {
        return false;
      }

      // Check if user has purchased tickets for this event
      const userTicket = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.userId, userId),
          eq(purchasedTickets.status, 'active')
        ),
      });

      if (!userTicket) {
        return false;
      }

      // Check if event has ended
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
      });

      if (!event) {
        return false;
      }

      const now = new Date();
      const eventEndDate = new Date(event.endDate);

      if (eventEndDate > now) {
        return false;
      }

      // Check if user has already reviewed this event
      const existingReview = await db.query.eventReviews.findFirst({
        where: and(eq(eventReviews.eventId, eventId), eq(eventReviews.userId, userId)),
      });
      if (existingReview) return false;

      // Dismissed via "Maybe later"
      return !(await dismissedEventIds(userId)).has(eventId);
    } catch (error) {
      console.error('Should show review prompt error:', error);
      return false;
    }
  }

  /**
   * Submit event review
   */
  static async submitEventReview(userId, reviewData) {
    try {
      const {
        eventId,
        overallRating,
        venueRating,
        organizationRating,
        valueRating,
        title,
        comment,
        isAnonymous = false,
        tags = [],
      } = reviewData;

      // Verify user attended the event
      const userTicket = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.userId, userId),
          eq(purchasedTickets.status, 'active')
        ),
      });

      if (!userTicket) {
        throw new ApiError(403, 'You must have attended this event to review it');
      }

      // Check if event has ended
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
      });

      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      const now = new Date();
      const eventEndDate = new Date(event.endDate);

      if (eventEndDate > now) {
        throw new ApiError(400, 'Cannot review event before it ends');
      }

      const reviewModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.REVIEW,
        entityCreatorId: userId,
        texts: [title, comment],
      });

      // Create review
      const [review] = await db
        .insert(eventReviews)
        .values({
          eventId,
          userId,
          ticketId: userTicket.id,
          overallRating,
          venueRating,
          organizationRating,
          valueRating,
          title,
          comment,
          isVerifiedAttendee: true,
          isAnonymous,
          tags: JSON.stringify(tags),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await TextModerationService.recordIfFlagged(reviewModeration, {
        entityType: TEXT_ENTITY.REVIEW,
        entityId: review.id,
        userId,
        fieldNames: ['title', 'comment'],
        texts: [title, comment],
      });

      return review;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Submit event review error:', error);
      throw new ApiError(500, 'Failed to submit review');
    }
  }

  /**
   * Get event reviews with pagination
   */
  static async getEventReviews(eventId, options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'helpful', // helpful, recent, rating
        minRating,
        verifiedOnly = false,
      } = options;

      const offset = (page - 1) * limit;
      let conditions = [eq(eventReviews.eventId, eventId)];

      if (minRating) {
        conditions.push(gte(eventReviews.overallRating, minRating));
      }

      if (verifiedOnly) {
        conditions.push(eq(eventReviews.isVerifiedAttendee, true));
      }

      let orderBy;
      switch (sortBy) {
        case 'helpful':
          orderBy = desc(eventReviews.helpfulCount);
          break;
        case 'recent':
          orderBy = desc(eventReviews.createdAt);
          break;
        case 'rating':
          orderBy = desc(eventReviews.overallRating);
          break;
        default:
          orderBy = desc(eventReviews.helpfulCount);
      }

      const [reviewsResult, totalCount] = await Promise.all([
        db.query.eventReviews.findMany({
          where: and(...conditions),
          with: {
            user: {
              columns: {
                id: true,
                firstName: true,
                lastName: true,
                profilePictureUrl: true,
              },
            },
          },
          orderBy,
          limit,
          offset,
        }),
        db
          .select({ count: count() })
          .from(eventReviews)
          .where(and(...conditions)),
      ]);

      // Calculate average ratings
      const ratingsQuery = await db
        .select({
          avgOverall: sql`AVG(${eventReviews.overallRating})`,
          avgVenue: sql`AVG(${eventReviews.venueRating})`,
          avgOrganization: sql`AVG(${eventReviews.organizationRating})`,
          avgValue: sql`AVG(${eventReviews.valueRating})`,
          totalReviews: count(),
        })
        .from(eventReviews)
        .where(eq(eventReviews.eventId, eventId));

      const ratings = ratingsQuery[0];

      return {
        reviews: reviewsResult.map(review => ({
          ...review,
          user: review.isAnonymous ? null : review.user,
        })),
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
        averageRatings: {
          overall: parseFloat(ratings.avgOverall) || 0,
          venue: parseFloat(ratings.avgVenue) || 0,
          organization: parseFloat(ratings.avgOrganization) || 0,
          value: parseFloat(ratings.avgValue) || 0,
          totalReviews: ratings.totalReviews,
        },
      };
    } catch (error) {
      console.error('Get event reviews error:', error);
      throw new ApiError(500, 'Failed to get event reviews');
    }
  }

  /**
   * Mark review as helpful/unhelpful
   */
  static async markReviewHelpful(userId, reviewId, isHelpful) {
    try {
      // Check if user already marked this review
      const existing = await db.query.reviewHelpfulness.findFirst({
        where: and(eq(reviewHelpfulness.reviewId, reviewId), eq(reviewHelpfulness.userId, userId)),
      });

      if (existing) {
        // Update existing
        await db
          .update(reviewHelpfulness)
          .set({ isHelpful, createdAt: new Date() })
          .where(eq(reviewHelpfulness.id, existing.id));
      } else {
        // Create new
        await db.insert(reviewHelpfulness).values({
          reviewId,
          userId,
          isHelpful,
          createdAt: new Date(),
        });
      }

      // Update helpful count on review
      const helpfulCount = await db
        .select({ count: count() })
        .from(reviewHelpfulness)
        .where(
          and(eq(reviewHelpfulness.reviewId, reviewId), eq(reviewHelpfulness.isHelpful, true))
        );

      await db
        .update(eventReviews)
        .set({
          helpfulCount: helpfulCount[0].count,
          updatedAt: new Date(),
        })
        .where(eq(eventReviews.id, reviewId));

      return { success: true };
    } catch (error) {
      console.error('Mark review helpful error:', error);
      throw new ApiError(500, 'Failed to mark review helpful');
    }
  }
}
