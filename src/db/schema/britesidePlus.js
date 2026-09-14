import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// ─── STRIPE CUSTOMERS ────────────────────────────────────────────────────────
// Maps platform users to Stripe customer IDs (1:1)
export const stripeCustomers = pgTable(
  'stripe_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_stripe_customers_user').on(table.userId),
    index('idx_stripe_customers_stripe_id').on(table.stripeCustomerId),
  ]
);

// ─── SUBSCRIPTION PLANS ──────────────────────────────────────────────────────
// Admin-managed BriteSide Plus plans (monthly, annual, etc.)
export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),
    interval: varchar('interval', { length: 20 }).notNull(), // 'month' | 'year'
    stripePriceId: varchar('stripe_price_id', { length: 255 }).unique(),
    stripeProductId: varchar('stripe_product_id', { length: 255 }),
    isActive: boolean('is_active').default(true),
    displayOrder: integer('display_order').default(0),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_subscription_plans_active').on(table.isActive),
    index('idx_subscription_plans_order').on(table.displayOrder),
  ]
);

// ─── SUBSCRIPTION FEATURES ──────────────────────────────────────────────────
// Features linked to each plan (e.g. priority_messaging, verified_badge)
export const subscriptionFeatures = pgTable(
  'subscription_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'cascade' }),
    featureKey: varchar('feature_key', { length: 100 }).notNull(),
    featureLabel: varchar('feature_label', { length: 255 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    unique('uq_plan_feature_key').on(table.planId, table.featureKey),
    index('idx_subscription_features_plan').on(table.planId),
  ]
);

// ─── USER SUBSCRIPTIONS ─────────────────────────────────────────────────────
// Tracks each user's subscription to a BriteSide Plus plan
export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // 'active' | 'past_due' | 'canceled' | 'expired' | 'incomplete' | 'trialing' | 'comped'
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantReason: text('grant_reason'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_user_subscriptions_user').on(table.userId),
    index('idx_user_subscriptions_plan').on(table.planId),
    index('idx_user_subscriptions_status').on(table.status),
    index('idx_user_subscriptions_stripe').on(table.stripeSubscriptionId),
  ]
);

// ─── SUBSCRIPTION AUDIT LOGS ────────────────────────────────────────────────
// Tracks all subscription-related actions for audit trail
export const subscriptionAuditLogs = pgTable(
  'subscription_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userSubscriptionId: uuid('user_subscription_id').references(() => userSubscriptions.id, {
      onDelete: 'set null',
    }),
    planId: uuid('plan_id').references(() => subscriptionPlans.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // 'admin' | 'user' | 'system'
    action: varchar('action', { length: 50 }).notNull(),
    // 'plan_created' | 'plan_updated' | 'plan_deactivated' | 'subscribed' | 'canceled' |
    // 'renewed' | 'expired' | 'comped' | 'revoked' | 'feature_added' | 'feature_removed'
    previousValues: jsonb('previous_values'),
    newValues: jsonb('new_values'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_sub_audit_subscription').on(table.userSubscriptionId),
    index('idx_sub_audit_plan').on(table.planId),
    index('idx_sub_audit_actor').on(table.actorId),
    index('idx_sub_audit_created').on(table.createdAt),
  ]
);
