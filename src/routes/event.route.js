import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  createEvent,
  getDiscoverEvents,
  getMyEvents,
  getAccessibleEvents,
  getMemberEvents,
  getEventById,
  getEventBySlug,
  updateEvent,
  deleteEvent,
  publishEvent,
  cancelEvent,
  getEventAnalytics,
  getEventTickets,
  joinEvent,
  purchaseTickets,
  getUserEventStatus,
  startTicketSale,
  endTicketSale,
  getEventTicketSales,
  updateSessionInventory,
} from '../controllers/event.controller.js';
import { toggleEventLike, getEventLikeStatus } from '../controllers/eventLike.controller.js';
import {
  inviteAllFollowers,
  getFollowerInviteStats,
} from '../controllers/eventInvitation.controller.js';
import {
  getMarketingSettings,
  updateMarketingSettings,
  getPublicPixelConfig,
} from '../controllers/eventMarketing.controller.js';
import {
  listTrackingLinks,
  createTrackingLink,
  getTrackingMetrics,
  deleteTrackingLink,
  resolveTrackingLinkCode,
  recordTrackingClick,
  redirectTrackingLink,
} from '../controllers/trackingLink.controller.js';
import { teamMemberAuthMiddleware } from '../middlewares/eventAccess.middleware.js';
import eventTeamRoute from './eventTeam.route.js';
import blastRoute from './blast.route.js';

const router = express.Router();

// ── Public routes (no auth) ───────────────────────────────────────────────────
router.get('/discover', optionalAuthMiddleware, getDiscoverEvents);
router.get('/accessible', optionalAuthMiddleware, teamMemberAuthMiddleware, getAccessibleEvents);
router.get('/member-events', authMiddleware, getMemberEvents);
router.get('/slug/:slug', getEventBySlug);
router.get('/:slug/tracking-links/redirect/:code', redirectTrackingLink);
router.get('/:slug/tracking-links/resolve/:code', resolveTrackingLinkCode);

router.post('/:slug/tracking-links/:linkId/click', optionalAuthMiddleware, recordTrackingClick);
router.get('/:eventId/tickets', getEventTickets);
router.get('/:eventId/marketing/public', getPublicPixelConfig);

router.use('/:eventId/teams', eventTeamRoute);
router.use('/:eventId/blasts', blastRoute);

// Protected routes
router.use(authMiddleware);

router.post(
  '/',
  // These are free-text fields that may merely CONTAIN a link — not URL
  // fields themselves — so they need scanText: true. Passing the field
  // itself to `new URL()` (the default, strict mode) rejects any normal
  // title/description that isn't a bare URL.
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('shortDescription', { optional: true, scanText: true }),
  checkBlockedUrl('location', { optional: true, scanText: true }),
  // youtubeVideoUrl IS a URL field — keep strict validation
  checkBlockedUrl('youtubeVideoUrl', { optional: true }),
  createEvent
);

router.get('/my', getMyEvents);

router.get('/:slug/tracking-links', listTrackingLinks);
router.post('/:slug/tracking-links', checkBlockedUrl('destinationUrl'), createTrackingLink);
router.get('/:slug/tracking-links/:linkId/metrics', getTrackingMetrics);
router.delete('/:slug/tracking-links/:linkId', deleteTrackingLink);

// ── Parameterized event routes (after all named routes) ───────────────────────
router.get('/:eventId', getEventById);

router.put(
  '/:eventId',
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('shortDescription', { optional: true, scanText: true }),
  checkBlockedUrl('location', { optional: true, scanText: true }),
  checkBlockedUrl('youtubeVideoUrl', { optional: true }),
  updateEvent
);

router.delete('/:eventId', deleteEvent);
router.post('/:eventId/publish', publishEvent);
router.post('/:eventId/cancel', cancelEvent);
router.get('/:eventId/analytics', getEventAnalytics);
router.get('/:eventId/user-status', getUserEventStatus);
router.post('/:eventId/like', toggleEventLike);
router.get('/:eventId/like-status', getEventLikeStatus);
router.post('/join', joinEvent);
router.post('/purchase-tickets', purchaseTickets);

router.get('/:eventId/tickets/sales', getEventTicketSales);
router.post('/:eventId/tickets/:ticketTierId/sale', startTicketSale);
router.delete('/:eventId/tickets/:ticketTierId/sale', endTicketSale);
router.patch('/:eventId/tickets/:ticketTierId/session-inventory', updateSessionInventory);

router.post('/:eventId/invite-followers', inviteAllFollowers);
router.get('/:eventId/invite-followers/stats', getFollowerInviteStats);

router.get('/:eventId/marketing', getMarketingSettings);
router.put('/:eventId/marketing', updateMarketingSettings);

export default router;
