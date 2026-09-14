import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  getPendingPrompts,
  submitEventReview,
  getEventReviews,
  markReviewHelpful,
  dismissPrompt,
  createReviewPrompts,
} from '../controllers/review.controller.js';

const router = express.Router();

// Public routes
router.get('/events/:eventId/reviews', getEventReviews);

// Protected routes
router.use(authMiddleware);

router.get('/prompts/pending', getPendingPrompts);
router.post('/events/:eventId/reviews', submitEventReview);
router.post('/reviews/:reviewId/helpful', markReviewHelpful);
router.post('/events/:eventId/dismiss-prompt', dismissPrompt);

// Admin route for creating prompts (can be called by cron job)
router.post('/events/:eventId/create-prompts', createReviewPrompts);

export default router;
