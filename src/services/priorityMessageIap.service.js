/**
 * src/services/priorityMessageIap.service.js
 *
 * "Pay in App" for priority messages — the native App Store / Google Play
 * purchase sheet instead of Stripe Checkout. Mirrors ShopIapService (and
 * reuses its store verification), with one key difference:
 *
 * A shop product has ONE fixed price, so it's registered with the stores as
 * its own item. A priority-message checkout is priced per request (message +
 * extension units × the talent's fee, attachments, service fee), and the
 * stores only sell pre-registered prices — so this uses the shared
 * CONSUMABLE price tiers (iapTiers.js, created on both stores automatically
 * by IapCatalogService). A checkout is charged the smallest tier ≥ its web
 * total × 1.3 (the 30% in-app markup covering Apple's/Google's commission).
 *
 * Flow:
 *   1. prepare()  — same validation/pricing/persistence as the Stripe flow
 *                   (PriorityMessageService._createPendingPayment), then picks
 *                   the tier. Returns { paymentId, iapProductId }.
 *   2. The App opens the native sheet for iapProductId.
 *   3. finalize() — verifies the purchase server-to-server, records it on the
 *                   payment row, then delivers exactly like the Stripe webhook
 *                   (PriorityMessageService._deliverPaidPayment).
 *
 * Money notes — IAP money is collected by Apple/Google, never Stripe:
 *   - The talent's cut is NOT reserved for the Stripe Connect release cron
 *     (reserveAmountCents 0, same as shop IAP). Paying talents for IAP sales
 *     needs a separate settlement process this doesn't build.
 *   - The 72h no-reply auto-refund only refunds through Stripe, so it skips
 *     IAP payments (no stripePaymentIntent). Apple/Google refunds are
 *     requested by the buyer through the store.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { priorityMessagePayments } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import { PriorityMessageService } from './priorityMessage.service.js';
import { ShopIapService } from './shop/shopIap.service.js';
import {
  getTierConfig,
  productIdForTier,
  tierForProductId,
  tierForWebChargedCents,
} from './iapTiers.js';

export class PriorityMessageIapService {
  /** The App's source of truth for tiers (shared with the shop — iapTiers.js). */
  static getTierConfig() {
    return getTierConfig();
  }

  static productIdForTier(tierCents) {
    return productIdForTier(tierCents);
  }

  static tierForProductId(iapProductId) {
    return tierForProductId(iapProductId);
  }

  /** Smallest tier covering the web total + app markup, or null if the total
   * is above the largest tier (the App then offers Pay on Web only). */
  static tierForWebChargedCents(webChargedCents) {
    return tierForWebChargedCents(webChargedCents);
  }

  static async prepare(senderId, input) {
    const { payment, chargedCents } = await PriorityMessageService._createPendingPayment(
      senderId,
      input
    );

    const tierCents = this.tierForWebChargedCents(chargedCents);
    if (!tierCents) {
      // Nothing was charged — void the draft so it can't be finalized later.
      await db
        .update(priorityMessagePayments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(priorityMessagePayments.id, payment.id));
      throw new ApiError(
        400,
        'This message is too large to pay for in the app. Please use Pay on Web.'
      );
    }

    const iapProductId = this.productIdForTier(tierCents);
    await db
      .update(priorityMessagePayments)
      .set({ iapProductId, updatedAt: new Date() })
      .where(eq(priorityMessagePayments.id, payment.id));

    return {
      paymentId: payment.id,
      iapProductId,
      appChargedCents: tierCents,
      webChargedCents: chargedCents,
    };
  }

  static async finalize(
    senderId,
    paymentId,
    store,
    { transactionId, purchaseToken, testOnly = false } = {},
    io = null
  ) {
    const payment = await db.query.priorityMessagePayments.findFirst({
      where: eq(priorityMessagePayments.id, paymentId),
    });
    if (!payment) throw new ApiError(404, 'Payment not found');
    if (payment.senderId !== senderId) throw new ApiError(403, 'Forbidden');
    if (payment.status !== 'pending') {
      throw new ApiError(409, 'This payment has already been processed');
    }
    if (!payment.iapProductId) {
      throw new ApiError(400, 'This payment was not prepared for in-app purchase');
    }

    let verifiedTransactionId;
    let googleOrderId = null;
    if (store === 'apple') {
      if (!transactionId) throw new ApiError(400, '`transactionId` is required');
      const decoded = await ShopIapService.verifyAppleTransaction(transactionId);
      if (decoded.productId !== payment.iapProductId) {
        throw new ApiError(400, "This transaction doesn't match this payment");
      }
      verifiedTransactionId = decoded.transactionId;
    } else if (store === 'google') {
      if (!purchaseToken) throw new ApiError(400, '`purchaseToken` is required');
      // Throws unless purchaseState is "purchased" for exactly this product.
      const googlePurchase = await ShopIapService.verifyGooglePurchase(
        purchaseToken,
        payment.iapProductId
      );
      await ShopIapService.rejectRealMoneyGooglePurchase(googlePurchase, testOnly);
      verifiedTransactionId = purchaseToken;
      googleOrderId = googlePurchase.orderId ?? null;
    } else {
      throw new ApiError(400, '`store` must be "apple" or "google"');
    }

    // What the sender actually paid is the tier price, not the web total —
    // recorded before delivery so spend/"Total spent" reflect it.
    const tierCents = this.tierForProductId(payment.iapProductId);
    try {
      await db
        .update(priorityMessagePayments)
        .set({
          purchaseChannel: store === 'apple' ? 'apple_iap' : 'google_iap',
          iapTransactionId: verifiedTransactionId,
          iapOrderId: googleOrderId,
          iapVerifiedAt: new Date(),
          ...(tierCents ? { amountCents: tierCents } : {}),
          updatedAt: new Date(),
        })
        .where(eq(priorityMessagePayments.id, payment.id));
    } catch (err) {
      // Unique violation on iap_transaction_id — this purchase was already
      // used for a payment (retried/duplicate finalize call).
      if (err.code === '23505') {
        throw new ApiError(409, 'This purchase has already been recorded');
      }
      throw err;
    }

    const delivered = await PriorityMessageService._deliverPaidPayment(payment.id, {
      senderId: payment.senderId,
      talentUserId: payment.talentUserId,
      io,
      reserveTalentCut: false,
    });
    if (!delivered) {
      throw new ApiError(
        500,
        'Your purchase was confirmed but the message could not be delivered. Please contact support.'
      );
    }

    return { paymentId: payment.id, ...delivered };
  }
}
