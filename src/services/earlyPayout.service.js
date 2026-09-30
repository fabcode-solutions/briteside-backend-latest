/**
 * src/services/earlyPayout.service.js
 *
 * Phase 3 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md
 * §5, Phase 3): "On-Demand Accelerated Payout" — a creator can unlock the 85%
 * standard portion of their held-back money 7 days after it was held (instead
 * of waiting the normal 14), for a 5% fee, disbursed instantly to a debit
 * card on file. The remaining 15% is unaffected — it still clears at Day 21
 * exactly as Phase 1 built it.
 *
 * checkInstantPayoutEligibility / computeEarlyPayoutEligibility (below) are
 * read-only — no money moves. claimEarlyPayout (also below) is where money
 * actually moves: it transfers the eligible 85% into the Connect balance
 * early (reusing the exact per-row mutation + idempotency key the Day-14
 * cron uses, so a concurrent cron run or a double-click can never double-
 * transfer the same row), then fires a real Instant Payout to the
 * creator's debit card for whatever Stripe computes as the fee-adjusted
 * net amount.
 *
 * TWO STRIPE DASHBOARD PREREQUISITES THIS FEATURE CANNOT SATISFY FROM CODE —
 * see PAYMENTS_ARCHITECTURE.md §3 for the full explanation:
 *   1. "Allow debit cards? Yes" under Connect → Payouts → External Accounts.
 *      Without it, no connected account can ever add a debit card via
 *      Stripe's own hosted onboarding/Express Dashboard, so
 *      checkInstantPayoutEligibility below will never return eligible.
 *   2. A 5% Instant Payout pricing rule set in the Platform Pricing Tool
 *      (Dashboard → Settings → Connect → Instant Payouts pricing). This is
 *      what makes Stripe compute `net_available` as gross-minus-5%
 *      automatically — this codebase deliberately does not hardcode or
 *      re-derive the 5% itself (see claimEarlyPayout's doc comment below),
 *      it trusts whatever the Dashboard is configured to charge.
 */

import crypto from 'crypto';
import { eq, and, isNull, gt, lte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  talentSessions,
  shopOrders,
  priorityMessagePayments,
  shopCustomServiceOffers,
  shopOfferMilestones,
} from '../db/schema/index.js';
import { stripeConnectAccounts, payoutLedgerEntries, creatorPayoutLedgers } from '../db/schema/stripeConnect.js';
import config from '../config/config.js';
import Stripe from 'stripe';
import ApiError from '../utils/api-error.js';
import { cronLogger as logger } from '../config/logger.js';
import { STANDARD_RELEASE_PORTION, transferReserve } from '../cron/reserveRelease.js';
import { PayoutLedgerService } from './payoutLedger.service.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

// Same 85/15 split Phase 1 already applies at hold time — this feature only
// changes WHEN the 85% portion can move, never the split itself. Reuses
// reserveRelease.js's own constant rather than a second hardcoded 0.85, so
// the two can never drift apart.
export const EARLY_PAYOUT_HOLD_DAYS = 7;

/**
 * Does this user's Connect account have an external account (debit card or
 * eligible bank account) that can actually receive an Instant Payout right
 * now? Read-only — never creates or modifies anything on the account.
 *
 * @returns {{ eligible: boolean, reason?: string, externalAccountId?: string }}
 */
export async function checkInstantPayoutEligibility(userId) {
  if (!stripe) return { eligible: false, reason: 'stripe_not_configured' };

  const connectAccount = await db.query.stripeConnectAccounts.findFirst({
    where: eq(stripeConnectAccounts.userId, userId),
    columns: { stripeAccountId: true, payoutsEnabled: true },
  });
  if (!connectAccount) return { eligible: false, reason: 'no_connect_account' };
  if (!connectAccount.payoutsEnabled) return { eligible: false, reason: 'payouts_not_enabled' };

  let externalAccounts;
  try {
    externalAccounts = await stripe.accounts.listExternalAccounts(connectAccount.stripeAccountId, {
      object: 'card',
      limit: 10,
    });
  } catch (err) {
    // A real external API call — key/mode mismatches, network errors, or a
    // deauthorized account can all throw here. Never let that surface as an
    // uncaught crash to the caller; report it as ineligible instead.
    return { eligible: false, reason: 'stripe_error', error: err.message };
  }

  const instantEligible = externalAccounts.data.find(acct =>
    (acct.available_payout_methods ?? []).includes('instant')
  );

  if (!instantEligible) {
    // Also check bank accounts — some countries (e.g. the UK) support
    // Instant Payouts to an eligible bank account instead of a card.
    let bankAccounts;
    try {
      bankAccounts = await stripe.accounts.listExternalAccounts(connectAccount.stripeAccountId, {
        object: 'bank_account',
        limit: 10,
      });
    } catch (err) {
      return { eligible: false, reason: 'stripe_error', error: err.message };
    }
    const instantBank = bankAccounts.data.find(acct =>
      (acct.available_payout_methods ?? []).includes('instant')
    );
    if (!instantBank) {
      return { eligible: false, reason: 'no_instant_eligible_external_account' };
    }
    return { eligible: true, externalAccountId: instantBank.id };
  }

  return { eligible: true, externalAccountId: instantEligible.id };
}

/**
 * Read-only: how much of this user's money, across all 5 flows, is at
 * least EARLY_PAYOUT_HOLD_DAYS old and hasn't had its Day-14 standard
 * release fire yet. This is the gross amount BEFORE the 5% fee — the fee is
 * computed by Stripe itself at claim time (see the file header), not here.
 *
 * @returns {{ eligibleGrossCents: number, breakdown: Array<{ sourceType: string, sourceId: string, amountCents: number }> }}
 */
export async function computeEarlyPayoutEligibility(userId) {
  const cutoff = new Date(Date.now() - EARLY_PAYOUT_HOLD_DAYS * 86_400_000);
  const breakdown = [];

  const sessionRows = await db.query.talentSessions.findMany({
    where: and(
      eq(talentSessions.status, 'completed'),
      gt(talentSessions.reserveAmountCents, 0),
      isNull(talentSessions.standardReleasedAt),
      lte(talentSessions.billingEndedAt, cutoff)
    ),
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true, reserveAmountCents: true },
  });
  for (const s of sessionRows) {
    if (s.talentProfile?.userId !== userId) continue;
    breakdown.push({
      sourceType: 'talent_session',
      sourceId: s.id,
      amountCents: Math.round(s.reserveAmountCents * STANDARD_RELEASE_PORTION),
    });
  }

  const shopOrderRows = await db.query.shopOrders.findMany({
    where: and(
      eq(shopOrders.sellerId, userId),
      eq(shopOrders.status, 'paid'),
      gt(shopOrders.reserveAmountCents, 0),
      isNull(shopOrders.standardReleasedAt),
      lte(shopOrders.paidAt, cutoff)
    ),
    columns: { id: true, reserveAmountCents: true },
  });
  for (const o of shopOrderRows) {
    breakdown.push({
      sourceType: 'shop_order',
      sourceId: o.id,
      amountCents: Math.round(o.reserveAmountCents * STANDARD_RELEASE_PORTION),
    });
  }

  const priorityMessageRows = await db.query.priorityMessagePayments.findMany({
    where: and(
      eq(priorityMessagePayments.talentUserId, userId),
      eq(priorityMessagePayments.status, 'replied'),
      gt(priorityMessagePayments.reserveAmountCents, 0),
      isNull(priorityMessagePayments.standardReleasedAt),
      lte(priorityMessagePayments.repliedAt, cutoff)
    ),
    columns: { id: true, reserveAmountCents: true },
  });
  for (const m of priorityMessageRows) {
    breakdown.push({
      sourceType: 'priority_message',
      sourceId: m.id,
      amountCents: Math.round(m.reserveAmountCents * STANDARD_RELEASE_PORTION),
    });
  }

  const customOfferRows = await db.query.shopCustomServiceOffers.findMany({
    where: and(
      eq(shopCustomServiceOffers.sellerId, userId),
      inArray(shopCustomServiceOffers.status, ['accepted', 'completed']),
      gt(shopCustomServiceOffers.reserveAmountCents, 0),
      isNull(shopCustomServiceOffers.standardReleasedAt),
      lte(shopCustomServiceOffers.deliveredAt, cutoff)
    ),
    columns: { id: true, reserveAmountCents: true },
  });
  for (const off of customOfferRows) {
    breakdown.push({
      sourceType: 'shop_custom_offer',
      sourceId: off.id,
      amountCents: Math.round(off.reserveAmountCents * STANDARD_RELEASE_PORTION),
    });
  }

  const milestoneRows = await db
    .select({
      milestoneId: shopOfferMilestones.id,
      sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
    })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(
      and(
        eq(shopCustomServiceOffers.sellerId, userId),
        eq(shopOfferMilestones.status, 'completed'),
        isNull(shopOfferMilestones.standardReleasedAt),
        gt(shopOfferMilestones.sellerReceiveCents, 0),
        lte(shopOfferMilestones.completedAt, cutoff)
      )
    );
  for (const m of milestoneRows) {
    breakdown.push({
      sourceType: 'shop_offer_milestone',
      sourceId: m.milestoneId,
      amountCents: Math.round(m.sellerReceiveCents * STANDARD_RELEASE_PORTION),
    });
  }

  const eligibleGrossCents = breakdown.reduce((sum, row) => sum + row.amountCents, 0);

  return { eligibleGrossCents, breakdown };
}

// Reuses the cron's OWN idempotency key for the same row's standard release
// (see reserveRelease.js's release<Flow>StandardReserves functions). This is
// the entire double-transfer defense: if the Day-14 cron and a user's early
// claim race for the same row, Stripe's idempotency layer collapses them
// into a single transfer no matter which call reaches Stripe first, and the
// `WHERE standardReleasedAt IS NULL` conditional update below then ensures
// only ONE of the two callers proceeds to credit the ledger for it.
function standardIdempotencyKey(sourceType, sourceId) {
  switch (sourceType) {
    case 'talent_session':
      return `reserve-session-standard-${sourceId}`;
    case 'shop_order':
      return `reserve-shop-order-standard-${sourceId}`;
    case 'priority_message':
      return `reserve-priority-message-standard-${sourceId}`;
    case 'shop_custom_offer':
      return `reserve-custom-offer-standard-${sourceId}`;
    case 'shop_offer_milestone':
      return `reserve-offer-milestone-standard-${sourceId}`;
    default:
      throw new Error(`standardIdempotencyKey: unknown sourceType "${sourceType}"`);
  }
}

// Claims one breakdown row: transfers its 85% portion into the Connect
// balance right now (instead of waiting for Day 14) and marks it released,
// but ONLY if this call is the one that actually wins the race against a
// concurrent cron pass — see standardIdempotencyKey's comment.
async function claimRow(row, connectAccountId) {
  const { sourceType, sourceId, amountCents } = row;

  const transferId = await transferReserve(connectAccountId, amountCents, {
    description: `Early claim — standard reserve release (85%, Day 7) — ${sourceType} ${sourceId}`,
    idempotencyKey: standardIdempotencyKey(sourceType, sourceId),
    metadata: {
      type: 'reserve_release',
      stage: 'standard',
      trigger: 'early_claim',
      source: sourceType,
      sourceId: String(sourceId),
    },
  });
  if (!transferId) return { won: false };

  let won;
  switch (sourceType) {
    case 'talent_session': {
      const updated = await db
        .update(talentSessions)
        .set({
          reserveAmountCents: sql`${talentSessions.reserveAmountCents} - ${amountCents}`,
          standardReleasedAt: new Date(),
        })
        .where(and(eq(talentSessions.id, sourceId), isNull(talentSessions.standardReleasedAt)))
        .returning({ id: talentSessions.id });
      won = updated.length > 0;
      break;
    }
    case 'shop_order': {
      const updated = await db
        .update(shopOrders)
        .set({
          reserveAmountCents: sql`${shopOrders.reserveAmountCents} - ${amountCents}`,
          standardReleasedAt: new Date(),
        })
        .where(and(eq(shopOrders.id, sourceId), isNull(shopOrders.standardReleasedAt)))
        .returning({ id: shopOrders.id });
      won = updated.length > 0;
      break;
    }
    case 'priority_message': {
      const updated = await db
        .update(priorityMessagePayments)
        .set({
          reserveAmountCents: sql`${priorityMessagePayments.reserveAmountCents} - ${amountCents}`,
          standardReleasedAt: new Date(),
        })
        .where(
          and(
            eq(priorityMessagePayments.id, sourceId),
            isNull(priorityMessagePayments.standardReleasedAt)
          )
        )
        .returning({ id: priorityMessagePayments.id });
      won = updated.length > 0;
      break;
    }
    case 'shop_custom_offer': {
      const updated = await db
        .update(shopCustomServiceOffers)
        .set({
          reserveAmountCents: sql`${shopCustomServiceOffers.reserveAmountCents} - ${amountCents}`,
          standardReleasedAt: new Date(),
        })
        .where(
          and(
            eq(shopCustomServiceOffers.id, sourceId),
            isNull(shopCustomServiceOffers.standardReleasedAt)
          )
        )
        .returning({ id: shopCustomServiceOffers.id });
      won = updated.length > 0;
      break;
    }
    case 'shop_offer_milestone': {
      const updated = await db
        .update(shopOfferMilestones)
        .set({ standardReleasedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(shopOfferMilestones.id, sourceId),
            eq(shopOfferMilestones.status, 'completed'),
            isNull(shopOfferMilestones.standardReleasedAt)
          )
        )
        .returning({ id: shopOfferMilestones.id });
      won = updated.length > 0;
      break;
    }
    default:
      throw new Error(`claimRow: unknown sourceType "${sourceType}"`);
  }

  if (!won) {
    // Lost the race — the cron (or a concurrent claim) already marked this
    // row released between our eligibility read and this update. The
    // transfer above either was a genuine no-op (Stripe collapsed it via
    // the shared idempotency key) or already paid the other winner; either
    // way, THIS call must not also credit the ledger for it.
    return { won: false };
  }

  await PayoutLedgerService.moveToAvailable(row.userId, 'pending', amountCents, {
    sourceType,
    sourceId,
    reason: 'day7_early_claim',
  });

  return { won: true, amountCents };
}

/**
 * Actually moves money: claims every eligible row for this user right now
 * (Day 7 instead of Day 14) and, if their Connect account can receive an
 * Instant Payout, disburses whatever Stripe reports as available for it.
 *
 * The claim (reserve → Connect balance) and the instant payout (Connect
 * balance → debit card) are treated as two separable outcomes. If the
 * Connect balance hasn't caught up with the just-completed transfers yet
 * (real Stripe balance propagation is not always instantaneous) or the
 * account isn't instant-payout eligible, the claim still succeeds — the
 * creator's held-back money is now sitting in their available balance,
 * simply not swept out synchronously in this same call. Callers should
 * check `instantPayout` before assuming the money already reached a bank.
 *
 * @returns {{
 *   claimedGrossCents: number,
 *   claimedRows: Array<{ sourceType: string, sourceId: string, amountCents: number }>,
 *   instantPayout: null | { id: string, amountCents: number, feeCents: number },
 *   skippedReason?: string,
 * }}
 */
export async function claimEarlyPayout(userId) {
  if (!stripe) throw new ApiError(400, 'Stripe is not configured.');

  const ledger = await PayoutLedgerService.getOrCreateLedger(userId);
  if (ledger.disputeFrozen) {
    throw new ApiError(403, 'Early payout is paused while a payment dispute on your account is under review.');
  }

  const connectAccount = await db.query.stripeConnectAccounts.findFirst({
    where: eq(stripeConnectAccounts.userId, userId),
    columns: { stripeAccountId: true, payoutsEnabled: true },
  });
  if (!connectAccount?.payoutsEnabled) {
    throw new ApiError(400, 'Payouts are not enabled on this account yet.');
  }

  const { breakdown } = await computeEarlyPayoutEligibility(userId);
  if (breakdown.length === 0) {
    throw new ApiError(400, 'Nothing is eligible for an early claim right now.');
  }

  const claimedRows = [];
  let claimedGrossCents = 0;

  for (const row of breakdown) {
    const result = await claimRow({ ...row, userId }, connectAccount.stripeAccountId).catch(err => {
      logger.error('[EarlyPayout] claim row failed', {
        userId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        error: err.message,
      });
      return { won: false };
    });
    if (result.won) {
      claimedRows.push({ sourceType: row.sourceType, sourceId: row.sourceId, amountCents: result.amountCents });
      claimedGrossCents += result.amountCents;
    }
  }

  if (claimedGrossCents === 0) {
    throw new ApiError(409, 'Nothing could be claimed — it may have just been released by the regular schedule instead. Try again.');
  }

  // From here on, the claim itself has already succeeded and been recorded
  // (ledger + DB rows above) — a failure below only means the instant
  // payout leg didn't happen THIS call, not that the claim is rolled back.
  const instantPayout = await dispatchInstantPayout(userId, connectAccount.stripeAccountId, claimedGrossCents, {
    idempotencyKeySeed: claimedRows.map(r => `${r.sourceType}:${r.sourceId}`).sort().join(','),
    debitReason: 'instant_payout_day7',
    debitMetadata: { claimedRows },
  });

  return { claimedGrossCents, claimedRows, ...instantPayout };
}

/**
 * Shared instant-payout dispatch — pushes `grossCents` (money already
 * released into the Connect balance by the caller) out to the creator's
 * debit card right now, for whatever fee Stripe's own Platform Pricing Tool
 * computes (this codebase never hardcodes or re-derives the 5%; see the
 * file header). Used by claimEarlyPayout (creator-initiated, always applies)
 * and by adminPayout.service.js's optional "charge the instant fee" release
 * mode — both cases are "get this money to their bank right now instead of
 * waiting," so they share the exact same Stripe mechanics.
 *
 * Never throws — every failure mode returns { instantPayout: null,
 * skippedReason }, since by the time this runs the caller's own release has
 * already succeeded and must not be treated as failed just because the
 * optional instant leg didn't complete.
 */
export async function dispatchInstantPayout(userId, stripeAccountId, grossCents, { idempotencyKeySeed, debitReason, debitMetadata = {} }) {
  const instantEligibility = await checkInstantPayoutEligibility(userId);
  if (!instantEligibility.eligible) {
    return { instantPayout: null, skippedReason: instantEligibility.reason };
  }

  let balance;
  try {
    // net_available is only computed and returned when explicitly expanded —
    // without this, Stripe omits the field entirely and every call below
    // silently treats the account as having $0 instantly available.
    // Also note the SDK's (params, options) signature: stripeAccount is an
    // option, not a param, so it must be the second argument, not merged in.
    balance = await stripe.balance.retrieve(
      { expand: ['instant_available.net_available'] },
      { stripeAccount: stripeAccountId }
    );
  } catch (err) {
    logger.error('[EarlyPayout] balance retrieve failed', { userId, error: err.message });
    return { instantPayout: null, skippedReason: 'stripe_error' };
  }

  const instantUsd = (balance.instant_available ?? []).find(b => b.currency === 'usd');
  // net_available is an array of { amount, destination } — one entry per
  // eligible external account, since different cards can carry different
  // fee rates. Match the specific destination this payout will target.
  const netAvailableEntry = (instantUsd?.net_available ?? []).find(
    n => n.destination === instantEligibility.externalAccountId
  );
  const netAvailableCents = netAvailableEntry?.amount ?? 0;

  // Capped at what THIS call released — a creator's Connect balance may
  // already hold other, unrelated available money (e.g. a Day-14/21
  // release that hasn't been swept out yet, since Phase 2's scheduled sweep
  // runs separately). Without this cap, this could inadvertently sweep out
  // that unrelated balance too.
  const instantPayoutAmountCents = Math.min(netAvailableCents, grossCents);
  if (instantPayoutAmountCents <= 0) {
    return { instantPayout: null, skippedReason: 'balance_not_yet_available' };
  }

  // Deterministic per-batch key: a retry of the exact same release reuses
  // the same key, so it can't create a second Instant Payout even if the
  // response to the first attempt was lost.
  const idempotencyKey = `instant-payout-${userId}-${crypto.createHash('sha256').update(idempotencyKeySeed).digest('hex').slice(0, 24)}`;

  let payout;
  try {
    payout = await stripe.payouts.create(
      {
        amount: instantPayoutAmountCents,
        currency: 'usd',
        method: 'instant',
        destination: instantEligibility.externalAccountId,
      },
      { stripeAccount: stripeAccountId, idempotencyKey }
    );
  } catch (err) {
    logger.error('[EarlyPayout] instant payout create failed', { userId, error: err.message });
    return { instantPayout: null, skippedReason: 'instant_payout_failed' };
  }

  // The whole released gross amount leaves the ledger's available bucket —
  // whatever the creator didn't receive in hand was retained by Stripe as
  // the Instant Payout fee, per the architecture's "85% for a 5% fee" terms.
  await PayoutLedgerService.debitAvailable(userId, grossCents, {
    sourceType: 'instant_payout',
    // Not a DB row's UUID — payoutLedgerEntries.sourceId is a uuid column,
    // so a Stripe payout id (e.g. "po_...") goes in metadata instead.
    sourceId: null,
    reason: debitReason,
    metadata: { ...debitMetadata, payoutId: payout.id, payoutAmountCents: instantPayoutAmountCents },
  }).catch(err =>
    logger.error('[EarlyPayout] ledger debit failed', { userId, payoutId: payout.id, error: err.message })
  );

  return {
    instantPayout: {
      id: payout.id,
      amountCents: instantPayoutAmountCents,
      feeCents: grossCents - instantPayoutAmountCents,
    },
  };
}

/**
 * dispatchInstantPayout's debitAvailable happens right after Stripe's
 * payouts.create() call returns — but that call succeeding only means
 * Stripe ACCEPTED the payout, not that it actually completed. Stripe can
 * still fail it asynchronously (e.g. "insufficient funds to cover the
 * transfer" on the connected account, seen live in testing). Call this from
 * the payout.failed webhook to reverse that debit so the ledger doesn't
 * claim money was paid out that Stripe actually returned to the balance.
 *
 * Idempotent: a re-delivered webhook for the same payout finds its own
 * reversal already recorded and does nothing.
 */
export async function handlePayoutFailed(payout) {
  const entry = await db.query.payoutLedgerEntries.findFirst({
    where: sql`${payoutLedgerEntries.metadata}->>'payoutId' = ${payout.id}`,
  });
  if (!entry) return; // Not one of ours (e.g. a standard/scheduled payout) — nothing to reverse.

  const alreadyReversed = await db.query.payoutLedgerEntries.findFirst({
    where: sql`${payoutLedgerEntries.metadata}->>'reversalOfPayoutId' = ${payout.id}`,
  });
  if (alreadyReversed) return;

  const ledger = await db.query.creatorPayoutLedgers.findFirst({
    where: eq(creatorPayoutLedgers.id, entry.ledgerId),
  });
  if (!ledger) return;

  await PayoutLedgerService.creditAvailable(ledger.userId, Math.abs(entry.amountCents), {
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reason: 'instant_payout_failed',
    metadata: { reversalOfPayoutId: payout.id, failureCode: payout.failure_code, failureMessage: payout.failure_message },
  });

  logger.warn('[EarlyPayout] instant payout failed, reversed ledger debit', {
    userId: ledger.userId,
    payoutId: payout.id,
    amountCents: entry.amountCents,
    failureMessage: payout.failure_message,
  });
}
