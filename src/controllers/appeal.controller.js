import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import * as appealService from '../services/appeal.service.js';
import ApiError from '../utils/api-error.js';
import { isUserEffectivelySuspended, suspensionDaysRemaining } from '../utils/suspension.js';

export const submitAppeal = catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Appeal reason is required');
  }
  const appeal = await appealService.submitAppeal(req.user.id, reason.trim());
  res.status(httpStatus.CREATED).json({ success: true, data: appeal });
});

export const getMyAppeals = catchAsync(async (req, res) => {
  const appeals = await appealService.getUserAppeals(req.user.id);
  res.status(httpStatus.OK).json({ success: true, data: appeals });
});

export const getSuspensionStatus = catchAsync(async (req, res) => {
  const user = req.user;
  const isSuspended = isUserEffectivelySuspended(user);
  res.status(httpStatus.OK).json({
    success: true,
    data: {
      isSuspended,
      suspendedUntil: isSuspended ? (user.suspendedUntil ?? null) : null,
      suspensionReason: isSuspended ? (user.suspensionReason ?? null) : null,
      daysRemaining: suspensionDaysRemaining(user),
    },
  });
});
