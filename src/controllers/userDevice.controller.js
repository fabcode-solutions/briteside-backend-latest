import { userDeviceService } from '../services/index.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { z } from 'zod';

const registerDeviceSchema = z.object({
  notificationUid: z.string().min(1, 'notificationUid is required'),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  deviceModel: z.string().max(100).optional(),
  appVersion: z.string().max(20).optional(),
});

const deactivateDeviceSchema = z.object({
  notificationUid: z.string().min(1, 'notificationUid is required'),
});

export const registerDevice = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const validated = registerDeviceSchema.parse(req.body);
  const device = await userDeviceService.registerDevice(req.user.id, validated);

  res.json({ success: true, data: { device } });
});

export const deactivateDevice = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const { notificationUid } = deactivateDeviceSchema.parse(req.body);
  const device = await userDeviceService.deactivateDevice(req.user.id, notificationUid);

  if (!device) {
    throw new ApiError(404, 'Device not found');
  }

  res.json({ success: true, data: { device } });
});
