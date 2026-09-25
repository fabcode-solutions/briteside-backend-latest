/**
 * src/services/shop/shopIap.service.js
 *
 * App-only in-app purchase support for Shop 'product' | 'course' | 'link'
 * listings — 'service' is out of scope (it already goes through a separate
 * custom-offer flow, see ShopOrderService.createCheckout).
 *
 * The existing web checkout (ShopOrderService.createCheckout /
 * handlePaymentWebhook) is completely untouched by this file — a web buyer
 * never calls anything here, and this file never writes to a 'web'-channel
 * order. Everything below is new, additive surface for the mobile App:
 *
 *   1. getBuyOptions()      — the App calls this when "Buy" is tapped, to
 *                             show "Pay on Web ($X) / Pay in App ($X×1.3)".
 *   2. registerProductWithStores() — fire-and-forget from product
 *                             create/update, mirrors each eligible product
 *                             as a purchasable item on Apple + Google.
 *   3. finalizePurchase()   — called after the App completes a native
 *                             purchase; verifies it server-to-server with
 *                             the relevant store, then creates the paid
 *                             shopOrders row exactly like a web purchase
 *                             would, just tagged with its IAP channel.
 *
 * Money note: the seller's cut (sellerReceiveCents) is always computed off
 * the ORIGINAL price, never the 30%-marked-up App price — a seller earns
 * the same regardless of which button the buyer tapped. An IAP sale never
 * touches Stripe (Apple/Google collect the money and pay Briteside through
 * their own developer payout, not Stripe), so reserveAmountCents stays 0
 * and the existing Stripe Connect release cron never touches these orders —
 * settling what's owed to the seller for IAP sales needs a separate process
 * this file doesn't attempt to build.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from 'google-auth-library';
import { AppStoreServerAPIClient, SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { shopProducts, shopOrders } from '../../db/schema/index.js';
import ApiError from '../../utils/api-error.js';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { ShopOrderService } from './shopOrder.service.js';
import { ShopProductService } from './shopProduct.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// "Pay in App" is 30% more than "Pay on Web" — the spec's own number, meant
// to cover Apple's/Google's own commission on a native purchase.
const IAP_MARKUP_MULTIPLIER = 1.3;
const IAP_ELIGIBLE_LISTING_TYPES = new Set(['product', 'course', 'link']);

export class ShopIapService {
  // ── Eligibility & pricing ────────────────────────────────────────────────

  static isIapEligible(product) {
    return (
      !!product &&
      !product.deletedAt &&
      product.buttonAction === 'payment' &&
      IAP_ELIGIBLE_LISTING_TYPES.has(product.listingType) &&
      product.priceCents > 0
    );
  }

  /** Both prices for the "How do you want to pay?" dialog — same fee formula
   * as the web checkout (ShopOrderService.computeFees), just fed a 30%-higher
   * base for the App option. */
  static computePricingOptions(priceCents) {
    const web = ShopOrderService.computeFees(priceCents);
    const appBasePriceCents = Math.round(priceCents * IAP_MARKUP_MULTIPLIER);
    const app = ShopOrderService.computeFees(appBasePriceCents);
    return {
      webPriceCents: priceCents,
      webChargedCents: web.chargedCents,
      appBasePriceCents,
      appChargedCents: app.chargedCents,
    };
  }

  /** One identifier registered with BOTH stores. Apple allows up to 255
   * chars (alphanumeric + '.' '_'); Google's SKU format is stricter — max 40
   * chars, lowercase alphanumeric + '.' '_'. A hyphen-stripped, lowercased
   * UUID (32 chars) satisfies both. */
  static generateIapProductId() {
    return randomUUID().replace(/-/g, '');
  }

  // ── Apple: App Store Server API (transaction verification) ─────────────

  static _appleRootCerts() {
    const certPath = path.join(__dirname, '../../certs/AppleRootCA-G3.cer');
    return [fs.readFileSync(certPath)];
  }

  static _appleEnvironment() {
    return config.appleIap.environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
  }

  static _appStoreServerClient() {
    if (!config.appleIap.configured) return null;
    return new AppStoreServerAPIClient(
      config.appleIap.privateKey,
      config.appleIap.keyId,
      config.appleIap.issuerId,
      config.appleIap.bundleId,
      this._appleEnvironment()
    );
  }

  /**
   * Fetches a transaction from Apple and cryptographically verifies its
   * signature against Apple's certificate chain before trusting anything in
   * it — never trust a bare transactionId from the client without this.
   */
  static async verifyAppleTransaction(transactionId) {
    const client = this._appStoreServerClient();
    if (!client) throw new ApiError(503, 'Apple in-app purchases are not configured');

    const response = await client.getTransactionInfo(transactionId);
    if (!response?.signedTransactionInfo) {
      throw new ApiError(400, 'Apple returned no transaction data for this id');
    }

    const verifier = new SignedDataVerifier(
      this._appleRootCerts(),
      true, // enableOnlineChecks — revocation + expiry checked live
      this._appleEnvironment(),
      config.appleIap.bundleId
    );
    return verifier.verifyAndDecodeTransaction(response.signedTransactionInfo);
  }

  // ── Apple: App Store Connect API (product registration) ────────────────
  // Separate key/scope from the App Store Server API above.

  static _ascToken() {
    if (!config.appleIap.ascKeyId || !config.appleIap.ascPrivateKey || !config.appleIap.issuerId) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iss: config.appleIap.issuerId, iat: now, exp: now + 60 * 19, aud: 'appstoreconnect-v1' },
      config.appleIap.ascPrivateKey,
      { algorithm: 'ES256', keyid: config.appleIap.ascKeyId }
    );
  }

  /**
   * Registers a product as a non-consumable in-app purchase with Apple.
   * Best-effort: failures are recorded on the product row (appleIapStatus/
   * appleIapError), never thrown — a store outage must never block a
   * seller's create/update request.
   *
   * Note: this creates the IAP item itself. Apple typically also requires a
   * price schedule and localized display info before it's purchasable, and
   * a first-time in-app purchase needs App Review approval before it's live
   * — that part of the lifecycle isn't automated here and may need a manual
   * pass in App Store Connect the first time.
   */
  static async registerWithApple(product) {
    if (!config.appleIap.configured || !config.appleIap.ascAppId) {
      logger.warn('[ShopIap] Apple IAP not configured — skipping registration');
      return;
    }
    const token = this._ascToken();
    if (!token) {
      logger.warn('[ShopIap] Apple ASC key not configured — skipping registration');
      return;
    }

    try {
      const res = await fetch('https://api.appstoreconnect.apple.com/v2/inAppPurchases', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'inAppPurchases',
            attributes: {
              name: product.title.slice(0, 64),
              productId: product.iapProductId,
              inAppPurchaseType: 'NON_CONSUMABLE',
            },
            relationships: {
              app: { data: { type: 'apps', id: config.appleIap.ascAppId } },
            },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Apple ASC ${res.status}: ${body.slice(0, 500)}`);
      }

      await db
        .update(shopProducts)
        .set({ appleIapStatus: 'registered', appleIapRegisteredAt: new Date(), appleIapError: null })
        .where(eq(shopProducts.id, product.id));
    } catch (err) {
      logger.error(`[ShopIap] Apple registration failed for product ${product.id}: ${err.message}`);
      await db
        .update(shopProducts)
        .set({ appleIapStatus: 'failed', appleIapError: String(err.message).slice(0, 1000) })
        .where(eq(shopProducts.id, product.id));
    }
  }

  // ── Google: Play Developer API ──────────────────────────────────────────

  static async _googleAccessToken() {
    if (!config.googleIap.configured) return null;
    const credentials = JSON.parse(config.googleIap.serviceAccountJson);
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    return token;
  }

  /**
   * Registers a product as a managed (one-time) in-app product with Google
   * Play. Best-effort, same failure-recording pattern as registerWithApple.
   */
  static async registerWithGoogle(product) {
    if (!config.googleIap.configured) {
      logger.warn('[ShopIap] Google Play IAP not configured — skipping registration');
      return;
    }
    try {
      const token = await this._googleAccessToken();
      const res = await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/inappproducts`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packageName: config.googleIap.packageName,
            sku: product.iapProductId,
            status: 'active',
            purchaseType: 'managedUser',
            defaultLanguage: 'en-US',
            listings: {
              'en-US': {
                title: product.title.slice(0, 55),
                description: (product.description || product.title).slice(0, 200),
              },
            },
            defaultPrice: {
              priceMicros: String(Math.round(product.priceCents * IAP_MARKUP_MULTIPLIER) * 10000),
              currency: 'USD',
            },
          }),
        }
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Google Play ${res.status}: ${body.slice(0, 500)}`);
      }

      await db
        .update(shopProducts)
        .set({ googleIapStatus: 'registered', googleIapRegisteredAt: new Date(), googleIapError: null })
        .where(eq(shopProducts.id, product.id));
    } catch (err) {
      logger.error(`[ShopIap] Google registration failed for product ${product.id}: ${err.message}`);
      await db
        .update(shopProducts)
        .set({ googleIapStatus: 'failed', googleIapError: String(err.message).slice(0, 1000) })
        .where(eq(shopProducts.id, product.id));
    }
  }

  /** purchaseState: 0 = purchased, 1 = cancelled, 2 = pending. */
  static async verifyGooglePurchase(purchaseToken, iapProductId) {
    if (!config.googleIap.configured) {
      throw new ApiError(503, 'Google Play in-app purchases are not configured');
    }
    const token = await this._googleAccessToken();
    const res = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/purchases/products/${iapProductId}/tokens/${purchaseToken}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new ApiError(400, `Google purchase verification failed (${res.status})`);
    const data = await res.json();
    if (data.purchaseState !== 0) throw new ApiError(400, 'This purchase was not completed');
    return data;
  }

  /** Google auto-refunds an unacknowledged purchase after 3 days — must be
   * called once a purchase is verified and recorded. */
  static async acknowledgeGooglePurchase(purchaseToken, iapProductId) {
    const token = await this._googleAccessToken();
    const res = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/purchases/products/${iapProductId}/tokens/${purchaseToken}:acknowledge`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google acknowledge failed (${res.status}): ${body.slice(0, 300)}`);
    }
  }

  // ── Orchestration ────────────────────────────────────────────────────────

  /**
   * Fire-and-forget from product create/update (ShopProductService) — never
   * throws into the caller, so a store outage can never break the seller's
   * create/edit flow. Assigns iapProductId once, on first eligibility.
   *
   * Only actually calls each store's registration endpoint when that store
   * isn't already 'registered' — registerWithApple/registerWithGoogle both
   * POST a *new* item, so re-running them against an already-registered
   * product would just fail as a duplicate on every unrelated edit (a
   * gallery change, a description tweak, etc.), repeatedly flipping status
   * to 'failed' for no real reason. This means a price edit on an
   * already-registered product does NOT push the new price to either store —
   * updating an existing store listing's price needs a separate, explicit
   * "sync price" call this doesn't build yet.
   */
  static async registerProductWithStores(product) {
    if (!this.isIapEligible(product)) return;
    try {
      let target = product;
      if (!product.iapProductId) {
        const [updated] = await db
          .update(shopProducts)
          .set({ iapProductId: this.generateIapProductId() })
          .where(eq(shopProducts.id, product.id))
          .returning();
        target = updated;
      }
      const jobs = [];
      if (target.appleIapStatus !== 'registered') {
        jobs.push(
          this.registerWithApple(target).catch(err =>
            logger.error(`[ShopIap] Apple registration threw: ${err.message}`)
          )
        );
      }
      if (target.googleIapStatus !== 'registered') {
        jobs.push(
          this.registerWithGoogle(target).catch(err =>
            logger.error(`[ShopIap] Google registration threw: ${err.message}`)
          )
        );
      }
      await Promise.all(jobs);
    } catch (err) {
      logger.error(`[ShopIap] registerProductWithStores failed for ${product.id}: ${err.message}`);
    }
  }

  /**
   * The App calls this when "Buy" is tapped, to populate the "How do you
   * want to pay?" dialog. Doesn't create anything — pure pricing lookup.
   */
  static async getBuyOptions(productId) {
    const product = await db.query.shopProducts.findFirst({ where: eq(shopProducts.id, productId) });
    if (!product || product.deletedAt) throw new ApiError(404, 'Product not found');
    if (!this.isIapEligible(product)) return { iapEligible: false };

    return {
      iapEligible: true,
      iapProductId: product.iapProductId,
      appleReady: product.appleIapStatus === 'registered',
      googleReady: product.googleIapStatus === 'registered',
      ...this.computePricingOptions(product.priceCents),
    };
  }

  /**
   * Called after the App completes a native purchase — verifies it
   * server-to-server with the relevant store, then finalizes it exactly
   * like a web purchase's webhook does: creates the paid shopOrders row,
   * bumps salesCount, notifies the seller. Idempotent via the unique index
   * on iapTransactionId — a retried call for the same transaction throws a
   * clean 409 instead of double-counting a sale.
   */
  static async finalizePurchase(buyerId, productId, store, { transactionId, purchaseToken } = {}) {
    const product = await db.query.shopProducts.findFirst({ where: eq(shopProducts.id, productId) });
    if (!product || product.deletedAt) throw new ApiError(404, 'Product not found');
    if (!this.isIapEligible(product)) {
      throw new ApiError(400, 'This product does not support in-app purchase');
    }
    if (product.userId === buyerId) throw new ApiError(400, "You can't buy your own product");

    const alreadyOwned = await ShopOrderService.findPaidOrder(buyerId, productId);
    if (alreadyOwned) throw new ApiError(409, 'You already own this product');

    let verifiedTransactionId;
    let originalTransactionId = null;

    if (store === 'apple') {
      if (!transactionId) throw new ApiError(400, '`transactionId` is required');
      const decoded = await this.verifyAppleTransaction(transactionId);
      if (decoded.productId !== product.iapProductId) {
        throw new ApiError(400, "This transaction doesn't match this product");
      }
      verifiedTransactionId = decoded.transactionId;
      originalTransactionId = decoded.originalTransactionId ?? null;
    } else if (store === 'google') {
      if (!purchaseToken) throw new ApiError(400, '`purchaseToken` is required');
      await this.verifyGooglePurchase(purchaseToken, product.iapProductId);
      verifiedTransactionId = purchaseToken;
    } else {
      throw new ApiError(400, '`store` must be "apple" or "google"');
    }

    // Seller's cut is off the ORIGINAL price, unaffected by the app markup —
    // a seller earns the same whichever button the buyer tapped.
    const fees = ShopOrderService.computeFees(product.priceCents);
    const pricing = this.computePricingOptions(product.priceCents);
    const settings = await ShopProductService.getShopSettings(product.userId);

    let order;
    try {
      [order] = await db
        .insert(shopOrders)
        .values({
          productId: product.id,
          buyerId,
          sellerId: product.userId,
          status: 'paid',
          productTitleSnapshot: product.title,
          priceCents: product.priceCents,
          chargedCents: pricing.appChargedCents,
          sellerReceiveCents: fees.sellerReceiveCents,
          platformShareCents: pricing.appChargedCents - fees.sellerReceiveCents,
          refundsAllowedSnapshot: settings.refundsEnabled,
          refundWindowDaysSnapshot: settings.refundWindowDays,
          refundAfterDownloadSnapshot: settings.refundAfterDownload,
          paidAt: new Date(),
          purchaseChannel: store === 'apple' ? 'apple_iap' : 'google_iap',
          iapProductId: product.iapProductId,
          iapTransactionId: verifiedTransactionId,
          iapOriginalTransactionId: originalTransactionId,
          iapVerifiedAt: new Date(),
          // No Stripe transaction exists for an IAP sale, so there's nothing
          // for the existing Connect-transfer release cron to move — see the
          // reserveAmountCents comment on the shopOrders schema.
          reserveAmountCents: 0,
        })
        .returning();
    } catch (err) {
      // Unique violation on iapTransactionId — this exact purchase was
      // already recorded (a retried/duplicate finalize call).
      if (err.code === '23505') {
        throw new ApiError(409, 'This purchase has already been recorded');
      }
      throw err;
    }

    await db
      .update(shopProducts)
      .set({ salesCount: sql`${shopProducts.salesCount} + 1` })
      .where(eq(shopProducts.id, product.id));

    if (store === 'google') {
      try {
        await this.acknowledgeGooglePurchase(purchaseToken, product.iapProductId);
        await db
          .update(shopOrders)
          .set({ iapAcknowledged: true })
          .where(eq(shopOrders.id, order.id));
      } catch (err) {
        // Non-fatal — the order is already recorded paid. A missed ack risks
        // Google auto-refunding after 3 days; recoverable by re-acking, not
        // by failing a purchase that already went through.
        logger.error(`[ShopIap] Google acknowledge failed for order ${order.id}: ${err.message}`);
      }
    }

    await ShopOrderService.notifyPurchase(order).catch(err =>
      logger.error(`[ShopIap] purchase notify failed: ${err.message}`)
    );

    return { free: false, orderId: order.id, purchaseChannel: order.purchaseChannel };
  }
}
