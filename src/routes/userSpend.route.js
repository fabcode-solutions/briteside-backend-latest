import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  getSummary,
  getTimeline,
  getEventSpend,
  getActiveSubscriptions,
  getRecentSpends,
} from '../controllers/userSpend.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/summary', getSummary);
router.get('/timeline', getTimeline);
router.get('/events/:eventId', getEventSpend);
router.get('/subscriptions', getActiveSubscriptions);
router.get('/recent', getRecentSpends);

export default router;
