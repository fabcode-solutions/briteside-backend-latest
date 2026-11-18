/**
 * Business accounts — service providers (salons, studios, mobile services…)
 * that list a service menu, bookable staff, and take customer bookings.
 *
 * A user may own many businesses. Owning one requires an active BriteSide
 * Plus subscription; when the owner's Plus lapses the business is hidden from
 * public listings and new bookings are refused (owner dashboard stays usable).
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
    phone: varchar('phone', { length: 40 }),
    email: varchar('email', { length: 255 }),
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
    allowCustomerRescheduling: boolean('allow_customer_rescheduling').notNull().default(false),
    reschedulingNoticeDays: integer('rescheduling_notice_days'),
    // Policies — structured, drive automatic refunds on customer cancellation:
    //   cancelled >= freeCancellationHours before start → full refund (incl. booking fee)
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
    // NULL = businesses.defaultPaymentModel
    paymentModel: varchar('payment_model', { length: 20 }),
    // Only for 'deposit'. NULL = 20% of price.
    depositCents: integer('deposit_cents'),
    bufferMins: integer('buffer_mins').notNull().default(10),
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
 *   platformCommissionCents — 5% of every service amount paid ONLINE (full price, deposit, and any
 *                             balance paid online later), withheld from the payment itself.
 *                             The 5% on what is paid IN PERSON is owed separately — see
 *                             business_commission_charges (created when the booking completes).
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
    serviceId: uuid('service_id')
      .notNull()
      .references(() => businessServices.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => businessStaff.id),
    // NULL for guest checkout
    customerId: uuid('customer_id').references(() => users.id, { onDelete: 'set null' }),
    customerName: varchar('customer_name', { length: 150 }).notNull(),
    customerEmail: varchar('customer_email', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 40 }),

    // Snapshots so history survives menu edits
    serviceName: varchar('service_name', { length: 150 }).notNull(),
    staffName: varchar('staff_name', { length: 120 }).notNull(),
    durationMins: integer('duration_mins').notNull(),
    bufferMins: integer('buffer_mins').notNull().default(0),

    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),

    status: varchar('status', { length: 20 }).notNull().default('awaiting_payment'),

    // Money (cents)
    paymentModel: varchar('payment_model', { length: 20 }).notNull(),
    servicePriceCents: integer('service_price_cents').notNull(),
    amountDueNowCents: integer('amount_due_now_cents').notNull(),
    customerFeeCents: integer('customer_fee_cents').notNull(),
    platformCommissionCents: integer('platform_commission_cents').notNull(),
    taxAmountCents: integer('tax_amount_cents').notNull().default(0),
    // 'account' (business collects/remits tax → tax flows into its payout) | 'self' | 'none'
    taxLiability: varchar('tax_liability', { length: 20 }).notNull().default('none'),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    refundedCents: integer('refunded_cents').notNull().default(0),
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

    notes: text('notes'),
    // [{ question, answer }] — question text snapshotted
    answers: jsonb('answers')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Lifecycle
    acceptDeadline: timestamp('accept_deadline', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // 'customer' | 'business' | 'system'
    cancelledBy: varchar('cancelled_by', { length: 20 }),
    cancellationReason: text('cancellation_reason'),
    rescheduledFromId: uuid('rescheduled_from_id'),

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

// ─── RELATIONS ──────────────────────────────────────────────────────────────
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
}));

export const businessStaffRelations = relations(businessStaff, ({ one, many }) => ({
  business: one(businesses, { fields: [businessStaff.businessId], references: [businesses.id] }),
  user: one(users, { fields: [businessStaff.userId], references: [users.id] }),
  dateOverrides: many(businessStaffDateOverrides),
  serviceLinks: many(businessServiceStaff),
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
}));
