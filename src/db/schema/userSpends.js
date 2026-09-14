import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';
import { groups } from './groups.js';

export const spendTypeEnum = pgEnum('spend_type', [
  'ticket_purchase',
  'platform_subscription',
  'group_subscription',
  'talent_session',
  'priority_message',
  // Appended, never inserted mid-list: Postgres orders enum values by their
  // declaration position, so reordering would change existing comparisons.
  'shop',
]);

export const userSpends = pgTable(
  'user_spends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spendType: spendTypeEnum('spend_type').notNull(),
    // Positive = spend, negative = refund
    amountCents: integer('amount_cents').notNull(),
    // FK to source record (orderId, sessionId, paymentId, subscriptionId, refundId)
    referenceId: uuid('reference_id').notNull(),
    // Human-readable mirror: 'order' | 'talent_session' | 'priority_message_payment' | 'user_subscription' | 'group_subscription' | 'refund'
    referenceType: varchar('reference_type', { length: 50 }).notNull(),
    // Nullable context columns
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    talentUserId: uuid('talent_user_id').references(() => users.id, { onDelete: 'set null' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    // Type-specific extras (see spec for shape per spend type)
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    // Stripe identifiers — stored but NEVER sent to frontend
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    // Marker to indicate the original spend has been refunded
    isRefunded: boolean('is_refunded').notNull().default(false),
    // Flexible refund details (refund id, status, source flow, partial/full notes, etc.)
    refundMeta: jsonb('refund_meta').default(sql`'{}'::jsonb`),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_user_spends_user_id').on(table.userId),
    index('idx_user_spends_spend_type').on(table.spendType),
    index('idx_user_spends_paid_at').on(table.paidAt),
    index('idx_user_spends_is_refunded').on(table.isRefunded),
    index('idx_user_spends_event_id').on(table.eventId),
    index('idx_user_spends_talent_user_id').on(table.talentUserId),
    index('idx_user_spends_reference_id').on(table.referenceId),
  ]
);
