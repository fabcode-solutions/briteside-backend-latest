import { pgTable, uuid, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// ─── IAP transaction claims ────────────────────────────────────────────────
//
// One row per App Store / Google Play purchase ever credited to anything.
// Priority messages and shop listings sell the SAME consumable price tiers
// (iapTiers.js), so the per-table unique indexes on iap_transaction_id can't
// stop one purchase being redeemed once in each table — this table's
// (store, transaction_id) unique index does. Inserted in the same DB
// transaction as the order/payment it pays for (IapClaimService.claim).
//
//   purpose      — 'priority_message' | 'shop_order'
//   reference_id — priority_message_payments.id | shop_orders.id
//   environment  — 'production' | 'sandbox' (Apple Sandbox / TestFlight /
//                  App Review, or a Google license-tester / promo purchase).
//                  Sandbox purchases are recorded with zero money amounts.

export const iapTransactionClaims = pgTable(
  'iap_transaction_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    store: varchar('store', { length: 10 }).notNull(),
    transactionId: varchar('transaction_id', { length: 255 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 30 }).notNull(),
    referenceId: uuid('reference_id'),
    productId: varchar('product_id', { length: 255 }).notNull(),
    environment: varchar('environment', { length: 12 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('idx_iap_claims_store_txn').on(table.store, table.transactionId),
    index('idx_iap_claims_user').on(table.userId),
    index('idx_iap_claims_reference').on(table.purpose, table.referenceId),
  ]
);
