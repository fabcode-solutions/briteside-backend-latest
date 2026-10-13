import { pgTable, uuid, varchar, jsonb, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { media } from './fileTracking.js';
import { users } from './users.js';

/**
 * ACRCloud Copyright Audio Scans
 * One row per scanned video file, fully independent of `content_moderation`.
 * A copyright match here never changes a moderation status, flips an S3 ACL,
 * or triggers a moderation notification — it's a separate record for the
 * admin team to review (see CopyrightScanService).
 */
export const acrCopyrightScans = pgTable(
  'acr_copyright_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // pending | clean | match | error | no_audio
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    matches: jsonb('matches').default(sql`'[]'::jsonb`), // ACRCloud metadata.music entries
    errorMessage: text('error_message'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // One scan row per media file — re-scans upsert in place.
    uniqueIndex('idx_acr_copyright_scans_media').on(table.mediaId),
    index('idx_acr_copyright_scans_status').on(table.status),
  ]
);
