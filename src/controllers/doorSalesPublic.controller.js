import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { DoorSalesService } from '../services/doorSales.service.js';

export const getDoorSalesByToken = catchAsync(async (req, res) => {
  const { token } = req.params;
  if (!token) throw new ApiError(400, 'token is required');

  const config = await DoorSalesService.getEventByToken(token);
  res.json({ success: true, data: config });
});

export const checkoutDoorSales = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { name, email, phone, ticketSelections, platform } = req.body;

  if (!token) throw new ApiError(400, 'token is required');
  if (!name || !email || !Array.isArray(ticketSelections) || ticketSelections.length === 0) {
    throw new ApiError(400, 'Missing required fields');
  }

  const result = await DoorSalesService.createGuestOrderAndCheckout(
    token,
    { name, email, phone },
    ticketSelections,
    platform
  );

  res.json({ success: true, data: result });
});

export const getGuestTicketBundle = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  if (!orderId) throw new ApiError(400, 'orderId is required');

  const bundle = await DoorSalesService.getTicketBundleByOrderId(orderId);
  res.json({ success: true, data: bundle });
});

export const getGuestTicketByCode = catchAsync(async (req, res) => {
  const { ticketCode } = req.params;
  if (!ticketCode) throw new ApiError(400, 'ticketCode is required');

  const ticket = await DoorSalesService.getTicketByCode(ticketCode);
  res.json({ success: true, data: ticket });
});
