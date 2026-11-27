/**
 * Auto-renewing subscriptions a business buys in the app through Apple / Google
 * (today: the $5/month video cover — services/businessVideoCover.service.js).
 *
 * One row per store subscription: Apple's originalTransactionId, or Google's
 * purchaseToken (a resubscribe / plan change on Google issues a new token —
 * its row points at the old one via linkedPurchaseToken). The stores are the
 * source of truth: every purchase, renewal, cancellation or refund re-reads
 * the subscription from the store and copies its state here, then onto the
 * business (businesses.videoCoverUntil).
 */
import { pgTable, uuid, varchar, timestamp, boolean, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users.js';
import { businesses } from './businesses.js';

export const businessStoreSubscriptions = pgTable(
  'business_store_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Who bought it (owner / team member with billing access)
    purchasedBy: uuid('purchased_by').references(() => users.id, { onDelete: 'set null' }),
    // 'video_cover'
    feature: varchar('feature', { length: 30 }).notNull(),
    // 'apple' | 'google' (in the app) | 'stripe' (on the web)
    store: varchar('store', { length: 10 }).notNull(),
    productId: varchar('product_id', { length: 100 }).notNull(),
    // Apple originalTransactionId / Google purchaseToken / Stripe subscription id
    storeSubscriptionId: varchar('store_subscription_id', { length: 512 }).notNull(),
    // Apple: latest transactionId; Google: latest orderId
    latestTransactionId: varchar('latest_transaction_id', { length: 255 }),
    // Google: the token this one replaced (resubscribe / upgrade)
    linkedPurchaseToken: varchar('linked_purchase_token', { length: 512 }),
    // 'active' | 'grace' (renewal failing, still on) | 'on_hold' | 'expired' | 'revoked' (refunded)
    status: varchar('status', { length: 15 }).notNull(),
    // When paid time (incl. grace) ends; on while in the future
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    autoRenew: boolean('auto_renew').notNull().default(false),
    // 'production' | 'sandbox'
    environment: varchar('environment', { length: 12 }).notNull().default('production'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_business_store_subs_store_id').on(table.store, table.storeSubscriptionId),
    index('idx_business_store_subs_business').on(table.businessId, table.feature),
    check('chk_business_store_subs_store', sql`${table.store} IN ('apple', 'google', 'stripe')`),
  ]
);

export const businessStoreSubscriptionsRelations = relations(businessStoreSubscriptions, ({ one }) => ({
  business: one(businesses, {
    fields: [businessStoreSubscriptions.businessId],
    references: [businesses.id],
  }),
}));
