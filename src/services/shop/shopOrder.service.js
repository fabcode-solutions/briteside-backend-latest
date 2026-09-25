import Stripe from 'stripe';
import { db } from '../../db/index.js';
import { shopOrders, shopProducts, users, notifications } from '../../db/schema/index.js';
import { shopCustomServiceOffers, talentReviews, talentProfiles } from '../../db/schema/index.js';
import { eq, and, desc, sql, count, isNull, gte ,inArray} from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { getRedirectUrls } from '../../utils/redirect-urls.js';
import { StripeConnectService } from '../stripeConnect.service.js';
import { UserSpendService } from '../userSpend.service.js';
import { createNotification } from '../notification.service.js';
import * as mailService from '../mail.service.js';
import { ShopProductService } from './shopProduct.service.js';
import { ShopDeliverableService } from './shopDeliverable.service.js';
import { calculatePlatformAndServiceFeeCents } from '../../utils/orderProcessingFee.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

const CHECKOUT_TTL_SECONDS = 30 * 60;

// Own notification type so the rate-limit lookup can't collide with real sale
// notifications, which also use the 'payment' type.
const PAYOUT_SETUP_NOTIFICATION_TYPE = 'shop_payout_setup';
const PAYOUT_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// The Earnings tab holds the Stripe onboarding button; the dashboard root opens
// on Video Chat, so link deeper.
const PAYOUT_SETUP_PATH = '/talent-dashboard?tab=earnings';

export class ShopOrderService {
  /**
   * Fee split, identical to talent sessions (talentSession.service.js).
   *
   *   sellerDeductionCents       = base × 0.05 — seller's marketplace commission (seller keeps 95%)
   *   platformAndServiceFeeCents = base × 7.5% — merged "Platform & Service Fee", 100% Briteside revenue
   *   chargedCents               = base + platformAndServiceFee. Stripe's own processing
   *                                cost is Briteside-absorbed, not grossed up onto the buyer.
   *   applicationFeeCents        = platformAndServiceFee + seller's commission — this is
   *                                the entirety of what Briteside keeps from the Connect transfer.
   */
  static computeFees(basePriceCents) {
    const sellerDeductionCents = Math.round(basePriceCents * 0.05);
    const sellerReceiveCents = basePriceCents - sellerDeductionCents;
    const platformAndServiceFeeCents = calculatePlatformAndServiceFeeCents(basePriceCents);
    const chargedCents = basePriceCents + platformAndServiceFeeCents;
    const applicationFeeCents = platformAndServiceFeeCents + sellerDeductionCents;
    return {
      sellerReceiveCents,
      chargedCents,
      applicationFeeCents,
      platformAndServiceFeeCents,
      platformShareCents: applicationFeeCents,
    };
  }

  static async findPaidOrder(buyerId, productId) {
    return db.query.shopOrders.findFirst({
      where: and(
        eq(shopOrders.buyerId, buyerId),
        eq(shopOrders.productId, productId),
        eq(shopOrders.status, 'paid')
      ),
    });
  }

  /**
   * Listing types where the seller must be able to reach the buyer directly
   * (delivering course access, following up on a digital download, etc.) —
   * name + email are mandatory at checkout for these, unlike a plain link or
   * service listing where the seller already handles fulfillment manually.
   */
  static REQUIRES_CUSTOMER_INFO = new Set(['product', 'course']);

  /**
   * Start a purchase.
   * Free products bypass Stripe entirely and are delivered immediately.
   */
  static async createCheckout(buyerId, productId, platform, customerInfo = {}) {
    const product = await db.query.shopProducts.findFirst({
      where: eq(shopProducts.id, productId),
    });
    if (!product || product.deletedAt) throw new ApiError(404, 'Product not found');
    if (product.buttonAction !== 'payment') {
      throw new ApiError(400, 'This product is not sold through the platform');
    }
    if (product.userId === buyerId) throw new ApiError(400, "You can't buy your own product");

    // Service listings don't become shop_orders at all: a shop_orders row is
    // an instant digital-download purchase with no accept/decline step, no
    // delivery state and no activity log. Buying a service instead opens a
    // real custom-offer workspace that waits on the seller's approval.
    // Everything below (digital downloads, courses, links) is unaffected.
    //
    // Free service listings stay on the old path deliberately: there's no
    // Stripe session to drive the webhook that would move the offer out of
    // its pre-payment state, so it would strand at 'pending' forever.
    if (product.listingType === 'service' && product.priceCents > 0) {
      const { ShopCustomOfferService } = await import('./shopCustomOffer.service.js');
      return ShopCustomOfferService.createListingPurchase(buyerId, product, platform);
    }

    const alreadyOwned = await this.findPaidOrder(buyerId, productId);
    if (alreadyOwned) throw new ApiError(409, 'You already own this product');

    const requiresCustomerInfo = this.REQUIRES_CUSTOMER_INFO.has(product.listingType);
    const customerName = customerInfo.customerName?.trim() || null;
    const customerEmail = customerInfo.customerEmail?.trim() || null;
    if (requiresCustomerInfo && (!customerName || !customerEmail)) {
      throw new ApiError(400, 'Name and email are required for this purchase');
    }

    // Snapshot the seller's refund policy so later changes can't revoke a
    // right this buyer is paying for right now.
    const settings = await ShopProductService.getShopSettings(product.userId);
    const policySnapshot = {
      refundsAllowedSnapshot: settings.refundsEnabled,
      refundWindowDaysSnapshot: settings.refundWindowDays,
      refundAfterDownloadSnapshot: settings.refundAfterDownload,
    };

    // ── Free product: no payment, deliver at once ────────────────────────────
    if (product.priceCents === 0) {
      const [order] = await db
        .insert(shopOrders)
        .values({
          productId: product.id,
          buyerId,
          sellerId: product.userId,
          status: 'paid',
          productTitleSnapshot: product.title,
          priceCents: 0,
          chargedCents: 0,
          sellerReceiveCents: 0,
          platformShareCents: 0,
          ...policySnapshot,
          customerName,
          customerEmail,
          paidAt: new Date(),
        })
        .returning();

      await db
        .update(shopProducts)
        .set({ salesCount: sql`${shopProducts.salesCount} + 1` })
        .where(eq(shopProducts.id, product.id));

      await this.notifyPurchase(order).catch(err =>
        logger.error(`[Shop] free-product notify failed: ${err.message}`)
      );

      return { free: true, orderId: order.id };
    }

    // ── Paid product ────────────────────────────────────────────────────────
    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    let connectAccount = await StripeConnectService.getForUser(product.userId);
    // chargesEnabled only refreshes on the account.updated webhook, so a
    // stale false must be re-checked live before rejecting a real sale.
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(product.userId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled) {
      // The seller just lost a sale and would otherwise never know. Told once
      // per day so repeated attempts don't become a stream of alerts.
      await this.notifyPayoutSetupRequired(product).catch(err =>
        logger.error(`[Shop] payout-setup notify failed: ${err.message}`)
      );
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    const fees = this.computeFees(product.priceCents);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    const sellerPriceCents = product.priceCents;
    const platformAndServiceFeeCents = fees.platformAndServiceFeeCents;

    const [order] = await db
      .insert(shopOrders)
      .values({
        productId: product.id,
        buyerId,
        sellerId: product.userId,
        status: 'pending',
        productTitleSnapshot: product.title,
        priceCents: product.priceCents,
        chargedCents: fees.chargedCents,
        sellerReceiveCents: fees.sellerReceiveCents,
        platformShareCents: fees.platformShareCents,
        ...policySnapshot,
        customerName,
        customerEmail,
      })
      .returning();

    const redirectUrls = getRedirectUrls(
      platform,
      FRONTEND_URL,
      '/purchases?checkout_session_id={CHECKOUT_SESSION_ID}&status=success',
      '/purchases?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled'
    );

    // `type: 'shop'` is set on BOTH the session and the payment intent on
    // purpose: the webhook dispatcher reads session.metadata.type, while the
    // wallet buckets transfers by charge.metadata.type.
    const metadata = {
      type: 'shop',
      orderId: order.id,
      productId: product.id,
      buyerId,
      sellerId: product.userId,
    };

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
            line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: sellerPriceCents,
            product_data: {
              name: product.title,
              ...(product.coverUrl ? { images: [product.coverUrl] } : {}),
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: platformAndServiceFeeCents,
            product_data: {
              name: 'Platform & Service Fee',
            },
          },
          quantity: 1,
        },
      ],
      success_url: redirectUrls.successUrl,
      cancel_url: redirectUrls.cancelUrl,
      customer_email: customerEmail || buyer?.email,
      metadata,
      // No transfer_data/application_fee_amount here on purpose — the seller's
      // cut is no longer transferred at charge time. It's held on the
      // platform's own Stripe balance (reserveAmountCents, set in the payment
      // webhook below) and moved to the seller's Connect account by a
      // scheduled job 7 days after paidAt, per the digital-content payout hold.
      payment_intent_data: {
        metadata,
      },
    });

    await db
      .update(shopOrders)
      .set({ stripeSessionId: stripeSession.id, updatedAt: new Date() })
      .where(eq(shopOrders.id, order.id));

    return { free: false, checkoutUrl: stripeSession.url, orderId: order.id };
  }

  /**
   * Payment confirmed.
   *
   * Idempotent by design: the unique index on stripeSessionId plus a
   * pending-only conditional update means Stripe's at-least-once redelivery is
   * a no-op — no duplicate spend rows, no double-counted sales.
   */
  static async handlePaymentWebhook(stripeSession) {
    const orderId = stripeSession.metadata?.orderId;
    if (!orderId) {
      logger.error('[Shop] webhook missing orderId');
      return;
    }

    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    if (!order) {
      logger.error(`[Shop] order not found: ${orderId}`);
      return;
    }
    if (order.status !== 'pending') {
      logger.info(`[Shop] order ${orderId} already ${order.status}, ignoring webhook`);
      return;
    }

    const paidAt = new Date();
    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : (stripeSession.payment_intent?.id ?? null);

    const [updated] = await db
      .update(shopOrders)
      .set({
        status: 'paid',
        paidAt,
        stripePaymentIntentId: paymentIntentId,
        // Held for 7 days from paidAt, then released to the seller's Connect
        // account by the reserve-release cron — see reserveAmountCents comment
        // on the shopOrders schema.
        reserveAmountCents: order.sellerReceiveCents,
        updatedAt: paidAt,
      })
      // Re-assert pending so two concurrent deliveries can't both proceed.
      .where(and(eq(shopOrders.id, orderId), eq(shopOrders.status, 'pending')))
      .returning();

    if (!updated) {
      logger.info(`[Shop] order ${orderId} was claimed concurrently, ignoring`);
      return;
    }

    await db
      .update(shopProducts)
      .set({ salesCount: sql`${shopProducts.salesCount} + 1` })
      .where(eq(shopProducts.id, updated.productId));

    await UserSpendService.recordSpend({
      userId: updated.buyerId,
      spendType: 'shop',
      amountCents: updated.chargedCents,
      referenceId: updated.id,
      referenceType: 'shop_order',
      talentUserId: updated.sellerId,
      metadata: { productId: updated.productId, productTitle: updated.productTitleSnapshot },
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });

    await this.notifyPurchase(updated).catch(err =>
      logger.error(`[Shop] purchase notify failed: ${err.message}`)
    );
  }

  /** Checkout session timed out without payment. */
  static async handlePaymentExpired(stripeSession) {
    const orderId = stripeSession.metadata?.orderId;
    if (!orderId) return;

    await db
      .update(shopOrders)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(shopOrders.id, orderId), eq(shopOrders.status, 'pending')));
  }

  /**
   * Tell a seller a purchase was blocked because their Stripe payouts aren't
   * live yet.
   *
   * Rate-limited by looking for a recent notification of the same type rather
   * than tracking a timestamp column — the notifications table already holds
   * exactly the fact we need, and this keeps the check correct across
   * multiple app instances (an in-memory guard would not).
   */
  static async notifyPayoutSetupRequired(product) {
    const since = new Date(Date.now() - PAYOUT_NOTICE_COOLDOWN_MS);

    const alreadyWarned = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.userId, product.userId),
        eq(notifications.type, PAYOUT_SETUP_NOTIFICATION_TYPE),
        gte(notifications.createdAt, since)
      ),
      columns: { id: true },
    });
    if (alreadyWarned) return;

    await createNotification({
      userId: product.userId,
      title: 'A sale was blocked',
      message:
        `Someone tried to buy "${product.title}" but your payouts aren't set up yet. ` +
        'Finish Stripe setup to start accepting payments.',
      type: PAYOUT_SETUP_NOTIFICATION_TYPE,
      relatedId: product.id,
      // Straight to the Earnings tab, which is where charges get enabled — the
      // dashboard root opens on Video Chat and would leave them hunting.
      redirectTo: PAYOUT_SETUP_PATH,
      metadata: { productId: product.id },
    });

    const seller = await db.query.users.findFirst({
      where: eq(users.id, product.userId),
      columns: { email: true, firstName: true },
    });

    if (seller?.email) {
      await mailService.sendGeneralEmail({
        to: seller.email,
        subject: 'You missed a sale — finish your payout setup',
        message:
          `Hi ${seller.firstName ?? 'there'},<br><br>` +
          `Someone tried to buy <strong>${product.title}</strong> from your shop, but the ` +
          `purchase couldn't go through because your Stripe payout setup isn't complete.<br><br>` +
          `Until it is, your paid products can't be bought.<br><br>` +
          `<a href="${FRONTEND_URL}${PAYOUT_SETUP_PATH}">Finish payout setup</a>`,
      });
    }
  }

  /** In-app notifications for both sides, plus the buyer's delivery email. */
  static async notifyPurchase(order) {
    const [buyer, seller] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, order.buyerId),
        columns: { email: true, firstName: true },
      }),
      db.query.users.findFirst({
        where: eq(users.id, order.sellerId),
        columns: { firstName: true, lastName: true },
      }),
    ]);

    await createNotification({
      userId: order.buyerId,
      title: 'Purchase complete',
      message: `You now own "${order.productTitleSnapshot}".`,
      type: 'purchase_confirmation',
      relatedId: order.id,
      redirectTo: '/purchases',
      metadata: { orderId: order.id, productId: order.productId },
    });

    await createNotification({
      userId: order.sellerId,
      title: 'You made a sale',
      message: `${buyer?.firstName ?? 'Someone'} bought "${order.productTitleSnapshot}".`,
      type: 'payment',
      relatedId: order.id,
      redirectTo: '/talent-dashboard?tab=shop',
      metadata: { orderId: order.id, productId: order.productId },
    });

    if (buyer?.email) {
      const sellerName = [seller?.firstName, seller?.lastName].filter(Boolean).join(' ');
      // Links back to /purchases rather than embedding the file: download URLs
      // expire, and an emailed link would outlive them.
      await mailService.sendGeneralEmail({
        to: buyer.email,
        subject: `Your purchase: ${order.productTitleSnapshot}`,
        message:
          `Thanks for your purchase${sellerName ? ` from ${sellerName}` : ''}.<br><br>` +
          `<strong>${order.productTitleSnapshot}</strong> is ready in your purchases, ` +
          `where you can download it any time.<br><br>` +
          `<a href="${FRONTEND_URL}/purchases">View your purchases</a>`,
      });
    }
  }

  /**
   * A fresh download link for an order the caller owns.
   * Every call re-verifies ownership, so nothing is authorised by URL alone.
   */
  static async getDownload(buyerId, orderId) {
    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.buyerId !== buyerId) throw new ApiError(403, 'This is not your purchase');
    if (order.status !== 'paid') {
      throw new ApiError(403, `This order is ${order.status} and cannot be downloaded`);
    }

    const product = await db.query.shopProducts.findFirst({
      where: eq(shopProducts.id, order.productId),
    });
    if (!product) throw new ApiError(404, 'Product no longer available');

    const result =
      product.deliveryType === 'link'
        ? { url: product.deliveryLink, expiresIn: null }
        : await ShopDeliverableService.getSignedDownloadUrl(
            product.deliveryFileKey,
            product.deliveryFileName
          );

    if (!result.url) throw new ApiError(404, 'This product has nothing to deliver');

    // Stamped for links too — "accessed" is what the refund guard cares about,
    // and a private link can't be un-seen any more than a file can.
    await db
      .update(shopOrders)
      .set({
        downloadCount: sql`${shopOrders.downloadCount} + 1`,
        firstDownloadedAt: order.firstDownloadedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shopOrders.id, orderId));

    return { ...result, fileName: product.deliveryFileName, deliveryType: product.deliveryType };
  }

  /** The buyer's own purchases, newest first. */
  static async listPurchases(buyerId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    // Pending and expired orders are noise to the buyer — only completed
    // purchases and refunds belong in this list.
    const visibleOrders = and(
      eq(shopOrders.buyerId, buyerId),
      sql`${shopOrders.status} IN ('paid', 'refunded')`
    );

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select({
          id: shopOrders.id,
          productId: shopOrders.productId,
          sellerId: shopOrders.sellerId,
          status: shopOrders.status,
          productTitle: shopOrders.productTitleSnapshot,
          chargedCents: shopOrders.chargedCents,
          downloadCount: shopOrders.downloadCount,
          firstDownloadedAt: shopOrders.firstDownloadedAt,
          refundsAllowed: shopOrders.refundsAllowedSnapshot,
          refundWindowDays: shopOrders.refundWindowDaysSnapshot,
          refundAfterDownload: shopOrders.refundAfterDownloadSnapshot,
          refundedAt: shopOrders.refundedAt,
          paidAt: shopOrders.paidAt,
          coverUrl: shopProducts.coverUrl,
          coverType: shopProducts.coverType,
          deliveryType: shopProducts.deliveryType,
          sellerUsername: users.username,
          sellerFirstName: users.firstName,
          sellerLastName: users.lastName,
        })
        .from(shopOrders)
        .innerJoin(shopProducts, eq(shopProducts.id, shopOrders.productId))
        .innerJoin(users, eq(users.id, shopOrders.sellerId))
        .where(visibleOrders)
        .orderBy(desc(shopOrders.paidAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(shopOrders).where(visibleOrders),
    ]);

    return {
      orders: rows.map(row => ({ ...row, refundEligible: this.isRefundEligible(row) })),
      hasMore: rows.length === limit,
      total,
    };
  }

  /**
   * Customer list for one of the seller's own products — the name/email
   * collected at checkout (see REQUIRES_CUSTOMER_INFO), for products/courses
   * where the seller needs a way to reach buyers directly. Powers the
   * "Download CSV" export in the talent dashboard's per-product view.
   */
  static async getProductCustomers(sellerId, productId) {
    const product = await db.query.shopProducts.findFirst({
      where: eq(shopProducts.id, productId),
      columns: { id: true, userId: true, title: true },
    });
    if (!product) throw new ApiError(404, 'Product not found');
    if (product.userId !== sellerId) throw new ApiError(403, 'Not your product');

    const rows = await db
      .select({
        id: shopOrders.id,
        customerName: shopOrders.customerName,
        customerEmail: shopOrders.customerEmail,
        status: shopOrders.status,
        chargedCents: shopOrders.chargedCents,
        paidAt: shopOrders.paidAt,
        buyerFirstName: users.firstName,
        buyerLastName: users.lastName,
        buyerEmail: users.email,
      })
      .from(shopOrders)
      .innerJoin(users, eq(users.id, shopOrders.buyerId))
      .where(
        and(
          eq(shopOrders.productId, productId),
          sql`${shopOrders.status} IN ('paid', 'refunded')`
        )
      )
      .orderBy(desc(shopOrders.paidAt));

    return {
      productTitle: product.title,
      customers: rows.map(row => ({
        id: row.id,
        // Falls back to the buyer's account name/email for older orders
        // placed before customerName/customerEmail existed.
        name: row.customerName || `${row.buyerFirstName} ${row.buyerLastName}`.trim(),
        email: row.customerEmail || row.buyerEmail,
        status: row.status,
        chargedCents: row.chargedCents,
        paidAt: row.paidAt,
      })),
    };
  }

  /**
   * Seller-facing shop analytics. Every figure is measured, not estimated:
   * revenue and orders come from paid shop_orders, views from
   * shop_product_views, so conversion is orders ÷ distinct viewers.
   */
  static async getStats(sellerId) {
  const paidOnly = and(eq(shopOrders.sellerId, sellerId), eq(shopOrders.status, 'paid'));

  // Custom offers count as revenue once money has actually moved — 'accepted'
  // (first installment charged) and 'completed' (fully paid out) both qualify.
  const customOfferPaid = and(
    eq(shopCustomServiceOffers.sellerId, sellerId),
    inArray(shopCustomServiceOffers.status, ['accepted', 'completed'])
  );

  const sellerTalentProfile = await db.query.talentProfiles.findFirst({
    where: eq(talentProfiles.userId, sellerId),
    columns: { id: true },
  });

  const [
    [totals],
    [refunded],
    products,
    monthly,
    transactions,
    [customOfferTotals],
    [customOfferRefunded],
    customOfferMonthly,
    customOfferTransactions,
    customOfferReviews,
    [customOfferReviewAgg],
  ] = await Promise.all([
    db
      .select({
        orders: count(),
        revenueCents: sql`COALESCE(SUM(${shopOrders.sellerReceiveCents}), 0)`,
        grossCents: sql`COALESCE(SUM(${shopOrders.chargedCents}), 0)`,
      })
      .from(shopOrders)
      .where(paidOnly),
    db
      .select({
        count: count(),
        amountCents: sql`COALESCE(SUM(${shopOrders.refundAmountCents}), 0)`,
      })
      .from(shopOrders)
      .where(and(eq(shopOrders.sellerId, sellerId), eq(shopOrders.status, 'refunded'))),
    db
      .select({
        id: shopProducts.id,
        title: shopProducts.title,
        priceCents: shopProducts.priceCents,
        coverUrl: shopProducts.coverUrl,
        buttonAction: shopProducts.buttonAction,
        listingType: shopProducts.listingType,
        viewsCount: shopProducts.viewsCount,
        orders: sql`COUNT(${shopOrders.id})`,
        revenueCents: sql`COALESCE(SUM(${shopOrders.sellerReceiveCents}), 0)`,
      })
      .from(shopProducts)
      .leftJoin(
        shopOrders,
        and(eq(shopOrders.productId, shopProducts.id), eq(shopOrders.status, 'paid'))
      )
      .where(and(eq(shopProducts.userId, sellerId), isNull(shopProducts.deletedAt)))
      .groupBy(shopProducts.id),
    db
      .select({
        month: sql`TO_CHAR(${shopOrders.paidAt}, 'Mon')`,
        monthNum: sql`EXTRACT(MONTH FROM ${shopOrders.paidAt})`,
        revenueCents: sql`COALESCE(SUM(${shopOrders.sellerReceiveCents}), 0)`,
      })
      .from(shopOrders)
      .where(and(paidOnly, sql`${shopOrders.paidAt} >= NOW() - INTERVAL '6 months'`))
      .groupBy(
        sql`TO_CHAR(${shopOrders.paidAt}, 'Mon')`,
        sql`EXTRACT(MONTH FROM ${shopOrders.paidAt})`
      )
      .orderBy(sql`EXTRACT(MONTH FROM ${shopOrders.paidAt})`),
    db
      .select({
        id: shopOrders.id,
        productTitle: shopOrders.productTitleSnapshot,
        status: shopOrders.status,
        chargedCents: shopOrders.chargedCents,
        sellerReceiveCents: shopOrders.sellerReceiveCents,
        paidAt: shopOrders.paidAt,
        refundedAt: shopOrders.refundedAt,
        buyerUsername: users.username,
        buyerFirstName: users.firstName,
        buyerLastName: users.lastName,
      })
      .from(shopOrders)
      .innerJoin(users, eq(users.id, shopOrders.buyerId))
      .where(
        and(eq(shopOrders.sellerId, sellerId), sql`${shopOrders.status} IN ('paid', 'refunded')`)
      )
      .orderBy(desc(shopOrders.paidAt))
      .limit(50),

    // ── Custom offers (services) ─────────────────────────────────────────
    db
      .select({
        orders: count(),
        revenueCents: sql`COALESCE(SUM(${shopCustomServiceOffers.sellerReceiveCents}), 0)`,
        grossCents: sql`COALESCE(SUM(${shopCustomServiceOffers.chargedCents}), 0)`,
      })
      .from(shopCustomServiceOffers)
      .where(customOfferPaid),
    db
      .select({
        count: count(),
        amountCents: sql`COALESCE(SUM(${shopCustomServiceOffers.chargedCents}), 0)`,
      })
      .from(shopCustomServiceOffers)
      .where(
        and(
          eq(shopCustomServiceOffers.sellerId, sellerId),
          eq(shopCustomServiceOffers.status, 'cancelled'),
          sql`${shopCustomServiceOffers.chargedCents} > 0`
        )
      ),
    db
      .select({
        month: sql`TO_CHAR(${shopCustomServiceOffers.resolvedAt}, 'Mon')`,
        monthNum: sql`EXTRACT(MONTH FROM ${shopCustomServiceOffers.resolvedAt})`,
        revenueCents: sql`COALESCE(SUM(${shopCustomServiceOffers.sellerReceiveCents}), 0)`,
      })
      .from(shopCustomServiceOffers)
      .where(
        and(customOfferPaid, sql`${shopCustomServiceOffers.resolvedAt} >= NOW() - INTERVAL '6 months'`)
      )
      .groupBy(
        sql`TO_CHAR(${shopCustomServiceOffers.resolvedAt}, 'Mon')`,
        sql`EXTRACT(MONTH FROM ${shopCustomServiceOffers.resolvedAt})`
      )
      .orderBy(sql`EXTRACT(MONTH FROM ${shopCustomServiceOffers.resolvedAt})`),
    db
      .select({
        id: shopCustomServiceOffers.id,
        productTitle: shopCustomServiceOffers.title,
        status: shopCustomServiceOffers.status,
        chargedCents: shopCustomServiceOffers.chargedCents,
        sellerReceiveCents: shopCustomServiceOffers.sellerReceiveCents,
        paidAt: shopCustomServiceOffers.resolvedAt,
        buyerUsername: users.username,
        buyerFirstName: users.firstName,
        buyerLastName: users.lastName,
      })
      .from(shopCustomServiceOffers)
      .innerJoin(users, eq(users.id, shopCustomServiceOffers.buyerId))
      .where(
        and(
          eq(shopCustomServiceOffers.sellerId, sellerId),
          inArray(shopCustomServiceOffers.status, ['accepted', 'completed', 'cancelled'])
        )
      )
      .orderBy(desc(shopCustomServiceOffers.resolvedAt))
      .limit(50),

    // ── Reviews left on completed custom offers ─────────────────────────
    sellerTalentProfile
      ? db.query.talentReviews.findMany({
          where: and(
            eq(talentReviews.talentProfileId, sellerTalentProfile.id),
            eq(talentReviews.sourceType, 'shop_custom_offer'),
            eq(talentReviews.isVisible, true)
          ),
          with: {
            reviewer: {
              columns: { id: true, firstName: true, lastName: true, username: true, image: true },
            },
          },
          orderBy: (r, { desc }) => [desc(r.createdAt)],
          limit: 50,
        })
      : Promise.resolve([]),
    sellerTalentProfile
      ? db
          .select({
            avgRating: sql`round(avg(${talentReviews.rating})::numeric, 2)`,
            avgCommunicationRating: sql`round(avg(${talentReviews.communicationRating})::numeric, 2)`,
            avgValueRating: sql`round(avg(${talentReviews.valueRating})::numeric, 2)`,
            totalReviews: sql`count(*)::int`,
          })
          .from(talentReviews)
          .where(
            and(
              eq(talentReviews.talentProfileId, sellerTalentProfile.id),
              eq(talentReviews.sourceType, 'shop_custom_offer'),
              eq(talentReviews.isVisible, true)
            )
          )
      : Promise.resolve([
          { avgRating: 0, avgCommunicationRating: 0, avgValueRating: 0, totalReviews: 0 },
        ]),
  ]);

  const orders = Number(totals?.orders ?? 0);
  const revenueCents = Number(totals?.revenueCents ?? 0);
  const totalViews = products.reduce((sum, p) => sum + Number(p.viewsCount ?? 0), 0);

  const enrichedProducts = products
    .map(p => {
      const productOrders = Number(p.orders ?? 0);
      const views = Number(p.viewsCount ?? 0);
      return {
        id: p.id,
        title: p.title,
        priceCents: p.priceCents,
        coverUrl: p.coverUrl,
        buttonAction: p.buttonAction,
        listingType: p.listingType,
        views,
        orders: productOrders,
        revenueCents: Number(p.revenueCents ?? 0),
        conversion: views > 0 ? (productOrders / views) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // ── Custom offer numbers ────────────────────────────────────────────────
  const customOfferOrders = Number(customOfferTotals?.orders ?? 0);
  const customOfferRevenueCents = Number(customOfferTotals?.revenueCents ?? 0);

  // ── Merge product + service monthly revenue into one 6-month chart ─────
  const chartByMonth = new Map();
  for (const row of monthly) {
    chartByMonth.set(String(row.month).trim(), {
      month: String(row.month).trim(),
      revenue: Math.round(Number(row.revenueCents ?? 0) / 100),
      serviceRevenue: 0,
    });
  }
  for (const row of customOfferMonthly) {
    const key = String(row.month).trim();
    const existing = chartByMonth.get(key) ?? { month: key, revenue: 0, serviceRevenue: 0 };
    existing.serviceRevenue = Math.round(Number(row.revenueCents ?? 0) / 100);
    chartByMonth.set(key, existing);
  }

  // ── Fill in the full 6-month window so the chart shows real trend context
  // instead of only the sparse months that happened to have a sale — a
  // single isolated bar with everything else missing looked empty/broken.
  const now = new Date();
  const chart = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthDate.toLocaleString('en-US', { month: 'short' });
    const existing = chartByMonth.get(key);
    chart.push({
      month: key,
      revenue: existing?.revenue ?? 0,
      serviceRevenue: existing?.serviceRevenue ?? 0,
    });
  }

  // ── Merge transactions (products + services), newest first ─────────────
  const combinedTransactions = [
    ...transactions.map(t => ({ ...t, type: 'product' })),
    ...customOfferTransactions.map(t => ({ ...t, type: 'service' })),
  ]
    .sort((a, b) => new Date(b.paidAt ?? 0) - new Date(a.paidAt ?? 0))
    .slice(0, 50);

  return {
    summary: {
      revenueCents,
      orders,
      products: products.length,
      avgOrderCents: orders > 0 ? Math.round(revenueCents / orders) : 0,
      views: totalViews,
      conversion: totalViews > 0 ? (orders / totalViews) * 100 : 0,
      refundedCount: Number(refunded?.count ?? 0),
      refundedCents: Number(refunded?.amountCents ?? 0),
      // Combined across products + services, for a single top-line number
      combinedRevenueCents: revenueCents + customOfferRevenueCents,
      combinedOrders: orders + customOfferOrders,
    },
    customOffers: {
      revenueCents: customOfferRevenueCents,
      orders: customOfferOrders,
      avgOrderCents:
        customOfferOrders > 0 ? Math.round(customOfferRevenueCents / customOfferOrders) : 0,
      refundedCount: Number(customOfferRefunded?.count ?? 0),
      refundedCents: Number(customOfferRefunded?.amountCents ?? 0),
    },
    reviews: {
      avgRating: parseFloat(customOfferReviewAgg?.avgRating) || 0,
      avgCommunicationRating: parseFloat(customOfferReviewAgg?.avgCommunicationRating) || 0,
      avgValueRating: parseFloat(customOfferReviewAgg?.avgValueRating) || 0,
      totalReviews: Number(customOfferReviewAgg?.totalReviews ?? 0),
      items: customOfferReviews,
    },
    chart,
    topProducts: enrichedProducts.slice(0, 5),
    allProducts: enrichedProducts,
    transactions: combinedTransactions,
  };
}

  /**
   * Whether a buyer may still request a refund, judged entirely against the
   * policy snapshot taken at purchase rather than the seller's live settings.
   */
  static isRefundEligible(order) {
    if (order.status !== 'paid') return false;
    if (order.refundedAt) return false;
    if (!order.refundsAllowed) return false;
    if (order.firstDownloadedAt && !order.refundAfterDownload) return false;
    if (!order.paidAt) return false;

    const deadline = new Date(order.paidAt);
    deadline.setDate(deadline.getDate() + order.refundWindowDays);
    return new Date() <= deadline;
  }
}
