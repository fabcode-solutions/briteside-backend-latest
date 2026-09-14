import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import {
  createEventSchedule,
  updateEventSchedule,
  deleteEventSchedule,
  getEventSchedules,
  getScheduleById,
} from '../controllers/eventSchedule.controller.js';
import {
  createEventScheduleSchema,
  updateEventScheduleSchema,
  deleteEventScheduleSchema,
  getEventSchedulesSchema,
  getScheduleByIdSchema,
} from '../validations/eventSchedule.validation.js';

const router = express.Router();

// Public routes - Get schedules (available to everyone browsing events)
router.get('/:eventId/schedules', validateMiddleware(getEventSchedulesSchema), getEventSchedules);
router.get('/schedules/:scheduleId', validateMiddleware(getScheduleByIdSchema), getScheduleById);

// Protected routes - Require authentication for creation/modification
router.use(authMiddleware);

router.post(
  '/:eventId/schedules',
  validateMiddleware(createEventScheduleSchema),
  createEventSchedule
);

router.put(
  '/schedules/:scheduleId',
  validateMiddleware(updateEventScheduleSchema),
  updateEventSchedule
);

router.delete(
  '/schedules/:scheduleId',
  validateMiddleware(deleteEventScheduleSchema),
  deleteEventSchedule
);

export default router;
