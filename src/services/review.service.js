import { db } from '../db/index.js';
import {
  eventReviews,
  reviewHelpfulness,
  organizerReviews,
  events,
  purchasedTickets,
  users,
} from '../db/schema/index.js';
import { eq, and, desc, count, gte, lte, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

export class ReviewService {
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

      return !existingReview;
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
