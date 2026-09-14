import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { DoorSalesService } from '../services/doorSales.service.js';

export const enableDoorSales = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.enableDoorSales(eventId);
  res.json({ success: true, data });
});

export const disableDoorSales = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.disableDoorSales(eventId);
  res.json({ success: true, data });
});

export const regenerateDoorSales = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.regenerateDoorSalesToken(eventId);
  res.json({ success: true, data });
});

export const getDoorSalesConfig = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.getDoorSalesConfig(eventId);
  res.json({ success: true, data });
});

export const setDoorSaleTierPrices = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const ticketUpdates = req.body.ticketUpdates;

  if (!eventId) throw new ApiError(400, 'eventId is required');
  if (!ticketUpdates) throw new ApiError(400, 'ticketUpdates is required');

  const result = await DoorSalesService.setTicketDoorSalePrices(eventId, ticketUpdates);
  res.json({ success: true, data: result });
});

export const getEventGuestOrders = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.getEventGuestOrders(eventId);
  res.json({ success: true, data });
});

export const getEventGuestTickets = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) throw new ApiError(400, 'eventId is required');

  const data = await DoorSalesService.getEventGuestTickets(eventId);
  res.json({ success: true, data });
});
