/**
 * src/services/payoutLedger.service.js
 *
 * Phase 1 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md).
 *
 * Tracks each user's Pending/Available/Reserve balance. This is bookkeeping
 * only — it records what SHOULD be true about a user's balance in parallel
 * with the real Stripe money movement (still done by cron/reserveRelease.js
 * exactly as before, just now split into two passes). Nothing here replaces
 * a Stripe API call; every method that changes a bucket is meant to be
 * called right alongside the existing reserve/transfer logic, never instead
 * of it.
 *
 * All balance changes go through here so every one gets a paired, signed
 * payoutLedgerEntries row — the running totals on creatorPayoutLedgers must
 * always be reconstructable by summing those rows.
 */

import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { creatorPayoutLedgers, payoutLedgerEntries, paymentDisputes } from '../db/schema/stripeConnect.js';

export class PayoutLedgerService {
  static async getOrCreateLedger(userId) {
    const existing = await db.query.creatorPayoutLedgers.findFirst({
      where: eq(creatorPayoutLedgers.userId, userId),
    });
    if (existing) return existing;

    try {
      const [created] = await db.insert(creatorPayoutLedgers).values({ userId }).returning();
      return created;
    } catch (err) {
      // Race: another concurrent call inserted the same user's row first —
      // the unique constraint on userId rejects ours, so just re-fetch it.
      const raced = await db.query.creatorPayoutLedgers.findFirst({
        where: eq(creatorPayoutLedgers.userId, userId),
      });
      if (raced) return raced;
      throw err;
    }
  }

  /**
   * Credits a transaction's held-back money into a user's ledger at the
   * moment it's first known (i.e. right where reserveAmountCents is set
   * today) — split into its 85% "pending" portion (clears Day 14) and 15%
   * "reserve" portion (clears Day 21). Call once per transaction; a later
   * top-up (e.g. a tip) on the same source row should call this again with
   * just the new amount, same as reserveAmountCents already accumulates.
   */
  static async creditHold(userId, totalCents, { sourceType, sourceId, metadata = {} } = {}) {
    if (!totalCents || totalCents <= 0) return null;

    const reserveCents = Math.round(totalCents * 0.15);
    const pendingCents = totalCents - reserveCents;

    const ledger = await this.getOrCreateLedger(userId);

    await db
      .update(creatorPayoutLedgers)
      .set({
        pendingCents: sql`${creatorPayoutLedgers.pendingCents} + ${pendingCents}`,
        reserveCents: sql`${creatorPayoutLedgers.reserveCents} + ${reserveCents}`,
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    await db.insert(payoutLedgerEntries).values([
      {
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: 'pending',
        amountCents: pendingCents,
        reason: 'initial_hold',
        metadata,
      },
      {
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: 'reserve',
        amountCents: reserveCents,
        reason: 'initial_hold',
        metadata,
      },
    ]);

    return { ledgerId: ledger.id, pendingCents, reserveCents };
  }

  /**
   * Moves money from 'pending' or 'reserve' into 'available' — call this
   * right where the cron actually transfers money to the seller's Connect
   * balance (once the transfer succeeds), never speculatively ahead of it.
   */
  static async moveToAvailable(userId, fromBucket, amountCents, { sourceType, sourceId, reason, metadata = {} } = {}) {
    if (!amountCents || amountCents <= 0) return null;
    if (fromBucket !== 'pending' && fromBucket !== 'reserve') {
      throw new Error(`moveToAvailable: invalid fromBucket "${fromBucket}"`);
    }

    const ledger = await this.getOrCreateLedger(userId);
    const bucketColumn =
      fromBucket === 'pending' ? creatorPayoutLedgers.pendingCents : creatorPayoutLedgers.reserveCents;

    await db
      .update(creatorPayoutLedgers)
      .set({
        [fromBucket === 'pending' ? 'pendingCents' : 'reserveCents']: sql`${bucketColumn} - ${amountCents}`,
        availableCents: sql`${creatorPayoutLedgers.availableCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    await db.insert(payoutLedgerEntries).values([
      {
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: fromBucket,
        amountCents: -amountCents,
        reason,
        metadata: { ...metadata, movedTo: 'available' },
      },
      {
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: 'available',
        amountCents,
        reason,
        metadata: { ...metadata, movedFrom: fromBucket },
      },
    ]);

    return ledger.id;
  }

  /**
   * Like moveToAvailable, but for a release whose exact 85/15 bucket split
   * can't be precisely known — e.g. the "final" (Day 21) release on a flow
   * that lets a late top-up (a tip) land after the row's own Day 14
   * "standard" release already fired. The row-level reserveAmountCents
   * being released may by then be a mix of unreleased reserve and a fresh
   * top-up's own pending share; rather than guess, this drains from
   * whatever the ledger itself currently records — reserve first, then
   * pending for any remainder — so the ledger never claims a bucket
   * balance it doesn't actually have.
   */
  static async releaseRemainingToAvailable(userId, amountCents, { sourceType, sourceId, reason, metadata = {} } = {}) {
    if (!amountCents || amountCents <= 0) return null;
    const ledger = await this.getOrCreateLedger(userId);
    const fromReserve = Math.min(amountCents, Math.max(0, ledger.reserveCents));
    const fromPending = amountCents - fromReserve;
    if (fromReserve > 0) {
      await this.moveToAvailable(userId, 'reserve', fromReserve, { sourceType, sourceId, reason, metadata });
    }
    if (fromPending > 0) {
      await this.moveToAvailable(userId, 'pending', fromPending, { sourceType, sourceId, reason, metadata });
    }
    return ledger.id;
  }

  /**
   * Debits 'available' when money actually leaves the platform for the
   * creator — a scheduled sweep, an on-demand withdrawal, or an instant
   * payout. Distinct from moveToAvailable (which is an internal bucket
   * transition, not money leaving); this is the only place availableCents
   * should ever decrease.
   */
  static async debitAvailable(userId, amountCents, { sourceType, sourceId, reason, metadata = {} } = {}) {
    if (!amountCents || amountCents <= 0) return null;
    const ledger = await this.getOrCreateLedger(userId);

    await db
      .update(creatorPayoutLedgers)
      .set({
        availableCents: sql`${creatorPayoutLedgers.availableCents} - ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    await db.insert(payoutLedgerEntries).values({
      ledgerId: ledger.id,
      sourceType,
      sourceId,
      bucket: 'available',
      amountCents: -amountCents,
      reason,
      metadata,
    });

    return ledger.id;
  }

  /**
   * Reverses a debitAvailable — call this when money that was already
   * debited turns out not to have actually left the platform (e.g. an
   * Instant Payout that Stripe accepted at creation time but then failed
   * asynchronously; see handlePayoutFailed in earlyPayout.service.js).
   */
  static async creditAvailable(userId, amountCents, { sourceType, sourceId, reason, metadata = {} } = {}) {
    if (!amountCents || amountCents <= 0) return null;
    const ledger = await this.getOrCreateLedger(userId);

    await db
      .update(creatorPayoutLedgers)
      .set({
        availableCents: sql`${creatorPayoutLedgers.availableCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    await db.insert(payoutLedgerEntries).values({
      ledgerId: ledger.id,
      sourceType,
      sourceId,
      bucket: 'available',
      amountCents,
      reason,
      metadata,
    });

    return ledger.id;
  }

  /**
   * Flips a creator's sweep toggle — 'auto' (default; swept on the 1st/15th
   * automatically) or 'manual' (accumulates in Available until the creator
   * withdraws it themselves). Never touches balances, only the switch.
   */
  static async setPayoutSchedule(userId, mode) {
    if (mode !== 'auto' && mode !== 'manual') {
      throw new Error(`setPayoutSchedule: invalid mode "${mode}"`);
    }
    const ledger = await this.getOrCreateLedger(userId);
    await db
      .update(creatorPayoutLedgers)
      .set({ payoutSchedule: mode, updatedAt: new Date() })
      .where(eq(creatorPayoutLedgers.id, ledger.id));
    return { ...ledger, payoutSchedule: mode };
  }

  // ─── Phase 4: disputes ──────────────────────────────────────────────────────

  /**
   * A dispute opened against this creator — pulls the disputed amount out
   * of the ledger (reserve first, then pending for any remainder, same
   * drain order as releaseRemainingToAvailable) and freezes the ledger so
   * nothing else releases while it's under review. No real Stripe money
   * moves here — Stripe already auto-debited the platform's own balance;
   * this is purely the bookkeeping side of "pull from Reserve first."
   *
   * @returns {{ reserveDebitedCents: number, pendingDebitedCents: number }}
   */
  static async debitForDispute(userId, amountCents, { sourceType, sourceId, reason = 'dispute_debit', metadata = {} } = {}) {
    const ledger = await this.getOrCreateLedger(userId);
    if (!amountCents || amountCents <= 0) {
      await this.freeze(userId);
      return { reserveDebitedCents: 0, pendingDebitedCents: 0 };
    }

    const reserveDebitedCents = Math.min(amountCents, Math.max(0, ledger.reserveCents));
    const pendingDebitedCents = Math.min(amountCents - reserveDebitedCents, Math.max(0, ledger.pendingCents));

    await db
      .update(creatorPayoutLedgers)
      .set({
        reserveCents: sql`${creatorPayoutLedgers.reserveCents} - ${reserveDebitedCents}`,
        pendingCents: sql`${creatorPayoutLedgers.pendingCents} - ${pendingDebitedCents}`,
        disputeFrozen: true,
        disputeFrozenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    const entries = [];
    if (reserveDebitedCents > 0) {
      entries.push({
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: 'reserve',
        amountCents: -reserveDebitedCents,
        reason,
        metadata,
      });
    }
    if (pendingDebitedCents > 0) {
      entries.push({
        ledgerId: ledger.id,
        sourceType,
        sourceId,
        bucket: 'pending',
        amountCents: -pendingDebitedCents,
        reason,
        metadata,
      });
    }
    if (entries.length) await db.insert(payoutLedgerEntries).values(entries);

    return { reserveDebitedCents, pendingDebitedCents };
  }

  /** Freezes without any balance change — used when a dispute can't be attributed to an amount yet. */
  static async freeze(userId) {
    const ledger = await this.getOrCreateLedger(userId);
    await db
      .update(creatorPayoutLedgers)
      .set({ disputeFrozen: true, disputeFrozenAt: new Date(), updatedAt: new Date() })
      .where(eq(creatorPayoutLedgers.id, ledger.id));
  }

  /**
   * A dispute resolved in the creator's favor — Stripe reverses its earlier
   * automatic debit from the platform balance, so credit back exactly what
   * debitForDispute took (never more, even if other activity has since
   * changed the ledger).
   */
  static async creditBackDispute(userId, { reserveCents = 0, pendingCents = 0 }, { sourceType, sourceId, reason = 'dispute_reversal', metadata = {} } = {}) {
    const ledger = await this.getOrCreateLedger(userId);
    if (reserveCents <= 0 && pendingCents <= 0) return;

    await db
      .update(creatorPayoutLedgers)
      .set({
        reserveCents: sql`${creatorPayoutLedgers.reserveCents} + ${reserveCents}`,
        pendingCents: sql`${creatorPayoutLedgers.pendingCents} + ${pendingCents}`,
        updatedAt: new Date(),
      })
      .where(eq(creatorPayoutLedgers.id, ledger.id));

    const entries = [];
    if (reserveCents > 0) {
      entries.push({ ledgerId: ledger.id, sourceType, sourceId, bucket: 'reserve', amountCents: reserveCents, reason, metadata });
    }
    if (pendingCents > 0) {
      entries.push({ ledgerId: ledger.id, sourceType, sourceId, bucket: 'pending', amountCents: pendingCents, reason, metadata });
    }
    if (entries.length) await db.insert(payoutLedgerEntries).values(entries);
  }

  /** Unfreezes only if no OTHER open dispute remains against this creator. */
  static async unfreezeIfNoOtherOpenDisputes(userId, excludeDisputeId) {
    const otherOpen = await db.query.paymentDisputes.findFirst({
      where: and(
        eq(paymentDisputes.userId, userId),
        eq(paymentDisputes.status, 'open'),
        ne(paymentDisputes.id, excludeDisputeId)
      ),
      columns: { id: true },
    });
    if (otherOpen) return false;

    const ledger = await this.getOrCreateLedger(userId);
    await db
      .update(creatorPayoutLedgers)
      .set({ disputeFrozen: false, disputeFrozenAt: null, updatedAt: new Date() })
      .where(eq(creatorPayoutLedgers.id, ledger.id));
    return true;
  }
}
