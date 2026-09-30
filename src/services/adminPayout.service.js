/**
 * src/services/adminPayout.service.js
 *
 * Admin-triggered early release — not part of the original paymentsnew.pdf
 * phases, added on request: support/ops needs a way to release a creator's
 * held money before the normal Day-14/21 schedule for a specific case (an
 * escalation, a resolved dispute, etc.), without waiting for either the
 * scheduled cron or the creator's own fee-charging Phase-3 early claim.
 *
 * Unlike Phase 3's claimEarlyPayout (creator-initiated, only the 85% portion,
 * 7-day minimum), this is admin-initiated, releases the FULL remaining
 * amount in one transfer (both the 85% and 15% portions at once, whichever
 * hasn't already gone out), and has no minimum wait at all.
 *
 * By default it's free — the money lands in the creator's Connect balance
 * and waits for their normal payout schedule, same as any other release.
 * An admin can optionally ALSO push it to the creator's bank right now
 * (chargeFeeForInstant: true), reusing the exact same Instant Payout
 * mechanics as Phase 3 (dispatchInstantPayout in earlyPayout.service.js) —
 * Stripe computes the real fee itself, this code never hardcodes or
 * re-derives a percentage. If the creator has no eligible debit card, the
 * release still succeeds; only the instant leg is skipped.
 *
 * Still respects a dispute freeze — an admin who wants to release money for
 * a creator with an open dispute must resolve the dispute first, same as
 * every other release path. Every call requires a reason, recorded in the
 * ledger entry's metadata alongside the admin's id, since this bypasses the
 * normal timing rules and needs a clear audit trail.
 */

import { eq, and, gt, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  talentSessions,
  shopOrders,
  priorityMessagePayments,
  shopCustomServiceOffers,
  shopOfferMilestones,
  users,
} from '../db/schema/index.js';
import { stripeConnectAccounts, creatorPayoutLedgers } from '../db/schema/stripeConnect.js';
import ApiError from '../utils/api-error.js';
import { cronLogger as logger } from '../config/logger.js';
import { STANDARD_RELEASE_PORTION, transferReserve } from '../cron/reserveRelease.js';
import { PayoutLedgerService } from './payoutLedger.service.js';
import { dispatchInstantPayout } from './earlyPayout.service.js';

const VALID_SOURCE_TYPES = [
  'talent_session',
  'shop_order',
  'priority_message',
  'shop_custom_offer',
  'shop_offer_milestone',
];

async function assertNotFrozen(userId) {
  const ledger = await db.query.creatorPayoutLedgers.findFirst({
    where: eq(creatorPayoutLedgers.userId, userId),
    columns: { disputeFrozen: true },
  });
  if (ledger?.disputeFrozen) {
    throw new ApiError(409, 'This creator has an open dispute — resolve it before releasing held funds.');
  }
}

async function getConnectAccount(userId) {
  const connectAccount = await db.query.stripeConnectAccounts.findFirst({
    where: eq(stripeConnectAccounts.userId, userId),
    columns: { stripeAccountId: true, payoutsEnabled: true },
  });
  if (!connectAccount?.payoutsEnabled) {
    throw new ApiError(400, 'This creator has no active Stripe Connect account to release funds to.');
  }
  return connectAccount;
}

/**
 * Releases the FULL remaining held amount for one specific row, in a single
 * transfer — not staged. If the Standard (85%) stage already fired via the
 * normal cron, this only transfers whatever's left (the 15% reserve); if
 * nothing has fired yet, it transfers the whole thing at once.
 */
export async function releaseRowEarly(adminId, sourceType, sourceId, reason, { chargeFeeForInstant = false } = {}) {
  if (!VALID_SOURCE_TYPES.includes(sourceType)) {
    throw new ApiError(400, `sourceType must be one of: ${VALID_SOURCE_TYPES.join(', ')}`);
  }
  if (!reason?.trim()) {
    throw new ApiError(400, 'A reason is required for an early release.');
  }

  let userId, remainingCents, table, updateSet, whereExtra;

  switch (sourceType) {
    case 'talent_session': {
      const row = await db.query.talentSessions.findFirst({
        where: eq(talentSessions.id, sourceId),
        with: { talentProfile: { columns: { userId: true } } },
        columns: { id: true, reserveAmountCents: true },
      });
      if (!row) throw new ApiError(404, 'Session not found');
      userId = row.talentProfile?.userId;
      remainingCents = row.reserveAmountCents ?? 0;
      table = talentSessions;
      updateSet = { reserveAmountCents: 0, standardReleasedAt: new Date(), reserveReleasedAt: new Date() };
      break;
    }
    case 'shop_order': {
      const row = await db.query.shopOrders.findFirst({
        where: eq(shopOrders.id, sourceId),
        columns: { id: true, sellerId: true, reserveAmountCents: true },
      });
      if (!row) throw new ApiError(404, 'Shop order not found');
      userId = row.sellerId;
      remainingCents = row.reserveAmountCents ?? 0;
      table = shopOrders;
      updateSet = { reserveAmountCents: 0, standardReleasedAt: new Date(), reserveReleasedAt: new Date() };
      break;
    }
    case 'priority_message': {
      const row = await db.query.priorityMessagePayments.findFirst({
        where: eq(priorityMessagePayments.id, sourceId),
        columns: { id: true, talentUserId: true, reserveAmountCents: true },
      });
      if (!row) throw new ApiError(404, 'Priority message not found');
      userId = row.talentUserId;
      remainingCents = row.reserveAmountCents ?? 0;
      table = priorityMessagePayments;
      updateSet = { reserveAmountCents: 0, standardReleasedAt: new Date(), reserveReleasedAt: new Date() };
      break;
    }
    case 'shop_custom_offer': {
      const row = await db.query.shopCustomServiceOffers.findFirst({
        where: eq(shopCustomServiceOffers.id, sourceId),
        columns: { id: true, sellerId: true, reserveAmountCents: true },
      });
      if (!row) throw new ApiError(404, 'Custom offer not found');
      userId = row.sellerId;
      remainingCents = row.reserveAmountCents ?? 0;
      table = shopCustomServiceOffers;
      updateSet = { reserveAmountCents: 0, standardReleasedAt: new Date(), reserveReleasedAt: new Date() };
      break;
    }
    case 'shop_offer_milestone': {
      const row = await db
        .select({
          id: shopOfferMilestones.id,
          sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
          standardReleasedAt: shopOfferMilestones.standardReleasedAt,
          status: shopOfferMilestones.status,
          sellerId: shopCustomServiceOffers.sellerId,
        })
        .from(shopOfferMilestones)
        .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
        .where(eq(shopOfferMilestones.id, sourceId))
        .then(rows => rows[0]);
      if (!row) throw new ApiError(404, 'Milestone not found');
      if (row.status !== 'completed') {
        throw new ApiError(409, `Only a completed milestone can be released (this one is ${row.status})`);
      }
      userId = row.sellerId;
      remainingCents = row.standardReleasedAt
        ? row.sellerReceiveCents - Math.round(row.sellerReceiveCents * STANDARD_RELEASE_PORTION)
        : row.sellerReceiveCents;
      table = shopOfferMilestones;
      updateSet = {
        status: 'released',
        standardReleasedAt: row.standardReleasedAt ?? new Date(),
        releasedAt: new Date(),
        updatedAt: new Date(),
      };
      whereExtra = eq(shopOfferMilestones.status, 'completed');
      break;
    }
  }

  if (!userId) throw new ApiError(404, 'Could not determine the creator for this row.');
  if (remainingCents <= 0) throw new ApiError(409, 'Nothing is currently held for this row.');

  await assertNotFrozen(userId);
  const connectAccount = await getConnectAccount(userId);

  const transferId = await transferReserve(connectAccount.stripeAccountId, remainingCents, {
    description: `Admin early release — ${sourceType} ${sourceId}`,
    idempotencyKey: `admin-early-release-${sourceType}-${sourceId}`,
    metadata: {
      type: 'reserve_release',
      stage: 'admin_early_release',
      source: sourceType,
      sourceId: String(sourceId),
      adminId,
    },
  });
  if (!transferId) throw new ApiError(502, 'Stripe transfer failed — nothing was released.');

  if (sourceType === 'shop_offer_milestone') {
    updateSet.transferId = transferId;
  }

  // Conditional on the row still being un-released — the DB-level guard
  // against a concurrent cron run grabbing the same money at the same time.
  // A residual race remains if this call and a concurrent cron transfer both
  // read the row as eligible before either commits (documented, not fully
  // eliminated) — acceptable given how rare it is for an admin action to
  // land in the same instant as the daily 1am cron.
  const amountColumn = table.reserveAmountCents ?? table.sellerReceiveCents;
  const conditions = [eq(table.id, sourceId), gt(amountColumn, 0)];
  if (whereExtra) conditions.push(whereExtra);

  const updated = await db
    .update(table)
    .set(updateSet)
    .where(and(...conditions))
    .returning({ id: table.id });

  if (!updated.length) {
    logger.warn('[AdminPayout] releaseRowEarly lost the race — already released elsewhere', {
      sourceType,
      sourceId,
      adminId,
    });
    throw new ApiError(409, 'This row was already released by another process (likely the scheduled cron) just now.');
  }

  await PayoutLedgerService.releaseRemainingToAvailable(userId, remainingCents, {
    sourceType,
    sourceId,
    reason: 'admin_early_release',
    metadata: { adminId, reason },
  });

  logger.info('[AdminPayout] row released early', {
    sourceType,
    sourceId,
    userId,
    adminId,
    amountUsd: (remainingCents / 100).toFixed(2),
    transferId,
    reason,
  });

  let instantResult = { instantPayout: null, skippedReason: null };
  if (chargeFeeForInstant) {
    instantResult = await dispatchInstantPayout(userId, connectAccount.stripeAccountId, remainingCents, {
      idempotencyKeySeed: `admin-early-release-${sourceType}-${sourceId}`,
      debitReason: 'instant_payout_admin_release',
      debitMetadata: { adminId, reason, sourceType, sourceId },
    });
  }

  return {
    sourceType,
    sourceId,
    userId,
    amountCents: remainingCents,
    transferId,
    ...instantResult,
  };
}

function fullName(user) {
  if (!user) return 'Unknown';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.username || 'Unknown';
}

function fmtDate(date) {
  return date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/**
 * Human-readable list of everything currently held for one creator — the
 * non-technical front end for releaseRowEarly/releaseAllForCreator. No admin
 * should ever need to know a raw sourceId; this is how they find one.
 */
export async function listHeldForCreator(userId) {
  const rows = [];

  const sessions = await db.query.talentSessions.findMany({
    where: gt(talentSessions.reserveAmountCents, 0),
    with: { talentProfile: { columns: { userId: true } }, booker: { columns: { firstName: true, lastName: true, username: true } } },
    columns: { id: true, reserveAmountCents: true, scheduledAt: true },
  });
  for (const s of sessions) {
    if (s.talentProfile?.userId !== userId) continue;
    rows.push({
      sourceType: 'talent_session',
      sourceId: s.id,
      amountCents: s.reserveAmountCents,
      description: `1:1 video session with ${fullName(s.booker)} — ${fmtDate(s.scheduledAt)}`,
      heldSince: s.scheduledAt,
    });
  }

  const shopOrderRows = await db
    .select({
      id: shopOrders.id,
      reserveAmountCents: shopOrders.reserveAmountCents,
      productTitleSnapshot: shopOrders.productTitleSnapshot,
      paidAt: shopOrders.paidAt,
    })
    .from(shopOrders)
    .where(and(eq(shopOrders.sellerId, userId), gt(shopOrders.reserveAmountCents, 0)))
    .orderBy(desc(shopOrders.paidAt));
  for (const o of shopOrderRows) {
    rows.push({
      sourceType: 'shop_order',
      sourceId: o.id,
      amountCents: o.reserveAmountCents,
      description: `Shop order: ${o.productTitleSnapshot}`,
      heldSince: o.paidAt,
    });
  }

  const messageRows = await db
    .select({
      id: priorityMessagePayments.id,
      reserveAmountCents: priorityMessagePayments.reserveAmountCents,
      messageCount: priorityMessagePayments.messageCount,
      paidAt: priorityMessagePayments.paidAt,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderUsername: users.username,
    })
    .from(priorityMessagePayments)
    .innerJoin(users, eq(priorityMessagePayments.senderId, users.id))
    .where(and(eq(priorityMessagePayments.talentUserId, userId), gt(priorityMessagePayments.reserveAmountCents, 0)))
    .orderBy(desc(priorityMessagePayments.paidAt));
  for (const m of messageRows) {
    const senderName = fullName({ firstName: m.senderFirstName, lastName: m.senderLastName, username: m.senderUsername });
    rows.push({
      sourceType: 'priority_message',
      sourceId: m.id,
      amountCents: m.reserveAmountCents,
      description: `Priority message${m.messageCount > 1 ? ` (${m.messageCount})` : ''} from ${senderName}`,
      heldSince: m.paidAt,
    });
  }

  const offerRows = await db
    .select({
      id: shopCustomServiceOffers.id,
      reserveAmountCents: shopCustomServiceOffers.reserveAmountCents,
      title: shopCustomServiceOffers.title,
      createdAt: shopCustomServiceOffers.createdAt,
    })
    .from(shopCustomServiceOffers)
    .where(and(eq(shopCustomServiceOffers.sellerId, userId), gt(shopCustomServiceOffers.reserveAmountCents, 0)))
    .orderBy(desc(shopCustomServiceOffers.createdAt));
  for (const o of offerRows) {
    rows.push({
      sourceType: 'shop_custom_offer',
      sourceId: o.id,
      amountCents: o.reserveAmountCents,
      description: `Custom offer: ${o.title}`,
      heldSince: o.createdAt,
    });
  }

  const milestoneRows = await db
    .select({
      id: shopOfferMilestones.id,
      position: shopOfferMilestones.position,
      sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
      standardReleasedAt: shopOfferMilestones.standardReleasedAt,
      completedAt: shopOfferMilestones.completedAt,
      offerTitle: shopCustomServiceOffers.title,
    })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(
      and(
        eq(shopCustomServiceOffers.sellerId, userId),
        eq(shopOfferMilestones.status, 'completed'),
        gt(shopOfferMilestones.sellerReceiveCents, 0)
      )
    )
    .orderBy(desc(shopOfferMilestones.completedAt));
  for (const m of milestoneRows) {
    const remaining = m.standardReleasedAt
      ? m.sellerReceiveCents - Math.round(m.sellerReceiveCents * STANDARD_RELEASE_PORTION)
      : m.sellerReceiveCents;
    if (remaining <= 0) continue;
    rows.push({
      sourceType: 'shop_offer_milestone',
      sourceId: m.id,
      amountCents: remaining,
      description: `${m.offerTitle} — Milestone ${m.position + 1}`,
      heldSince: m.completedAt,
    });
  }

  rows.sort((a, b) => new Date(b.heldSince ?? 0) - new Date(a.heldSince ?? 0));
  return rows;
}

/**
 * Releases EVERY currently-held row for one creator across all 5 flows, in
 * one pass. Each row goes through the exact same releaseRowEarly logic (and
 * the same dispute-freeze check), so a failure on one row doesn't affect the
 * others — this returns a per-row result list rather than throwing on the
 * first failure.
 */
export async function releaseAllForCreator(adminId, userId, reason, { chargeFeeForInstant = false } = {}) {
  if (!reason?.trim()) {
    throw new ApiError(400, 'A reason is required for an early release.');
  }
  await assertNotFrozen(userId);

  const candidates = [];

  const sessions = await db.query.talentSessions.findMany({
    where: gt(talentSessions.reserveAmountCents, 0),
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true },
  });
  for (const s of sessions) {
    if (s.talentProfile?.userId === userId) candidates.push({ sourceType: 'talent_session', sourceId: s.id });
  }

  const shopOrderRows = await db.query.shopOrders.findMany({
    where: and(eq(shopOrders.sellerId, userId), gt(shopOrders.reserveAmountCents, 0)),
    columns: { id: true },
  });
  candidates.push(...shopOrderRows.map(r => ({ sourceType: 'shop_order', sourceId: r.id })));

  const messages = await db.query.priorityMessagePayments.findMany({
    where: and(eq(priorityMessagePayments.talentUserId, userId), gt(priorityMessagePayments.reserveAmountCents, 0)),
    columns: { id: true },
  });
  candidates.push(...messages.map(r => ({ sourceType: 'priority_message', sourceId: r.id })));

  const offers = await db.query.shopCustomServiceOffers.findMany({
    where: and(eq(shopCustomServiceOffers.sellerId, userId), gt(shopCustomServiceOffers.reserveAmountCents, 0)),
    columns: { id: true },
  });
  candidates.push(...offers.map(r => ({ sourceType: 'shop_custom_offer', sourceId: r.id })));

  const milestones = await db
    .select({ id: shopOfferMilestones.id })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(
      and(
        eq(shopCustomServiceOffers.sellerId, userId),
        eq(shopOfferMilestones.status, 'completed'),
        gt(shopOfferMilestones.sellerReceiveCents, 0)
      )
    );
  candidates.push(...milestones.map(r => ({ sourceType: 'shop_offer_milestone', sourceId: r.id })));

  const results = [];
  // Each row releases WITHOUT its own instant leg — a single combined
  // Instant Payout runs once at the end for the whole batch instead, so a
  // 10-row release doesn't create 10 separate Stripe payouts (and 10
  // separate fee deductions) when 1 does the job.
  for (const candidate of candidates) {
    const result = await releaseRowEarly(adminId, candidate.sourceType, candidate.sourceId, reason).catch(err => ({
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      error: err.message,
    }));
    results.push(result);
  }

  const releasedCents = results.reduce((sum, r) => sum + (r.error ? 0 : r.amountCents), 0);

  let instantResult = { instantPayout: null, skippedReason: null };
  if (chargeFeeForInstant && releasedCents > 0) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, userId),
      columns: { stripeAccountId: true },
    });
    if (connectAccount) {
      instantResult = await dispatchInstantPayout(userId, connectAccount.stripeAccountId, releasedCents, {
        idempotencyKeySeed: `admin-release-creator-${userId}-${results.map(r => r.sourceId).sort().join(',')}`,
        debitReason: 'instant_payout_admin_release',
        debitMetadata: { adminId, reason, userId },
      });
    }
  }

  return {
    userId,
    adminId,
    reason,
    releasedCount: results.filter(r => !r.error).length,
    releasedCents,
    results,
    ...instantResult,
  };
}
