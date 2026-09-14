import { EventScheduleService } from '../services/eventSchedule.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { OrganizerService } from '../services/organizer.service.js';

/**
 * Create a new event schedule
 * POST /api/events/:eventId/schedules
 */
export const createEventSchedule = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const scheduleData = req.body;

  // Verify user is the organizer of this event
  const canManage = await OrganizerService.canManageEvent(req.user.id, eventId);
  if (!canManage) {
    throw new ApiError(403, 'You do not have permission to manage this event');
  }

  const schedule = await EventScheduleService.createSchedule(eventId, scheduleData);

  res.status(201).json({
    success: true,
    message: 'Event schedule created successfully',
    data: { schedule },
  });
});

/**
 * Update an event schedule
 * PUT /api/schedules/:scheduleId
 */
export const updateEventSchedule = catchAsync(async (req, res) => {
  const { scheduleId } = req.params;
  const updateData = req.body;

  // Fetch schedule to get eventId for permission check
  const existingSchedule = await EventScheduleService.getScheduleById(scheduleId);

  // Verify user is the organizer of the event
  const canManage = await OrganizerService.canManageEvent(req.user.id, existingSchedule.event.id);
  if (!canManage) {
    throw new ApiError(403, 'You do not have permission to manage this event');
  }

  const schedule = await EventScheduleService.updateSchedule(scheduleId, updateData);

  res.json({
    success: true,
    message: 'Event schedule updated successfully',
    data: { schedule },
  });
});

/**
 * Delete an event schedule
 * DELETE /api/schedules/:scheduleId
 */
export const deleteEventSchedule = catchAsync(async (req, res) => {
  const { scheduleId } = req.params;

  // Fetch schedule to get eventId for permission check
  const existingSchedule = await EventScheduleService.getScheduleById(scheduleId);

  // Verify user is the organizer of the event
  const canManage = await OrganizerService.canManageEvent(req.user.id, existingSchedule.event.id);
  if (!canManage) {
    throw new ApiError(403, 'You do not have permission to manage this event');
  }

  const schedule = await EventScheduleService.deleteSchedule(scheduleId);

  res.json({
    success: true,
    message: 'Event schedule deleted successfully',
    data: { schedule },
  });
});

/**
 * Get all schedules for an event
 * GET /api/events/:eventId/schedules
 */
export const getEventSchedules = catchAsync(async (req, res) => {
  const { eventId } = req.params;

  const schedules = await EventScheduleService.getSchedulesByEventId(eventId);

  res.json({
    success: true,
    data: { schedules },
  });
});

/**
 * Get a single schedule by ID
 * GET /api/schedules/:scheduleId
 */
export const getScheduleById = catchAsync(async (req, res) => {
  const { scheduleId } = req.params;

  const schedule = await EventScheduleService.getScheduleById(scheduleId);

  res.json({
    success: true,
    data: { schedule },
  });
});
