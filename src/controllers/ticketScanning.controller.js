import { TicketScanningService } from '../services/ticketScanning.service.js';
import ApiError from '../utils/api-error.js';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { events } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
export class TicketScanningController {
  /**
   * Authenticate organizer member
   */
  static async authenticateMember(req, res, next) {
    try {
      const { memberCode, memberPassword } = req.body;

      if (!memberCode || !memberPassword) {
        throw new ApiError(400, 'Member code and password are required');
      }

      const member = await TicketScanningService.authenticateMember(memberCode, memberPassword);

      res.status(200).json({
        success: true,
        data: member,
        message: 'Authentication successful',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Scan ticket with comprehensive validation and audit
   */
  static async scanTicket(req, res, next) {
    try {
      const {
        qrCodeData,
        memberCode,
        teamMemberId,
        organizerId: directOrganizerId,
        scanLocation,
        scanType = 'entry',
        deviceInfo = {},
        geoLocation = {},
        sessionId,
      } = req.body;

      if (!qrCodeData || (!memberCode && !teamMemberId && !directOrganizerId)) {
        throw new ApiError(
          400,
          'QR code data and member code, teamMemberId, or organizerId are required'
        );
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      const result = await TicketScanningService.scanTicket({
        qrCodeData,
        memberCode,
        teamMemberId,
        organizerId: directOrganizerId,
        scanLocation,
        scanType,
        deviceInfo,
        geoLocation,
        ipAddress,
        userAgent,
        sessionId,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: 'Ticket scanned successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Read-only ticket details lookup, skipping the check-in-window / event-
   * ended / already-used gates scanTicket() enforces. Used when scanTicket()
   * rejects a scan with "Event has already ended" so staff can still see the
   * full ticket + order + scan-history detail for that ticket.
   */
  static async getTicketDetails(req, res, next) {
    try {
      const { qrCodeData, memberCode, teamMemberId, organizerId: directOrganizerId } = req.body;

      if (!qrCodeData || (!memberCode && !teamMemberId && !directOrganizerId)) {
        throw new ApiError(
          400,
          'QR code data and member code, teamMemberId, or organizerId are required'
        );
      }

      const result = await TicketScanningService.getTicketDetails({
        qrCodeData,
        memberCode,
        teamMemberId,
        organizerId: directOrganizerId,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: 'Ticket details retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get scan history for an event (protected - only organizer)
   */
  static async getScanHistory(req, res, next) {
    try {
      const { eventId } = req.params;
      const { page = 1, limit = 50, memberId, isValid } = req.query;

      // Always resolve organizerId from the event — user's organizerId may differ
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { organizerId: true },
      });

      const organizerId = event?.organizerId;
      if (!organizerId) {
        throw new ApiError(404, 'Event not found');
      }

      const history = await TicketScanningService.getScanHistory(eventId, organizerId, {
        page: parseInt(page),
        limit: parseInt(limit),
        memberId,
        isValid: isValid !== undefined ? isValid === 'true' : undefined,
      });
      console.log(history, 'history');
      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get member scan statistics (protected - only organizer)
   */
  static async getMemberScanStats(req, res, next) {
    try {
      const { memberId } = req.params;

      // Verify organizer ownership
      const organizerId = req.user.organizerId;
      if (!organizerId) {
        throw new ApiError(403, 'Organizer access required');
      }

      const stats = await TicketScanningService.getMemberScanStats(organizerId, memberId);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Start scan session (placeholder)
   */
  static async startScanSession(req, res, next) {
    try {
      const { memberCode, memberPassword, eventId = null, deviceInfo = {} } = req.body;

      if (!memberCode || !memberPassword) {
        throw new ApiError(400, 'Member code and password are required to start a session');
      }

      const session = await TicketScanningService.startSession({
        memberCode,
        memberPassword,
        eventId,
        deviceInfo,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
      });

      res.status(200).json({
        success: true,
        data: { sessionId: session.id },
        message: 'Session started',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * End scan session (placeholder)
   */
  static async endScanSession(req, res, next) {
    try {
      const { sessionId } = req.body;
      if (!sessionId) throw new ApiError(400, 'sessionId is required');

      await TicketScanningService.endSession(sessionId);

      res.status(200).json({
        success: true,
        message: 'Session ended',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify ticket without scanning (for preview)
   */
  static async verifyTicket(req, res, next) {
    try {
      const { qrCodeData } = req.body;

      if (!qrCodeData) {
        throw new ApiError(400, 'QR code data is required');
      }

      // This is a read-only verification without updating scan status
      const result = await TicketScanningService.verifyTicketOnly(qrCodeData);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Ticket verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search attendees by name/email/phone for manual check-in
   */
  static async searchAttendees(req, res, next) {
    try {
      const { eventId, query, memberCode, teamMemberId, organizerId } = req.body;

      const data = await TicketScanningService.searchAttendees({
        eventId,
        query,
        memberCode,
        teamMemberId,
        organizerId,
      });

      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manually check in selected tickets by id
   */
  static async manualCheckIn(req, res, next) {
    try {
      const {
        eventId,
        ticketIds,
        guestTicketIds,
        memberCode,
        teamMemberId,
        organizerId,
        deviceInfo,
      } = req.body;

      const data = await TicketScanningService.manualCheckIn({
        eventId,
        ticketIds,
        guestTicketIds,
        memberCode,
        teamMemberId,
        organizerId,
        deviceInfo,
      });

      res.status(200).json({ success: true, data, message: 'Manual check-in processed' });
    } catch (error) {
      next(error);
    }
  }
}
