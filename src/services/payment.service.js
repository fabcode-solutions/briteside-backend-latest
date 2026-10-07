import Stripe from 'stripe';
import config from '../config/config.js';
import { db } from '../db/index.js';
import {
  orders,
  orderItems,
  eventTickets,
  eventMerchandise,
  events,
  organizers,
  stripeConnectAccounts,
} from '../db/schema/index.js';
import { and, eq, isNull } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { StripeConnectService, getReserveRate } from './stripeConnect.service.js';

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
} else {
  console.warn('Stripe is not configured. STRIPE_SECRET_KEY missing.');
}

export class PaymentService {
  static ensureStripe() {
    if (!stripe) throw new ApiError(503, 'Payment provider not configured');
  }

  static getPublishableKey() {
    return config.stripe?.publishableKey || null;
  }

  // ── Native PaymentSheet (mobile app) ──────────────────────────────────────
  //
  // The app pays for ticket orders inside the app with Stripe's native
  // PaymentSheet instead of opening hosted Checkout in a browser. Same order,
  // same charge maths (_computeOrderCharge), same Connect split and the same
  // ticket-issuance path (handleCheckoutSession) as hosted/smart checkout —
  // only how the card is collected differs.
  //
  // Ephemeral keys must be minted for the API version the client SDK
  // speaks; @stripe/stripe-react-native accepts this version.
  static PAYMENT_SHEET_EPHEMERAL_KEY_API_VERSION = '2024-06-20';

  /**
   * Creates the PaymentIntent (+ customer/ephemeral key so the sheet can show
   * and save cards) for an already-created ticket order.
   * `order.paymentIntentId` is deliberately left NULL here — it's set
   * atomically when the payment is processed (see processPaymentSheetIntent),
   * which is what guarantees tickets are issued exactly once even though the
   * app's completion call and the webhook race each other.
   */
  static async createTicketPaymentSheet(order, metadata = {}) {
    this.ensureStripe();
    if (!order || !order.orderItems || order.orderItems.length === 0) {
      throw new ApiError(400, 'Order has no items');
    }
    if (!order.userId) throw new ApiError(401, 'Sign in to pay in the app');

    const charge = await this._computeOrderCharge(order);
    const stripeCustomerId = await StripeSmartCheckoutService.getOrCreateCustomer(order.userId);
    const publishableKey = this.getPublishableKey();
    if (!publishableKey) throw new ApiError(503, 'Payment provider not configured');

    const intent = await stripe.paymentIntents.create({
      amount: charge.totalCents,
      currency: 'usd',
      customer: stripeCustomerId,
      // Saves the card for one-tap smart checkout next time.
      setup_future_usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: {
        source: 'payment_sheet',
        type: 'ticket',
        feature: 'ticket',
        orderId: order.id,
        userId: order.userId,
        eventId: order.eventId,
        organizerId: charge.eventInfo?.organizerId ?? null,
        eventTitle: charge.eventInfo?.title ?? null,
        holderName: metadata.holderName ?? null,
        holderEmail: metadata.holderEmail ?? null,
        holderPhone: metadata.holderPhone ?? null,
        eventScheduleId: metadata.eventScheduleId ?? null,
      },
      ...(charge.connectAccount?.chargesEnabled
        ? {
            transfer_data: { destination: charge.connectAccount.stripeAccountId },
            application_fee_amount: charge.platformShareCents + charge.reserveAmountCents,
          }
        : {}),
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: this.PAYMENT_SHEET_EPHEMERAL_KEY_API_VERSION }
    );

    await db
      .update(orders)
      .set({
        totalAmount: (charge.totalCents / 100).toFixed(2),
        reserveAmountCents: charge.reserveAmountCents,
        platformShareCents: charge.platformShareCents,
        stripeFeeCents: charge.estimatedStripeFeeCents,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    return {
      orderId: order.id,
      paymentIntentId: intent.id,
      paymentIntentClientSecret: intent.client_secret,
      customerId: stripeCustomerId,
      ephemeralKey: ephemeralKey.secret,
      // The app must initialise Stripe with THIS key — it has to belong to
      // the same Stripe account as the secret key that created the intent.
      publishableKey,
      amountCents: charge.totalCents,
    };
  }

  /**
   * Issues the tickets for a succeeded PaymentSheet intent. Safe to call from
   * both the app's completion request and the payment_intent.succeeded
   * webhook: the order is claimed with a single conditional UPDATE, so only
   * one caller ever runs ticket issuance.
   * @returns {Promise<{ status: string, orderId: string }>}
   */
  static async processPaymentSheetIntent(paymentIntentOrId, { userId = null } = {}) {
    this.ensureStripe();
    const intent =
      typeof paymentIntentOrId === 'string'
        ? await stripe.paymentIntents.retrieve(paymentIntentOrId)
        : paymentIntentOrId;
    const meta = intent?.metadata ?? {};
    if (meta.source !== 'payment_sheet' || !meta.orderId) {
      throw new ApiError(400, 'Not an in-app ticket payment');
    }
    // App-initiated completion: only the buyer may complete their payment.
    if (userId && meta.userId !== userId) {
      throw new ApiError(403, 'Not authorized for this payment');
    }
    if (intent.status !== 'succeeded') {
      return { status: intent.status, orderId: meta.orderId };
    }

    const claimed = await db
      .update(orders)
      .set({ paymentIntentId: intent.id, updatedAt: new Date() })
      .where(and(eq(orders.id, meta.orderId), isNull(orders.paymentIntentId)))
      .returning({ id: orders.id });

    if (claimed.length > 0) {
      const { handleCheckoutSession } = await import('../controllers/webhook.controller.js');
      await handleCheckoutSession({
        id: null,
        payment_intent: intent.id,
        amount_total: intent.amount_received || intent.amount,
        customer_details: null,
        metadata: {
          orderId: meta.orderId,
          userId: meta.userId ?? null,
          holderName: meta.holderName ?? null,
          holderEmail: meta.holderEmail ?? null,
          holderPhone: meta.holderPhone ?? null,
          eventScheduleId: meta.eventScheduleId ?? null,
        },
      });
    }

    const order = await db.query.orders.findFirst({ where: eq(orders.id, meta.orderId) });
    return { status: order?.status ?? 'pending', orderId: meta.orderId };
  }

  /**
   * Create a Stripe Checkout Session for an order and persist session/payment references
   * @param {object} order - Order object including orderItems
   * @param {string} successUrl - Where to redirect on success
   * @param {string} cancelUrl - Where to redirect on cancel
   */
  static async createCheckoutSession(order, successUrl, cancelUrl, metadata = {}) {
    try {
      this.ensureStripe();
      if (!order || !order.orderItems || order.orderItems.length === 0) {
        throw new ApiError(400, 'Order has no items');
      }

      const charge = await this._computeOrderCharge(order);

      return await this._createHostedTicketSession(order, charge, successUrl, cancelUrl, metadata);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to create checkout session:', error);
      // Stripe names the offending param in `raw.code` (e.g. `email_invalid`), which
      // a bare 500 hides — that cost a server-log dig once already. Append the code
      // only, never `raw.message`: the message embeds the rejected input, which for
      // customer_email means a buyer's address would leak into the API response.
      const stripeCode = error?.raw?.code ? ` (stripe: ${error.raw.code})` : '';
      throw new ApiError(500, `Failed to create checkout session${stripeCode}`);
    }
  }

  // ── Shared fee/line-item computation for both checkout paths ──────────────
  static async _computeOrderCharge(order) {
    // Fetch organizer userId for Connect lookup
      const [eventInfo] = await db
        .select({
          organizerId: events.organizerId,
          title: events.title,
          slug: events.slug,
          description: events.description,
          platformFeePercentage: events.platformFeePercentage,
        })
        .from(events)
        .where(eq(events.id, order.eventId));

      // Resolve organizer's userId for Stripe Connect lookup
      let organizerUserId = null;
      if (eventInfo?.organizerId) {
        const [org] = await db
          .select({ userId: organizers.userId })
          .from(organizers)
          .where(eq(organizers.id, eventInfo.organizerId));
        organizerUserId = org?.userId ?? null;
      }

      let [connectAccount, reserveRate] = await Promise.all([
        organizerUserId ? StripeConnectService.getForUser(organizerUserId) : Promise.resolve(null),
        getReserveRate(),
      ]);
      // Self-heal: chargesEnabled only updates via webhook or the organizer
      // visiting their earnings page — if it's stale-false, re-check Stripe
      // live rather than silently routing this order's full amount to platform.
      if (connectAccount && !connectAccount.chargesEnabled) {
        connectAccount = await StripeConnectService.syncStatus(organizerUserId).catch(
          () => connectAccount
        );
      }

      // Fetch detailed product information for each item
      const line_items = [];

      for (const item of order.orderItems) {
        let productInfo;
        let billedQuantity = item.quantity;
        let groupDealSize = null;

        if (item.itemType === 'ticket') {
          // Fetch ticket tier with sale fields so discount is applied at checkout time
          const [ticketTier] = await db
            .select({
              name: eventTickets.name,
              description: eventTickets.description,
              price: eventTickets.price,
              groupDealSize: eventTickets.groupDealSize,
              isSaleActive: eventTickets.isSaleActive,
              saleDiscountPercent: eventTickets.saleDiscountPercent,
              saleStartDate: eventTickets.saleStartDate,
              saleEndDate: eventTickets.saleEndDate,
            })
            .from(eventTickets)
            .where(eq(eventTickets.id, item.itemId));

          groupDealSize = ticketTier?.groupDealSize
            ? parseInt(ticketTier.groupDealSize, 10)
            : null;

          // Always re-compute effective price at checkout so active discounts are applied
          const rawPrice = parseFloat(ticketTier?.price || item.price);
          let effectivePrice = rawPrice;
          if (ticketTier?.isSaleActive && ticketTier.saleDiscountPercent) {
            const now = new Date();
            const inWindow =
              (!ticketTier.saleStartDate || now >= new Date(ticketTier.saleStartDate)) &&
              (!ticketTier.saleEndDate || now <= new Date(ticketTier.saleEndDate));
            if (inWindow) {
              effectivePrice = parseFloat(
                (rawPrice * (1 - parseFloat(ticketTier.saleDiscountPercent) / 100)).toFixed(2)
              );
            }
          }

          // For group deals: charge per group (avoids per-ticket rounding drift)
          if (groupDealSize) billedQuantity = Math.round(item.quantity / groupDealSize);
          productInfo = {
            name: ticketTier?.name || `Ticket - ${item.itemId}`,
            description: ticketTier?.description || 'Event ticket',
            price: effectivePrice.toFixed(2),
          };
        } else if (item.itemType === 'merchandise') {
          // Fetch merchandise details
          const [merchandise] = await db
            .select({
              name: eventMerchandise.name,
              description: eventMerchandise.description,
              price: eventMerchandise.price,
            })
            .from(eventMerchandise)
            .where(eq(eventMerchandise.id, item.itemId));

          productInfo = {
            name: merchandise?.name || `Merchandise - ${item.itemId}`,
            description: merchandise?.description || 'Event merchandise',
            price: merchandise?.price || item.price,
          };
        } else {
          // Fallback for unknown item types
          productInfo = {
            name: `${item.itemType} - ${item.itemId}`,
            description: `Event ${item.itemType}`,
            price: item.price,
          };
        }

        // Stripe's hosted Checkout only shows its native line-item quantity
        // when it's greater than 1, so a single-ticket purchase would show no
        // count at all. Spell it out in the description ourselves so the
        // buyer always sees how many they're buying, 1 included. The
        // ticket/tier's own description is deliberately left out here — it's
        // organizer-authored copy meant for the listing page, not the
        // checkout receipt.
        const description = groupDealSize
          ? `Qty: ${item.quantity} (${billedQuantity} × group of ${groupDealSize})`
          : `Qty: ${billedQuantity}`;

        line_items.push({
          price_data: {
            currency: 'usd',
            product_data: {
              // Without the event title prefixed here, a buyer paying for
              // e.g. an "Early Bird" tier has no way to tell which event
              // that's actually for.
              name: eventInfo?.title ? `${eventInfo.title} — ${productInfo.name}` : productInfo.name,
              description,
            },
            unit_amount: Math.round(parseFloat(productInfo.price) * 100),
          },
          quantity: billedQuantity,
        });
      }

      // Subtotal = sum of base (fee-exclusive) line items
      const subtotalCents = line_items.reduce(
        (sum, item) => sum + item.price_data.unit_amount * item.quantity,
        0
      );

      // Merged "Platform & Service Fee" — only charged if the organizer set
      // a rate during event setup (platformFeePercentage defaults to 0
      // otherwise, see event.service.js). Uses the organizer's own
      // configured rate, not a fixed percentage — event ticketing has its
      // own payout/reserve model, distinct from the flat 7.5% used for 1:1
      // video, paid messages, and shop. Dollar amount only, no % shown.
      const eventFeeRate = Number(eventInfo?.platformFeePercentage ?? 0) / 100;
      const platformFeeCents = Math.round(subtotalCents * eventFeeRate);
      if (platformFeeCents > 0) {
        line_items.push({
          price_data: {
            currency: 'usd',
            product_data: { name: 'Platform & Service Fee' },
            unit_amount: platformFeeCents,
          },
          quantity: 1,
        });
      }

      // Gross = what Stripe actually collects from the customer
      const totalCents = subtotalCents + platformFeeCents;

      // Briteside keeps the platform fee as revenue
      const platformShareCents = platformFeeCents;

      // Organizer gross = total − Briteside's processing-fee revenue
      const organizerGrossCents = totalCents - platformShareCents;

      // Reserve = 15% of organizer gross (held for disputes, released after window)
      const reserveAmountCents = Math.round(organizerGrossCents * reserveRate);

      // Stripe's actual processing cost is a separate, Briteside-absorbed expense —
      // tracked here as an estimate for reporting only. It is never charged to the
      // organizer via application_fee_amount; the webhook overwrites it with the
      // real balance_transaction.fee once the charge settles.
      const estimatedStripeFeeCents = Math.round(totalCents * 0.029) + 30;

      return {
        line_items,
        eventInfo,
        connectAccount,
        subtotalCents,
        platformFeeCents,
        totalCents,
        platformShareCents,
        organizerGrossCents,
        reserveAmountCents,
        estimatedStripeFeeCents,
      };
  }

  // ── Hosted Stripe Checkout session — shared tail for both entry points ────
  static async _createHostedTicketSession(order, charge, successUrl, cancelUrl, metadata) {
    const {
      line_items,
      eventInfo,
      connectAccount,
      totalCents,
      platformShareCents,
      reserveAmountCents,
      estimatedStripeFeeCents,
    } = charge;

      // Ticket checkout has no native-app consumer of this endpoint at all —
      // the app pays via a wholly separate PaymentSheet flow
      // (createTicketPaymentSheet) — so this can always use embedded
      // checkout rather than branching on platform like the other flows.
      const checkoutParams = {
        // No payment_method_types on purpose. Pinning the list opts out of dynamic
        // payment methods, which is what surfaces wallets (Google Pay / Apple Pay)
        // and keeps the offered methods in step with the Dashboard. It also meant a
        // method disabled on the account 400'd the whole session instead of simply
        // not rendering. The Dashboard's enabled list is now the source of truth.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        mode: 'payment',
        line_items,
        ui_mode: 'embedded',
        return_url:
          successUrl ||
          `${config.apiHost}/payments/success?session_id={CHECKOUT_SESSION_ID}&eventId=${order.eventId}`,
        metadata: {
          type: 'ticket',
          feature: 'ticket',
          orderId: order.id,
          eventId: order.eventId,
          organizerId: eventInfo?.organizerId ?? null,
          userId: order.userId ?? null,
          eventTitle: eventInfo?.title ?? null,
          eventSlug: eventInfo?.slug ?? null,
          eventDescription: eventInfo?.description ? eventInfo.description.slice(0, 500) : null,
          eventScheduleId: metadata.eventScheduleId ?? null,
          ...metadata,
        },
        // Stripe rejects an empty string with `email_invalid` but accepts the field
        // being absent, in which case Checkout collects the address itself. Coerce
        // '' / whitespace / null to undefined so a missing holderEmail can't 400.
        customer_email: metadata.holderEmail?.trim() || undefined,
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: 'Your purchase for Gokyro events tickets is successful.',
          },
        },
      };

      if (connectAccount?.chargesEnabled) {
        // platformShareCents → the merged Platform & Service Fee, kept by Briteside as revenue
        // reserveAmountCents → 15% of organizer gross, held for disputes, released after window
        // Stripe's processing cost is NOT included here — Briteside pays it out of its own revenue.
        checkoutParams.payment_intent_data = {
          application_fee_amount: platformShareCents + reserveAmountCents,
          transfer_data: { destination: connectAccount.stripeAccountId },
          metadata: {
            type: 'ticket',
            feature: 'ticket',
            orderId: order.id,
            eventId: order.eventId,
            organizerId: eventInfo?.organizerId ?? null,
            eventTitle: eventInfo?.title ?? null,
            eventSlug: eventInfo?.slug ?? null,
            eventDescription: eventInfo?.description ? eventInfo.description.slice(0, 500) : null,
            eventScheduleId: metadata.eventScheduleId ?? null,
          },
        };
      }

      let session;
      try {
        session = await stripe.checkout.sessions.create(checkoutParams);
      } catch (err) {
        // The organizer's Connect account reference is stale (e.g. deleted,
        // or left over from a Stripe environment/key switch) — Stripe
        // rejects the payout destination outright. Self-heal so the NEXT
        // attempt short-circuits via the chargesEnabled self-heal above
        // instead of failing the exact same way indefinitely, and surface
        // a clear reason instead of a bare 500.
        if (
          err?.raw?.code === 'resource_missing' &&
          err?.raw?.param?.includes('transfer_data][destination') &&
          connectAccount
        ) {
          await db
            .update(stripeConnectAccounts)
            .set({ chargesEnabled: false, updatedAt: new Date() })
            .where(eq(stripeConnectAccounts.stripeAccountId, connectAccount.stripeAccountId))
            .catch(() => {});
          throw new ApiError(
            503,
            "This event's payment setup needs attention — please try again shortly or contact the organizer."
          );
        }
        throw err;
      }

      // Save session id, payment intent, reserve amount, and gross total to order.
      // stripeFeeCents is saved as an estimate (2.9% + $0.30) now; the webhook
      // overwrites it with the real balance_transaction.fee on payment success.
      await db
        .update(orders)
        .set({
          totalAmount: (totalCents / 100).toFixed(2),
          paymentIntentId: session.payment_intent || session.id,
          reserveAmountCents,
          platformShareCents,
          stripeFeeCents: estimatedStripeFeeCents,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return { clientSecret: session.client_secret, sessionId: session.id };
  }
}