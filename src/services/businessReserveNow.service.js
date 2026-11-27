/**
 * Reserve Now — a $20/month add-on for Food & Dining businesses.
 *
 * The business page gets a "Reserve Now" button that opens the restaurant's own
 * reservation page (OpenTable, Resy, Tock, SevenRooms, Yelp…). Briteside doesn't
 * take the reservation; it only sends the diner there.
 *
 * Billing is its own Stripe subscription (metadata.type = 'business_reserve_now'),
 * separate from BriteSide Plus, on the business's own Stripe customer (its saved
 * cards — Business → Payment Methods). Subscriptions started before businesses had
 * their own customer stay on the owner's personal customer until they end. State lives on the business row (reserveNow* columns) and
 * is synced from:
 *   - the checkout return (confirmCheckout — so the button works right away)
 *   - checkout.session.completed / customer.subscription.updated / .deleted webhooks
 *
 * The link is public only while the subscription is live ('active' / 'past_due' —
 * Stripe retries a failed renewal before cancelling, and the button stays up meanwhile).
 */
import httpStatus from 'http-status';
import Stripe from 'stripe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses, stripeCustomers, userSpends } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { getRedirectUrls, isNativePlatform } from '../utils/redirect-urls.js';
import { getInvoicePaymentIntent } from './subscription.service.js';
import { getOrCreateBusinessCustomer } from './businessAccount.service.js';
import { UserSpendService } from './userSpend.service.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

export const RESERVE_NOW_TYPE = 'business_reserve_now';
export const RESERVE_NOW_PRICE_CENTS = 2000;
/** Business categories that can add Reserve Now. */
export const RESERVE_NOW_CATEGORIES = ['dining'];
const LIVE_STATUSES = ['active', 'past_due'];

/** Stripe subscription status → reserveNowStatus. */
const STATUS_FROM_STRIPE = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'pending',
  incomplete_expired: 'canceled',
  canceled: 'canceled',
  paused: 'canceled',
};

export const isReserveNowLive = b => LIVE_STATUSES.includes(b?.reserveNowStatus);

/** Owner / dashboard view of the add-on. */
export const serializeReserveNow = b => ({
  eligible: RESERVE_NOW_CATEGORIES.includes(b.category),
  status: b.reserveNowStatus ?? null,
  live: isReserveNowLive(b),
  priceCents: RESERVE_NOW_PRICE_CENTS,
  currentPeriodEnd: b.reserveNowPeriodEnd ?? null,
  cancelAtPeriodEnd: !!b.reserveNowCancelAtPeriodEnd,
});

const periodEndOf = sub => {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return end ? new Date(end * 1000) : null;
};

const ensureStripe = () => {
  if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One Stripe Product for every Reserve Now subscription (created on first use). */
const PRODUCT_ID = 'briteside_reserve_now';
let productReady = null;
function ensureProduct() {
  productReady ??= stripe.products.retrieve(PRODUCT_ID).catch(async err => {
    if (err?.code !== 'resource_missing' && err?.statusCode !== 404) throw err;
    return stripe.products
      .create({
        id: PRODUCT_ID,
        name: 'Reserve Now',
        description: 'A "Reserve Now" button on your Briteside page that opens your reservation page',
        metadata: { source: RESERVE_NOW_TYPE },
      })
      .catch(e => {
        // Created by a parallel request in the meantime
        if (e?.code === 'resource_already_exists') return stripe.products.retrieve(PRODUCT_ID);
        throw e;
      });
  });
  // Don't cache a failure
  productReady.catch(() => {
    productReady = null;
  });
  return productReady;
}

/** Shared checks before charging: right category, not already on, has a link. */
function assertCanSubscribe(business, link) {
  if (!RESERVE_NOW_CATEGORIES.includes(business.category)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Reserve Now is available for Food & Dining businesses');
  }
  if (isReserveNowLive(business)) {
    throw new ApiError(httpStatus.CONFLICT, 'Reserve Now is already on for this business');
  }
  if (!link) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Add the link to your reservation page first');
  }
}

/**
 * Reserve Now subscriptions on the business's customer, plus any on the owner's
 * personal customer (where they were created before businesses had their own).
 */
async function subscriptionsFor(business, customer) {
  const legacy = await db.query.stripeCustomers.findFirst({
    where: eq(stripeCustomers.userId, business.ownerId),
    columns: { stripeCustomerId: true },
  });
  const customers = [customer, legacy?.stripeCustomerId].filter((c, i, a) => c && a.indexOf(c) === i);
  const lists = await Promise.all(
    customers.map(c =>
      stripe.subscriptions.list({ customer: c, status: 'all', limit: 20 }).then(r => r.data).catch(() => [])
    )
  );
  return lists.flat();
}

export class BusinessReserveNowService {
  /**
   * Start a $20/mo subscription (hosted Stripe Checkout). The reservation link can be
   * sent along so it's saved first — the button needs somewhere to go.
   */
  static async createCheckout(business, { platform, reservationUrl } = {}) {
    ensureStripe();
    assertCanSubscribe(business, reservationUrl || business.reservationUrl);

    const customer = await getOrCreateBusinessCustomer(business);
    // Webhook delay guard: a subscription for this business may already be running in Stripe
    const running = await subscriptionsFor(business, customer);
    const existing = running.find(
      s =>
        s.metadata?.type === RESERVE_NOW_TYPE &&
        s.metadata?.businessId === business.id &&
        LIVE_STATUSES.includes(STATUS_FROM_STRIPE[s.status])
    );
    if (existing) {
      await this.applySubscription(business.id, existing);
      throw new ApiError(httpStatus.CONFLICT, 'Reserve Now is already on for this business');
    }

    const metadata = { type: RESERVE_NOW_TYPE, businessId: business.id, ownerId: business.ownerId };
    const redirect = getRedirectUrls(
      platform,
      FRONTEND_URL,
      '/business/dashboard?reserveNow=success&session_id={CHECKOUT_SESSION_ID}',
      '/business/dashboard?reserveNow=cancelled'
    );
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: RESERVE_NOW_PRICE_CENTS,
            recurring: { interval: 'month' },
            product_data: {
              name: `Reserve Now — ${business.name}`,
              description: 'A "Reserve Now" button on your Briteside page that opens your reservation page',
            },
          },
          quantity: 1,
        },
      ],
      metadata,
      subscription_data: { metadata, description: `Reserve Now — ${business.name}` },
      success_url: redirect.successUrl,
      cancel_url: redirect.cancelUrl,
    });

    await db
      .update(businesses)
      .set({
        ...(reservationUrl ? { reservationUrl } : {}),
        // Don't overwrite a past subscription's 'canceled' with 'pending' until checkout completes
        ...(business.reserveNowStatus ? {} : { reserveNowStatus: 'pending' }),
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, business.id));

    return { checkoutUrl: session.url, native: isNativePlatform(platform) };
  }

  /**
   * In-app card form, step 1 (web): an unpaid subscription whose first invoice's
   * PaymentIntent the browser confirms with Stripe.js. Returns
   * { paymentId: subscriptionId, clientSecret, intentType: 'payment' }.
   * An earlier unfinished attempt for this business is reused, not duplicated.
   */
  static async createNativeIntent(business, { reservationUrl } = {}) {
    ensureStripe();
    assertCanSubscribe(business, reservationUrl || business.reservationUrl);
    if (reservationUrl && reservationUrl !== business.reservationUrl) {
      await db
        .update(businesses)
        .set({ reservationUrl, updatedAt: new Date() })
        .where(eq(businesses.id, business.id));
    }

    const customer = await getOrCreateBusinessCustomer(business);
    const subs = await subscriptionsFor(business, customer);
    const ours = subs.filter(
      s => s.metadata?.type === RESERVE_NOW_TYPE && s.metadata?.businessId === business.id
    );
    const running = ours.find(s => LIVE_STATUSES.includes(STATUS_FROM_STRIPE[s.status]));
    if (running) {
      // Paid already (webhook not in yet) — catch the row up instead of charging twice
      await this.applySubscription(business.id, running);
      throw new ApiError(httpStatus.CONFLICT, 'Reserve Now is already on for this business');
    }

    const stale = ours.find(s => s.status === 'incomplete');
    if (stale) {
      const pi = await getInvoicePaymentIntent(stale.latest_invoice);
      if (pi?.client_secret) return { paymentId: stale.id, clientSecret: pi.client_secret, intentType: 'payment' };
      await stripe.subscriptions.cancel(stale.id).catch(() => {});
    }

    const product = await ensureProduct();
    const metadata = { type: RESERVE_NOW_TYPE, businessId: business.id, ownerId: business.ownerId };
    const subscription = await stripe.subscriptions.create({
      customer,
      items: [
        {
          price_data: {
            currency: 'usd',
            product: product.id,
            unit_amount: RESERVE_NOW_PRICE_CENTS,
            recurring: { interval: 'month' },
          },
        },
      ],
      description: `Reserve Now — ${business.name}`,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription', payment_method_types: ['card'] },
      expand: ['latest_invoice'],
      metadata,
    });

    // The invoice's PaymentIntent can take a moment to appear
    let pi = await getInvoicePaymentIntent(subscription.latest_invoice?.id);
    for (const wait of [300, 600]) {
      if (pi?.client_secret) break;
      await sleep(wait);
      pi = await getInvoicePaymentIntent(subscription.latest_invoice?.id);
    }
    if (!pi?.client_secret) {
      await stripe.subscriptions.cancel(subscription.id).catch(() => {});
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Couldn’t start the payment. Please try again.');
    }
    return { paymentId: subscription.id, clientSecret: pi.client_secret, intentType: 'payment' };
  }

  /** In-app card form, step 2: verify the first payment with Stripe and turn the button on. */
  static async finalizeNative(business, subscriptionId, paymentIntentId) {
    ensureStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
    if (sub.metadata?.type !== RESERVE_NOW_TYPE || sub.metadata?.businessId !== business.id) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    }
    const pi = await getInvoicePaymentIntent(sub.latest_invoice?.id);
    if (!pi || pi.id !== paymentIntentId || pi.status !== 'succeeded') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'The payment hasn’t gone through yet');
    }
    // Paid invoice → Stripe flips the subscription to active; re-read if this beat it
    const fresh = sub.status === 'incomplete' ? await stripe.subscriptions.retrieve(subscriptionId) : sub;
    await this.applySubscription(business.id, fresh.status === 'incomplete' ? { ...fresh, status: 'active' } : fresh);
    return this.summary(business.id);
  }

  /** Checkout return: activate right away instead of waiting for the webhook. */
  static async confirmCheckout(business, sessionId) {
    ensureStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.metadata?.type !== RESERVE_NOW_TYPE || session.metadata?.businessId !== business.id) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Checkout not found');
    }
    if (session.status === 'complete' && session.subscription && typeof session.subscription === 'object') {
      await this.applySubscription(business.id, session.subscription);
    }
    return this.summary(business.id);
  }

  static async summary(businessId) {
    const b = await db.query.businesses.findFirst({ where: eq(businesses.id, businessId) });
    if (!b) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
    return { reserveNow: serializeReserveNow(b), reservationUrl: b.reservationUrl ?? null };
  }

  /** Turn off at the end of the paid month (the button stays until then). */
  static async cancel(business) {
    return this._setCancelAtPeriodEnd(business, true);
  }

  /** Undo a scheduled cancellation. */
  static async resume(business) {
    return this._setCancelAtPeriodEnd(business, false);
  }

  static async _setCancelAtPeriodEnd(business, cancelAtPeriodEnd) {
    ensureStripe();
    if (!business.reserveNowSubscriptionId || !isReserveNowLive(business)) {
      throw new ApiError(httpStatus.CONFLICT, 'Reserve Now isn’t on for this business');
    }
    const sub = await stripe.subscriptions.update(business.reserveNowSubscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
    await this.applySubscription(business.id, sub);
    return this.summary(business.id);
  }

  /** Business deleted: stop billing now. Never blocks the delete. */
  static async cancelImmediately(business) {
    if (!stripe || !business.reserveNowSubscriptionId || !isReserveNowLive(business)) return;
    try {
      await stripe.subscriptions.cancel(business.reserveNowSubscriptionId);
      await db
        .update(businesses)
        .set({ reserveNowStatus: 'canceled', reserveNowCancelAtPeriodEnd: false, updatedAt: new Date() })
        .where(eq(businesses.id, business.id));
    } catch (err) {
      logger.error(`[ReserveNow] cancel on delete failed for ${business.id}: ${err.message}`);
    }
  }

  /**
   * Mirror a Stripe subscription onto the business. Events for an older subscription
   * never overwrite a newer live one (e.g. resubscribing after a cancellation).
   */
  static async applySubscription(businessId, sub) {
    if (!businessId || !sub?.id) return;
    const business = await db.query.businesses.findFirst({
      where: and(eq(businesses.id, businessId), isNull(businesses.deletedAt)),
    });
    if (!business) return;

    const status = STATUS_FROM_STRIPE[sub.status] ?? 'canceled';
    const isOther = business.reserveNowSubscriptionId && business.reserveNowSubscriptionId !== sub.id;
    if (isOther && isReserveNowLive(business) && !LIVE_STATUSES.includes(status)) return;
    // Two checkouts both completed: keep the first, stop billing the second
    if (isOther && isReserveNowLive(business) && LIVE_STATUSES.includes(status)) {
      logger.warn(`[ReserveNow] duplicate subscription ${sub.id} for business ${businessId} — cancelling it`);
      await stripe?.subscriptions.cancel(sub.id).catch(err =>
        logger.error(`[ReserveNow] could not cancel duplicate ${sub.id}: ${err.message}`)
      );
      return;
    }

    await db
      .update(businesses)
      .set({
        reserveNowStatus: status,
        reserveNowSubscriptionId: sub.id,
        reserveNowPeriodEnd: periodEndOf(sub),
        reserveNowCancelAtPeriodEnd: !!sub.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /** checkout.session.completed with metadata.type = business_reserve_now */
  static async handleCheckoutCompleted(session) {
    if (!stripe || !session.subscription) return;
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    await this.applySubscription(session.metadata?.businessId, sub);
  }

  /** customer.subscription.created / updated / deleted with metadata.type = business_reserve_now */
  static async handleSubscriptionChanged(sub) {
    await this.applySubscription(sub.metadata?.businessId, sub);
  }

  /**
   * invoice.paid for a Reserve Now subscription (first month + renewals): logs the
   * charge in the business's spend log. Once per invoice; never throws.
   */
  static async recordInvoicePaid(invoice, sub) {
    try {
      const businessId = sub?.metadata?.businessId;
      const amountCents = invoice?.amount_paid ?? 0;
      if (!businessId || !invoice?.id || amountCents <= 0) return;
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, businessId),
        columns: { id: true, ownerId: true, name: true },
      });
      if (!business) return;
      const already = await db.query.userSpends.findFirst({
        where: and(
          eq(userSpends.businessId, businessId),
          eq(userSpends.spendType, 'business_reserve_now'),
          sql`${userSpends.metadata}->>'invoiceId' = ${invoice.id}`
        ),
        columns: { id: true },
      });
      if (already) return;
      const paidAtSec = invoice.status_transitions?.paid_at ?? invoice.created;
      await UserSpendService.recordSpend({
        userId: business.ownerId,
        businessId,
        spendType: 'business_reserve_now',
        amountCents,
        referenceId: businessId,
        referenceType: 'business_reserve_now',
        metadata: {
          invoiceId: invoice.id,
          description: 'Reserve Now — monthly',
          businessName: business.name,
          periodEnd: periodEndOf(sub),
        },
        paidAt: paidAtSec ? new Date(paidAtSec * 1000) : new Date(),
      });
    } catch (err) {
      logger.error(`[ReserveNow] spend log for invoice ${invoice?.id} failed: ${err.message}`);
    }
  }
}
