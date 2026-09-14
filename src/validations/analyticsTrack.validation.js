import { z } from 'zod';

const ENTITY_TYPES = ['post', 'group', 'event', 'product', 'service', 'profile', 'none'];

// Bounded past/future window for occurredAt — rejects wildly-skewed client
// clocks while still tolerating mobile offline-queue batches flushed later.
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_FUTURE_MS = 5 * 60 * 1000; // 5 minutes

const occurredAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine(val => {
    const ts = new Date(val).getTime();
    const now = Date.now();
    return ts >= now - MAX_PAST_MS && ts <= now + MAX_FUTURE_MS;
  }, 'occurredAt is outside the accepted time window');

const trackEventSchema = z.object({
  clientEventId: z.string().uuid(),
  eventName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'eventName must be snake_case'),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid().nullable().optional(),
  occurredAt: occurredAtSchema,
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .refine(val => JSON.stringify(val).length <= 8192, 'properties exceeds 8KB limit'),
});

export const trackEventsSchema = z.object({
  body: z.object({
    anonymousId: z.string().max(64).optional(),
    sessionId: z.string().max(64).optional(),
    events: z.array(trackEventSchema).min(1).max(50),
  }),
});

export { ENTITY_TYPES };
