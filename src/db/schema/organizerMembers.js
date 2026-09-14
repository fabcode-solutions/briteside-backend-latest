import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizers } from './organizers.js';
import { users } from './users.js';
import { scanSessions } from './scanSessions.js';
import { eventTeamMembers } from './eventTeams.js';

export const organizerMembers = pgTable(
  'organizer_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    memberCode: varchar('member_code', { length: 50 }).notNull().unique(),
    memberName: varchar('member_name', { length: 100 }).notNull(),
    memberPassword: varchar('member_password', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 }).notNull().default('scanner'),
    permissions: text('permissions').array().default(['scan_tickets']),
    isActive: boolean('is_active').notNull().default(true),
    totalScans: integer('total_scans').notNull().default(0),
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_organizer_members_organizer').on(table.organizerId),
    index('idx_organizer_members_code').on(table.memberCode),
    index('idx_organizer_members_active').on(table.isActive),
  ]
);

export const ticketScans = pgTable(
  'ticket_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').notNull(),
    eventId: uuid('event_id').notNull(),
    organizerId: uuid('organizer_id').notNull(),
    scannedBy: uuid('scanned_by').references(() => organizerMembers.id, { onDelete: 'cascade' }),
    scannedByTeamMember: uuid('scanned_by_team_member').references(() => eventTeamMembers.id, {
      onDelete: 'cascade',
    }),
    ticketCode: varchar('ticket_code', { length: 50 }).notNull(),
    eventCode: varchar('event_code', { length: 50 }).notNull(),
    organizerCode: varchar('organizer_code', { length: 50 }).notNull(),
    scanType: varchar('scan_type', { length: 20 }).notNull().default('entry'),
    scanLocation: text('scan_location'),
    isValid: boolean('is_valid').notNull().default(true),
    sessionId: uuid('session_id').references(() => scanSessions.id),
    deviceInfo: jsonb('device_info').default(sql`'{}'::jsonb`),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    scanData: text('scan_data'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_ticket_scans_ticket').on(table.ticketId),
    index('idx_ticket_scans_event').on(table.eventId),
    index('idx_ticket_scans_member').on(table.scannedBy),
    index('idx_ticket_scans_team_member').on(table.scannedByTeamMember),
    index('idx_ticket_scans_organizer').on(table.organizerId),
    index('idx_ticket_scans_codes').on(table.ticketCode, table.eventCode),
  ]
);
