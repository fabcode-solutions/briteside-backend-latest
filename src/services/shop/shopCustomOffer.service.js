import Stripe from 'stripe';
import { db } from '../../db/index.js';
import {
  shopCustomServiceOffers,
  shopOfferMilestones,
  shopProducts,
  users,
  talentReviews,
} from '../../db/schema/index.js';
import { eq, and, asc, desc, count, inArray, notInArray, sql, lte } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { StripeConnectService } from '../stripeConnect.service.js';
import { getRedirectUrls } from '../../utils/redirect-urls.js';
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

// Every mode that may exist on an offer row. 'deposit' is retired but still
// present on historical offers, so all the charge/read logic below keeps
// handling it.
const PAYMENT_MODES = ['full', 'deposit', 'milestones'];
// What a NEW offer may be created with. Offers are write-once (no edit after
// send), so retiring 'deposit' here can't strand an existing row.
const CREATABLE_PAYMENT_MODES = PAYMENT_MODES.filter(m => m !== 'deposit');
const MAX_MILESTONES = 10;
const OFFER_TTL_DAYS = 7;
const AUTO_APPROVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// A milestone's funds are transferred to the seller 48h after the BUYER
// approves that stage — the per-stage equivalent of the whole-offer
// deliveredAt + 48h hold in cron/reserveRelease.js.
const MILESTONE_RELEASE_HOLD_MS = 48 * 60 * 60 * 1000;
// Statuses a milestone can no longer be moved INTO 'funded' from. Every
// funding write is conditional on NOT being one of these, which is what makes
// Stripe's at-least-once webhook redelivery a no-op instead of a second charge
// being recorded (or, worse, a completed stage being dragged backwards).
const MILESTONE_SETTLED_STATUSES = ['funded', 'completed', 'released'];
// The two states a milestone may be funded from.
const MILESTONE_FUNDABLE_STATUSES = ['pending', 'awaiting_payment'];
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
    if (!CREATABLE_PAYMENT_MODES.includes(paymentMode)) {
      throw new ApiError(400, `paymentMode must be one of: ${CREATABLE_PAYMENT_MODES.join(', ')}`);
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
        origin: shopCustomServiceOffers.origin,
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

    return this._withMilestoneStates(
      await this._withBasedOnTitles(await this._withResolvedAttachments(rows))
    );
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
        origin: shopCustomServiceOffers.origin,
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
    return this._withMilestoneStates(await this._withReviewFlags(withTitles, buyerId));
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
          eq(shopCustomServiceOffers.status, 'pending'),
          // A buyer-initiated listing purchase sits at 'pending' only while
          // its Stripe checkout is open. The buyer has nothing to act on
          // there, so an abandoned checkout must not inflate their badge.
          sql`${shopCustomServiceOffers.origin} IS DISTINCT FROM 'shop_listing'`
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

  /**
   * Decline, in both directions:
   *
   *  - Normal seller-sent offer at 'pending': the BUYER declines. Nothing has
   *    been charged, so nothing is refunded.
   *  - Buyer-initiated listing purchase at 'pending_talent_approval': the
   *    SELLER declines. The buyer already paid at Buy time, so the charge is
   *    refunded here through the same idempotent path cancelOffer uses.
   */
  static async declineOffer(userId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);

    const isListingApproval =
      offer.origin === 'shop_listing' && offer.status === 'pending_talent_approval';

    if (isListingApproval) {
      if (offer.sellerId !== userId) throw new ApiError(403, 'This is not your offer');
    } else {
      if (offer.buyerId !== userId) throw new ApiError(403, 'This offer is not for you');
      if (offer.status !== 'pending')
        throw new ApiError(409, `This offer was already ${offer.status}`);
      await this.assertNotExpired(offer);
    }

    // A paid-up-front listing purchase must give the money back before the
    // row is marked declined — if the refund throws, the offer stays put and
    // the seller can retry.
    const stripeRefundId = isListingApproval ? await this._refundOfferCharge(offer, userId) : null;

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({ status: 'declined', resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(shopCustomServiceOffers.id, offerId),
          eq(shopCustomServiceOffers.status, offer.status)
        )
      )
      .returning();

    if (!updated) throw new ApiError(409, 'This offer was already resolved');

    await this.logActivity(offerId, userId, 'offer_declined', {
      ...(isListingApproval
        ? { origin: 'shop_listing', refundedCents: offer.chargedCents ?? 0 }
        : {}),
    });

    if (isListingApproval && offer.chargedCents > 0) {
      await UserSpendService.markSpendRefunded({
        userId: offer.buyerId,
        referenceId: offer.id,
        referenceType: 'shop_custom_offer',
        spendType: 'shop',
        refundMeta: { source: 'shop_listing_purchase_declined', stripeRefundId },
      }).catch(err => logger.error(`[ShopCustomOffer] markSpendRefunded failed: ${err.message}`));
    }

    // The party that didn't act is the one that needs telling: normally the
    // seller who sent the offer, but for a listing purchase it's the buyer
    // whose order was turned down.
    await createNotification({
      userId: isListingApproval ? offer.buyerId : offer.sellerId,
      title: isListingApproval ? 'Order declined' : 'Custom offer declined',
      message: isListingApproval
        ? `Your order "${offer.title}" was declined and refunded in full.`
        : `Your offer "${offer.title}" was declined.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id },
    }).catch(err => logger.error(`[ShopCustomOffer] decline notify failed: ${err.message}`));
    this._emitOfferUpdate(io, updated);
    return this._stripAttachments(updated);
  }

  /**
   * The base amount of the FIRST payment on an offer: the full price, the
   * deposit slice, or milestone[0]'s slice. Extracted so the buyer-initiated
   * listing purchase path computes the deposit identically to the normal
   * accept-and-pay path rather than duplicating the arithmetic.
   */
  static _firstInstallmentBase(offer) {
    if (offer.paymentMode === 'deposit') {
      return Math.round((offer.priceCents * offer.depositPercent) / 100);
    }
    if (offer.paymentMode === 'milestones') {
      // Routed through the same arithmetic the shop_offer_milestones rows are
      // snapshotted with, so this helper and the persisted row for position 0
      // can never disagree by a cent. (They only ever could when there is a
      // single milestone — validate() forbids that — but deriving both from
      // one function removes the question entirely.)
      return this._computeMilestoneAmounts(offer.priceCents, offer.milestones)[0];
    }
    return offer.priceCents;
  }

  // ══════════════════════════ Milestone payments ═══════════════════════════
  //
  // Everything below is strictly additive and gated on
  // paymentMode === 'milestones'. The 'full' and 'deposit' flows are
  // untouched by any of it.

  /**
   * Re-validates a milestones TEMPLATE ([{label, percent}]) before anything is
   * snapshotted from it. Deliberately re-run at charge time rather than
   * trusting an offer row that was validated when it was created — a row can
   * predate a validation rule, or have been written by a path that skipped
   * validate() (createListingPurchase copies a listing's jsonb straight
   * across).
   */
  static _validateMilestoneTemplate(milestones) {
    if (!Array.isArray(milestones) || milestones.length < 2) {
      throw new ApiError(400, 'This offer has no usable milestone schedule');
    }
    if (milestones.length > MAX_MILESTONES) {
      throw new ApiError(400, `No more than ${MAX_MILESTONES} milestones`);
    }
    const malformed = milestones.some(
      m => !m?.label?.toString().trim() || !Number.isFinite(Number(m?.percent)) || Number(m.percent) <= 0
    );
    if (malformed) {
      throw new ApiError(400, 'Each milestone needs a label and a percentage greater than 0');
    }
    const total = milestones.reduce((sum, m) => sum + Number(m.percent), 0);
    if (Math.round(total) !== 100) {
      throw new ApiError(400, 'Milestone percentages must add up to 100');
    }
    return milestones;
  }

  /**
   * Splits priceCents across the milestone template so the parts sum to
   * priceCents EXACTLY. Each stage is rounded independently and the LAST one
   * absorbs whatever the rounding lost or gained, so
   * `Σ amountCents === priceCents` holds for every schedule — which is what
   * guarantees a fully-funded milestone offer leaves remainingCents at
   * exactly 0 and never triggers a stray lump-sum charge at completion.
   */
  static _computeMilestoneAmounts(priceCents, milestones) {
    this._validateMilestoneTemplate(milestones);

    const amounts = milestones.map(m => Math.round((priceCents * Number(m.percent)) / 100));
    const drift = priceCents - amounts.reduce((sum, a) => sum + a, 0);
    amounts[amounts.length - 1] += drift;

    if (amounts.some(a => a <= 0)) {
      throw new ApiError(400, 'This milestone schedule produces a zero or negative installment');
    }
    // Belt and braces: never let a rounding bug become a money bug.
    const total = amounts.reduce((sum, a) => sum + a, 0);
    if (total !== priceCents) {
      throw new ApiError(500, 'Milestone amounts failed to reconcile against the offer price');
    }
    return amounts;
  }

  /** Every milestone row for an offer, oldest stage first. */
  static async _loadMilestoneRows(offerId) {
    return db.query.shopOfferMilestones.findMany({
      where: eq(shopOfferMilestones.offerId, offerId),
      orderBy: [asc(shopOfferMilestones.position)],
    });
  }

  /**
   * Attaches live per-stage state (`milestoneStates`) to every 'milestones'
   * row in a list response, batched in one query. The frontend stepper reads
   * this to know each stage's status — the `milestones` jsonb column alone
   * (label/percent template) can't tell it what's actually funded/approved.
   */
  static async _withMilestoneStates(rows) {
    const offerIds = rows.filter(r => r.paymentMode === 'milestones').map(r => r.id);
    if (offerIds.length === 0) return rows;

    const allRows = await db.query.shopOfferMilestones.findMany({
      where: inArray(shopOfferMilestones.offerId, offerIds),
      orderBy: [asc(shopOfferMilestones.position)],
    });
    const byOffer = new Map();
    for (const row of allRows) {
      if (!byOffer.has(row.offerId)) byOffer.set(row.offerId, []);
      byOffer.get(row.offerId).push(row);
    }

    return rows.map(r =>
      r.paymentMode === 'milestones' ? { ...r, milestoneStates: byOffer.get(r.id) ?? [] } : r
    );
  }

  /**
   * Materialises the live per-stage rows for a milestones offer, exactly once.
   *
   * Idempotent by design: a retried or double-clicked checkout must never
   * produce a second schedule, and an already-funded schedule must never be
   * renumbered or re-priced (that would silently move real money between
   * stages). Concurrency is caught by the unique (offerId, position) index —
   * a loser re-reads the winner's rows rather than erroring.
   */
  static async _ensureMilestoneRows(offer) {
    if (offer.paymentMode !== 'milestones') {
      throw new ApiError(400, 'This offer is not on a milestone payment schedule');
    }

    // An existing schedule is returned UNCHANGED, always. Re-snapshotting or
    // renumbering a schedule that has any funded stage would silently move
    // real money between stages, so there is deliberately no repair path here.
    const existing = await this._loadMilestoneRows(offer.id);
    if (existing.length > 0) return existing;

    const template = this._validateMilestoneTemplate(offer.milestones);
    const amounts = this._computeMilestoneAmounts(offer.priceCents, template);

    const values = template.map((m, i) => ({
      offerId: offer.id,
      position: i,
      label: m.label.toString().trim().slice(0, 200),
      percent: String(Number(m.percent)),
      amountCents: amounts[i],
      status: 'pending',
    }));

    try {
      await db.insert(shopOfferMilestones).values(values);
    } catch (err) {
      // Lost a race against a concurrent first checkout — the winner's rows
      // are the schedule. Anything else is a real failure.
      logger.warn(
        `[ShopCustomOffer] milestone row insert for offer ${offer.id} failed, re-reading: ${err.message}`
      );
      const afterRace = await this._loadMilestoneRows(offer.id);
      if (afterRace.length === 0) throw err;
      return afterRace;
    }

    return this._loadMilestoneRows(offer.id);
  }

  /** The stage the project is currently on: the lowest-position row that isn't settled yet. */
  static _currentMilestone(rows) {
    return rows.find(r => r.status === 'funded') ?? null;
  }

  /**
   * Marks one milestone funded and folds its money into the offer's running
   * totals. Shared by the milestone-1 path (which rides the existing
   * `shop_custom_offer` webhook) and the per-milestone funding webhook.
   *
   * The UPDATE is conditional on the row NOT already being settled, so a
   * redelivered webhook is a no-op: it returns undefined and the caller skips
   * every side effect below it.
   *
   * CRITICAL: this never touches offer.reserveAmountCents. That column belongs
   * exclusively to the whole-offer release cron (and to tips); milestone money
   * is released per row by releaseCustomOfferMilestoneReserves. Writing to both
   * would be a double transfer.
   */
  static async _markMilestoneFunded(milestone, { paymentIntentId, stripeSessionId, paidAt }) {
    const fees = ShopOrderService.computeFees(milestone.amountCents);

    const [updated] = await db
      .update(shopOfferMilestones)
      .set({
        status: 'funded',
        fundedAt: paidAt,
        stripePaymentIntentId: paymentIntentId,
        ...(stripeSessionId ? { stripeSessionId } : {}),
        chargedCents: fees.chargedCents,
        sellerReceiveCents: fees.sellerReceiveCents,
        platformShareCents: fees.platformShareCents,
        updatedAt: paidAt,
      })
      .where(
        and(
          eq(shopOfferMilestones.id, milestone.id),
          notInArray(shopOfferMilestones.status, MILESTONE_SETTLED_STATUSES)
        )
      )
      .returning();

    return updated ? { milestone: updated, fees } : null;
  }

  /**
   * Parks a milestone at 'awaiting_payment' against the Checkout session that
   * will pay for it. Conditional on the row still being fundable so it can
   * never drag a stage that was funded in the meantime backwards.
   */
  static async _stampMilestoneSession(milestoneId, stripeSessionId) {
    await db
      .update(shopOfferMilestones)
      .set({ status: 'awaiting_payment', stripeSessionId, updatedAt: new Date() })
      .where(
        and(
          eq(shopOfferMilestones.id, milestoneId),
          inArray(shopOfferMilestones.status, MILESTONE_FUNDABLE_STATUSES)
        )
      );
  }

  /**
   * Adds one milestone's money to the OFFER's running totals.
   *
   * Uses SQL-side increments rather than read-modify-write so two webhooks
   * landing at once can't lose one another's contribution. reserveAmountCents
   * is pointedly absent — see _markMilestoneFunded.
   */
  static async _addMilestoneMoneyToOffer(offerId, amountCents, fees, at) {
    await db
      .update(shopCustomServiceOffers)
      .set({
        chargedCents: sql`COALESCE(${shopCustomServiceOffers.chargedCents}, 0) + ${fees.chargedCents}`,
        basePriceCoveredCents: sql`COALESCE(${shopCustomServiceOffers.basePriceCoveredCents}, 0) + ${amountCents}`,
        sellerReceiveCents: sql`COALESCE(${shopCustomServiceOffers.sellerReceiveCents}, 0) + ${fees.sellerReceiveCents}`,
        platformShareCents: sql`COALESCE(${shopCustomServiceOffers.platformShareCents}, 0) + ${fees.platformShareCents}`,
        updatedAt: at,
      })
      .where(eq(shopCustomServiceOffers.id, offerId));
  }

  /**
   * Refunds whatever was charged on an offer, idempotently.
   *
   * Extracted verbatim from cancelOffer so the seller-declines-a-paid-listing
   * -purchase path refunds through exactly the same code: if a refund for this
   * payment intent already exists (a previous attempt refunded but the DB
   * update that follows never landed — a crash, a timeout, a duplicate click),
   * reuse it instead of calling refunds.create again, which Stripe would
   * reject with "Charge has already been refunded" and leave the row stuck.
   */
  static async _refundOfferCharge(offer, actorUserId) {
    if (!(offer.chargedCents > 0)) return null;
    if (!offer.stripePaymentIntentId) {
      throw new ApiError(400, 'This offer has no payment to refund');
    }
    return this._refundPaymentIntent(offer.stripePaymentIntentId, {
      offerId: offer.id,
      actorUserId,
      logLabel: `offer ${offer.id}`,
    });
  }

  /**
   * The actual idempotent Stripe refund, extracted from _refundOfferCharge so
   * a milestone offer — which has one payment intent PER FUNDED STAGE rather
   * than the single offer.stripePaymentIntentId this file was built around —
   * refunds each of its charges through exactly this code rather than a second
   * copy of it. _refundOfferCharge's own signature and behaviour are unchanged.
   */
  static async _refundPaymentIntent(
    paymentIntentId,
    { offerId, actorUserId, logLabel, metadata = {} } = {}
  ) {
    if (!stripe) throw new ApiError(503, 'Payments are not configured');
    if (!paymentIntentId) throw new ApiError(400, 'There is no payment to refund');

    // Check for an existing refund on this payment intent first, so a
    // retry after a partial failure never re-hits Stripe.
    const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
    if (existing.data.length > 0) {
      logger.warn(
        `[ShopCustomOffer] ${logLabel ?? paymentIntentId} already had refund ${existing.data[0].id} on Stripe — DB was out of sync, reconciling.`
      );
      return existing.data[0].id;
    }

    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        // Claw the money back out of the seller's Connect balance while
        // the platform keeps its own fee.
        reverse_transfer: true,
        refund_application_fee: false,
        metadata: { offerId, cancelledBy: actorUserId, ...metadata },
      });
      return refund.id;
    } catch (err) {
      // Race: refunded between our list() check and create() — Stripe
      // is the source of truth here, so look up the refund it made
      // instead of failing the whole cancellation.
      if (err?.code === 'charge_already_refunded') {
        const retry = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
        return retry.data[0]?.id ?? null;
      }
      throw err;
    }
  }

  /**
   * SECOND entry point into this workspace: the BUYER initiates by clicking
   * "Buy" on a `listingType: 'service'` shop listing.
   *
   * Unlike createAcceptCheckout (seller proposes → buyer accepts + pays), here
   * the buyer pays immediately and the offer parks at 'pending_talent_approval'
   * until the seller accepts (approveListingPurchase) or declines (declineOffer,
   * which refunds). Delegated to from ShopOrderService.createCheckout, so a
   * service listing never creates a shop_orders row at all — it gets the real
   * delivery workspace (accept/decline, delivery state, activity, revisions).
   *
   * For paymentMode 'milestones' only the FIRST milestone is charged here —
   * the remaining stages are funded one at a time via
   * createMilestoneFundingCheckout. This closes the temporary gap where this
   * path charged the full price for that mode.
   */
  static async createListingPurchase(buyerId, product, platform) {
    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    // Same live re-check createAcceptCheckout does: chargesEnabled only
    // refreshes on the account.updated webhook, so a stale false must be
    // re-checked before rejecting a real sale.
    let connectAccount = await StripeConnectService.getForUser(product.userId);
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(product.userId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled) {
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    const paymentMode = product.paymentMode ?? 'full';

    // Validated BEFORE the offer row is inserted: a listing's milestones jsonb
    // never went through validate(), and failing after the insert would strand
    // an unpayable 'pending' offer in the buyer's workspace.
    if (paymentMode === 'milestones') {
      this._computeMilestoneAmounts(product.priceCents, product.milestones);
    }

    // Inserted directly rather than through validate(): a shop listing has no
    // turnaroundMinutes, which validate() requires. Every NOT NULL column on
    // the table is supplied explicitly below.
    const [offer] = await db
      .insert(shopCustomServiceOffers)
      .values({
        sellerId: product.userId,
        buyerId,
        basedOnProductId: product.id,
        origin: 'shop_listing',
        title: product.title,
        // description is NOT NULL on the table; a listing's description is
        // nullable, so fall back to the title.
        description: product.description?.trim() || product.title,
        priceCents: product.priceCents,
        turnaround: product.turnaround?.trim() || null,
        // Listings carry only display text, no machine-readable duration, so
        // the due date stays null until the seller sets one.
        turnaroundMinutes: null,
        dueDate: null,
        revisionsIncluded: !!product.revisionsIncluded,
        revisionsCount: product.revisionsIncluded ? (product.revisionsCount ?? null) : null,
        paymentMode,
        depositPercent: paymentMode === 'deposit' ? product.depositPercent : null,
        milestones: paymentMode === 'milestones' ? product.milestones : null,
        attachments: [],
        // Starts at 'pending' so the existing handlePaymentWebhook claim
        // (conditional update on status = 'pending') applies unchanged; that
        // handler is what promotes it to 'pending_talent_approval'.
        status: 'pending',
        // Bounded by the checkout window: an abandoned checkout leaves a
        // never-paid 'pending' row, and this lets it expire like any other.
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })
      .returning();

    // 'milestones' charges stage 1 only, off the SNAPSHOTTED row rather than
    // recomputing from the template — the row is the source of truth for every
    // later step (webhook, approval, release, refund). 'deposit' reuses the
    // shared first-installment calculation; 'full' charges the whole price.
    const milestoneRows = paymentMode === 'milestones' ? await this._ensureMilestoneRows(offer) : null;
    const installmentBase = milestoneRows
      ? milestoneRows[0].amountCents
      : paymentMode === 'deposit'
        ? this._firstInstallmentBase(offer)
        : offer.priceCents;

    const fees = ShopOrderService.computeFees(installmentBase);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    // Same metadata.type as a normal offer payment, so the existing webhook
    // dispatch in webhook.controller.js routes it here with no change.
    const metadata = {
      type: 'shop_custom_offer',
      offerId: offer.id,
      buyerId,
      sellerId: offer.sellerId,
    };

    const redirectUrls = getRedirectUrls(
      platform,
      process.env.FRONTEND_URL || 'https://briteside.app',
      '/bookings?tab=requests&status=success',
      '/bookings?tab=requests&status=cancelled'
    );

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: installmentBase,
            product_data: {
              name: offer.title,
              ...(product.coverUrl ? { images: [product.coverUrl] } : {}),
            },
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
      success_url: redirectUrls.successUrl,
      cancel_url: redirectUrls.cancelUrl,
      customer_email: buyer?.email,
      // Only worth saving the card when there's a remainder left to collect
      // later — mirrors createAcceptCheckout.
      ...(paymentMode !== 'full' && { customer_creation: 'always' }),
      metadata,
      // No transfer_data/application_fee_amount — the seller's cut accumulates
      // in reserveAmountCents and is released 48h after delivery.
      payment_intent_data: {
        metadata,
        ...(paymentMode !== 'full' && { setup_future_usage: 'off_session' }),
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

    if (milestoneRows) {
      await this._stampMilestoneSession(milestoneRows[0].id, session.id);
    }

    // Exactly the shape ShopOrderService.createCheckout returns, so
    // ProductDetailModal's runCheckout needs no change at all.
    return { free: false, checkoutUrl: session.url, orderId: offer.id };
  }

  /**
   * Seller accepts a buyer-initiated listing purchase they've already been
   * paid for. No charge happens here — the money was taken at Buy time — so
   * this is a plain status transition, unlike accept-and-pay.
   */
  static async approveListingPurchase(sellerId, offerId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.sellerId !== sellerId) throw new ApiError(403, 'This is not your offer');
    if (offer.status !== 'pending_talent_approval') {
      throw new ApiError(409, `This order is ${offer.status}, not awaiting your approval`);
    }

    const now = new Date();
    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({
        status: 'accepted',
        // Only now does the clock start, and only if a duration is known.
        dueDate: offer.turnaroundMinutes
          ? new Date(now.getTime() + offer.turnaroundMinutes * 60_000)
          : offer.dueDate,
        resolvedAt: offer.resolvedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(shopCustomServiceOffers.id, offerId),
          eq(shopCustomServiceOffers.status, 'pending_talent_approval')
        )
      )
      .returning();

    if (!updated) throw new ApiError(409, 'This order was already resolved');

    await this.logActivity(offerId, sellerId, 'offer_accepted', {
      origin: 'shop_listing',
      chargedCents: updated.chargedCents,
      paymentMode: updated.paymentMode,
    });

    await createNotification({
      userId: updated.buyerId,
      title: 'Order accepted',
      message: `Your order "${updated.title}" was accepted and is now underway.`,
      type: 'shop_custom_offer',
      relatedId: updated.id,
      redirectTo: `/bookings?offerId=${updated.id}`,
      metadata: { offerId: updated.id },
    }).catch(err => logger.error(`[ShopCustomOffer] approve notify failed: ${err.message}`));

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

    // For a milestones offer the live per-stage rows are materialised first and
    // stage 1's SNAPSHOTTED amount is what gets charged — identical to what
    // _firstInstallmentBase derives from the template, but the row is the
    // source of truth every later step (webhook, approval, release, refund)
    // reads from, so it is what we bill against.
    const milestoneRows =
      offer.paymentMode === 'milestones' ? await this._ensureMilestoneRows(offer) : null;
    const installmentBase = milestoneRows
      ? milestoneRows[0].amountCents
      : this._firstInstallmentBase(offer);

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

    if (milestoneRows) {
      await this._stampMilestoneSession(milestoneRows[0].id, session.id);
    }

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

    // A buyer-initiated listing purchase isn't live yet just because it's
    // paid — it waits for the seller to accept. Everything else about this
    // handler (charge bookkeeping, spend record, reserve) is identical.
    const paidStatus = offer.origin === 'shop_listing' ? 'pending_talent_approval' : 'accepted';

    // A milestones offer's money must NEVER enter reserveAmountCents. That
    // column is what releaseCustomOfferReserves pays out against the WHOLE
    // offer 48h after deliveredAt; milestone money is released per stage by
    // releaseCustomOfferMilestoneReserves instead. Feeding both from the same
    // payment would transfer it twice. Leaving it at 0 here keeps the two
    // release paths structurally incapable of overlapping — and still lets
    // the whole-offer path do its other job on these offers, releasing tips.
    const isMilestones = offer.paymentMode === 'milestones';

    const [updated] = await db
      .update(shopCustomServiceOffers)
      .set({
        status: paidStatus,
        stripePaymentIntentId: paymentIntentId,
        stripeCustomerId, // NEW
        dueDate: computedDueDate, // NEW — the real due date, set here for the first time
        resolvedAt: paidAt,
        // Held (not transferred) until 48h after delivery — see createAcceptCheckout.
        ...(isMilestones ? {} : { reserveAmountCents: offer.sellerReceiveCents ?? 0 }),
        updatedAt: paidAt,
      })
      .where(
        and(eq(shopCustomServiceOffers.id, offerId), eq(shopCustomServiceOffers.status, 'pending'))
      )
      .returning();

    if (!updated) return; // claimed concurrently

    // Stage 1 of a milestones offer is paid by this very session, so its live
    // row is marked funded here. The offer's own chargedCents /
    // basePriceCoveredCents / sellerReceiveCents / platformShareCents were
    // already written for this installment at checkout-creation time (above),
    // so they are deliberately NOT incremented again here — only stages 2..N,
    // which get their own sessions, go through _addMilestoneMoneyToOffer.
    if (isMilestones) {
      try {
        const rows = await this._ensureMilestoneRows(updated);
        const first = rows.find(r => r.position === 0);
        if (first) {
          await this._markMilestoneFunded(first, {
            paymentIntentId,
            stripeSessionId: stripeSession.id,
            paidAt,
          });
        }
      } catch (err) {
        logger.error(
          `[ShopCustomOffer] milestone 1 funding bookkeeping failed for offer ${offerId}: ${err.message}`
        );
      }
    }

    await this.logActivity(
      updated.id,
      updated.buyerId,
      paidStatus === 'accepted' ? 'offer_accepted' : 'offer_paid',
      {
        chargedCents: updated.chargedCents,
        paymentMode: updated.paymentMode,
        ...(paidStatus === 'accepted' ? {} : { origin: 'shop_listing' }),
      }
    );

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
      title: paidStatus === 'accepted' ? 'Custom offer accepted' : 'New order request',
      message:
        paidStatus === 'accepted'
          ? `${updated.title} was accepted and paid.`
          : `${updated.title} was purchased and paid for — accept or decline it to continue.`,
      type: 'shop_custom_offer',
      relatedId: updated.id,
      redirectTo:
        paidStatus === 'accepted'
          ? `/bookings?offerId=${updated.id}`
          : '/bookings?tab=requests',
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

    // A milestones offer has one payment intent PER FUNDED STAGE, so the
    // single-intent path below would refund at most the first one. Refunds run
    // BEFORE the row is marked cancelled: if one throws, the offer stays
    // 'accepted' and the whole cancellation can simply be retried (every
    // refund call is idempotent).
    const stripeRefundId =
      offer.paymentMode === 'milestones'
        ? await this._refundMilestoneCharges(offer, userId)
        : await this._refundOfferCharge(offer, userId);

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
  /**
   * Refunds every refundable stage of a milestones offer.
   *
   * Refundable = 'funded' (paid, buyer hasn't approved it yet) and 'completed'
   * with releasedAt still null (approved, but still inside its 48h hold, so the
   * money is on the platform's own balance).
   *
   * POLICY — a stage that has already 'released' CANNOT be refunded: those
   * funds left the platform for the seller's own Connect account. Rather than
   * silently issuing a partial refund and leaving the offer in an ambiguous
   * half-paid state, the WHOLE cancellation is blocked with a 409 naming the
   * released stages, so the parties resolve it through the dispute flow (or an
   * admin) with the real numbers visible.
   */
  static async _refundMilestoneCharges(offer, actorUserId) {
    const rows = await this._loadMilestoneRows(offer.id);

    const released = rows.filter(r => r.status === 'released' || r.releasedAt);
    if (released.length > 0) {
      const labels = released.map(r => `#${r.position + 1} "${r.label}"`).join(', ');
      throw new ApiError(
        409,
        `This project can no longer be cancelled here: payment for milestone ${labels} has already been released to the provider and is outside the platform's control. Raise an issue to resolve the remaining balance.`
      );
    }

    const refundable = rows.filter(
      r =>
        (r.status === 'funded' || (r.status === 'completed' && !r.releasedAt)) &&
        r.stripePaymentIntentId &&
        r.chargedCents > 0
    );

    let lastRefundId = null;
    for (const milestone of refundable) {
      lastRefundId = await this._refundPaymentIntent(milestone.stripePaymentIntentId, {
        offerId: offer.id,
        actorUserId,
        logLabel: `offer ${offer.id} milestone ${milestone.position + 1}`,
        metadata: { milestoneId: milestone.id, milestonePosition: String(milestone.position) },
      });

      await db
        .update(shopOfferMilestones)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(shopOfferMilestones.id, milestone.id),
            inArray(shopOfferMilestones.status, ['funded', 'completed'])
          )
        );
    }

    // Stages that were never paid are closed out too, so no orphan row can be
    // funded against a cancelled offer later.
    await db
      .update(shopOfferMilestones)
      .set({ status: 'cancelled', stripeSessionId: null, updatedAt: new Date() })
      .where(
        and(
          eq(shopOfferMilestones.offerId, offer.id),
          inArray(shopOfferMilestones.status, MILESTONE_FUNDABLE_STATUSES)
        )
      );

    return lastRefundId;
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

    // Defense in depth: no code path may ever collapse a milestones offer's
    // outstanding stages into one payment. Doing so would leave the individual
    // shop_offer_milestones rows unfunded while the offer-level totals looked
    // settled — and nothing would ever release that money to the seller.
    // Every other payment mode falls straight through this check untouched.
    // Once all stages ARE funded remainingCents is exactly 0 (guaranteed by
    // _computeMilestoneAmounts), so a legitimately finished milestones project
    // finalizes below with no charge at all.
    if (offer.paymentMode === 'milestones' && remainingCents > 0) {
      throw new ApiError(
        409,
        'This project is billed per milestone — each remaining stage must be funded and approved on its own.'
      );
    }

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

    // "Pay whatever remains" is meaningless — and dangerous — on a milestones
    // offer: it would settle the offer-level balance in one click while every
    // outstanding shop_offer_milestones row stayed unfunded, so no stage would
    // ever reach the per-milestone release cron and that money would sit on
    // the platform forever. Funding goes one stage at a time.
    if (offer.paymentMode === 'milestones') {
      throw new ApiError(
        400,
        'This project is billed per milestone — fund the next stage instead of paying a remaining balance.'
      );
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
      // Stripe rejects a session that sets both `customer` and
      // `customer_email`, so these stay mutually exclusive: reuse the saved
      // Customer when the offer has one, otherwise prefill the buyer's email.
      ...(offer.stripeCustomerId
        ? { customer: offer.stripeCustomerId }
        : { customer_email: buyer?.email }),
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

    // Unreachable in practice — both paths that can mint a remainder session
    // (createRemainderCheckout and the SCA retry inside
    // _chargeRemainderAndFinalize) now refuse milestones offers outright. Kept
    // as a last line of defence: crediting a lump sum here would settle the
    // offer-level balance while leaving individual milestone rows unfunded, so
    // that money would never reach the per-milestone release cron.
    if (offer.paymentMode === 'milestones') {
      logger.error(
        `[ShopCustomOffer] refusing remainder webhook on milestones offer ${offerId} — session ${stripeSession.id} needs manual review`
      );
      return;
    }

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

  // ═══════════ Milestone funding & approval (paymentMode 'milestones') ══════

  /**
   * Buyer funds EXACTLY ONE milestone via hosted Stripe Checkout.
   *
   * Modelled on createRemainderCheckout, but scoped to a single stage's
   * snapshotted amountCents — never "whatever remains". Every guard below is
   * server-side; the client supplies only ids.
   */
  static async createMilestoneFundingCheckout(buyerId, offerId, milestoneId, platform) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not for you');
    if (offer.status !== 'accepted') {
      throw new ApiError(409, `Only an accepted offer can be funded (this one is ${offer.status})`);
    }
    if (offer.paymentMode !== 'milestones') {
      throw new ApiError(400, 'This offer is not on a milestone payment schedule');
    }
    if (!stripe) throw new ApiError(503, 'Payments are not configured');

    const rows = await this._ensureMilestoneRows(offer);
    const milestone = rows.find(r => r.id === milestoneId);
    if (!milestone) throw new ApiError(404, 'Milestone not found on this offer');
    if (!MILESTONE_FUNDABLE_STATUSES.includes(milestone.status)) {
      throw new ApiError(409, `This milestone is already ${milestone.status}`);
    }

    // Sequencing — this is what makes "milestone 2 can't be funded before
    // milestone 1 is approved" true on the server rather than in the UI.
    if (milestone.position > 0) {
      const previous = rows.find(r => r.position === milestone.position - 1);
      if (!previous || !['completed', 'released'].includes(previous.status)) {
        throw new ApiError(
          409,
          'The previous milestone must be approved before this one can be funded'
        );
      }
    }

    // Same live re-check as createAcceptCheckout/createListingPurchase:
    // chargesEnabled only refreshes on the account.updated webhook, so a stale
    // false must be re-checked before rejecting a real payment.
    let connectAccount = await StripeConnectService.getForUser(offer.sellerId);
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(offer.sellerId).catch(
        () => connectAccount
      );
    }
    if (!connectAccount?.chargesEnabled) {
      throw new ApiError(400, "This creator can't accept payments yet");
    }

    // Double-session guard: a double-click must not produce two live Checkout
    // sessions for one stage, because paying both would be two real charges
    // for the same milestone.
    if (milestone.status === 'awaiting_payment' && milestone.stripeSessionId) {
      try {
        const openSession = await stripe.checkout.sessions.retrieve(milestone.stripeSessionId);
        if (openSession?.status === 'open' && openSession.url) {
          return {
            checkoutUrl: openSession.url,
            offerId: offer.id,
            milestoneId: milestone.id,
            reusedSession: true,
          };
        }
      } catch (err) {
        logger.warn(
          `[ShopCustomOffer] could not retrieve existing milestone session ${milestone.stripeSessionId}: ${err.message}`
        );
      }
    }

    const fees = ShopOrderService.computeFees(milestone.amountCents);
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { email: true },
    });

    const metadata = {
      type: 'shop_custom_offer_milestone',
      offerId: offer.id,
      milestoneId: milestone.id,
      position: String(milestone.position),
      buyerId,
      sellerId: offer.sellerId,
    };

    const redirectUrls = getRedirectUrls(
      platform,
      process.env.FRONTEND_URL || 'https://briteside.app',
      `/bookings?offerId=${offer.id}&status=success`,
      `/bookings?offerId=${offer.id}&status=cancelled`
    );

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: milestone.amountCents,
            product_data: {
              name: `${offer.title} — ${milestone.label} (milestone ${milestone.position + 1} of ${rows.length})`,
            },
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
      success_url: redirectUrls.successUrl,
      cancel_url: redirectUrls.cancelUrl,
      // Stripe rejects a session that sets both `customer` and
      // `customer_email` — same mutually-exclusive handling as
      // createRemainderCheckout.
      ...(offer.stripeCustomerId
        ? { customer: offer.stripeCustomerId }
        : { customer_email: buyer?.email }),
      metadata,
      // No transfer_data/application_fee_amount here on purpose — see
      // createAcceptCheckout. This stage's seller cut is held until 48h after
      // the buyer approves it, then transferred by
      // releaseCustomOfferMilestoneReserves.
      payment_intent_data: { metadata },
    });

    await this._stampMilestoneSession(milestone.id, session.id);

    return { checkoutUrl: session.url, offerId: offer.id, milestoneId: milestone.id };
  }

  /**
   * Webhook target for a per-milestone funding checkout (stages 2..N).
   *
   * Idempotent against Stripe's at-least-once redelivery: the funding UPDATE is
   * conditional on the row not already being settled, and every side effect
   * below only runs if that UPDATE actually claimed the row.
   */
  static async handleMilestonePaymentWebhook(stripeSession) {
    const milestoneId = stripeSession.metadata?.milestoneId;
    const offerId = stripeSession.metadata?.offerId;
    if (!milestoneId || !offerId) return;

    const milestone = await db.query.shopOfferMilestones.findFirst({
      where: eq(shopOfferMilestones.id, milestoneId),
    });
    if (!milestone || milestone.offerId !== offerId) return;
    if (MILESTONE_SETTLED_STATUSES.includes(milestone.status)) return; // redelivery

    const offer = await db.query.shopCustomServiceOffers.findFirst({
      where: eq(shopCustomServiceOffers.id, offerId),
    });
    if (!offer) return;

    const paidAt = new Date();
    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : (stripeSession.payment_intent?.id ?? null);

    const result = await this._markMilestoneFunded(milestone, {
      paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });
    if (!result) return; // claimed concurrently

    const { milestone: funded, fees } = result;

    // Offer-level running totals only — NOT reserveAmountCents.
    await this._addMilestoneMoneyToOffer(offerId, funded.amountCents, fees, paidAt);

    await this.logActivity(offerId, offer.buyerId, 'milestone_funded', {
      milestoneId: funded.id,
      position: funded.position,
      label: funded.label,
      amountCents: funded.amountCents,
      chargedCents: fees.chargedCents,
    });

    // Recorded against the OFFER (not the milestone row) so the existing
    // markSpendRefunded call in cancelOffer — which matches on
    // referenceId = offer.id — covers every stage's spend too.
    await UserSpendService.recordSpend({
      userId: offer.buyerId,
      spendType: 'shop',
      amountCents: fees.chargedCents,
      referenceId: offer.id,
      referenceType: 'shop_custom_offer',
      talentUserId: offer.sellerId,
      metadata: {
        offerId: offer.id,
        title: offer.title,
        milestoneId: funded.id,
        milestonePosition: funded.position,
      },
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: stripeSession.id,
      paidAt,
    });

    await createNotification({
      userId: offer.sellerId,
      title: 'Milestone funded',
      message: `"${funded.label}" on "${offer.title}" has been funded — you can start this stage.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, milestoneId: funded.id },
    }).catch(err =>
      logger.error(`[ShopCustomOffer] milestone funded notify failed: ${err.message}`)
    );
  }

  /**
   * An abandoned milestone checkout must not wedge that stage at
   * 'awaiting_payment' forever, or the buyer could never start a fresh one.
   *
   * Guarded on the session id as well as the status so a late expiry event for
   * a SUPERSEDED session can't clear the id of a newer, still-live one.
   */
  static async handleMilestoneCheckoutExpired(stripeSession) {
    const milestoneId = stripeSession.metadata?.milestoneId;
    if (!milestoneId) return;

    await db
      .update(shopOfferMilestones)
      .set({ status: 'pending', stripeSessionId: null, updatedAt: new Date() })
      .where(
        and(
          eq(shopOfferMilestones.id, milestoneId),
          eq(shopOfferMilestones.status, 'awaiting_payment'),
          eq(shopOfferMilestones.stripeSessionId, stripeSession.id)
        )
      );
  }

  /**
   * Buyer approves one delivered stage. Gates on the SAME per-round delivery
   * state the whole-offer acceptDelivery uses — a milestones project runs one
   * submit-work round per stage.
   */
  static async completeMilestone(buyerId, offerId, milestoneId, io = null) {
    const offer = await this.loadOffer(offerId);
    if (offer.buyerId !== buyerId) throw new ApiError(403, 'This offer is not yours');
    if (offer.status !== 'accepted') {
      throw new ApiError(
        409,
        `Only an in-progress offer can be approved (this one is ${offer.status})`
      );
    }
    if (offer.paymentMode !== 'milestones') {
      throw new ApiError(400, 'This offer is not on a milestone payment schedule');
    }
    if (offer.deliveryState !== 'delivered') {
      throw new ApiError(409, 'There is no delivery waiting for your review on this offer');
    }

    const rows = await this._ensureMilestoneRows(offer);
    const milestone = rows.find(r => r.id === milestoneId);
    if (!milestone) throw new ApiError(404, 'Milestone not found on this offer');
    if (milestone.status !== 'funded') {
      throw new ApiError(409, `This milestone is ${milestone.status}, not funded`);
    }

    return this._approveMilestoneStage(offer, milestone, rows, { actorUserId: buyerId, io });
  }

  /**
   * Shared by completeMilestone (buyer-initiated) and the auto-approve cron.
   * Approving a stage NEVER funds the next one — funding is always an explicit
   * buyer action.
   */
  static async _approveMilestoneStage(offer, milestone, rows, { actorUserId, auto = false, io = null } = {}) {
    const now = new Date();
    const releaseAt = new Date(now.getTime() + MILESTONE_RELEASE_HOLD_MS);

    const [approved] = await db
      .update(shopOfferMilestones)
      .set({ status: 'completed', completedAt: now, releaseAt, updatedAt: now })
      .where(
        and(eq(shopOfferMilestones.id, milestone.id), eq(shopOfferMilestones.status, 'funded'))
      )
      .returning();

    if (!approved) throw new ApiError(409, 'This milestone was already approved');

    await this.logActivity(offer.id, offer.buyerId, 'milestone_approved', {
      milestoneId: approved.id,
      position: approved.position,
      label: approved.label,
      amountCents: approved.amountCents,
      auto,
    });

    await createNotification({
      userId: offer.sellerId,
      title: 'Milestone approved',
      message: `"${approved.label}" on "${offer.title}" was approved${
        auto ? ' automatically' : ''
      } — those funds are released to you in 48 hours.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, milestoneId: approved.id },
    }).catch(err =>
      logger.error(`[ShopCustomOffer] milestone approved notify failed: ${err.message}`)
    );

    const next = rows.find(r => r.position === approved.position + 1);

    if (next) {
      // Reset the delivery round so the seller can submit this next stage's
      // work cleanly. Clearing deliveredAt matters: autoApproveOverdueDeliveries
      // scans on deliveryState='delivered' AND deliveredAt <= cutoff, so a
      // stale timestamp here would make it try to finalize the WHOLE project
      // off a delivery that has already been reviewed.
      await db
        .update(shopCustomServiceOffers)
        .set({ deliveryState: 'awaiting_delivery', deliveredAt: null, updatedAt: now })
        .where(eq(shopCustomServiceOffers.id, offer.id));

      await createNotification({
        userId: offer.buyerId,
        title: 'Next milestone ready to fund',
        message: `"${approved.label}" is approved. Fund "${next.label}" to start the next stage of "${offer.title}".`,
        type: 'shop_custom_offer',
        relatedId: offer.id,
        redirectTo: `/bookings?offerId=${offer.id}`,
        metadata: { offerId: offer.id, milestoneId: next.id },
      }).catch(err =>
        logger.error(`[ShopCustomOffer] next milestone notify failed: ${err.message}`)
      );

      const refreshed = await this.loadOffer(offer.id);
      this._emitOfferUpdate(io, refreshed);

      return {
        offer: this._stripAttachments(refreshed),
        milestone: approved,
        nextMilestoneId: next.id,
        projectCompleted: false,
        requiresBuyerPayment: false,
      };
    }

    // Last stage: the whole project is done. Every milestone is funded by
    // construction at this point, so remainingCents is exactly 0 and
    // _chargeRemainderAndFinalize finalizes with NO further payment.
    // deliveredAt is deliberately left set here — tip and reserve-release
    // logic elsewhere keys off it.
    const result = await this._chargeRemainderAndFinalize(offer, auto ? 'system' : actorUserId);
    this._emitOfferUpdate(io, result.offer);

    return {
      offer: result.offer,
      milestone: approved,
      nextMilestoneId: null,
      projectCompleted: !result.requiresBuyerPayment,
      requiresBuyerPayment: result.requiresBuyerPayment,
    };
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
        // A milestones offer auto-approves only the CURRENT stage — never the
        // whole project, and never by funding anything: funding always
        // requires an explicit buyer click. Every other payment mode falls
        // through to the unchanged lump-sum path below.
        if (offer.paymentMode === 'milestones') {
          await this._autoApproveMilestoneStage(offer);
          continue;
        }

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

  /**
   * The milestones-mode branch of autoApproveOverdueDeliveries: approves the
   * one stage the buyer left unanswered for 3 days, exactly as if they had
   * clicked approve. It cannot charge anything — _approveMilestoneStage only
   * moves the current row to 'completed' and, on the LAST stage, finalizes a
   * project whose balance is already zero.
   */
  static async _autoApproveMilestoneStage(offer) {
    const rows = await this._ensureMilestoneRows(offer);
    const current = this._currentMilestone(rows);

    if (!current) {
      logger.warn(
        `[ShopCustomOffer] auto-approve skipped offer ${offer.id}: delivery is overdue but no funded milestone is awaiting approval`
      );
      return null;
    }

    const result = await this._approveMilestoneStage(offer, current, rows, {
      actorUserId: offer.buyerId,
      auto: true,
    });

    await createNotification({
      userId: offer.buyerId,
      title: result.projectCompleted ? 'Order auto-approved' : 'Milestone auto-approved',
      message: result.projectCompleted
        ? `You didn't respond to the final delivery for "${offer.title}" within 3 days, so it was automatically approved and payment released.`
        : `You didn't respond to the delivery for "${current.label}" on "${offer.title}" within 3 days, so that milestone was automatically approved.`,
      type: 'shop_custom_offer',
      relatedId: offer.id,
      redirectTo: `/bookings?offerId=${offer.id}`,
      metadata: { offerId: offer.id, milestoneId: current.id, auto: true },
    }).catch(err =>
      logger.error(`[ShopCustomOffer] milestone auto-approve buyer notify failed: ${err.message}`)
    );

    return result;
  }
}
