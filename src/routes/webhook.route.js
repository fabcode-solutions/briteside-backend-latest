import express from 'express';
import stripeWebhookHandler from '../controllers/webhook.controller.js';
import { streamWebhookHandler } from '../controllers/streamWebhook.controller.js';

const router = express.Router();

// Stripe webhook endpoint expects raw body; we'll use the raw parser here when mounting
router.post('/stripe', stripeWebhookHandler);

// Stream Video webhook — raw body required for signature verification
router.post('/stream', streamWebhookHandler);

export default router;
