import Stripe from 'stripe';
import { eq, and, isNull, lte, gt, inArray, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { talentSessions, orders, events, organizers } from '../db/schema/index.js';
import { stripeConnectAccounts } from '../db/schema/stripeConnect.js';
import config from '../config/config.js';
import { cronLogger as logger } from '../config/logger.js';

const stripe = config.stripe?.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;

// Session reserves: released N days after the session was scheduled
const SESSION_RESERVE_HOLD_DAYS = 5;

// Order reserves: released N days after the event ends (dispute buffer)
const EVENT_RESERVE_HOLD_DAYS = 5;

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
  const cutoff = new Date(Date.now() - SESSION_RESERVE_HOLD_DAYS * 86_400_000);

  const sessionWhere = force
    ? and(gt(talentSessions.reserveAmountCents, 0), isNull(talentSessions.reserveReleasedAt))
    : and(
        eq(talentSessions.status, 'completed'),
        gt(talentSessions.reserveAmountCents, 0),
        isNull(talentSessions.reserveReleasedAt),
        lte(talentSessions.scheduledAt, cutoff)
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
  const [sessions, orders] = await Promise.all([
    releaseSessionReserves(force),
    releaseOrderReserves(force),
  ]);
  logger.info('[Cron] ReserveRelease: done', { sessions, orders });
  return { sessions, orders };
}
