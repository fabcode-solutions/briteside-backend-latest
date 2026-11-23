/**
 * Business dashboard → Earnings: money figures for ONE business, computed from
 * our own records (business_bookings + the payout ledger), plus the owner's
 * wallet.
 *
 * Why not Stripe's transaction summary: business payouts reach the owner's
 * Connect account as plain reserve-release transfers (cron/reserveRelease.js),
 * so Stripe can't tell which business — or even which feature — they came from.
 *
 * The wallet itself is the owner's single payout ledger, shared by everything
 * they earn on Briteside (events, sessions, shop, businesses). Only the owner
 * can cash out or open Stripe; admins with wallet access see balances read-only.
 */
import httpStatus from 'http-status';
import { and, desc, eq, gte, inArray, lte, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businessBookings } from '../db/schema/index.js';
import { payoutLedgerEntries, paymentDisputes } from '../db/schema/stripeConnect.js';
import ApiError from '../utils/api-error.js';
import { PayoutLedgerService } from './payoutLedger.service.js';
import { bookingsAtLocations, viewLocationIds } from './businessLocation.service.js';
import { StripeConnectService } from './stripeConnect.service.js';
import { requestLedgerWithdrawal } from './payoutWithdrawal.service.js';

const SOURCE_TYPE = 'business_booking';
// Bookings that never took money / were never real
const EXCLUDED_STATUSES = ['awaiting_payment', 'expired'];
// Dispute states that cost (or may still cost) the business
const CHARGEBACK_STATUSES = ['open', 'lost'];
const COMMISSION_OFFSET_REASON = 'business_commission_offset';

const n = v => Number(v ?? 0);

function assertOwner(access) {
  if (access?.role !== 'owner') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the business owner can do this');
  }
}

export class BusinessEarningsService {
  /**
   * Summary for bookings MADE in [from, to] (same convention as the dashboard's
   * client-side "collections"), plus payouts RELEASED in [from, to].
   */
  static async summary(business, { from, to, locationId } = {}, access = null) {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;
    // One location (or a location manager's own): every figure below is tied to a booking
    const locationIds = viewLocationIds(access, locationId);
    const atLocation = locationIds?.length ? [await bookingsAtLocations(business.id, locationIds)] : [];

    const bookingConds = [
      eq(businessBookings.businessId, business.id),
      notInArray(businessBookings.status, EXCLUDED_STATUSES),
      ...atLocation,
    ];
    if (start) bookingConds.push(gte(businessBookings.createdAt, start));
    if (end) bookingConds.push(lte(businessBookings.createdAt, end));

    const ledgerConds = [
      eq(payoutLedgerEntries.sourceType, SOURCE_TYPE),
      eq(payoutLedgerEntries.bucket, 'available'),
      eq(businessBookings.businessId, business.id),
      ...atLocation,
    ];
    if (start) ledgerConds.push(gte(payoutLedgerEntries.createdAt, start));
    if (end) ledgerConds.push(lte(payoutLedgerEntries.createdAt, end));

    const [[totals], [held], [released], [chargebacks]] = await Promise.all([
      db
        .select({
          bookings: sql`count(*)`.mapWith(Number),
          grossCents: sql`coalesce(sum(${businessBookings.amountPaidCents}), 0)`.mapWith(Number),
          refundsCents: sql`coalesce(sum(${businessBookings.refundedCents}), 0)`.mapWith(Number),
          platformFeesCents: sql`coalesce(sum(${businessBookings.platformCommissionCents}), 0)`.mapWith(Number),
          customerTaxCents: sql`coalesce(sum(${businessBookings.taxAmountCents}) filter (where ${businessBookings.taxLiability} = 'account'), 0)`.mapWith(Number),
        })
        .from(businessBookings)
        .where(and(...bookingConds)),
      // Held right now (not range-limited): still waiting for the visit vs clearing after it
      db
        .select({
          awaitingVisitCents: sql`coalesce(sum(${businessBookings.reserveAmountCents}) filter (where ${businessBookings.status} in ('pending', 'confirmed')), 0)`.mapWith(Number),
          clearingCents: sql`coalesce(sum(${businessBookings.reserveAmountCents}) filter (where ${businessBookings.status} in ('completed', 'no_show')), 0)`.mapWith(Number),
          nextReleaseAt: sql`min(${businessBookings.completedAt}) filter (where ${businessBookings.status} in ('completed', 'no_show') and ${businessBookings.standardReleasedAt} is null and ${businessBookings.reserveAmountCents} > 0)`,
        })
        .from(businessBookings)
        .where(
          and(
            eq(businessBookings.businessId, business.id),
            sql`${businessBookings.reserveAmountCents} > 0`,
            ...atLocation
          )
        ),
      db
        .select({
          releasedCents: sql`coalesce(sum(${payoutLedgerEntries.amountCents}) filter (where ${payoutLedgerEntries.amountCents} > 0), 0)`.mapWith(Number),
          commissionOffsetCents: sql`coalesce(-sum(${payoutLedgerEntries.amountCents}) filter (where ${payoutLedgerEntries.reason} = ${COMMISSION_OFFSET_REASON}), 0)`.mapWith(Number),
        })
        .from(payoutLedgerEntries)
        .innerJoin(businessBookings, eq(businessBookings.id, payoutLedgerEntries.sourceId))
        .where(and(...ledgerConds)),
      // Disputes are matched by payment intent — either of a booking's two card payments
      db
        .select({ cents: sql`coalesce(sum(${paymentDisputes.amountCents}), 0)`.mapWith(Number), count: sql`count(*)`.mapWith(Number) })
        .from(paymentDisputes)
        .innerJoin(
          businessBookings,
          or(
            eq(businessBookings.stripePaymentIntentId, paymentDisputes.stripePaymentIntentId),
            eq(businessBookings.balancePaymentIntentId, paymentDisputes.stripePaymentIntentId)
          )
        )
        .where(
          and(
            eq(businessBookings.businessId, business.id),
            ...atLocation,
            inArray(paymentDisputes.status, CHARGEBACK_STATUSES),
            ...(start ? [gte(paymentDisputes.openedAt, start)] : []),
            ...(end ? [lte(paymentDisputes.openedAt, end)] : [])
          )
        ),
    ]);

    const netCents = totals.grossCents - totals.refundsCents - totals.platformFeesCents;
    const STANDARD_HOLD_DAYS = 14;
    const nextReleaseAt = held.nextReleaseAt
      ? new Date(new Date(held.nextReleaseAt).getTime() + STANDARD_HOLD_DAYS * 86_400_000)
      : null;

    return {
      range: { from: start, to: end },
      bookings: totals.bookings,
      // Service money taken online for this business (customers' booking fees go to Briteside)
      grossCents: totals.grossCents,
      refundsCents: totals.refundsCents,
      platformFeesCents: totals.platformFeesCents,
      // Stripe processing fees are paid by Briteside, never deducted from the business
      stripeFeesCents: 0,
      chargebacksCents: chargebacks.cents,
      chargebackCount: chargebacks.count,
      // Sales tax collected for the business to remit (only when the business is tax-liable)
      taxCollectedCents: totals.customerTaxCents,
      netCents,
      payouts: {
        releasedCents: released.releasedCents,
        commissionOffsetCents: released.commissionOffsetCents,
        netReleasedCents: released.releasedCents - released.commissionOffsetCents,
        heldAwaitingVisitCents: held.awaitingVisitCents,
        heldClearingCents: held.clearingCents,
        heldCents: held.awaitingVisitCents + held.clearingCents,
        nextReleaseAt: nextReleaseAt && nextReleaseAt.getTime() > Date.now() ? nextReleaseAt : null,
      },
    };
  }

  /** Each payout release for this business, newest first (with any commission taken from it). */
  static async payoutHistory(business, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const where = and(
      eq(payoutLedgerEntries.sourceType, SOURCE_TYPE),
      eq(payoutLedgerEntries.bucket, 'available'),
      eq(businessBookings.businessId, business.id)
    );
    // One row per release (or commission offset): its entries share booking + reason and are
    // written within the same moment (a final release may be split across two buckets).
    const rows = await db
      .select({
        bookingId: businessBookings.id,
        serviceName: businessBookings.serviceName,
        customerName: businessBookings.customerName,
        startAt: businessBookings.startAt,
        reason: payoutLedgerEntries.reason,
        releasedCents: sql`coalesce(sum(${payoutLedgerEntries.amountCents}) filter (where ${payoutLedgerEntries.amountCents} > 0), 0)`.mapWith(Number),
        offsetCents: sql`coalesce(-sum(${payoutLedgerEntries.amountCents}) filter (where ${payoutLedgerEntries.reason} = ${COMMISSION_OFFSET_REASON}), 0)`.mapWith(Number),
        at: sql`max(${payoutLedgerEntries.createdAt})`,
      })
      .from(payoutLedgerEntries)
      .innerJoin(businessBookings, eq(businessBookings.id, payoutLedgerEntries.sourceId))
      .where(where)
      .groupBy(
        businessBookings.id,
        businessBookings.serviceName,
        businessBookings.customerName,
        businessBookings.startAt,
        payoutLedgerEntries.reason,
        sql`date_trunc('minute', ${payoutLedgerEntries.createdAt})`
      )
      .orderBy(desc(sql`max(${payoutLedgerEntries.createdAt})`))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map(r => ({
        bookingId: r.bookingId,
        serviceName: r.serviceName,
        customerName: r.customerName,
        appointmentAt: r.startAt,
        kind:
          r.reason === COMMISSION_OFFSET_REASON
            ? 'commission_offset'
            : r.reason === 'day14_clear'
              ? 'standard_release'
              : r.reason === 'day21_clear'
                ? 'final_release'
                : 'release',
        amountCents: r.reason === COMMISSION_OFFSET_REASON ? -r.offsetCents : r.releasedCents,
        at: r.at ? new Date(r.at) : null,
      })),
      page,
      limit,
      hasMore,
    };
  }

  // ── Wallet (owner's shared payout ledger) ─────────────────────────────────

  static async wallet(business, access) {
    const ownerId = business.ownerId;
    const [ledger, connect] = await Promise.all([
      PayoutLedgerService.getOrCreateLedger(ownerId),
      StripeConnectService.getForUser(ownerId),
    ]);
    return {
      isOwner: access?.role === 'owner',
      shared: true,
      availableCents: n(ledger.availableCents),
      pendingCents: n(ledger.pendingCents),
      reserveCents: n(ledger.reserveCents),
      payoutSchedule: ledger.payoutSchedule,
      frozen: !!ledger.disputeFrozen,
      connected: !!connect,
      onboardingComplete: !!connect?.onboardingComplete,
      payoutsEnabled: !!connect?.payoutsEnabled,
    };
  }

  static async cashOut(business, access, amountCents) {
    assertOwner(access);
    return requestLedgerWithdrawal(business.ownerId, amountCents);
  }

  static async stripeDashboardLink(business, access) {
    assertOwner(access);
    return StripeConnectService.getDashboardLink(business.ownerId);
  }

  static async stripeOnboardingLink(business, access) {
    assertOwner(access);
    return StripeConnectService.getOnboardingLink(business.ownerId, 'US', {
      email: business.email ?? undefined,
      businessName: business.name,
      contactPhone: business.phone ?? undefined,
    });
  }
}
