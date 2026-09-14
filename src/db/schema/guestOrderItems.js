import { pgTable, uuid, integer, decimal, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { guestOrders } from './guestOrders.js';
import { eventTickets } from './tickets.js';

export const guestOrderItems = pgTable(
  'guest_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guestOrderId: uuid('guest_order_id')
      .notNull()
      .references(() => guestOrders.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id')
      .notNull()
      .references(() => eventTickets.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_guest_order_items_guest_order').on(table.guestOrderId),
    index('idx_guest_order_items_tier').on(table.ticketTierId),
  ]
);
