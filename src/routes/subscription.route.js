import express from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { subscriptionController } from '../controllers/subscription.controller.js';

const router = express.Router();

// Validation middleware
const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    const message = error.errors?.map(e => e.message).join(', ') || 'Validation error';
    return res.status(400).json({ success: false, message });
  }
};

// ─── VALIDATION SCHEMAS ──────────────────────────────────────────────────────

const checkoutSchema = z.object({
  planId: z.string().uuid('Plan ID must be a valid UUID'),
  successUrl: z.string().min(1, 'successUrl is required'),
  cancelUrl: z.string().min(1, 'cancelUrl is required'),
});

const portalSchema = z.object({
  returnUrl: z.string().url('Return URL must be a valid URL'),
});

// ─── PUBLIC ROUTES ───────────────────────────────────────────────────────────

// Get all active subscription plans (public)
router.get('/plans', subscriptionController.getPlans);

// ─── AUTHENTICATED ROUTES ────────────────────────────────────────────────────

// Create Stripe Checkout session
router.post(
  '/checkout',
  authMiddleware,
  validate(checkoutSchema),
  subscriptionController.createCheckoutSession
);

// Get Stripe Customer Portal session
router.post(
  '/portal',
  authMiddleware,
  validate(portalSchema),
  subscriptionController.getCustomerPortalSession
);

// Get current subscription
router.get('/me', authMiddleware, subscriptionController.getMySubscription);

// Get subscription history
router.get('/me/history', authMiddleware, subscriptionController.getMySubscriptionHistory);

// Cancel subscription
router.post('/me/cancel', authMiddleware, subscriptionController.cancelMySubscription);

// Get all group subscriptions for the current user
router.get('/my-groups', authMiddleware, subscriptionController.getMyGroupSubscriptions);

export default router;
