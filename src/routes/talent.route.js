import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  requireActiveSubscription,
  requireFeature,
} from '../middlewares/subscription.middleware.js';
import { FEATURES } from '../constants/features.js';
import {
  createTalentProfile,
  updateTalentProfile,
  listTalentProfiles,
  getTalentPriceBounds,
  getTalentProfile,
  getMyTalentProfile,
  upsertAvailability,
  getMyAvailability,
  getAvailability,
  getAvailableSlots,
  createSessionCheckout,
  bookSession,
  confirmSession,
  declineSession,
  cancelSession,
  recordJoin,
  acknowledgeRecording,
  listMySessions,
  getVideoRequests,
  getMyBookedEvents,
  getSession,
  getDashboardStats,
  submitReview,
  getSessionReview,
  listProfileReviews,
  submitReviewFromPriorityMessage,
  updateReview,
  reportReview,
  getMyReviews,
  getTalentProfileByUsername,
  rescheduleSession,
  getMyFavoriteIds,
  toggleFavorite,
  shareTalentProfile,
  saveSchedule,
  submitCallFeedback,
  endSession,
} from '../controllers/talent.controller.js';
import {
  createConnectAccount,
  getConnectStatus,
  getOnboardingLink,
  getStripeDashboardLink,
  getEarnings,
  getWallet,
  requestCashout,
  getPayouts,
  listPayoutMethods,
  addPayoutMethod,
  setDefaultPayoutMethod,
  deletePayoutMethod,
  listTransactions,
  getWalletSummary,
} from '../controllers/talentEarnings.controller.js';

const router = express.Router();

router.get('/', optionalAuthMiddleware, listTalentProfiles);
router.get('/price-bounds', getTalentPriceBounds);

router.post(
  '/me/profile',
  authMiddleware,
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('bio', { optional: true, scanText: true }),
  checkBlockedUrl('introVideoUrl', { optional: true }),
  checkBlockedUrl('socialLinks.instagram', { optional: true }),
  checkBlockedUrl('socialLinks.twitter', { optional: true }),
  checkBlockedUrl('socialLinks.facebook', { optional: true }),
  checkBlockedUrl('socialLinks.linkedin', { optional: true }),
  checkBlockedUrl('socialLinks.youtube', { optional: true }),
  createTalentProfile
);
router.put(
  '/me/profile',
  authMiddleware,
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('bio', { optional: true, scanText: true }),
  checkBlockedUrl('introVideoUrl', { optional: true }),
  checkBlockedUrl('socialLinks.instagram', { optional: true }),
  checkBlockedUrl('socialLinks.twitter', { optional: true }),
  checkBlockedUrl('socialLinks.facebook', { optional: true }),
  checkBlockedUrl('socialLinks.linkedin', { optional: true }),
  checkBlockedUrl('socialLinks.youtube', { optional: true }),
  updateTalentProfile
);
router.get('/me/profile', authMiddleware, getMyTalentProfile);

router.put('/me/availability', authMiddleware, upsertAvailability);
router.get('/me/availability', authMiddleware, getMyAvailability);
router.put('/me/schedule', authMiddleware, saveSchedule);

router.get('/sessions', authMiddleware, listMySessions);
router.get('/:username', optionalAuthMiddleware, getTalentProfileByUsername);

router.get(
  '/me/video-requests',
  authMiddleware,
  requireFeature(FEATURES.VIDEO_BOOKING),
  getVideoRequests
);
router.get('/me/booked-events', authMiddleware, getMyBookedEvents);
router.get('/me/dashboard-stats', authMiddleware, requireActiveSubscription, getDashboardStats);
router.get('/me/favorites/ids', authMiddleware, getMyFavoriteIds);
router.get('/me/reviews', authMiddleware, getMyReviews);

router.post('/me/stripe/connect', authMiddleware, createConnectAccount);
router.get('/me/stripe/connect/status', authMiddleware, getConnectStatus);
router.get('/me/stripe/connect/link', authMiddleware, getOnboardingLink);
router.get('/me/stripe/connect/dashboard', authMiddleware, getStripeDashboardLink);

router.get('/me/earnings', authMiddleware, requireActiveSubscription, getEarnings);

router.get('/me/wallet', authMiddleware, getWallet);
router.get('/me/wallet/summary', authMiddleware, getWalletSummary);
router.get('/me/wallet/transactions', authMiddleware, listTransactions);
router.post('/me/wallet/cashout', authMiddleware, requestCashout);
router.get('/me/wallet/payouts', authMiddleware, getPayouts);

router.get('/me/payout-methods', authMiddleware, listPayoutMethods);
router.post('/me/payout-methods', authMiddleware, addPayoutMethod);
router.put('/me/payout-methods/:methodId/default', authMiddleware, setDefaultPayoutMethod);
router.delete('/me/payout-methods/:methodId', authMiddleware, deletePayoutMethod);

router.post('/sessions/checkout', authMiddleware, createSessionCheckout);
router.post('/sessions/book', authMiddleware, bookSession);

router.get('/sessions/:sessionId', authMiddleware, getSession);
router.put(
  '/sessions/:sessionId/confirm',
  authMiddleware,
  requireFeature(FEATURES.VIDEO_BOOKING),
  confirmSession
);
router.put(
  '/sessions/:sessionId/decline',
  authMiddleware,
  requireFeature(FEATURES.VIDEO_BOOKING),
  declineSession
);
router.put('/sessions/:sessionId/cancel', authMiddleware, cancelSession);
router.post('/sessions/:sessionId/join', authMiddleware, recordJoin);
router.post(
  '/sessions/:sessionId/acknowledge-recording',
  authMiddleware,
  acknowledgeRecording
);
router.post('/sessions/:sessionId/end', authMiddleware, endSession);
router.post('/sessions/:sessionId/reschedule', authMiddleware, rescheduleSession);
router.post('/sessions/:sessionId/review', authMiddleware, submitReview);
router.get('/sessions/:sessionId/review', authMiddleware, getSessionReview);
router.post('/sessions/:sessionId/call-feedback', authMiddleware, submitCallFeedback);

router.post(
  '/priority-messages/:paymentId/review',
  authMiddleware,
  submitReviewFromPriorityMessage
);
router.patch('/reviews/:reviewId', authMiddleware, updateReview);
router.post('/reviews/:reviewId/report', authMiddleware, reportReview);

router.get('/:profileId', optionalAuthMiddleware, getTalentProfile);
router.get('/:profileId/availability', getAvailability);
router.get('/:profileId/slots', getAvailableSlots);
router.get('/:profileId/reviews', listProfileReviews);
router.post('/:profileId/favorite', authMiddleware, toggleFavorite);
router.post('/:profileId/share', optionalAuthMiddleware, shareTalentProfile);

export default router;