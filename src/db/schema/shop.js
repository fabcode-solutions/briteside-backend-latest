/**
 * Creator Shop — digital products sold from a profile's Shop tab.
 *
 * Phase 1 (this file): the catalog and view tracking. Orders and refund
 * requests arrive in later phases as `shop_orders` / `shop_refund_requests`.
 *
 * buttonAction:
 *   'payment'  — sold through the platform; needs deliveryType + a file key or link
 *   'redirect' — an external link only; no order, no money, no delivery
 *
 * listingType:
 *   'product' | 'service' | 'course' | 'link' — which creation/edit dialog a
 *   row belongs to on the frontend, and which extra fields apply to it
 *   (courseModules for 'course', turnaround/paymentMode for 'service', etc).
 *   Independent of buttonAction: a 'link' listing can be either a free
 *   'redirect' or a paid 'payment' + deliveryType 'link'.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { posts } from './social.js';
import { groups } from './groups.js';
// Reused as-is — same Postgres enum type as group courses, no need for a
// second 'video_source_type' enum with an identical set of values.
import { videoSourceTypeEnum } from './groupCourses.js';


export const shopListingTypeEnum = pgEnum('shop_listing_type', ['product', 'course', 'service' , 'link',]);
export const shopPaymentModeEnum = pgEnum('shop_payment_mode', ['full', 'deposit', 'milestones']);


export const shopProducts = pgTable(
  'shop_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    priceCents: integer('price_cents').notNull().default(0),
    isPhysical: boolean('is_physical').notNull().default(false),
    // Drives which edit dialog opens on the frontend. Validated against
    // LISTING_TYPES in shopProduct.service.js.
    listingType: varchar('listing_type', { length: 20 }).notNull().default('product'),
    coverUrl: varchar('cover_url', { length: 500 }),
    coverType: varchar('cover_type', { length: 10 }), // 'image' | 'video'
    // Array of { url, type } — capped at 6 in the service, not the DB
    gallery: jsonb('gallery').notNull().default([]),

    ctaTitle: varchar('cta_title', { length: 100 }),
    buttonAction: varchar('button_action', { length: 20 }).notNull().default('payment'),
    redirectUrl: varchar('redirect_url', { length: 500 }),

    deliveryType: varchar('delivery_type', { length: 10 }), // 'file' | 'link'
    // Private S3 object key — never a URL, so there is nothing public to leak.
    // Downloads mint a short-lived signed URL from this in phase 2.
    deliveryFileKey: varchar('delivery_file_key', { length: 500 }),
    deliveryFileName: varchar('delivery_file_name', { length: 255 }),
    deliveryLink: varchar('delivery_link', { length: 500 }),

    listingType: shopListingTypeEnum('listing_type').notNull().default('product'),

    // Service-listing fields — currently the only serviceKind is 'project'.
    serviceKind: varchar('service_kind', { length: 20 }),
    turnaround: varchar('turnaround', { length: 100 }),
    cancellationPolicy: text('cancellation_policy'),
    revisionsIncluded: boolean('revisions_included'),
    revisionsCount: integer('revisions_count'),
    // Currently the only pricingModel is 'flat'.
    pricingModel: varchar('pricing_model', { length: 20 }),
    fromPrice: boolean('from_price'),
    // Display/agreement metadata only this phase — see Global Constraints.
    paymentMode: shopPaymentModeEnum('payment_mode'),
    depositPercent: integer('deposit_percent'),
    // [{label, percent}]
    milestones: jsonb('milestones'),

    displayOrder: integer('display_order').notNull().default(0),

    // Course listings are drafted in the Talent Dashboard first and only
    // appear in the public Shop tab once explicitly published there. All
    // other listing types are published by default (set true on create).
    publishedToShop: boolean('published_to_shop').notNull().default(true),

    // Pinned products (max 9 per shop, ordered by pin_order) mirror pinned
    // posts. Columns rather than a join table because a product has exactly one
    // owner — nobody else can pin it to their own shop.
    isPinned: boolean('is_pinned').notNull().default(false),
    pinOrder: integer('pin_order'),

    viewsCount: integer('views_count').notNull().default(0),
    salesCount: integer('sales_count').notNull().default(0),

    // Soft delete: past buyers must still be able to download, and refund
    // disputes must still resolve, so rows are never physically removed.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_products_user_order').on(table.userId, table.displayOrder),
    index('idx_shop_products_deleted').on(table.deletedAt),
    index('idx_shop_products_created_at').on(table.createdAt),
    index('idx_shop_products_user_pinned').on(table.userId, table.isPinned, table.pinOrder),
    check(
      'shop_pin_order_range',
      sql`${table.pinOrder} IS NULL OR ${table.pinOrder} BETWEEN 1 AND 9`
    ),
  ]
);

/**
 * One purchase of one product.
 *
 * status: pending → paid        (payment confirmed by webhook)
 *                 → expired     (checkout session timed out)
 *         paid    → refunded    (phase 3)
 */
export const shopOrders = pgTable(
  'shop_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No cascade: products are soft-deleted, so an order always resolves back
    // to its product for downloads and refund disputes.
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Denormalised so earnings queries don't need to join through products.
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // Snapshots — the order must survive later edits to the product.
    productTitleSnapshot: varchar('product_title_snapshot', { length: 200 }).notNull(),
    priceCents: integer('price_cents').notNull(),
    chargedCents: integer('charged_cents').notNull(),
    sellerReceiveCents: integer('seller_receive_cents').notNull(),
    platformShareCents: integer('platform_share_cents').notNull(),

    // Refund policy as it stood at purchase. Eligibility is judged against
    // these, never the seller's live settings, so changing the policy later
    // can't revoke a right the buyer already paid for.
    refundsAllowedSnapshot: boolean('refunds_allowed_snapshot').notNull(),
    refundWindowDaysSnapshot: integer('refund_window_days_snapshot').notNull(),
    refundAfterDownloadSnapshot: boolean('refund_after_download_snapshot').notNull(),

    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    downloadCount: integer('download_count').notNull().default(0),
    // Stamped on first access. Doubles as the refund guard.
    firstDownloadedAt: timestamp('first_downloaded_at', { withTimezone: true }),

    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundAmountCents: integer('refund_amount_cents'),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }),

    // Explicitly collected at checkout for 'product' and 'course' listings
    // (see ShopOrderService.createCheckout) — kept separate from the buyer's
    // account (users.email/firstName/lastName) since sellers need a reliable
    // contact even if the account's own info is stale or different, and this
    // is what powers the per-product customer list + CSV export in the
    // talent dashboard. Null for listing types that don't require it.
    customerName: varchar('customer_name', { length: 200 }),
    customerEmail: varchar('customer_email', { length: 255 }),

    paidAt: timestamp('paid_at', { withTimezone: true }),

    // 7-day payout hold — the seller's cut isn't transferred at checkout; it's
    // held on the platform's own Stripe balance and moved to the seller's
    // Connect account by a scheduled job once 7 days have passed since paidAt.
    reserveAmountCents: integer('reserve_amount_cents').default(0),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_orders_buyer').on(table.buyerId),
    index('idx_shop_orders_seller').on(table.sellerId),
    index('idx_shop_orders_product').on(table.productId),
    index('idx_shop_orders_status').on(table.status),
    // Earnings queries scan by seller over a date range.
    index('idx_shop_orders_seller_paid').on(table.sellerId, table.paidAt),
    // Makes Stripe's at-least-once webhook redelivery a no-op.
    uniqueIndex('idx_shop_orders_stripe_session').on(table.stripeSessionId),
  ]
);

/**
 * A buyer's dispute over one order.
 *
 * status: pending → approved  (refund issued, terminal — money has moved)
 *                 → rejected  (an admin may still override this to approved)
 *
 * Unlike talent_issues — which points at two different tables and so can't
 * have a real FK — this targets exactly one table, so orderId is a proper
 * foreign key and is unique: one dispute per order.
 */
export const shopRefundRequests = pgTable(
  'shop_refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => shopOrders.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 'not_as_described' | 'not_received' | 'wrong_item' | 'other'
    reason: varchar('reason', { length: 50 }).notNull(),
    message: text('message').notNull(),

    // Snapshotted at request time for whoever reviews it later.
    amountCents: integer('amount_cents').notNull(),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // Who decided, and in what capacity — the seller rules first, an admin
    // can overturn a rejection.
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolvedByRole: varchar('resolved_by_role', { length: 10 }), // 'seller' | 'admin'
    resolutionNote: text('resolution_note'),

    refundAmountCents: integer('refund_amount_cents'),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_refund_requests_buyer').on(table.buyerId),
    index('idx_shop_refund_requests_seller').on(table.sellerId),
    index('idx_shop_refund_requests_status').on(table.status),
  ]
);

/**
 * Products a post links to — max 3 per post, enforced in the service.
 *
 * Its own table rather than ids inside post.settings so the link can't outlive
 * the product, and so "which posts sell this product" stays a plain query.
 * Products are soft-deleted, so readers must still filter on deletedAt; the
 * cascade only covers a genuine row removal.
 */
export const postShopProducts = pgTable(
  'post_shop_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    // 0-based, matching the order the author picked them in.
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_shop_products_post').on(table.postId, table.position),
    index('idx_post_shop_products_product').on(table.productId),
    uniqueIndex('idx_post_shop_products_unique').on(table.postId, table.productId),
    check('post_shop_products_position_range', sql`${table.position} BETWEEN 0 AND 2`),
  ]
);

// Products an organizer surfaces on their group's details page. Same shape as
// post_shop_products, but a group holds more of them and — unlike a post — may
// carry a link button at the same time.
export const groupShopProducts = pgTable(
  'group_shop_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    // 0-based, matching the order the organizer picked them in.
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_group_shop_products_group').on(table.groupId, table.position),
    index('idx_group_shop_products_product').on(table.productId),
    uniqueIndex('idx_group_shop_products_unique').on(table.groupId, table.productId),
  ]
);

// Distinct viewers per product — unique on the pair, mirroring post_views,
// so viewsCount counts people rather than impressions.
export const shopProductViews = pgTable(
  'shop_product_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_product_views_product').on(table.productId),
    index('idx_shop_product_views_user').on(table.userId),
    uniqueIndex('idx_shop_product_views_unique').on(table.productId, table.userId),
  ]
);

/**
 * Course syllabus for a shop listing — a dedicated table, entirely separate
 * from group_courses (which stays group-scoped only). Each row is one module
 * (title + how many lessons it has); no lesson-level content lives here, this
 * is a display-only syllabus, matching the "Course modules" section on the
 * Shop tab's course form.
 */
export const shopCourseModules = pgTable(
  'shop_course_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    lessonsCount: integer('lessons_count').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_shop_course_modules_product_order').on(table.productId, table.sortOrder)]
);

/**
 * Real lesson content for a shop course listing — this is what the display-only
 * shopCourseModules syllabus above was missing. One row per video lesson,
 * belonging to exactly one shopCourseModules row. Access is NOT enrollment-
 * based (there's no separate enrollment table): a viewer can watch a lesson if
 * they own the product (shopProducts.userId), have a 'paid' shop_orders row for
 * it, or the lesson itself is marked isFreePreview — see
 * ShopCourseContentService.hasAccessToCourse.
 */
export const shopCourseLessons = pgTable(
  'shop_course_lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => shopCourseModules.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    videoUrl: text('video_url'),
    videoSourceType: videoSourceTypeEnum('video_source_type'),
    thumbnailUrl: text('thumbnail_url'),
    duration: integer('duration').default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(true),
    isFreePreview: boolean('is_free_preview').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_course_lessons_product').on(table.productId),
    index('idx_shop_course_lessons_module_order').on(table.moduleId, table.sortOrder),
  ]
);

// Downloadable files (worksheets, slides, etc.) attached to a lesson.
export const shopCourseLessonAttachments = pgTable(
  'shop_course_lesson_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => shopCourseLessons.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileType: varchar('file_type', { length: 50 }),
    size: integer('size'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_shop_course_lesson_attachments_lesson').on(table.lessonId, table.sortOrder),
  ]
);

// Per-viewer watch progress. Keyed by (productId, lessonId, userId) rather than
// through an enrollment row — "enrolled" here just means "has a paid shop_orders
// row for productId", which is already tracked elsewhere.
export const shopCourseLessonProgress = pgTable(
  'shop_course_lesson_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => shopCourseLessons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchedSeconds: integer('watched_seconds').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('idx_shop_lesson_progress_unique').on(table.lessonId, table.userId),
    index('idx_shop_lesson_progress_user').on(table.userId, table.productId),
  ]
);

export const shopCustomOfferStatusEnum = pgEnum('shop_custom_offer_status', [
  'pending',
  // Buyer-initiated purchase of a `listingType: 'service'` shop listing: the
  // buyer has already paid, and the offer is parked here until the seller
  // explicitly accepts (→ 'accepted') or declines (→ 'declined' + refund).
  'pending_talent_approval',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
  'cancelled',
  'no_show',
  'completed',
]);


export const shopCustomOfferDeliveryStateEnum = pgEnum('shop_custom_offer_delivery_state', [
  'awaiting_delivery',   // accepted, seller hasn't submitted work yet
  'delivered',           // seller submitted work, waiting on buyer
  'revision_requested',  // buyer asked for changes, waiting on seller
]);
/**
 * A one-off service offer a seller negotiates with a specific buyer, outside
 * the public catalog. Distinct from shop_products/shop_orders: nothing here
 * is browsable, and the price/terms are per-buyer, not per-listing.
 *
 * Payment fields live directly on the offer rather than going through
 * shop_orders, because shop_orders.productId is a required FK into the
 * public catalog — a custom offer often isn't based on one at all.
 *
 * status: pending  → accepted   (buyer paid the first installment)
 *                  → declined   (buyer said no)
 *                  → expired    (never resolved before expiresAt)
 *                  → withdrawn  (seller pulled it before the buyer acted)
 */
export const shopCustomServiceOffers = pgTable(
  'shop_custom_service_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Optional — the shop listing this was customized from. No cascade: the
    // offer must survive if that listing is later deleted or edited.
    basedOnProductId: uuid('based_on_product_id').references(() => shopProducts.id),

    // How this offer came to exist. null = the normal seller-initiated custom
    // offer. 'shop_listing' = the buyer clicked Buy on a service listing and
    // paid up front, so the offer waits at 'pending_talent_approval'.
    origin: varchar('origin', { length: 30 }),

    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    priceCents: integer('price_cents').notNull(),
    revisionsUsedCount: integer('revisions_used_count').notNull().default(0),
     turnaround: varchar('turnaround', { length: 100 }), 
    turnaroundMinutes: integer('turnaround_minutes'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    deliverables: text('deliverables'),
deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    revisionsIncluded: boolean('revisions_included').notNull().default(false),
    revisionsCount: integer('revisions_count'),

    paymentMode: shopPaymentModeEnum('payment_mode').notNull().default('full'),
    depositPercent: integer('deposit_percent'),
    // [{ label, percent }] — same shape as shop_products.milestones
    milestones: jsonb('milestones'),

    note: text('note'),
    // [{ fileKey, fileName, fileType }] — same shape as
    // shop_custom_offer_revision_requests.attachments. Files the seller
    // attached when sending the offer (briefs, contracts, reference material).
    attachments: jsonb('attachments').notNull().default([]),
    status: shopCustomOfferStatusEnum('status').notNull().default('pending'),
    deliveryState: shopCustomOfferDeliveryStateEnum('delivery_state')
      .notNull()
      .default('awaiting_delivery'),
    basePriceCoveredCents: integer('base_price_covered_cents').notNull().default(0),
    // Populated once the buyer pays the first installment.
    chargedCents: integer('charged_cents'),
    sellerReceiveCents: integer('seller_receive_cents'),
    platformShareCents: integer('platform_share_cents'),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),

    // Delivery-based escrow — the seller's cut from each payment (deposit,
    // remainder, tip) isn't transferred at charge time; it accumulates here
    // and is moved to the seller's Connect account by a scheduled job 7 days
    // after deliveredAt. deliveredAt resets to null on a revision request,
    // which naturally re-holds any not-yet-released amount too.
    reserveAmountCents: integer('reserve_amount_cents').default(0),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    reviewReminderSentAt: timestamp('review_reminder_sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_custom_offers_seller').on(table.sellerId, table.createdAt),
    index('idx_custom_offers_buyer_status').on(table.buyerId, table.status),
    uniqueIndex('idx_custom_offers_stripe_session').on(table.stripeSessionId),
  ]
);


/**
 * LIVE per-milestone state for a `paymentMode: 'milestones'` offer.
 *
 * Deliberately separate from shop_custom_service_offers.milestones, which
 * stays a read-only TEMPLATE ([{label, percent}]) that several frontend
 * components read verbatim for display. Nothing in this file or the service
 * layer ever writes back into that jsonb column.
 *
 * status: pending          — not billable yet (an earlier stage is still open)
 *       → awaiting_payment — a Stripe Checkout session is open for it
 *       → funded           — the buyer paid; money is held on the platform
 *       → completed        — the buyer approved the stage; 7-day hold started
 *       → released         — transferred to the seller's Connect account
 *       → cancelled        — terminal, set when the offer is cancelled/refunded
 *
 * Money invariant: SUM(amount_cents) for one offer EXACTLY equals that
 * offer's price_cents. The last row absorbs any rounding remainder — see
 * ShopCustomOfferService._computeMilestoneAmounts.
 *
 * Milestone money never passes through shop_custom_service_offers
 * .reserve_amount_cents; each row is paid out on its own by
 * releaseCustomOfferMilestoneReserves. That separation is what makes a
 * double transfer structurally impossible.
 */
export const shopOfferMilestones = pgTable(
  'shop_offer_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    // 0-based, matching the template array's own ordering.
    position: integer('position').notNull(),

    // Snapshotted from the template at first-charge time so a later template
    // edit can never move money that was already agreed.
    label: varchar('label', { length: 200 }).notNull(),
    // Numeric, not integer: validate() only requires each percent to be a
    // finite number > 0 summing to 100, so 33.33/33.33/33.34 is legal.
    percent: numeric('percent', { precision: 7, scale: 4 }).notNull(),
    amountCents: integer('amount_cents').notNull(),

    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // Filled once funded — same fee split shape as ShopOrderService.computeFees.
    chargedCents: integer('charged_cents'),
    sellerReceiveCents: integer('seller_receive_cents'),
    platformShareCents: integer('platform_share_cents'),

    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    fundedAt: timestamp('funded_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // completedAt + 7 days — what the per-milestone release cron scans on.
    releaseAt: timestamp('release_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    transferId: varchar('transfer_id', { length: 255 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Makes Stripe's at-least-once webhook redelivery a no-op — same guard
    // shop_orders / shop_custom_service_offers use for their own session ids.
    uniqueIndex('idx_offer_milestones_stripe_session').on(table.stripeSessionId),
    // One row per stage, ever — the structural guard against a retried
    // checkout creating a second schedule.
    uniqueIndex('idx_offer_milestones_offer_position').on(table.offerId, table.position),
    index('idx_offer_milestones_release_scan').on(table.status, table.releaseAt),
    index('idx_offer_milestones_offer').on(table.offerId, table.position),
  ]
);

export const shopCustomOfferDeliverables = pgTable(
  'shop_custom_offer_deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileKey: varchar('file_key', { length: 500 }).notNull(),
     roundNumber: integer('round_number').notNull().default(1),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileType: varchar('file_type', { length: 10 }).notNull(), // 'image' | 'video' | 'document'
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_custom_offer_deliverables_offer').on(table.offerId, table.createdAt),
  ]
);


/**
 * The single append-only timeline for a custom offer — every action taken
 * (sent, accepted, delivered, revision requested, date extended, tipped,
 * disputed, completed) writes one row here. This is what powers an
 * Activity-tab-style feed without stitching together multiple tables.
 */
export const shopCustomOfferActivity = pgTable(
  'shop_custom_offer_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // e.g. 'offer_sent' | 'offer_accepted' | 'delivered' | 'revision_requested'
    // | 'date_extension_requested' | 'date_extension_accepted' |
    // 'date_extension_declined' | 'completed' | 'tip_paid' | 'dispute_raised'
    eventType: varchar('event_type', { length: 50 }).notNull(),
    // Free-form details specific to this event type (message, attachments,
    // old/new date, amount, etc).
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_custom_offer_activity_offer').on(table.offerId, table.createdAt)]
);

export const shopCustomOfferRevisionRequests = pgTable(
  'shop_custom_offer_revision_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    message: text('message').notNull(),
    // [{ fileKey, fileName, fileType }]
    attachments: jsonb('attachments').notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending → resolved
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_revision_requests_offer').on(table.offerId, table.createdAt),
    index('idx_revision_requests_status').on(table.offerId, table.status),
  ]
);

export const shopCustomOfferDateExtensionRequests = pgTable(
  'shop_custom_offer_date_extension_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalDueDate: timestamp('original_due_date', { withTimezone: true }),
    requestedDueDate: timestamp('requested_due_date', { withTimezone: true }).notNull(),
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending → accepted | declined
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('idx_date_extension_requests_offer').on(table.offerId, table.createdAt)]
);

export const shopCustomOfferTips = pgTable(
  'shop_custom_offer_tips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(), // what the seller receives (100%)
    chargedCents: integer('charged_cents').notNull(), // what the buyer pays (covers card fee)
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending → paid
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_custom_offer_tips_offer').on(table.offerId),
    uniqueIndex('idx_custom_offer_tips_stripe_session').on(table.stripeSessionId),
  ]
);

export const shopCustomOfferDisputes = pgTable(
  'shop_custom_offer_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => shopCustomServiceOffers.id, { onDelete: 'cascade' }),
    raisedByUserId: uuid('raised_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'not_as_described' | 'missed_deadline' | 'not_delivered' | 'other'
    reason: varchar('reason', { length: 50 }).notNull(),
    message: text('message').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending → resolved (admin flag-only, no auto-refund)
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_custom_offer_disputes_offer').on(table.offerId),
    index('idx_custom_offer_disputes_status').on(table.status),
  ]
);
