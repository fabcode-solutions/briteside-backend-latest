/**
 * src/controllers/talent.controller.js
 */

import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { db } from '../db/index.js';
import { and, count, eq, isNull } from 'drizzle-orm';
import { talentSessions } from '../db/schema/talentSessions.js';
import { talentFavorites } from '../db/schema/talentFavorites.js';
import { PriorityMessageService } from '../services/priorityMessage.service.js';
import {
  TalentProfileService,
  TalentAvailabilityService,
  TalentSessionService,
  TalentReviewService,
  TalentFavoritesService,
  TalentProfileShareService,
  listTalentProfiles as listTalentProfilesService,
  getTalentPriceBounds as getTalentPriceBoundsService,
} from '../services/talentSession.service.js';
import { OrderService } from '../services/order.service.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { ShopCustomOfferService } from '../services/shop/shopCustomOffer.service.js';

// ─── TALENT PROFILE ───────────────────────────────────────────────────────────

export const createTalentProfile = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: { profile } });
});

export const updateTalentProfile = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.update(req.user.id, req.body);
  res.json({ success: true, data: { profile } });
});

// export const listTalentProfiles = catchAsync(async (req, res) => {
//   const { category, minRating, language, page, limit } = req.query;
//   const profiles = await TalentProfileService.list({
//     category,
//     minRating: minRating ? parseFloat(minRating) : undefined,
//     language,
//     page: page ? parseInt(page) : 1,
//     limit: limit ? parseInt(limit) : 20,
//   });
//   res.json({ success: true, data: { profiles } });
// });

export const listTalentProfiles = catchAsync(async (req, res) => {
  const {
    category,
    minRating,
    language,
    search,
    minPrice,
    maxPrice,
    minMessageFee,
    maxMessageFee,
    favoritesOnly,
    lat,
    lng,
    radius,
    page,
    limit,
  } = req.query;
  const userId = req.user?.id;
  const result = await listTalentProfilesService({
    category,
    minRating: minRating ? parseFloat(minRating) : undefined,
    language,
    search,
    minPrice: minPrice !== undefined ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice !== undefined ? parseFloat(maxPrice) : undefined,
    minMessageFee: minMessageFee !== undefined ? parseFloat(minMessageFee) : undefined,
    maxMessageFee: maxMessageFee !== undefined ? parseFloat(maxMessageFee) : undefined,
    favoritesOnly: favoritesOnly === 'true',
    lat: lat !== undefined ? parseFloat(lat) : undefined,
    lng: lng !== undefined ? parseFloat(lng) : undefined,
    radius: radius !== undefined ? parseFloat(radius) : undefined,
    userId,
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 12,
  });
  res.json({ success: true, data: result });
});

export const getTalentPriceBounds = catchAsync(async (req, res) => {
  const bounds = await getTalentPriceBoundsService();
  res.json({ success: true, data: bounds });
});

export const getTalentProfile = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.getById(req.params.profileId, req.user?.id);
  res.json({ success: true, data: { profile } });
});

export const getTalentProfileByUsername = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.getByUsername(req.params.username, req.user?.id);
  res.json({ success: true, data: { profile } });
});

export const getMyTalentProfile = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.getByUserId(req.user.id);
  res.json({ success: true, data: { profile } });
});

// ─── AVAILABILITY ─────────────────────────────────────────────────────────────

export const upsertAvailability = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.getByUserId(req.user.id);
  const { windows } = req.body;
  if (!Array.isArray(windows)) throw new ApiError(400, '`windows` must be an array');
  const result = await TalentAvailabilityService.upsert(profile.id, windows);
  res.json({ success: true, data: { availability: result } });
});

export const getAvailability = catchAsync(async (req, res) => {
  const availability = await TalentAvailabilityService.getForProfile(req.params.profileId);
  res.json({ success: true, data: { availability } });
});

export const getAvailableSlots = catchAsync(async (req, res) => {
  const { profileId } = req.params;
  const { date, duration } = req.query;

  if (!date) throw new ApiError(400, '`date` query param is required (YYYY-MM-DD)');
  if (!duration) throw new ApiError(400, '`duration` query param is required (15|30|45|60)');

  const durationMins = parseInt(duration);
  if (![15, 30, 45, 60].includes(durationMins)) {
    throw new ApiError(400, '`duration` must be one of: 15, 30, 45, 60');
  }

  const availWindows = await TalentAvailabilityService.getForProfile(profileId);
  const talentTimezone = availWindows[0]?.timezone || 'UTC';

  const slots = await TalentAvailabilityService.getAvailableSlots(profileId, date, durationMins);
  res.json({ success: true, data: { slots, talentTimezone } });
});

// ─── SESSIONS ─────────────────────────────────────────────────────────────────

export const createSessionCheckout = catchAsync(async (req, res) => {
  const {
    talentProfileId,
    date,
    time,
    durationMins,
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
    platform,
  } = req.body;

  if (!talentProfileId) throw new ApiError(400, '`talentProfileId` is required');
  if (!date) throw new ApiError(400, '`date` is required (YYYY-MM-DD)');
  if (!time) throw new ApiError(400, '`time` is required (HH:MM)');
  if (!durationMins) throw new ApiError(400, '`durationMins` is required');
  if (!subject && !giftCode) throw new ApiError(400, '`subject` is required');

  const result = await TalentSessionService.createCheckout({
    talentProfileId,
    bookerId: req.user.id,
    date,
    time,
    durationMins: parseInt(durationMins),
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
    platform,
  });

  res.status(201).json({ success: true, data: result });
});

export const bookSession = catchAsync(async (req, res) => {
  const {
    talentProfileId,
    date,
    time,
    durationMins,
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
  } = req.body;

  if (!talentProfileId) throw new ApiError(400, '`talentProfileId` is required');
  if (!date) throw new ApiError(400, '`date` is required (YYYY-MM-DD)');
  if (!time) throw new ApiError(400, '`time` is required (HH:MM)');
  if (!durationMins) throw new ApiError(400, '`durationMins` is required');
  if (!subject && !giftCode) throw new ApiError(400, '`subject` is required');
  const io = req.app.get('io');
  const session = await TalentSessionService.book({
    talentProfileId,
    bookerId: req.user.id,
    date,
    time,
    durationMins: parseInt(durationMins),
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
    io,
  });

  res.status(201).json({ success: true, data: { session } });
});

export const confirmSession = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const session = await TalentSessionService.confirm(req.params.sessionId, req.user.id, io);
  res.json({ success: true, data: { session } });
});

export const declineSession = catchAsync(async (req, res) => {
  const session = await TalentSessionService.decline(req.params.sessionId, req.user.id);
  res.json({ success: true, data: { session } });
});

export const cancelSession = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const session = await TalentSessionService.cancel(req.params.sessionId, req.user.id, reason);
  res.json({ success: true, data: { session } });
});

export const recordJoin = catchAsync(async (req, res) => {
  const session = await TalentSessionService.recordJoin(req.params.sessionId, req.user.id);
  res.json({ success: true, data: { session } });
});

export const acknowledgeRecording = catchAsync(async (req, res) => {
  const { disclosureVersion } = req.body;
  const session = await TalentSessionService.acknowledgeRecording(
    req.params.sessionId,
    req.user.id,
    { disclosureVersion }
  );
  res.json({ success: true, data: { session } });
});

export const endSession = catchAsync(async (req, res) => {
  const session = await TalentSessionService.endSession(req.params.sessionId);
  res.json({ success: true, data: { session } });
});

/**
 * GET /talent/sessions
 * Query: role, tab, status, page, limit
 *
 * tab values: upcoming | pending | past | cancelled | all
 * role values: booker | talent | all
 *
 * Returns: { sessions, total, page, limit, totalPages }
 */
export const listMySessions = catchAsync(async (req, res) => {
  const { role, tab, status, date, page, limit } = req.query;

  const result = await TalentSessionService.listForUser(req.user.id, {
    role: role || 'all',
    tab: tab || 'all',
    status,
    date,
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  res.json({ success: true, data: result });
});

/**
 * GET /talent/me/video-requests
 *
 * Returns pending sessions where the current user is the TALENT.
 * Includes booker user details so the talent can see who is requesting.
 *
 * Response shape per session:
 * {
 *   id, scheduledAt, durationMins, priceCents, status,
 *   subject, discussion,
 *   booker: { id, firstName, lastName, username, profileImage, email }
 * }
 */
export const getVideoRequests = catchAsync(async (req, res) => {
  const { page, limit } = req.query;

  const result = await TalentSessionService.getVideoRequests(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  res.json({ success: true, data: result });
});

export const getSession = catchAsync(async (req, res) => {
  const session = await db.query.talentSessions.findFirst({
    where: eq(talentSessions.id, req.params.sessionId),
    with: {
      talentProfile: {
        with: {
          user: { columns: { id: true, firstName: true, lastName: true, profileImage: true } },
        },
      },
    },
  });
  if (!session) throw new ApiError(404, 'Session not found');

  const profile = await TalentProfileService.getByUserId(req.user.id).catch(() => null);
  const isParticipant = session.bookerId === req.user.id || profile?.id === session.talentProfileId;
  if (!isParticipant) throw new ApiError(403, 'Forbidden');

  res.json({ success: true, data: { session } });
});

// ─── BOOKED EVENTS ────────────────────────────────────────────────────────────

/**
 * GET /talent/me/booked-events
 *
 * Returns the user's event orders (paid ticket purchases) for the bookings page.
 * Delegates to the existing OrderService.listUserOrders — no new schema needed.
 *
 * Query params:
 *   page, limit, status (default: paid)
 *
 * Response shape:
 * {
 *   items: [
 *     {
 *       id, totalAmount, status, createdAt,
 *       event: { id, title, startDate, endDate, coverImages, venue },
 *       orderItems: [...]
 *     }
 *   ],
 *   pagination: { page, limit, total, pages, hasMore }
 * }
 */
export const getMyBookedEvents = catchAsync(async (req, res) => {
  const { page, limit, status, date } = req.query;
  const pageNum = page ? parseInt(page) : 1;
  const limitNum = limit ? parseInt(limit) : 10;

  const [eventResult, sessionResult] = await Promise.all([
    OrderService.listUserOrders(req.user.id, {
      page: pageNum,
      limit: limitNum,
      status: status || 'paid',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    TalentSessionService.listForUser(req.user.id, {
      role: 'all',
      tab: 'all',
      date,
      page: pageNum,
      limit: limitNum,
    }),
  ]);

  let items = eventResult.items ?? [];
  if (date) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    items = items.filter(item => {
      const startDate = new Date(item.event?.startDate);
      return startDate >= dayStart && startDate <= dayEnd;
    });
  }

  res.json({
    success: true,
    data: {
      ...eventResult,
      items,
      sessions: sessionResult.sessions,
      sessionsPagination: {
        page: sessionResult.page,
        limit: sessionResult.limit,
        total: sessionResult.total,
        pages: sessionResult.totalPages,
        hasMore: pageNum < sessionResult.totalPages,
      },
    },
  });
});

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────

/**
 * GET /talent/me/dashboard-stats
 *
 * Returns aggregated metrics for the Influencer Dashboard.
 *
 * Response shape:
 * {
 *   profile: { rating, totalSessions, priorityMessageFee, rates, isActive },
 *   stats: {
 *     totalEarningsCents, totalEarnings,
 *     completedSessions, totalMinutes,
 *     totalRequests, acceptedRequests, acceptanceRate,
 *     cancelledCount, cancellationRate,
 *   },
 *   monthlyEarnings: [{ month, videoEarnings, messageEarnings }],   // last 7 months
 *   recentSessions:  [{ id, requesterName, requesterAvatar, date, duration, price, subject, status }]
 * }
 */
async function buildDashboardStats(profile) {
  const [likeRow] = await db
    .select({ total: count() })
    .from(talentFavorites)
    .where(eq(talentFavorites.talentProfileId, profile.id));
  const totalLikes = likeRow?.total ?? 0;
  const totalShares = profile.shareCount ?? 0;

  const allSessions = await db.query.talentSessions.findMany({
    where: eq(talentSessions.talentProfileId, profile.id),
    with: {
      booker: {
        columns: { id: true, firstName: true, lastName: true, profileImage: true },
      },
    },
    orderBy: (s, { desc }) => [desc(s.scheduledAt)],
  });

  // ── NEW: priority message earnings summary ────────────────────────────────
  const msgSummary = await PriorityMessageService.getEarningsSummary(profile.userId).catch(
    () => ({
      totalEarnings: 0,
      totalEarningsCents: 0,
      totalMessages: 0,
      unreadCount: 0,
      responseRate: 0,
      activeConversations: 0,
      todayCount: 0,
      weekCount: 0,
      monthlyEarnings: Array(7).fill({ earnings: 0, earningsCents: 0 }),
    })
  );

  const completed = allSessions.filter(s => s.status === 'completed');
  const cancelled = allSessions.filter(s => s.status === 'cancelled' || s.status === 'declined');
  const accepted = allSessions.filter(s => ['confirmed', 'live', 'completed'].includes(s.status));
  const nonPending = allSessions.filter(s => s.status !== 'pending');

  const totalEarningsCents = completed.reduce((sum, s) => sum + (s.priceCents || 0), 0);
  const completedSessions = completed.length;
  const totalMinutes = completed.reduce(
    (sum, s) => sum + (s.actualDurationMins || s.durationMins || 0),
    0
  );
  const totalRequests = nonPending.length;
  const acceptedRequests = accepted.length;
  const acceptanceRate =
    totalRequests > 0 ? Math.round((acceptedRequests / totalRequests) * 100) : 0;
  const cancelledCount = cancelled.length;
  const cancellationRate =
    allSessions.length > 0 ? Math.round((cancelledCount / allSessions.length) * 100) : 0;

  const now = new Date();
  const MONTH_ABBR = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const months = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_ABBR[d.getMonth()] });
  }

  // ── UPDATED: messageEarnings now pulled from msgSummary instead of hardcoded 0 ──
  const monthlyEarnings = months.map(({ year, month, label }, idx) => {
    const videoEarningsCents = completed
      .filter(s => {
        const d = new Date(s.scheduledAt);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce((sum, s) => sum + (s.priceCents || 0), 0);
    return {
      month: label,
      videoEarnings: Math.round(videoEarningsCents / 100),
      messageEarnings: msgSummary.monthlyEarnings[idx]?.earnings ?? 0,
    };
  });

  const recentSessions = allSessions.slice(0, 10).map(s => ({
    id: s.id,
    requesterName: s.booker ? `${s.booker.firstName} ${s.booker.lastName}` : 'Unknown',
    requesterAvatar: s.booker?.profileImage || null,
    date: s.scheduledAt,
    duration: s.durationMins,
    price: Math.round((s.priceCents || 0) / 100),
    subject: s.subject || '',
    status: s.status,
  }));

  return {
    profile: {
      rating: profile.rating,
      totalSessions: profile.totalSessions,
      priorityMessageFee: Math.round((profile.priorityMessageFee || 0) / 100),
      priorityMessagingEnabled: profile.priorityMessagingEnabled,
      rates: profile.rates,
      isActive: profile.isActive,
    },
    stats: {
      // Video stats — unchanged
      totalEarningsCents,
      totalEarnings: Math.round(totalEarningsCents / 100),
      completedSessions,
      totalMinutes,
      totalRequests,
      acceptedRequests,
      acceptanceRate,
      cancelledCount,
      cancellationRate,
      // ── NEW: priority message stats ──
      totalMessageEarnings: msgSummary.totalEarnings,
      totalPriorityMessages: msgSummary.totalMessages,
      unreadPriorityMessages: msgSummary.unreadCount,
      messageResponseRate: msgSummary.responseRate,
      activeConversations: msgSummary.activeConversations,
      messagesToday: msgSummary.todayCount,
      messagesThisWeek: msgSummary.weekCount,
    },
    engagement: { totalLikes, totalShares },
    monthlyEarnings,
    recentSessions,
  };
}

export const getDashboardStats = catchAsync(async (req, res) => {
  const profile = await TalentProfileService.getByUserId(req.user.id).catch(() => null);
  if (!profile) throw new ApiError(404, 'Talent profile not found. Please create one first.');
  const data = await buildDashboardStats(profile);
  res.json({ success: true, data });
});

export const getAdminTalentDashboardStats = catchAsync(async (req, res) => {
  const { talentProfileId } = req.params;
  const profile = await TalentProfileService.getById(talentProfileId).catch(() => null);
  if (!profile) throw new ApiError(404, 'Talent profile not found');
  const data = await buildDashboardStats(profile);
  res.json({ success: true, data });
});

// ─── REVIEWS ──────────────────────────────────────────────────────────────────

/**
 * POST /talent/sessions/:sessionId/review
 * Submit a review for a completed session (booker only, once per session).
 *
 * Body: { rating, communicationRating?, valueRating?, title?, comment? }
 */
export const submitReview = catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { rating, communicationRating, valueRating, title, comment } = req.body;

  if (!rating) throw new ApiError(400, '`rating` is required (1–5)');

  const review = await TalentReviewService.create(req.user.id, {
    sessionId,
    rating: parseInt(rating),
    communicationRating: communicationRating ? parseInt(communicationRating) : undefined,
    valueRating: valueRating ? parseInt(valueRating) : undefined,
    title,
    comment,
  });

  res.status(201).json({ success: true, data: { review } });
});

/**
 * GET /talent/:profileId/reviews
 * Public — list all visible reviews for a talent profile.
 * Query: page, limit
 */
export const listProfileReviews = catchAsync(async (req, res) => {
  const { profileId } = req.params;
  const { page, limit } = req.query;

  // profileId from the frontend may be either a talentProfileId or a userId.
  // Try loading by talentProfileId first; if not found, fall back to userId lookup.
  let resolvedProfileId = profileId;

  const byProfileId = await db.query.talentProfiles.findFirst({
    where: and(eq(talentProfiles.id, profileId), isNull(talentProfiles.deletedAt)),
    columns: { id: true },
  });

  if (!byProfileId) {
    // Frontend sent a userId — resolve to talentProfileId
    const byUserId = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.userId, profileId), isNull(talentProfiles.deletedAt)),
      columns: { id: true },
    });
    if (!byUserId) throw new ApiError(404, 'Talent profile not found');
    resolvedProfileId = byUserId.id;
  }

  const result = await TalentReviewService.listForProfile(resolvedProfileId, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  res.json({ success: true, data: result });
});

/**
 * GET /talent/sessions/:sessionId/review
 * Get the review for a specific session (booker or talent can call this).
 * Returns null if no review has been submitted yet.
 */
export const getSessionReview = catchAsync(async (req, res) => {
  const review = await TalentReviewService.getForSession(req.params.sessionId, req.user.id);
  res.json({ success: true, data: { review } });
});

/**
 * POST /talent/priority-messages/:paymentId/review
 * Submit a review after a paid priority message (sender only, once per payment).
 * Body: { rating, communicationRating?, valueRating?, title?, comment? }
 */
export const submitReviewFromPriorityMessage = catchAsync(async (req, res) => {
  const { paymentId } = req.params;
  const { rating, communicationRating, valueRating, title, comment } = req.body;

  if (!rating) throw new ApiError(400, '`rating` is required (1–5)');

  const review = await TalentReviewService.create(req.user.id, {
    priorityMessageId: paymentId,
    rating: parseInt(rating),
    communicationRating: communicationRating ? parseInt(communicationRating) : undefined,
    valueRating: valueRating ? parseInt(valueRating) : undefined,
    title,
    comment,
  });

  res.status(201).json({ success: true, data: { review } });
});

/**
 * PATCH /talent/reviews/:reviewId
 * Edit an existing review (reviewer's own only).
 * Body: { rating?, communicationRating?, valueRating?, title?, comment? }
 */
export const updateReview = catchAsync(async (req, res) => {
  const { reviewId } = req.params;
  const { rating, communicationRating, valueRating, title, comment } = req.body;

  const review = await TalentReviewService.update(reviewId, req.user.id, {
    rating: rating !== undefined ? parseInt(rating) : undefined,
    communicationRating:
      communicationRating !== undefined ? parseInt(communicationRating) : undefined,
    valueRating: valueRating !== undefined ? parseInt(valueRating) : undefined,
    title,
    comment,
  });

  res.json({ success: true, data: { review } });
});

/**
 * POST /talent/reviews/:reviewId/report
 * Talent reports a review on their own profile as wrong/fake.
 * Body: { reason? }
 */
export const reportReview = catchAsync(async (req, res) => {
  const { reviewId } = req.params;
  const { reason } = req.body;

  const review = await TalentReviewService.reportReview(reviewId, req.user.id, { reason });
  res.json({ success: true, data: { review } });
});

/**
 * GET /talent/me/reviews
 * Get all reviews the authenticated user has submitted.
 * Query: page, limit
 */
export const getMyReviews = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const result = await TalentReviewService.getMyReviews(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });
  res.json({ success: true, data: result });
});

/**
 * Admin — GET /admin/talent-reviews
 * List all reviews that have been reported by talents, newest first.
 * Query: page, limit
 */
export const adminListReportedReviews = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const result = await TalentReviewService.adminListReported({
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 20,
  });
  res.json({ success: true, data: result });
});

/**
 * Admin — PATCH /admin/talent-reviews/:reviewId/remove
 * Hide a review (isVisible = false) and recompute the talent's rating.
 */
export const adminRemoveTalentReview = catchAsync(async (req, res) => {
  const { reviewId } = req.params;
  const review = await TalentReviewService.adminRemoveReview(reviewId);
  res.json({ success: true, data: { review } });
});

/**
 * Admin — PATCH /admin/talent-reviews/:reviewId/dismiss
 * Dismiss the report — clears reportedAt/reportReason, review stays live.
 */
export const adminDismissReviewReport = catchAsync(async (req, res) => {
  const { reviewId } = req.params;
  const review = await TalentReviewService.adminDismissReviewReport(reviewId);
  res.json({ success: true, data: { review } });
});

// ─── RESCHEDULE ───────────────────────────────────────────────────────────────

/**
 * POST /talent/sessions/:sessionId/reschedule
 * Booker reschedules a pending or confirmed session to a new date/time.
 *
 * Body: { date: 'YYYY-MM-DD', time: 'HH:MM' }
 *
 * What happens:
 *  - Original session → status = 'rescheduled'
 *  - New session created → status = 'pending' (talent must re-confirm)
 *  - Both parties notified
 */
export const rescheduleSession = catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { date, time, reason } = req.body;

  if (!date) throw new ApiError(400, '`date` is required (YYYY-MM-DD)');
  if (!time) throw new ApiError(400, '`time` is required (HH:MM)');
  const io = req.app.get('io');
  const result = await TalentSessionService.reschedule(sessionId, req.user.id, {
    date,
    time,
    reason,
    io,
  });

  res.status(201).json({
    success: true,
    message: 'Session rescheduled. Waiting for talent to confirm the new time.',
    data: result,
  });
});

export const shareTalentProfile = catchAsync(async (req, res) => {
  const { profileId } = req.params;
  const result = await TalentProfileShareService.recordShare(profileId);
  const shareUrl = `${process.env.FRONTEND_URL || 'https://briteside.app'}/talent/${profileId}`;
  res.json({ success: true, data: { ...result, shareUrl } });
});

export const toggleFavorite = catchAsync(async (req, res) => {
  const result = await TalentFavoritesService.toggle(req.user.id, req.params.profileId);
  res.json({ success: true, data: result });
});

export const getMyFavoriteIds = catchAsync(async (req, res) => {
  const favoriteIds = await TalentFavoritesService.getFavoriteIds(req.user.id);
  res.json({ success: true, data: { favoriteIds } });
});

/**
 * Combined save: upsert-or-create profile + replace availability windows.
 * First-time users must pass title + category to bootstrap their profile.
 *
 * Body: {
 *   isActive:      boolean,
 *   rates:         { "15": 100, "30": 180, ... },
 *   windows:       TalentAvailabilityWindow[],
 *   dateOverrides: DateOverrideEntry[],   // optional
 *   title:         string,                // required first time only
 *   category:      string,                // required first time only
 * }
 */
export const saveSchedule = catchAsync(async (req, res) => {
  const {
    isActive,
    rates,
    windows,
    dateOverrides,
    title,
    category,
    city,
    state,
    country,
    countryCode,
    latitude,
    longitude,
  } = req.body;

  if (!Array.isArray(windows)) {
    throw new ApiError(400, '`windows` must be an array');
  }

  const result = await TalentAvailabilityService.saveSchedule(req.user.id, {
    isActive,
    rates,
    windows,
    dateOverrides,
    title,
    category,
    city,
    state,
    country,
    countryCode,
    latitude,
    longitude,
  });

  res.json({ success: true, data: result });
});
export const getMyAvailability = catchAsync(async (req, res) => {
  const availability = await TalentAvailabilityService.getMyAvailability(req.user.id);
  res.json({ success: true, data: { availability } });
});

/**
 * POST /talent/sessions/:sessionId/call-feedback
 * Submit call quality rating after a completed session.
 * Both booker and talent can submit once each.
 * Body: { rating: 1-5, feedback?: string }
 */
export const submitCallFeedback = catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { rating, feedback } = req.body;

  if (!rating) throw new ApiError(400, '`rating` is required (1–5)');

  const result = await TalentSessionService.submitCallFeedback(sessionId, req.user.id, {
    rating: parseInt(rating),
    feedback,
  });

  res.status(201).json({ success: true, data: result });
});
export const submitCustomOfferWork = catchAsync(async (req, res) => {
  const deliverables = await ShopCustomOfferService.submitWork(
    req.user.id,
    req.params.offerId,
    req.files,
    req.body?.note
  );
  res.status(201).json({ success: true, message: 'Work submitted', data: { deliverables } });
});

export const getCustomOfferDeliverables = catchAsync(async (req, res) => {
  const deliverables = await ShopCustomOfferService.listDeliverables(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, data: { deliverables } });
});

/**
 * POST /talent/custom-offers/:offerId/review
 * Submit a review after a completed custom offer (buyer only, once per offer).
 */
export const submitReviewFromCustomOffer = catchAsync(async (req, res) => {
  const { offerId } = req.params;
  const { rating, communicationRating, valueRating, title, comment } = req.body;

  if (!rating) throw new ApiError(400, '`rating` is required (1–5)');

  const review = await TalentReviewService.create(req.user.id, {
    shopCustomOfferId: offerId,
    rating: parseInt(rating),
    communicationRating: communicationRating ? parseInt(communicationRating) : undefined,
    valueRating: valueRating ? parseInt(valueRating) : undefined,
    title,
    comment,
  });

  // Best-effort — surfaces this in the offer's Activity tab for both parties.
  await ShopCustomOfferService.logActivity(offerId, req.user.id, 'review_submitted', {
    rating: parseInt(rating),
    title,
    comment,
  });

  res.status(201).json({ success: true, data: { review } });
});