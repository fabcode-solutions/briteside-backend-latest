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

// ─── CREATOR PAYOUT LEDGERS ───────────────────────────────────────────────────
// Phase 0 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md).
// One row per USER, tracking the three-bucket balance the doc describes.
//
// Keyed by userId, not by a (talentProfileId|organizerId|groupId) role
// context like the existing *_payouts request tables above: a Stripe Connect
// account — and therefore a real, spendable balance — is 1:1 per user
// regardless of which dashboard (talent/organizer/group) they earned it
// from. shop_orders.sellerId and shop_custom_service_offers.sellerId in
// particular reference users.id directly, with no talentProfileId at all, so
// keying this table by role would either fail to hold shop earnings or
// fragment one person's real balance across multiple rows. Which flow a
// credit came from is recorded per-entry instead, via
// payoutLedgerEntries.sourceType below — this table only holds the totals.
//
// Purely additive — nothing reads or writes this yet; no existing behavior
// changes until Phase 1 wires a flow's reserve release into bucket
// transitions instead of the current single-release cron.
export const creatorPayoutLedgers = pgTable(
  'creator_payout_ledgers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The Stripe-account-holder — resolves to stripe_connect_accounts.userId.
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Held, not yet clock-eligible to move to the next bucket.
    pendingCents: integer('pending_cents').notNull().default(0),
    // Cleared and eligible for the scheduled sweep or an on-demand withdrawal.
    availableCents: integer('available_cents').notNull().default(0),
    // The 15% slice, held until Day 21 regardless of the other 85%'s path.
    reserveCents: integer('reserve_cents').notNull().default(0),
    // 'auto' (swept on the 1st/15th, default) | 'manual' (accumulates until
    // the creator withdraws it themselves).
    payoutSchedule: varchar('payout_schedule', { length: 10 }).notNull().default('auto'),
    // Phase 4: set true the moment ANY dispute opens against this creator —
    // per the architecture doc, "freeze the creator's other pending money
    // until resolved." Checked by the release cron, the sweep, on-demand
    // withdrawal, and the early-payout claim; all four must refuse/skip
    // while this is true.
    disputeFrozen: boolean('dispute_frozen').notNull().default(false),
    disputeFrozenAt: timestamp('dispute_frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('idx_creator_payout_ledgers_user').on(table.userId)]
);

// ─── PAYOUT LEDGER ENTRIES ────────────────────────────────────────────────────
// Append-only audit trail for every bucket credit/debit/transition. A
// ledger's running balances (above) must always be reconstructable by
// summing these rows — never trust a mutated running total on its own.
export const payoutLedgerEntries = pgTable(
  'payout_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ledgerId: uuid('ledger_id')
      .notNull()
      .references(() => creatorPayoutLedgers.id, { onDelete: 'cascade' }),
    // e.g. 'shop_order' | 'shop_custom_offer' | 'shop_offer_milestone' |
    // 'talent_session' | 'talent_session_tip' | 'priority_message' | 'sweep' |
    // 'manual_withdrawal' | 'instant_payout' | 'dispute_adjustment'
    sourceType: varchar('source_type', { length: 30 }).notNull(),
    // The originating transaction row's id — nullable for entries not tied to
    // one source transaction (a sweep payout, a dispute adjustment).
    sourceId: uuid('source_id'),
    // Which bucket this entry affects: 'pending' | 'available' | 'reserve'.
    bucket: varchar('bucket', { length: 10 }).notNull(),
    // Signed: positive = credit into the bucket, negative = debit out of it.
    amountCents: integer('amount_cents').notNull(),
    // e.g. 'initial_hold' | 'day14_clear' | 'day21_clear' | 'sweep_payout' |
    // 'manual_withdrawal' | 'instant_payout_fee' | 'dispute_debit'
    reason: varchar('reason', { length: 40 }).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_payout_ledger_entries_ledger').on(table.ledgerId),
    index('idx_payout_ledger_entries_source').on(table.sourceType, table.sourceId),
    index('idx_payout_ledger_entries_created').on(table.createdAt),
  ]
);

// ─── PAYMENT DISPUTES ─────────────────────────────────────────────────────────
// Phase 4 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md
// §5, Phase 4): admin-mediated dispute handling. Stripe debits a disputed
// charge from the PLATFORM's own balance automatically — never the creator's
// Connect balance — so this table exists to (a) record every dispute for
// admin visibility and (b) drive the ledger-side bookkeeping ("pull from the
// still-held Reserve first, freeze the rest") even though no real money
// movement happens here on open. Recovering money ALREADY transferred to a
// creator (standardReleasedAt already set on the source row) has no reliable
// automatic path for 4 of 5 flows — see PAYMENTS_ARCHITECTURE.md §4's
// transfer-linkage gap — so those cases are flagged requiresManualReview
// instead of attempted automatically.
export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stripeDisputeId: varchar('stripe_dispute_id', { length: 255 }).notNull().unique(),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    // Null when the disputed charge couldn't be matched to any of the 5
    // flows' tables (e.g. a tip, or a charge type not covered yet) — still
    // recorded, always requiresManualReview in that case.
    sourceType: varchar('source_type', { length: 30 }),
    sourceId: uuid('source_id'),
    // The creator being disputed against — nullable only if resolution
    // couldn't identify anyone at all.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    reason: varchar('reason', { length: 50 }),
    // 'open' | 'won' (platform/creator prevailed, Stripe reverses its debit)
    // | 'lost' (debit stands)
    status: varchar('status', { length: 20 }).notNull().default('open'),
    // How much of the dispute this row's OWN ledger debit actually pulled
    // from each bucket — needed to credit the exact amount back if won.
    reserveDebitedCents: integer('reserve_debited_cents').notNull().default(0),
    pendingDebitedCents: integer('pending_debited_cents').notNull().default(0),
    requiresManualReview: boolean('requires_manual_review').notNull().default(false),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_payment_disputes_user').on(table.userId),
    index('idx_payment_disputes_status').on(table.status),
  ]
);
