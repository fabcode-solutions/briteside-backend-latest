import { pgTable, uuid, varchar, timestamp, text, jsonb, index } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { organizers } from './organizers.js';
import { organizerMembers } from './organizerMembers.js';
import { eventTeamMembers } from './eventTeams.js';

export const scanSessions = pgTable(
  'scan_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => organizerMembers.id),
    teamMemberId: uuid('team_member_id').references(() => eventTeamMembers.id),
    eventId: uuid('event_id').references(() => events.id),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    deviceInfo: jsonb('device_info').default('{}'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_scan_sessions_organizer').on(table.organizerId),
    index('idx_scan_sessions_member').on(table.memberId),
    index('idx_scan_sessions_event').on(table.eventId),
  ]
);
