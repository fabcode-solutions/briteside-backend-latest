import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
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

export const checkVanitySlugAvailability = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const { slug } = req.query;

  if (!slug || !slug.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'slug is required');
  }

  const result = await EventMarketingService.checkVanitySlugAvailability(eventId, slug);
  res.status(200).json({ success: true, ...result });
});

export const updateVanitySlug = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const organizerId = req.user.organizerId;
  const { vanitySlug } = req.body;

  if (!organizerId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organizer profile required');
  }
  if (!vanitySlug || !vanitySlug.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'vanitySlug is required');
  }

  const settings = await EventMarketingService.updateVanitySlug(eventId, organizerId, vanitySlug);
  res.status(200).json({ success: true, settings });
});

export const resolveVanitySlug = catchAsync(async (req, res) => {
  const { vanitySlug } = req.params;
  const result = await EventMarketingService.resolveVanitySlug(vanitySlug);

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  res.status(200).json({ success: true, ...result });
});
