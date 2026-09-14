/**
 * Stores date-specific availability set by a talent in the /manage-schedule
 * "Daily Availability" calendar section. Each row is one time window for
 * one specific date (a talent may add multiple rows for the same date to
 * represent multiple non-contiguous windows, e.g. 09:00-12:00 and 14:00-17:00).
 *
 * These rows OVERRIDE the recurring weekly talent_availability windows for
 * the specific date. The slot-generation algorithm in
 * TalentAvailabilityService.getAvailableSlots() must check this table first:
 *
 *   if date_override rows exist for that date → use ONLY those rows
 *   else → fall back to matching talent_availability (weekly) rows
 *
 * A talent can also mark a date as fully blocked by setting isBlocked = true
 * with no time window, which replaces the "blockedDates" array approach.
 */

import {
  pgTable,
  uuid,
  varchar,
  date,
  boolean,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { talentProfiles } from './talentProfiles.js';

export const talentDateOverrides = pgTable(
  'talent_date_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    // The specific date this override applies to (YYYY-MM-DD, stored as date)
    overrideDate: date('override_date').notNull(),

    // When isBlocked = true, startTime/endTime are ignored — the full day is blocked
    isBlocked: boolean('is_blocked').notNull().default(false),

    // Time window for this override slot (24h HH:MM)
    // NULL only when isBlocked = true
    startTime: varchar('start_time', { length: 5 }), // e.g. "09:00"
    endTime: varchar('end_time', { length: 5 }), // e.g. "17:00"

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_talent_date_overrides_profile').on(table.talentProfileId),
    index('idx_talent_date_overrides_date').on(table.overrideDate),
    index('idx_talent_date_overrides_profile_date').on(table.talentProfileId, table.overrideDate),
  ]
);
