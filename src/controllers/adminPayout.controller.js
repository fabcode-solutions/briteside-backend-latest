import { catchAsync } from '../utils/catch-async.js';
import { releaseRowEarly, releaseAllForCreator, listHeldForCreator } from '../services/adminPayout.service.js';

// ─── Admin-triggered early release — see adminPayout.service.js for design notes ──

export const getHeldForCreator = catchAsync(async (req, res) => {
  const data = await listHeldForCreator(req.params.userId);
  res.json({ success: true, data });
});

export const releaseRow = catchAsync(async (req, res) => {
  const { sourceType, sourceId, reason, chargeFeeForInstant } = req.body;
  const data = await releaseRowEarly(req.user.id, sourceType, sourceId, reason, { chargeFeeForInstant });
  res.status(201).json({ success: true, data });
});

export const releaseAllForCreatorHandler = catchAsync(async (req, res) => {
  const { userId, reason, chargeFeeForInstant } = req.body;
  const data = await releaseAllForCreator(req.user.id, userId, reason, { chargeFeeForInstant });
  res.status(201).json({ success: true, data });
});
