/**
 * Business reviews: one per completed booking, written by the signed-in
 * customer who booked it. The business can post one public reply per review.
 * businesses.rating / reviewCount are recomputed after every change.
 */
import httpStatus from 'http-status';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses, businessBookings, businessReviews, users } from '../db/schema/index.js';
import { bookingsAtLocations, viewLocationIds } from './businessLocation.service.js';
import ApiError from '../utils/api-error.js';
import { businessByIdOrSlug } from '../utils/handles.js';
import logger from '../config/logger.js';
import { isBusinessPublic } from './business.service.js';
import { createNotification } from './notification.service.js';
import { sendMail } from './mail.service.js';
import { emailWrapper, ctaRow, ctaButton, appUrl } from '../templates/emailLayout.js';


/** How long after the visit a customer may still review it. */
export const REVIEW_WINDOW_DAYS = 90;
/** Customers can edit their review for this long after posting it. */
export const REVIEW_EDIT_WINDOW_DAYS = 30;
/** Review reminder goes out this long after the booking completes. */
const REMINDER_AFTER_HOURS = 24;
/** …but not for bookings older than this (cron catch-up limit). */
const REMINDER_MAX_AGE_DAYS = 7;

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "Jordan R." — reviews show first name + last initial only. */
const displayName = u => {
  if (!u) return 'Customer';
  const first = (u.firstName ?? '').trim();
  const last = (u.lastName ?? '').trim();
  if (first) return last ? `${first} ${last[0].toUpperCase()}.` : first;
  return u.username || 'Customer';
};

const serializeReview = r => ({
  id: r.id,
  bookingId: r.bookingId,
  rating: r.rating,
  comment: r.comment,
  authorName: displayName(r.user),
  authorImage: r.user?.image ?? null,
  serviceName: r.booking?.serviceName ?? null,
  staffName: r.booking?.staffName ?? null,
  // When the reviewed visit took place
  visitDate: r.booking?.startAt ?? null,
  ownerReply: r.ownerReply,
  ownerRepliedAt: r.ownerRepliedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Whether `booking` (with completedAt/status/customerId) can be reviewed by `userId` now. */
export function canReviewBooking(booking, userId, now = new Date()) {
  if (!userId || booking.customerId !== userId || booking.status !== 'completed') return false;
  // Closed early by the business — wait until the service's scheduled end
  if (new Date(booking.endAt).getTime() > now.getTime()) return false;
  const closedAt = booking.completedAt ?? booking.endAt;
  return now.getTime() - new Date(closedAt).getTime() <= REVIEW_WINDOW_DAYS * 86_400_000;
}

async function recomputeAggregates(businessId, tx = db) {
  await tx
    .update(businesses)
    .set({
      rating: sql`(select coalesce(round(avg(r.rating)::numeric, 2), 0) from ${businessReviews} r where r.business_id = ${businessId})`,
      reviewCount: sql`(select count(*)::int from ${businessReviews} r where r.business_id = ${businessId})`,
    })
    .where(eq(businesses.id, businessId));
}

/** Reviews of visits at one of `locationIds`. */
async function locationCondition(businessId, locationIds) {
  return inArray(
    businessReviews.bookingId,
    db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .where(and(eq(businessBookings.businessId, businessId), await bookingsAtLocations(businessId, locationIds)))
  );
}

/** `locationIds`: only reviews of visits there (null = every location). */
async function listFor(businessId, { page = 1, limit = 10, rating }, locationIds = null) {
  // Summary / distribution follow the location but not the star filter
  const scope = [eq(businessReviews.businessId, businessId)];
  if (locationIds?.length) scope.push(await locationCondition(businessId, locationIds));
  const conds = [...scope];
  if (rating) conds.push(eq(businessReviews.rating, rating));
  const where = and(...conds);
  const offset = (page - 1) * limit;
  const [rows, [{ total }], distributionRows] = await Promise.all([
    db.query.businessReviews.findMany({
      where,
      with: {
        user: { columns: { firstName: true, lastName: true, username: true, image: true } },
        booking: { columns: { serviceName: true, staffName: true, startAt: true } },
      },
      orderBy: [desc(businessReviews.createdAt)],
      limit,
      offset,
    }),
    db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessReviews).where(where),
    db
      .select({ rating: businessReviews.rating, count: sql`count(*)`.mapWith(Number) })
      .from(businessReviews)
      .where(and(...scope))
      .groupBy(businessReviews.rating),
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const d of distributionRows) {
    distribution[d.rating] = d.count;
    sum += d.rating * d.count;
    count += d.count;
  }
  return {
    reviews: rows.map(serializeReview),
    summary: { rating: count ? Math.round((sum / count) * 100) / 100 : 0, reviewCount: count, distribution },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: offset + rows.length < total },
  };
}

async function loadOwnBooking(user, bookingId) {
  const booking = await db.query.businessBookings.findFirst({
    where: and(eq(businessBookings.id, bookingId), eq(businessBookings.customerId, user.id)),
    with: { business: { columns: { id: true, slug: true, name: true, ownerId: true, deletedAt: true } } },
  });
  if (!booking || booking.business?.deletedAt) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  return booking;
}

export class BusinessReviewService {
  // ── Public ────────────────────────────────────────────────────────────────

  static async listPublic(idOrSlug, query) {
    const business = await db.query.businesses.findFirst({
      where: and(businessByIdOrSlug(idOrSlug), isNull(businesses.deletedAt)),
      columns: { id: true, isPublished: true, deletedAt: true },
      with: { owner: { columns: { isBritesidePlus: true } } },
    });
    if (!business || !isBusinessPublic(business, business.owner)) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
    }
    return listFor(business.id, query, query.locationId ? [query.locationId] : null);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** Location managers only see reviews of visits at their locations. */
  static async listForBusiness(business, query, access) {
    return listFor(business.id, query, viewLocationIds(access, query.locationId));
  }

  /** Set (or with an empty reply, remove) the business's public response. */
  static async reply(business, reviewId, replyText) {
    const reply = replyText?.trim() || null;
    const [row] = await db
      .update(businessReviews)
      .set({ ownerReply: reply, ownerRepliedAt: reply ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(businessReviews.id, reviewId), eq(businessReviews.businessId, business.id)))
      .returning({ id: businessReviews.id, userId: businessReviews.userId });
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');

    if (reply) {
      createNotification({
        userId: row.userId,
        title: `${business.name} replied to your review`,
        message: reply.length > 140 ? `${reply.slice(0, 137)}…` : reply,
        type: 'business_review',
        redirectTo: `/business/${business.slug}`,
        relatedId: row.id,
        metadata: { businessId: business.id, reviewId: row.id },
      }).catch(err => logger.error(`[businessReview] reply notification failed: ${err.message}`));
    }
    return BusinessReviewService.getById(row.id);
  }

  static async getById(reviewId) {
    const row = await db.query.businessReviews.findFirst({
      where: eq(businessReviews.id, reviewId),
      with: {
        user: { columns: { firstName: true, lastName: true, username: true, image: true } },
        booking: { columns: { serviceName: true, staffName: true, startAt: true } },
      },
    });
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
    return serializeReview(row);
  }

  // ── Customer ──────────────────────────────────────────────────────────────

  static async create(user, bookingId, { rating, comment }) {
    const booking = await loadOwnBooking(user, bookingId);
    if (!canReviewBooking(booking, user.id)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        booking.status === 'completed' && new Date(booking.endAt) <= new Date()
          ? `Reviews can be left up to ${REVIEW_WINDOW_DAYS} days after your visit`
          : 'You can review a booking once it has been completed'
      );
    }

    let reviewId;
    try {
      reviewId = await db.transaction(async tx => {
        const [row] = await tx
          .insert(businessReviews)
          .values({
            businessId: booking.businessId,
            bookingId: booking.id,
            userId: user.id,
            staffId: booking.staffId,
            rating,
            comment: comment?.trim() || null,
          })
          .returning({ id: businessReviews.id });
        await recomputeAggregates(booking.businessId, tx);
        return row.id;
      });
    } catch (err) {
      // 23505 = unique_violation on uq_business_reviews_booking
      if (err?.code === '23505' || err?.cause?.code === '23505') {
        throw new ApiError(httpStatus.CONFLICT, 'You already reviewed this booking');
      }
      throw err;
    }

    createNotification({
      userId: booking.business.ownerId,
      title: `New ${rating}-star review`,
      message: `${displayName(user)} reviewed ${booking.serviceName}.`,
      type: 'business_review',
      redirectTo: '/business/dashboard?tab=reviews',
      relatedId: reviewId,
      metadata: { businessId: booking.businessId, reviewId },
    }).catch(err => logger.error(`[businessReview] owner notification failed: ${err.message}`));

    return BusinessReviewService.getById(reviewId);
  }

  static async update(user, bookingId, { rating, comment }) {
    const booking = await loadOwnBooking(user, bookingId);
    const existing = await db.query.businessReviews.findFirst({
      where: and(eq(businessReviews.bookingId, booking.id), eq(businessReviews.userId, user.id)),
    });
    if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
    if (Date.now() - existing.createdAt.getTime() > REVIEW_EDIT_WINDOW_DAYS * 86_400_000) {
      throw new ApiError(httpStatus.CONFLICT, `Reviews can be edited for ${REVIEW_EDIT_WINDOW_DAYS} days after posting`);
    }
    await db.transaction(async tx => {
      await tx
        .update(businessReviews)
        .set({
          ...(rating != null ? { rating } : {}),
          ...(comment !== undefined ? { comment: comment?.trim() || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(businessReviews.id, existing.id));
      await recomputeAggregates(booking.businessId, tx);
    });
    return BusinessReviewService.getById(existing.id);
  }

  /** Map of bookingId → serialized review, for the customer's own bookings list. */
  static async forBookings(bookingIds) {
    if (!bookingIds.length) return new Map();
    const rows = await db.query.businessReviews.findMany({
      where: inArray(businessReviews.bookingId, bookingIds),
      with: {
        user: { columns: { firstName: true, lastName: true, username: true, image: true } },
        booking: { columns: { serviceName: true, staffName: true, startAt: true } },
      },
    });
    return new Map(rows.map(r => [r.bookingId, serializeReview(r)]));
  }

  // ── Cron ──────────────────────────────────────────────────────────────────

  /**
   * Ask signed-in customers to review a visit ~24h after it completed.
   * Guests (no account) can't post reviews, so they're skipped.
   * A business can close a booking as soon as it starts, so the reminder also
   * waits until 24h past the booking's scheduled end — never mid-service.
   */
  static async sendReviewReminders() {
    const now = Date.now();
    const due = await db
      .select({
        booking: businessBookings,
        business: { id: businesses.id, slug: businesses.slug, name: businesses.name },
        customerFirstName: users.firstName,
      })
      .from(businessBookings)
      .innerJoin(businesses, eq(businesses.id, businessBookings.businessId))
      .innerJoin(users, eq(users.id, businessBookings.customerId))
      .leftJoin(businessReviews, eq(businessReviews.bookingId, businessBookings.id))
      .where(
        and(
          eq(businessBookings.status, 'completed'),
          isNull(businessBookings.reviewReminderSentAt),
          isNull(businessReviews.id),
          isNull(businesses.deletedAt),
          lte(businessBookings.completedAt, new Date(now - REMINDER_AFTER_HOURS * 3_600_000)),
          lte(businessBookings.endAt, new Date(now - REMINDER_AFTER_HOURS * 3_600_000)),
          gte(businessBookings.completedAt, new Date(now - REMINDER_MAX_AGE_DAYS * 86_400_000))
        )
      )
      .limit(200);

    let sent = 0;
    for (const { booking, business, customerFirstName } of due) {
      try {
        // Claim first so an overlapping run can't double-send
        const [claimed] = await db
          .update(businessBookings)
          .set({ reviewReminderSentAt: new Date() })
          .where(and(eq(businessBookings.id, booking.id), isNull(businessBookings.reviewReminderSentAt)))
          .returning({ id: businessBookings.id });
        if (!claimed) continue;

        const link = appUrl('/bookings?tab=business&view=past');
        const html = emailWrapper(`
          <h2 style="margin:0 0 12px">How was your visit to ${escapeHtml(business.name)}?</h2>
          <p style="margin:0 0 16px">Hi ${escapeHtml(customerFirstName || 'there')}, you recently had
            <strong>${escapeHtml(booking.serviceName)}</strong> with ${escapeHtml(booking.staffName)}.
            A quick rating helps other people find great local businesses.</p>
          ${ctaRow(ctaButton('Leave a review', link))}
        `);
        sendMail(booking.customerEmail, `How was ${business.name}?`, html).catch(err =>
          logger.error(`[businessReview] reminder email failed ${booking.id}: ${err.message}`)
        );
        createNotification({
          userId: booking.customerId,
          title: `How was ${business.name}?`,
          message: `Rate your ${booking.serviceName} visit.`,
          type: 'business_review',
          redirectTo: '/bookings?tab=business&view=past',
          relatedId: booking.id,
          metadata: { businessId: business.id, bookingId: booking.id },
        }).catch(err => logger.error(`[businessReview] reminder notification failed: ${err.message}`));
        sent++;
      } catch (err) {
        logger.error(`[businessReview] reminder failed ${booking.id}: ${err.message}`);
      }
    }
    return { sent, candidates: due.length };
  }
}
