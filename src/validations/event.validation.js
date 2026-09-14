import { z } from 'zod';

// Recurrence rule schema — discriminated union on 'type'
const recurrenceRuleSchema = z
  .discriminatedUnion('type', [
    // ── Daily ────────────────────────────────────────────────────────────────
    z.object({
      type: z.literal('daily'),
      interval: z.number().int().min(1).max(365).default(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be in HH:MM format'),
      endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be in HH:MM format'),
      occurrences: z.number().int().min(1).max(365),
    }),
    // ── Weekly ───────────────────────────────────────────────────────────────
    z.object({
      type: z.literal('weekly'),
      interval: z.number().int().min(1).max(52).default(1),
      daysOfWeek: z
        .array(z.number().int().min(0).max(6))
        .min(1, 'At least one day of the week is required')
        .max(7),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be in HH:MM format'),
      endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be in HH:MM format'),
      occurrences: z.number().int().min(1).max(365),
    }),
    // ── Monthly ──────────────────────────────────────────────────────────────
    z.object({
      type: z.literal('monthly'),
      interval: z.number().int().min(1).max(12).default(1),
      dayOfMonth: z.number().int().min(1).max(31),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be in HH:MM format'),
      endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be in HH:MM format'),
      occurrences: z.number().int().min(1).max(365),
    }),
  ])
  .refine(
    data => {
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      return eh * 60 + em > sh * 60 + sm;
    },
    { message: 'endTime must be after startTime' }
  );

// Filter validation schema for discover and my events
export const eventFiltersSchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform(val => (val ? parseInt(val) : 1)),
    limit: z
      .string()
      .optional()
      .transform(val => (val ? parseInt(val) : 12)),
    categoryId: z.string().uuid().optional(),
    search: z.string().optional(),
    timeFilter: z.enum(['all', 'today', 'weekend']).optional(),
    organizerId: z.string().uuid().optional(),
    // New enhanced filters
    location: z.string().optional(),
    dateRange: z.enum(['tomorrow', 'this_week', 'this_weekend']).optional(),
    priceFilter: z
      .union([
        z.enum(['free', 'paid']),
        z.string().regex(/^\d+-\d+$/, 'Price range must be in format "min-max" (e.g., "10-50")'),
      ])
      .optional(),
    eventMode: z.enum(['in_person', 'virtual']).optional(),
    // Distance-based location filters
    lat: z
      .string()
      .optional()
      .transform(val => (val ? parseFloat(val) : undefined))
      .refine(val => val === undefined || (val >= -90 && val <= 90), {
        message: 'Latitude must be between -90 and 90',
      }),
    lng: z
      .string()
      .optional()
      .transform(val => (val ? parseFloat(val) : undefined))
      .refine(val => val === undefined || (val >= -180 && val <= 180), {
        message: 'Longitude must be between -180 and 180',
      }),
    distance: z
      .string()
      .regex(
        /^\d+(\.\d+)?\s*(mi|mile|miles|km|kilometer|kilometers)$/i,
        'Distance must be in format "number unit" (e.g., "2 miles", "10km")'
      )
      .optional(),
  }),
});

// Create event validation schema
export const createEventSchema = z.object({
  body: z
    .object({
      title: z
        .string()
        .min(1, 'Title is required')
        .max(255, 'Title must be less than 255 characters'),
      description: z.string().optional(),
      categoryIds: z
        .array(z.string().uuid())
        .min(1, 'At least one category is required')
        .max(3, 'Maximum 3 categories allowed'),
      venueId: z.string().uuid().optional(),
      eventType: z.enum(['public', 'private']).default('public'),
      eventMode: z.enum(['in_person', 'virtual']).default('in_person'),
      isFree: z.boolean().default(false),
      startDate: z.string().datetime().optional(), // Optional if sessions provided
      endDate: z.string().datetime().optional(), // Optional if sessions provided
      capacity: z.number().int().min(1).optional(),
      coverImages: z
        .array(z.string().url())
        .min(1, 'At least one cover image is required')
        .max(5, 'Maximum 5 cover images allowed'),
      attendReason: z.string().max(500).optional(),
      eventHighlights: z.array(z.string()).optional(),
      showAttendeeCount: z.boolean().default(true),
      isChatEnabled: z.boolean().default(true),
      isRefundable: z.boolean().default(true),
      refundCutoffDays: z.number().int().min(0).default(3),
      refundPolicy: z.string().optional(),
      termsConditions: z.string().optional(),
      // Virtual event details (required when eventMode is 'virtual')
      virtualDetails: z
        .object({
          virtualPlatform: z.enum([
            'briteside',
            'zoom',
            'google_meet',
            'microsoft_teams',
            'webex',
            'skype',
            'discord',
            'twitch',
            'youtube_live',
            'facebook_live',
            'other',
          ]),
          // For non-briteside platforms (zoom, other)
          meetingLink: z.string().url().optional(),
          // For briteside platform
          duration: z.number().int().min(1).optional(), // Duration in minutes
          maxAttendees: z.number().int().min(1).optional(),
          briteVideoLink: z.string().url().optional(),
          // Platform name enum
          platformName: z
            .enum([
              'briteside',
              'zoom',
              'google_meet',
              'microsoft_teams',
              'webex',
              'skype',
              'discord',
              'twitch',
              'youtube_live',
              'facebook_live',
              'other',
            ])
            .optional(),
          // Common optional fields
          accessInstructions: z.string().optional(),
          password: z.string().max(100).optional(),
        })
        .optional()
        .refine(
          data => {
            if (!data) return true;
            // For non-briteside platforms, meetingLink is required
            if (data.virtualPlatform !== 'briteside' && !data.meetingLink) {
              return false;
            }
            // For briteside, duration and maxAttendees are required
            if (data.virtualPlatform === 'briteside' && (!data.duration || !data.maxAttendees)) {
              return false;
            }
            return true;
          },
          {
            message:
              'Invalid virtual details: briteside requires duration and maxAttendees; zoom/other requires meetingLink; other also requires platformName',
          }
        ),
      // Sessions array for manual multi-day events
      sessions: z
        .array(
          z.object({
            title: z.string().min(1).max(255).optional(),
            description: z.string().optional(),
            date: z.string(),
            startTime: z.string(),
            endTime: z.string(),
          })
        )
        .min(1)
        .optional(),
      // Recurring schedule rule — alternative to a manual sessions array
      recurrenceRule: recurrenceRuleSchema.optional(),
    })
    .refine(
      data => {
        // Must provide either a sessions array or a recurrence rule
        if (!data.sessions && !data.recurrenceRule) {
          return false;
        }
        return true;
      },
      {
        message: 'Either a sessions array or a recurrenceRule must be provided',
        path: ['sessions'],
      }
    )
    .refine(
      data => {
        // If eventMode is virtual, virtualDetails is required
        if (data.eventMode === 'virtual' && !data.virtualDetails) {
          return false;
        }
        return true;
      },
      {
        message: 'Virtual event details are required when eventMode is "virtual"',
        path: ['virtualDetails'],
      }
    ),
});

// Update event validation schema
export const updateEventSchema = z.object({
  params: z.object({
    eventId: z.string().uuid(),
  }),
  body: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    categoryIds: z
      .array(z.string().uuid())
      .min(1, 'At least one category is required')
      .max(3, 'Maximum 3 categories allowed')
      .optional(),
    venueId: z.string().uuid().optional(),
    eventType: z.enum(['public', 'private']).optional(),
    eventMode: z.enum(['in_person', 'virtual']).optional(),
    isFree: z.boolean().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    capacity: z.number().int().min(1).optional(),
    coverImages: z
      .array(z.string().url())
      .min(1, 'At least one cover image is required')
      .max(5, 'Maximum 5 cover images allowed')
      .optional(),
    attendReason: z.string().max(500).optional(),
    eventHighlights: z.array(z.string()).optional(),
    showAttendeeCount: z.boolean().optional(),
    isChatEnabled: z.boolean().optional(),
    isRefundable: z.boolean().optional(),
    refundCutoffDays: z.number().int().min(0).optional(),
    refundPolicy: z.string().optional(),
    termsConditions: z.string().optional(),
    // Virtual event details (for updating virtual events)
    virtualDetails: z
      .object({
        virtualPlatform: z.enum(['briteside', 'zoom', 'other']).optional(),
        meetingLink: z.string().url().optional(),
        duration: z.number().int().min(1).optional(),
        maxAttendees: z.number().int().min(1).optional(),
        briteVideoLink: z.string().url().optional(),
        platformName: z
          .enum([
            'briteside',
            'zoom',
            'google_meet',
            'microsoft_teams',
            'webex',
            'skype',
            'discord',
            'twitch',
            'youtube_live',
            'facebook_live',
            'other',
          ])
          .optional(),
        accessInstructions: z.string().optional(),
        password: z.string().max(100).optional(),
      })
      .optional(),
  }),
});

// Get event by ID validation
export const getEventByIdSchema = z.object({
  params: z.object({
    eventId: z.string().uuid(),
  }),
});
