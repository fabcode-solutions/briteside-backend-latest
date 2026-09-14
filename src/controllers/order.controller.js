import { OrderService } from '../services/order.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

function calcEligibleRefundAmount(order) {
  if (order.status !== 'paid') return 0;
  const [intPart, fracPart = ''] = (order.totalAmount || '0').split('.');
  const totalCents = parseInt(intPart, 10) * 100 + parseInt((fracPart + '00').slice(0, 2), 10);
  const eligibleCents = totalCents - (order.platformShareCents || 0) - (order.stripeFeeCents || 0);
  return eligibleCents;
}

/**
 * Get orders for the current authenticated user
 * Supports pagination, filtering by year/month, and sorting
 */
export const getUserOrders = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const { page, limit, year, month, sortBy, sortOrder, status, eventId } = req.query;

  const result = await OrderService.listUserOrders(req.user.id, {
    page,
    limit,
    year,
    status,
    month,
    sortBy,
    sortOrder,
    eventId,
  });

  const data = result.items.map(o => ({
    ...o,
    eligibleRefundAmountCents: calcEligibleRefundAmount(o),
  }));

  res.json({
    success: true,
    data,
    pagination: result.pagination,
  });
});

/**
 * Get orders for a specific event.
 * Access is enforced at route-level for organizer/admin/authorized team members.
 */
export const getEventsOrders = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  if (!eventId) {
    throw new ApiError(400, 'Event ID is required');
  }

  const {
    page,
    limit,
    year,
    month,
    sortBy,
    sortOrder,
    status,
    userId,
    paymentMethodId,
    minAmount,
    maxAmount,
  } = req.query;

  const result = await OrderService.listEventOrders(eventId, {
    page,
    limit,
    year,
    month,
    sortBy,
    sortOrder,
    status,
    userId,
    paymentMethodId,
    minAmount,
    maxAmount,
  });

  res.json({
    success: true,
    event: result.event,
    data: result.items,
    pagination: result.pagination,
  });
});

/**
 * Get a specific order by ID for the current user
 */
export const getUserOrder = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const { orderId } = req.params;

  const order = await OrderService.getOrderById(orderId, req.user.id);
  const enriched = { ...order, eligibleRefundAmount: calcEligibleRefundAmount(order) };

  res.json({
    success: true,
    data: enriched,
  });
});

/**
 * Update an order (limited fields allowed)
 */
export const updateOrder = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const { orderId } = req.params;
  const updates = req.body;

  // Validate that only safe fields are being updated
  const allowedUserUpdates = ['billingAddress'];
  const updatePayload = {};

  for (const key of Object.keys(updates)) {
    if (allowedUserUpdates.includes(key)) {
      updatePayload[key] = updates[key];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    throw new ApiError(400, 'No valid fields provided for update');
  }

  const { updatedOrder } = await OrderService.updateOrder(orderId, req.user.id, updatePayload);

  res.json({
    success: true,
    message: 'Order updated successfully',
    data: updatedOrder,
  });
});

/**
 * Cancel an order
 */
export const cancelOrder = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const { orderId } = req.params;

  const cancelledOrder = await OrderService.cancelOrder(orderId, req.user.id);

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    data: cancelledOrder,
  });
});
