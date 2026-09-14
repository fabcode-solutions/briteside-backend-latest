import {
  pgTable,
  uuid,
  varchar,
  decimal,
  boolean,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { groups } from './groups.js';

// Group subscription tiers (like Locals.org)
export const groupSubscriptionTiers = pgTable('group_subscription_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  billingInterval: varchar('billing_interval', { length: 20 }).notNull().default('monthly'),
  features: varchar('features', { length: 1000 }),
  maxMembers: integer('max_members'),
  isActive: boolean('is_active').default(true),
  stripeProductId: varchar('stripe_product_id', { length: 255 }),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// User subscriptions to groups
export const groupSubscriptions = pgTable(
  'group_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => groupSubscriptionTiers.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    platformFeePercent: decimal('platform_fee_percent', { precision: 5, scale: 2 }),
    refundId: varchar('refund_id', { length: 255 }),
    refundStatus: varchar('refund_status', { length: 20 }),
    refundAmount: integer('refund_amount'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_subscriptions_user').on(table.userId),
    index('idx_group_subscriptions_group').on(table.groupId),
  ]
);
