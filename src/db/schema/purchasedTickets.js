import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  timestamp,
  boolean,
  integer,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events, eventSchedules } from './events.js';
import { eventTickets } from './tickets.js';
import { users } from './users.js';
import { organizers } from './organizers.js';
import { organizerMembers } from './organizerMembers.js';
import { trackingLinks } from './trackingLinks.js';

export const purchasedTickets = pgTable(
  'purchased_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketCode: varchar('ticket_code', { length: 50 }).notNull().unique(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id')
      .notNull()
      .references(() => eventTickets.id, { onDelete: 'cascade' }),
    eventScheduleId: uuid('event_schedule_id').references(() => eventSchedules.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    holderName: varchar('holder_name', { length: 255 }).notNull(),
    holderEmail: varchar('holder_email', { length: 255 }),
    holderPhone: varchar('holder_phone', { length: 20 }),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    qrCode: text('qr_code').notNull(),
    qrCodeUrl: text('qr_code_url'),
    qrImageS3Key: text('qr_image_s3_key'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    isUsed: boolean('is_used').notNull().default(false),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => organizerMembers.id),
    scanCount: integer('scan_count').notNull().default(0),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    firstScannedAt: timestamp('first_scanned_at', { withTimezone: true }),
    scanHistory: jsonb('scan_history').default(sql`'[]'::jsonb`), // Recent scan summary
    transferredTo: uuid('transferred_to').references(() => users.id),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundAmount: decimal('refund_amount', { precision: 10, scale: 2 }),
    trackingLinkId: uuid('tracking_link_id').references(() => trackingLinks.id),
    snsSubscriptionArn: varchar('sns_subscription_arn', { length: 512 }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_purchased_tickets_event').on(table.eventId),
    index('idx_purchased_tickets_user').on(table.userId),
    index('idx_purchased_tickets_organizer').on(table.organizerId),
    index('idx_purchased_tickets_code').on(table.ticketCode),
    index('idx_purchased_tickets_tier').on(table.ticketTierId),
    index('idx_purchased_tickets_schedule').on(table.eventScheduleId),
    index('idx_purchased_tickets_used').on(table.isUsed),
    index('idx_purchased_tickets_status').on(table.status),
    index('idx_purchased_tickets_scanned_at').on(table.lastScannedAt),
    index('idx_purchased_tickets_phone').on(table.holderPhone),
    index('idx_purchased_tickets_tracking_link').on(table.trackingLinkId),
  ]
);
