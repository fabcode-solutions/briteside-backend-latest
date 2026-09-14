import { z } from 'zod';

// Create event schedule validation
export const createEventScheduleSchema = z.object({
  body: z
    .object({
      title: z
        .string()
        .min(1, 'Title is required')
        .max(255, 'Title must be less than 255 characters'),
      description: z.string().optional(),
      date: z
        .string()
        .datetime({ message: 'Date must be a valid ISO 8601 datetime' })
        .refine(
          val => {
            const date = new Date(val);
            return date >= new Date(new Date().setHours(0, 0, 0, 0));
          },
          { message: 'Date cannot be in the past' }
        ),
      startTime: z
        .string()
        .datetime({ message: 'Start time must be a valid ISO 8601 datetime' })
        .refine(
          val => {
            const date = new Date(val);
            return date > new Date();
          },
          { message: 'Start time must be in the future' }
        ),
      endTime: z.string().datetime({ message: 'End time must be a valid ISO 8601 datetime' }),
    })
    .refine(
      data => {
        const start = new Date(data.startTime);
        const end = new Date(data.endTime);
        return end > start;
      },
      {
        message: 'End time must be after start time',
        path: ['endTime'],
      }
    ),
  params: z.object({
    eventId: z.string().uuid({ message: 'Invalid event ID' }),
  }),
});

// Update event schedule validation
export const updateEventScheduleSchema = z.object({
  body: z
    .object({
      title: z
        .string()
        .min(1, 'Title cannot be empty')
        .max(255, 'Title must be less than 255 characters')
        .optional(),
      description: z.string().optional(),
      date: z.string().datetime({ message: 'Date must be a valid ISO 8601 datetime' }).optional(),
      startTime: z
        .string()
        .datetime({ message: 'Start time must be a valid ISO 8601 datetime' })
        .optional(),
      endTime: z
        .string()
        .datetime({ message: 'End time must be a valid ISO 8601 datetime' })
        .optional(),
    })
    .refine(
      data => {
        // If both times provided, validate end > start
        if (data.startTime && data.endTime) {
          const start = new Date(data.startTime);
          const end = new Date(data.endTime);
          return end > start;
        }
        return true;
      },
      {
        message: 'End time must be after start time',
        path: ['endTime'],
      }
    ),
  params: z.object({
    scheduleId: z.string().uuid({ message: 'Invalid schedule ID' }),
  }),
});

// Delete event schedule validation
export const deleteEventScheduleSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid({ message: 'Invalid schedule ID' }),
  }),
});

// Get schedules by event ID validation
export const getEventSchedulesSchema = z.object({
  params: z.object({
    eventId: z.string().uuid({ message: 'Invalid event ID' }),
  }),
});

// Get single schedule validation
export const getScheduleByIdSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid({ message: 'Invalid schedule ID' }),
  }),
});
