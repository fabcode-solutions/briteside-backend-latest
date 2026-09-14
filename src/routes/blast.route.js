import express from 'express';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission,
} from '../middlewares/eventAccess.middleware.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';
import {
  sendSmsBlast,
  sendEmailBlast,
  listBlasts,
  getBlastStats,
} from '../controllers/blast.controller.js';

const router = express.Router({ mergeParams: true });

// Resolve caller identity (regular user OR team member token) and load event
router.use(optionalAuthMiddleware, teamMemberAuthMiddleware, eventAccessMiddleware);

// GET /events/:eventId/blasts/stats  — daily usage vs limits
router.get('/stats', requireEventPermission(PERMISSIONS.BLASTS_VIEW_SMS), getBlastStats);

// GET /events/:eventId/blasts  — blast history
router.get('/', requireEventPermission(PERMISSIONS.BLASTS_VIEW_SMS), listBlasts);

// POST /events/:eventId/blasts/sms  — send SMS to all attendees
router.post('/sms', requireEventPermission(PERMISSIONS.BLASTS_SEND_SMS), sendSmsBlast);

// POST /events/:eventId/blasts/email  — send email to all attendees
router.post('/email', requireEventPermission(PERMISSIONS.BLASTS_SEND_SMS), sendEmailBlast);

export default router;
