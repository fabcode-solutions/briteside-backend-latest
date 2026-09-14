import { eq, and, gte, lte, inArray, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizers, events, orders, refunds, organizerPayouts } from '../db/schema/index.js';
import { systemSettings } from '../db/schema/admin.js';
import { StripeConnectService } from './stripeConnect.service.js';
import ApiError from '../utils/api-error.js';

const ORGANIZER_FEE_SHARE_RATE = 0.5;
const PREVIEW_FEE_PERCENTAGES = [1, 5, 10];

// ─── DATE RANGE HELPERS ───────────────────────────────────────────────────────

function buildDateRange(period, start, end) {
  const now = new Date();

  if (period === 'weekly') {
    return { startDate: new Date(now.getTime() - 7 * 86_400_000), endDate: now, groupBy: 'day' };
  }

  if (period === 'yearly') {
    return {
      startDate: new Date(now.getTime() - 365 * 86_400_000),
      endDate: now,
      groupBy: 'month',
    };
  }

  if (period === 'custom' && start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s) || isNaN(e) || s > e) throw new ApiError(400, 'Invalid custom date range');
    const spanDays = (e.getTime() - s.getTime()) / 86_400_000;
    return {
      startDate: s,
      endDate: e,
      groupBy: spanDays <= 31 ? 'day' : spanDays <= 365 ? 'week' : 'month',
    };
  }

  return { startDate: new Date(now.getTime() - 30 * 86_400_000), endDate: now, groupBy: 'day' };
}

function bucketKey(date, groupBy) {
  const d = new Date(date);
  if (groupBy === 'day') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (groupBy === 'week') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(new Date(date).setDate(diff));
    return `${mon.getFullYear()}-W${mon.getMonth()}-${mon.getDate()}`;
  }
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function bucketLabel(date, groupBy) {
  const d = new Date(date);
  if (groupBy === 'day') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (groupBy === 'week') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(new Date(date).setDate(diff));
    return mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ─── PLATFORM FEE CALCULATOR ─────────────────────────────────────────────────
// Organizer earns 50% of the platform fee collected on their event ticket sales.

function calculatePlatformFeeBreakdown(totalSalesCents, feePercentage) {
  const platformFeeCents = Math.round(totalSalesCents * (feePercentage / 100));
  const organizerShareCents = Math.round(platformFeeCents * ORGANIZER_FEE_SHARE_RATE);
  return {
    feePercentage,
    platformFeeAmount: Math.round(platformFeeCents / 100),
    platformFeeAmountCents: platformFeeCents,
    organizerShare: Math.round(organizerShareCents / 100),
    organizerShareCents,
    platformKeeps: Math.round((platformFeeCents - organizerShareCents) / 100),
    platformKeepsCents: platformFeeCents - organizerShareCents,
  };
}

// ─── EARNINGS COMPUTATION ─────────────────────────────────────────────────────

function computeStats(ordersData, refundRows, feePercByEventId) {
  const refundedOrderIds = new Set(refundRows.map(r => r.orderId));
  let grossCents = 0,
    platformFeesCents = 0,
    refundedCents = 0,
    ticketsSold = 0;

  for (const order of ordersData) {
    const amountCents = Math.round(parseFloat(order.totalAmount || 0) * 100);
    const feePerc = parseFloat(feePercByEventId[order.eventId] || 0);
    grossCents += amountCents;
    platformFeesCents += Math.round(amountCents * (feePerc / 100));
    if (refundedOrderIds.has(order.id)) refundedCents += amountCents;
    for (const item of order.items || []) {
      if (item.itemType === 'ticket') ticketsSold += item.quantity || 1;
    }
  }

  const organizerFeeShareCents = Math.round(platformFeesCents * ORGANIZER_FEE_SHARE_RATE);
  return {
    grossRevenueCents: grossCents,
    platformFeesCents,
    organizerFeeShareCents,
    refundsChargebacksCents: refundedCents,
    netEarningsCents: Math.max(0, grossCents - platformFeesCents - refundedCents),
    ticketsSold,
  };
}

function buildChart(ordersData, refundRows, feePercByEventId, startDate, endDate, groupBy) {
  const buckets = new Map();
  const refundedOrderIds = new Set(refundRows.map(r => r.orderId));

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = bucketKey(cursor, groupBy);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: bucketLabel(new Date(cursor), groupBy),
        grossCents: 0,
        feeCents: 0,
        refundCents: 0,
        tickets: 0,
      });
    }
    if (groupBy === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else if (groupBy === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
  }

  for (const order of ordersData) {
    const key = bucketKey(order.createdAt, groupBy);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const amountCents = Math.round(parseFloat(order.totalAmount || 0) * 100);
    const feePerc = parseFloat(feePercByEventId[order.eventId] || 0);
    bucket.grossCents += amountCents;
    bucket.feeCents += Math.round(amountCents * (feePerc / 100));
    if (refundedOrderIds.has(order.id)) bucket.refundCents += amountCents;
    for (const item of order.items || []) {
      if (item.itemType === 'ticket') bucket.tickets += item.quantity || 1;
    }
  }

  return Array.from(buckets.values()).map(b => ({
    label: b.label,
    grossRevenue: Math.round(b.grossCents / 100),
    platformFees: Math.round(b.feeCents / 100),
    refunds: Math.round(b.refundCents / 100),
    netEarnings: Math.max(0, Math.round((b.grossCents - b.feeCents - b.refundCents) / 100)),
    ticketsSold: b.tickets,
  }));
}

async function fetchOrdersAndRefunds(eventIds, startDate, endDate) {
  const paidOrders = await db.query.orders.findMany({
    where: and(
      inArray(orders.eventId, eventIds),
      eq(orders.status, 'paid'),
      gte(orders.createdAt, startDate),
      lte(orders.createdAt, endDate)
    ),
    with: { items: { columns: { id: true, itemType: true, quantity: true } } },
    columns: { id: true, eventId: true, totalAmount: true, createdAt: true },
  });

  const orderIds = paidOrders.map(o => o.id);
  const refundRows =
    orderIds.length > 0
      ? await db.query.refunds.findMany({
          where: inArray(refunds.orderId, orderIds),
          columns: { id: true, orderId: true, amount: true },
        })
      : [];

  return { ordersData: paidOrders, refundRows };
}

// ─── SERVICE ──────────────────────────────────────────────────────────────────

export class OrganizerEarningsService {
  static async _resolveOrganizer(userId) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });
    if (!organizer) throw new ApiError(404, 'Organizer profile not found');
    return organizer;
  }

  static async getEarnings(userId, { period = 'monthly', start, end } = {}) {
    const organizer = await OrganizerEarningsService._resolveOrganizer(userId);
    const { startDate, endDate, groupBy } = buildDateRange(period, start, end);

    const eventRows = await db
      .select({ id: events.id, platformFeePercentage: events.platformFeePercentage })
      .from(events)
      .where(eq(events.organizerId, organizer.id));

    if (eventRows.length === 0) {
      return {
        summary: {
          grossRevenue: 0,
          platformFees: 0,
          refundsChargebacks: 0,
          netEarnings: 0,
          ticketsSold: 0,
        },
        chart: [],
        period: {
          type: period,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          groupBy,
        },
      };
    }

    const feePercByEventId = Object.fromEntries(
      eventRows.map(e => [e.id, e.platformFeePercentage])
    );
    const { ordersData, refundRows } = await fetchOrdersAndRefunds(
      eventRows.map(e => e.id),
      startDate,
      endDate
    );
    const stats = computeStats(ordersData, refundRows, feePercByEventId);

    return {
      summary: {
        grossRevenue: Math.round(stats.grossRevenueCents / 100),
        grossRevenueCents: stats.grossRevenueCents,
        platformFees: Math.round(stats.platformFeesCents / 100),
        platformFeesCents: stats.platformFeesCents,
        organizerFeeShare: Math.round(stats.organizerFeeShareCents / 100),
        organizerFeeShareCents: stats.organizerFeeShareCents,
        refundsChargebacks: Math.round(stats.refundsChargebacksCents / 100),
        refundsChargebacksCents: stats.refundsChargebacksCents,
        netEarnings: Math.round(stats.netEarningsCents / 100),
        netEarningsCents: stats.netEarningsCents,
        ticketsSold: stats.ticketsSold,
      },
      chart: buildChart(ordersData, refundRows, feePercByEventId, startDate, endDate, groupBy),
      period: { type: period, start: startDate.toISOString(), end: endDate.toISOString(), groupBy },
    };
  }

  static async getEventEarnings(userId, eventId, { period = 'monthly', start, end } = {}) {
    const organizer = await OrganizerEarningsService._resolveOrganizer(userId);
    const { startDate, endDate, groupBy } = buildDateRange(period, start, end);

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizer.id)),
      columns: { id: true, title: true, platformFeePercentage: true },
    });
    if (!event) throw new ApiError(404, 'Event not found');

    const feePercByEventId = { [event.id]: event.platformFeePercentage };
    const { ordersData, refundRows } = await fetchOrdersAndRefunds([event.id], startDate, endDate);
    const stats = computeStats(ordersData, refundRows, feePercByEventId);

    return {
      event: { id: event.id, title: event.title },
      summary: {
        grossRevenue: Math.round(stats.grossRevenueCents / 100),
        grossRevenueCents: stats.grossRevenueCents,
        platformFees: Math.round(stats.platformFeesCents / 100),
        platformFeesCents: stats.platformFeesCents,
        organizerFeeShare: Math.round(stats.organizerFeeShareCents / 100),
        organizerFeeShareCents: stats.organizerFeeShareCents,
        refundsChargebacks: Math.round(stats.refundsChargebacksCents / 100),
        refundsChargebacksCents: stats.refundsChargebacksCents,
        netEarnings: Math.round(stats.netEarningsCents / 100),
        netEarningsCents: stats.netEarningsCents,
        ticketsSold: stats.ticketsSold,
      },
      chart: buildChart(ordersData, refundRows, feePercByEventId, startDate, endDate, groupBy),
      period: { type: period, start: startDate.toISOString(), end: endDate.toISOString(), groupBy },
    };
  }

  static async getFeeCalculator(userId, { eventId, totalSales } = {}) {
    const organizer = await OrganizerEarningsService._resolveOrganizer(userId);

    let feePercentage = 0;
    let eventTitle = null;
    let grossSalesCents = null;

    if (eventId) {
      const event = await db.query.events.findFirst({
        where: and(eq(events.id, eventId), eq(events.organizerId, organizer.id)),
        columns: { id: true, title: true, platformFeePercentage: true },
      });
      if (!event) throw new ApiError(404, 'Event not found');
      feePercentage = parseFloat(event.platformFeePercentage || 0);
      eventTitle = event.title;

      if (!totalSales) {
        const paidOrders = await db.query.orders.findMany({
          where: and(eq(orders.eventId, event.id), eq(orders.status, 'paid')),
          columns: { totalAmount: true },
        });
        grossSalesCents = paidOrders.reduce(
          (sum, o) => sum + Math.round(parseFloat(o.totalAmount || 0) * 100),
          0
        );
      }
    }

    if (!feePercentage) {
      const feeRow = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.settingKey, 'platform_fee_percentage'),
      });
      feePercentage = feeRow ? Number(feeRow.settingValue?.percentage ?? 0) : 0;
    }

    const totalSalesCents = totalSales
      ? Math.round(parseFloat(totalSales) * 100)
      : (grossSalesCents ?? 2_500_000);

    const current = calculatePlatformFeeBreakdown(totalSalesCents, feePercentage);
    const scenarios = PREVIEW_FEE_PERCENTAGES.map(p =>
      calculatePlatformFeeBreakdown(totalSalesCents, p)
    );

    return {
      ...(eventId && { event: { id: eventId, title: eventTitle } }),
      totalSales: Math.round(totalSalesCents / 100),
      totalSalesCents,
      currentFeePercentage: feePercentage,
      current,
      scenarios,
      note: 'Organizer earns 50% of the platform fee collected on ticket sales.',
    };
  }

  static async getWallet(userId) {
    const organizer = await OrganizerEarningsService._resolveOrganizer(userId);

    const [stripeBalance, recentPayouts, summary, [cashedOutRow]] = await Promise.all([
      StripeConnectService.getBalance(userId),
      db.query.organizerPayouts.findMany({
        where: eq(organizerPayouts.organizerId, organizer.id),
        orderBy: (p, { desc }) => [desc(p.createdAt)],
        limit: 5,
        columns: {
          id: true,
          amountCents: true,
          status: true,
          type: true,
          stripePayoutId: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      StripeConnectService.getTransactionSummary(userId),
      db
        .select({ total: sum(organizerPayouts.amountCents) })
        .from(organizerPayouts)
        .where(
          and(
            eq(organizerPayouts.userId, userId),
            inArray(organizerPayouts.status, ['paid', 'pending'])
          )
        ),
    ]);

    // Organizer feature = ticket earnings net
    const ticketBucket = summary.byType.find(t => t.type === 'ticket');
    const organizerEarnedCents = ticketBucket?.netCents ?? 0;
    const organizerCashedOutCents = Number(cashedOutRow?.total ?? 0);
    const featureAvailableCents = Math.min(
      Math.max(0, organizerEarnedCents - organizerCashedOutCents),
      stripeBalance.availableCents
    );

    return {
      availableCents: stripeBalance.availableCents,
      pendingCents: stripeBalance.pendingCents,
      available: Math.round(stripeBalance.availableCents / 100),
      pending: stripeBalance.pendingCents / 100,
      currency: stripeBalance.currency,
      connected: stripeBalance.connected,
      // Feature-specific balance (virtual: ticket earnings from Stripe minus DB cashouts)
      featureAvailableCents,
      featureAvailable: +(featureAvailableCents / 100).toFixed(2),
      organizerEarnedCents,
      organizerEarned: +(organizerEarnedCents / 100).toFixed(2),
      organizerCashedOutCents,
      organizerCashedOut: +(organizerCashedOutCents / 100).toFixed(2),
      recentPayouts: recentPayouts.map(p => ({ ...p, amount: Math.round(p.amountCents / 100) })),
    };
  }

  static async requestCashout(userId, { amountCents, payoutMethodId, type = 'standard' }) {
    const organizer = await OrganizerEarningsService._resolveOrganizer(userId);
    if (!amountCents || amountCents < 100) throw new ApiError(400, 'Minimum cashout is $1.00');

    // Feature-balance validation: can only cashout up to ticket net earnings
    const [summary, [cashedOutRow]] = await Promise.all([
      StripeConnectService.getTransactionSummary(userId),
      db
        .select({ total: sum(organizerPayouts.amountCents) })
        .from(organizerPayouts)
        .where(
          and(
            eq(organizerPayouts.userId, userId),
            inArray(organizerPayouts.status, ['paid', 'pending'])
          )
        ),
    ]);
    const earnedCents = summary.byType.find(t => t.type === 'ticket')?.netCents ?? 0;
    const featureAvailableCents = Math.max(0, earnedCents - Number(cashedOutRow?.total ?? 0));
    if (amountCents > featureAvailableCents) {
      throw new ApiError(
        400,
        `Insufficient organizer earnings. Feature available: ${featureAvailableCents} cents`
      );
    }

    const connectAccount = await StripeConnectService.getForUser(userId);
    let stripePayoutId = null;

    if (connectAccount?.payoutsEnabled) {
      const payout = await StripeConnectService.requestPayout(userId, amountCents, type, {
        service: 'events',
      });
      stripePayoutId = payout.id;
    }

    const [record] = await db
      .insert(organizerPayouts)
      .values({
        userId,
        organizerId: organizer.id,
        payoutMethodId: payoutMethodId ?? null,
        amountCents,
        status: stripePayoutId ? 'paid' : 'pending',
        type: connectAccount?.payoutsEnabled ? type : 'manual',
        stripePayoutId,
        processedAt: stripePayoutId ? new Date() : null,
      })
      .returning();

    return { ...record, amount: Math.round(record.amountCents / 100) };
  }

  static async getPayouts(userId, { page = 1, limit = 20 } = {}) {
    const { data } = await StripeConnectService.listPayouts(userId, { limit: 100 });
    const offset = (page - 1) * limit;
    const items = data.slice(offset, offset + limit).map(p => ({
      id: p.id,
      amount: p.amount / 100,
      amountCents: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      arrivalDate: p.arrival_date,
      destination: p.destination,
      metadata: p.metadata,
      createdAt: new Date(p.created * 1000).toISOString(),
    }));
    return { items, page, limit, total: data.length };
  }
}
