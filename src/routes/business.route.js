import express from 'express';
import multer from 'multer';
import httpStatus from 'http-status';
import { ipKeyGenerator } from 'express-rate-limit';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { createLimiter } from '../middlewares/rateLimiter.js';
import ApiError from '../utils/api-error.js';
import { ATTACHMENT_MAX_BYTES } from '../utils/businessQuestionnaire.js';
import { ATTACHMENT_TYPES } from '../services/businessAttachment.service.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { requireBusinessPermission } from '../middlewares/businessAccess.middleware.js';
import { BUSINESS_PERMISSIONS as P } from '../config/business-permissions.js';
import * as c from '../controllers/business.controller.js';
import * as v from '../validations/business.validation.js';
import * as inbox from '../controllers/businessInbox.controller.js';
import * as vi from '../validations/businessInbox.validation.js';

const router = express.Router();

// Booking attachments: one image / PDF per request, kept in memory (≤ 10 MB) then
// stored privately. Type + file signature are re-checked in BusinessAttachmentService.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) =>
    ATTACHMENT_TYPES.has(file.mimetype)
      ? cb(null, true)
      : cb(new ApiError(httpStatus.BAD_REQUEST, 'Only photos (JPG, PNG, WebP, GIF, HEIC) and PDFs can be attached')),
});
const handleAttachmentUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return next(
      new ApiError(
        httpStatus.BAD_REQUEST,
        error.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 10 MB each' : 'Attach one file at a time'
      )
    );
  }
  next(error);
};
const attachmentUploadLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV !== 'production' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: {
    success: false,
    error: { code: 429, message: 'Too many uploads. Please wait a few minutes and try again.' },
  },
});

// Business inbox: sending messages (either side)
const inboxSendLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV !== 'production' ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: {
    success: false,
    error: { code: 429, message: 'You are sending messages too fast. Please wait a moment.' },
  },
});

// ─── Public ─────────────────────────────────────────────────────────────────
router.get('/categories', c.getCategories);
router.get('/fees/quote', c.quoteFees);
router.get('/', validateMiddleware(v.listBusinessesSchema), c.listBusinesses);

// ─── Bookings: customer side (static paths, before /:idOrSlug) ─────────────
router.get(
  '/bookings/checkout/:checkoutSessionId',
  validateMiddleware(v.checkoutSessionParamsSchema),
  c.getBookingByCheckoutSession
);
router.get('/bookings/mine', authMiddleware, validateMiddleware(v.myBookingsSchema), c.listMyBookings);
// Business inbox — customer side: my conversations with businesses (static paths, before /:idOrSlug)
router.get('/messages', authMiddleware, validateMiddleware(vi.listMineSchema), inbox.listMine);
router.get('/messages/unread-count', authMiddleware, inbox.unreadMine);
router.get(
  '/messages/:conversationId',
  authMiddleware,
  validateMiddleware(vi.myConversationSchema),
  inbox.getMyConversation
);
router.post(
  '/messages/:conversationId',
  authMiddleware,
  inboxSendLimiter,
  validateMiddleware(vi.sendMineSchema),
  inbox.sendMine
);
router.post(
  '/messages/:conversationId/read',
  authMiddleware,
  validateMiddleware(vi.readMineSchema),
  inbox.readMine
);
// Custom price offers — read by the customer it was sent to or the owner (chat card); declined by the customer
// Mine: the ones sent to me (My Calendar → Requests). Before /offers/:offerId.
router.get('/offers/mine', authMiddleware, validateMiddleware(v.myCustomOffersSchema), c.listMyCustomOffers);
router.get('/offers/:offerId', authMiddleware, validateMiddleware(v.customOfferSchema), c.getCustomOffer);
router.post('/offers/:offerId/decline', authMiddleware, validateMiddleware(v.customOfferSchema), c.declineCustomOffer);
// In-app card checkout (NativeCheckoutModal) for a held booking — guests may pay too
router.post('/bookings/:bookingId/native-tax-preview', optionalAuthMiddleware, validateMiddleware(v.nativeIntentSchema), c.bookingNativeTaxPreview);
router.post('/bookings/:bookingId/native-intent', optionalAuthMiddleware, validateMiddleware(v.nativeIntentSchema), c.bookingNativeIntent);
router.post('/bookings/:bookingId/native-finalize', optionalAuthMiddleware, validateMiddleware(v.nativeFinalizeSchema), c.bookingNativeFinalize);
// …and for the remaining balance (signed-in customer)
router.post('/bookings/:bookingId/balance/native-tax-preview', authMiddleware, validateMiddleware(v.nativeIntentSchema), c.balanceNativeTaxPreview);
router.post('/bookings/:bookingId/balance/native-intent', authMiddleware, validateMiddleware(v.nativeIntentSchema), c.balanceNativeIntent);
router.post('/bookings/:bookingId/balance/native-finalize', authMiddleware, validateMiddleware(v.nativeFinalizeSchema), c.balanceNativeFinalize);
// Business side, across every business the user owns or is on the team of
// (My Calendar → Appointment Requests and the calendar view)
router.get(
  '/bookings/managed',
  authMiddleware,
  validateMiddleware(v.managedBookingsSchema),
  c.listManagedBookings
);
router.post(
  '/bookings/:bookingId/cancel',
  authMiddleware,
  validateMiddleware(v.customerCancelSchema),
  c.cancelMyBooking
);
// Move to another time, within the business's rescheduling policy
router.get(
  '/bookings/:bookingId/reschedule-slots',
  authMiddleware,
  validateMiddleware(v.customerRescheduleSlotsSchema),
  c.getMyRescheduleSlots
);
router.post(
  '/bookings/:bookingId/reschedule',
  authMiddleware,
  validateMiddleware(v.customerRescheduleSchema),
  c.rescheduleMyBooking
);
// A file the customer attached (short-lived signed link)
router.get(
  '/bookings/:bookingId/attachments/:index',
  authMiddleware,
  validateMiddleware(v.customerAttachmentSchema),
  c.getMyBookingAttachment
);
// Review a completed visit (one per booking; editable for a while)
router.post(
  '/bookings/:bookingId/review',
  authMiddleware,
  validateMiddleware(v.createReviewSchema),
  c.createReview
);
router.patch(
  '/bookings/:bookingId/review',
  authMiddleware,
  validateMiddleware(v.updateReviewSchema),
  c.updateReview
);
// Pay the remaining balance online (no booking fee; 5% commission applies)
router.post(
  '/bookings/:bookingId/pay-balance',
  authMiddleware,
  validateMiddleware(v.payBalanceSchema),
  c.payMyBookingBalance
);

// ─── Authenticated, not business-scoped ────────────────────────────────────
router.get('/mine', authMiddleware, c.listMyBusinesses);
router.post(
  '/invitations/:token/accept',
  authMiddleware,
  validateMiddleware(v.acceptInvitationSchema),
  c.acceptInvitation
);
// Creating a business — open to any signed-in user (no BriteSide Plus needed)
router.post(
  '/',
  authMiddleware,
  validateMiddleware(v.createBusinessSchema),
  c.createBusiness
);

// Public profile (single segment — declared after the static paths above)
router.get('/:idOrSlug', validateMiddleware(v.getPublicBusinessSchema), c.getPublicBusiness);
router.get('/:idOrSlug/slots', validateMiddleware(v.getSlotsSchema), c.getSlots);
router.get('/:idOrSlug/reviews', validateMiddleware(v.listPublicReviewsSchema), c.listPublicReviews);
// Wall on standard pages — anyone reads approved posts (signed-in: also own / queued
// requests), members post requests, the business approves or rejects them
router.get('/:idOrSlug/wall', optionalAuthMiddleware, validateMiddleware(v.listWallPostsSchema), c.listWallPosts);
router.post('/:idOrSlug/wall', authMiddleware, validateMiddleware(v.createWallPostSchema), c.createWallPost);
// Business inbox: open (or reopen) my conversation with this business
router.post(
  '/:idOrSlug/messages/conversation',
  authMiddleware,
  validateMiddleware(vi.openForCustomerSchema),
  inbox.openForCustomer
);
// LEGACY: opens a personal DM with the owner. Replaced by /:idOrSlug/messages/conversation
// (business inbox); remove once the apps have switched over.
router.post(
  '/:idOrSlug/inquiries/conversation',
  authMiddleware,
  validateMiddleware(v.inquiryConversationSchema),
  c.openInquiryConversation
);
router.put(
  '/:idOrSlug/wall/:postId/status',
  authMiddleware,
  validateMiddleware(v.moderateWallPostSchema),
  c.moderateWallPost
);
router.delete(
  '/:idOrSlug/wall/:postId',
  authMiddleware,
  validateMiddleware(v.wallPostIdSchema),
  c.deleteWallPost
);
// Likes & comments on approved wall posts
router.post(
  '/:idOrSlug/wall/:postId/like',
  authMiddleware,
  validateMiddleware(v.wallPostIdSchema),
  c.likeWallPost
);
router.delete(
  '/:idOrSlug/wall/:postId/like',
  authMiddleware,
  validateMiddleware(v.wallPostIdSchema),
  c.unlikeWallPost
);
router.get(
  '/:idOrSlug/wall/:postId/comments',
  optionalAuthMiddleware,
  validateMiddleware(v.listWallCommentsSchema),
  c.listWallComments
);
router.post(
  '/:idOrSlug/wall/:postId/comments',
  authMiddleware,
  validateMiddleware(v.createWallCommentSchema),
  c.createWallComment
);
router.put(
  '/:idOrSlug/wall/:postId/comments/:commentId',
  authMiddleware,
  validateMiddleware(v.updateWallCommentSchema),
  c.updateWallComment
);
router.delete(
  '/:idOrSlug/wall/:postId/comments/:commentId',
  authMiddleware,
  validateMiddleware(v.wallCommentIdSchema),
  c.deleteWallComment
);
router.get(
  '/:idOrSlug/wall/:postId/comments/:commentId/replies',
  optionalAuthMiddleware,
  validateMiddleware(v.listWallRepliesSchema),
  c.listWallReplies
);
router.post(
  '/:idOrSlug/wall/:postId/comments/:commentId/like',
  authMiddleware,
  validateMiddleware(v.wallCommentIdSchema),
  c.likeWallComment
);
router.delete(
  '/:idOrSlug/wall/:postId/comments/:commentId/like',
  authMiddleware,
  validateMiddleware(v.wallCommentIdSchema),
  c.unlikeWallComment
);
router.get('/:idOrSlug/bookings/quote', validateMiddleware(v.bookingQuoteSchema), c.getBookingQuote);
// Gallery photos ("Posts"): counts for everyone, likes / comments for members
router.get(
  '/:idOrSlug/gallery/engagement',
  optionalAuthMiddleware,
  validateMiddleware(v.galleryEngagementSchema),
  c.getGalleryEngagement
);
router.post('/:idOrSlug/gallery/:postKey/like', authMiddleware, validateMiddleware(v.galleryPostSchema), c.likeGalleryPost);
router.delete(
  '/:idOrSlug/gallery/:postKey/like',
  authMiddleware,
  validateMiddleware(v.galleryPostSchema),
  c.unlikeGalleryPost
);
router.get(
  '/:idOrSlug/gallery/:postKey/comments',
  optionalAuthMiddleware,
  validateMiddleware(v.listGalleryCommentsSchema),
  c.listGalleryComments
);
router.post(
  '/:idOrSlug/gallery/:postKey/comments',
  authMiddleware,
  validateMiddleware(v.createGalleryCommentSchema),
  c.createGalleryComment
);
router.put(
  '/:idOrSlug/gallery/:postKey/comments/:commentId',
  authMiddleware,
  validateMiddleware(v.updateGalleryCommentSchema),
  c.updateGalleryComment
);
router.delete(
  '/:idOrSlug/gallery/:postKey/comments/:commentId',
  authMiddleware,
  validateMiddleware(v.galleryCommentIdSchema),
  c.deleteGalleryComment
);
router.get(
  '/:idOrSlug/gallery/:postKey/comments/:commentId/replies',
  optionalAuthMiddleware,
  validateMiddleware(v.listGalleryRepliesSchema),
  c.listGalleryReplies
);
router.post(
  '/:idOrSlug/gallery/:postKey/comments/:commentId/like',
  authMiddleware,
  validateMiddleware(v.galleryCommentIdSchema),
  c.likeGalleryComment
);
router.delete(
  '/:idOrSlug/gallery/:postKey/comments/:commentId/like',
  authMiddleware,
  validateMiddleware(v.galleryCommentIdSchema),
  c.unlikeGalleryComment
);
// Upcoming sessions of a group service (seats left when the business shows them)
router.get(
  '/:idOrSlug/group-sessions',
  validateMiddleware(v.publicGroupSessionsSchema),
  c.listPublicGroupSessions
);
// Attach a file before checkout (signed-in customers; questionnaire must allow it — checked at checkout)
router.post(
  '/:idOrSlug/booking-attachments',
  authMiddleware,
  attachmentUploadLimiter,
  validateMiddleware(v.uploadBookingAttachmentSchema),
  attachmentUpload.single('file'),
  handleAttachmentUploadError,
  c.uploadBookingAttachment
);
// Guests may book — auth is optional
router.post(
  '/:idOrSlug/bookings/checkout',
  optionalAuthMiddleware,
  validateMiddleware(v.createBookingCheckoutSchema),
  c.createBookingCheckout
);

// ─── Business-scoped (owner / team) ─────────────────────────────────────────
const scoped = (permission, schema) => [
  authMiddleware,
  validateMiddleware(schema),
  requireBusinessPermission(permission),
];

router.get('/:businessId/manage', ...scoped(P.VIEW, v.businessIdOnlySchema), c.getManagedBusiness);
router.patch('/:businessId', ...scoped(P.PROFILE_EDIT, v.updateBusinessSchema), c.updateBusiness);
router.patch(
  '/:businessId/policies',
  ...scoped(P.POLICIES_MANAGE, v.updatePoliciesSchema),
  c.updatePolicies
);
router.put(
  '/:businessId/booking-questions',
  ...scoped(P.SERVICES_MANAGE, v.updateBookingQuestionsSchema),
  c.updateBookingQuestions
);
router.delete('/:businessId', ...scoped(P.DELETE, v.businessIdOnlySchema), c.deleteBusiness);

// Services
router.post(
  '/:businessId/services',
  ...scoped(P.SERVICES_MANAGE, v.createServiceSchema),
  c.createService
);
// Sale on several services (before /:serviceId so "sale" isn't read as an id)
router.put(
  '/:businessId/services/sale',
  ...scoped(P.SERVICES_MANAGE, v.setServiceSaleSchema),
  c.setServiceSale
);
router.patch(
  '/:businessId/services/:serviceId',
  ...scoped(P.SERVICES_MANAGE, v.updateServiceSchema),
  c.updateService
);
router.delete(
  '/:businessId/services/:serviceId',
  ...scoped(P.SERVICES_MANAGE, v.serviceIdSchema),
  c.deleteService
);

// Add-ons and questionnaires (each saved as one list)
router.put('/:businessId/add-ons', ...scoped(P.SERVICES_MANAGE, v.saveAddOnsSchema), c.saveAddOns);
router.put(
  '/:businessId/questionnaires',
  ...scoped(P.SERVICES_MANAGE, v.saveQuestionnairesSchema),
  c.saveQuestionnaires
);

// Group sessions: schedule (host = own calendar for staff-role members), roster, capacity, cancel
router.get(
  '/:businessId/group-sessions/manage',
  ...scoped(P.BOOKINGS_VIEW, v.listGroupSessionsSchema),
  c.listGroupSessions
);
router.post(
  '/:businessId/group-sessions',
  ...scoped(P.SCHEDULE_MANAGE, v.createGroupSessionsSchema),
  c.createGroupSessions
);
router.patch(
  '/:businessId/group-sessions/:sessionId',
  ...scoped(P.SCHEDULE_MANAGE, v.updateGroupSessionSchema),
  c.updateGroupSession
);
router.post(
  '/:businessId/group-sessions/:sessionId/cancel',
  ...scoped(P.BOOKINGS_MANAGE, v.cancelGroupSessionSchema),
  c.cancelGroupSession
);

// Locations (branches): address, hours and timezone per branch
router.post('/:businessId/locations', ...scoped(P.PROFILE_EDIT, v.createLocationSchema), c.createLocation);
router.patch(
  '/:businessId/locations/:locationId',
  ...scoped(P.PROFILE_EDIT, v.updateLocationSchema),
  c.updateLocation
);
router.post(
  '/:businessId/locations/:locationId/primary',
  ...scoped(P.PROFILE_EDIT, v.locationIdSchema),
  c.makePrimaryLocation
);
router.delete(
  '/:businessId/locations/:locationId',
  ...scoped(P.PROFILE_EDIT, v.locationIdSchema),
  c.deleteLocation
);
// Closed dates (holidays, renovations) per location
router.post(
  '/:businessId/locations/:locationId/closures',
  ...scoped(P.SCHEDULE_MANAGE, v.addLocationClosureSchema),
  c.addLocationClosure
);
router.delete(
  '/:businessId/locations/:locationId/closures/:closureId',
  ...scoped(P.SCHEDULE_MANAGE, v.locationClosureIdSchema),
  c.removeLocationClosure
);

// Staff
router.post('/:businessId/staff', ...scoped(P.STAFF_MANAGE, v.createStaffSchema), c.createStaff);
router.patch(
  '/:businessId/staff/:staffId',
  ...scoped(P.STAFF_MANAGE, v.updateStaffSchema),
  c.updateStaff
);
router.delete(
  '/:businessId/staff/:staffId',
  ...scoped(P.STAFF_MANAGE, v.staffIdSchema),
  c.deleteStaff
);
// Schedule (staff-role members: own record only — enforced in service)
router.put(
  '/:businessId/staff/:staffId/schedule',
  ...scoped(P.SCHEDULE_MANAGE, v.updateStaffScheduleSchema),
  c.updateStaffSchedule
);
// Different weekly hours at each location (staff-role members: own record only)
router.put(
  '/:businessId/staff/:staffId/location-schedules',
  ...scoped(P.SCHEDULE_MANAGE, v.updateStaffLocationSchedulesSchema),
  c.updateStaffLocationSchedules
);
router.get(
  '/:businessId/staff/:staffId/date-overrides',
  ...scoped(P.SCHEDULE_MANAGE, v.staffIdSchema),
  c.getStaffDateOverrides
);
router.put(
  '/:businessId/staff/:staffId/date-overrides',
  ...scoped(P.SCHEDULE_MANAGE, v.upsertStaffDateOverridesSchema),
  c.upsertStaffDateOverrides
);

// Bookings (staff-role members only see / act on their own — enforced in service)
router.get(
  '/:businessId/bookings',
  ...scoped(P.BOOKINGS_VIEW, v.listBusinessBookingsSchema),
  c.listBusinessBookings
);
// Walk-in / phone booking added by the business
router.post(
  '/:businessId/bookings/manual',
  ...scoped(P.BOOKINGS_MANAGE, v.manualBookingSchema),
  c.createManualBooking
);
// Complete (optionally with extras collected in person) and check-in
router.post(
  '/:businessId/bookings/:bookingId/complete',
  ...scoped(P.BOOKINGS_MANAGE, v.completeBookingSchema),
  c.completeBooking
);
router.get(
  '/:businessId/bookings/:bookingId/attachments/:index',
  ...scoped(P.BOOKINGS_VIEW, v.businessAttachmentSchema),
  c.getBookingAttachmentForBusiness
);
router.post(
  '/:businessId/bookings/:bookingId/check-in',
  ...scoped(P.BOOKINGS_MANAGE, v.checkInSchema),
  c.checkInBooking
);
// Custom price offers (sent from the inquiry chat; listed for dashboard metrics)
router.post('/:businessId/offers', ...scoped(P.BOOKINGS_MANAGE, v.createCustomOfferSchema), c.createCustomOffer);
router.get('/:businessId/offers', ...scoped(P.BOOKINGS_VIEW, v.listCustomOffersSchema), c.listCustomOffers);
router.post(
  '/:businessId/offers/:offerId/withdraw',
  ...scoped(P.BOOKINGS_MANAGE, v.businessCustomOfferSchema),
  c.withdrawCustomOffer
);
for (const [action, handler] of [
  ['confirm', c.confirmBooking],
  ['decline', c.declineBooking],
  ['cancel', c.cancelBookingByBusiness],
  ['no-show', c.markBookingNoShow],
]) {
  router.post(
    `/:businessId/bookings/:bookingId/${action}`,
    ...scoped(P.BOOKINGS_MANAGE, v.businessBookingActionSchema),
    handler
  );
}
// Refund (owner / admin / manager — enforced in service) and reschedule
router.post(
  '/:businessId/bookings/:bookingId/refund',
  ...scoped(P.BOOKINGS_MANAGE, v.businessRefundSchema),
  c.refundBookingByBusiness
);
router.get(
  '/:businessId/bookings/:bookingId/reschedule-slots',
  ...scoped(P.BOOKINGS_MANAGE, v.businessRescheduleSlotsSchema),
  c.getBusinessRescheduleSlots
);
router.post(
  '/:businessId/bookings/:bookingId/reschedule',
  ...scoped(P.BOOKINGS_MANAGE, v.businessRescheduleSchema),
  c.rescheduleBookingByBusiness
);

// Reserve Now ($20/mo add-on for Food & Dining): billing is wallet-level, like commission
router.get(
  '/:businessId/reserve-now',
  ...scoped(P.VIEW, v.businessIdOnlySchema),
  c.getReserveNow
);
router.post(
  '/:businessId/reserve-now/checkout',
  ...scoped(P.WALLET_MANAGE, v.reserveNowCheckoutSchema),
  c.reserveNowCheckout
);
// In-app card form (web): intent → Stripe.js confirms → finalize
router.post(
  '/:businessId/reserve-now/native-intent',
  ...scoped(P.WALLET_MANAGE, v.reserveNowNativeIntentSchema),
  c.reserveNowNativeIntent
);
router.post(
  '/:businessId/reserve-now/native-finalize',
  ...scoped(P.WALLET_MANAGE, v.reserveNowNativeFinalizeSchema),
  c.reserveNowNativeFinalize
);
router.post(
  '/:businessId/reserve-now/confirm',
  ...scoped(P.WALLET_MANAGE, v.reserveNowConfirmSchema),
  c.reserveNowConfirm
);
router.post('/:businessId/reserve-now/cancel', ...scoped(P.WALLET_MANAGE, v.businessIdOnlySchema), c.reserveNowCancel);
router.post('/:businessId/reserve-now/resume', ...scoped(P.WALLET_MANAGE, v.businessIdOnlySchema), c.reserveNowResume);

// 5% commission on in-person payments: what's owed / collected, and paying it now
router.get(
  '/:businessId/commission',
  ...scoped(P.EARNINGS_VIEW, v.businessIdOnlySchema),
  c.getCommissionSummary
);
router.post(
  '/:businessId/commission/pay',
  ...scoped(P.WALLET_MANAGE, v.payCommissionSchema),
  c.payCommission
);
router.post(
  '/:businessId/commission/:collectionId/native-intent',
  ...scoped(P.WALLET_MANAGE, v.commissionNativeIntentSchema),
  c.commissionNativeIntent
);
router.post(
  '/:businessId/commission/:collectionId/native-finalize',
  ...scoped(P.WALLET_MANAGE, v.commissionNativeFinalizeSchema),
  c.commissionNativeFinalize
);

// Reviews (dashboard view works while unpublished, unlike the public list)
router.get(
  '/:businessId/manage/reviews',
  ...scoped(P.VIEW, v.listBusinessReviewsSchema),
  c.listBusinessReviews
);
router.put(
  '/:businessId/reviews/:reviewId/reply',
  ...scoped(P.REVIEWS_MANAGE, v.replyToReviewSchema),
  c.replyToReview
);

// Earnings for this business + the owner's (shared) wallet.
// Cash out / Stripe links are owner-only — enforced in the service.
router.get(
  '/:businessId/earnings',
  ...scoped(P.EARNINGS_VIEW, v.businessEarningsSchema),
  c.getEarnings
);
router.get(
  '/:businessId/earnings/payouts',
  ...scoped(P.EARNINGS_VIEW, v.businessPayoutHistorySchema),
  c.getPayoutHistory
);
router.get('/:businessId/wallet', ...scoped(P.WALLET_MANAGE, v.businessIdOnlySchema), c.getWallet);
router.post(
  '/:businessId/wallet/cashout',
  ...scoped(P.WALLET_MANAGE, v.businessCashOutSchema),
  c.cashOut
);
router.get(
  '/:businessId/wallet/stripe-dashboard',
  ...scoped(P.WALLET_MANAGE, v.businessIdOnlySchema),
  c.getStripeDashboardLink
);
router.get(
  '/:businessId/wallet/stripe-onboarding',
  ...scoped(P.WALLET_MANAGE, v.businessIdOnlySchema),
  c.getStripeOnboardingLink
);

// Team access
router.get('/:businessId/team', ...scoped(P.TEAM_MANAGE, v.businessIdOnlySchema), c.listTeam);
router.post(
  '/:businessId/team',
  ...scoped(P.TEAM_MANAGE, v.inviteTeamMemberSchema),
  c.inviteTeamMember
);
router.patch(
  '/:businessId/team/:memberId',
  ...scoped(P.TEAM_MANAGE, v.updateTeamMemberSchema),
  c.updateTeamMember
);
router.delete(
  '/:businessId/team/:memberId',
  ...scoped(P.TEAM_MANAGE, v.teamMemberIdSchema),
  c.revokeTeamMember
);

// Business inbox — the business side (owner, admins, managers)
router.get('/:businessId/inbox', ...scoped(P.INBOX_MANAGE, vi.listInboxSchema), inbox.listInbox);
router.get('/:businessId/inbox/unread-count', ...scoped(P.INBOX_MANAGE, vi.unreadInboxSchema), inbox.unreadInbox);
router.post(
  '/:businessId/inbox/conversations',
  ...scoped(P.INBOX_MANAGE, vi.openForBusinessSchema),
  inbox.openForBusiness
);
router.get(
  '/:businessId/inbox/:conversationId',
  ...scoped(P.INBOX_MANAGE, vi.inboxConversationSchema),
  inbox.getInboxConversation
);
router.post(
  '/:businessId/inbox/:conversationId',
  authMiddleware,
  inboxSendLimiter,
  validateMiddleware(vi.sendInboxSchema),
  requireBusinessPermission(P.INBOX_MANAGE),
  inbox.sendInbox
);
router.post(
  '/:businessId/inbox/:conversationId/read',
  ...scoped(P.INBOX_MANAGE, vi.readInboxSchema),
  inbox.readInbox
);

export default router;
