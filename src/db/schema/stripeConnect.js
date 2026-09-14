import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';
import { organizers } from './organizers.js';

// ─── STRIPE CONNECT ACCOUNTS ─────────────────────────────────────────────────
// One per user — shared between talent and organizer payouts
export const stripeConnectAccounts = pgTable(
  'stripe_connect_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull().unique(),
    onboardingComplete: boolean('onboarding_complete').default(false),
    chargesEnabled: boolean('charges_enabled').default(false),
    payoutsEnabled: boolean('payouts_enabled').default(false),
    country: varchar('country', { length: 2 }).default('US'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_stripe_connect_user').on(table.userId),
    index('idx_stripe_connect_account').on(table.stripeAccountId),
  ]
);

// ─── USER PAYOUT METHODS ─────────────────────────────────────────────────────
// Bank / PayPal info for manual cashout requests (last 4 digits only in plain text)
export const userPayoutMethods = pgTable(
  'user_payout_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull(), // 'bank_transfer' | 'paypal'
    label: varchar('label', { length: 100 }).notNull(), // e.g. "Chase ••••4242"
    accountHolderName: varchar('account_holder_name', { length: 255 }).notNull(),
    bankName: varchar('bank_name', { length: 255 }),
    accountNumberLast4: varchar('account_number_last4', { length: 4 }),
    routingNumberLast4: varchar('routing_number_last4', { length: 4 }),
    country: varchar('country', { length: 2 }).default('US'),
    currency: varchar('currency', { length: 3 }).default('USD'),
    fullDetails: jsonb('full_details'), // server-side AES-encrypted full account details
    isDefault: boolean('is_default').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('idx_payout_methods_user').on(table.userId)]
);

// ─── TALENT PAYOUTS ───────────────────────────────────────────────────────────
// Cashout requests + processed payouts for talents
export const talentPayouts = pgTable(
  'talent_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),
    payoutMethodId: uuid('payout_method_id').references(() => userPayoutMethods.id, {
      onDelete: 'set null',
    }),
    amountCents: integer('amount_cents').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'approved' | 'paid' | 'rejected' | 'failed'
    type: varchar('type', { length: 20 }).notNull().default('standard'),
    // 'standard' | 'instant' | 'manual'
    stripePayoutId: varchar('stripe_payout_id', { length: 255 }), // po_xxx
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }), // tr_xxx
    adminNote: varchar('admin_note', { length: 500 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_talent_payouts_user').on(table.userId),
    index('idx_talent_payouts_profile').on(table.talentProfileId),
    index('idx_talent_payouts_status').on(table.status),
  ]
);

// ─── ORGANIZER PAYOUTS ────────────────────────────────────────────────────────
// Cashout requests + processed payouts for event organizers
export const organizerPayouts = pgTable(
  'organizer_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    payoutMethodId: uuid('payout_method_id').references(() => userPayoutMethods.id, {
      onDelete: 'set null',
    }),
    amountCents: integer('amount_cents').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'approved' | 'paid' | 'rejected' | 'failed' | 'held'
    type: varchar('type', { length: 20 }).notNull().default('standard'),
    // 'standard' | 'instant' | 'manual'
    stripePayoutId: varchar('stripe_payout_id', { length: 255 }),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    adminNote: varchar('admin_note', { length: 500 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_organizer_payouts_user').on(table.userId),
    index('idx_organizer_payouts_organizer').on(table.organizerId),
    index('idx_organizer_payouts_status').on(table.status),
  ]
);

// ─── GROUP PAYOUTS ────────────────────────────────────────────────────────────
// Cashout requests from group subscription earnings (group creators).
// groupId is nullable — null means a cashout from the full group wallet balance.
export const groupPayouts = pgTable(
  'group_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'), // no FK to avoid circular schema import; enforced at service layer
    payoutMethodId: uuid('payout_method_id').references(() => userPayoutMethods.id, {
      onDelete: 'set null',
    }),
    amountCents: integer('amount_cents').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'approved' | 'paid' | 'rejected' | 'failed'
    type: varchar('type', { length: 20 }).notNull().default('standard'),
    // 'standard' | 'instant' | 'manual'
    stripePayoutId: varchar('stripe_payout_id', { length: 255 }),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    adminNote: varchar('admin_note', { length: 500 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_payouts_user').on(table.userId),
    index('idx_group_payouts_group').on(table.groupId),
    index('idx_group_payouts_status').on(table.status),
  ]
);
