import express from 'express';
import { trackEvents, triggerRollup } from '../controllers/analyticsTrack.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { analyticsTrackLimiter, analyticsRollupTriggerLimiter } from '../middlewares/rateLimiter.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { trackEventsSchema } from '../validations/analyticsTrack.validation.js';

const router = express.Router();

// Public, anonymous-tolerant write path — kept separate from analytics.route.js
// (organizer/event-scoped reads, which require auth).
router.post(
  '/track',
  optionalAuthMiddleware,
  analyticsTrackLimiter,
  validateMiddleware(trackEventsSchema),
  trackEvents
);

// "Refresh live data" button on owner-facing analytics views — requires auth
// since it does real (if cheap) aggregation work.
router.post('/rollup/run', authMiddleware, analyticsRollupTriggerLimiter, triggerRollup);

export default router;
