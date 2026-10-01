import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  eventAccessMiddleware,
  requireEventPermission,
  teamMemberAuthMiddleware,
} from '../middlewares/eventAccess.middleware.js';
import {
  createCheckoutSession,
  getPublishableKey,
  checkRefundEligibility,
  applyRefund,
  getRefundDetails,
  listRefunds,
  listOrganizerRefunds,
  updateRefund,
} from '../controllers/payment.controller.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';

const router = express.Router();

// Public route for publishable key
router.get('/config', getPublishableKey);

// Protected route: create a Stripe Checkout Session for an order
router.post('/create-checkout-session', authMiddleware, createCheckoutSession);
// Refund endpoints
router.get('/orders/:orderId/refund-eligibility', authMiddleware, checkRefundEligibility);
router.post('/orders/:orderId/refund', authMiddleware, teamMemberAuthMiddleware, applyRefund);
router.post(
  '/orders/:orderId/apply-refund',
  authMiddleware,
  teamMemberAuthMiddleware,
  updateRefund
);
router.get(
  '/refunds/:refundId',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  getRefundDetails
);
// User fetching their own refunds (no organizer/team-member guards)
router.get('/my-refunds', authMiddleware, listRefunds);

// Organizer fetching refunds for their event — no team-member permission required
router.get('/organizer/refunds', authMiddleware, listOrganizerRefunds);

router.get(
  '/refunds',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ORDERS_REFUND),
  listRefunds
);

export default router;
