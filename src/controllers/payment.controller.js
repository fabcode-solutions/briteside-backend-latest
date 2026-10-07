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

  // Tickets have no native-app consumer of this endpoint — it's always an
  // embedded session (clientSecret), never a hosted redirect (url). This
  // forwards whichever one the service actually returned instead of only
  // ever reading `url`, which embedded sessions never set.
  res.json({
    success: true,
    data: {
      clientSecret: sessionData.clientSecret,
      url: sessionData.url,
      sessionId: sessionData.sessionId,
    },
  });
});

/**
 * Same purchase as createCheckoutSession, but charges a saved card directly
 * (no redirect) when the buyer already has one on file. Falls back to a
 * normal hosted Checkout session otherwise.
 */
export const createSmartCheckoutSession = catchAsync(async (req, res) => {
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

  const order = await OrderService.createOrder(
    req.user.id,
    eventId,
    ticketSelections,
    merchandiseSelections,
    { holderName, holderPhone, holderEmail, billingAddress }
  );

  const successUrl = req.body.successUrl;
  const cancelUrl = req.body.cancelUrl;

  const metadata = {
    userId: req.user.id,
    holderName: holderName || null,
    holderEmail: holderEmail || null,
    holderPhone: holderPhone || null,
    eventScheduleId: ticketSelections[0]?.eventScheduleId || null,
  };

  const result = await PaymentService.createSmartCheckoutSession(
    order,
    successUrl,
    cancelUrl,
    metadata
  );

  res.json({ success: true, data: result });
});

/**
 * Native in-app checkout for ticket orders (mobile PaymentSheet). Creates the
 * order exactly like the hosted/smart checkout endpoints, then returns what
 * Stripe's PaymentSheet needs instead of a redirect URL.
 */
export const createTicketPaymentSheet = catchAsync(async (req, res) => {
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

  const order = await OrderService.createOrder(
    req.user.id,
    eventId,
    ticketSelections,
    merchandiseSelections,
    { holderName, holderPhone, holderEmail, billingAddress }
  );

  const result = await PaymentService.createTicketPaymentSheet(order, {
    holderName: holderName || null,
    holderEmail: holderEmail || null,
    holderPhone: holderPhone || null,
    eventScheduleId: ticketSelections[0]?.eventScheduleId || null,
  });

  res.json({ success: true, data: result });
});

/**
 * Called by the app right after the PaymentSheet reports success, so tickets
 * are issued without waiting on the webhook. Idempotent with the
 * payment_intent.succeeded webhook (see PaymentService.processPaymentSheetIntent).
 * If the webhook won the race and is still issuing, waits briefly for it.
 */
export const completeTicketPaymentSheet = catchAsync(async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw new ApiError(400, 'paymentIntentId is required');

  const opts = { userId: req.user.id };
  let result = await PaymentService.processPaymentSheetIntent(paymentIntentId, opts);

  // Lost the claim to the webhook (or Stripe is still settling) — give it a
  // few seconds to finish issuing before answering.
  for (let i = 0; i < 10 && result.status !== 'paid'; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    result = await PaymentService.processPaymentSheetIntent(paymentIntentId, opts);
  }

  res.json({ success: true, data: result });
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