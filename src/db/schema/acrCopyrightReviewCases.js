import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { media } from './fileTracking.js';
import { users } from './users.js';
import { acrCopyrightScans } from './acrCopyrightScans.js';

/**
 * ACRCloud Copyright Review Cases
 * One row per media file that ever got an ACRCloud `match` verdict — created
 * once, never duplicated on rescans/retries (unique on media_id). Purely an
 * admin review queue: creating a case never blocks, deletes, or quarantines
 * the video; only a human admin decision (reviewEntity-style action) changes
 * its status. Fully independent of `content_moderation` and `acr_copyright_scans`
 * (which this references read-only for the full match payload).
 */
export const acrCopyrightReviewCases = pgTable(
  'acr_copyright_review_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => acrCopyrightScans.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // uploader
    // Top match's details, promoted to columns for listing/filtering. The
    // full ACRCloud match object (all fields) is kept in matchDetails below.
    songTitle: varchar('song_title', { length: 255 }),
    artist: varchar('artist', { length: 255 }),
    label: varchar('label', { length: 255 }),
    score: integer('score'),
    acrid: varchar('acrid', { length: 64 }),
    matchDetails: jsonb('match_details'), // full ACRCloud metadata.music[0] entry
    // pending | reviewed | dismissed | confirmed_infringement
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // One case per media file — a rescan/retry that returns 'match' again
    // must never create a second case or silently overwrite an admin's
    // existing decision (enforced via onConflictDoNothing at insert time).
    uniqueIndex('idx_acr_review_cases_media').on(table.mediaId),
    index('idx_acr_review_cases_status').on(table.status),
  ]
);
