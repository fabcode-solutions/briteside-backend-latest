import { UserSpendService } from '../services/userSpend.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const getSummary = catchAsync(async (req, res) => {
  const data = await UserSpendService.getSummary(req.user.id);
  res.json({ success: true, data });
});

export const getTimeline = catchAsync(async (req, res) => {
  const { year, month } = req.query;
  if (!year) throw new ApiError(400, 'year query parameter is required');
  const data = await UserSpendService.getTimeline(req.user.id, { year, month });
  res.json({ success: true, data });
});

export const getEventSpend = catchAsync(async (req, res) => {
  const data = await UserSpendService.getEventSpend(req.user.id, req.params.eventId);
  res.json({ success: true, data });
});

export const getActiveSubscriptions = catchAsync(async (req, res) => {
  const data = await UserSpendService.getActiveSubscriptions(req.user.id);
  res.json({ success: true, data });
});

export const getRecentSpends = catchAsync(async (req, res) => {
  const { page, limit, type } = req.query;
  const data = await UserSpendService.getRecentSpends(req.user.id, { page, limit, type });
  res.json({ success: true, data });
});
