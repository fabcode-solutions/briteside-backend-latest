import TrackingLinkService from '../services/trackingLink.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { EventService } from '../services/event.service.js';

const resolveEvent = async slug => {
  const event = await EventService.getEventBySlug(slug);
  if (!event) throw new ApiError(404, 'Event not found');
  return event;
};

export const listTrackingLinks = catchAsync(async (req, res) => {
  const { slug } = req.params;
  const organizerId = req.user?.organizerId;
  const event = await resolveEvent(slug);
  const links = await TrackingLinkService.listByEvent(event.id, organizerId);
  res.json({ success: true, data: { links } });
});

export const createTrackingLink = catchAsync(async (req, res) => {
  const { slug } = req.params;
  const organizerId = req.user?.organizerId;
  if (!organizerId) throw new ApiError(400, 'Organizer required');
  const event = await resolveEvent(slug);
  const { name, destinationUrl } = req.body;
  const link = await TrackingLinkService.create(organizerId, event.id, { name, destinationUrl });

  const host = 'http://localhost:3000/' || 'https://gokyro.com';
  const url = `${host}/events/${slug}?ref=${link.code}`;
  res.status(201).json({ success: true, data: { link: { ...link, url } } });
});

export const getTrackingMetrics = catchAsync(async (req, res) => {
  const { slug, linkId } = req.params;
  const organizerId = req.user?.organizerId;
  const event = await resolveEvent(slug);
  if (event.organizer?.id !== organizerId)
    throw new ApiError(403, 'Event not found or unauthorized');
  const metrics = await TrackingLinkService.getMetrics(event.id, linkId);
  res.json({ success: true, data: { metrics } });
});

export const deleteTrackingLink = catchAsync(async (req, res) => {
  const { slug, linkId } = req.params;
  const organizerId = req.user?.organizerId;
  if (!organizerId) throw new ApiError(403, 'Organizer required');
  const event = await resolveEvent(slug);
  const link = await TrackingLinkService.findById(linkId);
  if (!link || link.eventId !== event.id) throw new ApiError(404, 'Tracking link not found');
  await TrackingLinkService.deleteLink(linkId, organizerId);
  res.json({ success: true, data: null });
});

export const resolveTrackingLinkCode = catchAsync(async (req, res) => {
  const { slug, code } = req.params;
  const event = await resolveEvent(slug);
  const link = await TrackingLinkService.findByCode(code);
  if (!link || link.eventId !== event.id || !link.enabled || link.deletedAt) {
    return res.status(404).json({ success: false, message: 'Tracking link not found' });
  }
  res.json({ success: true, data: { linkId: link.id } });
});

export const recordTrackingClick = catchAsync(async (req, res) => {
  const { slug, linkId } = req.params;
  const event = await resolveEvent(slug);
  const link = await TrackingLinkService.findById(linkId);
  if (!link || link.eventId !== event.id || !link.enabled || link.deletedAt) {
    return res.status(404).json({ success: false, message: 'Tracking link not found' });
  }
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || null;
  await TrackingLinkService.recordClick(link.id, {
    userId: req.user?.id || null,
    ipAddress: ip,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers.referer || req.headers.referrer || null,
    eventId: event.id,
  });
  res.json({ success: true });
});

// Keep redirect route for backward compatibility (e.g. QR codes already printed)
export const redirectTrackingLink = catchAsync(async (req, res) => {
  const { slug, code } = req.params;
  const event = await resolveEvent(slug);
  const link = await TrackingLinkService.findByCode(code);
  if (!link || link.eventId !== event.id || link.deletedAt) {
    throw new ApiError(404, 'Tracking link not found');
  }
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || null;
  await TrackingLinkService.recordClick(link.id, {
    userId: req.user?.id || null,
    ipAddress: ip,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers.referer || req.headers.referrer || null,
    eventId: event.id,
  });
  const destination =
    link.destinationUrl ||
    `${process.env.FRONTEND_HOST || process.env.API_HOST || 'https://gokyro.com'}/events/${link.slug}`;
  return res.redirect(302, destination);
});
