import {
  pgTable,
  uuid,
  varchar,
  decimal,
  timestamp,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';

export const guestOrders = pgTable(
  'guest_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guestName: varchar('guest_name', { length: 255 }).notNull(),
    guestEmail: varchar('guest_email', { length: 255 }).notNull(),
    guestPhone: varchar('guest_phone', { length: 20 }),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    paymentIntentId: varchar('payment_intent_id', { length: 255 }),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    receiptUrl: varchar('receipt_url', { length: 255 }),
    isDoorSale: boolean('is_door_sale').notNull().default(true),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_guest_orders_event').on(table.eventId),
    index('idx_guest_orders_status').on(table.status),
  ]
);
