import express from 'express';
import { TicketScanningController } from '../controllers/ticketScanning.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Member authentication (public for scanning app)
router.post('/auth', TicketScanningController.authenticateMember);

// Session management (public for scanning app)
router.post('/session/start', TicketScanningController.startScanSession);
router.post('/session/end', TicketScanningController.endScanSession);

// Ticket scanning (public for scanning app)
router.post('/scan', TicketScanningController.scanTicket);

// Ticket verification without scanning (public for preview)
router.post('/verify', TicketScanningController.verifyTicket);

// Full ticket details for staff — skips the event-ended/check-in-window
// gates scanTicket() enforces, so it works after the event has ended
// (member-authenticated in the body, same as /scan, hence no authMiddleware)
router.post('/ticket-details', TicketScanningController.getTicketDetails);

// Attendee search + manual check-in (public for scanning app; event-scoped in service)
router.post('/search', TicketScanningController.searchAttendees);
router.post('/manual-check-in', TicketScanningController.manualCheckIn);

// Protected routes (require organizer authentication)
router.get('/events/:eventId/history', authMiddleware, TicketScanningController.getScanHistory);
router.get('/members/:memberId/stats', authMiddleware, TicketScanningController.getMemberScanStats);

export default router;
