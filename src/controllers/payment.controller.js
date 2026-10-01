import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { OrderService } from '../services/order.service.js';
import { PaymentService } from '../services/payment.service.js';
import { RefundService } from '../services/refund.service.js';

export const createCheckoutSession = catchAsync(async (req, res) => {
  const {
    eventId,
    ticketSelections = [],
    merchandiseSelections = [],
    holderName,
    holderEmail,
    holderPhone,
    billingAddress,
  } = req.body;

  if (!eventId) {
    throw new ApiError(400, 'eventId is required');
  }

  if (!ticketSelections || ticketSelections.length === 0) {
    throw new ApiError(400, 'Ticket selections required');
  }

  // Create order
  const order = await OrderService.createOrder(
    req.user.id,
    eventId,
    ticketSelections,
    merchandiseSelections,
    { holderName, holderPhone, holderEmail, billingAddress }
  );

  // Create Stripe Checkout Session
  const successUrl = req.body.successUrl;
  const cancelUrl = req.body.cancelUrl;

  // Create a real Stripe Checkout Session and return session URL & ID
  // This will throw an error if STRIPE_SECRET_KEY is not configured
  const metadata = {
    userId: req.user.id,
    holderName: holderName || null,
    holderEmail: holderEmail || null,
    holderPhone: holderPhone || null,
    eventScheduleId: ticketSelections[0]?.eventScheduleId || null,
  };

  const sessionData = await PaymentService.createCheckoutSession(
    order,
    successUrl,
    cancelUrl,
    metadata
  );

  res.json({
    success: true,
    data: { url: sessionData.url, sessionId: sessionData.sessionId },
  });
});

export const getPublishableKey = catchAsync(async (req, res) => {
  const publishableKey = PaymentService.getPublishableKey
    ? PaymentService.getPublishableKey()
    : null;
  if (!publishableKey) {
    return res.json({
      success: false,
      data: null,
      message: 'Publishable key not configured',
    });
  }
  res.json({ success: true, data: { publishableKey } });
});

export const checkRefundEligibility = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const result = await RefundService.checkRefundEligibility(orderId, req.user?.id);
  res.json({ success: true, data: result });
});

export const updateRefund = catchAsync(async (req, res) => {
  const { refundId, eventId, status, reason } = req.body;
  if (!refundId || !eventId) {
    throw new ApiError(400, 'refundId and eventId are required');
  }
  const result = await RefundService.updateRefund(refundId, eventId, req.user?.id, {
    status,
    reason,
    teamMember: req.teamMember,
  });
  res.json({ success: true, data: result });
});

export const applyRefund = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { action, refundId, eventId, reason } = req.body;

  // Organizer / team member action: approve or reject an existing refund
  if (action && ['approve', 'reject', 'approved', 'rejected'].includes(action)) {
    // expect refundId and eventId
    if (!refundId || !eventId)
      throw new ApiError(400, 'refundId and eventId are required for organizer actions');

    const status = action === 'approve' || action === 'approved' ? 'approved' : 'rejected';
    const result = await RefundService.updateRefund(refundId, eventId, req.user?.id, {
      status,
      reason,
      teamMember: req.teamMember,
    });
    return res.json({ success: true, data: result });
  }

  // Default: customer requests a refund (creates a refund request with status='requested')
  const result = await RefundService.requestRefund(orderId, req.user?.id, {
    reason,
  });
  res.json({ success: true, data: result });
});

export const getRefundDetails = catchAsync(async (req, res) => {
  const { refundId } = req.params;
  if (!req.user && !req.teamMember) {
    throw new ApiError(401, 'Authentication required');
  }

  const result = await RefundService.getRefundById(refundId, req.user?.id, {
    teamMember: req.teamMember,
  });
  res.json({ success: true, data: result });
});

export const listOrganizerRefunds = catchAsync(async (req, res) => {
  const { page, limit, status, eventId } = req.query;
  if (!req.user) throw new ApiError(401, 'Authentication required');
  const result = await RefundService.listUserRefunds(
    req.user.id,
    eventId,
    true,
    { page, limit, status },
    { teamMember: null }
  );
  res.json({ success: true, data: result });
});

export const listRefunds = catchAsync(async (req, res) => {
  const { page, limit, status, eventId, isOrganizer } = req.query;
  if (!req.user && !req.teamMember) {
    throw new ApiError(401, 'Authentication required');
  }

  const organizerView = String(isOrganizer).toLowerCase() === 'true';
  const result = await RefundService.listUserRefunds(
    req.user?.id,
    eventId,
    organizerView,
    {
      page,
      limit,
      status,
    },
    {
      teamMember: req.teamMember,
    }
  );
  res.json({ success: true, data: result });
});
