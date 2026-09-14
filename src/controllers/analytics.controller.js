import { AnalyticsService } from '../services/analytics.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { db } from '../db/index.js';
import { events } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

// ── NEW: list schedules for an event so the frontend can populate the selector ──
export const getEventSchedules = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const schedules = await AnalyticsService.getEventSchedules(eventId);
  res.json({ success: true, data: schedules });
});

export const getOrganizerOverview = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const filters = { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo };
  const overview = await AnalyticsService.getOrganizerOverview(organizerId, filters);
  res.json({ success: true, data: overview });
});

export const getEventAnalytics = catchAsync(async (req, res) => {
  let organizerId = req.user?.organizerId;
  const { eventId } = req.params;

  // Optional session filter from query string: ?scheduleId=<uuid>
  const scheduleId = req.query.scheduleId || undefined;

  const filters = { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo };

  if (!organizerId) {
    if (req.event?.organizerId) {
      organizerId = req.event.organizerId;
    } else {
      const ev = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { organizerId: true },
      });
      organizerId = ev?.organizerId;
    }
  }

  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const analytics = await AnalyticsService.getEventAnalytics(eventId, organizerId, filters, {
    scheduleId,
  });

  res.json({ success: true, data: analytics });
});

export const getOrganizerEvents = catchAsync(async (req, res) => {
  const organizerId = req.user.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
    search: req.query.search,
    status: req.query.status,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc',
  };

  const result = await AnalyticsService.getOrganizerEvents(organizerId, filters);
  res.json({ success: true, data: result });
});

export const getEventSalesAnalytics = catchAsync(async (req, res) => {
  let organizerId = req.user?.organizerId;
  const { eventId } = req.params;
  const scheduleId = req.query.scheduleId || undefined;

  if (!organizerId) organizerId = req.event?.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const salesData = await AnalyticsService.getEventSalesAnalytics(eventId, scheduleId);
  res.json({ success: true, data: salesData });
});

export const getEventAudienceAnalytics = catchAsync(async (req, res) => {
  let organizerId = req.user?.organizerId;
  const { eventId } = req.params;
  const scheduleId = req.query.scheduleId || undefined;

  if (!organizerId) organizerId = req.event?.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const audienceData = await AnalyticsService.getEventAudienceAnalytics(eventId, scheduleId);
  res.json({ success: true, data: audienceData });
});

export const getTicketPerformanceAnalytics = catchAsync(async (req, res) => {
  let organizerId = req.user?.organizerId;
  const { eventId } = req.params;
  const scheduleId = req.query.scheduleId || undefined;

  if (!organizerId) organizerId = req.event?.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  const ticketData = await AnalyticsService.getTicketPerformanceAnalytics(eventId, scheduleId);
  res.json({ success: true, data: ticketData });
});

export const getEventEngagementAnalytics = catchAsync(async (req, res) => {
  let organizerId = req.user?.organizerId;
  const { eventId } = req.params;

  if (!organizerId) organizerId = req.event?.organizerId;
  if (!organizerId) throw new ApiError(404, 'Organizer profile not found');

  // Engagement is event-level – no scheduleId needed
  const engagementData = await AnalyticsService.getEventEngagementAnalytics(eventId);
  res.json({ success: true, data: engagementData });
});
