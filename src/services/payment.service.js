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

          const groupDealSize = ticketTier?.groupDealSize
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

        line_items.push({
          price_data: {
            currency: 'usd',
            product_data: {
              // Stripe's hosted Checkout only ever shows the product name/qty
              // for each line item — without the event title prefixed here,
              // a buyer paying for e.g. an "Early Bird" tier has no way to
              // tell which event that's actually for. Quantity itself is
              // shown natively by Stripe whenever it's greater than 1.
              name: eventInfo?.title ? `${eventInfo.title} — ${productInfo.name}` : productInfo.name,
              description: productInfo.description,
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
}
