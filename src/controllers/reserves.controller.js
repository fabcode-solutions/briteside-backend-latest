import Stripe from 'stripe';
import crypto from 'crypto';
import { catchAsync } from '../utils/catch-async.js';
import { db } from '../db/index.js';
import { orders } from '../db/schema/payments.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { events, organizers } from '../db/schema/index.js';
import { stripeConnectAccounts } from '../db/schema/stripeConnect.js';
import { reserveAdjustments } from '../db/schema/reserveAdjustments.js';
import { and, gt, isNull, isNotNull, inArray, ne, sql, desc, eq } from 'drizzle-orm';
import { runReserveRelease, transferReserve } from '../cron/reserveRelease.js';
import config from '../config/config.js';
import { cronLogger as logger } from '../config/logger.js';

const stripe = config.stripe?.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;

function idemKey(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
}

async function getOrganizerConnectAccount(organizerId) {
  const organizer = await db.query.organizers.findFirst({
    where: eq(organizers.id, organizerId),
    columns: { userId: true },
  });
  if (!organizer?.userId) return null;
  return db.query.stripeConnectAccounts.findFirst({
    where: eq(stripeConnectAccounts.userId, organizer.userId),
    columns: { stripeAccountId: true, payoutsEnabled: true },
  });
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export const getReserveSummary = catchAsync(async (req, res) => {
  const [o] = await db
    .select({
      totalHeld: sql`COALESCE(SUM(CASE WHEN ${orders.reserveReleasedAt} IS NULL THEN ${orders.reserveAmountCents} ELSE 0 END), 0)`,
      totalReleased: sql`COALESCE(SUM(CASE WHEN ${orders.reserveReleasedAt} IS NOT NULL THEN ${orders.reserveAmountCents} ELSE 0 END), 0)`,
      heldCount: sql`COUNT(CASE WHEN ${orders.reserveReleasedAt} IS NULL AND ${orders.reserveAmountCents} > 0 THEN 1 END)`,
      releasedCount: sql`COUNT(CASE WHEN ${orders.reserveReleasedAt} IS NOT NULL THEN 1 END)`,
    })
    .from(orders)
    .where(gt(orders.reserveAmountCents, 0));

  const totalHeldCents = Number(o?.totalHeld ?? 0);
  const totalReleasedCents = Number(o?.totalReleased ?? 0);

  res.json({
    success: true,
    data: {
      totalHeldCents,
      totalHeld: (totalHeldCents / 100).toFixed(2),
      totalReleasedCents,
      totalReleased: (totalReleasedCents / 100).toFixed(2),
      pendingCount: Number(o?.heldCount ?? 0),
      releasedCount: Number(o?.releasedCount ?? 0),
      byType: {
        orders: {
          heldCents: Number(o?.totalHeld ?? 0),
          releasedCents: Number(o?.totalReleased ?? 0),
          heldCount: Number(o?.heldCount ?? 0),
          releasedCount: Number(o?.releasedCount ?? 0),
        },
      },
    },
  });
});

// ─── LIST ─────────────────────────────────────────────────────────────────────
// Query params: type=order|session|all  status=held|released  page  limit

export const listReserves = catchAsync(async (req, res) => {
  const { type = 'all', status, page = '1', limit = '20' } = req.query;
  const take = Math.min(Number(limit), 100);
  const offset = (Number(page) - 1) * take;

  const results = [];

  if (type === 'all' || type === 'order') {
    const where = [gt(orders.reserveAmountCents, 0)];
    if (status === 'released') where.push(isNotNull(orders.reserveReleasedAt));
    if (status === 'held') where.push(isNull(orders.reserveReleasedAt));

    const rows = await db
      .select({
        id: orders.id,
        totalAmount: orders.totalAmount,
        platformShareCents: orders.platformShareCents,
        stripeFeeCents: orders.stripeFeeCents,
        reserveAmountCents: orders.reserveAmountCents,
        reserveReleasedAt: orders.reserveReleasedAt,
        status: orders.status,
        createdAt: orders.createdAt,
        eventId: orders.eventId,
      })
      .from(orders)
      .where(and(...where))
      .orderBy(desc(orders.createdAt))
      .limit(take)
      .offset(offset);

    for (const r of rows) {
      const baseCents = Math.round(Number(r.totalAmount) * 100);
      const platformFee = r.platformShareCents ?? 0;
      const stripeFee = r.stripeFeeCents ?? 0;
      const reserve = r.reserveAmountCents ?? 0;
      const totalCents = baseCents + platformFee + stripeFee; // actual amount user paid
      results.push({
        id: r.id,
        type: 'order',
        status: r.status,
        createdAt: r.createdAt,
        eventId: r.eventId,
        totalAmountCents: totalCents,
        totalAmount: (totalCents / 100).toFixed(2),
        breakdown: {
          platformFeeCents: platformFee,
          platformFee: (platformFee / 100).toFixed(2),
          stripeFeeCents: stripeFee,
          stripeFee: (stripeFee / 100).toFixed(2),
          reserveAmountCents: reserve,
          reserveAmount: (reserve / 100).toFixed(2),
          organizerNetCents: baseCents - reserve,
          organizerNet: ((baseCents - reserve) / 100).toFixed(2),
        },
        reserve: {
          amountCents: reserve,
          amount: (reserve / 100).toFixed(2),
          reserveStatus: r.reserveReleasedAt ? 'released' : 'held',
          releasedAt: r.reserveReleasedAt ?? null,
        },
      });
    }
  }

  if (type === 'all') {
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.json({
    success: true,
    data: results,
    meta: { page: Number(page), limit: take, count: results.length },
  });
});

// ─── TRIGGER RELEASE (automated sweep, force-run) ────────────────────────────

export const triggerReserveRelease = catchAsync(async (req, res) => {
  const result = await runReserveRelease(true);
  res.json({ success: true, message: 'Reserve release run completed', data: result });
});

// ─── MANUAL: ORDER-LEVEL SET / ADJUST AMOUNT ─────────────────────────────────

export const adminAdjustOrderReserveAmount = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { action, amountCents, deltaCents, reason } = req.body;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, reserveAmountCents: true, reserveReleasedAt: true, eventId: true, status: true },
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.reserveReleasedAt) {
    return res.status(400).json({ success: false, message: 'Reserve already released for this order' });
  }

  const previous = order.reserveAmountCents ?? 0;
  const updated = action === 'set_amount' ? amountCents : Math.max(0, previous + deltaCents);

  if (order.status === 'cancelled' && updated !== 0) {
    return res.status(400).json({
      success: false,
      message: 'Order is cancelled — reserve can only be zeroed out, not increased or partially reduced',
    });
  }

  await db.update(orders).set({ reserveAmountCents: updated }).where(eq(orders.id, orderId));

  await db.insert(reserveAdjustments).values({
    orderId,
    eventId: order.eventId,
    adminId: req.user.id,
    action,
    previousAmountCents: previous,
    newAmountCents: updated,
    deltaCents: updated - previous,
    reason: reason ?? null,
  });

  logger.info('[Admin] Reserve amount adjusted', { orderId, previous, updated, adminId: req.user.id, reason });

  res.json({
    success: true,
    message: `Reserve amount updated from ${(previous / 100).toFixed(2)} to ${(updated / 100).toFixed(2)}`,
    data: { orderId, previousAmountCents: previous, newAmountCents: updated },
  });
});

// ─── MANUAL: ORDER-LEVEL RELEASE EARLY ───────────────────────────────────────

export const adminReleaseOrderReserveEarly = catchAsync(async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured' });

  const { orderId } = req.params;
  const { reason } = req.body;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, reserveAmountCents: true, reserveReleasedAt: true, eventId: true, status: true },
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.reserveReleasedAt) {
    return res.status(400).json({ success: false, message: 'Reserve already released for this order' });
  }
  if (order.status === 'cancelled') {
    return res.status(400).json({
      success: false,
      message: 'Cannot release reserve for a cancelled order .',
    });
  }
  if (!order.reserveAmountCents) {
    return res.status(400).json({ success: false, message: 'No reserve amount on this order' });
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, order.eventId),
    columns: { organizerId: true, title: true },
  });
  if (!event?.organizerId) {
    return res.status(400).json({ success: false, message: 'Event has no organizer' });
  }

  const account = await getOrganizerConnectAccount(event.organizerId);
  if (!account?.payoutsEnabled) {
    return res.status(400).json({ success: false, message: 'Organizer payouts not enabled' });
  }

  const transferId = await transferReserve(account.stripeAccountId, order.reserveAmountCents, {
    description: `Manual reserve release (admin) — order ${order.id}`,
    idempotencyKey: `reserve-admin-order-${order.id}`,
    metadata: {
      type: 'reserve_release_manual',
      source: 'admin_order',
      orderId: order.id,
      adminId: req.user.id,
      reason: (reason ?? '').slice(0, 400),
    },
  });

  if (!transferId) return res.status(502).json({ success: false, message: 'Stripe transfer failed' });

  await db.update(orders).set({ reserveReleasedAt: new Date() }).where(eq(orders.id, order.id));

  await db.insert(reserveAdjustments).values({
    orderId: order.id,
    eventId: order.eventId,
    adminId: req.user.id,
    action: 'release',
    previousAmountCents: order.reserveAmountCents,
    newAmountCents: order.reserveAmountCents,
    deltaCents: 0,
    transferId,
    reason: reason ?? null,
  });

  logger.info('[Admin] Reserve released early', { orderId: order.id, transferId, adminId: req.user.id });
  res.json({ success: true, message: 'Reserve released', data: { orderId: order.id, transferId } });
});

// ─── MANUAL: EVENT-LEVEL RELEASE ALL REMAINING RESERVES EARLY ───────────────

export const adminReleaseEventReserveEarly = catchAsync(async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured' });

  const { eventId } = req.params;
  const { reason } = req.body;

  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true, title: true, organizerId: true },
  });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  if (!event.organizerId) return res.status(400).json({ success: false, message: 'Event has no organizer' });

  const pendingOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.eventId, eventId),
      isNull(orders.reserveReleasedAt),
      gt(orders.reserveAmountCents, 0),
      ne(orders.status, 'cancelled')
    ),
    columns: { id: true, reserveAmountCents: true },
  });
  if (pendingOrders.length === 0) {
    return res.json({ success: true, message: 'No pending reserves for this event', data: { released: 0 } });
  }

  const account = await getOrganizerConnectAccount(event.organizerId);
  if (!account?.payoutsEnabled) {
    return res.status(400).json({ success: false, message: 'Organizer payouts not enabled' });
  }

  const totalCents = pendingOrders.reduce((sum, o) => sum + (o.reserveAmountCents ?? 0), 0);
  const orderIds = pendingOrders.map(o => o.id);

  const transferId = await transferReserve(account.stripeAccountId, totalCents, {
    description: `Manual reserve release (admin) — ${event.title ?? eventId} (${orderIds.length} orders)`,
    idempotencyKey: `reserve-admin-event-${idemKey(eventId, orderIds.sort().join(','))}`,
    metadata: {
      type: 'reserve_release_manual',
      source: 'admin_event',
      eventId,
      orderCount: String(orderIds.length),
      adminId: req.user.id,
      reason: (reason ?? '').slice(0, 400),
    },
    transferGroup: `event-${eventId}`,
  });

  if (!transferId) return res.status(502).json({ success: false, message: 'Stripe transfer failed' });

  await db
    .update(orders)
    .set({ reserveReleasedAt: new Date() })
    .where(and(inArray(orders.id, orderIds), isNull(orders.reserveReleasedAt)));

  await db.insert(reserveAdjustments).values({
    eventId,
    organizerId: event.organizerId,
    adminId: req.user.id,
    action: 'release',
    previousAmountCents: totalCents,
    newAmountCents: totalCents,
    deltaCents: 0,
    transferId,
    reason: reason ?? null,
  });

  logger.info('[Admin] Event reserves released early', {
    eventId,
    orderCount: orderIds.length,
    transferId,
    adminId: req.user.id,
  });
  res.json({
    success: true,
    message: `Released ${(totalCents / 100).toFixed(2)} across ${orderIds.length} orders`,
    data: { eventId, transferId, orderCount: orderIds.length, totalReleasedCents: totalCents },
  });
});

// ─── MANUAL: ORGANIZER-LEVEL BULK RELEASE ────────────────────────────────────

export const adminReleaseOrganizerReservesEarly = catchAsync(async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured' });

  const { organizerId } = req.params;
  const { reason } = req.body;

  const account = await getOrganizerConnectAccount(organizerId);
  if (!account?.payoutsEnabled) {
    return res.status(400).json({ success: false, message: 'Organizer payouts not enabled' });
  }

  const organizerEvents = await db.query.events.findMany({
    where: eq(events.organizerId, organizerId),
    columns: { id: true },
  });
  const eventIds = organizerEvents.map(e => e.id);
  if (eventIds.length === 0) {
    return res.json({ success: true, message: 'No events for this organizer', data: { released: 0 } });
  }

  const pendingOrders = await db.query.orders.findMany({
    where: and(
      inArray(orders.eventId, eventIds),
      isNull(orders.reserveReleasedAt),
      gt(orders.reserveAmountCents, 0),
      ne(orders.status, 'cancelled')
    ),
    columns: { id: true, reserveAmountCents: true },
  });
  if (pendingOrders.length === 0) {
    return res.json({ success: true, message: 'No pending reserves for this organizer', data: { released: 0 } });
  }

  const totalCents = pendingOrders.reduce((sum, o) => sum + (o.reserveAmountCents ?? 0), 0);
  const orderIds = pendingOrders.map(o => o.id);

  const transferId = await transferReserve(account.stripeAccountId, totalCents, {
    description: `Manual reserve release (admin) — organizer ${organizerId} (${orderIds.length} orders / ${eventIds.length} events)`,
    idempotencyKey: `reserve-admin-organizer-${idemKey(organizerId, orderIds.sort().join(','))}`,
    metadata: {
      type: 'reserve_release_manual',
      source: 'admin_organizer',
      organizerId,
      orderCount: String(orderIds.length),
      adminId: req.user.id,
      reason: (reason ?? '').slice(0, 400),
    },
  });

  if (!transferId) return res.status(502).json({ success: false, message: 'Stripe transfer failed' });

  await db
    .update(orders)
    .set({ reserveReleasedAt: new Date() })
    .where(and(inArray(orders.id, orderIds), isNull(orders.reserveReleasedAt)));

  await db.insert(reserveAdjustments).values({
    organizerId,
    adminId: req.user.id,
    action: 'release',
    previousAmountCents: totalCents,
    newAmountCents: totalCents,
    deltaCents: 0,
    transferId,
    reason: reason ?? null,
  });

  logger.info('[Admin] Organizer reserves released early', {
    organizerId,
    orderCount: orderIds.length,
    transferId,
    adminId: req.user.id,
  });
  res.json({
    success: true,
    message: `Released ${(totalCents / 100).toFixed(2)} across ${orderIds.length} orders / ${eventIds.length} events`,
    data: { organizerId, transferId, orderCount: orderIds.length, totalReleasedCents: totalCents },
  });
});