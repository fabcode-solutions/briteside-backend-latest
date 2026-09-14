import { db } from '../../db/index.js';
import {
  shopProducts,
  shopProductViews,
  shopOrders,
  shopCourseModules,
  socialProfiles,
  talentProfiles,
  productAnalyticsDaily,
} from '../../db/schema/index.js';
import { eq, and, isNull, inArray, sql, asc, desc, count, max, gte, lte } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { ProfileService } from '../social/profile.service.js';
import { StripeConnectService } from '../stripeConnect.service.js';
import { inspect } from 'util';

const MAX_GALLERY = 6;
const MAX_MODULES = 20;
const MAX_PINNED = 9;
const MIN_REFUND_WINDOW_DAYS = 1;
const MAX_REFUND_WINDOW_DAYS = 90;
const BUTTON_ACTIONS = ['payment', 'redirect'];
const DELIVERY_TYPES = ['file', 'link'];
const PAYMENT_MODES = ['full', 'deposit', 'milestones'];
const MAX_MILESTONES = 10;
const LISTING_TYPES = ['product', 'service', 'course', 'link'];
const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Creator Shop — product catalog.
 *
 * Delivery fields (deliveryFileKey / deliveryLink / deliveryFileName) identify
 * what a buyer receives, so they are stripped for anyone who is not the owner.
 * Once orders exist (phase 2), buyers reach them only through the download
 * endpoint, which re-checks their order every time.
 */
export class ShopProductService {
  static sanitize(product, isOwner) {
    if (!product) return null;
    const {
      deliveryFileKey: _key,
      deliveryLink: _link,
      deliveryFileName: _name,
      ...publicFields
    } = product;

    const hasDeliverable = !!(product.deliveryFileKey || product.deliveryLink);

    if (!isOwner) {
      // Non-owners still need to know a file is included, just not what or where.
      return { ...publicFields, hasDeliverable };
    }

    return {
      ...publicFields,
      deliveryFileKey: product.deliveryFileKey,
      deliveryLink: product.deliveryLink,
      deliveryFileName: product.deliveryFileName,
      hasDeliverable,
    };
  }

  static validate(data, { partial = false } = {}) {
    const required = key => !partial || data[key] !== undefined;

    // Resolved up front — description and delivery checks below both branch
    // on it, and a 'link' listing (LinkFormDialog) collects neither.
    const buttonAction = data.buttonAction ?? (partial ? undefined : 'payment');

    if (data.listingType !== undefined && !LISTING_TYPES.includes(data.listingType)) {
      throw new ApiError(400, `listingType must be one of: ${LISTING_TYPES.join(', ')}`);
    }

    if (required('title') && !data.title?.trim()) {
      throw new ApiError(400, 'Title is required');
    }
    if (data.title && data.title.length > 200) {
      throw new ApiError(400, 'Title must be 200 characters or fewer');
    }

    // Redirect listings (link-in-bio) don't collect a description in the UI —
    // only payment products require one. Strip tags first so a description of
    // only markup still counts as empty for payment products.
 if (
  buttonAction !== 'redirect' &&
  data.listingType !== 'link' &&
  required('description') &&
  !data.description?.replace(/<[^>]*>/g, '').trim()
) {
  throw new ApiError(400, 'Description is required');
}

    if (required('priceCents')) {
      const price = Number(data.priceCents);
      if (!Number.isInteger(price) || price < 0) {
        throw new ApiError(400, 'Price must be a whole number of cents, zero or more');
      }
    }

    if (buttonAction !== undefined && !BUTTON_ACTIONS.includes(buttonAction)) {
      throw new ApiError(400, `buttonAction must be one of: ${BUTTON_ACTIONS.join(', ')}`);
    }

    if (buttonAction === 'redirect') {
      if (!data.redirectUrl?.trim()) {
        throw new ApiError(400, 'A redirect URL is required for redirect products');
      }
      if (!URL_PATTERN.test(data.redirectUrl.trim())) {
        throw new ApiError(400, 'Redirect URL must start with http:// or https://');
      }
    }

    if (buttonAction === 'payment') {
      // Loose null check: a service (or any product with no delivery
      // mechanism) legitimately has deliveryType === null in the DB, so a
      // partial update re-validating the merged existing+incoming data must
      // treat that the same as "not provided" — not as an invalid value.
      if (data.deliveryType != null && !DELIVERY_TYPES.includes(data.deliveryType)) {
        throw new ApiError(400, `deliveryType must be one of: ${DELIVERY_TYPES.join(', ')}`);
      }
      if (data.deliveryType === 'link') {
        if (!data.deliveryLink?.trim()) {
          throw new ApiError(400, 'A delivery link is required when delivering by link');
        }
        if (!URL_PATTERN.test(data.deliveryLink.trim())) {
          throw new ApiError(400, 'Delivery link must start with http:// or https://');
        }
      }
      if (data.deliveryType === 'file' && !data.deliveryFileKey?.trim()) {
        throw new ApiError(400, 'Upload a file before saving a file-delivered product');
      }
    }

    if (data.gallery !== undefined) {
      if (!Array.isArray(data.gallery)) {
        throw new ApiError(400, 'Gallery must be an array');
      }
      if (data.gallery.length > MAX_GALLERY) {
        throw new ApiError(400, `Gallery is limited to ${MAX_GALLERY} items`);
      }
      const malformed = data.gallery.some(
        item => !item?.url || !['image', 'video'].includes(item?.type)
      );
      if (malformed) {
        throw new ApiError(400, 'Each gallery item needs a url and a type of image or video');
      }
    }

    if (data.courseModules !== undefined) {
      if (!Array.isArray(data.courseModules)) {
        throw new ApiError(400, 'courseModules must be an array');
      }
      if (data.courseModules.length > MAX_MODULES) {
        throw new ApiError(400, `courseModules is limited to ${MAX_MODULES} items`);
      }
      const malformed = data.courseModules.some(
        m =>
          !m?.title?.trim() ||
          !Number.isFinite(Number(m?.lessonsCount)) ||
          Number(m?.lessonsCount) < 1
      );
      if (malformed) {
        throw new ApiError(400, 'Each module needs a title and at least 1 lesson');
      }
    }

    if (data.revisionsIncluded) {
      const r = Number(data.revisionsCount);
      if (!Number.isFinite(r) || r < 1) {
        throw new ApiError(400, 'revisionsCount must be at least 1 when revisions are included');
      }
    }

    if (data.paymentMode !== undefined && data.paymentMode !== null) {
      if (!PAYMENT_MODES.includes(data.paymentMode)) {
        throw new ApiError(400, `paymentMode must be one of: ${PAYMENT_MODES.join(', ')}`);
      }
      if (data.paymentMode === 'deposit') {
        const pct = Number(data.depositPercent);
        if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
          throw new ApiError(400, 'depositPercent must be a whole number between 1 and 100');
        }
      }
      if (data.paymentMode === 'milestones') {
        if (!Array.isArray(data.milestones) || data.milestones.length < 2) {
          throw new ApiError(400, 'milestones must have at least 2 entries for milestone payments');
        }
        if (data.milestones.length > MAX_MILESTONES) {
          throw new ApiError(400, `No more than ${MAX_MILESTONES} milestones`);
        }
        const malformedMilestone = data.milestones.some(
          m => !m?.label?.trim() || !Number.isFinite(Number(m?.percent)) || Number(m?.percent) <= 0
        );
        if (malformedMilestone) {
          throw new ApiError(400, 'Each milestone needs a label and a percentage greater than 0');
        }
        const total = data.milestones.reduce((sum, m) => sum + Number(m.percent), 0);
        if (Math.round(total) !== 100) {
          throw new ApiError(400, 'Milestone percentages must add up to 100');
        }
      }
    }
  }

  /** Fields a create or update is allowed to set, normalised for the DB. */
  static buildWritableFields(data) {
    const buttonAction = data.buttonAction ?? 'payment';
    const isRedirect = buttonAction === 'redirect';
    const deliveryType = isRedirect ? null : (data.deliveryType ?? null);

    return {
      title: data.title?.trim(),
      // Optional now — 'link' listings never send one.
      description: data.description?.trim() || null,
      priceCents: Number(data.priceCents ?? 0),
      coverUrl: data.coverUrl || null,
      coverType: data.coverUrl ? data.coverType || 'image' : null,
      gallery: data.gallery ?? [],
      ctaTitle: data.ctaTitle?.trim() || null,
      buttonAction,
      listingType: data.listingType ?? 'product',
      isPhysical: !!data.isPhysical,
      // Only one of the redirect / delivery branches is ever populated, so the
      // other is explicitly nulled — otherwise switching a product's type
      // leaves stale values behind that later reads would honour.
      redirectUrl: isRedirect ? data.redirectUrl.trim() : null,
      deliveryType,
      deliveryFileKey: deliveryType === 'file' ? data.deliveryFileKey : null,
      deliveryFileName: deliveryType === 'file' ? data.deliveryFileName || null : null,
      deliveryLink: deliveryType === 'link' ? data.deliveryLink.trim() : null,
      listingType: data.listingType ?? 'product',
      serviceKind: data.serviceKind || null,
      turnaround: data.turnaround?.trim() || null,
      cancellationPolicy: data.cancellationPolicy?.trim() || null,
      revisionsIncluded: data.revisionsIncluded ?? false,
      revisionsCount: data.revisionsIncluded ? Number(data.revisionsCount) : null,
      pricingModel: data.pricingModel || null,
      fromPrice: data.fromPrice ?? false,
      paymentMode: data.paymentMode || null,
      // Only one of these two ever applies to a given paymentMode, so the
      // other is explicitly nulled — otherwise switching payment modes
      // leaves a stale deposit % or milestone list behind.
      depositPercent: data.paymentMode === 'deposit' ? Number(data.depositPercent) : null,
      milestones: data.paymentMode === 'milestones' ? data.milestones : null,
      // Courses are drafted in the Talent Dashboard and stay out of the public
      // Shop tab until explicitly published there; every other listing type
      // is published by default. Explicit values (updates carry the existing
      // row's value through the merge) always win over this default.
      publishedToShop:
        data.publishedToShop !== undefined
          ? !!data.publishedToShop
          : (data.listingType ?? 'product') !== 'course',
    };
  }

  /**
   * Replace a course listing's module rows wholesale. Simplest correct model
   * for a short, fully-reordered-on-every-save list (the Shop course form has
   * no per-module id of its own — it just posts the current full list).
   */
  static async syncCourseModules(tx, productId, modules) {
    await tx.delete(shopCourseModules).where(eq(shopCourseModules.productId, productId));
    if (!modules?.length) return [];

    return tx
      .insert(shopCourseModules)
      .values(
        modules.map((m, index) => ({
          productId,
          title: m.title.trim(),
          lessonsCount: Number(m.lessonsCount),
          sortOrder: index,
        }))
      )
      .returning();
  }

  /** Attach `courseModules` to a batch of product rows, one query for all of them. */
  static async attachCourseModules(products) {
    const ids = products.map(p => p.id);
    if (ids.length === 0) return products;

    const rows = await db.query.shopCourseModules.findMany({
      where: inArray(shopCourseModules.productId, ids),
      orderBy: [asc(shopCourseModules.productId), asc(shopCourseModules.sortOrder)],
    });

    const byProduct = new Map();
    for (const row of rows) {
      if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
      byProduct.get(row.productId).push({ title: row.title, lessonsCount: row.lessonsCount });
    }

    return products.map(p => ({ ...p, courseModules: byProduct.get(p.id) ?? [] }));
  }

  /**
   * Selling requires a talent profile.
   */
  static async canSell(userId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.userId, userId), isNull(talentProfiles.deletedAt)),
      columns: { id: true },
    });
    return !!profile;
  }

  static async assertCanSell(userId) {
    if (!(await this.canSell(userId))) {
      throw new ApiError(
        403,
        'Set up your creator profile before selling — shop payouts are paid out through it.'
      );
    }
  }

  static async assertOwnership(userId, productId) {
    const product = await db.query.shopProducts.findFirst({
      where: and(eq(shopProducts.id, productId), isNull(shopProducts.deletedAt)),
    });
    if (!product) throw new ApiError(404, 'Product not found');
    if (product.userId !== userId) throw new ApiError(403, 'This is not your product');
    return product;
  }

  static async listForUser(sellerId, viewerId) {
    const isOwner = sellerId === viewerId;
    const settings = await this.getShopSettings(sellerId);

    if (!isOwner && !settings.shopVisible) {
      return { products: [], pinnedProducts: [], settings, canSell: false, payoutsReady: false ,talentRating: null,};
    }

    const [rows, canSell, connectAccount, talentProfile] = await Promise.all([
      db.query.shopProducts.findMany({
        where: and(
          eq(shopProducts.userId, sellerId),
          isNull(shopProducts.deletedAt),
          eq(shopProducts.publishedToShop, true)
        ),
        orderBy: [asc(shopProducts.displayOrder), desc(shopProducts.createdAt)],
      }),
      isOwner ? this.canSell(sellerId) : Promise.resolve(false),
      isOwner ? StripeConnectService.getForUser(sellerId).catch(() => null) : Promise.resolve(null),
      db.query.talentProfiles.findFirst({
        where: and(eq(talentProfiles.userId, sellerId), isNull(talentProfiles.deletedAt)),
        columns: { rating: true, reviewCount: true },
      }),
    ]);

    // Pinned products are returned as their own ordered list and removed from
    // the main one, so the grid renders a Pinned section without de-duping.
    const withModules = await this.attachCourseModules(rows);
    const pinnedRows = withModules
      .filter(row => row.isPinned)
      .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));

    return {
      products: withModules.filter(row => !row.isPinned).map(row => this.sanitize(row, isOwner)),
      pinnedProducts: pinnedRows.map(row => this.sanitize(row, isOwner)),
      settings,
      canSell,
      payoutsReady: !!connectAccount?.chargesEnabled,
      talentRating:
        talentProfile && talentProfile.reviewCount > 0
          ? { rating: Number(talentProfile.rating), reviewCount: talentProfile.reviewCount }
          : null,
    };
  }

  static async getProduct(productId, viewerId) {
    const product = await db.query.shopProducts.findFirst({
      where: and(eq(shopProducts.id, productId), isNull(shopProducts.deletedAt)),
    });
    if (!product) throw new ApiError(404, 'Product not found');

    const isOwner = product.userId === viewerId;
    const settings = await this.getShopSettings(product.userId);
    if (!isOwner && !settings.shopVisible) throw new ApiError(404, 'Product not found');

    const [withModules] = await this.attachCourseModules([product]);
    return { product: this.sanitize(withModules, isOwner), settings };
  }

  static async createProduct(userId, data) {
  await this.assertCanSell(userId);
  this.validate(data);

  const [{ value: lowest }] = await db
    .select({ value: sql`COALESCE(MIN(${shopProducts.displayOrder}), 0)` })
    .from(shopProducts)
    .where(and(eq(shopProducts.userId, userId), isNull(shopProducts.deletedAt)));

    const { courseModules, ...created } = await db.transaction(async tx => {
      const [product] = await tx
        .insert(shopProducts)
        .values({
          userId,
          ...this.buildWritableFields(data),
          displayOrder: Number(lowest) - 1,
        })
        .returning();

      const modules = await this.syncCourseModules(tx, product.id, data.courseModules ?? []);
      return {
        ...product,
        courseModules: modules.map(m => ({ title: m.title, lessonsCount: m.lessonsCount })),
      };
    });

    return { ...this.sanitize(created, true), courseModules };
  try {
    const [created] = await db
      .insert(shopProducts)
      .values({
        userId,
        ...this.buildWritableFields(data),
        displayOrder: Number(lowest) - 1,
      })
      .returning();

    return this.sanitize(created, true);
  } catch (err) {
    console.error('=== RAW INSERT ERROR ===');
    console.error(inspect(err, { depth: null, colors: false }));
    console.error('=== END RAW INSERT ERROR ===');
    throw err;
  }
}

  static async updateProduct(userId, productId, data) {
    const existing = await this.assertOwnership(userId, productId);

    const merged = { ...existing, ...data };
    this.validate(merged);

    const { courseModules, ...updated } = await db.transaction(async tx => {
      const [product] = await tx
        .update(shopProducts)
        .set({ ...this.buildWritableFields(merged), updatedAt: new Date() })
        .where(eq(shopProducts.id, productId))
        .returning();

      // Only touch modules when the request actually sent them — an unrelated
      // edit (e.g. just the price) must not wipe the existing syllabus.
      const modules =
        data.courseModules !== undefined
          ? await this.syncCourseModules(tx, productId, data.courseModules)
          : await tx.query.shopCourseModules.findMany({
              where: eq(shopCourseModules.productId, productId),
              orderBy: [asc(shopCourseModules.sortOrder)],
            });

      return {
        ...product,
        courseModules: modules.map(m => ({ title: m.title, lessonsCount: m.lessonsCount })),
      };
    });

    return { ...this.sanitize(updated, true), courseModules };
  }

  static async deleteProduct(userId, productId) {
    await this.assertOwnership(userId, productId);

    await db
      .update(shopProducts)
      .set({ deletedAt: new Date(), isPinned: false, pinOrder: null, updatedAt: new Date() })
      .where(eq(shopProducts.id, productId));

    return { deleted: true };
  }

  // --------- pin helpers (mirror pinned posts: max 9, 1-based pin_order) ------

  static async pinProduct(userId, productId) {
    const product = await this.assertOwnership(userId, productId);

    if (product.isPinned) return this.sanitize(product, true);

    const pinnedForUser = and(
      eq(shopProducts.userId, userId),
      eq(shopProducts.isPinned, true),
      isNull(shopProducts.deletedAt)
    );

    const [[{ total }], [{ maxOrder }]] = await Promise.all([
      db.select({ total: count() }).from(shopProducts).where(pinnedForUser),
      db
        .select({ maxOrder: max(shopProducts.pinOrder) })
        .from(shopProducts)
        .where(pinnedForUser),
    ]);

    if (Number(total) >= MAX_PINNED) {
      throw new ApiError(400, `Maximum of ${MAX_PINNED} pinned products reached`);
    }

    const [updated] = await db
      .update(shopProducts)
      .set({
        isPinned: true,
        pinOrder: Math.min(Number(maxOrder ?? 0) + 1, MAX_PINNED),
        updatedAt: new Date(),
      })
      .where(eq(shopProducts.id, productId))
      .returning();

    return this.sanitize(updated, true);
  }

  static async unpinProduct(userId, productId) {
    await this.assertOwnership(userId, productId);

    const [updated] = await db
      .update(shopProducts)
      .set({ isPinned: false, pinOrder: null, updatedAt: new Date() })
      .where(eq(shopProducts.id, productId))
      .returning();

    return this.sanitize(updated, true);
  }

  static async reorderPins(userId, productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new ApiError(400, 'productIds must be a non-empty array');
    }
    if (productIds.length > MAX_PINNED) {
      throw new ApiError(400, `No more than ${MAX_PINNED} pinned products can be ordered`);
    }

    const pinned = await db.query.shopProducts.findMany({
      where: and(
        eq(shopProducts.userId, userId),
        eq(shopProducts.isPinned, true),
        isNull(shopProducts.deletedAt)
      ),
      columns: { id: true },
    });
    const pinnedIds = new Set(pinned.map(p => p.id));
    const toUpdate = productIds.filter(id => pinnedIds.has(id));

    if (toUpdate.length === 0) throw new ApiError(400, 'No matching pinned products to reorder');

    await Promise.all(
      toUpdate.map((id, index) =>
        db
          .update(shopProducts)
          .set({ pinOrder: index + 1, updatedAt: new Date() })
          .where(eq(shopProducts.id, id))
      )
    );

    return { reordered: toUpdate.length };
  }

  static async reorder(userId, productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new ApiError(400, 'productIds must be a non-empty array');
    }

    const owned = await db.query.shopProducts.findMany({
      where: and(eq(shopProducts.userId, userId), isNull(shopProducts.deletedAt)),
      columns: { id: true },
    });
    const ownedIds = new Set(owned.map(p => p.id));
    const toUpdate = productIds.filter(id => ownedIds.has(id));

    if (toUpdate.length === 0) throw new ApiError(400, 'No matching products to reorder');

    await Promise.all(
      toUpdate.map((id, index) =>
        db
          .update(shopProducts)
          .set({ displayOrder: index, updatedAt: new Date() })
          .where(eq(shopProducts.id, id))
      )
    );

    return { reordered: toUpdate.length };
  }

  static async getShopSettings(sellerId) {
    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, sellerId),
      columns: {
        shopVisible: true,
        shopRefundsEnabled: true,
        shopRefundWindowDays: true,
        shopRefundAfterDownload: true,
      },
    });

    return {
      shopVisible: profile?.shopVisible ?? true,
      refundsEnabled: profile?.shopRefundsEnabled ?? true,
      refundWindowDays: profile?.shopRefundWindowDays ?? 14,
      refundAfterDownload: profile?.shopRefundAfterDownload ?? false,
    };
  }

  static async setRefundPolicy(userId, { refundsEnabled, refundWindowDays, refundAfterDownload }) {
    if (typeof refundsEnabled !== 'boolean') {
      throw new ApiError(400, 'refundsEnabled must be true or false');
    }
    if (typeof refundAfterDownload !== 'boolean') {
      throw new ApiError(400, 'refundAfterDownload must be true or false');
    }

    const days = Number(refundWindowDays);
    if (!Number.isInteger(days) || days < MIN_REFUND_WINDOW_DAYS || days > MAX_REFUND_WINDOW_DAYS) {
      throw new ApiError(
        400,
        `Refund window must be a whole number between ${MIN_REFUND_WINDOW_DAYS} and ${MAX_REFUND_WINDOW_DAYS} days`
      );
    }

    await ProfileService.getOrCreateSocialProfile(userId);
    await db
      .update(socialProfiles)
      .set({
        shopRefundsEnabled: refundsEnabled,
        shopRefundWindowDays: days,
        shopRefundAfterDownload: refundAfterDownload,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.userId, userId));

    return this.getShopSettings(userId);
  }

  static async setVisibility(userId, visible) {
    if (typeof visible !== 'boolean') {
      throw new ApiError(400, 'visible must be true or false');
    }

    await ProfileService.getOrCreateSocialProfile(userId);
    await db
      .update(socialProfiles)
      .set({ shopVisible: visible, updatedAt: new Date() })
      .where(eq(socialProfiles.userId, userId));

    return { shopVisible: visible };
  }

  static async recordView(productId, viewerId) {
    const product = await db.query.shopProducts.findFirst({
      where: and(eq(shopProducts.id, productId), isNull(shopProducts.deletedAt)),
      columns: { id: true, userId: true },
    });
    if (!product) throw new ApiError(404, 'Product not found');

    if (product.userId === viewerId) return { counted: false };

    const inserted = await db
      .insert(shopProductViews)
      .values({ productId, userId: viewerId })
      .onConflictDoNothing()
      .returning({ id: shopProductViews.id });

    if (inserted.length === 0) return { counted: false };

    await db
      .update(shopProducts)
      .set({ viewsCount: sql`${shopProducts.viewsCount} + 1` })
      .where(eq(shopProducts.id, productId));

    return { counted: true };
  }

  static async countForUser(sellerId) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(shopProducts)
      .where(and(eq(shopProducts.userId, sellerId), isNull(shopProducts.deletedAt)));
    return value;
  }

  // --------- per-product analytics ---------

  static resolveAnalyticsRange({ days, from, to } = {}) {
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(end.getTime())) throw new ApiError(400, 'Invalid `to` date');

    let start = null;

    if (from) {
      start = new Date(from);
      if (Number.isNaN(start.getTime())) throw new ApiError(400, 'Invalid `from` date');
      if (start > end) throw new ApiError(400, '`from` must be before `to`');
    } else if (days !== undefined && days !== null && days !== 'all') {
      const window = Number(days);
      if (!Number.isInteger(window) || window < 1 || window > 730) {
        throw new ApiError(400, 'days must be a whole number between 1 and 730, or "all"');
      }
      start = new Date(end.getTime() - window * 24 * 60 * 60 * 1000);
    }

    return {
      start,
      end,
      previousStart: start ? new Date(start.getTime() - (end.getTime() - start.getTime())) : null,
    };
  }

  static async getProductAnalytics(userId, productId, params = {}) {
    const product = await this.assertOwnership(userId, productId);
    const { start, end, previousStart } = this.resolveAnalyticsRange(params);

    const viewsIn = (fromDate, toDate) => {
      const conditions = [
        eq(shopProductViews.productId, productId),
        lte(shopProductViews.viewedAt, toDate),
      ];
      if (fromDate) conditions.push(gte(shopProductViews.viewedAt, fromDate));
      return and(...conditions);
    };

    const paidIn = (fromDate, toDate) => {
      const conditions = [
        eq(shopOrders.productId, productId),
        eq(shopOrders.status, 'paid'),
        lte(shopOrders.paidAt, toDate),
      ];
      if (fromDate) conditions.push(gte(shopOrders.paidAt, fromDate));
      return and(...conditions);
    };

    const checkoutsIn = (fromDate, toDate) => {
      const conditions = [eq(shopOrders.productId, productId), lte(shopOrders.createdAt, toDate)];
      if (fromDate) conditions.push(gte(shopOrders.createdAt, fromDate));
      return and(...conditions);
    };

    const dayExpr = sql`DATE(${shopProductViews.viewedAt})`;

    const [[views], [sales], [checkouts], series] = await Promise.all([
      db.select({ value: count() }).from(shopProductViews).where(viewsIn(start, end)),
      db
        .select({
          value: count(),
          revenueCents: sql`COALESCE(SUM(${shopOrders.sellerReceiveCents}), 0)`,
        })
        .from(shopOrders)
        .where(paidIn(start, end)),
      db.select({ value: count() }).from(shopOrders).where(checkoutsIn(start, end)),
      db
        .select({ date: dayExpr, views: count() })
        .from(shopProductViews)
        .where(viewsIn(start, end))
        .groupBy(dayExpr)
        .orderBy(dayExpr),
    ]);

    let previous = null;
    if (previousStart && start) {
      const [[prevViews], [prevSales], [prevCheckouts]] = await Promise.all([
        db.select({ value: count() }).from(shopProductViews).where(viewsIn(previousStart, start)),
        db
          .select({
            value: count(),
            revenueCents: sql`COALESCE(SUM(${shopOrders.sellerReceiveCents}), 0)`,
          })
          .from(shopOrders)
          .where(paidIn(previousStart, start)),
        db.select({ value: count() }).from(shopOrders).where(checkoutsIn(previousStart, start)),
      ]);

      previous = {
        views: Number(prevViews.value),
        checkouts: Number(prevCheckouts.value),
        sales: Number(prevSales.value),
        revenueCents: Number(prevSales.revenueCents),
      };
    }

    const viewCount = Number(views.value);
    const salesCount = Number(sales.value);

    // Feed/discovery-surface funnel (impressions/views/clicks from the unified
    // event log — see docs/BRITESIDE_ANALYTICS.md). Distinct from `totals.views`
    // above, which counts detail-page opens via shop_product_views. Additive
    // field — never touches the legacy totals.
    const funnelConditions = [eq(productAnalyticsDaily.productId, productId)];
    if (start) funnelConditions.push(gte(productAnalyticsDaily.date, start.toISOString().slice(0, 10)));
    funnelConditions.push(lte(productAnalyticsDaily.date, end.toISOString().slice(0, 10)));

    const [funnelTotals] = await db
      .select({
        impressions: sql`COALESCE(SUM(${productAnalyticsDaily.impressions}), 0)::int`,
        views: sql`COALESCE(SUM(${productAnalyticsDaily.views}), 0)::int`,
        clicks: sql`COALESCE(SUM(${productAnalyticsDaily.clicks}), 0)::int`,
      })
      .from(productAnalyticsDaily)
      .where(and(...funnelConditions));

    const impressions = Number(funnelTotals?.impressions ?? 0);
    const clicks = Number(funnelTotals?.clicks ?? 0);

    return {
      product: { id: product.id, title: product.title },
      range: {
        from: start ? start.toISOString() : null,
        to: end.toISOString(),
      },
      totals: {
        views: viewCount,
        checkouts: Number(checkouts.value),
        sales: salesCount,
        revenueCents: Number(sales.revenueCents),
        conversionRate: viewCount > 0 ? Number(((salesCount / viewCount) * 100).toFixed(2)) : null,
      },
      funnel: {
        impressions,
        views: Number(funnelTotals?.views ?? 0),
        clicks,
        clickThroughRate: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
      },
      previous,
      series: series.map(row => ({
        date:
          typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
        views: Number(row.views),
      })),
    };
  }
}