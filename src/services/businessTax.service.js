/**
 * Dashboard → Taxes for a business.
 *
 * Tax on business bookings is calculated by Stripe against the OWNER's Stripe
 * Connect account registrations when they hold any active US registration,
 * else Briteside's (see PlusTaxLiabilityService). Each booking records who was
 * liable in tax_liability:
 *   'account' — the business collected it (it's in their payout) and must remit it
 *   'self'    — Briteside collected and remits it
 *   'none'    — no tax charged
 *
 * Refunds give tax back in proportion to the service refund (refundBooking),
 * so refunded tax is derived the same way: tax × refunded / paid.
 * Months are in the business's timezone and follow when the booking was made
 * (= paid at checkout; a balance paid online later is counted with its booking).
 */
import httpStatus from 'http-status';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businessBookings } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { StripeConnectService } from './stripeConnect.service.js';
import { PlusTaxLiabilityService } from './tax/plusTaxLiability.service.js';

const emptyTotals = () => ({
  bookings: 0,
  onlineSalesCents: 0,
  refundedCents: 0,
  taxCollectedCents: 0,
  taxRefundedCents: 0,
  netTaxCents: 0,
});

const add = (t, r) => {
  t.bookings += r.bookings;
  t.onlineSalesCents += r.paid - r.refunded;
  t.refundedCents += r.refunded;
  t.taxCollectedCents += r.tax;
  t.taxRefundedCents += r.taxRefunded;
  t.netTaxCents += r.tax - r.taxRefunded;
};

export class BusinessTaxService {
  /**
   * { year, timezone, stripe: { connected, hasRegistration }, months: [{ month: 1..12,
   *   business: totals, briteside: totals, none: totals }], totals: { business, briteside, none } }
   * business = tax the business collected and must remit; briteside = remitted by Briteside.
   */
  static async summary(business, { year }) {
    const tz = business.timezone || 'America/New_York';
    const local = sql`(${businessBookings.createdAt} AT TIME ZONE ${tz}::text)`;

    const rows = await db
      .select({
        month: sql`extract(month from ${local})`.mapWith(Number),
        liability: businessBookings.taxLiability,
        bookings: sql`count(*)`.mapWith(Number),
        paid: sql`coalesce(sum(${businessBookings.amountPaidCents}), 0)`.mapWith(Number),
        refunded: sql`coalesce(sum(${businessBookings.refundedCents}), 0)`.mapWith(Number),
        tax: sql`coalesce(sum(${businessBookings.taxAmountCents}), 0)`.mapWith(Number),
        taxRefunded: sql`coalesce(sum(round(${businessBookings.taxAmountCents}::numeric * ${businessBookings.refundedCents} / nullif(${businessBookings.amountPaidCents}, 0))), 0)`.mapWith(
          Number
        ),
      })
      .from(businessBookings)
      .where(
        and(
          eq(businessBookings.businessId, business.id),
          gt(businessBookings.amountPaidCents, 0),
          sql`extract(year from ${local}) = ${year}::int`
        )
      )
      .groupBy(sql`1`, businessBookings.taxLiability);

    const bucket = l => (l === 'account' ? 'business' : l === 'self' ? 'briteside' : 'none');
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      business: emptyTotals(),
      briteside: emptyTotals(),
      none: emptyTotals(),
    }));
    const totals = { business: emptyTotals(), briteside: emptyTotals(), none: emptyTotals() };
    for (const r of rows) {
      const m = months[r.month - 1];
      if (!m) continue;
      add(m[bucket(r.liability)], r);
      add(totals[bucket(r.liability)], r);
    }

    // Best effort: whether tax can be collected for the business at all
    let connected = false;
    let hasRegistration = false;
    try {
      const account = await StripeConnectService.getForUser(business.ownerId);
      connected = !!account?.chargesEnabled;
      if (account?.stripeAccountId) {
        const { account: withReg } = await PlusTaxLiabilityService._accountHasActiveUsRegistration(
          business.ownerId
        );
        hasRegistration = !!withReg;
      }
    } catch (err) {
      logger.warn(`[businessTax] Stripe status lookup failed: ${err.message}`);
    }

    return { year, timezone: tz, stripe: { connected, hasRegistration }, months, totals };
  }

  /**
   * Stripe AccountSession for the embedded Tax Settings / Registrations
   * components on the owner's connected account. Owner only — it's their
   * personal Stripe account (shared with their creator earnings).
   */
  static async accountSession(business, access) {
    if (access?.role !== 'owner') {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only the business owner can manage tax registrations — they live on the owner’s Stripe account'
      );
    }
    return StripeConnectService.getTaxAccountSession(business.ownerId);
  }
}
