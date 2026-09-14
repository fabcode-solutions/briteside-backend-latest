import {
  pgTable,
  uuid,
  varchar,
  decimal,
  boolean,
  timestamp,
  jsonb,
  text,
  integer,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  methodType: varchar('method_type', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  details: jsonb('details').notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, {
      onDelete: 'set null',
    }),
    paymentIntentId: varchar('payment_intent_id', { length: 255 }),
    billingAddress: jsonb('billing_address'),
    qrVerified: boolean('qr_verified').default(false),
    qrVerifiedAt: timestamp('qr_verified_at', { withTimezone: true }),
    receiptUrl: varchar('receipt_url', { length: 255 }).default(null),
    reserveAmountCents: integer('reserve_amount_cents').default(0),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),
    platformShareCents: integer('platform_share_cents').default(0),
    stripeFeeCents: integer('stripe_fee_cents').default(0),
    // Set once Stripe actually creates the Connect transfer for this charge —
    // null means the organizer's cut is still sitting in the platform balance
    // (e.g. organizer's connect account wasn't chargesEnabled yet at charge time).
    transferId: varchar('transfer_id', { length: 255 }),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    check('total_amount_check', sql`${table.totalAmount} >= 0`),
    index('idx_orders_user').on(table.userId),
    index('idx_orders_event').on(table.eventId),
    index('idx_orders_status').on(table.status),
  ]
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    itemType: varchar('item_type', { length: 20 }).notNull(),
    itemId: uuid('item_id').notNull(),
    purchasedTicketId: uuid('purchased_ticket_id'),
    purchasedMerchandiseId: uuid('purchased_merchandise_id'),
    purchasedItemIds: jsonb('purchased_item_ids').default(sql`'[]'::jsonb`),
    quantity: integer('quantity').notNull().default(1),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    check('quantity_check', sql`${table.quantity} > 0`),
    check('price_check', sql`${table.price} >= 0`),
  ]
);

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
  refundType: varchar('refund_type', { length: 20 }).default('full'),
  refundedItems: jsonb('refunded_items'),
  stripeMeta: jsonb('stripe_meta'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
