import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { users } from './users.js';
import { eventTeamMembers } from './eventTeams.js';

export const eventBlasts = pgTable(
  'event_blasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    sentByTeamMember: uuid('sent_by_team_member').references(() => eventTeamMembers.id, {
      onDelete: 'set null',
    }),
    type: varchar('type', { length: 10 }).notNull(), // 'sms' | 'email'
    subject: varchar('subject', { length: 255 }),
    message: text('message').notNull(),
    recipientCount: integer('recipient_count').default(0).notNull(),
    successCount: integer('success_count').default(0).notNull(),
    failureCount: integer('failure_count').default(0).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_event_blasts_event').on(table.eventId),
    index('idx_event_blasts_event_created').on(table.eventId, table.createdAt),
  ]
);
