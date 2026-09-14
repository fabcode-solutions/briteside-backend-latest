import { eq, and, gte, lte, inArray, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import { talentSessions, talentPayouts, shopOrders } from '../db/schema/index.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { StripeConnectService } from './stripeConnect.service.js';
import ApiError from '../utils/api-error.js';
import { TalentProfileService } from './talentSession.service.js';

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

  // default: monthly (last 30 days)
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

function buildChart(sessions, msgPayments, shopOrderRows, startDate, endDate, groupBy) {
  const buckets = new Map();

  // Pre-populate all buckets across the range
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = bucketKey(cursor, groupBy);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: bucketLabel(new Date(cursor), groupBy),
        videoEarningsCents: 0,
        messageEarningsCents: 0,
        shopEarningsCents: 0,
        pendingCents: 0,
      });
    }
    if (groupBy === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else if (groupBy === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
  }

  for (const s of sessions) {
    const key = bucketKey(s.scheduledAt, groupBy);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (s.status === 'completed' && !s.refundIssuedAt)
      bucket.videoEarningsCents += s.priceCents || 0;
    else if (['confirmed', 'live'].includes(s.status)) bucket.pendingCents += s.priceCents || 0;
  }

  for (const m of msgPayments) {
    const key = bucketKey(m.paidAt || m.createdAt, groupBy);
    const bucket = buckets.get(key);
    if (bucket) bucket.messageEarningsCents += m.baseCents || 0;
  }

  // Refunded orders are excluded by the query, so anything here is real revenue.
  for (const o of shopOrderRows) {
    const key = bucketKey(o.paidAt, groupBy);
    const bucket = buckets.get(key);
    if (bucket) bucket.shopEarningsCents += o.sellerReceiveCents || 0;
  }

  return Array.from(buckets.values()).map(b => ({
    label: b.label,
    videoEarnings: Math.round(b.videoEarningsCents / 100),
    messageEarnings: Math.round(b.messageEarningsCents / 100),
    shopEarnings: Math.round(b.shopEarningsCents / 100),
    pending: Math.round(b.pendingCents / 100),
  }));
}

// ─── SERVICE ──────────────────────────────────────────────────────────────────

export class TalentEarningsService {
  static async _resolveProfile(userId) {
    const profile = await TalentProfileService.getByUserId(userId).catch(() => null);
    if (!profile) throw new ApiError(404, 'Talent profile not found');
    return profile;
  }

  static async getEarnings(userId, { period = 'monthly', start, end } = {}) {
    const profile = await TalentEarningsService._resolveProfile(userId);
    const { startDate, endDate, groupBy } = buildDateRange(period, start, end);
    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    // Use db.select() (not db.query) to avoid broken relational query builder on these tables
    const [transfers, sessions, msgPayments, shopOrderRows] = await Promise.all([
      StripeConnectService.listTransfers(userId, { startTs, endTs }),
      db
        .select({
          id: talentSessions.id,
          status: talentSessions.status,
          priceCents: talentSessions.priceCents,
          scheduledAt: talentSessions.scheduledAt,
          refundIssuedAt: talentSessions.refundIssuedAt,
          stripePaymentIntentId: talentSessions.stripePaymentIntentId,
        })
        .from(talentSessions)
        .where(
          and(
            eq(talentSessions.talentProfileId, profile.id),
            gte(talentSessions.scheduledAt, startDate),
            lte(talentSessions.scheduledAt, endDate),
            inArray(talentSessions.status, [
              'completed',
              'confirmed',
              'live',
              'pending',
              'cancelled',
            ])
          )
        ),
      db
        .select({
          id: priorityMessagePayments.id,
          baseCents: priorityMessagePayments.baseCents,
          paidAt: priorityMessagePayments.paidAt,
          createdAt: priorityMessagePayments.createdAt,
          stripePaymentIntent: priorityMessagePayments.stripePaymentIntent,
        })
        .from(priorityMessagePayments)
        .where(
          and(
            eq(priorityMessagePayments.talentProfileId, profile.id),
            eq(priorityMessagePayments.status, 'paid'),
            gte(priorityMessagePayments.paidAt, startDate),
            lte(priorityMessagePayments.paidAt, endDate)
          )
        ),
      // Shop sales are keyed to the seller's userId, not their talentProfileId —
      // a shop seller need not have a talent profile at all.
      db
        .select({
          id: shopOrders.id,
          sellerReceiveCents: shopOrders.sellerReceiveCents,
          paidAt: shopOrders.paidAt,
          stripePaymentIntentId: shopOrders.stripePaymentIntentId,
        })
        .from(shopOrders)
        .where(
          and(
            eq(shopOrders.sellerId, userId),
            eq(shopOrders.status, 'paid'),
            gte(shopOrders.paidAt, startDate),
            lte(shopOrders.paidAt, endDate)
          )
        ),
    ]);

    // PI → DB maps for category tagging
    const sessionByPi = new Map(
      sessions.filter(s => s.stripePaymentIntentId).map(s => [s.stripePaymentIntentId, s])
    );
    const messageByPi = new Map(
      msgPayments.filter(m => m.stripePaymentIntent).map(m => [m.stripePaymentIntent, m])
    );
    const shopByPi = new Map(
      shopOrderRows.filter(o => o.stripePaymentIntentId).map(o => [o.stripePaymentIntentId, o])
    );

    let videoEarningsCents = 0;
    let messageEarningsCents = 0;
    let shopEarningsCents = 0;
    let refundedCents = 0;
    const useStripe = transfers.length > 0;

    if (useStripe) {
      // Net amounts from Stripe after application_fee deduction — accurate
      for (const t of transfers) {
        // source_transaction is expanded Charge → has .payment_intent string
        const piId =
          t.source_transaction && typeof t.source_transaction === 'object'
            ? t.source_transaction.payment_intent
            : null;
        const netCents = t.amount;

        const session = piId ? sessionByPi.get(piId) : null;
        const message = piId ? messageByPi.get(piId) : null;
        const shopOrder = piId ? shopByPi.get(piId) : null;

        if (session) {
          session.refundIssuedAt ? (refundedCents += netCents) : (videoEarningsCents += netCents);
        } else if (message) {
          messageEarningsCents += netCents;
        } else if (shopOrder) {
          shopEarningsCents += netCents;
        } else {
          // Unmatched (e.g. session before PI column was stored) → video bucket
          videoEarningsCents += netCents;
        }
      }
    } else {
      // No Connect or no transfers yet — use DB gross amounts as estimate
      const completed = sessions.filter(s => s.status === 'completed');
      videoEarningsCents = completed
        .filter(s => !s.refundIssuedAt)
        .reduce((sum, s) => sum + (s.priceCents || 0), 0);
      messageEarningsCents = msgPayments.reduce((sum, m) => sum + (m.baseCents || 0), 0);
      shopEarningsCents = shopOrderRows.reduce((sum, o) => sum + (o.sellerReceiveCents || 0), 0);
      refundedCents = completed
        .filter(s => s.refundIssuedAt)
        .reduce((sum, s) => sum + (s.priceCents || 0), 0);
    }

    const totalEarningsCents = videoEarningsCents + messageEarningsCents + shopEarningsCents;

    return {
      summary: {
        totalEarnings: Math.round(totalEarningsCents / 100),
        totalEarningsCents,
        videoChatEarnings: Math.round(videoEarningsCents / 100),
        videoChatEarningsCents: videoEarningsCents,
        messageEarnings: Math.round(messageEarningsCents / 100),
        messageEarningsCents,
        shopEarnings: Math.round(shopEarningsCents / 100),
        shopEarningsCents,
        refunded: Math.round(refundedCents / 100),
        refundedCents,
        source: useStripe ? 'stripe' : 'db_estimate',
      },
      chart: buildChart(sessions, msgPayments, shopOrderRows, startDate, endDate, groupBy),
      period: { type: period, start: startDate.toISOString(), end: endDate.toISOString(), groupBy },
    };
  }

  static async getWallet(userId) {
    const profile = await TalentEarningsService._resolveProfile(userId);

    const [stripeBalance, recentPayouts, summary, [cashedOutRow]] = await Promise.all([
      StripeConnectService.getBalance(userId),
      db.query.talentPayouts.findMany({
        where: eq(talentPayouts.talentProfileId, profile.id),
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
        .select({ total: sum(talentPayouts.amountCents) })
        .from(talentPayouts)
        .where(
          and(eq(talentPayouts.userId, userId), inArray(talentPayouts.status, ['paid', 'pending']))
        ),
    ]);

    // Talent feature = talent_session + priority_message + shop net earnings.
    // Shop is included so digital-product revenue is withdrawable rather than
    // stranded in the Stripe balance.
    const sessionBucket = summary.byType.find(t => t.type === 'talent_session');
    const messageBucket = summary.byType.find(t => t.type === 'priority_message');
    const shopBucket = summary.byType.find(t => t.type === 'shop');
    const talentEarnedCents =
      (sessionBucket?.netCents ?? 0) + (messageBucket?.netCents ?? 0) + (shopBucket?.netCents ?? 0);
    const talentCashedOutCents = Number(cashedOutRow?.total ?? 0);
    const featureAvailableCents = Math.min(
      Math.max(0, talentEarnedCents - talentCashedOutCents),
      stripeBalance.availableCents
    );

    return {
      availableCents: stripeBalance.availableCents,
      pendingCents: stripeBalance.pendingCents,
      available: Math.round(stripeBalance.availableCents / 100),
      pending: stripeBalance.pendingCents / 100,
      currency: stripeBalance.currency,
      connected: stripeBalance.connected,
      // Feature-specific balance (virtual: earned from Stripe minus DB cashouts)
      featureAvailableCents,
      featureAvailable: +(featureAvailableCents / 100).toFixed(2),
      talentEarnedCents,
      talentEarned: +(talentEarnedCents / 100).toFixed(2),
      talentCashedOutCents,
      talentCashedOut: +(talentCashedOutCents / 100).toFixed(2),
      recentPayouts: recentPayouts.map(p => ({ ...p, amount: Math.round(p.amountCents / 100) })),
    };
  }

  static async requestCashout(userId, { amountCents, payoutMethodId, type = 'standard' }) {
    const profile = await TalentEarningsService._resolveProfile(userId);
    if (!amountCents || amountCents < 100) throw new ApiError(400, 'Minimum cashout is $1.00');

    // Feature-balance validation: can only cashout up to talent_session + priority_message net earnings
    const [summary, [cashedOutRow]] = await Promise.all([
      StripeConnectService.getTransactionSummary(userId),
      db
        .select({ total: sum(talentPayouts.amountCents) })
        .from(talentPayouts)
        .where(
          and(eq(talentPayouts.userId, userId), inArray(talentPayouts.status, ['paid', 'pending']))
        ),
    ]);
    const earnedCents =
      (summary.byType.find(t => t.type === 'talent_session')?.netCents ?? 0) +
      (summary.byType.find(t => t.type === 'priority_message')?.netCents ?? 0) +
      (summary.byType.find(t => t.type === 'shop')?.netCents ?? 0);
    const featureAvailableCents = Math.max(0, earnedCents - Number(cashedOutRow?.total ?? 0));
    if (amountCents > featureAvailableCents) {
      throw new ApiError(
        400,
        `Insufficient talent earnings. Feature available: ${featureAvailableCents} cents`
      );
    }

    const connectAccount = await StripeConnectService.getForUser(userId);
    let stripePayoutId = null;

    if (connectAccount?.payoutsEnabled) {
      const payout = await StripeConnectService.requestPayout(userId, amountCents, type, {
        service: 'talents',
      });
      stripePayoutId = payout.id;
    }

    const [record] = await db
      .insert(talentPayouts)
      .values({
        userId,
        talentProfileId: profile.id,
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
