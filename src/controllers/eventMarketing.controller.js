import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { EventMarketingService } from '../services/eventMarketing.service.js';

export const getMarketingSettings = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const settings = await EventMarketingService.getSettings(eventId);
  res.status(200).json({ success: true, settings });
});

export const updateMarketingSettings = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const organizerId = req.user.organizerId;

  if (!organizerId) {
    throw new ApiError(400, 'Organizer profile required');
  }

  const settings = await EventMarketingService.updateSettings(eventId, organizerId, req.body);
  res.status(200).json({ success: true, settings });
});

export const getPublicPixelConfig = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const config = await EventMarketingService.getPublicPixelConfig(eventId);
  res.status(200).json({ success: true, config });
});
