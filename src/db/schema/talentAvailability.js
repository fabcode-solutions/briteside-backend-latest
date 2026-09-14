import { pgTable, uuid, varchar, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { talentProfiles } from './talentProfiles.js';

/**
 * talent_availability
 *
 * Each row represents one recurring weekly availability window for a talent.
 * A talent can have multiple rows for different day patterns or time windows.
 *
 * dayOfWeek: JSON array of ISO weekday numbers [0=Sun, 1=Mon, ..., 6=Sat]
 *   e.g. [1,2,3,4,5] = Mon–Fri
 *
 * durations: JSON array of allowed session lengths in minutes
 *   e.g. [15, 30, 60]
 *
 * priceOverrides: optional JSON map of time-window multipliers
 *   e.g. { "09:00-12:00": 1.2 }  → 20% premium for morning slots
 *
 * blockedDates: JSON array of ISO date strings the talent has blocked off
 *   e.g. ["2026-04-01", "2026-04-15"]
 */
export const talentAvailability = pgTable(
  'talent_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    // Days this window applies to
    dayOfWeek: jsonb('day_of_week')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Time window (24h "HH:MM" format, stored in talent's local timezone)
    startTime: varchar('start_time', { length: 5 }).notNull(), // e.g. "09:00"
    endTime: varchar('end_time', { length: 5 }).notNull(), // e.g. "17:00"

    // Talent's IANA timezone string
    timezone: varchar('timezone', { length: 100 }).notNull().default('America/New_York'),

    // Which durations (minutes) are offered in this window
    durations: jsonb('durations')
      .notNull()
      .default(sql`'[15,30,45,60]'::jsonb`),

    // Optional per-time-window price multipliers
    priceOverrides: jsonb('price_overrides')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Specific dates the talent has blocked
    blockedDates: jsonb('blocked_dates')
      .notNull()
      .default(sql`'[]'::jsonb`),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_talent_availability_profile').on(table.talentProfileId),
    index('idx_talent_availability_active').on(table.isActive),
  ]
);
