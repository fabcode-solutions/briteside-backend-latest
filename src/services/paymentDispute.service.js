/**
 * src/services/paymentDispute.service.js
 *
 * Phase 4 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md
 * §5, Phase 4): admin-mediated dispute handling.
 *
 * Stripe auto-debits a disputed charge from the PLATFORM's own balance —
 * never from the creator's Connect balance (this app's charges are all
 * "separate charges and transfers": the platform receives the charge
 * directly, the creator's cut moves later via a standalone transfer). So
 * there is no automatic clawback to build for money ALREADY transferred —
 * see PAYMENTS_ARCHITECTURE.md §4's transfer-linkage gap for why (only
 * shop_offer_milestones cleanly links one charge to one transfer; the other
 * 4 flows batch or overwrite that link). What this DOES automate, per the
 * doc's own policy ("a chargeback must pull from the still-held Reserve
 * first and freeze the creator's other pending money"):
 *   1. Debit the disputed amount from the creator's ledger (reserve first,
 *      then pending), so their tracked balance reflects the loss.
 *   2. Prevent the specific disputed row's own future release (so the cron
 *      doesn't later transfer money for a transaction Stripe already took
 *      back from the platform).
 *   3. Freeze the creator's ENTIRE ledger (no sweep, no withdrawal, no
 *      early claim) until the dispute resolves.
 *   4. Record it durably (payment_disputes) with requiresManualReview set
 *      whenever automatic reconciliation can't fully account for it — an
 *      admin panel reading that table is the intended next step, not built
 *      here.
 *
 * Requires the Stripe Dashboard webhook endpoint to be subscribed to
 * charge.dispute.created and charge.dispute.closed — that's a Dashboard
 * setting, not something this code can enable.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  talentSessions,
  talentSessionTips,
  shopOrders,
  priorityMessagePayments,
  shopCustomServiceOffers,
  shopOfferMilestones,
  shopCustomOfferTips,
} from '../db/schema/index.js';
import { paymentDisputes } from '../db/schema/stripeConnect.js';
import { cronLogger as logger } from '../config/logger.js';
import { PayoutLedgerService } from './payoutLedger.service.js';

/**
 * Finds which of the 5 flows a disputed payment intent belongs to, and the
 * creator (userId) whose money is at stake. Tries each table in turn —
 * cheap, since a payment intent id only ever matches at most one row across
 * all of them. Returns null if nothing matches (e.g. an event ticket order,
 * a charge type not covered yet, or a custom offer's remainder that
 * overwrote its own row's single stripePaymentIntentId column — see the
 * §4 transfer-linkage gap note in the file header).
 */
export async function resolveDisputeSource(paymentIntentId) {
  if (!paymentIntentId) return null;

  const session = await db.query.talentSessions.findFirst({
    where: eq(talentSessions.stripePaymentIntentId, paymentIntentId),
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true, reserveAmountCents: true, standardReleasedAt: true },
  });
  if (session?.talentProfile?.userId) {
    return {
      sourceType: 'talent_session',
      sourceId: session.id,
      userId: session.talentProfile.userId,
      table: talentSessions,
      row: session,
    };
  }

  const tip = await db.query.talentSessionTips.findFirst({
    where: eq(talentSessionTips.stripePaymentIntentId, paymentIntentId),
    columns: { id: true, talentUserId: true },
  });
  if (tip) {
    // A tip has no reserve field of its own — it was folded into the
    // session's reserveAmountCents at payment time — so there is no row to
    // adjust here, only a creator to identify and freeze.
    return { sourceType: 'talent_session_tip', sourceId: tip.id, userId: tip.talentUserId, table: null, row: null };
  }

  const shopOrder = await db.query.shopOrders.findFirst({
    where: eq(shopOrders.stripePaymentIntentId, paymentIntentId),
    columns: { id: true, sellerId: true, reserveAmountCents: true, standardReleasedAt: true },
  });
  if (shopOrder) {
    return {
      sourceType: 'shop_order',
      sourceId: shopOrder.id,
      userId: shopOrder.sellerId,
      table: shopOrders,
      row: shopOrder,
    };
  }

  const message = await db.query.priorityMessagePayments.findFirst({
    where: eq(priorityMessagePayments.stripePaymentIntent, paymentIntentId),
    columns: { id: true, talentUserId: true, reserveAmountCents: true, standardReleasedAt: true },
  });
  if (message) {
    return {
      sourceType: 'priority_message',
      sourceId: message.id,
      userId: message.talentUserId,
      table: priorityMessagePayments,
      row: message,
    };
  }

  const offer = await db.query.shopCustomServiceOffers.findFirst({
    where: eq(shopCustomServiceOffers.stripePaymentIntentId, paymentIntentId),
    columns: { id: true, sellerId: true, reserveAmountCents: true, standardReleasedAt: true },
  });
  if (offer) {
    return {
      sourceType: 'shop_custom_offer',
      sourceId: offer.id,
      userId: offer.sellerId,
      table: shopCustomServiceOffers,
      row: offer,
    };
  }

  const milestone = await db
    .select({
      id: shopOfferMilestones.id,
      sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
      standardReleasedAt: shopOfferMilestones.standardReleasedAt,
      sellerId: shopCustomServiceOffers.sellerId,
    })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(eq(shopOfferMilestones.stripePaymentIntentId, paymentIntentId))
    .then(rows => rows[0]);
  if (milestone) {
    return {
      sourceType: 'shop_offer_milestone',
      sourceId: milestone.id,
      userId: milestone.sellerId,
      table: shopOfferMilestones,
      row: { reserveAmountCents: milestone.sellerReceiveCents, standardReleasedAt: milestone.standardReleasedAt },
    };
  }

  const offerTip = await db.query.shopCustomOfferTips.findFirst({
    where: eq(shopCustomOfferTips.stripePaymentIntentId, paymentIntentId),
    columns: { id: true, sellerId: true },
  });
  if (offerTip) {
    return { sourceType: 'shop_custom_offer_tip', sourceId: offerTip.id, userId: offerTip.sellerId, table: null, row: null };
  }

  return null;
}

/**
 * Prevents this specific row's still-unreleased money from being paid out
 * later — decrements its reserve field by whatever the dispute claims, down
 * to zero. Rows with no reserve field of their own (a tip) are a no-op here;
 * the creator-level freeze (below) is what protects those.
 */
async function neutralizeRowReserve(resolved, disputeAmountCents) {
  if (!resolved.table || !resolved.row) return 0;
  const currentReserve = resolved.row.reserveAmountCents ?? 0;
  const amountToRemove = Math.min(disputeAmountCents, Math.max(0, currentReserve));
  if (amountToRemove <= 0) return 0;

  await db
    .update(resolved.table)
    .set({ reserveAmountCents: sql`GREATEST(${resolved.table.reserveAmountCents} - ${amountToRemove}, 0)` })
    .where(eq(resolved.table.id, resolved.sourceId));

  return amountToRemove;
}

export async function handleDisputeCreated(dispute) {
  const existing = await db.query.paymentDisputes.findFirst({
    where: eq(paymentDisputes.stripeDisputeId, dispute.id),
  });
  if (existing) return existing; // Stripe may retry the webhook

  const paymentIntentId =
    typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  const resolved = await resolveDisputeSource(paymentIntentId).catch(err => {
    logger.error('[PaymentDispute] resolveDisputeSource failed', { disputeId: dispute.id, error: err.message });
    return null;
  });

  let reserveDebitedCents = 0;
  let pendingDebitedCents = 0;
  let requiresManualReview = !resolved;

  if (resolved?.userId) {
    // Already-released money (standardReleasedAt set) has no reliable
    // automatic clawback for 4 of 5 flows — flag it instead of pretending
    // the ledger debit alone made the platform whole.
    if (resolved.row?.standardReleasedAt) requiresManualReview = true;

    await neutralizeRowReserve(resolved, dispute.amount).catch(err =>
      logger.error('[PaymentDispute] neutralizeRowReserve failed', { disputeId: dispute.id, error: err.message })
    );

    const debited = await PayoutLedgerService.debitForDispute(resolved.userId, dispute.amount, {
      sourceType: resolved.sourceType,
      sourceId: resolved.sourceId,
      metadata: { disputeId: dispute.id, reason: dispute.reason },
    }).catch(err => {
      logger.error('[PaymentDispute] debitForDispute failed', { disputeId: dispute.id, error: err.message });
      return { reserveDebitedCents: 0, pendingDebitedCents: 0 };
    });
    reserveDebitedCents = debited.reserveDebitedCents;
    pendingDebitedCents = debited.pendingDebitedCents;
  } else {
    logger.error('[PaymentDispute] could not resolve source for dispute — requires manual review', {
      disputeId: dispute.id,
      paymentIntentId,
      amountUsd: (dispute.amount / 100).toFixed(2),
    });
  }

  const [record] = await db
    .insert(paymentDisputes)
    .values({
      stripeDisputeId: dispute.id,
      stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
      stripePaymentIntentId: paymentIntentId ?? null,
      sourceType: resolved?.sourceType ?? null,
      sourceId: resolved?.sourceId ?? null,
      userId: resolved?.userId ?? null,
      amountCents: dispute.amount,
      reason: dispute.reason ?? null,
      status: 'open',
      reserveDebitedCents,
      pendingDebitedCents,
      requiresManualReview,
    })
    .returning();

  logger.error('[PaymentDispute] dispute opened', {
    disputeId: dispute.id,
    sourceType: resolved?.sourceType ?? 'UNRESOLVED',
    userId: resolved?.userId ?? null,
    amountUsd: (dispute.amount / 100).toFixed(2),
    requiresManualReview,
  });

  return record;
}

export async function handleDisputeClosed(dispute) {
  const record = await db.query.paymentDisputes.findFirst({
    where: eq(paymentDisputes.stripeDisputeId, dispute.id),
  });
  if (!record) {
    logger.error('[PaymentDispute] dispute closed but no local record found', { disputeId: dispute.id });
    return null;
  }
  if (record.status !== 'open') return record; // already processed

  const won = dispute.status === 'won';
  const newStatus = won ? 'won' : 'lost';

  const [updated] = await db
    .update(paymentDisputes)
    .set({ status: newStatus, resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(paymentDisputes.id, record.id), eq(paymentDisputes.status, 'open')))
    .returning();
  if (!updated) return record; // lost the race to a concurrent webhook delivery

  if (won && record.userId) {
    await PayoutLedgerService.creditBackDispute(
      record.userId,
      { reserveCents: record.reserveDebitedCents, pendingCents: record.pendingDebitedCents },
      { sourceType: record.sourceType, sourceId: record.sourceId, metadata: { disputeId: dispute.id } }
    ).catch(err =>
      logger.error('[PaymentDispute] creditBackDispute failed', { disputeId: dispute.id, error: err.message })
    );
  }

  if (record.userId) {
    await PayoutLedgerService.unfreezeIfNoOtherOpenDisputes(record.userId, record.id).catch(err =>
      logger.error('[PaymentDispute] unfreeze failed', { disputeId: dispute.id, error: err.message })
    );
  }

  logger.error('[PaymentDispute] dispute closed', { disputeId: dispute.id, status: newStatus });
  return updated;
}

/** For an admin panel — not built here, but every dispute this reconciled imperfectly is queryable. */
export async function listRequiringReview() {
  return db.query.paymentDisputes.findMany({
    where: and(eq(paymentDisputes.requiresManualReview, true), eq(paymentDisputes.status, 'open')),
  });
}
