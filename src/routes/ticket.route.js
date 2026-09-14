import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  eventAccessMiddleware,
  requireEventPermission,
  teamMemberAuthMiddleware,
} from '../middlewares/eventAccess.middleware.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';
import {
  purchaseTickets,
  verifyTicket,
  getUserTickets,
  getOrganizerEventTickets,
  getOrganizerAllSales,
  issueTicketForUser,
} from '../controllers/ticket.controller.js';

const router = express.Router();

// Protected routes
router.post('/purchase', authMiddleware, purchaseTickets);
router.post('/verify', authMiddleware, verifyTicket);
router.get('/user', authMiddleware, getUserTickets);

// Organizer-only / event team routes
// GET  /tickets/organizer/event/:eventId  — sold tickets for a specific event (with buyer info + search)
// GET  /tickets/organizer/sales           — all sold tickets across organizer's events
// POST /tickets/organizer/issue           — manually issue a ticket to a registered user
router.get(
  '/organizer/sales',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  getOrganizerAllSales
);
router.get(
  '/organizer/event/:eventId',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ANALYTICS_VIEW_SALES),
  getOrganizerEventTickets
);
router.post('/organizer/issue', authMiddleware, issueTicketForUser);

export default router;
