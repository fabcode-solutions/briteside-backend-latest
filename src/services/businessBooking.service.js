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
  businessAddOns,
  businessQuestionnaires,
  businessGroupSessions,
  businessLocations,
  businessCustomOffers,
} from '../db/schema/index.js';
import {
  atLocation,
  atRecordLocation,
  filterStaffByLocation,
  isLocationClosed,
  resolveLocation,
  scopedLocationIds,
  serviceAtLocation,
  serviceOfferedAt,
  staffAtLocation,
  staffLocationMap,
  staffLocationSchedules,
} from './businessLocation.service.js';
import { BUSINESS_PERMISSIONS, permissionsForRole } from '../config/business-permissions.js';
import { legacyQuestions, resolveAnswers } from '../utils/businessQuestionnaire.js';
import { withSale } from '../utils/businessSale.js';
import { BusinessAttachmentService } from './businessAttachment.service.js';
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
import { BusinessReviewService, canReviewBooking } from './businessReview.service.js';
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
import { serviceDepositCents } from '../utils/businessDeposit.js';
import {
  depositBasis,
  isGroup,
  partySizeProblem,
  seatsLeft,
  sessionBaseCents,
} from '../utils/businessSession.js';

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

/**
 * Online amounts for a service (+ chosen add-ons) under a business's defaults.
 * Add-ons and the party (seats × price for a group session, guests × price with a
 * minimum for a private event) are part of the booked price: the fee tier, 5% and
 * a % deposit all use the total; a fixed $ deposit stays as set (per seat for
 * group sessions).
 */
export function priceBooking(service, business, addOns = [], { partySize = 1 } = {}) {
  const paymentModel = service.paymentModel ?? business.defaultPaymentModel;
  const addOnsCents = addOns.reduce((s, a) => s + a.priceCents, 0);
  const price = sessionBaseCents(service, partySize) + addOnsCents;
  let amountDueNowCents = 0;
  if (paymentModel === 'full') amountDueNowCents = price;
  else if (paymentModel === 'deposit') amountDueNowCents = serviceDepositCents(depositBasis(service, price, partySize));
  const customerFeeCents = calculateBusinessBookingFeeCents(price);
  // 5% of what is collected online now (withheld from it): full price, the deposit, or nothing.
  const platformCommissionCents = calculateBusinessCommissionCents(amountDueNowCents);
  // 5% of what the customer pays at the visit — owed by the business once the booking completes.
  const inPersonCommissionCents = calculateBusinessCommissionCents(price - amountDueNowCents);
  return {
    paymentModel,
    servicePriceCents: price,
    addOnsCents,
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
 * Returns how much of the service payment goes back. The booking fee is never refunded.
 */
export function customerCancellationRefund(booking, business, now = new Date()) {
  if (booking.status === 'pending') {
    return { serviceRefundCents: booking.amountPaidCents, rule: 'not_yet_accepted' };
  }
  const hoursBefore = (booking.startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore >= business.freeCancellationHours) {
    return { serviceRefundCents: booking.amountPaidCents, rule: 'free_window' };
  }
  return {
    serviceRefundCents: Math.round((booking.amountPaidCents * business.lateCancellationRefundPercent) / 100),
    rule: 'late',
  };
}

const BUSINESS_REFUND_STATUSES = ['confirmed', 'completed', 'no_show', 'cancelled'];
const RESCHEDULABLE_STATUSES = ['pending', 'confirmed'];

/** True once any of the booking's payout has gone to the business (day-14 / day-21 release). */
const payoutReleased = b => !!(b.standardReleasedAt || b.reserveReleasedAt);

/**
 * Service amount the business can still refund itself. Only while the whole
 * payout is held — after release the money has left the platform. The booking
 * fee is Briteside's and is never part of a business refund.
 */
export function businessRefundableCents(b) {
  if (!BUSINESS_REFUND_STATUSES.includes(b.status) || payoutReleased(b)) return 0;
  return Math.max(0, b.amountPaidCents - b.refundedCents);
}

/** Seats belong to a session's fixed time. */
export const GROUP_MOVE_BLOCK =
  'Seats in a group session can’t be moved to another time. Cancel and book another session instead.';

/** Why a customer can't move this booking themselves (null = they can). */
export function customerRescheduleBlock(booking, business, now = new Date()) {
  if (booking.groupSessionId) return GROUP_MOVE_BLOCK;
  if (!business?.allowCustomerRescheduling) return "This business doesn't allow online rescheduling";
  if (!RESCHEDULABLE_STATUSES.includes(booking.status)) return 'This booking can no longer be rescheduled';
  const days = business.reschedulingNoticeDays ?? 0;
  const noticeMs = Math.max(days * 86_400_000, MIN_LEAD_MINS * 60_000);
  if (booking.startAt.getTime() - now.getTime() < noticeMs) {
    return days > 0
      ? `Bookings can be rescheduled up to ${days} day${days === 1 ? '' : 's'} before the appointment`
      : 'This booking is too close to its start time to reschedule';
  }
  return null;
}

/** An add-on with no service list is offered with every service. */
export const addOnApplies = (addOn, serviceId) =>
  !addOn.serviceIds?.length || addOn.serviceIds.includes(serviceId);

/** Check-in opens this long before the start (customers arrive early). */
export const CHECK_IN_EARLY_MINS = 120;
/** Manual bookings may be back-dated this far (recording a walk-in after the fact). */
export const MANUAL_BACKDATE_HOURS = 24;
export const PAYMENT_ARRANGEMENTS = ['cash', 'card_in_person', 'bank_transfer', 'other'];

/** Existing bookings that would clash with [startAt, endAt) — buffers included, like computeSlots. */
export function overlappingBookings(busy, startAt, endAt, bufferMins = 0) {
  return busy.filter(b => {
    const buf = Math.max(bufferMins, b.bufferMins ?? 0) * 60_000;
    return startAt.getTime() < b.endAt.getTime() + buf && endAt.getTime() + buf > b.startAt.getTime();
  });
}

/** Why this booking can't be checked in right now (null = it can). */
export function checkInBlock(booking, now = new Date()) {
  if (booking.status !== 'confirmed') {
    return booking.status === 'pending'
      ? 'Accept this booking request before checking the customer in'
      : 'Only confirmed bookings can be checked in';
  }
  if (booking.startAt.getTime() - now.getTime() > CHECK_IN_EARLY_MINS * 60_000) {
    return `Check-in opens ${CHECK_IN_EARLY_MINS / 60} hours before the appointment`;
  }
  return null;
}

/** Clean extra charges and their total (cents). */
export function normalizeExtraCharges(charges = []) {
  const lines = charges
    .map(c => ({ label: String(c.label ?? '').trim(), amountCents: Math.round(Number(c.amountCents)) }))
    .filter(c => c.label && Number.isInteger(c.amountCents) && c.amountCents > 0);
  return { lines, totalCents: lines.reduce((s, c) => s + c.amountCents, 0) };
}

// ─── Serializers ────────────────────────────────────────────────────────────

// Location details loaded with booking lists (`with: { location: LOCATION_COLUMNS }`)
const LOCATION_COLUMNS = {
  columns: { id: true, name: true, locationType: true, city: true, address: true },
};

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
  // Branch the visit is at (location details when the query loaded them)
  locationId: b.locationId ?? null,
  // Booked from a custom price the business sent
  customOfferId: b.customOfferId ?? null,
  ...(b.location
    ? {
        location: {
          id: b.location.id,
          name: b.location.name,
          locationType: b.location.locationType,
          city: b.location.city,
          // A mobile location's address is the owner's home base — never sent out
          address: b.location.locationType === 'mobile' ? b.location.city : b.location.address,
        },
      }
    : {}),
  status: b.status,
  paymentModel: b.paymentModel,
  servicePriceCents: b.servicePriceCents,
  amountDueNowCents: b.amountDueNowCents,
  customerFeeCents: b.customerFeeCents,
  taxAmountCents: b.taxAmountCents,
  amountPaidCents: b.amountPaidCents,
  refundedCents: b.refundedCents,
  balanceDueAtVisitCents: Math.max(0, b.servicePriceCents + (b.extraChargesCents ?? 0) - b.amountPaidCents),
  source: b.source ?? 'online',
  // Picked when booking; already included in servicePriceCents / durationMins
  addOns: b.addOns ?? [],
  addOnsCents: b.addOnsCents ?? 0,
  checkedInAt: b.checkedInAt ?? null,
  extraCharges: b.extraCharges ?? [],
  extraChargesCents: b.extraChargesCents ?? 0,
  balancePaidOnlineCents: b.balancePaidCents,
  canPayBalanceOnline:
    b.status === 'confirmed' && !b.balancePaymentIntentId && b.servicePriceCents > b.amountPaidCents,
  customerName: b.customerName,
  notes: b.notes,
  answers: b.answers,
  // Seats in a public group session, or guests at a private event (1 = individual)
  groupSessionId: b.groupSessionId ?? null,
  partySize: b.partySize ?? 1,
  // Names only — the files are fetched through a signed link (attachment endpoints)
  attachments: (b.attachments ?? []).map((a, index) => ({ index, name: a.name, size: a.size, type: a.type })),
  acceptDeadline: b.acceptDeadline,
  cancelledBy: b.cancelledBy,
  cancellationReason: b.cancellationReason,
  rescheduledAt: b.rescheduledAt ?? null,
  rescheduledBy: b.rescheduledBy ?? null,
  createdAt: b.createdAt,
  ...(forBusiness
    ? {
        customerId: b.customerId,
        customerEmail: b.customerEmail,
        customerPhone: b.customerPhone,
        paymentArrangement: b.paymentArrangement ?? null,
        platformCommissionCents: b.platformCommissionCents,
        // 5% of what the customer pays at the visit — owed once the booking completes
        inPersonCommissionCents: ['cancelled', 'declined', 'expired', 'no_show'].includes(b.status)
          ? 0
          : inPersonCommissionCents(b),
        businessNetCents: b.amountPaidCents - b.refundedCents - b.platformCommissionCents,
        // What the business can still refund from the dashboard (0 once the payout is released)
        refundableCents: businessRefundableCents(b),
        payoutReleased: payoutReleased(b),
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
    with: { staffLinks: true, locationLinks: true, locationOverrides: true },
  });
  if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
  // A business viewed at one location (atLocation) only offers that location's services
  if (!serviceOfferedAt(service, business.locationId)) {
    throw new ApiError(httpStatus.CONFLICT, "This service isn't offered at that location. Please pick another.", true, '', {
      code: 'SERVICE_NOT_AT_LOCATION',
    });
  }
  // …at that location's own price / length, when it has them, less any running sale
  return withSale(serviceAtLocation(service, business.locationId));
}

const quoteRequired = () =>
  new ApiError(
    httpStatus.CONFLICT,
    'This service is priced on request. Send the business an inquiry and they’ll send you a custom price to book.',
    true,
    '',
    { code: 'QUOTE_REQUIRED' }
  );

/**
 * A custom price offer that can still be booked. `user` (when given) must be the
 * customer it was sent to; slots skip that check (they only reveal its length).
 */
export async function loadBookableOffer(businessId, offerId, user) {
  const offer = await db.query.businessCustomOffers.findFirst({
    where: and(eq(businessCustomOffers.id, offerId), eq(businessCustomOffers.businessId, businessId)),
  });
  if (!offer) throw new ApiError(httpStatus.NOT_FOUND, 'This offer no longer exists');
  if (user && offer.customerId !== user.id) {
    throw new ApiError(httpStatus.FORBIDDEN, 'This offer was sent to someone else');
  }
  const problem =
    offer.status === 'booked'
      ? 'You’ve already booked this offer'
      : offer.status === 'withdrawn'
        ? 'The business withdrew this offer'
        : offer.status === 'declined'
          ? 'You declined this offer'
          : offer.status === 'expired' || offer.expiresAt.getTime() < Date.now()
            ? 'This offer has expired. Ask the business for a new one.'
            : null;
  if (problem) throw new ApiError(httpStatus.CONFLICT, problem, true, '', { code: 'OFFER_UNAVAILABLE' });
  return offer;
}

/**
 * The service a custom offer books: its menu service (when it still exists) with the
 * offer's name, length, price and payment terms — or a one-off with the same shape.
 * Always an individual appointment; the offer's staff member (if set) is the only one.
 */
async function offerService(business, offer) {
  const base = offer.serviceId
    ? await db.query.businessServices.findFirst({
        where: and(
          eq(businessServices.id, offer.serviceId),
          eq(businessServices.businessId, business.id),
          isNull(businessServices.deletedAt)
        ),
        with: { staffLinks: true, locationLinks: true, locationOverrides: true },
      })
    : null;
  return {
    ...(base ?? { id: null, allStaff: true, staffLinks: [], bufferMins: 10, questionnaireId: null }),
    name: offer.serviceName,
    durationMins: offer.durationMins,
    priceCents: offer.priceCents,
    priceOnRequest: false,
    paymentModel: offer.paymentModel,
    depositCents: offer.paymentModel === 'deposit' ? offer.depositCents : null,
    depositPercent: null,
    sessionType: 'individual',
    minGuests: null,
    maxGuests: null,
    minimumTotalCents: null,
    // The business already agreed the job with the customer
    requiresApproval: false,
    ...(offer.staffId ? { allStaff: false, staffLinks: [{ staffId: offer.staffId }] } : {}),
  };
}

/**
 * The add-ons a customer picked, checked against what the business offers now:
 * active, not removed, and offered with this service. Throws a friendly 409 if
 * any isn't (the page was open while the business changed its add-ons).
 */
async function resolveAddOns(business, service, ids) {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return [];
  // Per-seat extras would be ambiguous — group sessions don't take add-ons
  if (isGroup(service)) {
    throw new ApiError(httpStatus.CONFLICT, "Add-ons aren't available for group sessions.", true, '', {
      code: 'ADD_ON_UNAVAILABLE',
    });
  }
  const rows = await db.query.businessAddOns.findMany({
    where: and(
      eq(businessAddOns.businessId, business.id),
      inArray(businessAddOns.id, unique),
      isNull(businessAddOns.deletedAt),
      eq(businessAddOns.active, true)
    ),
  });
  const usable = rows.filter(a => addOnApplies(a, service.id));
  if (usable.length !== unique.length) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'One of the add-ons you picked is no longer available. Please review your choices.',
      true,
      '',
      { code: 'ADD_ON_UNAVAILABLE' }
    );
  }
  // Keep the customer's order stable
  return unique.map(id => usable.find(a => a.id === id));
}

/** Individual / private event: lock the candidate staff and claim the requested slot. */
async function holdSlot(tx, business, bookedService, candidates, body) {
  for (const s of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_staff:' + s.id}))`);
  }
  const byStaff = await slotsForStaffList({
    business,
    service: bookedService,
    staffList: candidates,
    date: body.date,
    tx,
  });
  const staff = candidates.find(s => byStaff.get(s.id)?.some(sl => sl.time === body.time));
  if (!staff) {
    throw new ApiError(httpStatus.CONFLICT, 'That time was just taken. Please pick another slot.');
  }
  return { staff, slot: byStaff.get(staff.id).find(sl => sl.time === body.time) };
}

/**
 * Group session: lock the session, check it's still on and has room for
 * `seats`, and return its host + time. Two customers racing for the last seat
 * are serialised by the lock — the second gets SESSION_FULL.
 */
async function holdGroupSeats(tx, business, service, sessionId, seats) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_group_session:' + sessionId}))`);
  const session = await tx.query.businessGroupSessions.findFirst({
    where: and(
      eq(businessGroupSessions.id, sessionId),
      eq(businessGroupSessions.businessId, business.id),
      eq(businessGroupSessions.serviceId, service.id)
    ),
    with: { staff: true },
  });
  const gone = (message, code = 'SESSION_UNAVAILABLE') =>
    new ApiError(httpStatus.CONFLICT, message, true, '', { code });
  if (!session || session.status !== 'scheduled' || !session.staff || session.staff.deletedAt) {
    throw gone('This session is no longer available. Please pick another one.');
  }
  if (session.startAt.getTime() < Date.now() + MIN_LEAD_MINS * 60_000) {
    throw gone('This session has already started. Please pick another one.');
  }
  const taken = (await seatsTakenBySession([session.id], tx)).get(session.id) ?? 0;
  const left = seatsLeft(session.capacity, taken);
  if (seats > left) {
    throw gone(
      left === 0
        ? 'This session just filled up. Please pick another one.'
        : `Only ${left} ${left === 1 ? 'seat is' : 'seats are'} left in this session.`,
      'SESSION_FULL'
    );
  }
  return {
    staff: session.staff,
    slot: { startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString() },
  };
}

/** The service's questionnaire (null = none / removed → general booking questions). */
async function loadQuestionnaire(business, service) {
  if (!service.questionnaireId) return null;
  return (
    (await db.query.businessQuestionnaires.findFirst({
      where: and(
        eq(businessQuestionnaires.id, service.questionnaireId),
        eq(businessQuestionnaires.businessId, business.id),
        isNull(businessQuestionnaires.deletedAt)
      ),
    })) ?? null
  );
}

/** Service with its length extended by the chosen add-ons (for slot maths). */
const withAddOnTime = (service, addOns) => ({
  ...service,
  durationMins: service.durationMins + addOns.reduce((s, a) => s + a.durationMins, 0),
});

/**
 * Active staff who can perform the service and are taking bookings — and, for a
 * business viewed at one location (atLocation), who work at that location.
 */
async function eligibleStaff(business, service, tx = db) {
  const all = await tx.query.businessStaff.findMany({
    where: and(
      eq(businessStaff.businessId, business.id),
      isNull(businessStaff.deletedAt),
      eq(businessStaff.acceptingBookings, true)
    ),
    orderBy: [asc(businessStaff.sortOrder), asc(businessStaff.createdAt)],
  });
  const allowed = service.allStaff ? null : new Set(service.staffLinks.map(l => l.staffId));
  const forService = allowed ? all.filter(s => allowed.has(s.id)) : all;
  return filterStaffByLocation(forService, business.locationId, tx);
}

/**
 * Time already taken in these staff members' calendars: holding bookings plus
 * scheduled group sessions they host (a session blocks its whole time, booked or not).
 */
export async function busyForStaff(staffIds, dayStart, dayEnd, tx = db, excludeId = null, { excludeSessionId } = {}) {
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
  // Seats in a session are covered by the session itself
  if (excludeSessionId) {
    conds.push(
      or(isNull(businessBookings.groupSessionId), ne(businessBookings.groupSessionId, excludeSessionId))
    );
  }
  const sessionConds = [
    inArray(businessGroupSessions.staffId, staffIds),
    eq(businessGroupSessions.status, 'scheduled'),
    lt(businessGroupSessions.startAt, to),
    gte(businessGroupSessions.endAt, from),
  ];
  if (excludeSessionId) sessionConds.push(ne(businessGroupSessions.id, excludeSessionId));
  const [bookings, sessions] = await Promise.all([
    tx
      .select({
        staffId: businessBookings.staffId,
        startAt: businessBookings.startAt,
        endAt: businessBookings.endAt,
        bufferMins: businessBookings.bufferMins,
      })
      .from(businessBookings)
      .where(and(...conds)),
    tx
      .select({
        staffId: businessGroupSessions.staffId,
        startAt: businessGroupSessions.startAt,
        endAt: businessGroupSessions.endAt,
        bufferMins: businessGroupSessions.bufferMins,
      })
      .from(businessGroupSessions)
      .where(and(...sessionConds)),
  ]);
  return [...bookings, ...sessions];
}

/** Seats held per session (paid, requested, or a checkout still in progress). */
export async function seatsTakenBySession(sessionIds, tx = db, { excludeBookingId } = {}) {
  const out = new Map(sessionIds.map(id => [id, 0]));
  if (!sessionIds.length) return out;
  const staleCutoff = new Date(Date.now() - STALE_HOLD_MINS * 60_000);
  const conds = [
    inArray(businessBookings.groupSessionId, sessionIds),
    inArray(businessBookings.status, HOLDING_STATUSES),
    or(ne(businessBookings.status, 'awaiting_payment'), gte(businessBookings.createdAt, staleCutoff)),
  ];
  if (excludeBookingId) conds.push(ne(businessBookings.id, excludeBookingId));
  const rows = await tx
    .select({
      sessionId: businessBookings.groupSessionId,
      seats: sql`coalesce(sum(${businessBookings.partySize}), 0)::int`,
    })
    .from(businessBookings)
    .where(and(...conds))
    .groupBy(businessBookings.groupSessionId);
  for (const r of rows) out.set(r.sessionId, Number(r.seats));
  return out;
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
  const [busy, overrides, closed, locationSchedules] = await Promise.all([
    busyForStaff(ids, dayStart, dayEnd, tx, excludeBookingId),
    overridesFor(ids, date, tx),
    // A closed location (holiday) has no times that day
    isLocationClosed(business.locationId, date, tx),
    business.locationId ? staffLocationSchedules(ids, tx) : new Map(),
  ]);
  const result = new Map();
  if (closed) {
    for (const s of staffList) result.set(s.id, []);
    return result;
  }
  for (const member of staffList) {
    // Someone with per-location hours works here only in this location's hours —
    // and not at all at a location they have no hours for (date overrides included)
    const perLocation = locationSchedules.get(member.id);
    if (business.locationId && perLocation && Object.keys(perLocation).length && !perLocation[business.locationId]) {
      result.set(member.id, []);
      continue;
    }
    const staff = staffAtLocation(member, business.locationId, locationSchedules);
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
  // Location managers only see their locations' bookings
  const scope = scopedLocationIds(access);
  if (scope && !scope.includes(booking.locationId)) {
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
 * serviceRefundCents: part of the service payment going back.
 * Tax is refunded in proportion to the service refund. The booking fee is
 * non-refundable in every case (customer cancel, business decline/cancel, expiry).
 */
async function refundBooking(booking, business, { serviceRefundCents, reason }) {
  const serviceRefund = Math.max(0, Math.min(serviceRefundCents, booking.amountPaidCents - booking.refundedCents));
  const fraction = booking.amountPaidCents > 0 ? serviceRefund / booking.amountPaidCents : 0;
  const taxRefund = Math.round((booking.taxAmountCents ?? 0) * fraction);
  const feeRefund = 0;
  const total = serviceRefund + taxRefund;

  // Claim the refund first: only succeeds if nobody refunded since `booking` was read,
  // so two refund paths (e.g. a business refund and a customer cancel) can't both pay out.
  if (serviceRefund > 0) {
    const [claimed] = await db
      .update(businessBookings)
      .set({ refundedCents: booking.refundedCents + serviceRefund, updatedAt: new Date() })
      .where(and(eq(businessBookings.id, booking.id), eq(businessBookings.refundedCents, booking.refundedCents)))
      .returning({ id: businessBookings.id });
    if (!claimed) {
      throw new ApiError(httpStatus.CONFLICT, 'This booking was just refunded. Refresh and try again.');
    }
  }
  const releaseClaim = () =>
    serviceRefund > 0
      ? db
          .update(businessBookings)
          .set({ refundedCents: booking.refundedCents, updatedAt: new Date() })
          .where(
            and(
              eq(businessBookings.id, booking.id),
              eq(businessBookings.refundedCents, booking.refundedCents + serviceRefund)
            )
          )
      : Promise.resolve();

  // A booking can have two card payments (booking + balance paid later). Refund the
  // balance payment first (it carries no booking fee), the rest from the booking payment.
  const refundIds = [];
  if (total > 0) {
    if (!stripe || !booking.stripePaymentIntentId) {
      await releaseClaim();
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Refunds are unavailable right now');
    }
    const fromBalance = booking.balancePaymentIntentId ? Math.min(total, booking.balanceChargedCents) : 0;
    const parts = [
      { pi: booking.balancePaymentIntentId, amount: fromBalance, key: 'balance' },
      { pi: booking.stripePaymentIntentId, amount: total - fromBalance, key: 'booking' },
    ].filter(p => p.pi && p.amount > 0);
    for (const p of parts) {
      let refund;
      try {
        refund = await stripe.refunds.create(
          {
            payment_intent: p.pi,
            amount: p.amount,
            reason: 'requested_by_customer',
            metadata: { type: SOURCE_TYPE, bookingId: booking.id, reason, payment: p.key },
          },
          { idempotencyKey: `business-booking-refund-${booking.id}-${reason}-${p.key}` }
        );
      } catch (err) {
        // Nothing went out yet → give the claim back. If an earlier part already
        // refunded, keep the claim (money did leave) and surface the error.
        if (!refundIds.length) await releaseClaim();
        throw err;
      }
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

// ─── Rescheduling ───────────────────────────────────────────────────────────

/** Slot maths uses the booking's own length/buffer — the service may have changed or been removed since. */
const bookingShape = booking => ({ durationMins: booking.durationMins, bufferMins: booking.bufferMins });

/**
 * Staff a booking may move to: anyone currently eligible for its service, plus
 * its current staff member (so a booking can still move within their calendar).
 * `onlyStaffId` narrows to one (staff-role members, or a chosen staff member).
 */
async function rescheduleStaffPool(business, booking, onlyStaffId) {
  // Manual bookings of a custom service have no serviceId — only their own staff member applies
  const service = booking.serviceId
    ? await db.query.businessServices.findFirst({
        where: and(
          eq(businessServices.id, booking.serviceId),
          eq(businessServices.businessId, business.id),
          isNull(businessServices.deletedAt)
        ),
        with: { staffLinks: true },
      })
    : null;
  const pool = service ? await eligibleStaff(business, service) : [];
  if (!pool.some(s => s.id === booking.staffId)) {
    const current = await db.query.businessStaff.findFirst({
      where: and(eq(businessStaff.id, booking.staffId), isNull(businessStaff.deletedAt)),
    });
    if (current) pool.push(current);
  }
  return onlyStaffId ? pool.filter(s => s.id === onlyStaffId) : pool;
}

/** Free times on `date` for moving `booking` (its own current slot doesn't block). */
async function rescheduleSlotsFor(bookedBusiness, booking, { date, staffId }) {
  // Moves stay at the booking's location (its hours, timezone and staff)
  const business = await atRecordLocation(bookedBusiness, booking);
  const staffList = await rescheduleStaffPool(business, booking, staffId ?? booking.staffId);
  const base = { date, timezone: business.timezone, durationMins: booking.durationMins };
  if (!staffList.length) return { ...base, slots: [] };
  const byStaff = await slotsForStaffList({
    business,
    service: bookingShape(booking),
    staffList,
    date,
    excludeBookingId: booking.id,
  });
  const staff = staffList[0];
  const current = booking.startAt.toISOString();
  const slots = (byStaff.get(staff.id) ?? []).filter(s => staff.id !== booking.staffId || s.startAt !== current);
  return { ...base, staffId: staff.id, slots };
}

/**
 * Move a booking in place: re-checks the slot under the staff lock (same as
 * checkout), keeps payments as they are, and re-arms the reminders.
 */
async function moveBooking(base, booking, { date, time, staffId }, by) {
  const business = await atRecordLocation(base, booking);
  const [staff] = await rescheduleStaffPool(business, booking, staffId ?? booking.staffId);
  if (!staff) throw new ApiError(httpStatus.CONFLICT, 'That staff member is not available for this booking');

  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_staff:' + staff.id}))`);
    const fresh = await tx.query.businessBookings.findFirst({ where: eq(businessBookings.id, booking.id) });
    if (
      !fresh ||
      !RESCHEDULABLE_STATUSES.includes(fresh.status) ||
      fresh.startAt.getTime() !== booking.startAt.getTime()
    ) {
      throw new ApiError(httpStatus.CONFLICT, 'This booking was already updated. Refresh and try again.');
    }
    const byStaff = await slotsForStaffList({
      business,
      service: bookingShape(booking),
      staffList: [staff],
      date,
      tx,
      excludeBookingId: booking.id,
    });
    const slot = byStaff.get(staff.id)?.find(s => s.time === time);
    if (!slot) throw new ApiError(httpStatus.CONFLICT, 'That time is no longer available. Please pick another.');
    if (staff.id === booking.staffId && slot.startAt === booking.startAt.toISOString()) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a different time');
    }

    const [row] = await tx
      .update(businessBookings)
      .set({
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        staffId: staff.id,
        staffName: staff.name,
        reminder24hSentAt: null,
        reminder1hSentAt: null,
        rescheduledAt: new Date(),
        rescheduledBy: by,
        rescheduleCount: sql`${businessBookings.rescheduleCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(businessBookings.id, booking.id), inArray(businessBookings.status, RESCHEDULABLE_STATUSES)))
      .returning();
    if (!row) throw new ApiError(httpStatus.CONFLICT, 'This booking was already updated. Refresh and try again.');
    return row;
  });
}

/** A signed-in customer's own booking, with the business columns rescheduling needs. */
async function loadCustomerBooking(user, bookingId) {
  const booking = await db.query.businessBookings.findFirst({
    where: and(eq(businessBookings.id, bookingId), eq(businessBookings.customerId, user.id)),
    with: { business: true },
  });
  if (!booking || !booking.business || booking.business.deletedAt) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  return booking;
}

async function attachmentLink(booking, index) {
  const file = (booking.attachments ?? [])[index];
  if (!file) throw new ApiError(httpStatus.NOT_FOUND, 'That file is no longer attached to this booking');
  const { url, expiresIn } = await BusinessAttachmentService.viewUrl(file);
  return { url, expiresIn, name: file.name, type: file.type };
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

/** Email the customer and, when they have an account, an in-app notification too. */
function emailCustomer(booking, business, subject, headline, extraRows = []) {
  if (booking.customerId) {
    createNotification({
      userId: booking.customerId,
      title: subject,
      message: `${headline} · ${booking.serviceName}, ${fmtWhen(booking)}`,
      type: 'business_booking',
      redirectTo: '/bookings?tab=business',
      relatedId: booking.id,
      metadata: { businessId: business.id, bookingId: booking.id, status: booking.status },
    }).catch(err => logger.error(`[businessBooking] customer notification failed ${booking.id}: ${err.message}`));
  }
  // Manual bookings may have only a phone number
  if (!booking.customerEmail) return;
  (async () => {
    // Which branch to go to
    const location = booking.locationId
      ? await db.query.businessLocations.findFirst({ where: eq(businessLocations.id, booking.locationId) })
      : null;
    const html = emailWrapper(`
      <h2 style="margin:0 0 12px">${escapeHtml(headline)}</h2>
      ${infoBox([
        ['Business', escapeHtml(business.name)],
        ['Service', escapeHtml(booking.serviceName)],
        ['With', escapeHtml(booking.staffName)],
        ['When', escapeHtml(fmtWhen(booking))],
        ...(location ? [['Where', escapeHtml(locationLine(location))]] : []),
        ...extraRows,
      ])}
      ${ctaRow(ctaButton('View business', appUrl(`/business/${business.slug}`)))}
    `);
    await sendMail(booking.customerEmail, subject, html);
  })().catch(err => logger.error(`[businessBooking] customer email failed ${booking.id}: ${err.message}`));
}

/** "Downtown · 12 King St, Toronto" / "Uptown · Mobile, serves Toronto" */
function locationLine(l) {
  const where =
    l.locationType === 'mobile'
      ? `Mobile, serves ${l.city}`
      : [l.address, l.address?.toLowerCase().includes(l.city.toLowerCase()) ? null : l.city].filter(Boolean).join(', ');
  return l.name && l.name !== l.city ? `${l.name} · ${where}` : where;
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
  static async getSlots(idOrSlug, { serviceId, offerId, staffId, locationId, date, addOnIds }) {
    const publicBusiness = await loadPublicBusiness(idOrSlug);
    // A custom offer: its length / staff, at its location when it names one
    const offer = offerId ? await loadBookableOffer(publicBusiness.id, offerId) : null;
    // That location's hours, timezone and staff (main location when not given)
    const business = atLocation(
      publicBusiness,
      await resolveLocation(publicBusiness, offer?.locationId ?? locationId)
    );
    let service;
    if (offer) {
      service = await offerService(business, offer);
    } else {
      const loaded = await loadService(business, serviceId);
      // "Inquire for pricing" is booked only through a custom offer
      if (loaded.priceOnRequest) throw quoteRequired();
      // Add-on minutes make the appointment longer, so fewer times may fit
      service = withAddOnTime(loaded, await resolveAddOns(business, loaded, addOnIds));
    }
    const loaded = service;
    const base = {
      date,
      timezone: business.timezone,
      locationId: business.locationId,
      durationMins: service.durationMins,
    };
    if (!business.acceptingBookings || business.pageType === 'standard') return { ...base, slots: [] };
    // Group services are booked into scheduled sessions (listGroupSessions), not free slots
    if (isGroup(loaded)) return { ...base, slots: [] };

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
  static async quote(idOrSlug, serviceId, addOnIds, partySize = 1, locationId) {
    const publicBusiness = await loadPublicBusiness(idOrSlug);
    // That location's price, when it has its own
    const business = locationId
      ? atLocation(publicBusiness, await resolveLocation(publicBusiness, locationId))
      : publicBusiness;
    const service = await loadService(business, serviceId);
    if (service.priceOnRequest) throw quoteRequired();
    const problem = partySizeProblem(service, partySize);
    if (problem) throw new ApiError(httpStatus.BAD_REQUEST, problem);
    const addOns = await resolveAddOns(business, service, addOnIds);
    return priceBooking(service, business, addOns, { partySize });
  }

  /**
   * Upcoming sessions of a group service customers can book (next 90 days).
   * Seats left are shown only when the business allows it; `full` always is.
   */
  static async listPublicGroupSessions(idOrSlug, serviceId, locationId) {
    const publicBusiness = await loadPublicBusiness(idOrSlug);
    // Sessions at the chosen location (all locations when none is given)
    const location = locationId ? await resolveLocation(publicBusiness, locationId) : null;
    const business = location ? atLocation(publicBusiness, location) : publicBusiness;
    const service = await loadService(business, serviceId);
    if (!isGroup(service)) return { timezone: business.timezone, sessions: [] };
    const now = new Date();
    const rows = await db.query.businessGroupSessions.findMany({
      where: and(
        eq(businessGroupSessions.serviceId, service.id),
        eq(businessGroupSessions.status, 'scheduled'),
        gte(businessGroupSessions.startAt, new Date(now.getTime() + MIN_LEAD_MINS * 60_000)),
        lte(businessGroupSessions.startAt, new Date(now.getTime() + 90 * 86_400_000)),
        ...(location ? [eq(businessGroupSessions.locationId, location.id)] : [])
      ),
      with: { staff: { columns: { id: true, name: true, deletedAt: true } } },
      orderBy: [asc(businessGroupSessions.startAt)],
      limit: 200,
    });
    const visible = rows.filter(r => r.staff && !r.staff.deletedAt);
    const taken = await seatsTakenBySession(visible.map(r => r.id));
    return {
      timezone: business.timezone,
      sessions: visible.map(r => {
        const left = seatsLeft(r.capacity, taken.get(r.id) ?? 0);
        return {
          id: r.id,
          startAt: r.startAt,
          endAt: r.endAt,
          staffId: r.staffId,
          staffName: r.staff.name,
          locationId: r.locationId ?? null,
          full: left === 0,
          ...(service.showRemainingSeats ? { capacity: r.capacity, seatsLeft: left } : {}),
        };
      }),
    };
  }

  /**
   * Hold the slot (awaiting_payment) and open a Stripe Checkout session for
   * the online portion + booking fee. Guests allowed (user may be null).
   */
  static async createCheckout(idOrSlug, user, body) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');

    const publicBusiness = await loadPublicBusiness(idOrSlug);
    // A custom price offer: only the signed-in customer it was sent to can book it
    let offer = null;
    if (body.offerId) {
      if (!user) throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to book this offer');
      offer = await loadBookableOffer(publicBusiness.id, body.offerId, user);
      body = { ...body, groupSessionId: undefined, addOnIds: [], partySize: 1 };
    }
    // The branch being booked: a group session's own location, else the chosen
    // one (main location when none) — its hours, timezone and staff apply.
    let business;
    if (offer) {
      business = atLocation(publicBusiness, await resolveLocation(publicBusiness, offer.locationId ?? body.locationId));
    } else if (body.groupSessionId) {
      const session = await db.query.businessGroupSessions.findFirst({
        where: and(
          eq(businessGroupSessions.id, body.groupSessionId),
          eq(businessGroupSessions.businessId, publicBusiness.id)
        ),
        columns: { locationId: true },
      });
      business = await atRecordLocation(publicBusiness, session);
    } else {
      business = atLocation(publicBusiness, await resolveLocation(publicBusiness, body.locationId));
    }
    // Standard pages are profile-only — no booking
    if (business.pageType === 'standard') {
      throw new ApiError(httpStatus.CONFLICT, 'This business does not take bookings on Briteside');
    }
    if (!business.acceptingBookings || (await BusinessCommissionService.isBookingPaused(business.id))) {
      throw new ApiError(httpStatus.CONFLICT, 'This business is not taking bookings right now');
    }
    const service = offer ? await offerService(business, offer) : await loadService(business, body.serviceId);
    // "Inquire for pricing" is booked only through a custom offer
    if (!offer && service.priceOnRequest) throw quoteRequired();

    // The service's questionnaire, or the business's general booking questions
    const questionnaire = await loadQuestionnaire(business, service);
    const answers = resolveAnswers(
      questionnaire ? questionnaire.questions : legacyQuestions(business.bookingQuestions),
      body.answers
    );
    // Uploaded beforehand (signed-in customers); checked to be theirs and still stored
    const attachments = await BusinessAttachmentService.resolveForBooking(
      business,
      user?.id ?? null,
      body.attachments,
      { allowed: !!questionnaire?.allowAttachments }
    );

    // Seats (group session) or guests (private event)
    const partySize = body.partySize ?? 1;
    const sizeProblem = partySizeProblem(service, partySize);
    if (sizeProblem) throw new ApiError(httpStatus.BAD_REQUEST, sizeProblem);
    const group = isGroup(service);
    if (group && !body.groupSessionId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a session to book');
    }

    const addOns = await resolveAddOns(business, service, body.addOnIds);
    const pricing = priceBooking(service, business, addOns, { partySize });
    // Slot length includes the add-ons' extra minutes
    const bookedService = withAddOnTime(service, addOns);
    const staffPool = group ? [] : await eligibleStaff(business, service);
    const candidates = body.staffId ? staffPool.filter(s => s.id === body.staffId) : staffPool;
    if (!group && !candidates.length) {
      throw new ApiError(httpStatus.CONFLICT, 'That staff member is not available for this service');
    }

    const customerEmail = (body.customer?.email || user?.email || '').trim().toLowerCase();
    const customerName = (body.customer?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ')).trim();
    if (!customerEmail || !customerName) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Name and email are required');
    }

    const { liability } = await PlusTaxLiabilityService.resolveLiability(business.ownerId);
    const taxLiability = liability ? liability.type : 'none';

    // Lock, re-check the slot (or the session's seats), insert the hold — all in one transaction
    const booking = await db.transaction(async tx => {
      if (offer) {
        // One payable hold per offer: an earlier unpaid attempt (another tab, a retry)
        // stops holding its slot, and paying it late is refunded by the webhook.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_offer:' + offer.id}))`);
        await tx
          .update(businessBookings)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(businessBookings.customOfferId, offer.id), eq(businessBookings.status, 'awaiting_payment')));
      }
      const { staff, slot } = group
        ? await holdGroupSeats(tx, business, service, body.groupSessionId, partySize)
        : await holdSlot(tx, business, bookedService, candidates, body);

      const [row] = await tx
        .insert(businessBookings)
        .values({
          businessId: business.id,
          // null for an offer of a one-off service (name / length snapshotted below)
          serviceId: service.id ?? null,
          customOfferId: offer?.id ?? null,
          staffId: staff.id,
          customerId: user?.id ?? null,
          customerName,
          customerEmail,
          customerPhone: body.customer?.phone?.trim() || null,
          serviceName: service.name,
          staffName: staff.name,
          durationMins: group
            ? Math.round((new Date(slot.endAt) - new Date(slot.startAt)) / 60_000)
            : bookedService.durationMins,
          bufferMins: group ? 0 : service.bufferMins,
          startAt: new Date(slot.startAt),
          endAt: new Date(slot.endAt),
          timezone: business.timezone,
          locationId: business.locationId,
          groupSessionId: group ? body.groupSessionId : null,
          partySize,
          status: 'awaiting_payment',
          addOns: addOns.map(a => ({ id: a.id, name: a.name, priceCents: a.priceCents, durationMins: a.durationMins })),
          addOnsCents: pricing.addOnsCents,
          paymentModel: pricing.paymentModel,
          servicePriceCents: pricing.servicePriceCents,
          amountDueNowCents: pricing.amountDueNowCents,
          customerFeeCents: pricing.customerFeeCents,
          platformCommissionCents: pricing.platformCommissionCents,
          notes: body.notes?.trim() || null,
          answers,
          attachments,
          taxLiability,
          reserveAmountCents: 0,
          // Snapshot now, so editing the service mid-checkout doesn't change the outcome
          needsApproval: !!service.requiresApproval,
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
            name: `${pricing.paymentModel === 'deposit' ? 'Deposit: ' : ''}${service.name}${
              addOns.length ? ` + ${addOns.map(a => a.name).join(', ')}` : ''
            } at ${business.name}`.slice(0, 250),
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

    // A request when the staff member confirms by hand, or the service requires approval
    const manual = existing.staff?.bookingConfirmation === 'manual' || !!existing.needsApproval;
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

    // Booked from a custom price → the offer is done (even if it expired mid-checkout)
    if (booking.customOfferId) {
      await db
        .update(businessCustomOffers)
        .set({ status: 'booked', bookingId: booking.id, bookedAt: now, updatedAt: now })
        .where(and(eq(businessCustomOffers.id, booking.customOfferId), ne(businessCustomOffers.status, 'booked')))
        .catch(err => logger.error(`[businessBooking] offer ${booking.customOfferId} not marked booked: ${err.message}`));
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

  static async listForBusiness(business, access, { from, to, status, staffId, locationId, page = 1, limit = 50 }) {
    const conds = [eq(businessBookings.businessId, business.id), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    if (locationId) conds.push(eq(businessBookings.locationId, locationId));
    // Location managers: only their locations
    const scope = scopedLocationIds(access);
    if (scope) conds.push(inArray(businessBookings.locationId, scope));
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
    const scopedTo = []; // [{ businessId, locationIds }] for location managers
    const manageIds = new Set(fullIds);
    // Refunds: owners, admins and managers (not staff-role members)
    const refundIds = new Set(fullIds);
    for (const m of memberships) {
      if (!m.business || m.business.deletedAt) continue;
      const perms = permissionsForRole(m.role);
      if (!perms.includes(BUSINESS_PERMISSIONS.BOOKINGS_VIEW)) continue;
      if (perms.includes(BUSINESS_PERMISSIONS.BOOKINGS_MANAGE)) {
        manageIds.add(m.businessId);
        if (m.role !== 'staff') refundIds.add(m.businessId);
      }
      if (m.role === 'staff') {
        if (m.staffId) ownStaff.push({ businessId: m.businessId, staffId: m.staffId });
      } else if (m.locationIds?.length) {
        scopedTo.push({ businessId: m.businessId, locationIds: m.locationIds });
      } else {
        fullIds.push(m.businessId);
      }
    }

    const scope = [
      ...(fullIds.length ? [inArray(businessBookings.businessId, fullIds)] : []),
      ...ownStaff.map(s => and(eq(businessBookings.businessId, s.businessId), eq(businessBookings.staffId, s.staffId))),
      ...scopedTo.map(s =>
        and(eq(businessBookings.businessId, s.businessId), inArray(businessBookings.locationId, s.locationIds))
      ),
    ];
    if (!scope.length) return { bookings: [], businesses: 0 };

    const conds = [or(...scope), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    if (status?.length) conds.push(inArray(businessBookings.status, status));
    if (from) conds.push(gte(businessBookings.startAt, new Date(from)));
    if (to) conds.push(lte(businessBookings.startAt, new Date(to)));

    const rows = await db.query.businessBookings.findMany({
      where: and(...conds),
      with: {
        business: { columns: { id: true, slug: true, name: true, logoUrl: true, timezone: true } },
        location: LOCATION_COLUMNS,
      },
      orderBy: [asc(businessBookings.startAt)],
      limit,
    });
    return {
      bookings: rows.map(b => ({
        ...serializeBooking(b, { forBusiness: true }),
        business: b.business,
        canManage: manageIds.has(b.businessId),
        canRefund: refundIds.has(b.businessId),
      })),
      businesses: new Set([...fullIds, ...ownStaff.map(s => s.businessId), ...scopedTo.map(s => s.businessId)]).size,
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
      { serviceRefundCents: booking.amountPaidCents, reason: 'business_declined' }
    );
    emailCustomer(row, business, `Booking request declined: ${business.name}`, `${business.name} couldn’t take this booking`, [
      ['Refund', `${money(refund.refundedCents)} back to your card`],
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }), refund };
  }

  /** Business cancels: customer gets the full service payment back (the booking fee is non-refundable). */
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
      { serviceRefundCents: booking.amountPaidCents, reason: 'business_cancelled' }
    );
    emailCustomer(row, business, `Booking cancelled: ${business.name}`, `${business.name} cancelled your booking`, [
      ['Refund', `${money(refund.refundedCents)} back to your card`],
      ...(reason ? [['Reason', escapeHtml(reason)]] : []),
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }), refund };
  }

  /**
   * Close a visit. `charges` = extras done on the day ([{ label, amountCents }]),
   * collected in person; 5% commission applies to them like the service price.
   */
  static async complete(business, bookingId, access, { charges } = {}) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.startAt > new Date()) throw new ApiError(httpStatus.CONFLICT, 'You can complete a booking once it has started');
    const extras = normalizeExtraCharges(charges);
    if ((charges?.length ?? 0) !== extras.lines.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Each extra charge needs a description and an amount above $0');
    }
    const row = await transition(bookingId, ['confirmed'], {
      status: 'completed',
      completedAt: new Date(),
      ...(extras.lines.length ? { extraCharges: extras.lines, extraChargesCents: extras.totalCents } : {}),
    });
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

  /**
   * Refund all or part of what the customer paid online for the service (never
   * the booking fee). Owners, admins and managers only, and only while the
   * payout is still held. The booking's status doesn't change.
   */
  static async refundByBusiness(business, bookingId, access, { amountCents, reason } = {}) {
    if (access?.role === 'staff') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Only owners, admins and managers can issue refunds');
    }
    const booking = await getBookingForBusiness(business, bookingId, access);
    const max = businessRefundableCents(booking);
    if (max <= 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        payoutReleased(booking) && booking.amountPaidCents > booking.refundedCents
          ? 'The payout for this booking has already been released, so it can’t be refunded here. Contact support.'
          : 'There is nothing left to refund on this booking'
      );
    }
    const amount = amountCents ?? max;
    if (amount > max) {
      throw new ApiError(httpStatus.BAD_REQUEST, `You can refund up to ${money(max)}`);
    }

    const refund = await refundBooking(booking, business, {
      serviceRefundCents: amount,
      // Unique per refund (refundedCents changes after each), so partial refunds don't collide
      reason: `business_refund_${booking.refundedCents}`,
    });
    const row = await db.query.businessBookings.findFirst({ where: eq(businessBookings.id, booking.id) });
    emailCustomer(row, business, `Refund from ${business.name}`, `${business.name} refunded you ${money(refund.refundedCents)}`, [
      ['Refund', `${money(refund.refundedCents)} back to your card`],
      ...(reason ? [['Note', escapeHtml(reason)]] : []),
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }), refund };
  }

  /** Free times to move a booking to (dashboard). Staff-role members: their own calendar only. */
  static async rescheduleSlotsForBusiness(business, bookingId, access, { date, staffId }) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.groupSessionId) throw new ApiError(httpStatus.CONFLICT, GROUP_MOVE_BLOCK);
    const onlyStaff = access?.role === 'staff' ? access.staffId : staffId;
    return rescheduleSlotsFor(business, booking, { date, staffId: onlyStaff });
  }

  /** Mark the customer as arrived (or undo it). Idempotent. */
  static async checkIn(business, bookingId, access, { undo = false } = {}) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (undo) {
      if (!booking.checkedInAt) return { booking: serializeBooking(booking, { forBusiness: true }) };
      const row = await transition(bookingId, ['confirmed'], { checkedInAt: null });
      return { booking: serializeBooking(row, { forBusiness: true }) };
    }
    if (booking.checkedInAt) return { booking: serializeBooking(booking, { forBusiness: true }) };
    const blocked = checkInBlock(booking);
    if (blocked) throw new ApiError(httpStatus.CONFLICT, blocked);
    const row = await transition(bookingId, ['confirmed'], { checkedInAt: new Date() });
    return { booking: serializeBooking(row, { forBusiness: true }) };
  }

  /**
   * Walk-in / phone booking added from the dashboard. Nothing is charged online
   * (no booking fee); it's confirmed straight away, and 5% of the price is owed
   * once it completes like any pay-in-person booking. Times outside working
   * hours are allowed (it's the business's own calendar); clashes with another
   * booking for the same staff member need `allowOverlap`.
   */
  static async createManual(base, access, body) {
    if (base.pageType === 'standard') {
      throw new ApiError(httpStatus.CONFLICT, 'Switch your page to Appointments to take bookings');
    }
    if (access?.role === 'staff' && body.staffId !== access.staffId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only add bookings to your own calendar');
    }
    const staff = await db.query.businessStaff.findFirst({
      where: and(
        eq(businessStaff.id, body.staffId),
        eq(businessStaff.businessId, base.id),
        isNull(businessStaff.deletedAt)
      ),
    });
    if (!staff) throw new ApiError(httpStatus.NOT_FOUND, 'That staff member no longer exists. Refresh and try again.');

    // Where the visit is: the chosen location, else the staff member's only one,
    // else the manager's first location, else the main one
    const scope = scopedLocationIds(access);
    let locationId = body.locationId;
    if (!locationId) {
      const ids = (await staffLocationMap([staff.id])).get(staff.id) ?? [];
      if (ids.length === 1) locationId = ids[0];
      else if (scope) locationId = scope[0];
    }
    const location = await resolveLocation(base, locationId);
    if (scope && !scope.includes(location?.id)) {
      throw new ApiError(httpStatus.FORBIDDEN, "You don't manage that location");
    }
    if (location && !(await filterStaffByLocation([staff], location.id)).length) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${staff.name} doesn't work at ${location.name}`);
    }
    const business = atLocation(base, location);

    let service = null;
    if (body.serviceId) service = await loadService(business, body.serviceId);
    if (isGroup(service)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Group classes are booked into a scheduled session. Customers book seats from your page; to take a walk-in, add them as a custom service.'
      );
    }
    const serviceName = service?.name ?? body.customService?.name?.trim();
    const durationMins = service?.durationMins ?? body.customService?.durationMins;
    if (!serviceName || !durationMins) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a service, or name a custom one with its length');
    }
    const bufferMins = service?.bufferMins ?? 0;

    const tz = business.timezone;
    const start = dayjs.tz(`${body.date}T${body.time}:00`, tz);
    if (!start.isValid()) throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a valid date and time');
    const startAt = start.toDate();
    const endAt = new Date(startAt.getTime() + durationMins * 60_000);
    const now = Date.now();
    if (startAt.getTime() < now - MANUAL_BACKDATE_HOURS * 3_600_000) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Bookings can be added up to ${MANUAL_BACKDATE_HOURS} hours in the past`);
    }
    if (startAt.getTime() > now + 365 * 86_400_000) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Bookings can be added up to a year ahead');
    }

    const email = body.customer.email?.trim().toLowerCase() || null;
    const row = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_staff:' + staff.id}))`);
      if (!body.allowOverlap) {
        const busy = await busyForStaff([staff.id], startAt, endAt, tx);
        const clash = overlappingBookings(busy, startAt, endAt, bufferMins)[0];
        if (clash) {
          const at = dayjs(clash.startAt).tz(tz).format('h:mm A');
          throw new ApiError(
            httpStatus.CONFLICT,
            `${staff.name} already has a booking at ${at} that overlaps this time.`,
            true,
            '',
            { code: 'BOOKING_OVERLAP' }
          );
        }
      }
      const [inserted] = await tx
        .insert(businessBookings)
        .values({
          businessId: business.id,
          serviceId: service?.id ?? null,
          staffId: staff.id,
          customerId: null,
          customerName: body.customer.name.trim(),
          customerEmail: email,
          customerPhone: body.customer.phone?.trim() || null,
          source: 'manual',
          paymentArrangement: body.paymentArrangement,
          serviceName,
          staffName: staff.name,
          durationMins,
          bufferMins,
          startAt,
          endAt,
          timezone: tz,
          locationId: business.locationId,
          status: 'confirmed',
          confirmedAt: new Date(),
          paymentModel: 'in_person',
          servicePriceCents: body.priceCents,
          amountDueNowCents: 0,
          customerFeeCents: 0,
          platformCommissionCents: 0,
          notes: body.notes?.trim() || null,
          answers: [],
          taxLiability: 'none',
          reserveAmountCents: 0,
        })
        .returning();
      return inserted;
    });

    if (body.notifyCustomer !== false) {
      emailCustomer(row, business, `Booking confirmed: ${business.name}`, `You're booked at ${business.name}`, [
        ['Price', `${money(row.servicePriceCents)}, paid at your visit`],
      ]);
    }
    return { booking: serializeBooking(row, { forBusiness: true }) };
  }

  /** Business moves a booking; the customer is emailed the new time. */
  static async rescheduleByBusiness(business, bookingId, access, { date, time, staffId, message }) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    if (booking.groupSessionId) throw new ApiError(httpStatus.CONFLICT, GROUP_MOVE_BLOCK);
    if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
      throw new ApiError(httpStatus.CONFLICT, 'Only upcoming bookings can be rescheduled');
    }
    if (access?.role === 'staff' && staffId && staffId !== access.staffId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only move bookings within your own calendar');
    }
    const row = await moveBooking(business, booking, { date, time, staffId }, 'business');
    emailCustomer(row, business, `Booking rescheduled: ${business.name}`, `${business.name} moved your booking`, [
      ['Was', escapeHtml(fmtWhen(booking))],
      ...(row.staffId !== booking.staffId ? [['Previously with', escapeHtml(booking.staffName)]] : []),
      ...(message ? [['Message', escapeHtml(message)]] : []),
    ]);
    return { booking: serializeBooking(row, { forBusiness: true }) };
  }

  // ── Customer ───────────────────────────────────────────────────────────────

  static async listForCustomer(userId, { tab = 'upcoming' }) {
    const now = new Date();
    const conds = [eq(businessBookings.customerId, userId), ne(businessBookings.status, 'awaiting_payment'), ne(businessBookings.status, 'expired')];
    conds.push(tab === 'past' ? lt(businessBookings.startAt, now) : gte(businessBookings.endAt, now));
    const rows = await db.query.businessBookings.findMany({
      where: and(...conds),
      with: {
        business: {
          columns: {
            id: true,
            slug: true,
            name: true,
            logoUrl: true,
            freeCancellationHours: true,
            lateCancellationRefundPercent: true,
            allowCustomerRescheduling: true,
            reschedulingNoticeDays: true,
          },
        },
        location: LOCATION_COLUMNS,
      },
      orderBy: [tab === 'past' ? desc(businessBookings.startAt) : asc(businessBookings.startAt)],
      limit: 100,
    });
    const reviews = await BusinessReviewService.forBookings(
      rows.filter(b => b.status === 'completed').map(b => b.id)
    );
    return rows.map(b => {
      const review = reviews.get(b.id) ?? null;
      return {
        ...serializeBooking(b),
        business: b.business,
        review,
        canReview: !review && canReviewBooking(b, userId, now),
        canReschedule: !customerRescheduleBlock(b, b.business, now),
      };
    });
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

  /** Free times the customer can move their booking to (same staff member unless they pick another). */
  /** Customer uploads a file before checkout (sent back as attachments: [{ key, name }]). */
  static async uploadAttachment(idOrSlug, user, file) {
    const business = await loadPublicBusiness(idOrSlug);
    if (business.pageType === 'standard') {
      throw new ApiError(httpStatus.CONFLICT, 'This business does not take bookings on Briteside');
    }
    return BusinessAttachmentService.upload(business, user.id, file);
  }

  /** 5-minute link to one of the customer's attachments (business side). */
  static async attachmentUrlForBusiness(business, bookingId, access, index) {
    const booking = await getBookingForBusiness(business, bookingId, access);
    return attachmentLink(booking, index);
  }

  /** …and for the customer who attached it. */
  static async attachmentUrlForCustomer(user, bookingId, index) {
    const booking = await loadCustomerBooking(user, bookingId);
    return attachmentLink(booking, index);
  }

  static async rescheduleSlotsForCustomer(user, bookingId, { date, staffId }) {
    const booking = await loadCustomerBooking(user, bookingId);
    const blocked = customerRescheduleBlock(booking, booking.business);
    if (blocked) throw new ApiError(httpStatus.CONFLICT, blocked);
    return rescheduleSlotsFor(booking.business, booking, { date, staffId });
  }

  /** Customer moves their own booking within the business's rescheduling policy. */
  static async rescheduleByCustomer(user, bookingId, { date, time, staffId }) {
    const booking = await loadCustomerBooking(user, bookingId);
    const business = booking.business;
    const blocked = customerRescheduleBlock(booking, business);
    if (blocked) throw new ApiError(httpStatus.CONFLICT, blocked);
    const row = await moveBooking(business, booking, { date, time, staffId }, 'customer');
    await notifyOwner(
      business,
      'Booking rescheduled',
      `${row.customerName} moved ${row.serviceName} from ${fmtWhen(booking)} to ${fmtWhen(row)}.`,
      row
    );
    return { booking: serializeBooking(row) };
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
          { serviceRefundCents: booking.amountPaidCents, reason: 'request_expired' }
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
