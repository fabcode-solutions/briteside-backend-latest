import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { GroupSubscriptionService } from '../services/groupSubscription.service.js';

/**
 * Get all active subscription plans (public)
 * @route GET /api/subscriptions/plans
 */
const getPlans = catchAsync(async (req, res) => {
  const plans = await SubscriptionService.listPlans({ includeInactive: false });

  res.status(httpStatus.OK).json({
    success: true,
    data: plans,
  });
});

/**
 * Create Stripe Checkout session for subscription
 * @route POST /api/subscriptions/checkout
 */
const createCheckoutSession = catchAsync(async (req, res) => {
  const { planId, successUrl, cancelUrl } = req.body;

  const session = await SubscriptionService.createCheckoutSession(
    req.user.id,
    planId,
    successUrl,
    cancelUrl
  );

  res.status(httpStatus.OK).json({
    success: true,
    data: session,
  });
});

/**
 * Native checkout step 1 — create the Stripe subscription directly and
 * return the first invoice's PaymentIntent client secret.
 * @route POST /api/subscriptions/native-intent
 */
const createNativeSubscriptionIntent = catchAsync(async (req, res) => {
  const { planId } = req.body;

  const result = await SubscriptionService.createNativeSubscriptionIntent(req.user.id, planId);

  res.status(httpStatus.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Native checkout step 2 — verify the confirmed PaymentIntent and activate
 * the subscription.
 * @route POST /api/subscriptions/native-finalize
 */
const finalizeNativeSubscription = catchAsync(async (req, res) => {
  const { subscriptionId, paymentIntentId } = req.body;

  const result = await SubscriptionService.finalizeNativeSubscription(
    req.user.id,
    subscriptionId,
    paymentIntentId
  );

  res.status(httpStatus.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Create Stripe Customer Portal session
 * @route POST /api/subscriptions/portal
 */
const getCustomerPortalSession = catchAsync(async (req, res) => {
  const { returnUrl } = req.body;

  const session = await SubscriptionService.getCustomerPortalSession(req.user.id, returnUrl);

  res.status(httpStatus.OK).json({
    success: true,
    data: session,
  });
});

/**
 * Get current user's active subscription
 * @route GET /api/subscriptions/me
 */
const getMySubscription = catchAsync(async (req, res) => {
  const subscription = await SubscriptionService.getUserSubscription(req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    data: subscription,
  });
});

/**
 * Get current user's subscription history
 * @route GET /api/subscriptions/me/history
 */
const getMySubscriptionHistory = catchAsync(async (req, res) => {
  const history = await SubscriptionService.getUserSubscriptionHistory(req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    data: history,
  });
});

/**
 * Cancel current user's subscription (at period end)
 * @route POST /api/subscriptions/me/cancel
 */
const cancelMySubscription = catchAsync(async (req, res) => {
  const subscription = await SubscriptionService.cancelSubscription(req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Subscription will be canceled at the end of the current billing period',
    data: subscription,
  });
});

/**
 * Get all group subscriptions for the current user
 * @route GET /api/subscriptions/my-groups
 */
const getMyGroupSubscriptions = catchAsync(async (req, res) => {
  const subscriptions = await GroupSubscriptionService.getMyAllGroupSubscriptions(req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    data: subscriptions,
  });
});

export const subscriptionController = {
  getPlans,
  createCheckoutSession,
  createNativeSubscriptionIntent,
  finalizeNativeSubscription,
  getCustomerPortalSession,
  getMySubscription,
  getMySubscriptionHistory,
  cancelMySubscription,
  getMyGroupSubscriptions,
};
