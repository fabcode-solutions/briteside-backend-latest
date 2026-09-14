import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  requireEventPermission,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
} from '../middlewares/eventAccess.middleware.js';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  enableDoorSales,
  disableDoorSales,
  regenerateDoorSales,
  getDoorSalesConfig,
  setDoorSaleTierPrices,
  getEventGuestOrders,
  getEventGuestTickets,
} from '../controllers/doorSales.controller.js';
import {
  getDoorSalesByToken,
  checkoutDoorSales,
  getGuestTicketBundle,
  getGuestTicketByCode,
} from '../controllers/doorSalesPublic.controller.js';

const router = express.Router();

const doorSalesCheckoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Organizer / team-only routes
router.post(
  '/:eventId/enable',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  enableDoorSales
);
router.post(
  '/:eventId/disable',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  disableDoorSales
);
router.post(
  '/:eventId/regenerate-qr',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  regenerateDoorSales
);
router.get(
  '/:eventId/config',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  getDoorSalesConfig
);
router.put(
  '/:eventId/tiers',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  setDoorSaleTierPrices
);
router.get(
  '/:eventId/orders',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  getEventGuestOrders
);
router.get(
  '/:eventId/guest-tickets',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission('event.manage_door_sales'),
  getEventGuestTickets
);

// Public routes
router.get('/token/:token', getDoorSalesByToken);
router.post('/token/:token/checkout', doorSalesCheckoutLimiter, checkoutDoorSales);
router.get('/order/:orderId', getGuestTicketBundle);
router.get('/ticket/:ticketCode', getGuestTicketByCode);

export default router;
