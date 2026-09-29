/**
 * src/services/iapNotification.service.js
 *
 * Server-to-server purchase notifications from the stores, so refunds and
 * revocations issued OUTSIDE this backend (the buyer asks Apple/Google, or the
 * store voids a purchase) are reflected here:
 *
 *   - Apple:  App Store Server Notifications V2 → POST /api/webhooks/apple-iap
 *             (REFUND / REVOKE)
 *   - Google: Real-time developer notifications via Cloud Pub/Sub push
 *             → POST /api/webhooks/google-play (voidedPurchaseNotification)
 *
 * Both mark the matching shop order and/or priority-message payment
 * refunded. Access to shop downloads/links/courses is gated on a 'paid' order,
 * so it's removed automatically.
 */
import { OAuth2Client } from 'google-auth-library';
import { NotificationTypeV2 } from '@apple/app-store-server-library';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { db } from '../db/index.js';
import { shopOrders, priorityMessagePayments } from '../db/schema/index.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ApiError from '../utils/api-error.js';
import { ShopIapService } from './shop/shopIap.service.js';

const APPLE_REFUND_TYPES = new Set([NotificationTypeV2.REFUND, NotificationTypeV2.REVOKE]);

const pubSubAuthClient = new OAuth2Client();

export class IapNotificationService {
  /**
   * Marks every shop order / priority payment recorded with one of these
   * store transaction ids (Apple transactionId, Google purchaseToken) as
   * refunded. Idempotent — already-refunded rows are left alone.
   */
  static async markRefunded(transactionIds, source) {
    const ids = [...new Set(transactionIds.filter(Boolean))];
    if (ids.length === 0) return { orders: 0, payments: 0 };
    const now = new Date();

    const orders = await db
      .update(shopOrders)
      .set({ status: 'refunded', refundedAt: now, updatedAt: now })
      .where(and(inArray(shopOrders.iapTransactionId, ids), ne(shopOrders.status, 'refunded')))
      .returning({ id: shopOrders.id });

    const payments = await db
      .update(priorityMessagePayments)
      .set({ status: 'refunded', refundedAt: now, updatedAt: now })
      .where(
        and(
          inArray(priorityMessagePayments.iapTransactionId, ids),
          ne(priorityMessagePayments.status, 'refunded')
        )
      )
      .returning({ id: priorityMessagePayments.id });

    logger.info(
      `[IapNotification] ${source}: refunded ${orders.length} shop order(s), ${payments.length} priority payment(s)`
    );
    return { orders: orders.length, payments: payments.length };
  }

  /** App Store Server Notifications V2 — body is `{ signedPayload }`. */
  static async handleApple(body) {
    const signedPayload = body?.signedPayload;
    if (!signedPayload) throw new ApiError(400, 'Missing signedPayload');

    // Signature, certificate chain, bundle id and app Apple ID are all
    // verified here — nothing in the payload is trusted before this.
    const { notification, environment } =
      await ShopIapService.verifyAppleNotification(signedPayload);

    if (!APPLE_REFUND_TYPES.has(notification.notificationType)) {
      return { handled: false, notificationType: notification.notificationType };
    }
    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    if (!signedTransactionInfo) throw new ApiError(400, 'Notification has no transaction');

    const transaction = await ShopIapService.verifyAppleSignedTransaction(
      signedTransactionInfo,
      environment
    );
    await this.markRefunded(
      [transaction.transactionId, transaction.originalTransactionId],
      `apple:${notification.notificationType}`
    );
    return { handled: true, notificationType: notification.notificationType };
  }

  /**
   * Verifies a Pub/Sub push request really comes from our subscription:
   * the OIDC token must be signed by Google, issued for our push endpoint
   * (audience), and belong to the configured push service account.
   */
  static async verifyPubSubPush(authorizationHeader) {
    const { rtdnPushAudience, rtdnPushServiceAccount } = config.googleIap;
    if (!rtdnPushAudience || !rtdnPushServiceAccount) {
      throw new ApiError(503, 'Google Play notifications are not configured');
    }
    const idToken = authorizationHeader?.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length)
      : null;
    if (!idToken) throw new ApiError(401, 'Missing push authentication token');

    const ticket = await pubSubAuthClient.verifyIdToken({ idToken, audience: rtdnPushAudience });
    const claims = ticket.getPayload();
    if (!claims?.email_verified || claims.email !== rtdnPushServiceAccount) {
      throw new ApiError(403, 'Push token is not from the configured service account');
    }
  }

  /** Real-time developer notification delivered by Pub/Sub push. */
  static async handleGoogle(body, authorizationHeader) {
    await this.verifyPubSubPush(authorizationHeader);

    const encoded = body?.message?.data;
    if (!encoded) throw new ApiError(400, 'Missing Pub/Sub message data');
    const notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

    if (notification.packageName !== config.googleIap.packageName) {
      throw new ApiError(400, 'Notification is for a different app');
    }

    const voided = notification.voidedPurchaseNotification;
    if (!voided?.purchaseToken) {
      // testNotification / oneTimeProductNotification etc. — purchases are
      // already verified synchronously when the App finalizes them.
      return { handled: false };
    }
    await this.markRefunded([voided.purchaseToken], 'google:voidedPurchase');
    return { handled: true };
  }
}
