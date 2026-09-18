/**
 *
 * Route order matters:
 *   1. /webhook must be FIRST with raw body parser — no auth
 *   2. All other routes use authMiddleware
 */

import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { requireFeature } from '../middlewares/subscription.middleware.js';
import { FEATURES } from '../constants/features.js';
import {
  createCheckout,
  stripeWebhook,
  getPaymentStatus,
  getReceivedMessages,
  getPriorityConversations,
  getConversationBanner,
  getConversationSpend,
  getTalentProfileForConversation,
  getTotalEarned,
  getTotalSpent,
  markAttachmentViewed,
    getItemStatuses,
    getPendingStatus,
} from '../controllers/priorityMessage.controller.js';

const router = express.Router();

// ── 1. Stripe webhook — raw body, NO auth ────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// ── 2. Auth-protected routes ──────────────────────────────────────────────────
router.use(authMiddleware);

// Customer sends a priority message — no Plus required (paying per message)
router.post('/', createCheckout);
// Proactive check before the sender even fills out the form — lets the
// talent-profile "Send Message" dialog warn about an outstanding pending
// message immediately, instead of only failing at checkout submission.
router.get('/pending/:talentProfileId', getPendingStatus);
// Customer polls their own payment status
router.get('/:paymentId/status', getPaymentStatus);
// Talent reads received messages — requires priority_messaging feature
router.get('/received', requireFeature(FEATURES.PRIORITY_MESSAGING), getReceivedMessages);
router.get('/conversations', requireFeature(FEATURES.PRIORITY_MESSAGING), getPriorityConversations);
router.get(
  '/conversations/:conversationId/banner',
  requireFeature(FEATURES.PRIORITY_MESSAGING),
  getConversationBanner
);
router.get(
  '/conversations/:conversationId/item-statuses',
  requireFeature(FEATURES.PRIORITY_MESSAGING),
  getItemStatuses
);

router.get('/conversations/:conversationId/talent-profile', getTalentProfileForConversation);
router.get('/conversations/:conversationId/spent', getConversationSpend);

router.get('/spend/total', getTotalSpent);

router.get('/earnings/total', requireFeature(FEATURES.PRIORITY_MESSAGING), getTotalEarned);

// Talent marks an attachment as viewed (talent-only, called when they open/download a file)
router.post('/attachments/:attachmentId/viewed', markAttachmentViewed);

export default router;
