/**
 * 5% commission the business owes beyond what was withheld online.
 *
 * Full cut (business_bookings.commissionUpfront, all new bookings): the whole 5% of
 * the service price is withheld from the online payment at booking, and it's
 * non-refundable. Something is owed here only when the online payment couldn't
 * cover it: pay-in-person bookings, deposits smaller than the 5%, extras added at
 * the visit, or a refund that took back money the 5% was withheld from.
 * Split (older bookings): 5% of what was paid online is withheld; the 5% of the
 * part paid in person is owed here once the booking completes.
 *
 *   1. Booking closes (completed — by the business or auto-completed 48h after it
 *      ends — or, for full cut, cancelled / no-show / refunded)
 *      → business_commission_charges row (see commissionOwedCents).
 *   2. Collected oldest-first by, in order of preference:
 *        a. deduction from the owner's next business-booking payout
 *           (reserveForPayoutOffset, called from cron/reserveRelease.js)
 *        b. an off-session charge on the owner's saved Plus card, for what was
 *           owed in previous months, on the 1st with retries (chargeSavedCards)
 *        c. the business paying from the dashboard (createPayNowCheckout)
 *   3. Anything still owed after COMMISSION_OVERDUE_DAYS pauses new bookings
 *      for that business (isBookingPaused) until it's paid.
 *
 * Concurrency: every allocation runs under a per-owner advisory lock, and money
 * is "reserved" against charges (collectedCents incremented) BEFORE the Stripe
 * call, then reverted if that call fails — so a payout offset and a card charge
 * can never both collect the same cents.
 */
import httpStatus from 'http-status';
import Stripe from 'stripe';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businesses,
  businessBookings,
  businessCommissionCharges,
  businessCommissionCollections,
  stripeCustomers,
  userSubscriptions,
  users,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { calculateBusinessCommissionCents } from '../utils/orderProcessingFee.js';
import { sendMail } from './mail.service.js';
import { createNotification } from './notification.service.js';
import { emailWrapper, ctaRow, ctaButton, appUrl, infoBox } from '../templates/emailLayout.js';
import { getRedirectUrls, isNativePlatform } from '../utils/redirect-urls.js';
import { businessDefaultCard } from './businessAccount.service.js';
import { UserSpendService } from './userSpend.service.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

/** Owed longer than this → new bookings paused for that business. */
export const COMMISSION_OVERDUE_DAYS = 45;
/** Confirmed bookings untouched this long after they end are completed automatically. */
export const AUTO_COMPLETE_AFTER_HOURS = 48;
/** Card attempts per monthly cycle, and the wait (days) before each retry. */
const CARD_RETRY_WAIT_DAYS = [3, 4];
const MAX_CARD_ATTEMPTS = CARD_RETRY_WAIT_DAYS.length + 1;
/** Stripe's minimum charge; smaller balances roll over to next month. */
const MIN_CARD_CHARGE_CENTS = 50;

const DAY_MS = 86_400_000;
const money = c => `$${(c / 100).toFixed(2)}`;
const remaining = c => c.amountCents - c.collectedCents;
const startOfMonthUtc = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * What the customer paid in person (what the 5% is charged on): the service
 * price not paid online, plus any extras added when the booking was completed.
 */
export function inPersonCents(booking) {
  const total = (booking.servicePriceCents ?? 0) + (booking.extraChargesCents ?? 0);
  return Math.max(0, total - (booking.amountPaidCents ?? 0));
}

/** 5% of the in-person part — shown on the booking, charged once it completes. */
export function inPersonCommissionCents(booking) {
  return calculateBusinessCommissionCents(inPersonCents(booking));
}

/**
 * Full-cut bookings (commissionUpfront): the whole 5% the booking costs the business,
 * by how it ended. Non-refundable — a refund never lowers it.
 *   completed                       → 5% of price + extras
 *   pending / confirmed             → 5% of price (what it will be; used for display)
 *   cancelled / no_show             → 5% of price, if anything was paid online
 *                                     (a pay-in-person booking that never happened owes nothing)
 *   declined / expired / unpaid     → 0 (the business never accepted it; everything is refunded)
 */
export function upfrontCommissionTotalCents(booking) {
  const price = booking.servicePriceCents ?? 0;
  switch (booking.status) {
    case 'completed':
      return calculateBusinessCommissionCents(price + (booking.extraChargesCents ?? 0));
    case 'pending':
    case 'confirmed':
      return calculateBusinessCommissionCents(price);
    case 'cancelled':
    case 'no_show':
      return (booking.amountPaidCents ?? 0) > 0 ? calculateBusinessCommissionCents(price) : 0;
    default:
      return 0;
  }
}

/**
 * Commission the business owes on top of what Briteside withheld from the online payment.
 *   split (older bookings):  5% of the in-person part, once completed
 *   full cut:                the booking's full 5% minus what was withheld (usually 0 — only a
 *                            deposit smaller than the 5%, extras, pay-in-person, or a refund
 *                            that ate into the withheld 5% leave something owed)
 */
export function commissionOwedCents(booking) {
  if (!booking.commissionUpfront) {
    return booking.status === 'completed' ? inPersonCommissionCents(booking) : 0;
  }
  return Math.max(0, upfrontCommissionTotalCents(booking) - (booking.platformCommissionCents ?? 0));
}

const OWED_STATUSES = ['completed', 'cancelled', 'no_show'];

/** Run fn(tx) holding the per-owner commission lock. */
function withOwnerLock(ownerId, fn) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`business-commission:${ownerId}`}))`);
    return fn(tx);
  });
}

/**
 * Apply up to maxCents to the owner's open charges, oldest first.
 * @param {object} filter  { businessId?, createdBefore? }
 * @returns {{ total: number, allocations: {chargeId: string, cents: number}[] }}
 */
async function allocate(tx, ownerId, maxCents, { businessId, createdBefore } = {}) {
  if (maxCents <= 0) return { total: 0, allocations: [] };
  const conds = [eq(businessCommissionCharges.ownerId, ownerId), eq(businessCommissionCharges.status, 'owed')];
  if (businessId) conds.push(eq(businessCommissionCharges.businessId, businessId));
  if (createdBefore) conds.push(lt(businessCommissionCharges.createdAt, createdBefore));
  const open = await tx
    .select()
    .from(businessCommissionCharges)
    .where(and(...conds))
    .orderBy(asc(businessCommissionCharges.createdAt))
    .for('update');

  let left = maxCents;
  const allocations = [];
  for (const charge of open) {
    if (left <= 0) break;
    const cents = Math.min(left, remaining(charge));
    if (cents <= 0) continue;
    const done = charge.collectedCents + cents === charge.amountCents;
    await tx
      .update(businessCommissionCharges)
      .set({
        collectedCents: charge.collectedCents + cents,
        ...(done ? { status: 'collected', collectedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(businessCommissionCharges.id, charge.id));
    allocations.push({ chargeId: charge.id, cents });
    left -= cents;
  }
  return { total: maxCents - left, allocations };
}

/** Undo allocate() — the money it counted didn't actually arrive. */
async function deallocate(tx, allocations) {
  for (const { chargeId, cents } of allocations) {
    await tx
      .update(businessCommissionCharges)
      .set({
        collectedCents: sql`${businessCommissionCharges.collectedCents} - ${cents}`,
        status: 'owed',
        collectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(businessCommissionCharges.id, chargeId));
  }
}

async function ownerContact(ownerId) {
  return db.query.users.findFirst({
    where: eq(users.id, ownerId),
    columns: { id: true, email: true, firstName: true },
  });
}

function emailOwner(owner, subject, headline, rows, cta = 'Open Earnings') {
  if (!owner?.email) return;
  const html = emailWrapper(`
    <h2 style="margin:0 0 12px">${headline}</h2>
    ${infoBox(rows)}
    ${ctaRow(ctaButton(cta, appUrl('/business/dashboard?tab=earnings')))}
  `);
  sendMail(owner.email, subject, html).catch(err =>
    logger.error(`[businessCommission] email to ${owner.id} failed: ${err.message}`)
  );
}

/** The business the owner runs (one per owner), or null. */
async function ownedBusiness(ownerId) {
  return db.query.businesses.findFirst({
    where: and(eq(businesses.ownerId, ownerId), isNull(businesses.deletedAt)),
  });
}

async function notifyOwner(ownerId, title, message) {
  const business = await ownedBusiness(ownerId).catch(() => null);
  return createNotification({
    userId: ownerId,
    title,
    message,
    type: 'business_commission',
    redirectTo: '/business/dashboard?tab=earnings',
    ...(business ? { metadata: { businessId: business.id } } : {}),
  }).catch(err => logger.error(`[businessCommission] notification failed: ${err.message}`));
}

/** A paid commission goes in the business's spend log. Never throws. */
async function recordCommissionSpend(ownerId, collectionId, amountCents, businessId = null) {
  try {
    if (!amountCents || amountCents <= 0) return;
    const id = businessId ?? (await ownedBusiness(ownerId))?.id ?? null;
    if (!id) return;
    await UserSpendService.recordSpend({
      userId: ownerId,
      businessId: id,
      spendType: 'business_commission',
      amountCents,
      referenceId: collectionId,
      referenceType: 'business_commission_collection',
      metadata: { description: '5% commission on bookings paid in person' },
    });
  } catch (err) {
    logger.error(`[businessCommission] spend log failed for ${collectionId}: ${err.message}`);
  }
}

/**
 * The card to charge: the business's own default card (Business → Payment
 * Methods) first, then the owner's personal one.
 */
async function savedCard(ownerId) {
  const business = await ownedBusiness(ownerId).catch(() => null);
  if (business) {
    const card = await businessDefaultCard(business).catch(() => null);
    if (card) return card;
  }
  return personalSavedCard(ownerId);
}

/** The owner's saved card: their Plus subscription's default, else the customer default, else any card. */
async function personalSavedCard(ownerId) {
  const customer = await db.query.stripeCustomers.findFirst({ where: eq(stripeCustomers.userId, ownerId) });
  if (!customer) return null;
  const customerId = customer.stripeCustomerId;
  const pmId = pm => (typeof pm === 'string' ? pm : pm?.id) ?? null;

  const sub = await db.query.userSubscriptions.findFirst({
    where: and(
      eq(userSubscriptions.userId, ownerId),
      inArray(userSubscriptions.status, ['active', 'trialing', 'past_due'])
    ),
    orderBy: [desc(userSubscriptions.createdAt)],
  });
  let paymentMethod = null;
  if (sub?.stripeSubscriptionId) {
    const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId).catch(() => null);
    paymentMethod = pmId(s?.default_payment_method);
  }
  if (!paymentMethod) {
    const c = await stripe.customers.retrieve(customerId).catch(() => null);
    paymentMethod = pmId(c?.invoice_settings?.default_payment_method);
  }
  if (!paymentMethod) {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 }).catch(() => null);
    paymentMethod = list?.data?.[0]?.id ?? null;
  }
  return paymentMethod ? { customerId, paymentMethod } : null;
}

export class BusinessCommissionService {
  // ── Creating what's owed ───────────────────────────────────────────────────

  /**
   * Call whenever a booking closes (completed / no-show / cancelled) or is refunded.
   * Split bookings: records the in-person 5% once completed (unchanged behaviour).
   * Full-cut bookings: sets the booking's charge to what's still owed. Idempotent
   * (one charge per booking); the amount only ever goes up to match, never below
   * what was already collected, and a waived charge stays waived.
   */
  static async syncForBooking(booking, business) {
    if (!booking.commissionUpfront) {
      return booking.status === 'completed' ? this.recordForCompletedBooking(booking, business) : null;
    }
    if (!OWED_STATUSES.includes(booking.status)) return null;
    const amount = commissionOwedCents(booking);
    if (amount <= 0) return null;
    const base = inPersonCents(booking);
    const c = businessCommissionCharges;
    const [row] = await db
      .insert(c)
      .values({
        businessId: booking.businessId,
        ownerId: business.ownerId,
        bookingId: booking.id,
        inPersonCents: base,
        amountCents: amount,
      })
      .onConflictDoUpdate({
        target: c.bookingId,
        set: {
          amountCents: sql`greatest(${amount}, ${c.collectedCents})`,
          inPersonCents: base,
          status: sql`case when ${c.status} = 'waived' then 'waived' when ${amount} > ${c.collectedCents} then 'owed' else 'collected' end`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row ?? null;
  }

  /** Split bookings: call when a booking becomes 'completed'. Idempotent (one charge per booking). */
  static async recordForCompletedBooking(booking, business) {
    const base = inPersonCents(booking);
    const amount = calculateBusinessCommissionCents(base);
    if (amount <= 0) return null;
    const [row] = await db
      .insert(businessCommissionCharges)
      .values({
        businessId: booking.businessId,
        ownerId: business.ownerId,
        bookingId: booking.id,
        inPersonCents: base,
        amountCents: amount,
      })
      .onConflictDoNothing({ target: businessCommissionCharges.bookingId })
      .returning();
    return row ?? null;
  }

  /**
   * Safety net for the cron: closed bookings that owe commission but have no
   * charge yet (e.g. recording failed when they were completed / refunded).
   */
  static async backfillMissingCharges(limit = 200) {
    const b = businessBookings;
    const rows = await db
      .select({ booking: b, ownerId: businesses.ownerId })
      .from(b)
      .innerJoin(businesses, eq(businesses.id, b.businessId))
      .leftJoin(businessCommissionCharges, eq(businessCommissionCharges.bookingId, b.id))
      .where(
        and(
          isNull(businessCommissionCharges.id),
          or(
            // split: completed with an in-person part
            and(
              eq(b.commissionUpfront, false),
              eq(b.status, 'completed'),
              sql`${b.servicePriceCents} + ${b.extraChargesCents} > ${b.amountPaidCents}`
            ),
            // full cut: the booking's 5% is more than what was withheld online
            and(
              eq(b.commissionUpfront, true),
              eq(b.status, 'completed'),
              sql`round((${b.servicePriceCents} + ${b.extraChargesCents}) * 0.05) > ${b.platformCommissionCents}`
            ),
            and(
              eq(b.commissionUpfront, true),
              inArray(b.status, ['cancelled', 'no_show']),
              sql`${b.amountPaidCents} > 0`,
              sql`round(${b.servicePriceCents} * 0.05) > ${b.platformCommissionCents}`
            )
          )
        )
      )
      .limit(limit);
    let created = 0;
    for (const { booking, ownerId } of rows) {
      if (await this.syncForBooking(booking, { ownerId })) created++;
    }
    return { created };
  }

  // ── Collection 1: deduct from a payout ─────────────────────────────────────

  /**
   * Before a business-booking payout transfer of `payoutCents` to the owner,
   * take what they owe out of it. Returns the cents withheld (0 if nothing owed)
   * and a collectionId to pass to revertPayoutOffset if the transfer then fails.
   */
  static async reserveForPayoutOffset(ownerId, payoutCents, sourceBookingId) {
    return withOwnerLock(ownerId, async tx => {
      const { total, allocations } = await allocate(tx, ownerId, payoutCents);
      if (!total) return { cents: 0, collectionId: null };
      const [collection] = await tx
        .insert(businessCommissionCollections)
        .values({
          ownerId,
          method: 'payout_offset',
          status: 'succeeded',
          amountCents: total,
          allocations,
          sourceBookingId,
        })
        .returning({ id: businessCommissionCollections.id });
      return { cents: total, collectionId: collection.id };
    });
  }

  /** The payout transfer failed — the withheld commission is owed again. */
  static async revertPayoutOffset(collectionId) {
    if (!collectionId) return;
    const collection = await db.query.businessCommissionCollections.findFirst({
      where: eq(businessCommissionCollections.id, collectionId),
    });
    if (!collection || collection.status !== 'succeeded') return;
    await withOwnerLock(collection.ownerId, async tx => {
      await deallocate(tx, collection.allocations);
      await tx
        .update(businessCommissionCollections)
        .set({ status: 'reverted', failureMessage: 'Payout transfer failed' })
        .where(eq(businessCommissionCollections.id, collectionId));
    });
  }

  // ── Collection 2: saved card, monthly ──────────────────────────────────────

  /**
   * Daily job. For each owner who still owes commission from previous months,
   * charge their saved card — first attempt on/after the 1st, then retries
   * 3 and 4 days apart (3 attempts per month at most).
   */
  static async chargeSavedCards({ now = new Date() } = {}) {
    if (!stripe) return { charged: 0, failed: 0, skipped: 0, reason: 'stripe_not_configured' };
    const monthStart = startOfMonthUtc(now);

    const owners = await db
      .select({
        ownerId: businessCommissionCharges.ownerId,
        owed: sql`sum(${businessCommissionCharges.amountCents} - ${businessCommissionCharges.collectedCents})`.mapWith(Number),
      })
      .from(businessCommissionCharges)
      .where(and(eq(businessCommissionCharges.status, 'owed'), lt(businessCommissionCharges.createdAt, monthStart)))
      .groupBy(businessCommissionCharges.ownerId);

    let charged = 0;
    let failed = 0;
    let skipped = 0;
    for (const { ownerId, owed } of owners) {
      if (owed < MIN_CARD_CHARGE_CENTS) {
        skipped++;
        continue;
      }
      const attempts = await db
        .select({ createdAt: businessCommissionCollections.createdAt })
        .from(businessCommissionCollections)
        .where(
          and(
            eq(businessCommissionCollections.ownerId, ownerId),
            eq(businessCommissionCollections.method, 'card'),
            inArray(businessCommissionCollections.status, ['failed', 'processing']),
            gte(businessCommissionCollections.createdAt, monthStart)
          )
        )
        .orderBy(desc(businessCommissionCollections.createdAt));
      if (attempts.length >= MAX_CARD_ATTEMPTS) {
        skipped++;
        continue;
      }
      if (attempts.length) {
        const wait = CARD_RETRY_WAIT_DAYS[attempts.length - 1] * DAY_MS;
        if (now.getTime() - new Date(attempts[0].createdAt).getTime() < wait) {
          skipped++;
          continue;
        }
      }
      try {
        const ok = await this.chargeOwnerCard(ownerId, { createdBefore: monthStart, attempt: attempts.length + 1 });
        if (ok === null) skipped++;
        else if (ok) charged++;
        else failed++;
      } catch (err) {
        failed++;
        logger.error(`[businessCommission] card charge crashed for ${ownerId}: ${err.message}`);
      }
    }
    return { charged, failed, skipped, owners: owners.length };
  }

  /** @returns true charged, false failed, null nothing to charge */
  static async chargeOwnerCard(ownerId, { createdBefore, attempt = 1 } = {}) {
    // Reserve what we're about to charge so a payout offset can't take it too
    const reserved = await withOwnerLock(ownerId, async tx => {
      const owedRows = await tx
        .select({ owed: sql`coalesce(sum(${businessCommissionCharges.amountCents} - ${businessCommissionCharges.collectedCents}), 0)`.mapWith(Number) })
        .from(businessCommissionCharges)
        .where(
          and(
            eq(businessCommissionCharges.ownerId, ownerId),
            eq(businessCommissionCharges.status, 'owed'),
            ...(createdBefore ? [lt(businessCommissionCharges.createdAt, createdBefore)] : [])
          )
        );
      const owed = owedRows[0]?.owed ?? 0;
      if (owed < MIN_CARD_CHARGE_CENTS) return null;
      const { total, allocations } = await allocate(tx, ownerId, owed, { createdBefore });
      const [collection] = await tx
        .insert(businessCommissionCollections)
        .values({ ownerId, method: 'card', status: 'processing', amountCents: total, allocations })
        .returning();
      return collection;
    });
    if (!reserved) return null;

    const owner = await ownerContact(ownerId);
    const fail = async message => {
      await withOwnerLock(ownerId, async tx => {
        await deallocate(tx, reserved.allocations);
        await tx
          .update(businessCommissionCollections)
          .set({ status: 'failed', failureMessage: message?.slice(0, 500) ?? 'Card charge failed' })
          .where(eq(businessCommissionCollections.id, reserved.id));
      });
      const last = attempt >= MAX_CARD_ATTEMPTS;
      emailOwner(
        owner,
        'Action needed: we couldn’t charge your Briteside commission',
        'We couldn’t charge your card',
        [
          ['Amount', money(reserved.amountCents)],
          ['For', '5% commission on bookings your customers paid in person'],
          ['Reason', message || 'The card was declined'],
          [
            'Next step',
            last
              ? `Pay it from your business dashboard. Bookings are paused if it’s still unpaid ${COMMISSION_OVERDUE_DAYS} days after the appointment.`
              : 'We’ll try again in a few days. You can also pay it now from your business dashboard.',
          ],
        ],
        'Pay now'
      );
      notifyOwner(ownerId, 'Commission payment failed', `We couldn’t charge ${money(reserved.amountCents)} for your in-person booking commission. Pay it from your dashboard.`);
      return false;
    };

    const card = await savedCard(ownerId).catch(() => null);
    if (!card) return fail('No saved card on your account');

    let intent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: reserved.amountCents,
          currency: 'usd',
          customer: card.customerId,
          payment_method: card.paymentMethod,
          off_session: true,
          confirm: true,
          description: 'Briteside commission (5%) on bookings paid in person',
          statement_descriptor_suffix: 'COMMISSION',
          metadata: { type: 'business_commission', ownerId, collectionId: reserved.id },
        },
        { idempotencyKey: `business-commission-card-${reserved.id}` }
      );
    } catch (err) {
      return fail(err?.raw?.message || err.message);
    }
    if (intent.status !== 'succeeded') {
      await stripe.paymentIntents.cancel(intent.id).catch(() => {});
      return fail(intent.status === 'requires_action' ? 'Your bank asked for extra verification' : `Payment ${intent.status}`);
    }

    await db
      .update(businessCommissionCollections)
      .set({ status: 'succeeded', stripePaymentIntentId: intent.id })
      .where(eq(businessCommissionCollections.id, reserved.id));
    await recordCommissionSpend(ownerId, reserved.id, reserved.amountCents);
    emailOwner(owner, 'Your Briteside commission receipt', 'Commission paid', [
      ['Amount', money(reserved.amountCents)],
      ['For', `5% commission on ${reserved.allocations.length} booking(s) your customers paid in person`],
      ['Charged to', 'Your saved card'],
    ]);
    return true;
  }

  // ── Collection 3: the business pays now ────────────────────────────────────

  static async createPayNowCheckout(business, user, platform, mode) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const owedRows = await db
      .select({ owed: sql`coalesce(sum(${businessCommissionCharges.amountCents} - ${businessCommissionCharges.collectedCents}), 0)`.mapWith(Number) })
      .from(businessCommissionCharges)
      .where(and(eq(businessCommissionCharges.businessId, business.id), eq(businessCommissionCharges.status, 'owed')));
    const owed = owedRows[0]?.owed ?? 0;
    if (owed < MIN_CARD_CHARGE_CENTS) {
      throw new ApiError(httpStatus.CONFLICT, owed > 0 ? 'The amount owed is below the $0.50 minimum — it will be added to your next payment' : 'Nothing is owed right now');
    }

    const [collection] = await db
      .insert(businessCommissionCollections)
      .values({ ownerId: business.ownerId, method: 'checkout', status: 'processing', amountCents: owed })
      .returning();
    // In-app card form: charged via createNativeIntent → finalizeNative
    if (mode === 'native') return { amountCents: owed, paymentId: collection.id };

    const metadata = {
      type: 'business_commission',
      businessId: business.id,
      ownerId: business.ownerId,
      collectionId: collection.id,
    };
    const native = isNativePlatform(platform);
    const redirect = getRedirectUrls(
      platform,
      FRONTEND_URL,
      '/business/dashboard?tab=earnings&commission=paid',
      '/business/dashboard?tab=earnings'
    );
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      ...(native
        ? { success_url: redirect.successUrl, cancel_url: redirect.cancelUrl }
        : {
            ui_mode: 'embedded',
            return_url: `${FRONTEND_URL}/business/dashboard?tab=earnings&commission=paid`,
          }),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: owed,
            product_data: {
              name: `Briteside commission — ${business.name}`,
              description: '5% on bookings your customers paid in person',
            },
          },
          quantity: 1,
        },
      ],
      customer_email: user.email,
      metadata,
      payment_intent_data: { metadata, description: `Briteside commission — ${business.name}` },
    });
    await db
      .update(businessCommissionCollections)
      .set({ stripeSessionId: session.id })
      .where(eq(businessCommissionCollections.id, collection.id));
    return {
      amountCents: owed,
      ...(native ? { checkoutUrl: session.url } : { clientSecret: session.client_secret }),
    };
  }

  /** In-app card form, step 2: a PaymentIntent for what this business owes right now. */
  static async createNativeIntent(business, collectionId, user) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const collection = await db.query.businessCommissionCollections.findFirst({
      where: and(
        eq(businessCommissionCollections.id, collectionId),
        eq(businessCommissionCollections.ownerId, business.ownerId),
        eq(businessCommissionCollections.method, 'checkout')
      ),
    });
    if (!collection || collection.status !== 'processing') {
      throw new ApiError(httpStatus.CONFLICT, 'This payment is no longer open. Start again from Earnings.');
    }
    // Re-read: a payout may have covered some of it since the form opened
    const [{ owed }] = await db
      .select({ owed: sql`coalesce(sum(${businessCommissionCharges.amountCents} - ${businessCommissionCharges.collectedCents}), 0)`.mapWith(Number) })
      .from(businessCommissionCharges)
      .where(and(eq(businessCommissionCharges.businessId, business.id), eq(businessCommissionCharges.status, 'owed')));
    if (owed < MIN_CARD_CHARGE_CENTS) throw new ApiError(httpStatus.CONFLICT, 'Nothing is owed right now');

    const metadata = {
      type: 'business_commission',
      native: '1',
      businessId: business.id,
      ownerId: business.ownerId,
      collectionId,
    };
    const intent = await stripe.paymentIntents.create({
      payment_method_types: ['card'],
      amount: owed,
      currency: 'usd',
      ...(user?.email ? { receipt_email: user.email } : {}),
      description: `Briteside commission — ${business.name}`,
      metadata,
    });
    await db
      .update(businessCommissionCollections)
      .set({ amountCents: owed, stripePaymentIntentId: intent.id })
      .where(eq(businessCommissionCollections.id, collectionId));
    return { clientSecret: intent.client_secret, paymentId: collectionId };
  }

  /** In-app card form, step 3 (also reached via the payment_intent.succeeded webhook). */
  static async finalizeNative(business, collectionId, paymentIntentId) {
    if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.metadata?.collectionId !== collectionId || intent.metadata?.businessId !== business.id) {
      throw new ApiError(httpStatus.CONFLICT, 'Payment does not match this commission');
    }
    if (intent.status !== 'succeeded') {
      throw new ApiError(httpStatus.CONFLICT, `Payment is not completed yet (status: ${intent.status})`);
    }
    await this.handleIntentSucceeded(intent);
    return this.summaryForBusiness(business);
  }

  /** payment_intent.succeeded for an in-app commission payment. */
  static handleIntentSucceeded(intent) {
    return this.handleCheckoutCompleted({
      id: null,
      payment_status: 'paid',
      amount_total: intent.amount_received || intent.amount,
      payment_intent: intent.id,
      metadata: intent.metadata,
    });
  }

  /** checkout.session.completed with metadata.type = business_commission */
  static async handleCheckoutCompleted(session) {
    const { collectionId, businessId, ownerId } = session.metadata ?? {};
    if (!collectionId || !ownerId) return;
    if (session.payment_status !== 'paid') return;
    const paid = session.amount_total ?? 0;

    const result = await withOwnerLock(ownerId, async tx => {
      const [collection] = await tx
        .select()
        .from(businessCommissionCollections)
        .where(eq(businessCommissionCollections.id, collectionId))
        .for('update');
      if (!collection || collection.status === 'succeeded') return null; // duplicate webhook
      const { total, allocations } = await allocate(tx, ownerId, paid, { businessId });
      await tx
        .update(businessCommissionCollections)
        .set({
          status: 'succeeded',
          amountCents: total,
          allocations,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
        })
        .where(eq(businessCommissionCollections.id, collectionId));
      return { total };
    });
    if (!result) return;
    await recordCommissionSpend(ownerId, collectionId, result.total, businessId || null);

    // Something else (a payout deduction) covered part of it meanwhile — give that back
    const excess = paid - result.total;
    if (excess > 0 && session.payment_intent) {
      await stripe.refunds
        .create({ payment_intent: session.payment_intent, amount: excess, metadata: { reason: 'commission_overpaid', collectionId } })
        .catch(err => logger.error(`[businessCommission] overpayment refund failed ${collectionId}: ${err.message}`));
    }
    const owner = await ownerContact(ownerId);
    emailOwner(owner, 'Your Briteside commission receipt', 'Commission paid', [
      ['Amount', money(result.total)],
      ['For', '5% commission on bookings your customers paid in person'],
      ...(excess > 0 ? [['Refunded', `${money(excess)} (already collected from a payout)`]] : []),
    ]);
  }

  /** checkout.session.expired with metadata.type = business_commission */
  static async handleCheckoutExpired(session) {
    const { collectionId } = session.metadata ?? {};
    if (!collectionId) return;
    await db
      .update(businessCommissionCollections)
      .set({ status: 'failed', failureMessage: 'Checkout not completed' })
      .where(and(eq(businessCommissionCollections.id, collectionId), eq(businessCommissionCollections.status, 'processing')));
  }

  // ── Enforcement & dashboard ────────────────────────────────────────────────

  /** New bookings are paused while any commission is overdue for this business. */
  static async isBookingPaused(businessId) {
    const cutoff = new Date(Date.now() - COMMISSION_OVERDUE_DAYS * DAY_MS);
    const row = await db.query.businessCommissionCharges.findFirst({
      where: and(
        eq(businessCommissionCharges.businessId, businessId),
        eq(businessCommissionCharges.status, 'owed'),
        lte(businessCommissionCharges.createdAt, cutoff)
      ),
      columns: { id: true },
    });
    return !!row;
  }

  /** Earnings tab: what's owed, what was collected and how. */
  static async summaryForBusiness(business, { limit = 100 } = {}) {
    const charges = await db.query.businessCommissionCharges.findMany({
      where: eq(businessCommissionCharges.businessId, business.id),
      with: {
        booking: { columns: { id: true, serviceName: true, customerName: true, startAt: true, servicePriceCents: true, paymentModel: true } },
      },
      orderBy: [desc(businessCommissionCharges.createdAt)],
      limit,
    });
    const [totals] = await db
      .select({
        owedCents: sql`coalesce(sum(${businessCommissionCharges.amountCents} - ${businessCommissionCharges.collectedCents}) filter (where ${businessCommissionCharges.status} = 'owed'), 0)`.mapWith(Number),
        collectedCents: sql`coalesce(sum(${businessCommissionCharges.collectedCents}), 0)`.mapWith(Number),
        totalCents: sql`coalesce(sum(${businessCommissionCharges.amountCents}) filter (where ${businessCommissionCharges.status} <> 'waived'), 0)`.mapWith(Number),
        oldestOwedAt: sql`min(${businessCommissionCharges.createdAt}) filter (where ${businessCommissionCharges.status} = 'owed')`,
      })
      .from(businessCommissionCharges)
      .where(eq(businessCommissionCharges.businessId, business.id));

    // Which charges each collection paid — attach the method to each charge
    const chargeIds = new Set(charges.map(c => c.id));
    const collections = chargeIds.size
      ? await db.query.businessCommissionCollections.findMany({
          where: and(
            eq(businessCommissionCollections.ownerId, business.ownerId),
            eq(businessCommissionCollections.status, 'succeeded')
          ),
          orderBy: [desc(businessCommissionCollections.createdAt)],
          limit: 500,
        })
      : [];
    const paidBy = new Map();
    for (const col of collections) {
      for (const a of col.allocations ?? []) {
        if (!chargeIds.has(a.chargeId)) continue;
        const list = paidBy.get(a.chargeId) ?? [];
        list.push({ method: col.method, cents: a.cents, at: col.createdAt });
        paidBy.set(a.chargeId, list);
      }
    }

    const oldest = totals.oldestOwedAt ? new Date(totals.oldestOwedAt) : null;
    const now = new Date();
    const nextCardCharge = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return {
      rate: 0.05,
      owedCents: totals.owedCents,
      collectedCents: totals.collectedCents,
      totalCents: totals.totalCents,
      overdueDays: COMMISSION_OVERDUE_DAYS,
      oldestOwedAt: oldest,
      pausesBookingsAt: oldest ? new Date(oldest.getTime() + COMMISSION_OVERDUE_DAYS * DAY_MS) : null,
      bookingsPaused: oldest ? now.getTime() - oldest.getTime() >= COMMISSION_OVERDUE_DAYS * DAY_MS : false,
      nextCardChargeAt: nextCardCharge,
      charges: charges.map(c => ({
        id: c.id,
        bookingId: c.bookingId,
        serviceName: c.booking?.serviceName ?? null,
        customerName: c.booking?.customerName ?? null,
        appointmentAt: c.booking?.startAt ?? null,
        servicePriceCents: c.booking?.servicePriceCents ?? null,
        paymentModel: c.booking?.paymentModel ?? null,
        inPersonCents: c.inPersonCents,
        amountCents: c.amountCents,
        collectedCents: c.collectedCents,
        status: c.status,
        createdAt: c.createdAt,
        collectedAt: c.collectedAt,
        paidBy: paidBy.get(c.id) ?? [],
      })),
    };
  }
}
