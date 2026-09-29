/**
 * src/services/stripeSmartCheckout.service.js
 *
 * Shared "smart checkout" primitives reused by every payment flow that wants
 * to skip the hosted Stripe Checkout page for a returning payer:
 *
 *   1. The FIRST payment always goes through hosted Checkout, but with
 *      `customer` + `payment_intent_data.setup_future_usage: 'off_session'`
 *      set, so Stripe attaches the card the payer enters to their Stripe
 *      customer (see SubscriptionService.getOrCreateStripeCustomer — one
 *      canonical customer per user, shared across every feature).
 *   2. Every SUBSEQUENT payment can then be charged directly, server-side,
 *      against that saved card — no redirect, no checkout screen — via
 *      tryOffSessionCharge(). Falls back to null (caller redirects to a
 *      normal hosted Checkout session) whenever there's no saved card yet,
 *      or Stripe requires additional authentication (SCA) that only a
 *      hosted page can complete.
 *
 * Deliberately avoids Stripe Elements/Stripe.js on the frontend entirely —
 * the first payment is a plain hosted-Checkout redirect (needs only the
 * secret key, server-side), so this can't hit the publishable-key/account
 * mismatch that blocked an earlier embedded-Elements attempt.
 */

import Stripe from 'stripe';
import config from '../config/config.js';
import { SubscriptionService } from './subscription.service.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

export class StripeSmartCheckoutService {
  /** One Stripe customer per platform user, shared across every feature. */
  static async getOrCreateCustomer(userId) {
    return SubscriptionService.getOrCreateStripeCustomer(userId);
  }

  /** Default payment method on file, else the customer's most recently saved card. */
  static async findReusablePaymentMethod(stripeCustomerId) {
    if (!stripe || !stripeCustomerId) return null;
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted) return null;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (defaultPm) return typeof defaultPm === 'string' ? defaultPm : defaultPm.id;

    const methods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
      limit: 1,
    });
    return methods.data[0]?.id ?? null;
  }

  /**
   * Attempts to charge the customer's saved card directly, off-session.
   * Returns the succeeded PaymentIntent, or `null` if there's no reusable
   * card, or the charge failed/needs authentication — in every `null` case
   * the caller should fall back to creating a normal hosted Checkout session.
   *
   * @param {object} params
   * @param {string} params.stripeCustomerId
   * @param {number} params.amountCents
   * @param {object} params.metadata
   * @param {{ destination: string }} [params.transferData] - direct-to-Connect split, if the flow uses one
   * @param {number} [params.applicationFeeAmount] - required when transferData is set
   */
  static async tryOffSessionCharge({
    stripeCustomerId,
    amountCents,
    metadata,
    transferData,
    applicationFeeAmount,
  }) {
    if (!stripe || !stripeCustomerId) return null;

    const paymentMethodId = await this.findReusablePaymentMethod(stripeCustomerId);
    if (!paymentMethodId) return null;

    try {
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        setup_future_usage: 'off_session',
        metadata,
        ...(transferData ? { transfer_data: transferData } : {}),
        ...(applicationFeeAmount ? { application_fee_amount: applicationFeeAmount } : {}),
      });
      // confirm:true + off_session either succeeds or throws — a
      // non-succeeded status here is unexpected; treat like a failure.
      return intent.status === 'succeeded' ? intent : null;
    } catch (err) {
      // card_declined, authentication_required, etc. — the hosted Checkout
      // page can prompt for 3DS or a different card; this can't.
      console.warn(`[StripeSmartCheckout] Off-session charge failed: ${err.message}`);
      return null;
    }
  }

  /** `{ customer }` or `{ payment_intent_data: { setup_future_usage } }` fragments for a hosted Checkout session. */
  static customerParamsFor(stripeCustomerId, fallbackEmail) {
    return stripeCustomerId
      ? { customer: stripeCustomerId }
      : fallbackEmail?.trim()
        ? { customer_email: fallbackEmail.trim() }
        : {};
  }
}
