import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { users } from './users.js';

export const eventTeams = pgTable('event_teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdBy: uuid('created_by').references(() => users.id),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const eventTeamRoles = pgTable('event_team_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  permissions: jsonb('permissions')
    .default(sql`'[]'::jsonb`)
    .notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const eventTeamMembers = pgTable(
  'event_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => eventTeams.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').references(() => eventTeamRoles.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    memberCode: varchar('member_code', { length: 64 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    permissions: jsonb('permissions')
      .default(sql`'[]'::jsonb`)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastAuthenticatedAt: timestamp('last_authenticated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_event_team_event').on(table.teamId),
    index('idx_event_team_member_code').on(table.memberCode),
    index('idx_event_team_members_user').on(table.userId),
  ]
);
