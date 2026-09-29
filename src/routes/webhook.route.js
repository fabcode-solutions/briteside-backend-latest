import express from 'express';
import stripeWebhookHandler from '../controllers/webhook.controller.js';
import { streamWebhookHandler } from '../controllers/streamWebhook.controller.js';
import { appleIapWebhook, googlePlayWebhook } from '../controllers/iapWebhook.controller.js';

const router = express.Router();

// Stripe webhook endpoint expects raw body; we'll use the raw parser here when mounting
router.post('/stripe', stripeWebhookHandler);

// Stream Video webhook — raw body required for signature verification
router.post('/stream', streamWebhookHandler);

// App Store Server Notifications V2 (refunds / revocations of in-app purchases)
router.post('/apple-iap', appleIapWebhook);

// Google Play real-time developer notifications (Cloud Pub/Sub push)
router.post('/google-play', googlePlayWebhook);

export default router;
