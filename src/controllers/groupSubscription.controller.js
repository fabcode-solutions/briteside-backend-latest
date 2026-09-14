import { GroupSubscriptionService } from '../services/groupSubscription.service.js';
import { catchAsync } from '../utils/catch-async.js';

// ── TIER MANAGEMENT ───────────────────────────────────────────────────────────

export const listGroupTiers = catchAsync(async (req, res) => {
  const tiers = await GroupSubscriptionService.getTiers(req.params.groupId);
  res.json({ success: true, data: tiers });
});

export const createGroupTier = catchAsync(async (req, res) => {
  const tier = await GroupSubscriptionService.createTier(req.params.groupId, req.user.id, req.body);
  res.status(201).json({ success: true, data: tier });
});

export const updateGroupTier = catchAsync(async (req, res) => {
  const tier = await GroupSubscriptionService.updateTier(req.params.tierId, req.user.id, req.body);
  res.json({ success: true, data: tier });
});

export const deactivateGroupTier = catchAsync(async (req, res) => {
  const tier = await GroupSubscriptionService.deactivateTier(req.params.tierId, req.user.id);
  res.json({ success: true, data: tier });
});

// ── USER SUBSCRIPTION ─────────────────────────────────────────────────────────

export const getMyGroupSubscription = catchAsync(async (req, res) => {
  const subscription = await GroupSubscriptionService.getMyGroupSubscription(
    req.user.id,
    req.params.groupId
  );
  res.json({ success: true, data: subscription ?? null });
});

export const createGroupCheckoutSession = catchAsync(async (req, res) => {
  const { tierId, successUrl, cancelUrl } = req.body;
  const session = await GroupSubscriptionService.createCheckoutSession(
    req.user.id,
    tierId,
    successUrl,
    cancelUrl
  );
  res.json({ success: true, data: session });
});

export const cancelGroupSubscription = catchAsync(async (req, res) => {
  const result = await GroupSubscriptionService.cancelGroupSubscription(
    req.user.id,
    req.params.groupId
  );
  res.json({ success: true, data: result });
});

export const refundGroupSubscription = catchAsync(async (req, res) => {
  const result = await GroupSubscriptionService.refundGroupSubscription(
    req.user.id,
    req.params.groupId
  );
  res.json({ success: true, data: result });
});

export const getGroupSubscriptionPortal = catchAsync(async (req, res) => {
  const { returnUrl } = req.body;
  const session = await GroupSubscriptionService.getCustomerPortalSession(req.user.id, returnUrl);
  res.json({ success: true, data: session });
});

// ── CREATOR ADMIN — MEMBER SUBSCRIPTION MANAGEMENT ───────────────────────────

export const listGroupMemberSubscriptions = catchAsync(async (req, res) => {
  const { page, limit, status } = req.query;
  const result = await GroupSubscriptionService.listGroupMemberSubscriptions(
    req.params.groupId,
    req.user.id,
    { page: parseInt(page) || 1, limit: parseInt(limit) || 20, status }
  );
  res.json({ success: true, ...result });
});

export const getGroupMemberSubscription = catchAsync(async (req, res) => {
  const subscription = await GroupSubscriptionService.getGroupMemberSubscription(
    req.params.groupId,
    req.params.userId,
    req.user.id
  );
  res.json({ success: true, data: subscription });
});

export const adminCancelMemberSubscription = catchAsync(async (req, res) => {
  const result = await GroupSubscriptionService.adminCancelMemberSubscription(
    req.params.groupId,
    req.params.userId,
    req.user.id
  );
  res.json({ success: true, data: result });
});

export const adminRefundMemberSubscription = catchAsync(async (req, res) => {
  const result = await GroupSubscriptionService.adminRefundMemberSubscription(
    req.params.groupId,
    req.params.userId,
    req.user.id
  );
  res.json({ success: true, data: result });
});

export const checkGroupSubscriptionRefund = catchAsync(async (req, res) => {
  const result = await GroupSubscriptionService.checkRefundStatus(req.user.id, req.params.groupId);
  res.json({ success: true, data: result });
});
