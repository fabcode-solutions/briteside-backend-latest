/**
 * src/services/iapClaim.service.js
 *
 * Shared guards for crediting an App Store / Google Play purchase to
 * something (a priority message payment or a shop order). Both flows sell
 * the same consumable price tiers, so one verified purchase must only ever
 * be redeemed once across BOTH — iap_transaction_claims enforces that.
 *
 * Errors carry `details.reason` so the App can tell an idempotent retry
 * (IAP_ALREADY_RECORDED — safe to finish the store transaction) from a
 * purchase it must NOT finish (anything else — Google then auto-refunds an
 * unacknowledged purchase after 3 days).
 */

import { and, eq } from 'drizzle-orm';
import { iapTransactionClaims } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';

export const IAP_REASON = {
  ALREADY_RECORDED: 'IAP_ALREADY_RECORDED',
  TRANSACTION_USED: 'IAP_TRANSACTION_USED',
  ACCOUNT_MISMATCH: 'IAP_ACCOUNT_MISMATCH',
  ALREADY_OWNED: 'IAP_ALREADY_OWNED',
  PAYMENT_PROCESSED: 'IAP_PAYMENT_ALREADY_PROCESSED',
};

export const iapError = (status, message, reason) =>
  new ApiError(status, message, true, '', { reason });

export class IapClaimService {
  /** 'sandbox' for Apple Sandbox/Xcode (TestFlight, App Review) and Google
   * test/promo/rewarded purchases (purchaseType present) — no real money. */
  static environmentOf(store, verified) {
    if (store === 'apple') return verified.environment === 'Production' ? 'production' : 'sandbox';
    return verified.purchaseType != null ? 'sandbox' : 'production';
  }

  /** The App tags each purchase with the buyer's user id (Apple
   * appAccountToken / Google obfuscatedAccountId). Untagged purchases from
   * older builds are accepted unless made after `requiredFrom`. */
  static assertBuyer(store, verified, userId, requiredFrom = null) {
    const token =
      store === 'apple' ? verified.appAccountToken : verified.obfuscatedExternalAccountId;
    if (!token) {
      const purchasedAt = Number(
        store === 'apple' ? verified.purchaseDate : verified.purchaseTimeMillis
      );
      if (requiredFrom && !(purchasedAt < requiredFrom.getTime())) {
        throw iapError(
          403,
          'This purchase is not linked to your account',
          IAP_REASON.ACCOUNT_MISMATCH
        );
      }
      return;
    }
    if (String(token).toLowerCase() !== String(userId).toLowerCase()) {
      throw iapError(
        403,
        'This purchase belongs to a different account',
        IAP_REASON.ACCOUNT_MISMATCH
      );
    }
  }

  static async findClaim(executor, store, transactionId) {
    return executor.query.iapTransactionClaims.findFirst({
      where: and(
        eq(iapTransactionClaims.store, store),
        eq(iapTransactionClaims.transactionId, transactionId)
      ),
    });
  }

  /**
   * Inserts the claim inside the caller's DB transaction. Returns null when
   * claimed, or the existing claim when this purchase was already redeemed
   * (the caller decides whether that's its own retry or a reuse).
   */
  static async claim(
    tx,
    { store, transactionId, userId, purpose, referenceId, productId, environment }
  ) {
    const [row] = await tx
      .insert(iapTransactionClaims)
      .values({ store, transactionId, userId, purpose, referenceId, productId, environment })
      .onConflictDoNothing({
        target: [iapTransactionClaims.store, iapTransactionClaims.transactionId],
      })
      .returning({ id: iapTransactionClaims.id });
    if (row) return null;
    return this.findClaim(tx, store, transactionId);
  }

  static alreadyRecorded() {
    return iapError(409, 'This purchase has already been recorded', IAP_REASON.ALREADY_RECORDED);
  }

  static transactionUsed() {
    return iapError(
      409,
      'This purchase has already been used for something else',
      IAP_REASON.TRANSACTION_USED
    );
  }
}
