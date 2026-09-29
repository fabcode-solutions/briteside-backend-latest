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
} from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { StripeConnectService, getReserveRate } from './stripeConnect.service.js';
import { StripeSmartCheckoutService } from './stripeSmartCheckout.service.js';

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

      const stripeCustomerId = order.userId
        ? await StripeSmartCheckoutService.getOrCreateCustomer(order.userId).catch(err => {
            console.warn(`[Payment] getOrCreateStripeCustomer failed: ${err.message}`);
            return null;
          })
        : null;

      return await this._createHostedTicketSession(
        order,
        charge,
        successUrl,
        cancelUrl,
        metadata,
        stripeCustomerId
      );
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

  /**
   * POST /payments/smart-checkout-session
   *
   * Identical validation and fee computation to createCheckoutSession(), but
   * if the buyer already has a saved card on file (attached during an
   * earlier purchase anywhere on the platform — the Stripe customer is
   * shared, see StripeSmartCheckoutService), charges it directly and issues
   * the tickets immediately — no redirect, no checkout screen. Falls back
   * to a normal hosted Checkout session whenever there's no saved card yet,
   * Stripe requires additional authentication (SCA), or the order has no
   * authenticated buyer to attach a saved card to (guest checkout).
   */
  static async createSmartCheckoutSession(order, successUrl, cancelUrl, metadata = {}) {
    try {
      this.ensureStripe();
      if (!order || !order.orderItems || order.orderItems.length === 0) {
        throw new ApiError(400, 'Order has no items');
      }
      if (!order.userId) {
        // Guest checkout — nothing to attach a saved card to.
        return await this.createCheckoutSession(order, successUrl, cancelUrl, metadata);
      }

      const charge = await this._computeOrderCharge(order);
      const stripeCustomerId = await StripeSmartCheckoutService.getOrCreateCustomer(order.userId);

      const intentMetadata = {
        type: 'ticket',
        feature: 'ticket',
        orderId: order.id,
        eventId: order.eventId,
        organizerId: charge.eventInfo?.organizerId ?? null,
        eventTitle: charge.eventInfo?.title ?? null,
        eventSlug: charge.eventInfo?.slug ?? null,
        eventDescription: charge.eventInfo?.description ? charge.eventInfo.description.slice(0, 500) : null,
        eventScheduleId: metadata.eventScheduleId ?? null,
      };

      const intent = await StripeSmartCheckoutService.tryOffSessionCharge({
        stripeCustomerId,
        amountCents: charge.totalCents,
        metadata: intentMetadata,
        ...(charge.connectAccount?.chargesEnabled
          ? {
              transferData: { destination: charge.connectAccount.stripeAccountId },
              applicationFeeAmount: charge.platformShareCents + charge.reserveAmountCents,
            }
          : {}),
      });

      if (intent) {
        await db
          .update(orders)
          .set({
            totalAmount: (charge.totalCents / 100).toFixed(2),
            paymentIntentId: intent.id,
            reserveAmountCents: charge.reserveAmountCents,
            platformShareCents: charge.platformShareCents,
            stripeFeeCents: charge.estimatedStripeFeeCents,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        // Reuses the exact ticket-issuance/email/spend-recording logic the
        // webhook path runs — a synthetic "session" carrying just the
        // fields handleCheckoutSession actually reads.
        const { handleCheckoutSession } = await import('../controllers/webhook.controller.js');
        await handleCheckoutSession({
          id: null,
          payment_intent: intent.id,
          amount_total: charge.totalCents,
          customer_details: null,
          metadata: {
            orderId: order.id,
            userId: order.userId,
            holderName: metadata.holderName ?? null,
            holderEmail: metadata.holderEmail ?? null,
            holderPhone: metadata.holderPhone ?? null,
            eventScheduleId: metadata.eventScheduleId ?? null,
          },
        });

        return { instant: true, orderId: order.id };
      }

      const hosted = await this._createHostedTicketSession(
        order,
        charge,
        successUrl,
        cancelUrl,
        metadata,
        stripeCustomerId
      );
      return { instant: false, ...hosted };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to create smart checkout session:', error);
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
        // buyer always sees how many they're buying, 1 included.
        const qtyLabel = groupDealSize
          ? `Qty: ${item.quantity} (${billedQuantity} × group of ${groupDealSize})`
          : `Qty: ${billedQuantity}`;
        const description = productInfo.description
          ? `${qtyLabel} • ${productInfo.description}`
          : qtyLabel;

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
  static async _createHostedTicketSession(order, charge, successUrl, cancelUrl, metadata, stripeCustomerId) {
    const {
      line_items,
      eventInfo,
      connectAccount,
      totalCents,
      platformShareCents,
      reserveAmountCents,
      estimatedStripeFeeCents,
    } = charge;

      const checkoutParams = {
        // No payment_method_types on purpose. Pinning the list opts out of dynamic
        // payment methods, which is what surfaces wallets (Google Pay / Apple Pay)
        // and keeps the offered methods in step with the Dashboard. It also meant a
        // method disabled on the account 400'd the whole session instead of simply
        // not rendering. The Dashboard's enabled list is now the source of truth.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        mode: 'payment',
        line_items,
        success_url:
          successUrl ||
          `${config.apiHost}/payments/success?session_id={CHECKOUT_SESSION_ID}&eventId=${order.eventId}`,
        cancel_url:
          cancelUrl ||
          `${config.apiHost}/payments/failure?error=payment_cancelled&eventId=${order.eventId}`,
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
        // Attaching to the buyer's Stripe customer (rather than a bare
        // customer_email) is what lets Checkout save this card for next
        // time — falls back to customer_email for guest checkout. Stripe
        // rejects an empty string with `email_invalid` but accepts the
        // field being absent, which customerParamsFor already coerces to.
        ...StripeSmartCheckoutService.customerParamsFor(stripeCustomerId, metadata.holderEmail),
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: 'Your purchase for Gokyro events tickets is successful.',
          },
        },
      };

      if (connectAccount?.chargesEnabled || stripeCustomerId) {
        checkoutParams.payment_intent_data = {
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
          // platformShareCents → the merged Platform & Service Fee, kept by
          // Briteside as revenue. reserveAmountCents → 15% of organizer
          // gross, held for disputes, released after window. Stripe's
          // processing cost is NOT included here — Briteside pays it out of
          // its own revenue.
          ...(connectAccount?.chargesEnabled
            ? {
                application_fee_amount: platformShareCents + reserveAmountCents,
                transfer_data: { destination: connectAccount.stripeAccountId },
              }
            : {}),
          // Saves the card the buyer enters to their Stripe customer for a
          // future off-session charge (see createSmartCheckoutSession) —
          // requires `customer` above, which is why this is conditional on
          // stripeCustomerId too.
          ...(stripeCustomerId ? { setup_future_usage: 'off_session' } : {}),
        };
      }

      const session = await stripe.checkout.sessions.create(checkoutParams);

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

      return { url: session.url, sessionId: session.id };
  }
}
