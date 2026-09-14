import { TicketService } from '../services/ticket.service.js';
import { EventTeamService } from '../services/eventTeam.service.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const purchaseTickets = catchAsync(async (req, res) => {
  const { purchases, holderInfo } = req.body;

  if (!purchases || !Array.isArray(purchases) || purchases.length === 0) {
    throw new ApiError(400, 'Invalid purchase data');
  }

  if (!holderInfo?.name || !holderInfo?.phone) {
    throw new ApiError(400, 'Holder name and phone number required');
  }

  const purchaseData = purchases.map(purchase => ({
    eventId: purchase.eventId,
    ticketTierId: purchase.ticketId,
    quantity: purchase.quantity,
    eventScheduleId: purchase.eventScheduleId, // Optional: session ID for multi-day events
    holderName: holderInfo.name,
    holderEmail: holderInfo.email || null,
    holderPhone: holderInfo.phone,
  }));

  const result = await TicketService.purchaseTickets(req.user.id, purchaseData);

  res.json({
    success: true,
    data: {
      tickets: result.tickets,
      event: result.event,
    },
  });
});

export const verifyTicket = catchAsync(async (req, res) => {
  const result = await TicketService.verifyTicket(req.body);

  res.json({
    success: true,
    data: result,
  });
});

export const getUserTickets = catchAsync(async (req, res) => {
  const { status } = req.query;
  const tickets = await TicketService.getUserTickets(req.user.id, { status });

  res.json({
    success: true,
    data: { tickets },
  });
});

// ---------------------------------------------------------------------------
// Organizer-only endpoints
// ---------------------------------------------------------------------------

export const getOrganizerEventTickets = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const filters = {
    search: req.query.search,
    page: req.query.page,
    limit: req.query.limit,
  };

  let result;
  if (req.user?.organizerId) {
    result = await TicketService.getOrganizerEventTickets(req.user.organizerId, eventId, filters);
  } else {
    // Permission already verified by requireEventPermission middleware on this route.
    if (!req.teamMember) {
      throw new ApiError(403, 'Organizer profile required');
    }
    result = await TicketService.getOrganizerEventTickets(null, eventId, filters, {
      isAdmin: true,
    });
  }

  res.json({ success: true, data: result });
});

export const getOrganizerAllSales = catchAsync(async (req, res) => {
  const filters = {
    search: req.query.search,
    page: req.query.page,
    limit: req.query.limit,
    eventId: req.query.eventId,
  };

  let result;
  if (req.user?.organizerId) {
    result = await TicketService.getOrganizerAllSales(req.user.organizerId, filters);
  } else {
    const eventId = req.query.eventId;
    if (!req.teamMember || !eventId) {
      throw new ApiError(403, 'Organizer profile required');
    }

    const allowed = await EventTeamService.hasPermission({
      teamMemberId: req.teamMember.id,
      eventId,
      permissionKey: PERMISSIONS.ANALYTICS_VIEW_SALES,
    });

    if (!allowed) {
      throw new ApiError(403, 'Not authorized to view organizer sales');
    }

    result = await TicketService.getOrganizerAllSales(null, filters);
  }

  res.json({ success: true, data: result });
});

export const issueTicketForUser = catchAsync(async (req, res) => {
  if (!req.user.organizerId) {
    throw new ApiError(403, 'Organizer profile required');
  }

  const { eventId, ticketTierId, identifier } = req.body;
  if (!eventId || !ticketTierId || !identifier) {
    throw new ApiError(
      400,
      'eventId, ticketTierId, and identifier (userId / email / phone) are required'
    );
  }

  const result = await TicketService.issueTicketForUser(req.user.organizerId, req.body);

  res.status(201).json({
    success: true,
    message: 'Ticket issued successfully and confirmation email sent',
    data: { tickets: result.tickets, event: result.event },
  });
});
