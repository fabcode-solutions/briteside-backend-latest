import express from 'express';
import {
  getOrganizerOverview,
  getEventAnalytics,
  getOrganizerEvents,
  getEventSalesAnalytics,
  getEventAudienceAnalytics,
  getTicketPerformanceAnalytics,
  getEventEngagementAnalytics,
} from '../controllers/analytics.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission,
} from '../middlewares/eventAccess.middleware.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';

const router = express.Router();

// Organizer overview analytics (organizer-level only)
router.get('/overview', authMiddleware, getOrganizerOverview);

// Organizer events with basic analytics (organizer-level only)
router.get('/events', authMiddleware, getOrganizerEvents);

// Event-level analytics: allow organizer users or event team members
router.get(
  '/events/:eventId',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getEventAnalytics
);

router.get(
  '/events/:eventId/sales',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getEventSalesAnalytics
);

router.get(
  '/events/:eventId/audience',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getEventAudienceAnalytics
);

router.get(
  '/events/:eventId/tickets',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getTicketPerformanceAnalytics
);

router.get(
  '/events/:eventId/engagement',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getEventEngagementAnalytics
);
export default router;
