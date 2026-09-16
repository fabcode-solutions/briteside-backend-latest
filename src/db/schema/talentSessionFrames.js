import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { talentSessions } from './talentSessions.js';

/**
 * talent_session_frames
 *
 * Durable S3 archive of call-moderation frames captured on a talent session.
 * Two independent reasons a frame lands here (a frame can satisfy both, in
 * which case one row is written with reason='moderation_flag' — the stronger
 * signal for the admin gallery):
 *
 *   moderation_flag — the frame's verdict was flagged/rejected/shadowed
 *                      (see TalentSessionService.applyFrameVerdict)
 *   report_sample   — the frame landed on one of the session's randomly
 *                      chosen report-screenshot target offsets, regardless
 *                      of its own verdict (see talentSessions.reportScreenshotTargets)
 */
export const talentSessionFrames = pgTable(
  'talent_session_frames',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => talentSessions.id, { onDelete: 'cascade' }),

    trackType: varchar('track_type', { length: 64 }),
    participantId: uuid('participant_id'),

    s3Bucket: varchar('s3_bucket', { length: 255 }).notNull(),
    s3Key: varchar('s3_key', { length: 512 }).notNull(),

    moderationAction: varchar('moderation_action', { length: 32 }),
    reason: varchar('reason', { length: 32 }).notNull(), // 'moderation_flag' | 'report_sample'
    reviewQueueItemId: varchar('review_queue_item_id', { length: 255 }),

    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_talent_session_frames_session').on(table.sessionId)]
);

export const talentSessionFramesRelations = relations(talentSessionFrames, ({ one }) => ({
  session: one(talentSessions, {
    fields: [talentSessionFrames.sessionId],
    references: [talentSessions.id],
  }),
}));
