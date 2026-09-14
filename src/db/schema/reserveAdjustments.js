import { pgTable, uuid, integer, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { orders } from './payments.js';
import { events, organizers } from './index.js';

export const reserveAdjustments = pgTable('reserve_adjustments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id),
  eventId: uuid('event_id').references(() => events.id),
  organizerId: uuid('organizer_id').references(() => organizers.id),
  adminId: uuid('admin_id').notNull(),
  action: varchar('action', { length: 30 }).notNull(), // 'set_amount' | 'adjust_amount' | 'release'
  previousAmountCents: integer('previous_amount_cents'),
  newAmountCents: integer('new_amount_cents'),
  deltaCents: integer('delta_cents'),
  transferId: varchar('transfer_id', { length: 255 }),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});