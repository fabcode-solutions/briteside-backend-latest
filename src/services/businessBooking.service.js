/**
 * Business bookings: slot availability, Stripe checkout, payment webhook,
 * lifecycle actions and policy-based refunds.
 *
 * Money (all cents):
 *   servicePriceCents        full price of the service
 *   amountDueNowCents        service portion charged online: full | deposit | 0 (in_person)
 *   customerFeeCents         tiered booking fee on the FULL price ($5/$7/$10), always charged online
 *   platformCommissionCents  5% of what is paid ONLINE (deposit / full / balance), withheld from it
 *   in-person commission     5% of what is paid at the visit — owed by the business once the booking
 *                            completes (business_commission_charges, see businessCommission.service.js)
 *   reserveAmountCents       business net held for payout = amountDueNow − commission (+ tax when
 *                            the business is the tax-liable party), released by cron/reserveRelease.js
 *                            14/21 days after the booking is completed / marked no-show.
 */
import httpStatus from 'http-status';
import Stripe from 'stripe';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businesses,
  businessStaff,
  businessStaffDateOverrides,
  businessServices,
  businessBookings,
  businessTeamMembers,
} from '../db/schema/index.js';
import { BUSINESS_PERMISSIONS, permissionsForRole } from '../config/business-permissions.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { isBusinessPublic } from './business.service.js';
import { PayoutLedgerService } from './payoutLedger.service.js';
import {
  BusinessCommissionService,
  AUTO_COMPLETE_AFTER_HOURS,
  inPersonCommissionCents,
} from './businessCommission.service.js';
import { UserSpendService } from './userSpend.service.js';
import { createNotification } from './notification.service.js';
import { sendMail } from './mail.service.js';
import { PlusTaxLiabilityService } from './tax/plusTaxLiability.service.js';
import {
  SERVICE_TAX_CODE,
  buildServiceAutomaticTax,
  applyTaxLiabilityToReserve,
} from '../lib/tax/serviceCheckoutTax.js';
import { emailWrapper, ctaRow, ctaButton, appUrl, infoBox } from '../templates/emailLayout.js';
import { getRedirectUrls, isNativePlatform } from '../utils/redirect-urls.js';
import { normalizeStateToAbbr } from '../lib/tax/usStates.js';
import {
  calculateBusinessBookingFeeCents,
  calculateBusinessCommissionCents,
} from '../utils/orderProcessingFee.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

export const SLOT_STEP_MINS = 30;
export const MIN_LEAD_MINS = 60;
const CHECKOUT_TTL_MINS = 30;
// awaiting_payment rows older than this no longer hold their slot
const STALE_HOLD_MINS = CHECKOUT_TTL_MINS + 5;
const ACCEPT_WINDOW_HOURS = 24;
const SOURCE_TYPE = 'business_booking';

const HOLDING_STATUSES = ['awaiting_payment', 'pending', 'confirmed'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toMins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMins = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const money = c => `$${(c / 100).toFixed(2)}`;
const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

/** Online amounts for a service under a business's defaults. */
export function priceBooking(service, business) {
  const paymentModel = service.paymentModel ?? business.defaultPaymentModel;
  const price = service.priceCents;
  let amountDueNowCents = 0;
  if (paymentModel === 'full') amountDueNowCents = price;
  else if (paymentModel === 'deposit') {
    amountDueNowCents = Math.min(price, service.depositCents ?? Math.round(price * 0.2));
  }
  const customerFeeCents = calculateBusinessBookingFeeCents(price);
  // 5% of what is collected online now (withheld from it): full price, the deposit, or nothing.
  const platformCommissionCents = calculateBusinessCommissionCents(amountDueNowCents);
  // 5% of what the customer pays at the visit — owed by the business once the booking completes.
  const inPersonCommissionCents = calculateBusinessCommissionCents(price - amountDueNowCents);
  return {
    paymentModel,
    servicePriceCents: price,
    amountDueNowCents,
    customerFeeCents,
    platformCommissionCents,
    inPersonCommissionCents,
    chargedNowCents: amountDueNowCents + customerFeeCents,
    balanceDueAtVisitCents: price - amountDueNowCents,
  };
}

/**
 * Bookable windows ("HH:mm" pairs, business-local) for one staff member on one date.
 * Business hours are the outer bound; staff schedule / per-date override narrow them.
 */
export function staffWindowsForDate({ business, staff, overrides, date }) {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const biz = business.hours?.[dow] ?? business.hours?.[String(dow)] ?? null;
  if (!biz) return [];

  let windows;
  if (overrides.length) {
    if (overrides.some(o => o.isBlocked)) return [];
    windows = overrides.map(o => ({ open: o.startTime, close: o.endTime }));
  } else if (staff.schedule) {
    const w = staff.schedule[dow] ?? staff.schedule[String(dow)] ?? null;
    windows = w ? [w] : [];
  } else {
    windows = [biz];
  }

  return windows
    .map(w => ({
      open: Math.max(toMins(w.open), toMins(biz.open)),
      close: Math.min(toMins(w.close), toMins(biz.close)),
    }))
    .filter(w => w.open < w.close);
}

/**
 * Candidate start times for a service in the given windows, minus conflicts.
 * `busy` are existing bookings: [{ startAt: Date, endAt: Date, bufferMins }].
 */
export function computeSlots({ windows, date, tz, durationMins, bufferMins, busy, now = new Date() }) {
  const earliest = now.getTime() + MIN_LEAD_MINS * 60_000;
  const seen = new Set();
  const out = [];
  for (const w of windows) {
    for (let m = w.open; m + durationMins <= w.close; m += SLOT_STEP_MINS) {
      const time = fromMins(m);
      if (seen.has(time)) continue;
      const start = dayjs.tz(`${date}T${time}:00`, tz);
      const startMs = start.valueOf();
      const endMs = startMs + durationMins * 60_000;
      if (startMs < earliest) continue;
      const clash = busy.some(b => {
        const buf = Math.max(bufferMins, b.bufferMins ?? 0) * 60_000;
        return startMs < b.endAt.getTime() + buf && endMs + buf > b.startAt.getTime();
      });
      if (clash) continue;
      seen.add(time);
      out.push({ time, startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString() });
    }
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * Refund split for a customer cancellation under the business's policy.
 * Returns how much of the service payment and the booking fee go back.
 */
export function customerCancellationRefund(booking, business, now = new Date()) {
  if (booking.status === 'pending') {
    return { serviceRefundCents: booking.amountPaidCents, refundFee: true, rule: 'not_yet_accepted' };
  }
  const hoursBefore = (booking.startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore >= business.freeCancellationHours) {
    return { serviceRefundCents: booking.amountPaidCents, refundFee: true, rule: 'free_window' };
  }
  return {
    serviceRefundCents: Math.round((booking.amountPaidCents * business.lateCancellationRefundPercent) / 100),
    refundFee: false,
    rule: 'late',
  };
}

// ─── Serializers ────────────────────────────────────────────────────────────

const serializeBooking = (b, { forBusiness = false } = {}) => ({
  id: b.id,
  businessId: b.businessId,
  serviceId: b.serviceId,
  staffId: b.staffId,
  serviceName: b.serviceName,
  staffName: b.staffName,
  durationMins: b.durationMins,
  startAt: b.startAt,
  endAt: b.endAt,
  timezone: b.timezone,
  status: b.status,
  paymentModel: b.paymentModel,
  servicePriceCents: b.servicePriceCents,
  amountDueNowCents: b.amountDueNowCents,
  customerFeeCents: b.customerFeeCents,
  taxAmountCents: b.taxAmountCents,
  amountPaidCents: b.amountPaidCents,
  refundedCents: b.refundedCents,
  balanceDueAtVisitCents: b.servicePriceCents - b.amountPaidCents,
  balancePaidOnlineCents: b.balancePaidCents,
  canPayBalanceOnline:
    b.status === 'confirmed' && !b.balancePaymentIntentId && b.servicePriceCents > b.amountPaidCents,
  customerName: b.customerName,
  notes: b.notes,
  answers: b.answers,
  acceptDeadline: b.acceptDeadline,
  cancelledBy: b.cancelledBy,
  cancellationReason: b.cancellationReason,
  createdAt: b.createdAt,
  ...(forBusiness
    ? {
        customerId: b.customerId,
        customerEmail: b.customerEmail,
        customerPhone: b.customerPhone,
        platformCommissionCents: b.platformCommissionCents,
        // 5% of what the customer pays at the visit — owed once the booking completes
        inPersonCommissionCents: ['cancelled', 'declined', 'expired', 'no_show'].includes(b.status)
          ? 0
          : inPersonCommissionCents(b),
        businessNetCents: b.amountPaidCents - b.refundedCents - b.platformCommissionCents,
        confirmedAt: b.confirmedAt,
        completedAt: b.completedAt,
        cancelledAt: b.cancelledAt,
      }
    : {}),
});

// ─── Internal data access ───────────────────────────────────────────────────

async function loadPublicBusiness(idOrSlug) {
  const business = await db.query.businesses.findFirst({
    where: and(
      UUID_RE.test(idOrSlug) ? eq(businesses.id, idOrSlug) : eq(businesses.slug, idOrSlug),
      isNull(businesses.deletedAt)
    ),
    with: { owner: { columns: { id: true, isBritesidePlus: true, email: true, firstName: true } } },
  });
  if (!business || !isBusinessPublic(business, business.owner)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  return business;
}

async function loadService(business, serviceId) {
  const service = await db.query.businessServices.findFirst({
    where: and(
      eq(businessServices.id, serviceId),
      eq(businessServices.businessId, business.id),
      isNull(businessServices.deletedAt)
    ),
    with: { staffLinks: true },
  });
  if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
  return service;
}

/** Active staff who can perform the service and are taking bookings. */
async function eligibleStaff(business, service) {
  const all = await db.query.businessStaff.findMany({
    where: and(
      eq(businessStaff.businessId, business.id),
      isNull(businessStaff.deletedAt),
      eq(businessStaff.acceptingBookings, true)
    ),
    orderBy: [asc(businessStaff.sortOrder), asc(businessStaff.createdAt)],
  });
  if (service.allStaff) return all;
  const allowed = new Set(service.staffLinks.map(l => l.staffId));
  return all.filter(s => allowed.has(s.id));
}

async function busyForStaff(staffIds, dayStart, dayEnd, tx = db, excludeId = null) {
  if (!staffIds.length) return [];
  const staleCutoff = new Date(Date.now() - STALE_HOLD_MINS * 60_000);
  // Widen by the largest plausible buffer so neighbours across midnight count
  const from = new Date(dayStart.getTime() - 4 * 3_600_000);
  const to = new Date(dayEnd.getTime() + 4 * 3_600_000);
  const conds = [
    inArray(businessBookings.staffId, staffIds),
    inArray(businessBookings.status, HOLDING_STATUSES),
    lt(businessBookings.startAt, to),
    gte(businessBookings.endAt, from),
    or(ne(businessBookings.status, 'awaiting_payment'), gte(businessBookings.createdAt, staleCutoff)),
  ];
  if (excludeId) conds.push(ne(businessBookings.id, excludeId));
  return tx
    .select({
      staffId: businessBookings.staffId,
      startAt: businessBookings.startAt,
      endAt: businessBookings.endAt,
      bufferMins: businessBookings.bufferMins,
    })
    .from(businessBookings)
    .where(and(...conds));
}

async function overridesFor(staffIds, date, tx = db) {
  if (!staffIds.length) return [];
  return tx
    .select()
    .from(businessStaffDateOverrides)
    .where(
      and(
        inArray(businessStaffDateOverrides.staffId, staffIds),
        eq(businessStaffDateOverrides.overrideDate, date)
      )
    );
}

async function slotsForStaffList({ business, service, staffList, date, tx = db, excludeBookingId }) {
  const tz = business.timezone;
  const dayStart = dayjs.tz(`${date}T00:00:00`, tz).toDate();
  const dayEnd = dayjs.tz(`${date}T23:59:59`, tz).toDate();
  const ids = staffList.map(s => s.id);
  const [busy, overrides] = await Promise.all([
    busyForStaff(ids, dayStart, dayEnd, tx, excludeBookingId),
    overridesFor(ids, date, tx),
  ]);
  const result = new Map();
  for (const staff of staffList) {
    const windows = staffWindowsForDate({
      business,
      staff,
      overrides: overrides.filter(o => o.staffId === staff.id),
      date,
    });
    result.set(
      staff.id,
      computeSlots({
        windows,
        date,
        tz,
        durationMins: service.durationMins,
        bufferMins: service.bufferMins,
        busy: busy.filter(b => b.staffId === staff.id),
      })
    );
  }
  return result;
}

async function getBookingForBusiness(business, bookingId, access) {
  const booking = await db.query.businessBookings.findFirst({
    where: and(eq(businessBookings.id, bookingId), eq(businessBookings.businessId, business.id)),
  });
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (access?.role === 'staff' && booking.staffId !== access.staffId) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  return booking;
}

/** Atomic status transition: only succeeds if the row is still in one of `from`. */
async function transition(bookingId, from, values) {
  const [row] = await db
    .update(businessBookings)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(businessBookings.id, bookingId), inArray(businessBookings.status, from)))
    .returning();
  if (!row) {
    throw new ApiError(httpStatus.CONFLICT, 'This booking was already updated. Refresh and try again.');
  }
  return row;
}

/**
 * Refund via Stripe and adjust the business's held payout.
 * serviceRefundCents: part of the service payment going back; refundFee: whether the booking fee goes back.
 * Tax is refunded in proportion to the service refund.
 */
async function refundBooking(booking, business, { serviceRefundCents, refundFee, reason }) {
  const serviceRefund = Math.max(0, Math.min(serviceRefundCents, booking.amountPaidCents - booking.refundedCents));
  const fraction = booking.amountPaidCents > 0 ? serviceRefund / booking.amountPaidCents : 0;
  const taxRefund = Math.round((booking.taxAmountCents ?? 0) * fraction);
  const feeRefund = refundFee ? booking.customerFeeCents : 0;
  const total = serviceRefund + taxRefund + feeRefund;

  // A booking can have two card payments (booking + balance paid later). Refund the
  // balance payment first (it carries no booking fee), the rest from the booking payment.
  const refundIds = [];
  if (total > 0) {
    if (!stripe || !booking.stripePaymentIntentId) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Refunds are unavailable right now');
    }
    const fromBalance = booking.balancePaymentIntentId
      ? Math.min(total - feeRefund, booking.balanceChargedCents)
      : 0;
    const parts = [
      { pi: booking.balancePaymentIntentId, amount: fromBalance, key: 'balance' },
      { pi: booking.stripePaymentIntentId, amount: total - fromBalance, key: 'booking' },
    ].filter(p => p.pi && p.amount > 0);
    for (const p of parts) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: p.pi,
          amount: p.amount,
          reason: 'requested_by_customer',
          metadata: { type: SOURCE_TYPE, bookingId: booking.id, reason, payment: p.key },
        },
        { idempotencyKey: `business-booking-refund-${booking.id}-${reason}-${p.key}` }
      );
      refundIds.push(refund.id);
    }
  }
  const refundId = refundIds[0] ?? null;

  // Business keeps the retained share of the service payment minus a matching share of commission.
  const retainedService = booking.amountPaidCents - booking.refundedCents - serviceRefund;
  const commissionAfter =
    booking.amountPaidCents > 0
      ? Math.round((booking.platformCommissionCents * retainedService) / booking.amountPaidCents)
      : 0;
  const netAfter = applyTaxLiabilityToReserve(
    retainedService - commissionAfter,
    (booking.taxAmountCents ?? 0) - taxRefund,
    booking.taxLiability
  );
  const reverse = Math.max(0, (booking.reserveAmountCents ?? 0) - netAfter);
  if (reverse > 0) {
    await PayoutLedgerService.reverseHold(business.ownerId, reverse, {
      sourceType: SOURCE_TYPE,
      sourceId: booking.id,
      reason,
    }).catch(err => logger.error(`[businessBooking] reverseHold failed ${booking.id}: ${err.message}`));
  }

  await db
    .update(businessBookings)
    .set({
      refundedCents: booking.refundedCents + serviceRefund,
      platformCommissionCents: commissionAfter,
      reserveAmountCents: netAfter,
      updatedAt: new Date(),
    })
    .where(eq(businessBookings.id, booking.id));

  return { refundId, refundIds, refundedCents: total, serviceRefundCents: serviceRefund, feeRefundCents: feeRefund, taxRefundCents: taxRefund };
}

/**
 * Claim the status change first (so two concurrent cancels can't both refund),
 * then refund. If the refund fails the status is put back and the error rethrown.
 */
async function closeWithRefund(booking, business, from, values, refundOpts) {
  await transition(booking.id, from, values);
  let refund;
  try {
    refund = await refundBooking(booking, business, refundOpts);
  } catch (err) {
    await db
      .update(businessBookings)
      .set({
        status: booking.status,
        cancelledAt: booking.cancelledAt,
        cancelledBy: booking.cancelledBy,
        cancellationReason: booking.cancellationReason,
        acceptDeadline: booking.acceptDeadline,
        updatedAt: new Date(),
      })
      .where(eq(businessBookings.id, booking.id));
    throw err;
  }
  const row = await db.query.businessBookings.findFirst({ where: eq(businessBookings.id, booking.id) });
  return { row, refund };
}

// ─── Notifications (never throw) ────────────────────────────────────────────

function fmtWhen(booking) {
  return dayjs(booking.startAt).tz(booking.timezone).format('ddd, MMM D, YYYY [at] h:mm A');
}

async function notifyOwner(business, title, message, booking, redirectTo = '/business/dashboard') {
  try {
    await createNotification({
      userId: business.ownerId,
      title,
      message,
      type: 'business_booking',
      redirectTo,
      relatedId: booking.id,
      metadata: { businessId: business.id, bookingId: booking.id },
    });
  } catch (err) {
    logger.error(`[businessBooking] owner notification failed: ${err.message}`);
  }
}

function emailCustomer(booking, business, subject, headline, extraRows = []) {
  const html = emailWrapper(`
    <h2 style="margin:0 0 12px">${escapeHtml(headline)}</h2>
    ${infoBox([
      ['Business', escapeHtml(business.name)],
      ['Service', escapeHtml(booking.serviceName)],
      ['With', escapeHtml(booking.staffName)],
      ['When', escapeHtml(fmtWhen(booking))],
      ...extraRows,
    ])}
    ${ctaRow(ctaButton('View business', appUrl(`/business/${business.slug}`)))}
  `);
  sendMail(booking.customerEmail, subject, html).catch(err =>
    logger.error(`[businessBooking] customer email failed ${booking.id}: ${err.message}`)
  );
}

// ─── In-app card checkout (NativeCheckoutModal) ─────────────────────────────

/**
 * Tax on a service amount for a raw PaymentIntent. Hosted Checkout does this with
 * automatic_tax; here it needs the buyer's billing ZIP — without one, $0 (same rule
 * as the 1:1 session native checkout).
 */
async function calculateNativeServiceTax({ amountCents, country, postalCode, state, liability }) {
  const none = { amountCents: 0, taxLabel: null };
  if (!stripe || !liability || amountCents <= 0 || !postalCode?.trim()) return none;
  try {
    const stateAbbr = normalizeStateToAbbr(state);
    const calculation = await stripe.tax.calculations.create(
      {
        currency: 'usd',
        line_items: [
          { amount: amountCents, reference: 'business_booking', tax_code: SERVICE_TAX_CODE, tax_behavior: 'exclusive' },
        ],
        customer_details: {
          address: {
            country: country || 'US',
            postal_code: postalCode.trim(),
            ...(stateAbbr ? { state: stateAbbr } : {}),
          },
          address_source: 'billing',
        },
      },
      liability.type === 'account' ? { stripeAccount: liability.account } : undefined
    );
    return { amountCents: calculation.tax_amount_exclusive ?? 0, taxLabel: 'Tax' };
  } catch (err) {
    logger.error(`[businessBooking] native tax calculation failed, charging no tax: ${err.message}`);
    return none;
  }
}

/** A booking the caller may pay for: signed-in bookings only by their customer; guest bookings by id. */
async function loadPayableBooking(bookingId, user) {
  const booking = await db.query.businessBookings.findFirst({
    where: eq(businessBookings.id, bookingId),
    with: { business: true },
  });
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (booking.customerId && booking.customerId !== user?.id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  return booking;
}

async function verifiedIntent(paymentIntentId, expect) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  for (const [k, v] of Object.entries(expect)) {
    if (intent.metadata?.[k] !== v) throw new ApiError(httpStatus.CONFLICT, 'Payment does not match this booking');
  }
  if (intent.status !== 'succeeded') {
    throw new ApiError(httpStatus.CONFLICT, `Payment is not completed yet (status: ${intent.status})`);
  }
  return intent;
}

/** handle*Webhook only reads id / payment_intent / amount_total / metadata. */
const intentAsSession = intent => ({
  id: null,
  payment_intent: intent.id,
  amount_total: intent.amount_received || intent.amount,
  metadata: intent.metadata,
});

// ─── Service ────────────────────────────────────────────────────────────────

export class BusinessBookingService {
  /**
   * Public slots for a service on a date (business-local yyyy-MM-dd).
   * With staffId → that staff member's slots. Without → union, each slot listing who is free.
   */
  static async getSlots(idOrSlug, { serviceId, staffId, date }) {
    const business = await loadPublicBusiness(idOrSlug);
    const service = await loadService(business, serviceId);
    const base = { date, timezone: business.timezone, durationMins: service.durationMins };
    if (!business.acceptingBookings) return { ...base, slots: [] };

    let staffList = await eligibleStaff(business, service);
    if (staffId) {
      staffList = staffList.filter(s => s.id === staffId);
      if (!staffList.length) return { ...base, slots: [] };
    }
    const byStaff = await slotsForStaffList({ business, service, staffList, date });

    if (staffId) return { ...base, staffId, slots: byStaff.get(staffId) };

    const merged = new Map();
    for (const [sid, slots] of byStaff) {
      for (const s of slots) {
        if (!merged.has(s.time)) merged.set(s.time, { ...s, staffIds: [] });
        merged.get(s.time).staffIds.push(sid);
      }
    }
    return { ...base, slots: [...merged.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)) };
  }

  /** Price breakdown for the booking flow summary. */
  static async quote(idOrSlug, serviceId) {
    const business = await loadPublicBusiness(idOrSlug);
    const service = await loadService(business, serviceId);
    return priceBooking(service, business);
  }

  /**
   * Hold the slot (awaiting_payment) and open a Stripe Checkout session for
   * the online portion + booking fee. Guests allowed (user may be null).
   */
  static async createCheckout(idOrSlug, user, body) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');

    const business = await loadPublicBusiness(idOrSlug);
    if (!business.acceptingBookings || (await BusinessCommissionService.isBookingPaused(business.id))) {
      throw new ApiError(httpStatus.CONFLICT, 'This business is not taking bookings right now');
    }
    const service = await loadService(business, body.serviceId);

    // Required booking questions
    const questions = business.bookingQuestions ?? [];
    const answersById = new Map((body.answers ?? []).map(a => [a.questionId, a.answer?.trim() ?? '']));
    for (const q of questions) {
      if (q.required && !answersById.get(q.id)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Please answer: ${q.question}`);
      }
    }
    const answers = questions
      .filter(q => answersById.get(q.id))
      .map(q => ({ question: q.question, answer: answersById.get(q.id) }));

    const pricing = priceBooking(service, business);
    const staffPool = await eligibleStaff(business, service);
    const candidates = body.staffId ? staffPool.filter(s => s.id === body.staffId) : staffPool;
    if (!candidates.length) {
      throw new ApiError(httpStatus.CONFLICT, 'That staff member is not available for this service');
    }

    const customerEmail = (body.customer?.email || user?.email || '').trim().toLowerCase();
    const customerName = (body.customer?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ')).trim();
    if (!customerEmail || !customerName) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Name and email are required');
    }

    const { liability } = await PlusTaxLiabilityService.resolveLiability(business.ownerId);
    const taxLiability = liability ? liability.type : 'none';

    // Lock the candidate staff, re-check the slot, insert the hold — all in one transaction
    const booking = await db.transaction(async tx => {
      for (const s of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_staff:' + s.id}))`);
      }
      const byStaff = await slotsForStaffList({
        business,
        service,
        staffList: candidates,
        date: body.date,
        tx,
      });
      const staff = candidates.find(s => byStaff.get(s.id)?.some(sl => sl.time === body.time));
      if (!staff) {
        throw new ApiError(httpStatus.CONFLICT, 'That time was just taken. Please pick another slot.');
      }
      const slot = byStaff.get(staff.id).find(sl => sl.time === body.time);

      const [row] = await tx
        .insert(businessBookings)
        .values({
          businessId: business.id,
          serviceId: service.id,
          staffId: staff.id,
          customerId: user?.id ?? null,
          customerName,
          customerEmail,
          customerPhone: body.customer?.phone?.trim() || null,
          serviceName: service.name,
          staffName: staff.name,
          durationMins: service.durationMins,
          bufferMins: service.bufferMins,
          startAt: new Date(slot.startAt),
          endAt: new Date(slot.endAt),
          timezone: business.timezone,
          status: 'awaiting_payment',
          paymentModel: pricing.paymentModel,
          servicePriceCents: pricing.servicePriceCents,
          amountDueNowCents: pricing.amountDueNowCents,
          customerFeeCents: pricing.customerFeeCents,
          platformCommissionCents: pricing.platformCommissionCents,
          notes: body.notes?.trim() || null,
          answers,
          taxLiability,
          reserveAmountCents: 0,
        })
        .returning();
      return row;
    });

    // In-app card form (NativeCheckoutModal): the slot is held now; the card is
    // charged via createNativePaymentIntent → finalizeNativePayment.
    if (body.mode === 'native') {
      return {
        bookingId: booking.id,
        paymentId: booking.id,
        startAt: booking.startAt,
        staffId: booking.staffId,
        pricing,
        expiresAt: new Date(booking.createdAt.getTime() + CHECKOUT_TTL_MINS * 60_000),
      };
    }

    // Stripe Checkout
    const nativeRedirect = isNativePlatform(body.platform);
    const redirectUrls = getRedirectUrls(
      body.platform,
      FRONTEND_URL,
      `/business/${business.slug}/book?checkout_session_id={CHECKOUT_SESSION_ID}&status=success`,
      `/business/${business.slug}/book?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled`
    );
    const webReturnUrl = `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=business_booking`;
    const automaticTax = pricing.amountDueNowCents > 0 ? buildServiceAutomaticTax(liability) : undefined;
    const when = fmtWhen(booking);
    const metadata = {
      type: SOURCE_TYPE,
      bookingId: booking.id,
      businessId: business.id,
      businessOwnerId: business.ownerId,
      customerId: user?.id ?? '',
      taxLiability,
    };

    const lineItems = [];
    if (pricing.amountDueNowCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: pricing.amountDueNowCents,
          tax_behavior: 'exclusive',
          product_data: {
            name:
              pricing.paymentModel === 'deposit'
                ? `Deposit: ${service.name} at ${business.name}`
                : `${service.name} at ${business.name}`,
            description: `${when} with ${booking.staffName}`,
            tax_code: SERVICE_TAX_CODE,
          },
        },
        quantity: 1,
      });
    }
    lineItems.push({
      price_data: {
        currency: 'usd',
        unit_amount: pricing.customerFeeCents,
        ...(automaticTax ? { tax_behavior: 'exclusive' } : {}),
        product_data: {
          name: 'Booking fee',
          ...(pricing.amountDueNowCents === 0 ? { description: `${service.name}, ${when}. Pay for the service at your visit.` } : {}),
        },
      },
      quantity: 1,
    });

    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MINS * 60,
        ...(nativeRedirect
          ? { success_url: redirectUrls.successUrl, cancel_url: redirectUrls.cancelUrl }
          : { ui_mode: 'embedded', return_url: webReturnUrl }),
        ...(automaticTax ? { automatic_tax: automaticTax } : {}),
        line_items: lineItems,
        customer_email: customerEmail,
        metadata,
        payment_intent_data: { metadata },
      });
    } catch (err) {
      await db
        .update(businessBookings)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(businessBookings.id, booking.id));
      logger.error(`[businessBooking] checkout create failed ${booking.id}: ${err.message}`);
      throw new ApiError(httpStatus.BAD_GATEWAY, 'Could not start payment. Please try again.');
    }

    await db
      .update(businessBookings)
      .set({ stripeSessionId: stripeSession.id, updatedAt: new Date() })
      .where(eq(businessBookings.id, booking.id));

    return {
      bookingId: booking.id,
      startAt: booking.startAt,
      staffId: booking.staffId,
      pricing,
      expiresAt: new Date(stripeSession.expires_at * 1000),
      ...(nativeRedirect ? { checkoutUrl: stripeSession.url } : { clientSecret: stripeSession.client_secret }),
    };
  }

  // ── In-app card checkout: booking ───────────────────────────────────────────

  static async _nativeBookingCharge(bookingId, user, address = {}) {
    const booking = await loadPayableBooking(bookingId, user);
    if (booking.status !== 'awaiting_payment') {
      throw new ApiError(
        httpStatus.CONFLICT,
        booking.status === 'expired'
          ? 'This time slot is no longer held. Please pick a time again.'
          : 'This booking is already paid'
      );
    }
    const { liability } = await PlusTaxLiabilityService.resolveLiability(booking.business.ownerId);
    const tax = await calculateNativeServiceTax({ amountCents: booking.amountDueNowCents, liability, ...address });
    return { booking, liability, tax, chargeCents: booking.amountDueNowCents + booking.customerFeeCents };
  }

  static async previewNativeTax(bookingId, user, address) {
    const { chargeCents, tax } = await this._nativeBookingCharge(bookingId, user, address);
    return { taxAmountCents: tax.amountCents, taxLabel: tax.taxLabel, totalCents: chargeCents + tax.amountCents };
  }

  static async createNativePaymentIntent(bookingId, user, address) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const { booking, liability, tax, chargeCents } = await this._nativeBookingCharge(bookingId, user, address);
    const taxLiability = liability ? liability.type : 'none';
    const intent = await stripe.paymentIntents.create({
      payment_method_types: ['card'],
      amount: chargeCents + tax.amountCents,
      currency: 'usd',
      receipt_email: booking.customerEmail,
      description: `${booking.serviceName} at ${booking.business.name}`,
      metadata: {
        type: SOURCE_TYPE,
        native: '1',
        bookingId: booking.id,
        businessId: booking.businessId,
        businessOwnerId: booking.business.ownerId,
        customerId: booking.customerId ?? '',
        taxLiability,
        taxAmountCents: String(tax.amountCents),
      },
    });
    await db
      .update(businessBookings)
      .set({ taxLiability, updatedAt: new Date() })
      .where(eq(businessBookings.id, booking.id));
    return {
      clientSecret: intent.client_secret,
      paymentId: booking.id,
      taxAmountCents: tax.amountCents,
      taxLabel: tax.taxLabel,
    };
  }

  /** After confirmCardPayment succeeds in the browser. Idempotent with the payment_intent.succeeded webhook. */
  static async finalizeNativePayment(bookingId, user, paymentIntentId) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    await loadPayableBooking(bookingId, user);
    const intent = await verifiedIntent(paymentIntentId, { type: SOURCE_TYPE, bookingId });
    await this.handlePaymentWebhook(intentAsSession(intent));
    const booking = await db.query.businessBookings.findFirst({
      where: eq(businessBookings.id, bookingId),
      with: { business: { columns: { id: true, slug: true, name: true } } },
    });
    return { booking: serializeBooking(booking), business: booking.business };
  }

  // ── In-app card checkout: remaining balance ─────────────────────────────────

  static async _nativeBalanceCharge(bookingId, user, address = {}) {
    if (!user) throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to pay your balance');
    const booking = await loadPayableBooking(bookingId, user);
    if (booking.status !== 'confirmed') {
      throw new ApiError(httpStatus.CONFLICT, 'The balance can be paid once the booking is confirmed');
    }
    if (booking.balancePaymentIntentId) {
      throw new ApiError(httpStatus.CONFLICT, 'The balance for this booking is already paid');
    }
    const balanceCents = booking.servicePriceCents - booking.amountPaidCents;
    if (balanceCents <= 0) throw new ApiError(httpStatus.CONFLICT, 'Nothing left to pay on this booking');
    const { liability } = await PlusTaxLiabilityService.resolveLiability(booking.business.ownerId);
    const tax = await calculateNativeServiceTax({ amountCents: balanceCents, liability, ...address });
    return { booking, balanceCents, tax };
  }

  static async previewBalanceNativeTax(bookingId, user, address) {
    const { balanceCents, tax } = await this._nativeBalanceCharge(bookingId, user, address);
    return { taxAmountCents: tax.amountCents, taxLabel: tax.taxLabel, totalCents: balanceCents + tax.amountCents };
  }

  static async createBalanceNativeIntent(bookingId, user, address) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const { booking, balanceCents, tax } = await this._nativeBalanceCharge(bookingId, user, address);
    const intent = await stripe.paymentIntents.create({
      payment_method_types: ['card'],
      amount: balanceCents + tax.amountCents,
      currency: 'usd',
      receipt_email: booking.customerEmail,
      description: `Remaining balance: ${booking.serviceName} at ${booking.business.name}`,
      metadata: {
        type: 'business_booking_balance',
        native: '1',
        bookingId: booking.id,
        businessId: booking.businessId,
        businessOwnerId: booking.business.ownerId,
        balanceCents: String(balanceCents),
        taxAmountCents: String(tax.amountCents),
      },
    });
    return {
      clientSecret: intent.client_secret,
      paymentId: booking.id,
      taxAmountCents: tax.amountCents,
      taxLabel: tax.taxLabel,
    };
  }

  static async finalizeBalanceNativePayment(bookingId, user, paymentIntentId) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    await loadPayableBooking(bookingId, user);
    const intent = await verifiedIntent(paymentIntentId, { type: 'business_booking_balance', bookingId });
    await this.handleBalancePaymentWebhook(intentAsSession(intent));
    const booking = await db.query.businessBookings.findFirst({ where: eq(businessBookings.id, bookingId) });
    return { booking: serializeBooking(booking) };
  }

  /** checkout.session.completed / async_payment_succeeded with metadata.type = business_booking */
  static async handlePaymentWebhook(stripeSession) {
    const { bookingId } = stripeSession.metadata ?? {};
    if (!bookingId) return;

    const existing = await db.query.businessBookings.findFirst({
      where: eq(businessBookings.id, bookingId),
      with: { staff: true, business: true },
    });
    if (!existing) {
      logger.error(`[businessBooking] webhook: booking not found ${bookingId}`);
      return;
    }

    const manual = existing.staff?.bookingConfirmation === 'manual';
    const now = new Date();
    const acceptDeadline = manual
      ? new Date(Math.min(now.getTime() + ACCEPT_WINDOW_HOURS * 3_600_000, existing.startAt.getTime()))
      : null;

    // Hosted Checkout reports tax in total_details; the in-app card path carries it in metadata
    const taxAmountCents =
      stripeSession.total_details?.amount_tax ?? (Number(stripeSession.metadata?.taxAmountCents) || 0);
    const netCents = applyTaxLiabilityToReserve(
      existing.amountDueNowCents - existing.platformCommissionCents,
      taxAmountCents,
      existing.taxLiability
    );

    // Atomic claim — Stripe can redeliver / fire both completed and async_succeeded, and the
    // in-app card path also finalizes from the browser. Status and money land in ONE write so
    // nobody ever sees a confirmed booking with nothing paid (e.g. a balance computed as the
    // full price while the webhook is still mid-way).
    const [booking] = await db
      .update(businessBookings)
      .set({
        status: manual ? 'pending' : 'confirmed',
        confirmedAt: manual ? null : now,
        acceptDeadline,
        stripeSessionId: stripeSession.id ?? existing.stripeSessionId,
        stripePaymentIntentId: stripeSession.payment_intent ?? null,
        amountPaidCents: existing.amountDueNowCents,
        taxAmountCents,
        reserveAmountCents: netCents,
        updatedAt: now,
      })
      .where(and(eq(businessBookings.id, bookingId), eq(businessBookings.status, 'awaiting_payment')))
      .returning();

    if (!booking) {
      // Paid after the hold was released (expired) — give the money back.
      if (existing.status === 'expired' && stripeSession.payment_intent && stripe) {
        await stripe.refunds
          .create(
            { payment_intent: stripeSession.payment_intent, metadata: { type: SOURCE_TYPE, bookingId, reason: 'hold_expired' } },
            { idempotencyKey: `business-booking-late-pay-${bookingId}` }
          )
          .catch(err => logger.error(`[businessBooking] late-payment refund failed ${bookingId}: ${err.message}`));
      }
      return;
    }

    // Stripe's processing fee is bookkeeping only — recorded after the claim
    if (stripe && stripeSession.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(stripeSession.payment_intent, {
          expand: ['latest_charge.balance_transaction'],
        });
        const stripeFeeCents = pi.latest_charge?.balance_transaction?.fee ?? null;
        if (stripeFeeCents != null) {
          await db.update(businessBookings).set({ stripeFeeCents }).where(eq(businessBookings.id, bookingId));
        }
      } catch (err) {
        logger.warn(`[businessBooking] could not read Stripe fee: ${err.message}`);
      }
    }

    if (netCents > 0) {
      await PayoutLedgerService.creditHold(existing.business.ownerId, netCents, {
        sourceType: SOURCE_TYPE,
        sourceId: bookingId,
      }).catch(err => logger.error(`[businessBooking] creditHold failed ${bookingId}: ${err.message}`));
    }

    if (booking.customerId) {
      UserSpendService.recordSpend({
        userId: booking.customerId,
        spendType: 'business_booking',
        amountCents: stripeSession.amount_total ?? booking.amountDueNowCents + booking.customerFeeCents,
        referenceId: booking.id,
        referenceType: SOURCE_TYPE,
        stripePaymentIntentId: stripeSession.payment_intent ?? null,
        stripeSessionId: stripeSession.id,
      }).catch(err => logger.error(`[businessBooking] recordSpend failed: ${err.message}`));
    }

    const business = existing.business;
    const full = { ...booking, startAt: new Date(booking.startAt) };
    if (manual) {
      await notifyOwner(business, 'New booking request', `${booking.customerName} requested ${booking.serviceName} on ${fmtWhen(full)}. Accept or decline it.`, booking, '/bookings?tab=appointment-requests');
      emailCustomer(full, business, `Booking request sent to ${business.name}`, 'Your request was sent', [
        ['Status', 'Waiting for the business to accept. If they decline, you get a full refund.'],
      ]);
    } else {
      await notifyOwner(business, 'New booking', `${booking.customerName} booked ${booking.serviceName} on ${fmtWhen(full)}.`, booking);
      emailCustomer(full, business, `Booking confirmed: ${business.name}`, 'You’re booked', [
        ['Paid now', money((stripeSession.amount_total ?? 0))],
        ...(booking.servicePriceCents > booking.amountDueNowCents
          ? [['Due at your visit', money(booking.servicePriceCents - booking.amountDueNowCents)]]
          : []),
      ]);
    }
  }

  /** checkout.session.expired — release the slot. */
  static async handlePaymentExpired(stripeSession) {
    const bookingId = stripeSession.metadata?.bookingId;
    if (!bookingId) return;
    await db
      .update(businessBookings)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(businessBookings.id, bookingId), eq(businessBookings.status, 'awaiting_payment')));
  }

  // ── Remaining balance paid online later ─────────────────────────────────────

  /**
   * Customer pays what is still owed (deposit / pay-in-person bookings) online.
   * No booking fee — it was charged once at booking. 5% commission applies to this payment.
   */
  static async createBalanceCheckout(user, bookingId, platform, mode) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const booking = await db.query.businessBookings.findFirst({
      where: and(eq(businessBookings.id, bookingId), eq(businessBookings.customerId, user.id)),
      with: { business: true },
    });
    if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    if (booking.status !== 'confirmed') {
      throw new ApiError(httpStatus.CONFLICT, 'The balance can be paid once the booking is confirmed');
    }
    if (booking.balancePaymentIntentId) {
      throw new ApiError(httpStatus.CONFLICT, 'The balance for this booking is already paid');
    }
    const balanceCents = booking.servicePriceCents - booking.amountPaidCents;
    if (balanceCents <= 0) throw new ApiError(httpStatus.CONFLICT, 'Nothing left to pay on this booking');

    // In-app card form: charged via createBalanceNativeIntent → finalizeBalanceNativePayment
    if (mode === 'native') {
      return {
        bookingId: booking.id,
        paymentId: booking.id,
        balanceCents,
        commissionCents: calculateBusinessCommissionCents(balanceCents),
      };
    }

    // Only one open balance checkout at a time, so it can't be paid twice
    if (booking.balanceStripeSessionId) {
      try {
        const prev = await stripe.checkout.sessions.retrieve(booking.balanceStripeSessionId);
        if (prev.status === 'complete') {
          throw new ApiError(httpStatus.CONFLICT, 'The balance payment is already being processed');
        }
        if (prev.status === 'open') await stripe.checkout.sessions.expire(prev.id);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        logger.warn(`[businessBooking] could not expire previous balance checkout: ${err.message}`);
      }
    }

    const business = booking.business;
    const { liability } = await PlusTaxLiabilityService.resolveLiability(business.ownerId);
    const automaticTax = buildServiceAutomaticTax(liability);
    const nativeRedirect = isNativePlatform(platform);
    const redirectUrls = getRedirectUrls(
      platform,
      FRONTEND_URL,
      `/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=success`,
      `/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled`
    );
    const metadata = {
      type: 'business_booking_balance',
      bookingId: booking.id,
      businessId: business.id,
      businessOwnerId: business.ownerId,
      balanceCents: String(balanceCents),
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MINS * 60,
      ...(nativeRedirect
        ? { success_url: redirectUrls.successUrl, cancel_url: redirectUrls.cancelUrl }
        : {
            ui_mode: 'embedded',
            return_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=business_booking`,
          }),
      ...(automaticTax ? { automatic_tax: automaticTax } : {}),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: balanceCents,
            tax_behavior: 'exclusive',
            product_data: {
              name: `Remaining balance: ${booking.serviceName} at ${business.name}`,
              description: `${fmtWhen(booking)} with ${booking.staffName}`,
              tax_code: SERVICE_TAX_CODE,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: booking.customerEmail,
      metadata,
      payment_intent_data: { metadata },
    });

    await db
      .update(businessBookings)
      .set({ balanceStripeSessionId: session.id, updatedAt: new Date() })
      .where(eq(businessBookings.id, booking.id));

    return {
      bookingId: booking.id,
      balanceCents,
      commissionCents: calculateBusinessCommissionCents(balanceCents),
      expiresAt: new Date(session.expires_at * 1000),
      ...(nativeRedirect ? { checkoutUrl: session.url } : { clientSecret: session.client_secret }),
    };
  }

  /** checkout.session.completed with metadata.type = business_booking_balance */
  static async handleBalancePaymentWebhook(stripeSession) {
    const bookingId = stripeSession.metadata?.bookingId;
    const balanceCents = Number(stripeSession.metadata?.balanceCents) || 0;
    if (!bookingId || balanceCents <= 0) return;

    const taxAmountCents =
      stripeSession.total_details?.amount_tax ?? (Number(stripeSession.metadata?.taxAmountCents) || 0);
    const chargedCents = stripeSession.amount_total ?? balanceCents + taxAmountCents;
    const commissionCents = calculateBusinessCommissionCents(balanceCents);

    const existing = await db.query.businessBookings.findFirst({
      where: eq(businessBookings.id, bookingId),
      with: { business: true },
    });
    if (!existing) return;
    const netCents = applyTaxLiabilityToReserve(balanceCents - commissionCents, taxAmountCents, existing.taxLiability);

    // Atomic claim: only once per booking, and only while the booking is still live
    const [booking] = await db
      .update(businessBookings)
      .set({
        balancePaymentIntentId: stripeSession.payment_intent ?? null,
        balanceStripeSessionId: stripeSession.id ?? null,
        balancePaidCents: balanceCents,
        balanceChargedCents: chargedCents,
        amountPaidCents: sql`${businessBookings.amountPaidCents} + ${balanceCents}`,
        taxAmountCents: sql`${businessBookings.taxAmountCents} + ${taxAmountCents}`,
        platformCommissionCents: sql`${businessBookings.platformCommissionCents} + ${commissionCents}`,
        reserveAmountCents: sql`coalesce(${businessBookings.reserveAmountCents}, 0) + ${netCents}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessBookings.id, bookingId),
          isNull(businessBookings.balancePaymentIntentId),
          inArray(businessBookings.status, ['confirmed', 'completed', 'no_show'])
        )
      )
      .returning();

    if (!booking) {
      // Already recorded (redelivery) or the booking was cancelled meanwhile → refund this payment
      const alreadyRecorded = existing.balancePaymentIntentId === stripeSession.payment_intent;
      if (!alreadyRecorded && stripeSession.payment_intent && stripe) {
        await stripe.refunds
          .create(
            { payment_intent: stripeSession.payment_intent, metadata: { type: SOURCE_TYPE, bookingId, reason: 'balance_after_close' } },
            { idempotencyKey: `business-booking-balance-refund-${bookingId}-${stripeSession.payment_intent}` }
          )
          .catch(err => logger.error(`[businessBooking] balance refund failed ${bookingId}: ${err.message}`));
      }
      return;
    }

    if (netCents > 0) {
      await PayoutLedgerService.creditHold(existing.business.ownerId, netCents, {
        sourceType: SOURCE_TYPE,
        sourceId: bookingId,
        metadata: { payment: 'balance' },
      }).catch(err => logger.error(`[businessBooking] balance creditHold failed ${bookingId}: ${err.message}`));
    }
    if (booking.customerId) {
      UserSpendService.recordSpend({
        userId: booking.customerId,
        spendType: 'business_booking',
        amountCents: chargedCents,
        referenceId: booking.id,
        referenceType: 'business_booking_balance',
        stripePaymentIntentId: stripeSession.payment_intent ?? null,
        stripeSessionId: stripeSession.id,
      }).catch(err => logger.error(`[businessBooking] recordSpend failed: ${err.message}`));
    }
    await notifyOwner(
      existing.business,
      'Balance paid',
      `${booking.customerName} paid the remaining ${money(balanceCents)} for ${booking.serviceName}.`,
      booking
    );
  }

  /** checkout.session.expired for a balance checkout — just forget the session. */
  static async handleBalancePaymentExpired(stripeSession) {
    const bookingId = stripeSession.metadata?.bookingId;
    if (!bookingId) return;
    await db
      .update(businessBookings)
      .set({ balanceStripeSessionId: null, updatedAt: new Date() })
      .where(
        and(
          eq(businessBookings.id, bookingId),
          eq(businessBookings.balanceStripeSessionId, stripeSession.id),
          isNull(businessBookings.balancePaymentIntentId)
        )
      );
  }

  /** For the payment return page: booking status by Checkout session id (booking or balance payment). */
  static async getByCheckoutSession(checkoutSessionId) {
    const booking = await db.query.businessBookings.findFirst({
      where: or(
        eq(businessBookings.stripeSessionId, checkoutSessionId),
        eq(businessBookings.balanceStripeSessionId, checkoutSessionId)
      ),
      with: { business: { columns: { id: true, slug: true, name: true } } },
    });
    if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    return { booking: serializeBooking(booking), business: booking.business };
  }

  // ── Business dashboard ─────────────────────────────────────────────────────

  static async listForBusiness(business, access, { from, to, status, staffId, page = 1, limit = 50 }) {
    const conds = [eq(businessBookings.businessId, business.id), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    if (from) conds.push(gte(businessBookings.startAt, new Date(from)));
    if (to) conds.push(lte(businessBookings.startAt, new Date(to)));
    if (status?.length) conds.push(inArray(businessBookings.status, status));
    const effectiveStaff = access?.role === 'staff' ? access.staffId : staffId;
    if (effectiveStaff) conds.push(eq(businessBookings.staffId, effectiveStaff));
    const where = and(...conds);
    const offset = (page - 1) * limit;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(businessBookings).where(where).orderBy(asc(businessBookings.startAt)).limit(limit).offset(offset),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessBookings).where(where),
    ]);
    return {
      bookings: rows.map(b => serializeBooking(b, { forBusiness: true })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: offset + rows.length < total },
    };
  }

  /**
   * Bookings across every business the user owns or is an active team member of
   * (My Calendar → Appointment Requests, and business appointments on the calendar).
   * Staff-role members only see their own bookings. Each row carries its business
   * and whether the user may act on it.
   */
  static async listManaged(user, { status, from, to, limit = 200 }) {
    const [owned, memberships] = await Promise.all([
      db.query.businesses.findMany({
        where: and(eq(businesses.ownerId, user.id), isNull(businesses.deletedAt)),
        columns: { id: true },
      }),
      db.query.businessTeamMembers.findMany({
        where: and(eq(businessTeamMembers.userId, user.id), eq(businessTeamMembers.status, 'active')),
        with: { business: { columns: { id: true, deletedAt: true } } },
      }),
    ]);

    const fullIds = owned.map(b => b.id);
    const ownStaff = []; // [{ businessId, staffId }] for staff-role members
    const manageIds = new Set(fullIds);
    for (const m of memberships) {
      if (!m.business || m.business.deletedAt) continue;
      const perms = permissionsForRole(m.role);
      if (!perms.includes(BUSINESS_PERMISSIONS.BOOKINGS_VIEW)) continue;
      if (perms.includes(BUSINESS_PERMISSIONS.BOOKINGS_MANAGE)) manageIds.add(m.businessId);
      if (m.role === 'staff') {
        if (m.staffId) ownStaff.push({ businessId: m.businessId, staffId: m.staffId });
      } else {
        fullIds.push(m.businessId);
      }
    }

    const scope = [
      ...(fullIds.length ? [inArray(businessBookings.businessId, fullIds)] : []),
      ...ownStaff.map(s => and(eq(businessBookings.businessId, s.businessId), eq(businessBookings.staffId, s.staffId))),
    ];
    if (!scope.length) return { bookings: [], businesses: 0 };

    const conds = [or(...scope), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    if (status?.length) conds.push(inArray(businessBookings.status, status));
    if (from) conds.push(gte(businessBookings.startAt, new Date(from)));
    if (to) conds.push(lte(businessBookings.startAt, new Date(to)));

    const rows = await db.query.businessBookings.findMany({
      where: and(...conds),
      with: { business: { columns: { id: true, slug: true, name: true, logoUrl: true, timezone: true } } },
      orderBy: [asc(businessBookings.startAt)],
      limit,
    });
    return {
      bookings: rows.map(b => ({
        ...serializeBooking(b, { forBusiness: true }),
        business: b.business,
        canManage: manageIds.has(b.businessId),
      })),
      businesses: new Set([...fullIds, ...ownStaff.map(s => s.businessId)]).size,
    };
  }

  static async confirm(business, bookingId, access) {
    await getBookingForBusiness(business, bookingId, access);
    const row = await transition(bookingId, ['pending'], { status: 'confirmed', confirmedAt: new Date(), acceptDeadline: null });
    emailCustomer(row, business, `Booking confirmed: ${business.name}`, `${business.name} accepted your booking`);
    return serializeBooking(row, { forBusiness: true });
  }

  static async decline(business, bookingId, access, reason) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.status !== 'pending') throw new ApiError(httpStatus.CONFLICT, 'Only booking requests can be declined');
    const { row, refund } = await closeWithRefund(
      booking,
      business,
      ['pending'],
      { status: 'declined', cancelledAt: new Date(), cancelledBy: 'business', cancellationReason: reason ?? null, acceptDeadline: null },
      { serviceRefundCents: booking.amountPaidCents, refundFee: true, reason: 'business_declined' }
    );
    emailCustomer(row, business, `Booking request declined: ${business.name}`, `${business.name} couldn’t take this booking`, [
      ['Refund', `${money(refund.refundedCents)} back to your card`],
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }), refund };
  }

  /** Business cancels: customer always gets everything back, booking fee included. */
  static async cancelByBusiness(business, bookingId, access, reason) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new ApiError(httpStatus.CONFLICT, 'This booking can no longer be cancelled');
    }
    const { row, refund } = await closeWithRefund(
      booking,
      business,
      ['pending', 'confirmed'],
      { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'business', cancellationReason: reason ?? null },
      { serviceRefundCents: booking.amountPaidCents, refundFee: true, reason: 'business_cancelled' }
    );
    emailCustomer(row, business, `Booking cancelled: ${business.name}`, `${business.name} cancelled your booking`, [
      ['Refund', `${money(refund.refundedCents)} back to your card`],
      ...(reason ? [['Reason', escapeHtml(reason)]] : []),
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }), refund };
  }

  static async complete(business, bookingId, access) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.startAt > new Date()) throw new ApiError(httpStatus.CONFLICT, 'You can complete a booking once it has started');
    const row = await transition(bookingId, ['confirmed'], { status: 'completed', completedAt: new Date() });
    // 5% of anything the customer paid in person (the cron backfills if this fails)
    await BusinessCommissionService.recordForCompletedBooking(row, business).catch(err =>
      logger.error(`[businessBooking] commission record failed ${row.id}: ${err.message}`)
    );
    return serializeBooking(row, { forBusiness: true });
  }

  /** Customer didn't show: business keeps what was paid online. */
  static async markNoShow(business, bookingId, access) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.startAt > new Date()) throw new ApiError(httpStatus.CONFLICT, 'You can mark a no-show once the booking has started');
    // completedAt marks "closed" — it starts the payout hold clock
    const row = await transition(bookingId, ['confirmed'], { status: 'no_show', completedAt: new Date() });
    return serializeBooking(row, { forBusiness: true });
  }

  // ── Customer ───────────────────────────────────────────────────────────────

  static async listForCustomer(userId, { tab = 'upcoming' }) {
    const now = new Date();
    const conds = [eq(businessBookings.customerId, userId), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    conds.push(tab === 'past' ? lt(businessBookings.startAt, now) : gte(businessBookings.endAt, now));
    const rows = await db.query.businessBookings.findMany({
      where: and(...conds),
      with: { business: { columns: { id: true, slug: true, name: true, logoUrl: true, freeCancellationHours: true, lateCancellationRefundPercent: true } } },
      orderBy: [tab === 'past' ? desc(businessBookings.startAt) : asc(businessBookings.startAt)],
      limit: 100,
    });
    return rows.map(b => ({ ...serializeBooking(b), business: b.business }));
  }

  static async cancelByCustomer(user, bookingId, reason) {
    const booking = await db.query.businessBookings.findFirst({
      where: and(eq(businessBookings.id, bookingId), eq(businessBookings.customerId, user.id)),
      with: { business: true },
    });
    if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new ApiError(httpStatus.CONFLICT, 'This booking can no longer be cancelled');
    }
    if (booking.startAt <= new Date()) {
      throw new ApiError(httpStatus.CONFLICT, 'This booking has already started');
    }
    const business = booking.business;
    const policy = customerCancellationRefund(booking, business);
    const { row, refund } = await closeWithRefund(
      booking,
      business,
      ['pending', 'confirmed'],
      { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'customer', cancellationReason: reason ?? null },
      { ...policy, reason: `customer_cancelled_${policy.rule}` }
    );
    await notifyOwner(business, 'Booking cancelled', `${row.customerName} cancelled ${row.serviceName} on ${fmtWhen(row)}.`, row);
    return { booking: serializeBooking(row), refund: { ...refund, rule: policy.rule } };
  }

  // ── Cron ───────────────────────────────────────────────────────────────────

  /** Requests nobody answered in time → expired + full refund. */
  static async expireUnansweredRequests() {
    const due = await db.query.businessBookings.findMany({
      where: and(eq(businessBookings.status, 'pending'), lte(businessBookings.acceptDeadline, new Date())),
      with: { business: true },
      limit: 100,
    });
    let expired = 0;
    for (const booking of due) {
      try {
        const { row, refund } = await closeWithRefund(
          booking,
          booking.business,
          ['pending'],
          { status: 'expired', cancelledAt: new Date(), cancelledBy: 'system', cancellationReason: 'The business did not respond in time' },
          { serviceRefundCents: booking.amountPaidCents, refundFee: true, reason: 'request_expired' }
        );
        emailCustomer(row, booking.business, `Booking request expired: ${booking.business.name}`, 'Your request expired', [
          ['Refund', `${money(refund.refundedCents)} back to your card`],
        ]);
        expired++;
      } catch (err) {
        logger.error(`[businessBooking] expire request failed ${booking.id}: ${err.message}`);
      }
    }
    return { expired };
  }

  /**
   * Confirmed bookings nobody closed: completed automatically AUTO_COMPLETE_AFTER_HOURS
   * after they end (starts the payout clock and records any in-person commission).
   * A business that wants a no-show has until then to mark it.
   */
  static async autoCompletePastBookings() {
    const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_HOURS * 3_600_000);
    const due = await db.query.businessBookings.findMany({
      where: and(eq(businessBookings.status, 'confirmed'), lte(businessBookings.endAt, cutoff)),
      with: { business: { columns: { id: true, ownerId: true } } },
      limit: 200,
    });
    let completed = 0;
    for (const booking of due) {
      try {
        const row = await transition(booking.id, ['confirmed'], { status: 'completed', completedAt: new Date() });
        await BusinessCommissionService.recordForCompletedBooking(row, booking.business);
        completed++;
      } catch (err) {
        // CONFLICT = the business closed it meanwhile
        if (!(err instanceof ApiError)) logger.error(`[businessBooking] auto-complete failed ${booking.id}: ${err.message}`);
      }
    }
    const { created } = await BusinessCommissionService.backfillMissingCharges();
    return { completed, commissionBackfilled: created };
  }

  /** Abandoned checkouts whose expiry webhook never arrived. */
  static async releaseStaleHolds() {
    const cutoff = new Date(Date.now() - STALE_HOLD_MINS * 60_000);
    const rows = await db
      .update(businessBookings)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(businessBookings.status, 'awaiting_payment'), lt(businessBookings.createdAt, cutoff)))
      .returning({ id: businessBookings.id });
    return { released: rows.length };
  }
}
