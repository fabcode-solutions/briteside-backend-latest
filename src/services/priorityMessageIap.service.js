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
 *   - The 72h no-reply job handles IAP payments separately
 *     (PriorityMessageService._closeExpiredIapPayment): a Google payment
 *     with nothing answered is refunded through Play; otherwise it's closed
 *     and the buyer is told to ask the store.
 *   - Each store purchase is claimed once across shop + priority messages
 *     (IapClaimService); sandbox purchases are recorded with amountCents 0.
 */

import { and, eq, isNull } from 'drizzle-orm';
import logger from '../config/logger.js';
import config from '../config/config.js';
import { db } from '../db/index.js';
import { priorityMessagePayments } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import { PriorityMessageService } from './priorityMessage.service.js';
import { ShopIapService } from './shop/shopIap.service.js';
import { IapClaimService, IAP_REASON, iapError } from './iapClaim.service.js';
import {
  getTierConfig,
  productIdForTier,
  tierForProductId,
  tierForWebChargedCents,
} from './iapTiers.js';

// A finalize retry re-runs delivery only once the first attempt has clearly
// failed, never while it may still be running (delivery isn't idempotent).
const DELIVERY_RETRY_AFTER_MS = 2 * 60 * 1000;

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
      throw new ApiError(400, 'This message is too large to pay for in the app.');
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
    if (!payment.iapProductId) {
      throw new ApiError(400, 'This payment was not prepared for in-app purchase');
    }

    let verified;
    let verifiedTransactionId;
    let googleOrderId = null;
    if (store === 'apple') {
      if (!transactionId) throw new ApiError(400, '`transactionId` is required');
      verified = await ShopIapService.verifyAppleTransaction(transactionId);
      if (verified.productId !== payment.iapProductId) {
        throw new ApiError(400, "This transaction doesn't match this payment");
      }
      verifiedTransactionId = verified.transactionId;
    } else if (store === 'google') {
      if (!purchaseToken) throw new ApiError(400, '`purchaseToken` is required');
      // Throws unless purchaseState is "purchased" for exactly this product.
      verified = await ShopIapService.verifyGooglePurchase(purchaseToken, payment.iapProductId);
      await ShopIapService.rejectRealMoneyGooglePurchase(verified, testOnly);
      verifiedTransactionId = purchaseToken;
      googleOrderId = verified.orderId ?? null;
    } else {
      throw new ApiError(400, '`store` must be "apple" or "google"');
    }
    IapClaimService.assertBuyer(store, verified, senderId, config.iap.accountTokenRequiredFrom);
    const environment = IapClaimService.environmentOf(store, verified);

    // What the sender actually paid is the tier price, not the web total —
    // recorded before delivery so spend/"Total spent" reflect it. Sandbox
    // purchases move no real money, so they record 0.
    const tierCents = this.tierForProductId(payment.iapProductId);
    const amountCents = environment === 'sandbox' ? 0 : tierCents;

    // Claim + "pending → this purchase" commit together; the conditional
    // update stops two different purchases both paying for one payment.
    const retryDelivery = await db.transaction(async tx => {
      const conflict = await IapClaimService.claim(tx, {
        store,
        transactionId: verifiedTransactionId,
        userId: senderId,
        purpose: 'priority_message',
        referenceId: payment.id,
        productId: payment.iapProductId,
        environment,
      });
      if (conflict) {
        if (conflict.purpose !== 'priority_message' || conflict.referenceId !== payment.id) {
          throw IapClaimService.transactionUsed();
        }
        // Our own retry. Delivered already → nothing to do. Still pending
        // well after verification → the earlier delivery failed; retry it.
        // (A recent one may still be in flight — don't deliver twice.)
        const current = await tx.query.priorityMessagePayments.findFirst({
          where: eq(priorityMessagePayments.id, payment.id),
          columns: { status: true, iapVerifiedAt: true },
        });
        const stalled =
          current?.status === 'pending' &&
          current.iapVerifiedAt &&
          Date.now() - current.iapVerifiedAt.getTime() > DELIVERY_RETRY_AFTER_MS;
        if (!stalled) throw IapClaimService.alreadyRecorded();
        return true;
      }

      const updated = await tx
        .update(priorityMessagePayments)
        .set({
          purchaseChannel: store === 'apple' ? 'apple_iap' : 'google_iap',
          iapTransactionId: verifiedTransactionId,
          iapOrderId: googleOrderId,
          iapVerifiedAt: new Date(),
          ...(amountCents != null ? { amountCents } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(priorityMessagePayments.id, payment.id),
            eq(priorityMessagePayments.status, 'pending'),
            isNull(priorityMessagePayments.iapTransactionId)
          )
        )
        .returning({ id: priorityMessagePayments.id });
      if (updated.length === 0) {
        throw iapError(
          409,
          'This payment has already been processed',
          IAP_REASON.PAYMENT_PROCESSED
        );
      }
      return false;
    });

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

    // Google auto-refunds a purchase not acknowledged within 3 days. The App
    // consumes it (which acknowledges) after this returns; acknowledging here
    // covers an App killed before it could.
    if (store === 'google') {
      await ShopIapService.acknowledgeGooglePurchase(purchaseToken, payment.iapProductId).catch(
        err =>
          logger.error(`[PriorityIap] Google acknowledge failed for ${payment.id}: ${err.message}`)
      );
    }

    return { paymentId: payment.id, retriedDelivery: retryDelivery, ...delivered };
  }
}
