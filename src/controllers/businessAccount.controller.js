// The business's own account tools (/businesses/:businessId/account/…).
// req.business / req.businessAccess are set by requireBusinessPermission.
import { catchAsync } from '../utils/catch-async.js';
import * as S from '../services/businessAccount.service.js';

// Express 5: parsed/coerced query values live on req.validatedQuery
const q = req => req.validatedQuery ?? req.query;

// ── Notification settings ──
export const getNotificationSettings = catchAsync(async (req, res) => {
  res.json({ success: true, data: S.getNotificationPrefs(req.business) });
});

export const updateNotificationSettings = catchAsync(async (req, res) => {
  const data = await S.updateNotificationPrefs(req.business, req.body.prefs);
  res.json({ success: true, message: 'Notification settings saved', data });
});

// ── Privacy ──
export const getPrivacy = catchAsync(async (req, res) => {
  res.json({ success: true, data: S.getPrivacy(req.business) });
});

export const updatePrivacy = catchAsync(async (req, res) => {
  const data = await S.updatePrivacy(req.business, req.body);
  res.json({ success: true, message: 'Privacy settings saved', data });
});

// ── Blocked accounts ──
export const listBlocked = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.listBlocked(req.business) });
});

export const blockUser = catchAsync(async (req, res) => {
  const data = await S.blockUser(req.business, req.body.username, req.user.id);
  res.status(201).json({ success: true, message: 'Account blocked', data });
});

export const unblockUser = catchAsync(async (req, res) => {
  const data = await S.unblockUser(req.business, req.params.userId);
  res.json({ success: true, message: 'Account unblocked', data });
});

// ── Pinned profiles (same response shape as GET /social/pinned-profiles) ──
export const listPinned = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, search = '' } = q(req);
  const result = await S.listPinned(req.business, Number(page), Number(limit), String(search).trim());
  res.json({
    success: true,
    data: { profiles: result.items, total: result.total },
    pagination: { page: Number(page), limit: Number(limit), hasMore: result.hasMore },
  });
});

export const getPinStatus = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.isPinned(req.business, req.params.username) });
});

export const togglePin = catchAsync(async (req, res) => {
  const data = await S.togglePin(req.business, req.params.username);
  res.json({ success: true, message: data.pinned ? 'Profile pinned' : 'Profile unpinned', data });
});

export const getBusinessPinStatus = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.isBusinessPinnedBy(req.business, req.params.idOrSlug) });
});

export const togglePinBusiness = catchAsync(async (req, res) => {
  const data = await S.togglePinBusiness(req.business, req.params.idOrSlug);
  res.json({ success: true, message: data.pinned ? 'Business pinned' : 'Business unpinned', data });
});

// ── Interests ──
export const getInterests = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.getInterests(req.business) });
});

export const saveInterests = catchAsync(async (req, res) => {
  const data = await S.saveInterests(req.business, req.body);
  res.json({ success: true, message: 'Interests saved', data });
});

// ── Payment methods ──
export const listPaymentMethods = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.listPaymentMethods(req.business) });
});

export const createPaymentPortal = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.createPaymentPortal(req.business, req.body.returnUrl) });
});

// ── Spend log (same shapes as /user/expenditure/*) ──
export const getSpendSummary = catchAsync(async (req, res) => {
  res.json({ success: true, data: await S.spendSummary(req.business) });
});

export const getSpendTimeline = catchAsync(async (req, res) => {
  const { year, month } = q(req);
  res.json({ success: true, data: await S.spendTimeline(req.business, { year, month }) });
});

export const getSpendRecent = catchAsync(async (req, res) => {
  const { page, limit, type } = q(req);
  res.json({ success: true, data: await S.spendRecent(req.business, { page, limit, type }) });
});

// ── Digital product purchases (same shapes as /shop/purchases, /shop/orders/:id/download) ──
export const listPurchases = catchAsync(async (req, res) => {
  const page = Number(q(req).page ?? 1);
  const limit = Number(q(req).limit ?? 20);
  const result = await S.listPurchases(req.business, req.user.id, page, limit);
  res.json({
    success: true,
    data: { orders: result.orders, total: result.total },
    pagination: { page, limit, hasMore: result.hasMore },
  });
});

export const getPurchaseDownload = catchAsync(async (req, res) => {
  const data = await S.getPurchaseDownload(req.business, req.user.id, req.params.orderId);
  res.json({ success: true, data });
});
