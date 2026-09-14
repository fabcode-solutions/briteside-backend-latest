import { db } from '../db/index.js';
import {
  userSpends,
  userSubscriptions,
  groupSubscriptions,
  stripeCustomers,
} from '../db/schema/index.js';
import { eq, and, inArray, sum, count, desc, gte, lt, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import Stripe from 'stripe';
import config from '../config/config.js';

const stripe = config.stripe?.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;

const ACTIVE_SUB_STATUSES = ['active', 'trialing'];

export class UserSpendService {
  // Strip Stripe fields before any outbound response
  static _serialize(spend) {
    // eslint-disable-next-line no-unused-vars
    const { stripePaymentIntentId, stripeSessionId, ...rest } = spend;
    return rest;
  }

  /**
   * Single write path — all payment hooks call this.
   * Never throws: logs and swallows so a failed ledger write
   * never rolls back an already-confirmed payment.
   */
  static async recordSpend({
    userId,
    spendType,
    amountCents,
    referenceId,
    referenceType,
    eventId = null,
    talentUserId = null,
    groupId = null,
    metadata = {},
    stripePaymentIntentId = null,
    stripeSessionId = null,
    paidAt = new Date(),
  }) {
    console.log('[UserSpend] recordSpend called:', { userId, spendType, amountCents, referenceId });
    try {
      await db.insert(userSpends).values({
        userId,
        spendType,
        amountCents,
        referenceId,
        referenceType,
        eventId,
        talentUserId,
        groupId,
        metadata,
        stripePaymentIntentId,
        stripeSessionId,
        paidAt,
      });
      console.log('[UserSpend] recordSpend success:', { userId, spendType, referenceId });
    } catch (err) {
      console.error('[UserSpend] recordSpend failed:', {
        message: err.message,
        code: err.code,
        detail: err.detail,
        constraint: err.constraint,
        userId,
        spendType,
        amountCents,
        referenceId,
        referenceType,
      });
    }
  }

  /**
   * Generic refund marker for an existing spend row (or rows).
   * This updates the original spend entry so UI can show refunded status,
   * while negative refund ledger entries (if any) can still be recorded separately.
   */
  static async markSpendRefunded({
    userId,
    referenceId,
    referenceType,
    spendType,
    refundMeta = {},
  }) {
    try {
      const conditions = [];
      if (userId) conditions.push(eq(userSpends.userId, userId));
      if (referenceId) conditions.push(eq(userSpends.referenceId, referenceId));
      if (referenceType) conditions.push(eq(userSpends.referenceType, referenceType));
      if (spendType) conditions.push(eq(userSpends.spendType, spendType));

      if (conditions.length === 0) {
        console.warn('[UserSpend] markSpendRefunded skipped: no where conditions provided');
        return;
      }

      const rows = await db.query.userSpends.findMany({
        where: and(...conditions),
        columns: {
          id: true,
          refundMeta: true,
        },
      });

      if (rows.length === 0) {
        console.warn('[UserSpend] markSpendRefunded: no matching spend row', {
          userId,
          referenceId,
          referenceType,
          spendType,
        });
        return;
      }

      const refundedAt = new Date().toISOString();
      await Promise.all(
        rows.map(row => {
          const mergedRefundMeta = {
            ...(row.refundMeta || {}),
            ...refundMeta,
            refundedAt,
          };

          return db
            .update(userSpends)
            .set({ isRefunded: true, refundMeta: mergedRefundMeta })
            .where(eq(userSpends.id, row.id));
        })
      );
    } catch (err) {
      console.error('[UserSpend] markSpendRefunded failed:', {
        message: err.message,
        userId,
        referenceId,
        referenceType,
        spendType,
      });
    }
  }

  /**
   * Marks the original talent session spend entry as refunded.
   * Used after Stripe confirms a refund create call for a talent session.
   */
  static async markTalentSessionRefunded({ sessionId, userId, refundMeta = {} }) {
    await this.markSpendRefunded({
      userId,
      referenceId: sessionId,
      referenceType: 'talent_session',
      spendType: 'talent_session',
      refundMeta,
    });
  }

  /** Total spending grouped by spend type, with gross/refund/net breakdown. */
  static async getSummary(userId) {
    const rows = await db
      .select({
        spendType: userSpends.spendType,
        totalCents: sum(userSpends.amountCents),
      })
      .from(userSpends)
      .where(and(eq(userSpends.isRefunded, false), eq(userSpends.userId, userId)))
      .groupBy(userSpends.spendType);

    const byType = {};
    let grossCents = 0;
    let refundCents = 0;

    for (const row of rows) {
      const cents = parseInt(row.totalCents ?? 0, 10);
      byType[row.spendType] = (byType[row.spendType] ?? 0) + cents;
      if (cents >= 0) grossCents += cents;
      else refundCents += Math.abs(cents);
    }

    return {
      byType,
      totalSpentCents: grossCents,
      totalRefundedCents: refundCents,
      netSpentCents: grossCents - refundCents,
    };
  }

  /**
   * Spending grouped by period.
   * year only  → grouped by month for the full year.
   * year+month → grouped by day for that month.
   */
  static async getTimeline(userId, { year, month } = {}) {
    if (!year) throw new Error('year is required');
    const yr = parseInt(year, 10);
    const mo = month ? parseInt(month, 10) : null;

    const startDate = mo ? new Date(yr, mo - 1, 1) : new Date(yr, 0, 1);
    const endDate = mo ? new Date(yr, mo, 1) : new Date(yr + 1, 0, 1);

    const truncExpr = mo
      ? sql`DATE_TRUNC('day', ${userSpends.paidAt})`
      : sql`DATE_TRUNC('month', ${userSpends.paidAt})`;

    const rows = await db
      .select({
        period: truncExpr,
        spendType: userSpends.spendType,
        totalCents: sum(userSpends.amountCents),
      })
      .from(userSpends)
      .where(
        and(
          eq(userSpends.userId, userId),
          eq(userSpends.isRefunded, false),
          gte(userSpends.paidAt, startDate),
          lt(userSpends.paidAt, endDate)
        )
      )
      .groupBy(truncExpr, userSpends.spendType)
      .orderBy(truncExpr);

    return rows.map(r => ({
      period: r.period,
      spendType: r.spendType,
      totalCents: parseInt(r.totalCents ?? 0, 10),
    }));
  }

  /** All ticket_purchase entries for a specific event, with total. */
  static async getEventSpend(userId, eventId) {
    const rows = await db.query.userSpends.findMany({
      where: and(
        eq(userSpends.userId, userId),
        eq(userSpends.eventId, eventId),
        eq(userSpends.spendType, 'ticket_purchase'),
        eq(userSpends.isRefunded, false)
      ),
      orderBy: [desc(userSpends.paidAt)],
    });

    const totalCents = rows.reduce((acc, r) => acc + r.amountCents, 0);
    return { eventId, totalCents, entries: rows.map(r => this._serialize(r)) };
  }

  /**
   * Active subscriptions queried from live tables (not the ledger) so
   * cancellation state and period end dates are always current.
   */
  static async getActiveSubscriptions(userId) {
    const [platformSub, groupSubs] = await Promise.all([
      db.query.userSubscriptions.findFirst({
        where: and(
          eq(userSubscriptions.userId, userId),
          inArray(userSubscriptions.status, ACTIVE_SUB_STATUSES)
        ),
        with: { plan: true },
      }),
      db.query.groupSubscriptions.findMany({
        where: and(
          eq(groupSubscriptions.userId, userId),
          inArray(groupSubscriptions.status, [...ACTIVE_SUB_STATUSES, 'past_due'])
        ),
        with: {
          tier: { columns: { id: true, name: true, price: true, billingInterval: true } },
          group: { columns: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    return {
      platform: platformSub
        ? {
            planId: platformSub.planId,
            planName: platformSub.plan?.name ?? null,
            price: platformSub.plan?.price ?? null,
            interval: platformSub.plan?.interval ?? null,
            status: platformSub.status,
            currentPeriodEnd: platformSub.currentPeriodEnd,
            cancelAtPeriodEnd: platformSub.cancelAtPeriodEnd,
          }
        : null,
      groups: groupSubs.map(s => ({
        groupId: s.groupId,
        groupName: s.group?.name ?? null,
        groupSlug: s.group?.slug ?? null,
        tierId: s.tierId,
        tierName: s.tier?.name ?? null,
        price: s.tier?.price ?? null,
        billingInterval: s.tier?.billingInterval ?? null,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      })),
    };
  }

  /**
   * Syncs amountCents for a user's spend records from Stripe PaymentIntent amounts.
   * Pass userId to scope to one user, or null to sync all (admin use).
   */
  static async syncAmountsFromStripe(userId = null) {
    if (!stripe) return { total: 0, synced: 0, errors: 0 };

    const conditions = [isNotNull(userSpends.stripePaymentIntentId)];
    if (userId) conditions.push(eq(userSpends.userId, userId));

    const rows = await db
      .select({
        id: userSpends.id,
        amountCents: userSpends.amountCents,
        stripePaymentIntentId: userSpends.stripePaymentIntentId,
      })
      .from(userSpends)
      .where(and(...conditions));

    let synced = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const pi = await stripe.paymentIntents.retrieve(row.stripePaymentIntentId);
        if (pi.amount !== row.amountCents) {
          await db
            .update(userSpends)
            .set({ amountCents: pi.amount })
            .where(eq(userSpends.id, row.id));
          synced++;
        }
      } catch {
        errors++;
      }
    }

    return { total: rows.length, synced, errors };
  }

  /**
   * Fetches authoritative transaction list directly from Stripe using the customer ID.
   * Returns real charged amounts (including platform fees). Syncs any mismatched
   * amountCents in userSpends back to the correct Stripe value as a side-effect.
   */
  static async getStripeTransactions(userId, { limit = 50, startingAfter } = {}) {
    if (!stripe) return { items: [], hasMore: false, source: 'stripe_unavailable' };

    const customerRow = await db.query.stripeCustomers.findFirst({
      where: eq(stripeCustomers.userId, userId),
      columns: { stripeCustomerId: true },
    });
    if (!customerRow?.stripeCustomerId) return { items: [], hasMore: false, source: 'no_customer' };

    const params = {
      customer: customerRow.stripeCustomerId,
      limit: Math.min(limit, 100),
      expand: ['data.latest_charge'],
    };
    if (startingAfter) params.starting_after = startingAfter;

    const piList = await stripe.paymentIntents.list(params);
    const succeeded = piList.data.filter(pi => pi.status === 'succeeded');

    // Background sync: update any userSpends rows where amountCents is wrong
    if (succeeded.length > 0) {
      const piIds = succeeded.map(pi => pi.id);
      const piAmountMap = new Map(succeeded.map(pi => [pi.id, pi.amount]));
      db.select({
        id: userSpends.id,
        amountCents: userSpends.amountCents,
        stripePaymentIntentId: userSpends.stripePaymentIntentId,
      })
        .from(userSpends)
        .where(and(eq(userSpends.userId, userId), inArray(userSpends.stripePaymentIntentId, piIds)))
        .then(rows => {
          const toFix = rows.filter(
            r =>
              piAmountMap.has(r.stripePaymentIntentId) &&
              piAmountMap.get(r.stripePaymentIntentId) !== r.amountCents
          );
          return Promise.all(
            toFix.map(r =>
              db
                .update(userSpends)
                .set({ amountCents: piAmountMap.get(r.stripePaymentIntentId) })
                .where(eq(userSpends.id, r.id))
            )
          );
        })
        .catch(err => console.error('[UserSpend] background sync failed:', err.message));
    }

    return {
      items: piList.data.map(pi => ({
        stripePaymentIntentId: pi.id,
        amountCents: pi.amount,
        amount: (pi.amount / 100).toFixed(2),
        currency: pi.currency,
        status: pi.status,
        description: pi.description ?? null,
        createdAt: new Date(pi.created * 1000).toISOString(),
        paymentMethod: pi.latest_charge?.payment_method_details?.type ?? null,
        last4: pi.latest_charge?.payment_method_details?.card?.last4 ?? null,
        receiptUrl: pi.latest_charge?.receipt_url ?? null,
      })),
      hasMore: piList.has_more,
      source: 'stripe',
    };
  }

  /** Paginated spend history. Stripe fields excluded from every row. */
  static async getRecentSpends(userId, { page = 1, limit = 20, type } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(userSpends.userId, userId)];
    if (type) conditions.push(eq(userSpends.spendType, type));
    const whereClause = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.query.userSpends.findMany({
        where: whereClause,
        orderBy: [desc(userSpends.paidAt)],
        limit: limitNum,
        offset,
      }),
      db.select({ total: count() }).from(userSpends).where(whereClause),
    ]);

    return {
      items: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(total),
        pages: Math.ceil(Number(total) / limitNum),
      },
    };
  }
}
