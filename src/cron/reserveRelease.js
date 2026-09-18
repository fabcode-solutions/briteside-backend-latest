import Stripe from 'stripe';
import { eq, and, isNull, lte, gt, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  talentSessions,
  orders,
  events,
  organizers,
  shopOrders,
  priorityMessagePayments,
  shopCustomServiceOffers,
} from '../db/schema/index.js';
import { stripeConnectAccounts } from '../db/schema/stripeConnect.js';
import config from '../config/config.js';
import { cronLogger as logger } from '../config/logger.js';

const stripe = config.stripe?.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;

// Session reserves ("deliver-first escrow"): released 48h after the session
// is marked completed (billingEndedAt), not after it was merely scheduled.
const SESSION_RESERVE_HOLD_HOURS = 48;

// Order reserves: released N days after the event ends (dispute buffer).
// Per Briteside payout guidelines: T+2 (48 hours / 2 business days) post-event.
const EVENT_RESERVE_HOLD_DAYS = 2;

// Shop orders (digital content, courses, services): flat 48h rolling payout
// from paidAt — delivery is instant/electronic, so there's nothing to wait
// on besides the hold window itself.
const SHOP_ORDER_RESERVE_HOLD_HOURS = 48;

// Priority messages ("SLA escrow"): released 48h after the talent replies
// (repliedAt), not at purchase.
const PRIORITY_MESSAGE_RESERVE_HOLD_HOURS = 48;

// Custom service offers: released 48h after delivery (deliveredAt). Unlike
// the other three, an offer can accumulate multiple payments (deposit,
// remainder, tip) — some arriving after an earlier release already fired —
// so this one transfers only the current reserveAmountCents and decrements
// by that same amount rather than gating on reserveReleasedAt being null,
// letting a later payment always be picked up on its own next pass.
const CUSTOM_OFFER_RESERVE_HOLD_HOURS = 48;

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

export async function releaseSessionReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping session reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - SESSION_RESERVE_HOLD_HOURS * 3_600_000);

  const sessionWhere = force
    ? and(gt(talentSessions.reserveAmountCents, 0), isNull(talentSessions.reserveReleasedAt))
    : and(
        eq(talentSessions.status, 'completed'),
        gt(talentSessions.reserveAmountCents, 0),
        isNull(talentSessions.reserveReleasedAt),
        lte(talentSessions.billingEndedAt, cutoff)
      );

  const sessions = await db.query.talentSessions.findMany({
    where: sessionWhere,
    with: { talentProfile: { columns: { userId: true } } },
    columns: { id: true, reserveAmountCents: true, bookerId: true },
  });

  logger.info('[Cron] ReserveRelease: session candidates found', { count: sessions.length, force });

  let released = 0;
  let skipped = 0;

  for (const session of sessions) {
    const userId = session.talentProfile?.userId;
    if (!userId) {
      logger.warn('[Cron] ReserveRelease: session skipped — no talent userId', { sessionId: session.id });
      skipped++;
      continue;
    }

    const connectAccount = await db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, userId),
      columns: { stripeAccountId: true, payoutsEnabled: true },
    });
    if (!connectAccount?.payoutsEnabled) {
      logger.warn('[Cron] ReserveRelease: session skipped — payouts not enabled', {
        sessionId: session.id,
        userId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      session.reserveAmountCents,
      {
        description: `Reserve release — session ${session.id}`,
        idempotencyKey: `reserve-session-${session.id}`,
        metadata: {
          type: 'reserve_release',
          source: 'talent_session',
          sessionId: session.id,
          bookerId: session.bookerId ?? '',
        },
      }
    );

    if (transferId) {
      await db
        .update(talentSessions)
        .set({ reserveReleasedAt: new Date() })
        .where(eq(talentSessions.id, session.id));
      released++;
      logger.info('[Cron] ReserveRelease: session reserve released', {
        sessionId: session.id,
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: sessions.length };
}

export async function releaseShopOrderReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping shop order reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - SHOP_ORDER_RESERVE_HOLD_HOURS * 3_600_000);

  const shopOrderWhere = force
    ? and(gt(shopOrders.reserveAmountCents, 0), isNull(shopOrders.reserveReleasedAt))
    : and(
        eq(shopOrders.status, 'paid'),
        gt(shopOrders.reserveAmountCents, 0),
        isNull(shopOrders.reserveReleasedAt),
        lte(shopOrders.paidAt, cutoff)
      );

  const shopOrderRows = await db.query.shopOrders.findMany({
    where: shopOrderWhere,
    columns: { id: true, reserveAmountCents: true, sellerId: true, buyerId: true },
  });

  logger.info('[Cron] ReserveRelease: shop order candidates found', {
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
      logger.warn('[Cron] ReserveRelease: shop order skipped — payouts not enabled', {
        shopOrderId: shopOrder.id,
        sellerId: shopOrder.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      shopOrder.reserveAmountCents,
      {
        description: `Reserve release — shop order ${shopOrder.id}`,
        idempotencyKey: `reserve-shop-order-${shopOrder.id}`,
        metadata: {
          type: 'reserve_release',
          source: 'shop_order',
          shopOrderId: shopOrder.id,
          buyerId: shopOrder.buyerId ?? '',
        },
      }
    );

    if (transferId) {
      await db
        .update(shopOrders)
        .set({ reserveReleasedAt: new Date() })
        .where(eq(shopOrders.id, shopOrder.id));
      released++;
      logger.info('[Cron] ReserveRelease: shop order reserve released', {
        shopOrderId: shopOrder.id,
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: shopOrderRows.length };
}

export async function releasePriorityMessageReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping priority message reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - PRIORITY_MESSAGE_RESERVE_HOLD_HOURS * 3_600_000);

  const paymentWhere = force
    ? and(
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNull(priorityMessagePayments.reserveReleasedAt)
      )
    : and(
        eq(priorityMessagePayments.status, 'replied'),
        gt(priorityMessagePayments.reserveAmountCents, 0),
        isNull(priorityMessagePayments.reserveReleasedAt),
        lte(priorityMessagePayments.repliedAt, cutoff)
      );

  const paymentRows = await db.query.priorityMessagePayments.findMany({
    where: paymentWhere,
    columns: { id: true, reserveAmountCents: true, talentUserId: true, senderId: true },
  });

  logger.info('[Cron] ReserveRelease: priority message candidates found', {
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
      logger.warn('[Cron] ReserveRelease: priority message skipped — payouts not enabled', {
        paymentId: payment.id,
        talentUserId: payment.talentUserId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }

    const transferId = await transferReserve(
      connectAccount.stripeAccountId,
      payment.reserveAmountCents,
      {
        description: `Reserve release — priority message ${payment.id}`,
        idempotencyKey: `reserve-priority-message-${payment.id}`,
        metadata: {
          type: 'reserve_release',
          source: 'priority_message',
          paymentId: payment.id,
          senderId: payment.senderId ?? '',
        },
      }
    );

    if (transferId) {
      await db
        .update(priorityMessagePayments)
        .set({ reserveReleasedAt: new Date() })
        .where(eq(priorityMessagePayments.id, payment.id));
      released++;
      logger.info('[Cron] ReserveRelease: priority message reserve released', {
        paymentId: payment.id,
        transferId,
      });
    } else {
      skipped++;
    }
  }

  return { released, skipped, candidates: paymentRows.length };
}

export async function releaseCustomOfferReserves(force = false) {
  if (!stripe) {
    logger.warn('[Cron] ReserveRelease: STRIPE NOT CONFIGURED — skipping custom offer reserves');
    return { released: 0, skipped: 0, reason: 'stripe_not_configured' };
  }
  const cutoff = new Date(Date.now() - CUSTOM_OFFER_RESERVE_HOLD_HOURS * 3_600_000);

  // Not gated on reserveReleasedAt being null — see the constant's comment
  // above. A row with reserveAmountCents > 0 is eligible every pass,
  // whether that's its first release or a later payment (e.g. a tip) that
  // arrived after an earlier release already fired.
  const offerWhere = force
    ? gt(shopCustomServiceOffers.reserveAmountCents, 0)
    : and(
        inArray(shopCustomServiceOffers.status, ['accepted', 'completed']),
        gt(shopCustomServiceOffers.reserveAmountCents, 0),
        lte(shopCustomServiceOffers.deliveredAt, cutoff)
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

  logger.info('[Cron] ReserveRelease: custom offer candidates found', {
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
      logger.warn('[Cron] ReserveRelease: custom offer skipped — payouts not enabled', {
        offerId: offer.id,
        sellerId: offer.sellerId,
        hasAccount: !!connectAccount,
      });
      skipped++;
      continue;
    }

    // Snapshot the amount to transfer — a concurrent payment (e.g. a tip
    // landing mid-loop) only adds to reserveAmountCents after this point,
    // so decrementing by this exact amount below never loses it.
    const amountToRelease = offer.reserveAmountCents;

    const transferId = await transferReserve(connectAccount.stripeAccountId, amountToRelease, {
      description: `Reserve release — custom offer ${offer.id}`,
      // Keyed on updatedAt, not the amount — this stays stable if the cron
      // retries this exact batch, but changes once new money (e.g. a late
      // tip) bumps updatedAt again, so that next batch gets its own key
      // instead of colliding with (and being silently dropped by) this one.
      idempotencyKey: `reserve-custom-offer-${offer.id}-${new Date(offer.updatedAt).getTime()}`,
      metadata: {
        type: 'reserve_release',
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
      released++;
      logger.info('[Cron] ReserveRelease: custom offer reserve released', {
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
  const [sessions, orders, shopOrderResults, priorityMessageResults, customOfferResults] =
    await Promise.all([
      releaseSessionReserves(force),
      releaseOrderReserves(force),
      releaseShopOrderReserves(force),
      releasePriorityMessageReserves(force),
      releaseCustomOfferReserves(force),
    ]);
  logger.info('[Cron] ReserveRelease: done', {
    sessions,
    orders,
    shopOrders: shopOrderResults,
    priorityMessages: priorityMessageResults,
    customOffers: customOfferResults,
  });
  return {
    sessions,
    orders,
    shopOrders: shopOrderResults,
    priorityMessages: priorityMessageResults,
    customOffers: customOfferResults,
  };
}
