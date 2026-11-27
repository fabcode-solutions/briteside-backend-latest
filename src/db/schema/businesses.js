/**
 * Business accounts — service providers (salons, studios, mobile services…)
 * that list a service menu, bookable staff, and take customer bookings.
 *
 * A user may own one business (enforced in BusinessService.create). Business
 * accounts do not require a BriteSide Plus subscription.
 *
 * Money is stored in integer cents throughout.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  date,
  decimal,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users.js';

const tsvector = customType({
  dataType() {
    return 'tsvector';
  },
});

// ─── BUSINESSES ─────────────────────────────────────────────────────────────
export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Public URL key: /business/:slug
    slug: varchar('slug', { length: 120 }).notNull(),

    name: varchar('name', { length: 150 }).notNull(),
    // 'appointments' — bookable services/staff (the default)
    // 'standard'     — profile page only: Posts / Wall / Activities, no booking
    pageType: varchar('page_type', { length: 20 }).notNull().default('appointments'),
    // Single-line banner on the public page (max 100 chars)
    announcement: varchar('announcement', { length: 100 }),
    // One of BUSINESS_CATEGORIES keys (constants/businessCategories.js)
    category: varchar('category', { length: 40 }).notNull(),
    subcategory: varchar('subcategory', { length: 100 }),
    bio: text('bio'),

    logoUrl: text('logo_url'),
    heroUrl: text('hero_url'),
    // ["https://…", …]
    gallery: jsonb('gallery')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Posts shown only at some locations: { "<gallery url>": ["<locationId>", …] }.
    // A post that isn't listed shows at every location.
    galleryLocations: jsonb('gallery_locations')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // ["Wi-Fi", "Parking", …]
    amenities: jsonb('amenities')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // 'physical' | 'mobile'
    locationType: varchar('location_type', { length: 20 }).notNull().default('physical'),
    city: varchar('city', { length: 120 }).notNull(),
    address: text('address'),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    // Mobile businesses: how far (miles) from their home base (address / lat-lng) they travel
    serviceRadiusMiles: integer('service_radius_miles'),
    phone: varchar('phone', { length: 40 }),
    email: varchar('email', { length: 255 }),
    // Public website (http/https only — validated on write)
    websiteUrl: text('website_url'),
    // Reserve Now (Food & Dining add-on, $20/mo): the page's "Reserve Now" button
    // opens reservationUrl (their OpenTable / Resy / Tock… page). The link is only
    // public while reserveNowStatus is 'active' or 'past_due'.
    reservationUrl: text('reservation_url'),
    // null (never subscribed) | 'pending' (checkout started) | 'active' | 'past_due' | 'canceled'
    reserveNowStatus: varchar('reserve_now_status', { length: 20 }),
    reserveNowSubscriptionId: varchar('reserve_now_subscription_id', { length: 255 }),
    reserveNowPeriodEnd: timestamp('reserve_now_period_end', { withTimezone: true }),
    reserveNowCancelAtPeriodEnd: boolean('reserve_now_cancel_at_period_end').notNull().default(false),
    // Video cover ($5/month, bought in the app through Apple / Google or on the web through Stripe — see
    // business_store_subscriptions). heroVideoUrl (≤ 30s) replaces the cover
    // photo while videoCoverUntil is in the future; heroUrl stays as its
    // poster and comes back by itself when the subscription lapses.
    heroVideoUrl: text('hero_video_url'),
    // When the paid time (incl. any store grace period) ends — set from the stores
    videoCoverUntil: timestamp('video_cover_until', { withTimezone: true }),
    videoCoverAutoRenew: boolean('video_cover_auto_renew').notNull().default(false),
    // 'apple' | 'google' | 'stripe' — where it's billed (managed / cancelled there; stripe = dashboard)
    videoCoverStore: varchar('video_cover_store', { length: 10 }),
    // Where "Send inquiry" goes: 'inbox' (owner's Inquiry inbox) | 'email'
    inquiryChannel: varchar('inquiry_channel', { length: 10 }).notNull().default('email'),
    // 'email' channel: the address inquiries go to (null = the contact email)
    inquiryEmail: varchar('inquiry_email', { length: 255 }),
    // IANA timezone — all "HH:mm" hours/schedules are interpreted in this zone
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),

    // { "0": null, "1": { "open": "09:00", "close": "18:00" }, … } — 0 = Sunday, null = closed
    hours: jsonb('hours').notNull(),
    acceptingBookings: boolean('accepting_bookings').notNull().default(true),
    // 'full' | 'deposit' | 'in_person'
    defaultPaymentModel: varchar('default_payment_model', { length: 20 })
      .notNull()
      .default('full'),
    // Owner-defined service menu sections: ["Haircuts", "Color", …]
    serviceCategories: jsonb('service_categories')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // [{ id, question, required }]
    bookingQuestions: jsonb('booking_questions')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Policies — free text shown to customers
    cancellationPolicy: text('cancellation_policy'),
    lateArrivalPolicy: text('late_arrival_policy'),
    noShowPolicy: text('no_show_policy'),
    refundPolicy: text('refund_policy'),
    // Anything else the business wants customers to know (dress code, parking…)
    additionalPolicies: text('additional_policies'),
    allowCustomerRescheduling: boolean('allow_customer_rescheduling').notNull().default(false),
    reschedulingNoticeDays: integer('rescheduling_notice_days'),
    // Policies — structured, drive automatic refunds on customer cancellation:
    //   cancelled >= freeCancellationHours before start → full service refund (booking fee is non-refundable)
    //   otherwise → lateCancellationRefundPercent of the amount paid for the service
    freeCancellationHours: integer('free_cancellation_hours').notNull().default(24),
    lateCancellationRefundPercent: integer('late_cancellation_refund_percent')
      .notNull()
      .default(0),

    // Aggregates (maintained by review service)
    rating: decimal('rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    reviewCount: integer('review_count').notNull().default(0),

    // Owner can unpublish without deleting
    isPublished: boolean('is_published').notNull().default(true),

    // ── Business account settings (the business is its own account) ──
    // Which business notifications are on: { [key]: boolean }, missing = on.
    // Keys: BUSINESS_NOTIFICATION_KEYS in config/business-account.js
    notificationPrefs: jsonb('notification_prefs').notNull().default(sql`'{}'::jsonb`),
    // Privacy
    // Who can start a conversation: everyone | followers | customers | nobody
    messagesFrom: varchar('messages_from', { length: 20 }).notNull().default('everyone'),
    // Visitor wall posts: everyone (published right away) | approval | off
    wallPosts: varchar('wall_posts', { length: 20 }).notNull().default('approval'),
    showReviews: boolean('show_reviews').notNull().default(true),
    showFollowerCount: boolean('show_follower_count').notNull().default(true),
    showStaff: boolean('show_staff').notNull().default(true),
    // Public page shows the city only; the address is shared once booked
    hideAddressUntilBooked: boolean('hide_address_until_booked').notNull().default(false),
    // Listed in search / directory (the page stays reachable by link)
    discoverable: boolean('discoverable').notNull().default(true),
    // Mask profanity in visitor wall posts and comments
    profanityFilter: boolean('profanity_filter').notNull().default(false),
    // The business's own Stripe customer (saved cards for Reserve Now, commission…)
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    businessSearch: tsvector('business_search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('simple', coalesce(subcategory, '') || ' ' || coalesce(city, '')), 'B') || setweight(to_tsvector('english', coalesce(bio, '')), 'C')`
    ),
  },
  table => [
    uniqueIndex('uq_businesses_slug').on(table.slug),
    index('idx_businesses_owner').on(table.ownerId),
    index('idx_businesses_category').on(table.category),
    index('idx_businesses_city').on(table.city),
    index('idx_businesses_deleted').on(table.deletedAt),
    index('idx_businesses_search_fts').using('gin', table.businessSearch),
    check(
      'chk_businesses_late_refund_pct',
      sql`${table.lateCancellationRefundPercent} BETWEEN 0 AND 100`
    ),
    check('chk_businesses_free_cancel_hours', sql`${table.freeCancellationHours} >= 0`),
    check('chk_businesses_page_type', sql`${table.pageType} IN ('appointments', 'standard')`),
    check(
      'chk_businesses_messages_from',
      sql`${table.messagesFrom} IN ('everyone', 'followers', 'customers', 'nobody')`
    ),
    check('chk_businesses_wall_posts', sql`${table.wallPosts} IN ('everyone', 'approval', 'off')`),
  ]
);

// ─── LOCATIONS (branches of one business) ───────────────────────────────────
/**
 * Where a business operates. Every business has exactly one primary location;
 * owners can add more branches. Each location has its own address/map pin and
 * its own weekly hours + timezone (the outer bound for booking slots there).
 *
 * The primary location is mirrored onto the flat location columns of
 * `businesses` (city, address, lat/lng, timezone, hours, locationType) so the
 * directory, search and older code keep reading one place.
 */
export const businessLocations = pgTable(
  'business_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Short label customers pick from, e.g. "Downtown"
    name: varchar('name', { length: 120 }).notNull(),
    // 'physical' | 'mobile'
    locationType: varchar('location_type', { length: 20 }).notNull().default('physical'),
    city: varchar('city', { length: 120 }).notNull(),
    address: text('address'),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    // Mobile locations: address / lat-lng are the home base (owner-only; customers
    // see the city and a rounded centre) and this is how far (miles) they travel
    serviceRadiusMiles: integer('service_radius_miles'),
    // Optional per-branch phone; falls back to the business phone
    phone: varchar('phone', { length: 40 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
    // Same shape as businesses.hours
    hours: jsonb('hours').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete — past bookings keep pointing at this row
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_business_locations_business').on(table.businessId),
    index('idx_business_locations_city').on(table.city),
    uniqueIndex('uq_business_locations_primary')
      .on(table.businessId)
      .where(sql`${table.isPrimary} AND ${table.deletedAt} IS NULL`),
    check('chk_business_locations_type', sql`${table.locationType} IN ('physical', 'mobile')`),
  ]
);

// ─── WALL (standard business pages) ─────────────────────────────────────────
/**
 * Short messages signed-in users leave on a standard business page.
 * Like the profile wall, other people's posts start 'pending' (a request) and
 * only show publicly once someone who can edit the business approves them;
 * rejecting deletes the row. Posts by the business's own team are 'approved'
 * immediately. Removable by the author or a moderator at any time.
 */
export const businessWallPosts = pgTable(
  'business_wall_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    // 'pending' (awaiting the business's approval) | 'approved' (public)
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_wall_posts_business_created').on(table.businessId, table.createdAt),
    index('idx_business_wall_posts_business_status').on(table.businessId, table.status),
    index('idx_business_wall_posts_author').on(table.authorId),
    check('chk_business_wall_posts_text', sql`char_length(${table.text}) BETWEEN 1 AND 2000`),
    check('chk_business_wall_posts_status', sql`${table.status} IN ('pending', 'approved')`),
  ]
);

/** One like per user per wall post. Only approved (public) posts can be liked. */
export const businessWallPostLikes = pgTable(
  'business_wall_post_likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => businessWallPosts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.postId, table.userId] }),
    index('idx_business_wall_post_likes_user').on(table.userId),
  ]
);

/**
 * Comments on approved wall posts. Public as soon as they're written (the post
 * itself was already approved). Removable by the commenter or a moderator;
 * editable by the commenter. One level of replies: `parentId` always points at a
 * top-level comment (replying to a reply attaches to its root). Deleting a
 * comment deletes its replies.
 */
export const businessWallPostComments = pgTable(
  'business_wall_post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => businessWallPosts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references(() => businessWallPostComments.id, {
      onDelete: 'cascade',
    }),
    text: text('text').notNull(),
    // Users tagged in the text: [{ userId, username }] — resolved when written
    mentions: jsonb('mentions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_wall_post_comments_post_created').on(table.postId, table.createdAt),
    index('idx_business_wall_post_comments_parent').on(table.parentId, table.createdAt),
    index('idx_business_wall_post_comments_author').on(table.authorId),
    check('chk_business_wall_post_comments_text', sql`char_length(${table.text}) BETWEEN 1 AND 1000`),
  ]
);

/** One like per user per wall comment. */
export const businessWallCommentLikes = pgTable(
  'business_wall_comment_likes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => businessWallPostComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('idx_business_wall_comment_likes_user').on(table.userId),
  ]
);

// ─── STAFF (bookable people) ────────────────────────────────────────────────
export const businessStaff = pgTable(
  'business_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Optional link to a platform account (staff-self schedule access)
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    name: varchar('name', { length: 120 }).notNull(),
    title: varchar('title', { length: 120 }).notNull().default('Staff'),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    specialties: jsonb('specialties')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Weekly hours, same shape as businesses.hours. NULL = follow business hours.
    schedule: jsonb('schedule'),
    acceptingBookings: boolean('accepting_bookings').notNull().default(true),
    // 'automatic' | 'manual' — manual bookings start as 'pending'
    bookingConfirmation: varchar('booking_confirmation', { length: 20 })
      .notNull()
      .default('automatic'),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete — past bookings keep pointing at this row
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_business_staff_business').on(table.businessId),
    index('idx_business_staff_user').on(table.userId),
  ]
);

/**
 * Per-date staff availability overriding the weekly schedule.
 * Rows for a date → only those windows apply. isBlocked row → closed that day.
 */
export const businessStaffDateOverrides = pgTable(
  'business_staff_date_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id, { onDelete: 'cascade' }),
    overrideDate: date('override_date').notNull(),
    isBlocked: boolean('is_blocked').notNull().default(false),
    startTime: varchar('start_time', { length: 5 }),
    endTime: varchar('end_time', { length: 5 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_staff_overrides_staff_date').on(table.staffId, table.overrideDate),
  ]
);

// ─── SERVICES ───────────────────────────────────────────────────────────────
export const businessServices = pgTable(
  'business_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    // One of businesses.serviceCategories (menu section)
    categoryName: varchar('category_name', { length: 100 }),

    durationMins: integer('duration_mins').notNull(),
    priceCents: integer('price_cents').notNull(),
    // "Inquire for pricing": no public price and no self-booking. Customers send an
    // inquiry and the business answers with a custom price (business_custom_offers).
    // priceCents is then only the menu's internal guide (may be 0).
    priceOnRequest: boolean('price_on_request').notNull().default(false),
    // NULL = businesses.defaultPaymentModel
    paymentModel: varchar('payment_model', { length: 20 }),
    // Only for 'deposit'. A percentage wins over a fixed amount; neither = 20% of price.
    // (The service layer keeps at most one of the two set.)
    depositCents: integer('deposit_cents'),
    depositPercent: integer('deposit_percent'),
    // Bookings for this service arrive as requests, whatever the staff member's own setting
    requiresApproval: boolean('requires_approval').notNull().default(false),
    // Questions customers answer when booking this service. NULL = the business's
    // general booking questions (businesses.bookingQuestions).
    questionnaireId: uuid('questionnaire_id').references(() => businessQuestionnaires.id, {
      onDelete: 'set null',
    }),
    // 'individual' (default) | 'group' (scheduled sessions, priceCents per seat)
    // | 'private_group' (one party books a slot, priceCents per person, minimum total)
    sessionType: varchar('session_type', { length: 20 }).notNull().default('individual'),
    // group: seats per session (default for new sessions) and whether customers see seats left
    capacity: integer('capacity'),
    showRemainingSeats: boolean('show_remaining_seats').notNull().default(true),
    // private_group: party size limits and the least an event costs
    minGuests: integer('min_guests'),
    maxGuests: integer('max_guests'),
    minimumTotalCents: integer('minimum_total_cents'),
    bufferMins: integer('buffer_mins').notNull().default(10),
    // Sale: salePercent off the price (incl. per-location prices) between the two times.
    // NULL percent = no sale; NULL start = from now; NULL end = until the business ends it.
    salePercent: integer('sale_percent'),
    saleStartsAt: timestamp('sale_starts_at', { withTimezone: true }),
    saleEndsAt: timestamp('sale_ends_at', { withTimezone: true }),
    // true = every active staff member can perform it; false = see business_service_staff
    allStaff: boolean('all_staff').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_business_services_business').on(table.businessId),
    check('chk_business_services_duration', sql`${table.durationMins} > 0`),
    check('chk_business_services_price', sql`${table.priceCents} >= 0`),
    check('chk_business_services_buffer', sql`${table.bufferMins} >= 0`),
    check(
      'chk_business_services_deposit_percent',
      sql`${table.depositPercent} IS NULL OR ${table.depositPercent} BETWEEN 1 AND 100`
    ),
    check(
      'chk_business_services_session_type',
      sql`${table.sessionType} IN ('individual', 'group', 'private_group')`
    ),
    check(
      'chk_business_services_sale_percent',
      sql`${table.salePercent} IS NULL OR ${table.salePercent} BETWEEN 1 AND 90`
    ),
    check('chk_business_services_capacity',sql`${table.capacity} IS NULL OR ${table.capacity} BETWEEN 1 AND 500`),
    check(
      'chk_business_services_guests',
      sql`${table.minGuests} IS NULL OR ${table.maxGuests} IS NULL OR (${table.minGuests} >= 1 AND ${table.minGuests} <= ${table.maxGuests})`
    ),
  ]
);

export const businessServiceStaff = pgTable(
  'business_service_staff',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => businessServices.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id, { onDelete: 'cascade' }),
  },
  table => [
    primaryKey({ columns: [table.serviceId, table.staffId] }),
    index('idx_business_service_staff_staff').on(table.staffId),
  ]
);

/**
 * Locations a service is offered at. No rows = offered at every location of the
 * business (the default, so single-location businesses never need these).
 */
export const businessServiceLocations = pgTable(
  'business_service_locations',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => businessServices.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => businessLocations.id, { onDelete: 'cascade' }),
  },
  table => [
    primaryKey({ columns: [table.serviceId, table.locationId] }),
    index('idx_business_service_locations_location').on(table.locationId),
  ]
);

/**
 * A service's price / length at one location, when it differs there
 * (null = the service's own value). Fees, commission and % deposits follow.
 */
export const businessServiceLocationOverrides = pgTable(
  'business_service_location_overrides',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => businessServices.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => businessLocations.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents'),
    durationMins: integer('duration_mins'),
  },
  table => [
    primaryKey({ columns: [table.serviceId, table.locationId] }),
    check('chk_business_service_location_overrides_price', sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`),
    check(
      'chk_business_service_location_overrides_duration',
      sql`${table.durationMins} IS NULL OR ${table.durationMins} BETWEEN 5 AND 1440`
    ),
  ]
);

/**
 * A staff member's weekly hours at one location (same shape as businesses.hours).
 * Once someone has any of these, they're bookable at a location only inside
 * that location's schedule — e.g. Mon/Wed Downtown, Fri Uptown.
 */
export const businessStaffLocationSchedules = pgTable(
  'business_staff_location_schedules',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => businessLocations.id, { onDelete: 'cascade' }),
    schedule: jsonb('schedule').notNull(),
  },
  table => [
    primaryKey({ columns: [table.staffId, table.locationId] }),
    index('idx_business_staff_location_schedules_location').on(table.locationId),
  ]
);

/** Dates a location is closed (holidays, renovations). Inclusive, location-local. */
export const businessLocationClosures = pgTable(
  'business_location_closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => businessLocations.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: varchar('reason', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_location_closures_location_end').on(table.locationId, table.endDate),
    check('chk_business_location_closures_range', sql`${table.endDate} >= ${table.startDate}`),
  ]
);

/**
 * Locations a staff member works at. No rows = works at every location of the
 * business (the default, so single-location businesses never need these).
 */
export const businessStaffLocations = pgTable(
  'business_staff_locations',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => businessLocations.id, { onDelete: 'cascade' }),
  },
  table => [
    primaryKey({ columns: [table.staffId, table.locationId] }),
    index('idx_business_staff_locations_location').on(table.locationId),
  ]
);

// ─── TEAM ACCESS (dashboard users) ──────────────────────────────────────────
/**
 * Dashboard access for people other than the owner. The owner is implicit
 * (businesses.ownerId) and never has a row here.
 *   role 'admin'   — everything incl. wallet, taxes, team management
 *   role 'manager' — everything except wallet, taxes, team management
 *   role 'staff'   — own schedule + own bookings (staffId required)
 */
export const businessTeamMembers = pgTable(
  'business_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Set when the invitation is accepted
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    staffId: uuid('staff_id').references(() => businessStaff.id, { onDelete: 'cascade' }),
    // Admins / managers limited to these locations ([] = every location).
    // They only see and manage bookings, sessions and reports there.
    locationIds: jsonb('location_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // 'pending' | 'active' | 'revoked'
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    inviteToken: varchar('invite_token', { length: 64 }).notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_business_team_invite_token').on(table.inviteToken),
    index('idx_business_team_business').on(table.businessId),
    index('idx_business_team_user').on(table.userId),
    // One live invitation/membership per email per business (per staff member for 'staff')
    uniqueIndex('uq_business_team_live_email')
      .on(table.businessId, table.email, sql`coalesce(${table.staffId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${table.status} <> 'revoked'`),
  ]
);

// ─── BOOKINGS ───────────────────────────────────────────────────────────────
/**
 * Status flow:
 *   awaiting_payment → (paid) → pending (manual staff) | confirmed (automatic)
 *   pending → confirmed | declined | cancelled | expired (not answered by acceptDeadline)
 *   confirmed → completed | cancelled | no_show
 *   awaiting_payment → expired (checkout abandoned)
 *   completedAt is set for both 'completed' and 'no_show' — it starts the payout hold clock.
 *
 * Fees (see utils/orderProcessingFee.js):
 *   customerFeeCents        — tiered booking fee on the FULL service price, charged online once,
 *                             at the initial booking (pay-in-person included), never again
 *   commissionUpfront       — true on bookings made under the full-cut model (all new bookings):
 *   platformCommissionCents     the 5% of the FULL service price withheld from the online payment
 *                               at booking (capped at what was paid online). Non-refundable: a
 *                               refund only lowers it to what Briteside still holds, and the
 *                               difference is owed by the business (business_commission_charges).
 *                             false (older bookings, split model): 5% of every service amount paid
 *                               ONLINE, withheld from it; the 5% on what's paid IN PERSON is owed
 *                               separately once the booking completes.
 *   amountDueNowCents       — service portion charged at booking (full | deposit | 0 for in_person)
 *   customer pays at booking = amountDueNowCents + customerFeeCents (+ tax)
 */
export const businessBookings = pgTable(
  'business_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // NULL for a manual booking of a one-off custom service (name/length snapshotted below)
    serviceId: uuid('service_id').references(() => businessServices.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id),
    // NULL for guest checkout
    customerId: uuid('customer_id').references(() => users.id, { onDelete: 'set null' }),
    customerName: varchar('customer_name', { length: 150 }).notNull(),
    // NULL only for manual bookings taken with a phone number
    customerEmail: varchar('customer_email', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 40 }),
    // 'online' (customer booked on Briteside) | 'manual' (added by the business: walk-in / phone)
    source: varchar('source', { length: 20 }).notNull().default('online'),
    // Manual bookings: how the customer will pay — 'cash' | 'card_in_person' | 'bank_transfer' | 'other'
    paymentArrangement: varchar('payment_arrangement', { length: 20 }),

    // Snapshots so history survives menu edits
    serviceName: varchar('service_name', { length: 150 }).notNull(),
    staffName: varchar('staff_name', { length: 120 }).notNull(),
    durationMins: integer('duration_mins').notNull(),
    bufferMins: integer('buffer_mins').notNull().default(0),

    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    // The customer's own zone when they booked (browser), so emails can also show
    // their local time; null for walk-ins and older bookings
    customerTimezone: varchar('customer_timezone', { length: 64 }),

    status: varchar('status', { length: 20 }).notNull().default('awaiting_payment'),

    // Money (cents)
    paymentModel: varchar('payment_model', { length: 20 }).notNull(),
    servicePriceCents: integer('service_price_cents').notNull(),
    amountDueNowCents: integer('amount_due_now_cents').notNull(),
    customerFeeCents: integer('customer_fee_cents').notNull(),
    platformCommissionCents: integer('platform_commission_cents').notNull(),
    commissionUpfront: boolean('commission_upfront').notNull().default(false),
    taxAmountCents: integer('tax_amount_cents').notNull().default(0),
    // 'account' (business collects/remits tax → tax flows into its payout) | 'self' | 'none'
    taxLiability: varchar('tax_liability', { length: 20 }).notNull().default('none'),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    refundedCents: integer('refunded_cents').notNull().default(0),
    // What the business entered as received in hand at the visit (completed bookings).
    // NULL = not entered → the balance due is assumed. Dashboard "Off Platform"; no effect on commission.
    inHandCents: integer('in_hand_cents'),
    stripeFeeCents: integer('stripe_fee_cents'),
    reserveAmountCents: integer('reserve_amount_cents'),

    // Stripe
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    transferId: varchar('transfer_id', { length: 255 }),
    // Remaining balance paid online later (deposit / pay-in-person bookings).
    // No booking fee on this payment; 5% commission on it is added to platformCommissionCents.
    balanceStripeSessionId: varchar('balance_stripe_session_id', { length: 255 }),
    balancePaymentIntentId: varchar('balance_payment_intent_id', { length: 255 }),
    // Service portion of the balance payment (also included in amountPaidCents)
    balancePaidCents: integer('balance_paid_cents').notNull().default(0),
    // Total charged on the balance payment incl. tax — caps refunds against that payment
    balanceChargedCents: integer('balance_charged_cents').notNull().default(0),

    // Add-ons picked when booking: [{ id, name, priceCents, durationMins }] (snapshot).
    // Already included in servicePriceCents and durationMins; addOnsCents is their total.
    addOns: jsonb('add_ons')
      .notNull()
      .default(sql`'[]'::jsonb`),
    addOnsCents: integer('add_ons_cents').notNull().default(0),

    // Added by the business when completing: [{ label, amountCents }], collected in person.
    // 5% commission applies to them like the service price (see businessCommission.inPersonCents).
    extraCharges: jsonb('extra_charges')
      .notNull()
      .default(sql`'[]'::jsonb`),
    extraChargesCents: integer('extra_charges_cents').notNull().default(0),

    notes: text('notes'),
    // [{ question, answer }] — question text snapshotted; typed answers stored as text
    answers: jsonb('answers')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Public group session this booking holds seats in (null = individual / private event)
    groupSessionId: uuid('group_session_id').references(() => businessGroupSessions.id, {
      onDelete: 'set null',
    }),
    // Seats (group session) or guests (private event); 1 for individual bookings
    partySize: integer('party_size').notNull().default(1),
    // Branch the visit is at (null only for rows from before locations existed)
    locationId: uuid('location_id').references(() => businessLocations.id, { onDelete: 'set null' }),
    // Booked from a custom price the business sent (business_custom_offers). The offer's
    // price is in servicePriceCents; serviceId is null when the offer was a one-off service.
    customOfferId: uuid('custom_offer_id'),
    // Files the customer attached: [{ key, name, size, type }]. Private bucket —
    // only the business gets short-lived signed links (BusinessAttachmentService).
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Lifecycle
    // Snapshot of the service's "requires approval" at checkout → arrives as a request when paid
    needsApproval: boolean('needs_approval').notNull().default(false),
    acceptDeadline: timestamp('accept_deadline', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // 'customer' | 'business' | 'system'
    cancelledBy: varchar('cancelled_by', { length: 20 }),
    cancellationReason: text('cancellation_reason'),
    rescheduledFromId: uuid('rescheduled_from_id'),
    // Moved in place (same booking, payments untouched). 'customer' | 'business'
    rescheduledAt: timestamp('rescheduled_at', { withTimezone: true }),
    rescheduledBy: varchar('rescheduled_by', { length: 20 }),
    rescheduleCount: integer('reschedule_count').notNull().default(0),

    // Reminders (idempotency)
    reminder24hSentAt: timestamp('reminder_24h_sent_at', { withTimezone: true }),
    reminder1hSentAt: timestamp('reminder_1h_sent_at', { withTimezone: true }),
    reviewReminderSentAt: timestamp('review_reminder_sent_at', { withTimezone: true }),

    // Payout escrow release
    standardReleasedAt: timestamp('standard_released_at', { withTimezone: true }),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_bookings_business_start').on(table.businessId, table.startAt),
    index('idx_business_bookings_business_created').on(table.businessId, table.createdAt),
    index('idx_business_bookings_staff_start').on(table.staffId, table.startAt),
    index('idx_business_bookings_customer').on(table.customerId),
    index('idx_business_bookings_email').on(table.customerEmail),
    index('idx_business_bookings_status').on(table.status),
    index('idx_business_bookings_stripe_session').on(table.stripeSessionId),
    index('idx_business_bookings_payment_intent').on(table.stripePaymentIntentId),
    index('idx_business_bookings_location_start').on(table.locationId, table.startAt),
    index('idx_business_bookings_custom_offer').on(table.customOfferId),
    check('chk_business_bookings_time', sql`${table.endAt} > ${table.startAt}`),
  ]
);

// ─── IN-PERSON COMMISSION ───────────────────────────────────────────────────
/**
 * 5% commission on the part of a booking the customer paid IN PERSON (money
 * Briteside never touched). One row per completed booking that had an
 * in-person part; the business owner owes it. Collected, oldest first:
 *   1. deducted from the owner's next business-booking payout (cron/reserveRelease.js)
 *   2. charged to the owner's saved Plus card on the 1st of the month (with retries)
 *   3. paid by the business from the dashboard ("Pay now")
 * collectedCents may be partial; status 'collected' once collectedCents = amountCents.
 * Anything owed longer than COMMISSION_OVERDUE_DAYS pauses new bookings for that business.
 */
export const businessCommissionCharges = pgTable(
  'business_commission_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Who pays (businesses.ownerId at the time the charge was created)
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => businessBookings.id, { onDelete: 'cascade' }),
    // Service amount paid in person, and 5% of it
    inPersonCents: integer('in_person_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    collectedCents: integer('collected_cents').notNull().default(0),
    // 'owed' | 'collected' | 'waived'
    status: varchar('status', { length: 20 }).notNull().default('owed'),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_business_commission_charges_booking').on(table.bookingId),
    index('idx_business_commission_charges_owner_status').on(table.ownerId, table.status),
    index('idx_business_commission_charges_business_status').on(table.businessId, table.status),
    check('chk_business_commission_charges_collected', sql`${table.collectedCents} between 0 and ${table.amountCents}`),
  ]
);

/**
 * Each attempt to collect in-person commission from an owner. `allocations`
 * says which charges it paid: [{ chargeId, cents }].
 *   method 'payout_offset' — withheld from a business-booking payout transfer
 *   method 'card'          — off-session charge on the owner's saved card
 *   method 'checkout'      — the owner paid from the dashboard
 *   status 'succeeded' | 'failed' | 'reverted' (offset whose transfer failed)
 */
export const businessCommissionCollections = pgTable(
  'business_commission_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    allocations: jsonb('allocations')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // payout_offset: the booking whose payout it was taken from
    sourceBookingId: uuid('source_booking_id'),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_commission_collections_owner').on(table.ownerId, table.createdAt),
    index('idx_business_commission_collections_session').on(table.stripeSessionId),
  ]
);

// ─── REVIEWS ────────────────────────────────────────────────────────────────
/**
 * One review per completed booking, written by the signed-in customer who made it.
 * businesses.rating / reviewCount are recomputed from this table on every change
 * (see businessReview.service.js).
 */
export const businessReviews = pgTable(
  'business_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => businessBookings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Who did the service (snapshot of the booking's staff)
    staffId: uuid('staff_id').references(() => businessStaff.id, { onDelete: 'set null' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    // Photos the customer attached: ["https://…", …]
    images: jsonb('images')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Public response from the business — one per review, editable
    ownerReply: text('owner_reply'),
    // First posted (kept when the reply is edited)
    ownerRepliedAt: timestamp('owner_replied_at', { withTimezone: true }),
    ownerReplyEditedAt: timestamp('owner_reply_edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_business_reviews_booking').on(table.bookingId),
    index('idx_business_reviews_business_created').on(table.businessId, table.createdAt),
    index('idx_business_reviews_user').on(table.userId),
    check('chk_business_reviews_rating', sql`${table.rating} BETWEEN 1 AND 5`),
  ]
);

// ─── RELATIONS ──────────────────────────────────────────────────────────────
export const businessWallPostsRelations = relations(businessWallPosts, ({ one, many }) => ({
  business: one(businesses, { fields: [businessWallPosts.businessId], references: [businesses.id] }),
  author: one(users, { fields: [businessWallPosts.authorId], references: [users.id] }),
  likes: many(businessWallPostLikes),
  comments: many(businessWallPostComments),
}));

export const businessWallPostLikesRelations = relations(businessWallPostLikes, ({ one }) => ({
  post: one(businessWallPosts, { fields: [businessWallPostLikes.postId], references: [businessWallPosts.id] }),
  user: one(users, { fields: [businessWallPostLikes.userId], references: [users.id] }),
}));

export const businessWallPostCommentsRelations = relations(businessWallPostComments, ({ one, many }) => ({
  post: one(businessWallPosts, {
    fields: [businessWallPostComments.postId],
    references: [businessWallPosts.id],
  }),
  author: one(users, { fields: [businessWallPostComments.authorId], references: [users.id] }),
  likes: many(businessWallCommentLikes),
}));

export const businessWallCommentLikesRelations = relations(businessWallCommentLikes, ({ one }) => ({
  comment: one(businessWallPostComments, {
    fields: [businessWallCommentLikes.commentId],
    references: [businessWallPostComments.id],
  }),
  user: one(users, { fields: [businessWallCommentLikes.userId], references: [users.id] }),
}));

export const businessReviewsRelations = relations(businessReviews, ({ one }) => ({
  business: one(businesses, { fields: [businessReviews.businessId], references: [businesses.id] }),
  booking: one(businessBookings, { fields: [businessReviews.bookingId], references: [businessBookings.id] }),
  user: one(users, { fields: [businessReviews.userId], references: [users.id] }),
  staff: one(businessStaff, { fields: [businessReviews.staffId], references: [businessStaff.id] }),
}));

export const businessCommissionChargesRelations = relations(businessCommissionCharges, ({ one }) => ({
  business: one(businesses, { fields: [businessCommissionCharges.businessId], references: [businesses.id] }),
  booking: one(businessBookings, { fields: [businessCommissionCharges.bookingId], references: [businessBookings.id] }),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  owner: one(users, { fields: [businesses.ownerId], references: [users.id] }),
  staff: many(businessStaff),
  services: many(businessServices),
  teamMembers: many(businessTeamMembers),
  bookings: many(businessBookings),
  locations: many(businessLocations),
}));

export const businessStaffRelations = relations(businessStaff, ({ one, many }) => ({
  business: one(businesses, { fields: [businessStaff.businessId], references: [businesses.id] }),
  user: one(users, { fields: [businessStaff.userId], references: [users.id] }),
  dateOverrides: many(businessStaffDateOverrides),
  serviceLinks: many(businessServiceStaff),
  locationLinks: many(businessStaffLocations),
  locationSchedules: many(businessStaffLocationSchedules),
}));

export const businessStaffDateOverridesRelations = relations(
  businessStaffDateOverrides,
  ({ one }) => ({
    staff: one(businessStaff, {
      fields: [businessStaffDateOverrides.staffId],
      references: [businessStaff.id],
    }),
  })
);

export const businessServicesRelations = relations(businessServices, ({ one, many }) => ({
  business: one(businesses, {
    fields: [businessServices.businessId],
    references: [businesses.id],
  }),
  staffLinks: many(businessServiceStaff),
  locationLinks: many(businessServiceLocations),
  locationOverrides: many(businessServiceLocationOverrides),
}));

export const businessServiceLocationOverridesRelations = relations(
  businessServiceLocationOverrides,
  ({ one }) => ({
    service: one(businessServices, {
      fields: [businessServiceLocationOverrides.serviceId],
      references: [businessServices.id],
    }),
  })
);

export const businessStaffLocationSchedulesRelations = relations(
  businessStaffLocationSchedules,
  ({ one }) => ({
    staff: one(businessStaff, {
      fields: [businessStaffLocationSchedules.staffId],
      references: [businessStaff.id],
    }),
  })
);

export const businessLocationClosuresRelations = relations(businessLocationClosures, ({ one }) => ({
  location: one(businessLocations, {
    fields: [businessLocationClosures.locationId],
    references: [businessLocations.id],
  }),
}));

export const businessServiceLocationsRelations = relations(businessServiceLocations, ({ one }) => ({
  service: one(businessServices, {
    fields: [businessServiceLocations.serviceId],
    references: [businessServices.id],
  }),
  location: one(businessLocations, {
    fields: [businessServiceLocations.locationId],
    references: [businessLocations.id],
  }),
}));

export const businessServiceStaffRelations = relations(businessServiceStaff, ({ one }) => ({
  service: one(businessServices, {
    fields: [businessServiceStaff.serviceId],
    references: [businessServices.id],
  }),
  staff: one(businessStaff, {
    fields: [businessServiceStaff.staffId],
    references: [businessStaff.id],
  }),
}));

export const businessTeamMembersRelations = relations(businessTeamMembers, ({ one }) => ({
  business: one(businesses, {
    fields: [businessTeamMembers.businessId],
    references: [businesses.id],
  }),
  user: one(users, { fields: [businessTeamMembers.userId], references: [users.id] }),
  staff: one(businessStaff, {
    fields: [businessTeamMembers.staffId],
    references: [businessStaff.id],
  }),
}));

export const businessBookingsRelations = relations(businessBookings, ({ one }) => ({
  business: one(businesses, {
    fields: [businessBookings.businessId],
    references: [businesses.id],
  }),
  service: one(businessServices, {
    fields: [businessBookings.serviceId],
    references: [businessServices.id],
  }),
  staff: one(businessStaff, {
    fields: [businessBookings.staffId],
    references: [businessStaff.id],
  }),
  customer: one(users, { fields: [businessBookings.customerId], references: [users.id] }),
  location: one(businessLocations, {
    fields: [businessBookings.locationId],
    references: [businessLocations.id],
  }),
}));

// ─── ADD-ONS ────────────────────────────────────────────────────────────────
/**
 * Optional extras a customer can pick with a service when booking (e.g. "Deep
 * conditioning +$25, +15 min"). Price and minutes are added to the booking —
 * fee tier, 5% commission and % deposits use the total (see priceBooking).
 * The chosen ones are snapshotted on business_bookings.addOns.
 */
export const businessAddOns = pgTable(
  'business_add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    priceCents: integer('price_cents').notNull(),
    durationMins: integer('duration_mins').notNull().default(0),
    // Services it can be picked with; [] = every service
    serviceIds: jsonb('service_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_business_add_ons_business').on(table.businessId),
    check('chk_business_add_ons_price', sql`${table.priceCents} >= 0`),
    check('chk_business_add_ons_duration', sql`${table.durationMins} BETWEEN 0 AND 480`),
  ]
);

export const businessAddOnsRelations = relations(businessAddOns, ({ one }) => ({
  business: one(businesses, { fields: [businessAddOns.businessId], references: [businesses.id] }),
}));

// ─── QUESTIONNAIRES ─────────────────────────────────────────────────────────
/**
 * Named sets of typed questions a business attaches to services
 * (businessServices.questionnaireId). Answers are snapshotted as text on
 * business_bookings.answers, so editing or deleting one never changes past bookings.
 */
export const businessQuestionnaires = pgTable(
  'business_questionnaires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    // [{ id, label, type, options, required, active, placeholder }]
    questions: jsonb('questions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Customers may attach up to 3 images / PDFs when booking
    allowAttachments: boolean('allow_attachments').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [index('idx_business_questionnaires_business').on(table.businessId)]
);

// ─── GALLERY ENGAGEMENT ─────────────────────────────────────────────────────
/**
 * Likes / comments on the photos in businesses.gallery ("Posts" on the page).
 * Gallery items are plain URLs, so each is addressed by postKey = a short hash
 * of its URL (see utils/businessGallery.js). Removing a photo hides its likes
 * and comments; adding it back brings them back.
 */
export const businessGalleryLikes = pgTable(
  'business_gallery_likes',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    postKey: varchar('post_key', { length: 32 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.businessId, table.postKey, table.userId] }),
    index('idx_business_gallery_likes_user').on(table.userId),
  ]
);

// ─── FOLLOWERS ──────────────────────────────────────────────────────────────
/** Members following a business page (the "Follow" button on /business/:slug). */
export const businessFollowers = pgTable(
  'business_followers',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.businessId, table.userId] }),
    index('idx_business_followers_user').on(table.userId),
  ]
);

// ─── CLIENTS (imported / invited) ───────────────────────────────────────────
/**
 * Clients a business added itself (CSV import or one by one) and may have
 * invited to book. Customers who booked come from business_bookings; the
 * dashboard's Customers tab merges the two.
 * email is stored lowercase; phone in E.164 (+15551234567).
 */
export const businessClients = pgTable(
  'business_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 150 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    // 'import' (CSV) | 'manual' (typed in)
    source: varchar('source', { length: 10 }).notNull().default('manual'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    // Last invite per channel — at most one per contact per 30 days
    emailInvitedAt: timestamp('email_invited_at', { withTimezone: true }),
    smsInvitedAt: timestamp('sms_invited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_business_clients_email')
      .on(table.businessId, table.email)
      .where(sql`${table.email} IS NOT NULL`),
    uniqueIndex('uq_business_clients_phone')
      .on(table.businessId, table.phone)
      .where(sql`${table.phone} IS NOT NULL`),
    index('idx_business_clients_business_created').on(table.businessId, table.createdAt),
    check('chk_business_clients_contact', sql`${table.email} IS NOT NULL OR ${table.phone} IS NOT NULL`),
    check('chk_business_clients_source', sql`${table.source} IN ('import', 'manual')`),
  ]
);

export const businessGalleryComments = pgTable(
  'business_gallery_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    postKey: varchar('post_key', { length: 32 }).notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Reply to a top-level comment (one level, like the feed); its replies go with it
    parentId: uuid('parent_id').references(() => businessGalleryComments.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    // Users tagged in the text: [{ userId, username }] — resolved when written
    mentions: jsonb('mentions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_gallery_comments_post').on(table.businessId, table.postKey, table.createdAt),
    index('idx_business_gallery_comments_parent').on(table.parentId, table.createdAt),
    index('idx_business_gallery_comments_author').on(table.authorId, table.createdAt),
    check('chk_business_gallery_comments_text', sql`char_length(${table.text}) BETWEEN 1 AND 1000`),
  ]
);

export const businessGalleryCommentLikes = pgTable(
  'business_gallery_comment_likes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => businessGalleryComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('idx_business_gallery_comment_likes_user').on(table.userId),
  ]
);

export const businessGalleryCommentsRelations = relations(businessGalleryComments, ({ one, many }) => ({
  business: one(businesses, { fields: [businessGalleryComments.businessId], references: [businesses.id] }),
  author: one(users, { fields: [businessGalleryComments.authorId], references: [users.id] }),
  likes: many(businessGalleryCommentLikes),
}));

// ─── GROUP SESSIONS ─────────────────────────────────────────────────────────
/**
 * A scheduled run of a 'group' service (e.g. "Pottery class, Sat 10:00"). Customers
 * book seats in it — each booking is a business_bookings row with groupSessionId
 * and partySize = seats. The session blocks its staff member's calendar.
 */
export const businessGroupSessions = pgTable(
  'business_group_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => businessServices.id, { onDelete: 'cascade' }),
    // Host — the session occupies their calendar
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id, { onDelete: 'cascade' }),
    // Branch the session runs at (null only for rows from before locations existed)
    locationId: uuid('location_id').references(() => businessLocations.id, { onDelete: 'set null' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    bufferMins: integer('buffer_mins').notNull().default(0),
    capacity: integer('capacity').notNull(),
    // 'scheduled' | 'cancelled'
    status: varchar('status', { length: 20 }).notNull().default('scheduled'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_group_sessions_business_start').on(table.businessId, table.startAt),
    index('idx_business_group_sessions_service_start').on(table.serviceId, table.startAt),
    index('idx_business_group_sessions_staff_start').on(table.staffId, table.startAt),
    check('chk_business_group_sessions_capacity', sql`${table.capacity} BETWEEN 1 AND 500`),
    check('chk_business_group_sessions_time', sql`${table.endAt} > ${table.startAt}`),
  ]
);

export const businessGroupSessionsRelations = relations(businessGroupSessions, ({ one }) => ({
  business: one(businesses, { fields: [businessGroupSessions.businessId], references: [businesses.id] }),
  service: one(businessServices, { fields: [businessGroupSessions.serviceId], references: [businessServices.id] }),
  staff: one(businessStaff, { fields: [businessGroupSessions.staffId], references: [businessStaff.id] }),
  location: one(businessLocations, {
    fields: [businessGroupSessions.locationId],
    references: [businessLocations.id],
  }),
}));

export const businessLocationsRelations = relations(businessLocations, ({ one, many }) => ({
  business: one(businesses, { fields: [businessLocations.businessId], references: [businesses.id] }),
  staffLinks: many(businessStaffLocations),
  closures: many(businessLocationClosures),
}));

export const businessStaffLocationsRelations = relations(businessStaffLocations, ({ one }) => ({
  staff: one(businessStaff, { fields: [businessStaffLocations.staffId], references: [businessStaff.id] }),
  location: one(businessLocations, {
    fields: [businessStaffLocations.locationId],
    references: [businessLocations.id],
  }),
}));

export const businessQuestionnairesRelations = relations(businessQuestionnaires, ({ one }) => ({
  business: one(businesses, {
    fields: [businessQuestionnaires.businessId],
    references: [businesses.id],
  }),
}));

// ─── CUSTOM PRICE OFFERS ────────────────────────────────────────────────────
/**
 * A custom price a business sends a customer, usually in answer to an inquiry
 * about an "Inquire for pricing" service (like Digital Services custom offers).
 * Based on a menu service (serviceId) or a one-off service (serviceId null; name and
 * length snapshotted here). The customer books it like any service: picks a time,
 * pays online (booking fee + 5% commission as usual) → the booking carries
 * customOfferId and the offer becomes 'booked'.
 *
 * status: 'pending' (can be booked) | 'booked' | 'declined' (customer) |
 *         'withdrawn' (business) | 'expired' (past expiresAt — computed on read too)
 */
export const businessCustomOffers = pgTable(
  'business_custom_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Inquiry chat the offer was sent in (the card is a message there)
    conversationId: uuid('conversation_id'),
    serviceId: uuid('service_id').references(() => businessServices.id, { onDelete: 'set null' }),
    serviceName: varchar('service_name', { length: 150 }).notNull(),
    description: text('description'),
    durationMins: integer('duration_mins').notNull(),
    priceCents: integer('price_cents').notNull(),
    // 'full' | 'deposit' | 'in_person'
    paymentModel: varchar('payment_model', { length: 20 }).notNull(),
    // Only for 'deposit' (fixed amount; null = 20% of the price)
    depositCents: integer('deposit_cents'),
    // Where it can be booked (null = any location that offers it)
    locationId: uuid('location_id').references(() => businessLocations.id, { onDelete: 'set null' }),
    // Who can perform it (null = whoever offers the service / everyone for a one-off)
    staffId: uuid('staff_id').references(() => businessStaff.id, { onDelete: 'set null' }),
    note: text('note'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    bookingId: uuid('booking_id'),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_custom_offers_business_created').on(table.businessId, table.createdAt),
    index('idx_business_custom_offers_customer').on(table.customerId),
    check('chk_business_custom_offers_price', sql`${table.priceCents} > 0`),
    check('chk_business_custom_offers_duration', sql`${table.durationMins} > 0`),
    check(
      'chk_business_custom_offers_status',
      sql`${table.status} IN ('pending', 'booked', 'declined', 'withdrawn', 'expired')`
    ),
  ]
);

export const businessCustomOffersRelations = relations(businessCustomOffers, ({ one }) => ({
  business: one(businesses, { fields: [businessCustomOffers.businessId], references: [businesses.id] }),
  customer: one(users, { fields: [businessCustomOffers.customerId], references: [users.id] }),
  service: one(businessServices, {
    fields: [businessCustomOffers.serviceId],
    references: [businessServices.id],
  }),
  location: one(businessLocations, {
    fields: [businessCustomOffers.locationId],
    references: [businessLocations.id],
  }),
  staff: one(businessStaff, { fields: [businessCustomOffers.staffId], references: [businessStaff.id] }),
}));
