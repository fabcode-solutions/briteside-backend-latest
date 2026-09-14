import { EventService } from '../services/event.service.js';
import { OrganizerService } from '../services/organizer.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';

export const createEvent = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;

  if (!organizerId) {
    throw new ApiError(400, 'Organizer profile required to create events');
  }

  const event = await EventService.createEvent(organizerId, req.body);
  await OrganizerService.incrementEventCount(req.user.id);

  res.status(201).json({
    success: true,
    message: 'Event created successfully',
    data: { event },
  });
});

export const getDiscoverEvents = catchAsync(async (req, res) => {
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 12,
    categoryId: req.query.categoryId,
    search: req.query.search,
    timeFilter: req.query.timeFilter,
    // New enhanced filters
    location: req.query.location,
    city: req.query.city,
    state: req.query.state,
    country: req.query.country,
    dateRange: req.query.dateRange,
    priceFilter: req.query.priceFilter,
    eventMode: req.query.eventMode,
    eventType: req.query.eventType,
    // Distance filters
    lat: req.query.lat ? parseFloat(req.query.lat) : undefined,
    lng: req.query.lng ? parseFloat(req.query.lng) : undefined,
    distance: req.query.distance,
  };
  const userId = req.user?.id ?? null;
  const result = await EventService.getDiscoverEvents(filters, userId);

  res.json({
    success: true,
    data: result,
  });
});

export const getMyEvents = catchAsync(async (req, res) => {
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 12,
    timeFilter: req.query.timeFilter || 'all',
    organizerId: req.query.organizerId,
    status: req.query.eventStatus,
    location: req.query.location,
    dateRange: req.query.dateRange,
    priceFilter: req.query.priceFilter,
    eventMode: req.query.eventMode,
    signedUp: req.query.signedUp,
    liked: req.query.liked,
    lat: req.query.lat ? parseFloat(req.query.lat) : undefined,
    lng: req.query.lng ? parseFloat(req.query.lng) : undefined,
    distance: req.query.distance,
  };

  const result = await EventService.getMyEvents(req.user.id, filters);

  res.json({
    success: true,
    data: result,
  });
});

export const getAccessibleEvents = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;
  const organizerId = req.user?.organizerId || null;
  const roles = req.user?.roles || [];
  const teamMemberId = req.teamMember?.id || null;

  if (!userId && !teamMemberId) {
    throw new ApiError(401, 'Authentication required to fetch accessible events');
  }

  const events = await EventService.getAccessibleEvents({
    userId,
    organizerId,
    roles,
    teamMemberId,
  });

  res.json({ success: true, data: events });
});

export const getMemberEvents = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;
  const teamMemberId = req.teamMember?.id || null;

  if (!userId) {
    throw new ApiError(401, 'Authentication required to fetch member events');
  }

  const memberships = await EventService.getMemberEvents({
    userId,
  });

  res.json({ success: true, data: memberships });
});

export const getEventById = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;
  const event = await EventService.getEventById(req.params.eventId, userId);

  res.json({
    success: true,
    data: { event },
  });
});

export const getEventBySlug = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;
  const event = await EventService.getEventBySlug(req.params.slug, userId);

  res.json({
    success: true,
    data: { event },
  });
});

export const updateEvent = catchAsync(async (req, res) => {
  const isAdmin = req.user?.roles?.includes('admin');

  const event = await EventService.updateEvent(req.params.eventId, req.body, { isAdmin });

  res.json({
    success: true,
    message: 'Event updated successfully',
    data: { event },
  });
});

export const deleteEvent = catchAsync(async (req, res) => {
  await EventService.deleteEvent(req.params.eventId, req.user.id);
  await OrganizerService.decrementEventCount(req.user.id);

  res.json({
    success: true,
    message: 'Event deleted successfully',
  });
});

export const cancelEvent = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const result = await EventService.cancelEvent(req.params.eventId, req.user.id, { reason });
  res.json({
    success: true,
    message: 'Event cancelled and refunds issued to all ticket holders',
    data: result,
  });
});

export const publishEvent = catchAsync(async (req, res) => {
  const event = await EventService.publishEvent(req.params.eventId, req.user.id);

  res.json({
    success: true,
    message: 'Event published successfully',
    data: { event },
  });
});

export const getEventAnalytics = catchAsync(async (req, res) => {
  const analytics = await EventService.getEventAnalytics(req.params.eventId, req.user.id);

  res.json({
    success: true,
    data: { analytics },
  });
});

export const getEventTickets = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;
  const tickets = await EventService.getEventTickets(req.params.eventId, userId);

  res.json({
    success: true,
    data: { tickets },
  });
});

export const joinEvent = catchAsync(async (req, res) => {
  const result = await EventService.joinEvent(req.user.id, req.body);

  res.json({
    success: true,
    message: 'Successfully joined event',
    data: result,
  });
});

export const purchaseTickets = catchAsync(async (req, res) => {
  const result = await EventService.purchaseTickets(req.user.id, req.body);

  res.json({
    success: true,
    message: 'Tickets purchased successfully',
    data: result,
  });
});

export const getUserEventStatus = catchAsync(async (req, res) => {
  const result = await EventService.getUserEventStatus(req.user.id, req.params.eventId);

  res.json({
    success: true,
    data: result,
  });
});

export const startTicketSale = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;
  if (!organizerId) throw new ApiError(400, 'Organizer profile required');
  const { eventId, ticketTierId } = req.params;
  const result = await EventService.startTicketSale(organizerId, eventId, ticketTierId, req.body);
  res.json({ success: true, message: 'Sale started', data: result });
});

export const endTicketSale = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;
  if (!organizerId) throw new ApiError(400, 'Organizer profile required');
  const { eventId, ticketTierId } = req.params;
  const result = await EventService.endTicketSale(organizerId, eventId, ticketTierId);
  res.json({ success: true, message: 'Sale ended', data: result });
});

export const getEventTicketSales = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;
  if (!organizerId) throw new ApiError(400, 'Organizer profile required');
  const result = await EventService.getEventTicketSales(organizerId, req.params.eventId);
  res.json({ success: true, data: result });
});

export const updateSessionInventory = catchAsync(async (req, res) => {
  const isAdmin = req.user?.roles?.includes('admin');
  const organizerId = req.user?.organizerId;

  if (!isAdmin && !organizerId) {
    throw new ApiError(400, 'Organizer profile required');
  }

  const { eventId, ticketTierId } = req.params;
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, 'rows must be a non-empty array');
  }

  const result = await EventService.updateSessionInventory(
    organizerId,
    eventId,
    ticketTierId,
    rows,
    { isAdmin }
  );

  res.json({
    success: true,
    message: 'Session inventory updated successfully',
    data: result,
  });
});
