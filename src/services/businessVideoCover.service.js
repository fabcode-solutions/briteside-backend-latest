/**
 * Video cover — a $5/month add-on: a business page's cover can be a video
 * (30 seconds max) instead of a photo.
 *
 * Billing is an auto-renewing subscription bought IN THE APP through Apple /
 * Google (never Stripe). The app tags the purchase with the business it's for
 * — Apple `appAccountToken` = business id, Google `obfuscatedAccountId` =
 * business id — and then calls finalize() with the transaction / token. The
 * stores are the source of truth: finalize() and every store notification
 * (renewal, failed renewal / grace period, cancellation, expiry, refund)
 * re-read the subscription from the store and copy it onto
 * business_store_subscriptions and then the business (videoCoverUntil).
 *
 * The video shows publicly only while videoCoverUntil is in the future; the
 * cover photo (heroUrl) is its poster and comes back by itself when the
 * subscription lapses. The saved video is kept, so resubscribing restores it.
 */
import httpStatus from 'http-status';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Environment, Status as AppleStatus, AutoRenewStatus } from '@apple/app-store-server-library';
import { db } from '../db/index.js';
import { businesses, businessStoreSubscriptions } from '../db/schema/index.js';
import { media, mediaOwners } from '../db/schema/fileTracking.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { ShopIapService } from './shop/shopIap.service.js';
import FileManagementService from './fileManagement.service.js';
import { MediaModerationService, HELD_FROM_OTHERS } from './moderation/mediaModeration.service.js';
import { probeDurationSeconds } from '../utils/mediaDuration.js';

export const VIDEO_COVER_FEATURE = 'video_cover';
export const VIDEO_COVER_PRICE_CENTS = 500;
export const VIDEO_COVER_MAX_SECONDS = 30;
// Encoders round; a "30 second" clip is often 30.03s
const DURATION_TOLERANCE_SECONDS = 0.5;
const LIVE_STATUSES = new Set(['active', 'grace']);

const productIds = () => config.iap.videoCoverProductIds;

/** Is the paid video cover on right now? */
export const isVideoCoverLive = b => !!b?.videoCoverUntil && new Date(b.videoCoverUntil).getTime() > Date.now();

/** Owner / dashboard (and the app's purchase screen) view of the add-on. */
export const serializeVideoCover = b => ({
  live: isVideoCoverLive(b),
  until: b.videoCoverUntil ?? null,
  autoRenew: !!b.videoCoverAutoRenew,
  // Where it's billed — cancel / manage it there
  store: b.videoCoverStore ?? null,
  heroVideoUrl: b.heroVideoUrl ?? null,
  priceCents: VIDEO_COVER_PRICE_CENTS,
  maxSeconds: VIDEO_COVER_MAX_SECONDS,
  // What the app purchases (tagged with this business's id)
  productIds: productIds(),
});

const APPLE_STATUS = {
  [AppleStatus.ACTIVE]: 'active',
  [AppleStatus.BILLING_GRACE_PERIOD]: 'grace',
  [AppleStatus.BILLING_RETRY]: 'on_hold',
  [AppleStatus.EXPIRED]: 'expired',
  [AppleStatus.REVOKED]: 'revoked',
};

const GOOGLE_STATE = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace',
  SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
  SUBSCRIPTION_STATE_PAUSED: 'on_hold',
  SUBSCRIPTION_STATE_PENDING: 'on_hold',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  // Cancelled = auto-renew off; paid time still runs to expiryTime
  SUBSCRIPTION_STATE_CANCELED: 'active',
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'expired',
};

const toDate = ms => (ms ? new Date(Number(ms)) : null);
const laterOf = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

export class BusinessVideoCoverService {
  // ── Purchase (called by the app after the store sheet completes) ─────────

  /**
   * Records a subscription the app just bought for `business`. Apple: the
   * transactionId; Google: the purchaseToken. The purchase must be tagged
   * with this business's id, so a receipt can't be replayed onto another page.
   */
  static async finalize(business, user, { store, transactionId, purchaseToken }) {
    const claim = { businessId: business.id, purchasedBy: user.id };
    if (store === 'apple') {
      if (!transactionId) throw new ApiError(httpStatus.BAD_REQUEST, '`transactionId` is required');
      const transaction = await ShopIapService.verifyAppleTransaction(transactionId);
      if (transaction.productId !== productIds().apple) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'That purchase is not the video cover subscription');
      }
      if (transaction.appAccountToken?.toLowerCase() !== business.id.toLowerCase()) {
        throw new ApiError(httpStatus.FORBIDDEN, 'That purchase was made for a different business');
      }
      await this.syncApple(transaction.originalTransactionId, transaction.environment, claim);
    } else if (store === 'google') {
      if (!purchaseToken) throw new ApiError(httpStatus.BAD_REQUEST, '`purchaseToken` is required');
      await this.syncGoogle(purchaseToken, claim);
    } else {
      throw new ApiError(httpStatus.BAD_REQUEST, '`store` must be apple or google');
    }
    const updated = await db.query.businesses.findFirst({ where: eq(businesses.id, business.id) });
    return serializeVideoCover(updated);
  }

  // ── Apple ────────────────────────────────────────────────────────────────

  /**
   * Re-reads an Apple subscription (by originalTransactionId) from the App
   * Store Server API and stores its current state. `claim` = the business
   * a new purchase is for; without it the subscription must already be known,
   * or carry an appAccountToken that is a business id.
   */
  static async syncApple(originalTransactionId, environment, claim = null) {
    const env = environment === Environment.SANDBOX || environment === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
    const client = ShopIapService._appStoreServerClient(env);
    if (!client) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Apple in-app purchases are not configured');
    const response = await client.getAllSubscriptionStatuses(originalTransactionId);
    const item = (response.data ?? [])
      .flatMap(group => group.lastTransactions ?? [])
      .find(t => t.originalTransactionId === originalTransactionId);
    if (!item?.signedTransactionInfo) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Apple has no subscription for this purchase');
    }
    const verifier = ShopIapService._signedDataVerifier(env);
    const transaction = await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
    const renewal = item.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo) : null;
    if (transaction.productId !== productIds().apple) return null;

    const status = APPLE_STATUS[item.status] ?? 'expired';
    let expiresAt = toDate(transaction.expiresDate);
    if (status === 'grace') expiresAt = laterOf(expiresAt, toDate(renewal?.gracePeriodExpiresDate));
    if (status === 'revoked' || transaction.revocationDate) expiresAt = new Date();

    return this.#save({
      store: 'apple',
      storeSubscriptionId: originalTransactionId,
      productId: transaction.productId,
      latestTransactionId: transaction.transactionId ?? null,
      status: transaction.revocationDate ? 'revoked' : status,
      expiresAt,
      autoRenew: renewal?.autoRenewStatus === AutoRenewStatus.ON,
      environment: env === Environment.SANDBOX ? 'sandbox' : 'production',
      claim,
      // A renewal arriving before the app finalized: the token says which business
      taggedBusinessId: transaction.appAccountToken ?? null,
    });
  }

  /**
   * App Store Server Notification (already verified) for any of our
   * products. Returns true when it was a video cover subscription.
   */
  static async handleAppleNotification(notification, environment) {
    const signed = notification.data?.signedTransactionInfo;
    if (!signed) return false;
    const transaction = await ShopIapService.verifyAppleSignedTransaction(signed, environment);
    if (transaction.productId !== productIds().apple) return false;
    await this.syncApple(transaction.originalTransactionId, environment);
    return true;
  }

  // ── Google ───────────────────────────────────────────────────────────────

  static async #googleSubscription(purchaseToken) {
    if (!config.googleIap.configured) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google Play in-app purchases are not configured');
    }
    const token = await ShopIapService._googleAccessToken();
    const res = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new ApiError(httpStatus.BAD_REQUEST, `Google subscription verification failed (${res.status})`);
    return res.json();
  }

  /** Google auto-refunds a subscription purchase that isn't acknowledged within 3 days. */
  static async #acknowledgeGoogle(productId, purchaseToken) {
    const token = await ShopIapService._googleAccessToken();
    const res = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google acknowledge failed (${res.status}): ${body.slice(0, 300)}`);
    }
  }

  /** Re-reads a Google subscription (by purchaseToken) and stores its current state. */
  static async syncGoogle(purchaseToken, claim = null) {
    const sub = await this.#googleSubscription(purchaseToken);
    const lineItem = (sub.lineItems ?? []).find(l => l.productId === productIds().google);
    if (!lineItem) {
      if (claim) throw new ApiError(httpStatus.BAD_REQUEST, 'That purchase is not the video cover subscription');
      return null;
    }
    const taggedBusinessId = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
    if (claim && taggedBusinessId?.toLowerCase() !== claim.businessId.toLowerCase()) {
      throw new ApiError(httpStatus.FORBIDDEN, 'That purchase was made for a different business');
    }

    let status = GOOGLE_STATE[sub.subscriptionState] ?? 'expired';
    const expiresAt = sub.lineItems.map(l => toDate(Date.parse(l.expiryTime))).reduce(laterOf, null);
    if (status === 'active' && expiresAt && expiresAt <= new Date()) status = 'expired';

    const saved = await this.#save({
      store: 'google',
      storeSubscriptionId: purchaseToken,
      productId: lineItem.productId,
      latestTransactionId: sub.latestOrderId ?? null,
      linkedPurchaseToken: sub.linkedPurchaseToken ?? null,
      status,
      expiresAt,
      autoRenew: !!lineItem.autoRenewingPlan?.autoRenewEnabled,
      environment: sub.testPurchase ? 'sandbox' : 'production',
      claim,
      taggedBusinessId,
    });

    if (saved && sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && LIVE_STATUSES.has(status)) {
      await this.#acknowledgeGoogle(lineItem.productId, purchaseToken).catch(err =>
        logger.error(`[VideoCover] acknowledge failed for ${purchaseToken.slice(0, 12)}…: ${err.message}`)
      );
    }
    return saved;
  }

  /** Play RTDN subscriptionNotification. Returns true when it was a video cover subscription. */
  static async handleGoogleNotification({ purchaseToken, subscriptionId }) {
    if (!purchaseToken || (subscriptionId && subscriptionId !== productIds().google)) return false;
    await this.syncGoogle(purchaseToken);
    return true;
  }

  /** Play voidedPurchaseNotification (refund / chargeback) for a subscription token. */
  static async revokeGoogle(purchaseToken) {
    const [row] = await db
      .update(businessStoreSubscriptions)
      .set({ status: 'revoked', expiresAt: new Date(), autoRenew: false, updatedAt: new Date() })
      .where(
        and(
          eq(businessStoreSubscriptions.store, 'google'),
          eq(businessStoreSubscriptions.storeSubscriptionId, purchaseToken)
        )
      )
      .returning();
    if (row) await this.applyToBusiness(row.businessId);
    return !!row;
  }

  // ── Storing ──────────────────────────────────────────────────────────────

  static async #save({
    store,
    storeSubscriptionId,
    productId,
    latestTransactionId,
    linkedPurchaseToken = null,
    status,
    expiresAt,
    autoRenew,
    environment,
    claim,
    taggedBusinessId,
  }) {
    const existing = await db.query.businessStoreSubscriptions.findFirst({
      where: and(
        eq(businessStoreSubscriptions.store, store),
        eq(businessStoreSubscriptions.storeSubscriptionId, storeSubscriptionId)
      ),
    });
    // One store subscription powers one business
    if (existing && claim && existing.businessId !== claim.businessId) {
      throw new ApiError(httpStatus.CONFLICT, 'This subscription is already used by another business');
    }

    let businessId = existing?.businessId ?? claim?.businessId ?? null;
    if (!businessId && taggedBusinessId) {
      const tagged = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, taggedBusinessId), isNull(businesses.deletedAt)),
        columns: { id: true },
      }).catch(() => null);
      businessId = tagged?.id ?? null;
    }
    if (!businessId) {
      logger.warn(`[VideoCover] ${store} subscription ${storeSubscriptionId.slice(0, 12)}… has no business — ignored`);
      return null;
    }

    const values = {
      productId,
      latestTransactionId,
      linkedPurchaseToken,
      status,
      expiresAt,
      autoRenew,
      environment,
      updatedAt: new Date(),
    };
    await db
      .insert(businessStoreSubscriptions)
      .values({
        businessId,
        purchasedBy: claim?.purchasedBy ?? null,
        feature: VIDEO_COVER_FEATURE,
        store,
        storeSubscriptionId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [businessStoreSubscriptions.store, businessStoreSubscriptions.storeSubscriptionId],
        set: values,
      });

    // Google resubscribe / plan change: the old token is replaced by this one
    if (linkedPurchaseToken) {
      await db
        .update(businessStoreSubscriptions)
        .set({ status: 'expired', autoRenew: false, updatedAt: new Date() })
        .where(
          and(
            eq(businessStoreSubscriptions.store, 'google'),
            eq(businessStoreSubscriptions.storeSubscriptionId, linkedPurchaseToken)
          )
        );
    }

    await this.applyToBusiness(businessId);
    return { businessId, status, expiresAt };
  }

  /**
   * Copies the business's best live subscription (latest paid-through time)
   * onto the business row — the one place the page reads.
   */
  static async applyToBusiness(businessId) {
    const rows = await db
      .select()
      .from(businessStoreSubscriptions)
      .where(
        and(
          eq(businessStoreSubscriptions.businessId, businessId),
          eq(businessStoreSubscriptions.feature, VIDEO_COVER_FEATURE)
        )
      )
      .orderBy(desc(businessStoreSubscriptions.updatedAt));
    const now = Date.now();
    const live = rows
      .filter(r => LIVE_STATUSES.has(r.status) && r.expiresAt && r.expiresAt.getTime() > now)
      .sort((a, b) => b.expiresAt - a.expiresAt)[0];
    const latest = live ?? rows[0] ?? null;
    await db
      .update(businesses)
      .set({
        videoCoverUntil: live?.expiresAt ?? null,
        videoCoverAutoRenew: !!live?.autoRenew,
        videoCoverStore: latest?.store ?? null,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));
  }

  // ── The video itself ─────────────────────────────────────────────────────

  /**
   * Sets the cover video (null removes it — the photo is the cover again).
   * Only while subscribed; only a video `user` uploaded to Briteside; 30s max
   * (measured on the server — the app's own check can't be trusted).
   */
  static async setVideo(business, user, videoUrl) {
    if (videoUrl == null) {
      const [row] = await db
        .update(businesses)
        .set({ heroVideoUrl: null, updatedAt: new Date() })
        .where(eq(businesses.id, business.id))
        .returning();
      return serializeVideoCover(row);
    }
    if (!isVideoCoverLive(business)) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Video covers need the $5/month video cover subscription');
    }
    if (!videoUrl.startsWith(FileManagementService.buildPublicUrl(''))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Upload the video to Briteside first');
    }
    const [file] = await db
      .select({ mediaType: media.mediaType })
      .from(media)
      .innerJoin(mediaOwners, and(eq(mediaOwners.mediaId, media.id), eq(mediaOwners.userId, user.id)))
      .where(and(eq(media.url, videoUrl), isNull(media.deletedAt)))
      .limit(1);
    if (!file) throw new ApiError(httpStatus.BAD_REQUEST, 'Upload the video to Briteside first');
    if (file.mediaType !== 'video') throw new ApiError(httpStatus.BAD_REQUEST, 'That file is not a video');

    const [moderation] = await MediaModerationService.mediaRowsForUrls([videoUrl]);
    if (moderation?.status === 'rejected' || moderation?.status === 'shadowed') {
      throw new ApiError(httpStatus.BAD_REQUEST, "This video doesn't meet our community guidelines");
    }

    const seconds = await probeDurationSeconds(videoUrl);
    if (seconds == null) throw new ApiError(httpStatus.BAD_REQUEST, "We couldn't read that video. Try another file.");
    if (seconds > VIDEO_COVER_MAX_SECONDS + DURATION_TOLERANCE_SECONDS) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Cover videos can be up to ${VIDEO_COVER_MAX_SECONDS} seconds (this one is ${Math.round(seconds)}s)`
      );
    }

    const [row] = await db
      .update(businesses)
      .set({ heroVideoUrl: videoUrl, updatedAt: new Date() })
      .where(eq(businesses.id, business.id))
      .returning();
    return serializeVideoCover(row);
  }

  /**
   * The cover video visitors may see: only while subscribed, and not while
   * moderation is holding the file (under review / removed).
   */
  static async publicVideoUrl(business) {
    if (!business?.heroVideoUrl || !isVideoCoverLive(business)) return null;
    const [row] = await MediaModerationService.mediaRowsForUrls([business.heroVideoUrl]);
    if (row && HELD_FROM_OTHERS.has(row.status)) return null;
    return business.heroVideoUrl;
  }
}
