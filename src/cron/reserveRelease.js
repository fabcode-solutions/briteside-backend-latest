import Stripe from 'stripe';
import { eq, and, isNull, isNotNull, lte, gt, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  talentSessions,
  orders,
  events,
  organizers,
  shopOrders,
  priorityMessagePayments,
  shopCustomServiceOffers,
  shopOfferMilestones,
} from '../db/schema/index.js';
import { stripeConnectAccounts, creatorPayoutLedgers } from '../db/schema/stripeConnect.js';
import config from '../config/config.js';
import { cronLogger as logger } from '../config/logger.js';
import { PayoutLedgerService } from '../services/payoutLedger.service.js';

const stripe = config.stripe?.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;

// ─── Phase 1 of the paymentsnew.pdf payout architecture ───────────────────────
// See PAYMENTS_ARCHITECTURE.md. Every flow below now releases in TWO stages
// instead of one: 85% at Day 14 ("standard"), the remaining 15% at Day 21
// ("final") — replacing each flow's old single-release hold window (mostly
// 7 days, 48h for priority messages). `reserveAmountCents` keeps its exact
// existing meaning everywhere else in the codebase ("total still held back,
// not yet released" — decremented, never overwritten); `reserveReleasedAt`
// keeps its exact existing meaning too ("fully released"). The only new
// column each flow gained is `standardReleasedAt`, gating the new
// intermediate Day 14 pass. Nothing outside this file needs to change to
// keep working exactly as before.
export const STANDARD_RELEASE_HOLD_DAYS = 14;
export const FINAL_RELEASE_HOLD_DAYS = 21;
export const STANDARD_RELEASE_PORTION = 0.85;

// Order reserves (event tickets): released N days after the event ends
// (dispute buffer). Per Briteside payout guidelines: T+2 (48 hours / 2
// business days) post-event. Deliberately UNCHANGED by Phase 1 — event
// tickets already use a different, pre-existing 85/15 model (85% pays out
// immediately at charge time via a Stripe destination charge; only the 15%
// organizer reserve is held here), not the flat-then-staged model the other
// five flows used. See PAYMENTS_ARCHITECTURE.md §1.3.
const EVENT_RESERVE_HOLD_DAYS = 2;

// Phase 4: a creator's ledger is frozen the moment ANY dispute opens against
// them (see paymentDispute.service.js) — every release function below must
// skip their rows entirely until it's resolved, or the cron would transfer
// money out from underneath an open dispute investigation.
async function isLedgerFrozen(userId) {
  const ledger = await db.query.creatorPayoutLedgers.findFirst({
    where: eq(creatorPayoutLedgers.userId, userId),
    columns: { disputeFrozen: true },
  });
  return ledger?.disputeFrozen === true;
}

export async function transferReserve(
  stripeAccountId,
  amountCents,
  { description, idempotencyKey, metadata, transferGroup }
) {
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency: 'usd',
        destination: stripeAccountId,
        description,
        metadata,
        ...(transferGroup ? { transfer_group: transferGroup } : {}),
      },
      { idempotencyKey }
    );
    return transfer.id;
  } catch (err) {
    logger.error('[Cron] ReserveRelease: transfer failed', {
      error: err.message,
      stack: err.stack,
    });
    return null;
  }
}

// ─── 1:1 Video Sessions (+ tips) ───────────────────────────────────────────────

export async function releaseSessionStandardReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping session standard reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - STANDARD_RELEASE_HOLD_DAYS * 86_400_000);

  const sessionWhere = force
    ? and(gt(talentSessions.reserveAmountCents, 0), isNull(talentSessions.standardReleasedAt))
    : and(
        eq(talentSessions.status, 'completed'),
        gt(talentSessions.reserveAmountCents, 0),
        isNull(talentSessions.standardReleasedAt),
        lte(talentSessions.billingEndedAt, cutoff)
      );

  const sessions = await db.query.talentSessions.findMany({
    where: sessionWhere,
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true, reserveAmountCents: true, bookerId: true },
  });

  logger.info('[Cron] ReserveRelease: session standard candidates found', {
    count: sessions.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const session of sessions) {
    const userId = session.talentProfile?.userId;
    if (!userId) {
      logger.warn('[Cron] ReserveRelease: session standard skipped — no talent userId', {
        sessionId: session.id,
      });
      skipped++;
      continue;
    }

    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, userId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: session standard skipped — payouts not enabled', {
        sessionId: session.id,
        userId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(userId)) {
      logger.warn('[Cron] ReserveRelease: session standard skipped — ledger frozen (dispute)', {
        sessionId: session.id,
        userId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = Math.round(session.reserveAmountCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Standard reserve release (85%) — session ${session.id}`,
      idempotencyKey: `reserve-session-standard-${session.id}`,
      metadata: {
        type: 'reserve_release',
        stage: 'standard',
        source: 'talent_session',
        sessionId: session.id,
        bookerId: session.bookerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(talentSessions)
        .set({
          reserveAmountCents: sql`${talentSessions.reserveAmountCents} - ${amountToRelease}`,
          standardReleasedAt: new Date(),
        })
        .where(eq(talentSessions.id, session.id));

      await PayoutLedgerService.moveToAvailable(userId, 'pending', amountToRelease, {
        sourceType: 'talent_session',
        sourceId: session.id,
        reason: 'day14_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (session standard)', {
          sessionId: session.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: session standard reserve released', {
        sessionId: session.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: sessions.length };
}

export async function releaseSessionFinalReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping session final reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - FINAL_RELEASE_HOLD_DAYS * 86_400_000);

  // Two ways in: (a) first time through — standard stage already fired,
  // final stage hasn't, and 21 days have passed; (b) a tip
  // (TalentSessionService.handleTipPaymentWebhook) landed AFTER this row
  // already went through a full release cycle once (reserveReleasedAt is
  // set) — released immediately on the next pass with no further wait,
  // same "let a later payment always be picked up" policy the flat
  // pre-Phase-1 model used. A tip's own money never gets its own separate
  // 85/15 staged wait; it rides in whole via this catch-up branch.
  const sessionWhere = force
    ? and(
        gt(talentSessions.reserveAmountCents, 0),
        // Without this, force mode races this function against
        // releaseSessionStandardReserves(true) in the same Promise.all on a
        // session that's never been released at all — both would match on
        // reserveAmountCents alone, and Final could transfer the FULL
        // (undecremented) amount concurrently with Standard's 85%.
        or(isNotNull(talentSessions.standardReleasedAt), isNotNull(talentSessions.reserveReleasedAt))
      )
    : and(
        eq(talentSessions.status, 'completed'),
        gt(talentSessions.reserveAmountCents, 0),
        or(
          isNotNull(talentSessions.reserveReleasedAt),
          and(isNotNull(talentSessions.standardReleasedAt), lte(talentSessions.billingEndedAt, cutoff))
        )
      );

  const sessions = await db.query.talentSessions.findMany({
    where: sessionWhere,
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true, reserveAmountCents: true, bookerId: true, updatedAt: true },
  });

  logger.info('[Cron] ReserveRelease: session final candidates found', { count: sessions.length, force });

  let released = 0;
  let skipped = 0;

  for (const session of sessions) {
    const userId = session.talentProfile?.userId;
    if (!userId) {
      logger.warn('[Cron] ReserveRelease: session final skipped — no talent userId', {
        sessionId: session.id,
      });
      skipped++;
      continue;
    }

    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, userId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: session final skipped — payouts not enabled', {
        sessionId: session.id,
        userId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(userId)) {
      logger.warn('[Cron] ReserveRelease: session final skipped — ledger frozen (dispute)', {
        sessionId: session.id,
        userId,
      });
      skipped++;
      continue;
    }

    // Snapshot the amount to transfer — a concurrent payment only adds to
    // reserveAmountCents after this point, so decrementing by this exact
    // amount below never loses it.
    const amountToRelease = session.reserveAmountCents;

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Final reserve release — session ${session.id}`,
      idempotencyKey: `reserve-session-final-${session.id}-${new Date(session.updatedAt).getTime()}`,
      metadata: {
        type: 'reserve_release',
        stage: 'final',
        source: 'talent_session',
        sessionId: session.id,
        bookerId: session.bookerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(talentSessions)
        .set({
          reserveAmountCents: sql`${talentSessions.reserveAmountCents} - ${amountToRelease}`,
          reserveReleasedAt: new Date(),
        })
        .where(eq(talentSessions.id, session.id));

      await PayoutLedgerService.releaseRemainingToAvailable(userId, amountToRelease, {
        sourceType: 'talent_session',
        sourceId: session.id,
        reason: 'day21_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (session final)', {
          sessionId: session.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: session final reserve released', {
        sessionId: session.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: sessions.length };
}

// ─── Shop Orders ────────────────────────────────────────────────────────────
// No tip/top-up mechanic on this flow — each row is charged exactly once, so
// both stages are simple one-shot gates with no late-arrival catch-up logic.

export async function releaseShopOrderStandardReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping shop order standard reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - STANDARD_RELEASE_HOLD_DAYS * 86_400_000);

  const shopOrderWhere = force
    ? and(gt(shopOrders.reserveAmountCents, 0), isNull(shopOrders.standardReleasedAt))
    : and(
        eq(shopOrders.status, 'paid'),
        gt(shopOrders.reserveAmountCents, 0),
        isNull(shopOrders.standardReleasedAt),
        lte(shopOrders.paidAt, cutoff)
      );

  const shopOrderRows = await db.query.shopOrders.findMany({
    where: shopOrderWhere,
    columns: { id: true, reserveAmountCents: true, sellerId: true, buyerId: true },
  });

  logger.info('[Cron] ReserveRelease: shop order standard candidates found', {
    count: shopOrderRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const shopOrder of shopOrderRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, shopOrder.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: shop order standard skipped — payouts not enabled', {
        shopOrderId: shopOrder.id,
        sellerId: shopOrder.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(shopOrder.sellerId)) {
      logger.warn('[Cron] ReserveRelease: shop order standard skipped — ledger frozen (dispute)', {
        shopOrderId: shopOrder.id,
        sellerId: shopOrder.sellerId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = Math.round(shopOrder.reserveAmountCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Standard reserve release (85%) — shop order ${shopOrder.id}`,
      idempotencyKey: `reserve-shop-order-standard-${shopOrder.id}`,
      metadata: {
        type: 'reserve_release',
        stage: 'standard',
        source: 'shop_order',
        shopOrderId: shopOrder.id,
        buyerId: shopOrder.buyerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(shopOrders)
        .set({
          reserveAmountCents: sql`${shopOrders.reserveAmountCents} - ${amountToRelease}`,
          standardReleasedAt: new Date(),
        })
        .where(eq(shopOrders.id, shopOrder.id));

      await PayoutLedgerService.moveToAvailable(shopOrder.sellerId, 'pending', amountToRelease, {
        sourceType: 'shop_order',
        sourceId: shopOrder.id,
        reason: 'day14_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (shop order standard)', {
          shopOrderId: shopOrder.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: shop order standard reserve released', {
        shopOrderId: shopOrder.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: shopOrderRows.length };
}

export async function releaseShopOrderFinalReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping shop order final reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - FINAL_RELEASE_HOLD_DAYS * 86_400_000);

  const shopOrderWhere = force
    ? and(
        gt(shopOrders.reserveAmountCents, 0),
        isNotNull(shopOrders.standardReleasedAt),
        isNull(shopOrders.reserveReleasedAt)
      )
    : and(
        eq(shopOrders.status, 'paid'),
        gt(shopOrders.reserveAmountCents, 0),
        isNotNull(shopOrders.standardReleasedAt),
        isNull(shopOrders.reserveReleasedAt),
        lte(shopOrders.paidAt, cutoff)
      );

  const shopOrderRows = await db.query.shopOrders.findMany({
    where: shopOrderWhere,
    columns: { id: true, reserveAmountCents: true, sellerId: true, buyerId: true },
  });

  logger.info('[Cron] ReserveRelease: shop order final candidates found', {
    count: shopOrderRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const shopOrder of shopOrderRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, shopOrder.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: shop order final skipped — payouts not enabled', {
        shopOrderId: shopOrder.id,
        sellerId: shopOrder.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(shopOrder.sellerId)) {
      logger.warn('[Cron] ReserveRelease: shop order final skipped — ledger frozen (dispute)', {
        shopOrderId: shopOrder.id,
        sellerId: shopOrder.sellerId,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      shopOrder.reserveAmountCents,
      {
        description: `Final reserve release — shop order ${shopOrder.id}`,
        idempotencyKey: `reserve-shop-order-final-${shopOrder.id}`,
        metadata: {
          type: 'reserve_release',
          stage: 'final',
          source: 'shop_order',
          shopOrderId: shopOrder.id,
          buyerId: shopOrder.buyerId ?? '',
        },
      }
    );

    if (transferId) {
      await db
        .update(shopOrders)
        .set({
          reserveAmountCents: sql`${shopOrders.reserveAmountCents} - ${shopOrder.reserveAmountCents}`,
          reserveReleasedAt: new Date(),
        })
        .where(eq(shopOrders.id, shopOrder.id));

      await PayoutLedgerService.moveToAvailable(
        shopOrder.sellerId,
        'reserve',
        shopOrder.reserveAmountCents,
        { sourceType: 'shop_order', sourceId: shopOrder.id, reason: 'day21_clear' }
      ).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (shop order final)', {
          shopOrderId: shopOrder.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: shop order final reserve released', {
        shopOrderId: shopOrder.id,
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: shopOrderRows.length };
}

// ─── Priority Messages ──────────────────────────────────────────────────────
// No tip/top-up mechanic — same simple one-shot shape as Shop Orders.

export async function releasePriorityMessageStandardReserves(force = false) {
  if (!stripe) {
    logger.warn(
      '[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping priority message standard reserves'
    );
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - STANDARD_RELEASE_HOLD_DAYS * 86_400_000);

  const paymentWhere = force
    ? and(
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNull(priorityMessagePayments.standardReleasedAt)
      )
    : and(
        eq(priorityMessagePayments.status, 'replied'),
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNull(priorityMessagePayments.standardReleasedAt),
        lte(priorityMessagePayments.repliedAt, cutoff)
      );

  const paymentRows = await db.query.priorityMessagePayments.findMany({
    where: paymentWhere,
    columns: { id: true, reserveAmountCents: true, talentUserId: true, senderId: true },
  });

  logger.info('[Cron] ReserveRelease: priority message standard candidates found', {
    count: paymentRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const payment of paymentRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, payment.talentUserId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: priority message standard skipped — payouts not enabled', {
        paymentId: payment.id,
        talentUserId: payment.talentUserId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(payment.talentUserId)) {
      logger.warn('[Cron] ReserveRelease: priority message standard skipped — ledger frozen (dispute)', {
        paymentId: payment.id,
        talentUserId: payment.talentUserId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = Math.round(payment.reserveAmountCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Standard reserve release (85%) — priority message ${payment.id}`,
      idempotencyKey: `reserve-priority-message-standard-${payment.id}`,
      metadata: {
        type: 'reserve_release',
        stage: 'standard',
        source: 'priority_message',
        paymentId: payment.id,
        senderId: payment.senderId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(priorityMessagePayments)
        .set({
          reserveAmountCents: sql`${priorityMessagePayments.reserveAmountCents} - ${amountToRelease}`,
          standardReleasedAt: new Date(),
        })
        .where(eq(priorityMessagePayments.id, payment.id));

      await PayoutLedgerService.moveToAvailable(payment.talentUserId, 'pending', amountToRelease, {
        sourceType: 'priority_message',
        sourceId: payment.id,
        reason: 'day14_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (priority message standard)', {
          paymentId: payment.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: priority message standard reserve released', {
        paymentId: payment.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: paymentRows.length };
}

export async function releasePriorityMessageFinalReserves(force = false) {
  if (!stripe) {
    logger.warn(
      '[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping priority message final reserves'
    );
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - FINAL_RELEASE_HOLD_DAYS * 86_400_000);

  const paymentWhere = force
    ? and(
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNotNull(priorityMessagePayments.standardReleasedAt),
        isNull(priorityMessagePayments.reserveReleasedAt)
      )
    : and(
        eq(priorityMessagePayments.status, 'replied'),
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNotNull(priorityMessagePayments.standardReleasedAt),
        isNull(priorityMessagePayments.reserveReleasedAt),
        lte(priorityMessagePayments.repliedAt, cutoff)
      );

  const paymentRows = await db.query.priorityMessagePayments.findMany({
    where: paymentWhere,
    columns: { id: true, reserveAmountCents: true, talentUserId: true, senderId: true },
  });

  logger.info('[Cron] ReserveRelease: priority message final candidates found', {
    count: paymentRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const payment of paymentRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, payment.talentUserId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: priority message final skipped — payouts not enabled', {
        paymentId: payment.id,
        talentUserId: payment.talentUserId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(payment.talentUserId)) {
      logger.warn('[Cron] ReserveRelease: priority message final skipped — ledger frozen (dispute)', {
        paymentId: payment.id,
        talentUserId: payment.talentUserId,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      payment.reserveAmountCents,
      {
        description: `Final reserve release — priority message ${payment.id}`,
        idempotencyKey: `reserve-priority-message-final-${payment.id}`,
        metadata: {
          type: 'reserve_release',
          stage: 'final',
          source: 'priority_message',
          paymentId: payment.id,
          senderId: payment.senderId ?? '',
        },
      }
    );

    if (transferId) {
      await db
        .update(priorityMessagePayments)
        .set({
          reserveAmountCents: sql`${priorityMessagePayments.reserveAmountCents} - ${payment.reserveAmountCents}`,
          reserveReleasedAt: new Date(),
        })
        .where(eq(priorityMessagePayments.id, payment.id));

      await PayoutLedgerService.moveToAvailable(
        payment.talentUserId,
        'reserve',
        payment.reserveAmountCents,
        { sourceType: 'priority_message', sourceId: payment.id, reason: 'day21_clear' }
      ).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (priority message final)', {
          paymentId: payment.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: priority message final reserve released', {
        paymentId: payment.id,
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: paymentRows.length };
}

// ─── Shop Custom Offers (deposit/remainder/tip) ───────────────────────────────
// Can accumulate multiple payments over time (deposit, remainder, tip), same
// as sessions — carries the same late-arrival catch-up branch on its final
// stage.

export async function releaseCustomOfferStandardReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping custom offer standard reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - STANDARD_RELEASE_HOLD_DAYS * 86_400_000);

  const offerWhere = force
    ? and(
        gt(shopCustomServiceOffers.reserveAmountCents, 0),
        isNull(shopCustomServiceOffers.standardReleasedAt)
      )
    : and(
        // 'cancelled' included on purpose: a buyer who cancels with no
        // refund leaves reserveAmountCents untouched (see cancelOffer's own
        // comment — "the seller is still paid on the normal schedule"), but
        // that money can only actually reach the seller if this filter lets
        // a cancelled row through too. gt(reserveAmountCents, 0) already
        // makes this safe — a SELLER-cancelled offer zeroes reserveAmountCents
        // when it refunds, so it can never match here regardless.
        inArray(shopCustomServiceOffers.status, ['accepted', 'completed', 'cancelled']),
        gt(shopCustomServiceOffers.reserveAmountCents, 0),
        isNull(shopCustomServiceOffers.standardReleasedAt),
        // COALESCE to resolvedAt (cancellation time) for a row that was
        // cancelled before ever being delivered — deliveredAt would
        // otherwise stay NULL forever and this row would never have a
        // release anchor at all.
        lte(sql`COALESCE(${shopCustomServiceOffers.deliveredAt}, ${shopCustomServiceOffers.resolvedAt})`, cutoff)
      );

  const offerRows = await db.query.shopCustomServiceOffers.findMany({
    where: offerWhere,
    columns: { id: true, reserveAmountCents: true, sellerId: true, buyerId: true },
  });

  logger.info('[Cron] ReserveRelease: custom offer standard candidates found', {
    count: offerRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const offer of offerRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, offer.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: custom offer standard skipped — payouts not enabled', {
        offerId: offer.id,
        sellerId: offer.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(offer.sellerId)) {
      logger.warn('[Cron] ReserveRelease: custom offer standard skipped — ledger frozen (dispute)', {
        offerId: offer.id,
        sellerId: offer.sellerId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = Math.round(offer.reserveAmountCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Standard reserve release (85%) — custom offer ${offer.id}`,
      idempotencyKey: `reserve-custom-offer-standard-${offer.id}`,
      metadata: {
        type: 'reserve_release',
        stage: 'standard',
        source: 'shop_custom_offer',
        offerId: offer.id,
        buyerId: offer.buyerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(shopCustomServiceOffers)
        .set({
          reserveAmountCents: sql`${shopCustomServiceOffers.reserveAmountCents} - ${amountToRelease}`,
          standardReleasedAt: new Date(),
        })
        .where(eq(shopCustomServiceOffers.id, offer.id));

      await PayoutLedgerService.moveToAvailable(offer.sellerId, 'pending', amountToRelease, {
        sourceType: 'shop_custom_offer',
        sourceId: offer.id,
        reason: 'day14_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (custom offer standard)', {
          offerId: offer.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: custom offer standard reserve released', {
        offerId: offer.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: offerRows.length };
}

export async function releaseCustomOfferFinalReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping custom offer final reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - FINAL_RELEASE_HOLD_DAYS * 86_400_000);

  // Same two-branch shape as releaseSessionFinalReserves — see its comment
  // (force must still require standardReleasedAt, or it races the Standard
  // pass in the same Promise.all and can double-transfer a never-released row).
  const offerWhere = force
    ? and(
        gt(shopCustomServiceOffers.reserveAmountCents, 0),
        or(isNotNull(shopCustomServiceOffers.standardReleasedAt), isNotNull(shopCustomServiceOffers.reserveReleasedAt))
      )
    : and(
        // 'cancelled' included for the same reason as releaseCustomOfferStandardReserves.
        inArray(shopCustomServiceOffers.status, ['accepted', 'completed', 'cancelled']),
        gt(shopCustomServiceOffers.reserveAmountCents, 0),
        or(
          isNotNull(shopCustomServiceOffers.reserveReleasedAt),
          and(
            isNotNull(shopCustomServiceOffers.standardReleasedAt),
            lte(
              sql`COALESCE(${shopCustomServiceOffers.deliveredAt}, ${shopCustomServiceOffers.resolvedAt})`,
              cutoff
            )
          )
        )
      );

  const offerRows = await db.query.shopCustomServiceOffers.findMany({
    where: offerWhere,
    columns: {
      id: true,
      reserveAmountCents: true,
      sellerId: true,
      buyerId: true,
      updatedAt: true,
    },
  });

  logger.info('[Cron] ReserveRelease: custom offer final candidates found', {
    count: offerRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const offer of offerRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, offer.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: custom offer final skipped — payouts not enabled', {
        offerId: offer.id,
        sellerId: offer.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(offer.sellerId)) {
      logger.warn('[Cron] ReserveRelease: custom offer final skipped — ledger frozen (dispute)', {
        offerId: offer.id,
        sellerId: offer.sellerId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = offer.reserveAmountCents;

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Final reserve release — custom offer ${offer.id}`,
      idempotencyKey: `reserve-custom-offer-final-${offer.id}-${new Date(offer.updatedAt).getTime()}`,
      metadata: {
        type: 'reserve_release',
        stage: 'final',
        source: 'shop_custom_offer',
        offerId: offer.id,
        buyerId: offer.buyerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(shopCustomServiceOffers)
        .set({
          reserveAmountCents: sql`${shopCustomServiceOffers.reserveAmountCents} - ${amountToRelease}`,
          reserveReleasedAt: new Date(),
        })
        .where(eq(shopCustomServiceOffers.id, offer.id));

      await PayoutLedgerService.releaseRemainingToAvailable(offer.sellerId, amountToRelease, {
        sourceType: 'shop_custom_offer',
        sourceId: offer.id,
        reason: 'day21_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (custom offer final)', {
          offerId: offer.id,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: custom offer final reserve released', {
        offerId: offer.id,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: offerRows.length };
}

/**
 * Per-milestone release for `paymentMode: 'milestones'` custom offers.
 *
 * Deliberately a SIBLING of releaseCustomOfferStandard/FinalReserves, not a
 * change to them. Milestone money never enters
 * shop_custom_service_offers.reserve_amount_cents (see
 * ShopCustomOfferService.handlePaymentWebhook / handleMilestonePaymentWebhook),
 * so these paths read disjoint pots and cannot double-pay one another. The
 * whole-offer path above is still needed on milestone offers: TIPS
 * accumulate into reserve_amount_cents (handleTipPaymentWebhook) and are
 * released by it.
 *
 * No top-up/tip mechanic on an individual milestone row itself (a stage's
 * sellerReceiveCents is fixed once funded), so — like Shop Orders and
 * Priority Messages — both stages are simple one-shot gates.
 */
export async function releaseCustomOfferMilestoneStandardReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping custom offer milestone standard');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }

  const baseConditions = and(
    eq(shopOfferMilestones.status, 'completed'),
    isNull(shopOfferMilestones.standardReleasedAt),
    gt(shopOfferMilestones.sellerReceiveCents, 0)
  );
  const milestoneWhere = force
    ? baseConditions
    : and(baseConditions, lte(shopOfferMilestones.standardReleaseAt, new Date()));

  const milestoneRows = await db
    .select({
      milestoneId: shopOfferMilestones.id,
      offerId: shopOfferMilestones.offerId,
      position: shopOfferMilestones.position,
      sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
      sellerId: shopCustomServiceOffers.sellerId,
      buyerId: shopCustomServiceOffers.buyerId,
    })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(milestoneWhere);

  logger.info('[Cron] ReserveRelease: custom offer milestone standard candidates found', {
    count: milestoneRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const milestone of milestoneRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, milestone.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: custom offer milestone standard skipped — payouts not enabled', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        sellerId: milestone.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(milestone.sellerId)) {
      logger.warn('[Cron] ReserveRelease: custom offer milestone standard skipped — ledger frozen (dispute)', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        sellerId: milestone.sellerId,
      });
      skipped++;
      continue;
    }

    const amountToRelease = Math.round(milestone.sellerReceiveCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Standard reserve release (85%) — offer ${milestone.offerId} milestone ${milestone.position + 1}`,
      idempotencyKey: `reserve-offer-milestone-standard-${milestone.milestoneId}`,
      metadata: {
        type: 'reserve_release',
        stage: 'standard',
        source: 'shop_custom_offer_milestone',
        offerId: milestone.offerId,
        milestoneId: milestone.milestoneId,
        position: String(milestone.position),
        buyerId: milestone.buyerId ?? '',
      },
    });

    if (transferId) {
      await db
        .update(shopOfferMilestones)
        .set({ standardReleasedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(shopOfferMilestones.id, milestone.milestoneId),
            eq(shopOfferMilestones.status, 'completed')
          )
        );

      await PayoutLedgerService.moveToAvailable(milestone.sellerId, 'pending', amountToRelease, {
        sourceType: 'shop_offer_milestone',
        sourceId: milestone.milestoneId,
        reason: 'day14_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (milestone standard)', {
          milestoneId: milestone.milestoneId,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: custom offer milestone standard released', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: milestoneRows.length };
}

export async function releaseCustomOfferMilestoneFinalReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping custom offer milestone final');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }

  const baseConditions = and(
    eq(shopOfferMilestones.status, 'completed'),
    isNotNull(shopOfferMilestones.standardReleasedAt),
    isNull(shopOfferMilestones.releasedAt),
    gt(shopOfferMilestones.sellerReceiveCents, 0)
  );
  const milestoneWhere = force
    ? baseConditions
    : and(baseConditions, lte(shopOfferMilestones.releaseAt, new Date()));

  const milestoneRows = await db
    .select({
      milestoneId: shopOfferMilestones.id,
      offerId: shopOfferMilestones.offerId,
      position: shopOfferMilestones.position,
      sellerReceiveCents: shopOfferMilestones.sellerReceiveCents,
      sellerId: shopCustomServiceOffers.sellerId,
      buyerId: shopCustomServiceOffers.buyerId,
    })
    .from(shopOfferMilestones)
    .innerJoin(shopCustomServiceOffers, eq(shopOfferMilestones.offerId, shopCustomServiceOffers.id))
    .where(milestoneWhere);

  logger.info('[Cron] ReserveRelease: custom offer milestone final candidates found', {
    count: milestoneRows.length,
    force,
  });

  let released = 0;
  let skipped = 0;

  for (const milestone of milestoneRows) {
    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, milestone.sellerId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: custom offer milestone final skipped — payouts not enabled', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        sellerId: milestone.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }
    if (await isLedgerFrozen(milestone.sellerId)) {
      logger.warn('[Cron] ReserveRelease: custom offer milestone final skipped — ledger frozen (dispute)', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        sellerId: milestone.sellerId,
      });
      skipped++;
      continue;
    }

    // Deterministic remainder — a milestone's sellerReceiveCents never
    // changes after funding, so this is always exactly what the standard
    // pass didn't already take, no running-balance read needed.
    const amountToRelease =
      milestone.sellerReceiveCents - Math.round(milestone.sellerReceiveCents * STANDARD_RELEASE_PORTION);
    if (amountToRelease <= 0) {
      skipped++;
      continue;
    }

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Final reserve release — offer ${milestone.offerId} milestone ${milestone.position + 1}`,
      idempotencyKey: `reserve-offer-milestone-final-${milestone.milestoneId}`,
      metadata: {
        type: 'reserve_release',
        stage: 'final',
        source: 'shop_custom_offer_milestone',
        offerId: milestone.offerId,
        milestoneId: milestone.milestoneId,
        position: String(milestone.position),
        buyerId: milestone.buyerId ?? '',
      },
    });

    if (transferId) {
      // Conditional on 'completed' so a concurrent pass (or a cancellation
      // that moved the row to 'cancelled') can never be overwritten here.
      await db
        .update(shopOfferMilestones)
        .set({ status: 'released', releasedAt: new Date(), transferId, updatedAt: new Date() })
        .where(
          and(
            eq(shopOfferMilestones.id, milestone.milestoneId),
            eq(shopOfferMilestones.status, 'completed')
          )
        );

      await PayoutLedgerService.moveToAvailable(milestone.sellerId, 'reserve', amountToRelease, {
        sourceType: 'shop_offer_milestone',
        sourceId: milestone.milestoneId,
        reason: 'day21_clear',
      }).catch(err =>
        logger.error('[Cron] ReserveRelease: ledger update failed (milestone final)', {
          milestoneId: milestone.milestoneId,
          error: err.message,
        })
      );

      released++;
      logger.info('[Cron] ReserveRelease: custom offer milestone final released', {
        milestoneId: milestone.milestoneId,
        offerId: milestone.offerId,
        position: milestone.position,
        amountUsd: (amountToRelease / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: milestoneRows.length };
}

// ─── Event Tickets ──────────────────────────────────────────────────────────
// UNCHANGED by Phase 1 — see the EVENT_RESERVE_HOLD_DAYS comment above.

export async function releaseOrderReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping order reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - EVENT_RESERVE_HOLD_DAYS * 86_400_000);

  const baseConditions = and(
    inArray(orders.status, ['paid', 'refunded']),
    gt(orders.reserveAmountCents, 0),
    isNull(orders.reserveReleasedAt)
  );
  const orderWhere = force
    ? and(baseConditions, inArray(events.eventStatus, ['published', 'cancelled']))
    : and(
        baseConditions,
        or(
          and(eq(events.eventStatus, 'published'), lte(events.endDate, cutoff)),
          eq(events.eventStatus, 'cancelled')
        )
      );

  const paidOrders = await db
    .select({
      orderId: orders.id,
      paymentIntentId: orders.paymentIntentId,
      reserveAmountCents: orders.reserveAmountCents,
      eventId: orders.eventId,
      eventTitle: events.title,
      eventSlug: events.slug,
      eventStatus: events.eventStatus,
      organizerId: events.organizerId,
    })
    .from(orders)
    .innerJoin(events, eq(orders.eventId, events.id))
    .where(orderWhere);

  logger.info('[Cron] ReserveRelease: order candidates found', {
    count: paidOrders.length,
    force,
    statuses: [...new Set(paidOrders.map(o => o.eventStatus))],
  });

  const byEvent = new Map();
  for (const order of paidOrders) {
    if (!order.organizerId) {
      logger.warn('[Cron] ReserveRelease: order skipped — no organizerId on event', {
        orderId: order.orderId,
        eventId: order.eventId,
      });
      continue;
    }
    if (!byEvent.has(order.eventId)) {
      byEvent.set(order.eventId, {
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventSlug: order.eventSlug,
        organizerId: order.organizerId,
        orderIds: [],
        paymentIntentIds: [],
        orderReserves: [],
        totalReserveCents: 0,
      });
    }
    const group = byEvent.get(order.eventId);
    group.orderIds.push(order.orderId);
    if (order.paymentIntentId) group.paymentIntentIds.push(order.paymentIntentId);
    group.orderReserves.push({ orderId: order.orderId, reserveCents: order.reserveAmountCents });
    group.totalReserveCents += order.reserveAmountCents;
  }

  let released = 0;
  let skipped = 0;

  for (const group of byEvent.values()) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.id, group.organizerId),
      columns: { userId: true },
    });
    if (!organizer?.userId) {
      logger.warn('[Cron] ReserveRelease: event skipped — organizer has no userId', {
        eventId: group.eventId,
        organizerId: group.organizerId,
      });
      skipped++;
      continue;
    }

    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, organizer.userId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: event skipped — payouts not enabled', {
        eventId: group.eventId,
        organizerId: group.organizerId,
        hasStripeAccount: !!connectAccount,
        payoutsEnabled: connectAccount?.payoutsEnabled ?? null,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      group.totalReserveCents,
      {
        description: `Reserve release — ${group.eventTitle ?? group.eventId} (${group.orderIds.length} orders)`,
        idempotencyKey: `reserve-event-${group.eventId}`,
        metadata: {
          type: 'reserve_release',
          source: 'event_aggregate',
          eventId: group.eventId,
          eventTitle: (group.eventTitle ?? '').slice(0, 500),
          eventSlug: group.eventSlug ?? '',
          orderCount: String(group.orderIds.length),
          totalReserveCents: String(group.totalReserveCents),
          orderIds: group.orderIds.join(',').slice(0, 500),
          paymentIntentIds: group.paymentIntentIds.join(',').slice(0, 500),
          orderReserves: JSON.stringify(
            group.orderReserves.map(o => ({ id: o.orderId, r: o.reserveCents }))
          ).slice(0, 500),
        },
        transferGroup: `event-${group.eventId}`,
      }
    );

    if (transferId) {
      const releasedAt = new Date();
      await db
        .update(orders)
        .set({ reserveReleasedAt: releasedAt })
        .where(
          and(
            eq(orders.eventId, group.eventId),
            isNull(orders.reserveReleasedAt),
            inArray(orders.status, ['paid', 'refunded'])
          )
        );
      released++;
      logger.info('[Cron] ReserveRelease: event reserve released', {
        eventId: group.eventId,
        orderCount: group.orderIds.length,
        amountUsd: (group.totalReserveCents / 100).toFixed(2),
        transferId,
      });
    } else {
      skipped++;
      logger.error('[Cron] ReserveRelease: event skipped — transfer returned no id', {
        eventId: group.eventId,
        organizerId: group.organizerId,
      });
    }
  }

  return { released, skipped, eventGroups: byEvent.size, candidateOrders: paidOrders.length };
}

export async function runReserveRelease(force = false) {
  logger.info('[Cron] ReserveRelease: starting', { force });
  const [
    sessionsStandard,
    sessionsFinal,
    orderResults,
    shopOrderStandard,
    shopOrderFinal,
    priorityMessageStandard,
    priorityMessageFinal,
    customOfferStandard,
    customOfferFinal,
    customOfferMilestoneStandard,
    customOfferMilestoneFinal,
  ] = await Promise.all([
    releaseSessionStandardReserves(force),
    releaseSessionFinalReserves(force),
    releaseOrderReserves(force),
    releaseShopOrderStandardReserves(force),
    releaseShopOrderFinalReserves(force),
    releasePriorityMessageStandardReserves(force),
    releasePriorityMessageFinalReserves(force),
    releaseCustomOfferStandardReserves(force),
    releaseCustomOfferFinalReserves(force),
    releaseCustomOfferMilestoneStandardReserves(force),
    releaseCustomOfferMilestoneFinalReserves(force),
  ]);

  const result = {
    sessions: { standard: sessionsStandard, final: sessionsFinal },
    orders: orderResults,
    shopOrders: { standard: shopOrderStandard, final: shopOrderFinal },
    priorityMessages: { standard: priorityMessageStandard, final: priorityMessageFinal },
    customOffers: { standard: customOfferStandard, final: customOfferFinal },
    customOfferMilestones: {
      standard: customOfferMilestoneStandard,
      final: customOfferMilestoneFinal,
    },
  };

  logger.info('[Cron] ReserveRelease: done', result);
  return result;
}
