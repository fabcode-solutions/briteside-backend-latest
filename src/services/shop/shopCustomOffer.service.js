import Stripe from 'stripe';
import { db } from '../../db/index.js';
import {
  shopCustomServiceOffers,
  shopProducts,
  users,
  talentReviews,
} from '../../db/schema/index.js';
import { eq, and, desc, count, inArray, sql, lte } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { StripeConnectService } from '../stripeConnect.service.js';
import { UserSpendService } from '../userSpend.service.js';
import { createNotification } from '../notification.service.js';
import { ShopOrderService } from './shopOrder.service.js';
import { emitSocialChat } from '../../socket/emitter.js';
import { ShopDeliverableService } from './shopDeliverable.service.js';
import { shopCustomOfferDeliverables } from '../../db/schema/index.js';
const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
import {
  shopCustomOfferActivity,
  shopCustomOfferRevisionRequests,
  shopCustomOfferDateExtensionRequests,
  shopCustomOfferTips,
  shopCustomOfferDisputes,
} from '../../db/schema/index.js';

const PAYMENT_MODES = ['full', 'deposit', 'milestones'];
const MAX_MILESTONES = 10;
const OFFER_TTL_DAYS = 7;
const AUTO_APPROVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export class ShopCustomOfferService {
  /** Same shape of checks as ShopProductService.validate, scoped to what an offer needs. */
  static validate(data) {
    if (!data.title?.trim()) throw new ApiError(400, 'Title is required');
    if (data.title.length > 200) throw new ApiError(400, 'Title must be 200 characters or fewer');

    if (!data.description?.trim())
      throw new ApiError(400, "Description of what's included is required");

    const price = Number(data.priceCents);
    if (!Number.isInteger(price) || price <= 0) {
      throw new ApiError(400, 'Price must be a positive whole number of cents');
    }

    const turnaroundMinutes = Number(data.turnaroundMinutes);
    if (!Number.isInteger(turnaroundMinutes) || turnaroundMinutes <= 0) {
      throw new ApiError(400, 'A turnaround duration is required');
    }
    if (turnaroundMinutes > 90 * 24 * 60) {
      throw new ApiError(400, 'Turnaround cannot exceed 90 days');
    }

    if (data.revisionsIncluded) {
      const r = Number(data.revisionsCount);
      if (!Number.isFinite(r) || r < 1) {
        throw new ApiError(400, 'revisionsCount must be at least 1 when revisions are included');
      }
    }

    const paymentMode = data.paymentMode ?? 'full';
    if (!PAYMENT_MODES.includes(paymentMode)) {
      throw new ApiError(400, `paymentMode must be one of: ${PAYMENT_MODES.join(', ')}`);
    }

    if (paymentMode === 'deposit') {
      const pct = Number(data.depositPercent);
      if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
        throw new ApiError(400, 'depositPercent must be a whole number between 1 and 100');
      }
    }

    if (paymentMode === 'milestones') {
      if (!Array.isArray(data.milestones) || data.milestones.length < 2) {
        throw new ApiError(400, 'milestones must have at least 2 entries');
      }
      if (data.milestones.length > MAX_MILESTONES) {
        throw new ApiError(400, `No more than ${MAX_MILESTONES} milestones`);
      }
      const malformed = data.milestones.some(
        m => !m?.label?.trim() || !Number.isFinite(Number(m?.percent)) || Number(m?.percent) <= 0
      );
      if (malformed)
        throw new ApiError(400, 'Each milestone needs a label and a percentage greater than 0');

      const total = data.milestones.reduce((sum, m) => sum + Number(m.percent), 0);
      if (Math.round(total) !== 100)
        throw new ApiError(400, 'Milestone percentages must add up to 100');
    }

    if (data.attachments !== undefined) {
      if (!Array.isArray(data.attachments)) throw new ApiError(400, 'attachments must be an array');
      if (data.attachments.length > 10) throw new ApiError(400, 'No more than 10 attachments');
      const malformed = data.attachments.some(a => !a?.fileKey?.trim() || !a?.fileName?.trim());
      if (malformed) throw new ApiError(400, 'Each attachment needs a fileKey and fileName');
    }
  }

  /** Strips stored attachments down to what's safe to insert — the shape a
   *  client can actually produce from POST /shop/deliverable. */
  static _sanitizeAttachmentsInput(attachments) {
    if (!Array.isArray(attachments)) return [];
    return attachments.map(a => ({
      fileKey: a.fileKey,
      fileName: a.fileName,
      fileType: a.fileType || 'application/octet-stream',
    }));
  }

  /** Turns stored {fileKey, fileName, fileType} rows into client-facing
   *  {fileName, fileType, url} — same on-demand signing listDeliverables uses,
   *  so a leaked/expired link is never persisted anywhere. */
  static async _resolveAttachmentUrls(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    return Promise.all(
      attachments.map(async a => {
        try {
          const { url } = await ShopDeliverableService.getSignedDownloadUrl(a.fileKey, a.fileName);
          return { fileName: a.fileName, fileType: a.fileType, url };
        } catch (err) {
          logger.error(`[ShopCustomOffer] attachment URL sign failed: ${err.message}`);
          return { fileName: a.fileName, fileType: a.fileType, url: null };
        }
      })
    );
  }

  /** Drops the raw {fileKey}-shaped attachments column from an offer row
   *  before it reaches the client. Used by every action endpoint that isn't
   *  the create/list paths: those already resolve real download URLs, and an
   *  action response merged over that local state (`{...prev, ...offer}` on
   *  the frontend) would otherwise silently replace working links with
   *  fileKeys the browser can't do anything with. Attachments never change
   *  after creation, so dropping the key here just leaves the client's
   *  already-resolved copy alone. */
  static _stripAttachments(offer) {
    if (!offer) return offer;
    const { attachments, ...rest } = offer;
    return rest;
  }

  static _emitOfferUpdate(io, offer, event = 'shop:custom-offer:updated') {
    if (!io || !offer) return;
    try {
      emitSocialChat(io, `user:${offer.buyerId}`, event, { offerId: offer.id });
      emitSocialChat(io, `user:${offer.sellerId}`, event, { offerId: offer.id });
    } catch (err) {
      logger.error(`[ShopCustomOffer] socket emit failed (${event}): ${err.message}`);
    }
  }
  /**
   * Seller sends an offer to a specific buyer. `basedOnProductId`, when
   * given, must belong to the seller — otherwise someone could reference an
   * arbitrary listing to spoof legitimacy in the buyer's inbox.
   */
  static async createOffer(sellerId, buyerId, data, io = null) {
    if (sellerId === buyerId) throw new ApiError(400, "You can't send an offer to yourself");
    this.validate(data);

    if (data.basedOnProductId) {
      const source = await db.query.shopProducts.findFirst({
        where: eq(shopProducts.id, data.basedOnProductId),
        columns: { userId: true },
      });
      if (!source || source.userId !== sellerId) {
        throw new ApiError(403, 'That listing is not yours');
      }
    }

    const [offer] = await db
      .insert(shopCustomServiceOffers)
      .values({
        sellerId,
        buyerId,
        basedOnProductId: data.basedOnProductId || null,
        title: data.title.trim(),
        description: data.description.trim(),
        priceCents: Number(data.priceCents),
        turnaround: data.turnaround?.trim() || null, // display text
        turnaroundMinutes: Number(data.turnaroundMinutes), // NEW — the real duration
        dueDate: null, // NEW — computed on accept, not now
        deliverables: data.deliverables?.trim() || null,
        revisionsIncluded: !!data.revisionsIncluded,
        revisionsCount: data.revisionsIncluded ? Number(data.revisionsCount) : null,
        paymentMode: data.paymentMode ?? 'full',
        depositPercent: data.paymentMode === 'deposit' ? Number(data.depositPercent) : null,
        milestones: data.paymentMode === 'milestones' ? data.milestones : null,
        note: data.note?.trim() || null,
        attachments: this._sanitizeAttachmentsInput(data.attachments),
        expiresAt: new Date(Date.now() + OFFER_TTL_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning()
      .catch(err => {
        console.error('=== INSERT FAILED ===');
        console.error('code:', err.cause?.code);
        console.error('detail:', err.cause?.detail);
        console.error('column:', err.cause?.column);
        console.error('constraint:', err.cause?.constraint);
        console.error('table:', err.cause?.table);
        console.error('message:', err.cause?.message);
        throw err;
      });
    await this.logActivity(offer.id, sellerId, 'offer_sent', {
      buyerId,
      priceCents: offer.priceCents,
    });
    await createNotification({
      userId: buyerId,
      title: 'Custom offer received',
      message: `You've received a custom service offer: "${offer.title}".`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: '/bookings?tab=requests',
      metadata: { offerId: offer.id, sellerId },
    }).catch(err => logger.error(`[ShopCustomOffer] buyer notify failed: ${err.message}`));

    // Live push so a buyer already sitting on /bookings?tab=requests sees the
    // offer appear without a refresh — mirrors talent:request:new for video
    // session requests.
    if (io) {
      try {
        emitSocialChat(io, `user:${buyerId}`, 'shop:custom-offer:new', {
          offerId: offer.id,
          sellerId,
        });
      } catch (err) {
        logger.error(`[ShopCustomOffer] socket emit failed: ${err.message}`);
      }
    }

    return { ...offer, attachments: await this._resolveAttachmentUrls(offer.attachments) };
  }

  static async loadOffer(offerId) {
    const offer = await db.query.shopCustomServiceOffers.findFirst({
      where: eq(shopCustomServiceOffers.id, offerId),
    });
    if (!offer) throw new ApiError(404, 'Offer not found');
    return offer;
  }

  static async assertNotExpired(offer) {
    if (offer.status === 'pending' && offer.expiresAt && new Date() > offer.expiresAt) {
      await db
        .update(shopCustomServiceOffers)
        .set({ status: 'expired', resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(shopCustomServiceOffers.id, offer.id));
      throw new ApiError(409, 'This offer has expired');
    }
  }

  static async listSentBySeller(sellerId) {
    const rows = await db
      .select({
        id: shopCustomServiceOffers.id,
        sellerId: shopCustomServiceOffers.sellerId,
        buyerId: shopCustomServiceOffers.buyerId,
        basedOnProductId: shopCustomServiceOffers.basedOnProductId,
        title: shopCustomServiceOffers.title,
        description: shopCustomServiceOffers.description,
        priceCents: shopCustomServiceOffers.priceCents,
        turnaround: shopCustomServiceOffers.turnaround,
        dueDate: shopCustomServiceOffers.dueDate,
        deliverables: shopCustomServiceOffers.deliverables,
        revisionsIncluded: shopCustomServiceOffers.revisionsIncluded,
        revisionsCount: shopCustomServiceOffers.revisionsCount,
        paymentMode: shopCustomServiceOffers.paymentMode,
        depositPercent: shopCustomServiceOffers.depositPercent,
        milestones: shopCustomServiceOffers.milestones,
        note: shopCustomServiceOffers.note,
        attachments: shopCustomServiceOffers.attachments,
        status: shopCustomServiceOffers.status,
        deliveryState: shopCustomServiceOffers.deliveryState,
        deliveredAt: shopCustomServiceOffers.deliveredAt,
        chargedCents: shopCustomServiceOffers.chargedCents,
        basePriceCoveredCents: shopCustomServiceOffers.basePriceCoveredCents, // NEW — lets the frontend show the real remaining balance instead of guessing from paymentMode
        expiresAt: shopCustomServiceOffers.expiresAt,
        resolvedAt: shopCustomServiceOffers.resolvedAt,
        createdAt: shopCustomServiceOffers.createdAt,
        buyerUsername: users.username,
        buyerFirstName: users.firstName,
        buyerLastName: users.lastName,
        buyerProfileImage: users.image,
      })
      .from(shopCustomServiceOffers)
      .innerJoin(users, eq(users.id, shopCustomServiceOffers.buyerId))
      .where(eq(shopCustomServiceOffers.sellerId, sellerId))
      .orderBy(desc(shopCustomServiceOffers.createdAt));

    return this._withBasedOnTitles(await this._withResolvedAttachments(rows));
  }

  /** Resolves every row's stored {fileKey}-shaped attachments into
   *  client-facing {fileName, fileType, url} — see _resolveAttachmentUrls. */
  static async _withResolvedAttachments(rows) {
    return Promise.all(
      rows.map(async row => ({
        ...row,
        attachments: await this._resolveAttachmentUrls(row.attachments),
      }))
    );
  }

  static async listReceivedByBuyer(buyerId) {
    const rows = await db
      .select({
        id: shopCustomServiceOffers.id,
        sellerId: shopCustomServiceOffers.sellerId,
        buyerId: shopCustomServiceOffers.buyerId,
        basedOnProductId: shopCustomServiceOffers.basedOnProductId,
        title: shopCustomServiceOffers.title,
        description: shopCustomServiceOffers.description,
        priceCents: shopCustomServiceOffers.priceCents,
        turnaround: shopCustomServiceOffers.turnaround,
        dueDate: shopCustomServiceOffers.dueDate,
        deliverables: shopCustomServiceOffers.deliverables,
        revisionsIncluded: shopCustomServiceOffers.revisionsIncluded,
        revisionsCount: shopCustomServiceOffers.revisionsCount,
        paymentMode: shopCustomServiceOffers.paymentMode,
        depositPercent: shopCustomServiceOffers.depositPercent,
        milestones: shopCustomServiceOffers.milestones,
        note: shopCustomServiceOffers.note,
        attachments: shopCustomServiceOffers.attachments,
        deliveryState: shopCustomServiceOffers.deliveryState, // NEW
        revisionsUsedCount: shopCustomServiceOffers.revisionsUsedCount,
        status: shopCustomServiceOffers.status,
        chargedCents: shopCustomServiceOffers.chargedCents,
        basePriceCoveredCents: shopCustomServiceOffers.basePriceCoveredCents,
        sellerReceiveCents: shopCustomServiceOffers.sellerReceiveCents,
        expiresAt: shopCustomServiceOffers.expiresAt,
        resolvedAt: shopCustomServiceOffers.resolvedAt,
        createdAt: shopCustomServiceOffers.createdAt,
        sellerUsername: users.username,
        sellerFirstName: users.firstName,
        sellerLastName: users.lastName,
        sellerProfileImage: users.image,
      })
      .from(shopCustomServiceOffers)
      .innerJoin(users, eq(users.id, shopCustomServiceOffers.sellerId))
      .where(eq(shopCustomServiceOffers.buyerId, buyerId))
      .orderBy(desc(shopCustomServiceOffers.createdAt));

    const withTitles = await this._withBasedOnTitles(await this._withResolvedAttachments(rows));
    return this._withReviewFlags(withTitles, buyerId);
  }

  /**
   * Flags completed offers the buyer has already reviewed, keyed off
   * talentReviews.shopCustomOfferId, so the client can show a "leave a
   * review" reminder without a per-offer round-trip.
   */
  static async _withReviewFlags(rows, buyerId) {
    const completedIds = rows.filter(r => r.status === 'completed').map(r => r.id);
    if (!completedIds.length) return rows.map(r => ({ ...r, alreadyReviewed: false }));

    const existing = await db
      .select({ shopCustomOfferId: talentReviews.shopCustomOfferId })
      .from(talentReviews)
      .where(
        and(
          inArray(talentReviews.shopCustomOfferId, completedIds),
          eq(talentReviews.reviewerId, buyerId)
        )
      );
    const reviewedSet = new Set(existing.map(e => e.shopCustomOfferId));

    return rows.map(r => ({
      ...r,
      alreadyReviewed: r.status === 'completed' ? reviewedSet.has(r.id) : false,
    }));
  }

  /**
   * Batch-resolves basedOnProductId → product title for a set of offer rows.
   */
  static async _withBasedOnTitles(rows) {
    const productIds = [...new Set(rows.map(r => r.basedOnProductId).filter(Boolean))];
    const titleById = new Map();

    if (productIds.length) {
      const products = await db
        .select({ id: shopProducts.id, title: shopProducts.title })
        .from(shopProducts)
        .where(inArray(shopProducts.id, productIds));
      products.forEach(p => titleById.set(p.id, p.title));
    }

    return rows.map(r => ({
      ...r,
      basedOnTitle: r.basedOnProductId ? (titleById.get(r.basedOnProductId) ?? null) : null,
    }));
  }

  static async pendingCountForBuyer(buyerId) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(shopCustomServiceOffers)
      .where(
        and(
          eq(shopCustomServiceOffers.buyerId, buyerId),
          eq(shopCustomServiceOffers.status, 'pending')
        )
      );
    return value;
  }

  static async withdrawOffer(sellerId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== sellerId) throw new ApiError(403, 'This is not your offer');
    if (offer.status !== 'pending')
      throw new ApiError(409, `This offer was already ${offer.status}`);

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({ status: 'withdrawn', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(shopCustomServiceOffers.id, offerId))
      .returning();

    await this.logActivity(offerId, sellerId, 'offer_withdrawn', {});

    this._emitOfferUpdate(io, updated);
    return this._stripAttachments(updated);
  }

  static async declineOffer(buyerId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not for you');
    if (offer.status !== 'pending')
      throw new ApiError(409, `This offer was already ${offer.status}`);
    await this.assertNotExpired(offer);

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({ status: 'declined', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(shopCustomServiceOffers.id, offerId))
      .returning();

    await this.logActivity(offerId, buyerId, 'offer_declined', {});

    await createNotification({
      userId: offer.sellerId,
      title: 'Custom offer declined',
      message: `Your offer "${offer.title}" was declined.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id },
    }).catch(err => logger.error(`[ShopCustomOffer] decline notify failed: ${err.message}`));
    this._emitOfferUpdate(io, updated);
    return this._stripAttachments(updated);
  }

  /**
   * Buyer accepts and pays the first installment (full price, the deposit,
   * or milestone[0]) through Stripe Checkout. Fee split mirrors
   * ShopOrderService.computeFees exactly, so custom offers earn the same
   * take rate as catalog sales.
   */
  static async createAcceptCheckout(buyerId, offerId, platform) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not for you');
    if (offer.status !== 'pending')
      throw new ApiError(409, `This offer was already ${offer.status}`);
    await this.assertNotExpired(offer);

    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    let connectAccount = await StripeConnectService.getForUser(offer.sellerId);
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(offer.sellerId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled) {
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    let installmentBase = offer.priceCents;
    if (offer.paymentMode === 'deposit') {
      installmentBase = Math.round((offer.priceCents * offer.depositPercent) / 100);
    } else if (offer.paymentMode === 'milestones') {
      const first = offer.milestones?.[0];
      if (!first) throw new ApiError(400, 'This offer has no milestone schedule');
      installmentBase = Math.round((offer.priceCents * Number(first.percent)) / 100);
    }

    const fees = ShopOrderService.computeFees(installmentBase);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    const metadata = {
      type: 'shop_custom_offer',
      offerId: offer.id,
      buyerId,
      sellerId: offer.sellerId,
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: installmentBase,
            product_data: { name: offer.title },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: fees.platformAndServiceFeeCents,
            product_data: { name: 'Platform & Service Fee' },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/bookings`,
      cancel_url: `${process.env.FRONTEND_URL}/bookings`,
      customer_email: buyer?.email,
      // NEW — only worth saving the card when there's a remainder left to
      // collect later. A 'full' payment offer has nothing left to charge, so
      // skip the Customer object and setup_future_usage entirely for it.
      ...(offer.paymentMode !== 'full' && {
        customer_creation: 'always',
      }),
      metadata,
      // No transfer_data/application_fee_amount here on purpose — the
      // seller's cut is no longer transferred at charge time. It accumulates
      // in reserveAmountCents and is moved to the seller's Connect account by
      // a scheduled job 48h after the work is delivered.
      payment_intent_data: {
        metadata,
        // NEW — tells Stripe to keep this payment method attached to the
        // Customer for a later off-session charge (the completion charge).
        ...(offer.paymentMode !== 'full' && {
          setup_future_usage: 'off_session',
        }),
      },
    });

    await db
      .update(shopCustomServiceOffers)
      .set({
        stripeSessionId: session.id,
        chargedCents: fees.chargedCents,
        basePriceCoveredCents: installmentBase,
        sellerReceiveCents: fees.sellerReceiveCents,
        platformShareCents: fees.platformShareCents,
        updatedAt: new Date(),
      })
      .where(eq(shopCustomServiceOffers.id, offer.id));

    return { checkoutUrl: session.url, offerId: offer.id };
  }

  /** Webhook target — mirrors ShopOrderService.handlePaymentWebhook's idempotency shape. */
  static async handlePaymentWebhook(stripeSession) {
    const offerId = stripeSession.metadata?.offerId;
    if (!offerId) return;

    const offer = await db.query.shopCustomServiceOffers.findFirst({
      where: eq(shopCustomServiceOffers.id, offerId),
    });
    if (!offer || offer.status !== 'pending') return;

    const paidAt = new Date();
    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : (stripeSession.payment_intent?.id ?? null);

    // NEW — the reusable customer, present only when createAcceptCheckout
    // requested customer_creation (deposit/milestones offers).
    const stripeCustomerId =
      typeof stripeSession.customer === 'string'
        ? stripeSession.customer
        : (stripeSession.customer?.id ?? null);

    const computedDueDate = offer.turnaroundMinutes
      ? new Date(paidAt.getTime() + offer.turnaroundMinutes * 60_000)
      : null;

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({
        status: 'accepted',
        stripePaymentIntentId: paymentIntentId,
        stripeCustomerId, // NEW
        dueDate: computedDueDate, // NEW — the real due date, set here for the first time
        resolvedAt: paidAt,
        // Held (not transferred) until 48h after delivery — see createAcceptCheckout.
        reserveAmountCents: offer.sellerReceiveCents ?? 0,
        updatedAt: paidAt,
      })
      .where(
        and(eq(shopCustomServiceOffers.id, offerId), eq(shopCustomServiceOffers.status, 'pending'))
      )
      .returning();

    if (!updated) return; // claimed concurrently

    await this.logActivity(updated.id, updated.buyerId, 'offer_accepted', {
      chargedCents: updated.chargedCents,
      paymentMode: updated.paymentMode,
    });

    await UserSpendService.recordSpend({
      userId: updated.buyerId,
      spendType: 'shop',
      amountCents: updated.chargedCents,
      referenceId: updated.id,
      referenceType: 'shop_custom_offer',
      talentUserId: updated.sellerId,
      metadata: { offerId: updated.id, title: updated.title },
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });

    await createNotification({
      userId: updated.sellerId,
      title: 'Custom offer accepted',
      title: 'Custom offer accepted',
      message: `${updated.title} was accepted and paid.`,
      type: 'shop_custom_offer',
      relatedId: updated.id,
      redirectTo: `/bookings?offerId=${updated.id}`,
      metadata: { offerId: updated.id },
    }).catch(err => logger.error(`[ShopCustomOffer] accept notify failed: ${err.message}`));
  }

  /**
   * Cancels an accepted offer and refunds whatever was charged.
   *
   * Idempotent against Stripe: if a refund for this payment intent already
   * exists (e.g. a previous attempt refunded successfully but the DB update
   * that follows it never landed — a crash, a timeout, a duplicate click),
   * this reuses that refund instead of calling `refunds.create` again, which
   * Stripe would reject with "Charge has already been refunded" and leave
   * the row stuck at status = 'accepted' forever.
   */
  static async cancelOffer(userId, offerId, { reason } = {}, io = null) {
    const offer = await this.loadOffer(offerId);

    if (offer.buyerId !== userId && offer.sellerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Only an accepted offer can be cancelled (this one is ${offer.status})`
      );
    }

    let stripeRefundId = null;

    if (offer.chargedCents > 0) {
      if (!stripe) throw new ApiError(503, 'Payments are not configured');
      if (!offer.stripePaymentIntentId) {
        throw new ApiError(400, 'This offer has no payment to refund');
      }

      // Check for an existing refund on this payment intent first, so a
      // retry after a partial failure never re-hits Stripe.
      const existing = await stripe.refunds.list({
        payment_intent: offer.stripePaymentIntentId,
        limit: 1,
      });
      if (existing.data.length > 0) {
        stripeRefundId = existing.data[0].id;
        logger.warn(
          `[ShopCustomOffer] offer ${offer.id} already had refund ${stripeRefundId} on Stripe — DB was out of sync, reconciling.`
        );
      } else {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: offer.stripePaymentIntentId,
            reason: 'requested_by_customer',
            // Claw the money back out of the seller's Connect balance while
            // the platform keeps its own fee.
            reverse_transfer: true,
            refund_application_fee: false,
            metadata: { offerId: offer.id, cancelledBy: userId },
          });
          stripeRefundId = refund.id;
        } catch (err) {
          // Race: refunded between our list() check and create() — Stripe
          // is the source of truth here, so look up the refund it made
          // instead of failing the whole cancellation.
          if (err?.code === 'charge_already_refunded') {
            const retry = await stripe.refunds.list({
              payment_intent: offer.stripePaymentIntentId,
              limit: 1,
            });
            stripeRefundId = retry.data[0]?.id ?? null;
          } else {
            throw err;
          }
        }
      }
    }

    const now = new Date();
    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({
        status: 'cancelled',
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(shopCustomServiceOffers.id, offerId), eq(shopCustomServiceOffers.status, 'accepted'))
      )
      .returning();

    if (!updated) throw new ApiError(409, 'This offer was already resolved');

    await this.logActivity(offerId, userId, 'offer_cancelled', {
      reason: reason || null,
      refundedCents: offer.chargedCents ?? 0,
    });

    if (offer.chargedCents > 0) {
      await UserSpendService.markSpendRefunded({
        userId: offer.buyerId,
        referenceId: offer.id,
        referenceType: 'shop_custom_offer',
        spendType: 'shop',
        refundMeta: { source: 'shop_custom_offer_cancel', stripeRefundId },
      }).catch(err => logger.error(`[ShopCustomOffer] markSpendRefunded failed: ${err.message}`));
    }

    const cancelledByBuyer = userId === offer.buyerId;
    const otherPartyId = cancelledByBuyer ? offer.sellerId : offer.buyerId;

    await createNotification({
      userId: otherPartyId,
      title: 'Project cancelled',
      message: reason
        ? `"${offer.title}" was cancelled: ${reason}`
        : `"${offer.title}" was cancelled.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, refundedCents: offer.chargedCents ?? 0 },
    }).catch(err => logger.error(`[ShopCustomOffer] cancel notify failed: ${err.message}`));
    this._emitOfferUpdate(io, updated);
    return this._stripAttachments(updated);
  }
  static async completeOffer(sellerId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== sellerId) throw new ApiError(403, 'This is not your offer');
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Only an accepted offer can be completed (this one is ${offer.status})`
      );
    }

    const [{ value: deliverableCount }] = await db
      .select({ value: count() })
      .from(shopCustomOfferDeliverables)
      .where(eq(shopCustomOfferDeliverables.offerId, offer.id));

    if (deliverableCount === 0) {
      throw new ApiError(400, 'Submit proof of work before marking this service completed');
    }

    const result = await this._chargeRemainderAndFinalize(offer, sellerId);
    this._emitOfferUpdate(io, result.offer);
    return result;
  }

  static async acceptDelivery(buyerId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not yours');
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Only an in-progress offer can be accepted (this one is ${offer.status})`
      );
    }
    if (offer.deliveryState !== 'delivered') {
      throw new ApiError(409, 'There is no delivery waiting for your review on this offer');
    }

    const result = await this._chargeRemainderAndFinalize(offer, buyerId);
    this._emitOfferUpdate(io, result.offer); // ← added
    return result;
  }

  /**
   * Shared by completeOffer (seller-initiated), acceptDelivery (buyer-initiated),
   * and autoApproveOverdueDeliveries (system-initiated after the 3-day review
   * window). Charges any remaining balance off-session and finalizes, or falls
   * back to a hosted Checkout link if the card needs 3DS.
   */
  static async _chargeRemainderAndFinalize(offer, actorUserId) {
    const remainingCents = Math.max(0, offer.priceCents - (offer.basePriceCoveredCents || 0));
    if (remainingCents === 0) {
      return {
        offer: await this._finalizeCompletion(offer, {}, actorUserId),
        requiresBuyerPayment: false,
      };
    }

    if (!stripe) throw new ApiError(503, 'Payments are not configured');
    if (!offer.stripeCustomerId) {
      throw new ApiError(400, 'No saved payment method on file for the remaining balance');
    }

    const connectAccount = await StripeConnectService.getForUser(offer.sellerId);
    if (!connectAccount?.chargesEnabled) {
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    const fees = ShopOrderService.computeFees(remainingCents);

    const paymentMethods = await stripe.paymentMethods.list({
      customer: offer.stripeCustomerId,
      type: 'card',
      limit: 1,
    });
    const paymentMethodId = paymentMethods.data[0]?.id;
    if (!paymentMethodId) {
      throw new ApiError(400, 'No saved payment method on file for the remaining balance');
    }

    const metadata = {
      type: 'shop_custom_offer_completion',
      offerId: offer.id,
      buyerId: offer.buyerId,
      sellerId: offer.sellerId,
    };

    try {
      // No transfer_data/application_fee_amount here on purpose — see
      // createAcceptCheckout. This charge's seller cut accumulates into
      // reserveAmountCents instead of transferring immediately.
      const paymentIntent = await stripe.paymentIntents.create({
        amount: fees.chargedCents,
        currency: 'usd',
        customer: offer.stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata,
      });

      const updated = await this._finalizeCompletion(
        offer,
        {
          chargedCents: offer.chargedCents + fees.chargedCents,
          basePriceCoveredCents: (offer.basePriceCoveredCents || 0) + remainingCents,
          sellerReceiveCents: (offer.sellerReceiveCents || 0) + fees.sellerReceiveCents,
          platformShareCents: (offer.platformShareCents || 0) + fees.platformShareCents,
          reserveAmountCents: (offer.reserveAmountCents || 0) + fees.sellerReceiveCents,
          stripePaymentIntentId: paymentIntent.id,
        },
        actorUserId
      );

      return { offer: updated, requiresBuyerPayment: false };
    } catch (err) {
      if (err?.code === 'authentication_required' || err?.raw?.code === 'authentication_required') {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          customer: offer.stripeCustomerId,
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: remainingCents,
                product_data: { name: `${offer.title} — remaining balance` },
              },
              quantity: 1,
            },
            {
              price_data: {
                currency: 'usd',
                unit_amount: fees.platformAndServiceFeeCents,
                product_data: { name: 'Platform & Service Fee' },
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.FRONTEND_URL}/bookings`,
          cancel_url: `${process.env.FRONTEND_URL}/bookings`,
          metadata: { ...metadata, type: 'shop_custom_offer_completion_retry' },
          // No transfer_data/application_fee_amount here on purpose — see
          // createAcceptCheckout.
          payment_intent_data: {
            metadata: { ...metadata, type: 'shop_custom_offer_completion_retry' },
          },
        });

        await createNotification({
          userId: offer.buyerId,
          title: 'Payment needed to finish your order',
          message: `Confirm the remaining $${(fees.chargedCents / 100).toFixed(2)} to complete "${offer.title}".`,
          type: 'shop_custom_offer',
          relatedId: offer.id,
          redirectTo: `/bookings?offerId=${offer.id}`,
          metadata: { offerId: offer.id, checkoutUrl: session.url },
        }).catch(e => logger.error(`[ShopCustomOffer] SCA notify failed: ${e.message}`));

        return { offer, requiresBuyerPayment: true };
      }
      throw err;
    }
  }

  static async _finalizeCompletion(offer, paymentUpdates = {}, actorUserId = offer.sellerId) {
    const now = new Date();

    try {
      const [updated] = await db
        .update(shopCustomServiceOffers)
        .set({
          status: 'completed',
          completedAt: now,
          resolvedAt: now,
          updatedAt: now,
          ...paymentUpdates,
        })
        .where(
          and(
            eq(shopCustomServiceOffers.id, offer.id),
            eq(shopCustomServiceOffers.status, 'accepted')
          )
        )
        .returning();

      if (!updated) {
        throw new ApiError(409, 'This offer was already resolved or is no longer accepted');
      }

      await this.logActivity(offer.id, actorUserId, 'completed', {
        chargedCents: updated.chargedCents,
        auto: actorUserId === 'system',
      });

      await createNotification({
        userId: offer.buyerId,
        title: 'Service completed',
        message: `"${offer.title}" has been marked complete.`,
        type: 'shop_custom_offer',
        relatedId: offer.id,
        redirectTo: `/bookings?offerId=${offer.id}`,
        metadata: { offerId: offer.id },
      }).catch(err => logger.error(`[ShopCustomOffer] completion notify failed: ${err.message}`));

      await createNotification({
        userId: offer.buyerId,
        title: 'Project complete — leave a review',
        message: `Your project "${offer.title}" is done. Share your experience!`,
        type: 'event_update',
        relatedId: offer.id,
        redirectTo: `/bookings?offerId=${offer.id}`,
        metadata: { offerId: offer.id },
      }).catch(err =>
        logger.error(`[ShopCustomOffer] review-prompt notify failed: ${err.message}`)
      );

      // The seller only hears about this from the two paths above (their own
      // completeOffer() call, or the auto-approve cron's own dedicated
      // notification) unless the BUYER is the one who accepted the delivery —
      // that path had no seller-facing notification at all.
      if (actorUserId === offer.buyerId) {
        await createNotification({
          userId: offer.sellerId,
          title: 'Service marked complete',
          message: `The customer accepted your delivery for "${offer.title}" — payment has been released.`,
          type: 'shop_custom_offer',
          relatedId: offer.id,
          redirectTo: `/bookings?offerId=${offer.id}`,
          metadata: { offerId: offer.id },
        }).catch(err =>
          logger.error(`[ShopCustomOffer] seller completion notify failed: ${err.message}`)
        );
      }

      return this._stripAttachments(updated);
    } catch (error) {
      logger.error('[ShopCustomOffer] _finalizeCompletion FAILED', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        table: error.table,
        column: error.column,
        causeMessage: error.cause?.message,
        causeCode: error.cause?.code,
        causeDetail: error.cause?.detail,
        causeConstraint: error.cause?.constraint,
        causeTable: error.cause?.table,
        causeColumn: error.cause?.column,
        stack: error.stack,
      });

      throw error;
    }
  }

  //   static async _finalizeCompletion(offer, paymentUpdates = {}) {
  //   const now = new Date();

  //   try {
  //     const [updated] = await db
  //       .update(shopCustomServiceOffers)
  //       .set({
  //         status: 'completed',
  //         completedAt: now,
  //         resolvedAt: now,
  //         updatedAt: now,
  //         ...paymentUpdates,
  //       })
  //       .where(
  //         and(
  //           eq(shopCustomServiceOffers.id, offer.id),
  //           eq(shopCustomServiceOffers.status, 'accepted')
  //         )
  //       )
  //       .returning();

  //     if (!updated) {
  //       throw new ApiError(
  //         409,
  //         'This offer was already resolved or is no longer accepted'
  //       );
  //     }

  //     await createNotification({
  //       userId: offer.buyerId,
  //       title: 'Service completed',
  //       message: `"${offer.title}" has been marked complete.`,
  //       type: 'shop_custom_offer',
  //       relatedId: offer.id,
  //       redirectTo: '/bookings',
  //       metadata: {
  //         offerId: offer.id,
  //       },
  //     }).catch(err =>
  //       logger.error(
  //         `[ShopCustomOffer] completion notify failed: ${err.message}`
  //       )
  //     );

  //      await createNotification({
  //       userId: offer.buyerId,
  //       title: 'Project complete — leave a review',
  //       message: `Your project "${offer.title}" is done. Share your experience!`,
  //       type: 'event_update',
  //       relatedId: offer.id,
  //       redirectTo: '/bookings',
  //       metadata: { offerId: offer.id },
  //     }).catch(err =>
  //       logger.error(`[ShopCustomOffer] review-prompt notify failed: ${err.message}`)
  //     );

  //     return updated;
  //   } catch (error) {
  //     logger.error('[ShopCustomOffer] _finalizeCompletion FAILED', {
  //       message: error.message,
  //       code: error.code,
  //       detail: error.detail,
  //       constraint: error.constraint,
  //       table: error.table,
  //       column: error.column,
  //       causeMessage: error.cause?.message,
  //       causeCode: error.cause?.code,
  //       causeDetail: error.cause?.detail,
  //       causeConstraint: error.cause?.constraint,
  //       causeTable: error.cause?.table,
  //       causeColumn: error.cause?.column,
  //       stack: error.stack,
  //     });

  //     throw error;
  //   }
  // }

  static async createRemainderCheckout(buyerId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not for you');
    if (offer.status !== 'accepted') {
      throw new ApiError(409, `Only an accepted offer can be paid (this one is ${offer.status})`);
    }

    const remainingCents = Math.max(0, offer.priceCents - (offer.basePriceCoveredCents || 0));
    if (remainingCents === 0) {
      throw new ApiError(400, 'Nothing left to pay on this offer');
    }

    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    let connectAccount = await StripeConnectService.getForUser(offer.sellerId);
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(offer.sellerId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled) {
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    const fees = ShopOrderService.computeFees(remainingCents);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    const metadata = {
      type: 'shop_custom_offer_remainder',
      offerId: offer.id,
      buyerId,
      sellerId: offer.sellerId,
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: remainingCents,
            product_data: { name: `${offer.title} — remaining balance` },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: fees.platformAndServiceFeeCents,
            product_data: { name: 'Platform & Service Fee' },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/bookings`,
      cancel_url: `${process.env.FRONTEND_URL}/bookings?tab=requests&status=cancelled`,
      customer_email: buyer?.email,
      ...(offer.stripeCustomerId && { customer: offer.stripeCustomerId }),
      metadata,
      // No transfer_data/application_fee_amount here on purpose — see
      // createAcceptCheckout.
      payment_intent_data: {
        metadata,
      },
    });

    return { checkoutUrl: session.url, offerId: offer.id };
  }

  /**
   * Webhook target for the buyer-initiated remainder checkout above. Only
   * records the payment against the offer — it deliberately does NOT flip
   * status to 'completed'; that stays the seller's call via completeOffer,
   * which will find remainingCents === 0 and finalize with no further charge.
   */
  static async handleRemainderPaymentWebhook(stripeSession) {
    const offerId = stripeSession.metadata?.offerId;
    if (!offerId) return;

    const offer = await db.query.shopCustomServiceOffers.findFirst({
      where: eq(shopCustomServiceOffers.id, offerId),
    });
    if (!offer || offer.status !== 'accepted') return;

    const remainingCents = Math.max(0, offer.priceCents - (offer.basePriceCoveredCents || 0));
    if (remainingCents === 0) return; // already settled — idempotency guard

    const fees = ShopOrderService.computeFees(remainingCents);
    const paidAt = new Date();
    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : (stripeSession.payment_intent?.id ?? null);

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({
        chargedCents: (offer.chargedCents || 0) + fees.chargedCents,
        sellerReceiveCents: (offer.sellerReceiveCents || 0) + fees.sellerReceiveCents,
        basePriceCoveredCents: (offer.basePriceCoveredCents || 0) + remainingCents,
        platformShareCents: (offer.platformShareCents || 0) + fees.platformShareCents,
        // Held (not transferred) until 48h after delivery — see createAcceptCheckout.
        reserveAmountCents: (offer.reserveAmountCents || 0) + fees.sellerReceiveCents,
        stripePaymentIntentId: paymentIntentId,
        updatedAt: paidAt,
      })
      .where(
        and(eq(shopCustomServiceOffers.id, offerId), eq(shopCustomServiceOffers.status, 'accepted'))
      )
      .returning();

    if (!updated) return; // claimed concurrently

    await this.logActivity(updated.id, updated.buyerId, 'remainder_paid', {
      chargedCents: fees.chargedCents,
    });

    await UserSpendService.recordSpend({
      userId: updated.buyerId,
      spendType: 'shop',
      amountCents: fees.chargedCents,
      referenceId: updated.id,
      referenceType: 'shop_custom_offer',
      talentUserId: updated.sellerId,
      metadata: { offerId: updated.id, title: updated.title, remainder: true },
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });

    await createNotification({
      userId: updated.sellerId,
      title: 'Remaining balance paid',
      message: `The remaining balance for "${updated.title}" has been paid — you can now mark it completed.`,
      type: 'shop_custom_offer',
      relatedId: updated.id,
      redirectTo: `/bookings?offerId=${updated.id}`,
      metadata: { offerId: updated.id },
    }).catch(err => logger.error(`[ShopCustomOffer] remainder notify failed: ${err.message}`));
  }

  static async submitWork(sellerId, offerId, files, note, io = null) {
    const offer = await this.loadOffer(offerId);

    if (offer.sellerId !== sellerId) {
      throw new ApiError(403, 'This is not your offer');
    }
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Proof of work can only be submitted for an accepted offer (this one is ${offer.status})`
      );
    }
    if (!files?.length) {
      throw new ApiError(400, 'Attach at least one file');
    }

    // NEW — actually compute the round instead of relying on the column default
    const currentRound = await this.getCurrentRound(offerId);
    const nextRound = currentRound + 1;

    const inserted = [];

    for (const file of files) {
      const upload = await ShopDeliverableService.upload(sellerId, file);

      if (!upload.fileKey) {
        throw new ApiError(500, 'File uploaded but no file key was returned');
      }

      const fileType = file.mimetype?.startsWith('image/')
        ? 'image'
        : file.mimetype?.startsWith('video/')
          ? 'video'
          : 'document';

      const [row] = await db
        .insert(shopCustomOfferDeliverables)
        .values({
          offerId: offer.id,
          uploadedByUserId: sellerId,
          fileKey: upload.fileKey,
          fileName: upload.fileName || file.originalname,
          fileType,
          roundNumber: nextRound, // NEW — was silently always 1 before
          note: note?.trim() || null,
        })
        .returning();

      inserted.push(row);
    }

    // NEW — if a revision was pending, this delivery answers it
    if (offer.deliveryState === 'revision_requested') {
      await db
        .update(shopCustomOfferRevisionRequests)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(
          and(
            eq(shopCustomOfferRevisionRequests.offerId, offerId),
            eq(shopCustomOfferRevisionRequests.status, 'pending')
          )
        );
    }

    await db
      .update(shopCustomServiceOffers)
      .set({ deliveryState: 'delivered', deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(shopCustomServiceOffers.id, offerId));

    await this.logActivity(offerId, sellerId, 'delivered', {
      round: nextRound,
      fileCount: inserted.length,
    });

    await createNotification({
      userId: offer.buyerId,
      title: nextRound === 1 ? 'Your order was delivered' : 'A revised delivery is ready',
      message: `${offer.title} — the provider submitted ${inserted.length} file${
        inserted.length === 1 ? '' : 's'
      } for your review.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, deliverableCount: inserted.length, round: nextRound },
    }).catch(err => logger.error(`[ShopCustomOffer] submit-work notify failed: ${err.message}`));
    this._emitOfferUpdate(io, offer);
    return inserted;
  }

  static async listDeliverables(userId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }

    const rows = await db.query.shopCustomOfferDeliverables.findMany({
      where: eq(shopCustomOfferDeliverables.offerId, offerId),
      orderBy: [desc(shopCustomOfferDeliverables.createdAt)],
    });

    return Promise.all(
      rows.map(async row => {
        const { url } = await ShopDeliverableService.getSignedDownloadUrl(
          row.fileKey,
          row.fileName
        );
        return {
          id: row.id,
          fileName: row.fileName,
          fileType: row.fileType,
          note: row.note,
          roundNumber: row.roundNumber, // NEW
          createdAt: row.createdAt,
          url,
        };
      })
    );
  }

  static async logActivity(offerId, actorUserId, eventType, payload = {}) {
    try {
      await db.insert(shopCustomOfferActivity).values({ offerId, actorUserId, eventType, payload });
    } catch (err) {
      logger.error(`[ShopCustomOffer] activity log failed (${eventType}): ${err.message}`);
    }
  }

  /** The full timeline for an offer, oldest first — what the frontend renders as one feed. */
  static async listActivity(userId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    return db.query.shopCustomOfferActivity.findMany({
      where: eq(shopCustomOfferActivity.offerId, offerId),
      orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
  }

  // ═══════════════════════════════ Revisions ═══════════════════════════════

  static async getCurrentRound(offerId) {
    const [row] = await db
      .select({ max: sql`COALESCE(MAX(${shopCustomOfferDeliverables.roundNumber}), 0)` })
      .from(shopCustomOfferDeliverables)
      .where(eq(shopCustomOfferDeliverables.offerId, offerId));
    return Number(row?.max ?? 0);
  }

  static async requestRevision(buyerId, offerId, { message, attachments = [] } = {}, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not yours');
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Revisions can only be requested on an in-progress offer (this one is ${offer.status})`
      );
    }
    if (offer.deliveryState !== 'delivered') {
      throw new ApiError(409, 'There is no delivery waiting for review on this offer');
    }
    if (!message?.trim()) throw new ApiError(400, 'Describe what needs to change');

    const currentRound = await this.getCurrentRound(offerId);
    if (currentRound === 0) throw new ApiError(400, 'Nothing has been delivered yet');

    const alreadyPending = await db.query.shopCustomOfferRevisionRequests.findFirst({
      where: and(
        eq(shopCustomOfferRevisionRequests.offerId, offerId),
        eq(shopCustomOfferRevisionRequests.status, 'pending')
      ),
    });
    if (alreadyPending)
      throw new ApiError(409, 'A revision request is already pending on this offer');

    if (!offer.revisionsIncluded) {
      throw new ApiError(400, 'This offer does not include revisions');
    }
    if (offer.revisionsUsedCount >= offer.revisionsCount) {
      throw new ApiError(
        400,
        `The included ${offer.revisionsCount} revision(s) have already been used`
      );
    }

    const [request] = await db
      .insert(shopCustomOfferRevisionRequests)
      .values({ offerId, buyerId, roundNumber: currentRound, message: message.trim(), attachments })
      .returning();

    await db
      .update(shopCustomServiceOffers)
      .set({
        revisionsUsedCount: sql`${shopCustomServiceOffers.revisionsUsedCount} + 1`,
        deliveryState: 'revision_requested',
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shopCustomServiceOffers.id, offerId));

    await this.logActivity(offerId, buyerId, 'revision_requested', {
      revisionRequestId: request.id,
      roundNumber: currentRound,
      message: message.trim(),
    });

    await createNotification({
      userId: offer.sellerId,
      title: 'Revision requested',
      message: `A revision was requested on "${offer.title}".`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, revisionRequestId: request.id },
    }).catch(err =>
      logger.error(`[ShopCustomOffer] revision-request notify failed: ${err.message}`)
    );

    this._emitOfferUpdate(io, offer); // ← added
    return request;
  }

  /** The full revision-request history for an offer, newest first — either party can view it. */
  static async listRevisionRequests(userId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    return db.query.shopCustomOfferRevisionRequests.findMany({
      where: eq(shopCustomOfferRevisionRequests.offerId, offerId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }

  static async listDateExtensionRequests(userId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    return db.query.shopCustomOfferDateExtensionRequests.findMany({
      where: eq(shopCustomOfferDateExtensionRequests.offerId, offerId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }
  // ═══════════════════════════ Date extension ══════════════════════════════

  static async requestDateExtension(userId, offerId, { requestedDueDate, reason } = {}, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Date extensions can only be requested on an in-progress offer (this one is ${offer.status})`
      );
    }
    if (!requestedDueDate) throw new ApiError(400, '`requestedDueDate` is required');

    const alreadyPending = await db.query.shopCustomOfferDateExtensionRequests.findFirst({
      where: and(
        eq(shopCustomOfferDateExtensionRequests.offerId, offerId),
        eq(shopCustomOfferDateExtensionRequests.status, 'pending')
      ),
    });
    if (alreadyPending)
      throw new ApiError(409, 'A date extension request is already pending on this offer');

    const [request] = await db
      .insert(shopCustomOfferDateExtensionRequests)
      .values({
        offerId,
        requestedByUserId: userId,
        originalDueDate: offer.dueDate,
        requestedDueDate: new Date(requestedDueDate),
        reason: reason?.trim() || null,
      })
      .returning();

    await this.logActivity(offerId, userId, 'date_extension_requested', {
      requestId: request.id,
      originalDueDate: offer.dueDate,
      requestedDueDate: request.requestedDueDate,
      reason: request.reason,
    });

    const otherPartyId = userId === offer.buyerId ? offer.sellerId : offer.buyerId;
    await createNotification({
      userId: otherPartyId,
      title: 'Delivery date change requested',
      message: `A new due date was proposed for "${offer.title}".`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, requestId: request.id },
    }).catch(err => logger.error(`[ShopCustomOffer] date-extension notify failed: ${err.message}`));
    this._emitOfferUpdate(io, offer);
    return request;
  }

  static async respondToDateExtension(userId, offerId, requestId, { action } = {}, io = null) {
    if (!['accept', 'decline'].includes(action)) {
      throw new ApiError(400, '`action` must be "accept" or "decline"');
    }

    const offer = await this.loadOffer(offerId);
    const request = await db.query.shopCustomOfferDateExtensionRequests.findFirst({
      where: eq(shopCustomOfferDateExtensionRequests.id, requestId),
    });
    if (!request || request.offerId !== offerId) throw new ApiError(404, 'Request not found');
    if (request.status !== 'pending')
      throw new ApiError(409, `This request was already ${request.status}`);
    // The requester can't accept/decline their own ask — must be the other party.
    if (
      request.requestedByUserId !== offer.sellerId &&
      request.requestedByUserId !== offer.buyerId
    ) {
      throw new ApiError(409, 'Invalid request');
    }
    const responderMustBe =
      request.requestedByUserId === offer.buyerId ? offer.sellerId : offer.buyerId;
    if (userId !== responderMustBe)
      throw new ApiError(403, 'Only the other party can respond to this request');

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const [updated] = await db
      .update(shopCustomOfferDateExtensionRequests)
      .set({ status: newStatus, resolvedAt: new Date() })
      .where(
        and(
          eq(shopCustomOfferDateExtensionRequests.id, requestId),
          eq(shopCustomOfferDateExtensionRequests.status, 'pending')
        )
      )
      .returning();
    if (!updated) throw new ApiError(409, 'This request was already resolved');

    if (action === 'accept') {
      await db
        .update(shopCustomServiceOffers)
        .set({ dueDate: request.requestedDueDate, updatedAt: new Date() })
        .where(eq(shopCustomServiceOffers.id, offerId));
    }

    await this.logActivity(offerId, userId, `date_extension_${newStatus}`, {
      requestId,
      requestedDueDate: request.requestedDueDate,
    });

    await createNotification({
      userId: request.requestedByUserId,
      title: action === 'accept' ? 'Date extension accepted' : 'Date extension declined',
      message:
        action === 'accept'
          ? `Your new due date for "${offer.title}" was accepted.`
          : `Your requested due date change for "${offer.title}" was declined.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offerId}`,
      metadata: { offerId, requestId },
    }).catch(err =>
      logger.error(`[ShopCustomOffer] date-extension response notify failed: ${err.message}`)
    );
    this._emitOfferUpdate(io, offer);
    return updated;
  }

  // ═══════════════════════════════ Tipping ═════════════════════════════════

  /** No platform commission — buyer covers just the card processing cost. */
  static computeTipFees(amountCents) {
    const chargedCents = Math.round((amountCents + 30) / 0.971);
    return { chargedCents, applicationFeeCents: chargedCents - amountCents };
  }

  static async createTipCheckout(buyerId, offerId, { amountCents } = {}) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not yours');
    if (offer.status !== 'completed')
      throw new ApiError(409, 'You can only tip after the project is completed');
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new ApiError(400, 'Enter a valid tip amount');
    }

    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    let connectAccount = await StripeConnectService.getForUser(offer.sellerId);
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(offer.sellerId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled)
      throw new ApiError(400, "This creator can't accept payments yet");

    const fees = this.computeTipFees(amountCents);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    const [tip] = await db
      .insert(shopCustomOfferTips)
      .values({
        offerId,
        buyerId,
        sellerId: offer.sellerId,
        amountCents,
        chargedCents: fees.chargedCents,
      })
      .returning();

    const metadata = {
      type: 'shop_custom_offer_tip',
      tipId: tip.id,
      offerId,
      buyerId,
      sellerId: offer.sellerId,
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: fees.chargedCents,
            product_data: { name: `Tip for "${offer.title}"` },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/bookings`,
      cancel_url: `${process.env.FRONTEND_URL}/bookings`,
      customer_email: buyer?.email,
      metadata,
      // No transfer_data/application_fee_amount here on purpose — see
      // createAcceptCheckout. The tip amount accumulates into the offer's
      // reserveAmountCents instead of transferring immediately.
      payment_intent_data: {
        metadata,
      },
    });

    await db
      .update(shopCustomOfferTips)
      .set({ stripeSessionId: session.id })
      .where(eq(shopCustomOfferTips.id, tip.id));

    return { checkoutUrl: session.url, tipId: tip.id };
  }

  static async handleTipPaymentWebhook(stripeSession) {
    const tipId = stripeSession.metadata?.tipId;
    if (!tipId) return;

    const tip = await db.query.shopCustomOfferTips.findFirst({
      where: eq(shopCustomOfferTips.id, tipId),
    });
    if (!tip || tip.status !== 'pending') return;

    const paidAt = new Date();
    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : (stripeSession.payment_intent?.id ?? null);

    const [updated] = await db
      .update(shopCustomOfferTips)
      .set({ status: 'paid', paidAt, stripePaymentIntentId: paymentIntentId })
      .where(and(eq(shopCustomOfferTips.id, tipId), eq(shopCustomOfferTips.status, 'pending')))
      .returning();
    if (!updated) return;

    // No platform commission on tips — the seller's cut is the full tip
    // amount. Held (not transferred) until 48h after delivery, same as the
    // rest of the offer's payments — see createAcceptCheckout. A tip often
    // arrives after the offer's earlier reserve already released, which is
    // exactly why release zeroes reserveAmountCents instead of just
    // stamping reserveReleasedAt: this accumulation is always safe to add
    // to, and a late tip on an already-released offer is simply picked up
    // fresh on the next cron pass.
    await db
      .update(shopCustomServiceOffers)
      .set({
        reserveAmountCents: sql`${shopCustomServiceOffers.reserveAmountCents} + ${updated.amountCents}`,
        updatedAt: paidAt,
      })
      .where(eq(shopCustomServiceOffers.id, updated.offerId));

    await UserSpendService.recordSpend({
      userId: updated.buyerId,
      spendType: 'shop',
      amountCents: updated.chargedCents,
      referenceId: updated.id,
      referenceType: 'shop_custom_offer_tip',
      talentUserId: updated.sellerId,
      metadata: { offerId: updated.offerId, tip: true },
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });

    await this.logActivity(updated.offerId, updated.buyerId, 'tip_paid', {
      amountCents: updated.amountCents,
    });

    await createNotification({
      userId: updated.sellerId,
      title: 'You got a tip!',
      message: `You received a $${(updated.amountCents / 100).toFixed(2)} tip.`,
      type: 'shop_custom_offer',
      relatedId: updated.offerId,
      redirectTo: `/bookings?offerId=${updated.offerId}`,
      metadata: { offerId: updated.offerId, tipId: updated.id },
    }).catch(err => logger.error(`[ShopCustomOffer] tip notify failed: ${err.message}`));
  }

  // ═══════════════════════════════ Disputes ════════════════════════════════
  // Flag-only: raises a record for an admin to review. Does NOT trigger a
  // refund — an admin who agrees there's an issue calls cancelOffer separately.

  static async raiseDispute(userId, offerId, { reason, message } = {}) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    if (!message?.trim()) throw new ApiError(400, 'Describe the issue');
    const validReasons = ['not_as_described', 'missed_deadline', 'not_delivered', 'other'];
    if (!validReasons.includes(reason)) {
      throw new ApiError(400, `reason must be one of: ${validReasons.join(', ')}`);
    }

    const [dispute] = await db
      .insert(shopCustomOfferDisputes)
      .values({ offerId, raisedByUserId: userId, reason, message: message.trim() })
      .returning();

    await this.logActivity(offerId, userId, 'dispute_raised', { disputeId: dispute.id, reason });

    const otherPartyId = userId === offer.buyerId ? offer.sellerId : offer.buyerId;
    await createNotification({
      userId: otherPartyId,
      title: 'An issue was reported',
      message: `An issue was reported on "${offer.title}".`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offerId}`,
      metadata: { offerId, disputeId: dispute.id },
    }).catch(err => logger.error(`[ShopCustomOffer] dispute notify failed: ${err.message}`));

    return dispute;
  }

  static async listDisputes(userId, offerId) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== userId && offer.buyerId !== userId) {
      throw new ApiError(403, 'This offer is not yours');
    }
    return db.query.shopCustomOfferDisputes.findMany({
      where: eq(shopCustomOfferDisputes.offerId, offerId),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });
  }

  /** Admin: list all pending disputes across offers, for a review queue. */
  static async adminListDisputes({ status = 'pending', page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const where = status === 'all' ? undefined : eq(shopCustomOfferDisputes.status, status);
    const [rows, [{ value: total }]] = await Promise.all([
      db.query.shopCustomOfferDisputes.findMany({
        where,
        orderBy: (d, { desc }) => [desc(d.createdAt)],
        limit,
        offset,
      }),
      db.select({ value: count() }).from(shopCustomOfferDisputes).where(where),
    ]);
    return { disputes: rows, total, hasMore: rows.length === limit };
  }

  /** Admin: mark a dispute resolved with a note. Does not move money. */
  static async adminResolveDispute(adminUserId, disputeId, { resolutionNote } = {}) {
    const [updated] = await db
      .update(shopCustomOfferDisputes)
      .set({
        status: 'resolved',
        resolvedByUserId: adminUserId,
        resolutionNote: resolutionNote?.trim() || null,
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(shopCustomOfferDisputes.id, disputeId),
          eq(shopCustomOfferDisputes.status, 'pending')
        )
      )
      .returning();
    if (!updated) throw new ApiError(409, 'This dispute was already resolved');
    return updated;
  }

  /**
   * Auto-approves deliveries the buyer never acted on within the 3-day
   * review window — mirrors Fiverr's auto-accept. Meant to be called on a
   * schedule (see cron wiring). Each offer is isolated in its own try/catch
   * so one failure doesn't block the rest of the batch.
   */
  static async autoApproveOverdueDeliveries() {
    const cutoff = new Date(Date.now() - AUTO_APPROVE_WINDOW_MS);

    const overdue = await db.query.shopCustomServiceOffers.findMany({
      where: and(
        eq(shopCustomServiceOffers.status, 'accepted'),
        eq(shopCustomServiceOffers.deliveryState, 'delivered'),
        lte(shopCustomServiceOffers.deliveredAt, cutoff)
      ),
    });

    for (const offer of overdue) {
      try {
        const { requiresBuyerPayment } = await this._chargeRemainderAndFinalize(offer, 'system');

        if (requiresBuyerPayment) {
          // Card needed 3DS — buyer already got a "payment needed" notification
          // from _chargeRemainderAndFinalize. Can't silently auto-complete.
          continue;
        }

        await createNotification({
          userId: offer.buyerId,
          title: 'Order auto-approved',
          message: `You didn't respond to the delivery for "${offer.title}" within 3 days, so it was automatically approved and payment released.`,
          type: 'shop_custom_offer',
          relatedId: offer.id,
          redirectTo: `/bookings?offerId=${offer.id}`,
          metadata: { offerId: offer.id, auto: true },
        }).catch(err =>
          logger.error(`[ShopCustomOffer] auto-approve buyer notify failed: ${err.message}`)
        );

        await createNotification({
          userId: offer.sellerId,
          title: 'Delivery auto-approved',
          message: `"${offer.title}" was automatically approved after 3 days and payment has been released.`,
          type: 'shop_custom_offer',
          relatedId: offer.id,
          redirectTo: `/bookings?offerId=${offer.id}`,
          metadata: { offerId: offer.id, auto: true },
        }).catch(err =>
          logger.error(`[ShopCustomOffer] auto-approve seller notify failed: ${err.message}`)
        );
      } catch (err) {
        logger.error(`[ShopCustomOffer] auto-approve failed for offer ${offer.id}: ${err.message}`);
      }
    }

    return { processed: overdue.length };
  }
}
