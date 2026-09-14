import { pgTable, uuid, varchar, decimal, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { users } from './users.js';
import { organizers } from './organizers.js';
import { eventMerchandise } from './tickets.js';

export const purchasedMerchandise = pgTable(
  'purchased_merchandise',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchandiseCode: varchar('merchandise_code', { length: 50 }).notNull().unique(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    merchandiseId: uuid('merchandise_id')
      .notNull()
      .references(() => eventMerchandise.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    holderName: varchar('holder_name', { length: 255 }).notNull(),
    holderEmail: varchar('holder_email', { length: 255 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
    totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundAmount: decimal('refund_amount', { precision: 10, scale: 2 }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  table => [
    index('idx_purchased_merchandise_event').on(table.eventId),
    index('idx_purchased_merchandise_user').on(table.userId),
    index('idx_purchased_merchandise_organizer').on(table.organizerId),
    index('idx_purchased_merchandise_status').on(table.status),
  ]
);
