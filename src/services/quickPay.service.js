/**
 * Generic "pay a saved card directly, skipping the checkout screen" service.
 * Currently only wired up for priority messages (sourceType 'priority_message'),
 * but kept source-agnostic so a future sourceType just adds a case to
 * _resolveSource/_charge rather than a whole parallel system.
 */

import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { stripeCustomers } from '../db/schema/britesidePlus.js';
import { PriorityMessageService } from './priorityMessage.service.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

const SUPPORTED_SOURCE_TYPES = new Set(['priority_message']);

export class QuickPayService {
  /**
   * GET /payments/saved-card
   * Returns the card Checkout would itself offer to reuse: the customer's
   * default payment method if one is set, else the most recent card tagged
   * allow_redisplay 'always' (how every checkout flow in this codebase
   * actually saves a reusable card — see createCheckout's
   * saved_payment_method_options comment).
   */
  static async getSavedCard(userId) {
    if (!stripe) return null;
    const existing = await db.query.stripeCustomers.findFirst({
      where: eq(stripeCustomers.userId, userId),
    });
    if (!existing) return null;

    try {
      const customer = await stripe.customers.retrieve(existing.stripeCustomerId);
      const defaultPm = customer.invoice_settings?.default_payment_method;
      const defaultPmId = typeof defaultPm === 'string' ? defaultPm : defaultPm?.id;

      let pm = defaultPmId
        ? await stripe.paymentMethods.retrieve(defaultPmId).catch(() => null)
        : null;

      if (!pm || pm.type !== 'card') {
        const methods = await stripe.paymentMethods.list({
          customer: existing.stripeCustomerId,
          type: 'card',
          limit: 5,
        });
        pm = methods.data.find(m => m.allow_redisplay === 'always') ?? null;
      }
      if (!pm?.card) return null;

      return {
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
      };
    } catch (err) {
      console.warn(`[QuickPay] getSavedCard failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Resolves (sourceType, sourceId) into the authoritative amount to charge
   * and whatever the charger needs to deliver it on success. Never trusts
   * the client for pricing — a tampered amountCents in the request can only
   * ever fail the integrity check in quickPay(), never change what's charged.
   */
  static async _resolveSource(userId, sourceType, sourceId) {
    if (sourceType === 'priority_message') {
      const payment = await db.query.priorityMessagePayments.findFirst({
        where: eq(priorityMessagePayments.id, sourceId),
      });
      if (!payment) throw new ApiError(404, 'Payment not found');
      if (payment.senderId !== userId) throw new ApiError(403, 'Forbidden');
      if (payment.status !== 'pending') {
        throw new ApiError(409, 'This payment is no longer pending');
      }
      return { amountCents: payment.amountCents };
    }

    throw new ApiError(400, `Unsupported sourceType: ${sourceType}`);
  }

  /**
   * POST /payments/quick-pay
   * Charges `paymentMethodId` directly for (sourceType, sourceId), off-session.
   * Returns one of:
   *   { success: true, paymentIntentId, requiresAction: false, paymentId }
   *   { success: false, requiresAction: true, clientSecret, paymentId }  — 3DS, fall back to checkout
   *   throws ApiError                                                    — decline/other, surface it
   */
  static async quickPay(
    userId,
    { paymentMethodId, amountCents, sourceType, sourceId, idempotencyKey },
    io = null
  ) {
    if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
      throw new ApiError(400, `Unsupported sourceType: ${sourceType}`);
    }
    if (!paymentMethodId) throw new ApiError(400, '`paymentMethodId` is required');
    if (!sourceId) throw new ApiError(400, '`sourceId` is required');

    const { amountCents: authoritativeAmountCents } = await this._resolveSource(
      userId,
      sourceType,
      sourceId
    );

    // amountCents from the client is purely informational — the charge below
    // always uses the amount resolved server-side above, so a tampered
    // request can never change what's actually charged. A mismatch here is
    // never a reason to block the payment (the frontend's preview can
    // legitimately drift from the live price — e.g. a sessionStorage-cached
    // per-message fee that's since changed, or simple rounding); it's only
    // ever a tell for debugging a stale frontend estimate.
    if (typeof amountCents === 'number' && amountCents !== authoritativeAmountCents) {
      console.warn(
        `[QuickPay] client amountCents (${amountCents}) differs from authoritative amount ` +
          `(${authoritativeAmountCents}) for ${sourceType}:${sourceId} — charging the ` +
          `authoritative amount regardless.`
      );
    }

    if (sourceType === 'priority_message') {
      return PriorityMessageService.chargeExistingPendingPayment(sourceId, userId, {
        paymentMethodId,
        idempotencyKey,
        io,
      });
    }

    // Unreachable given SUPPORTED_SOURCE_TYPES, kept for when a new source
    // type is added to the set above without a matching case here yet.
    throw new ApiError(400, `Unsupported sourceType: ${sourceType}`);
  }
}
