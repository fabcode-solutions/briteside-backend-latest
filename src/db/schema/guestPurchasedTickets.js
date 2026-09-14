import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { eventTickets } from './tickets.js';
import { guestOrders } from './guestOrders.js';

export const guestPurchasedTickets = pgTable('guest_purchased_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketCode: varchar('ticket_code', { length: 50 }).notNull().unique(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  ticketTierId: uuid('ticket_tier_id')
    .notNull()
    .references(() => eventTickets.id, { onDelete: 'cascade' }),
  guestOrderId: uuid('guest_order_id')
    .notNull()
    .references(() => guestOrders.id, { onDelete: 'cascade' }),
  holderName: varchar('holder_name', { length: 255 }).notNull(),
  holderEmail: varchar('holder_email', { length: 255 }),
  holderPhone: varchar('holder_phone', { length: 20 }),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  qrCode: text('qr_code').notNull(),
  qrCodeUrl: text('qr_code_url'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  isUsed: boolean('is_used').notNull().default(false),
  usedAt: timestamp('used_at', { withTimezone: true }),
  scanCount: integer('scan_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
