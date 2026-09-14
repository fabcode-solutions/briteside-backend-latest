import { pgTable, uuid, varchar, timestamp, unique, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { users } from './users.js';
import { orders } from './payments.js';
import { eventTickets } from './tickets.js';
import { organizerMembers } from './organizerMembers.js';
import { eventTeamMembers } from './eventTeams.js';
import { organizers } from './organizers.js';

export const eventAttendees = pgTable(
  'event_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    ticketTierId: uuid('ticket_tier_id').references(() => eventTickets.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 20 }).notNull().default('registered'),
    checkInMethod: varchar('check_in_method', { length: 20 }),
    checkedInBy: uuid('checked_in_by').references(() => users.id),
    checkedInByMember: uuid('checked_in_by_member').references(() => organizerMembers.id),
    checkedInByTeamMember: uuid('checked_in_by_team_member').references(() => eventTeamMembers.id, {
      onDelete: 'set null',
    }),
    checkInDeviceInfo: jsonb('check_in_device_info').default(sql`'{}'::jsonb`),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    unique().on(table.eventId, table.userId),
    index('idx_event_attendees_event').on(table.eventId),
    index('idx_event_attendees_user').on(table.userId),
  ]
);

export const eventInvitations = pgTable(
  'event_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeId: uuid('invitee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    unique().on(table.eventId, table.inviteeId),
    index('idx_event_invitations_event').on(table.eventId),
    index('idx_event_invitations_inviter').on(table.inviterId),
    index('idx_event_invitations_invitee').on(table.inviteeId),
    index('idx_event_invitations_status').on(table.status),
  ]
);

export const followerInviteLog = pgTable(
  'follower_invite_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_follower_invite_log_organizer').on(table.organizerId),
    index('idx_follower_invite_log_event').on(table.eventId),
  ]
);
