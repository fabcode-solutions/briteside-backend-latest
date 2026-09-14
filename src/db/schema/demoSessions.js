import { pgTable, uuid, varchar, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const demoSessions = pgTable('demo_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  durationMinutes: integer('duration_minutes').default(60),
  sessionType: varchar('session_type', { length: 20 }),
  meetingType: varchar('meeting_type', { length: 20 }).default('stream'),
  streamCallId: varchar('stream_call_id', { length: 255 }),
  streamCallType: varchar('stream_call_type', { length: 50 }).default('default'),
  externalMeetingLink: varchar('external_meeting_link', { length: 500 }),
  inviteLink: varchar('invite_link', { length: 500 }),
  maxParticipants: integer('max_participants'),
  status: varchar('status', { length: 20 }).default('upcoming'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
