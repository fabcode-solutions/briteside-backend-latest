import { sql } from 'drizzle-orm';
import { decimal } from 'drizzle-orm/gel-core';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
  primaryKey,
  date,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';

// Drizzle has no built-in tsvector type; customType maps it to the raw PG type.
const tsvector = customType({
  dataType() {
    return 'tsvector';
  },
});

export const token_enum = pgEnum('tokens_type', ['refresh', 'reset', 'verifyEmail']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firebaseUid: varchar('firebase_uid', { length: 255 }).unique(),
    username: varchar('username', { length: 50 }).unique(),
    email: varchar('email', { length: 255 }).unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    dob: date('dob'),
    image: text('image'),
    bio: text('bio'),
    phoneNumber: varchar('phone_number', { length: 20 }).notNull().unique(),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    isEmailVerified: boolean('is_email_verified').default(false),
    verificationToken: varchar('verification_token', { length: 255 }),
    verificationExpires: timestamp('verification_expires', {
      withTimezone: true,
    }),
    resetPasswordToken: varchar('reset_password_token', { length: 255 }),
    resetPasswordExpires: timestamp('reset_password_expires', {
      withTimezone: true,
    }),
    resetPasswordOtp: varchar('reset_password_otp', { length: 6 }),
    resetPasswordOtpExpires: timestamp('reset_password_otp_expires', {
      withTimezone: true,
    }),
    preferences: jsonb('preferences').default(sql`'{}'::jsonb`),
    fcmTokens: text('fcm_tokens')
      .array()
      .default(sql`'{}'::text[]`),
    lastLogin: timestamp('last_login', { withTimezone: true }),
    showLastSeen: boolean('show_last_seen').default(true),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    showOnlineStatus: boolean('show_online_status').default(true),
    loginCount: integer('login_count').default(0),
    timezone: varchar('timezone', { length: 50 }).default('UTC'),
    locale: varchar('locale', { length: 10 }).default('en-US'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    allowSearchByEmail: boolean('allow_search_by_email').default(false),
    allowSearchByPhone: boolean('allow_search_by_phone').default(false),
    // Platform subscription flag — denormalized for fast frontend checks
    isBritesidePlus: boolean('is_briteside_plus').default(false),
    allowTagging: boolean('allow_tagging').default(true),
    profanityFilterEnabled: boolean('profanity_filter_enabled').default(false),
    allowMessagesFrom: varchar('allow_messages_from', { length: 20 }).default('everyone'),
    allowCallsFrom: varchar('allow_calls_from', { length: 20 }).default('everyone'),
    // Moderation Status
    isSuspended: boolean('is_suspended').default(false),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    // Age verification (18+ policy) — set from dob at registration today;
    // reserved so a future native age-signal check (mobile) can populate it
    // without a schema change.
    isVerifiedAdult: boolean('is_verified_adult').default(false),
    ageVerificationSource: varchar('age_verification_source', { length: 50 }).default('pending'),
    // Generated column — stored tsvector, recomputed by PG on every insert/update.
    // Searched via the GIN index below; never read directly by the app.
    userSearch: tsvector('user_search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(username, ''))`
    ),
  },
  table => [
    index('idx_users_email').on(table.email),
    index('idx_users_phone').on(table.phoneNumber),
    index('idx_users_username').on(table.username),
    index('idx_users_firebase_uid').on(table.firebaseUid),
    index('idx_users_verified')
      .on(table.isEmailVerified)
      .where(sql`${table.isEmailVerified} = TRUE`),
    index('idx_users_deleted')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_users_search_fts').using('gin', table.userSearch),
  ]
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  permissions: jsonb('permissions').default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // oauth, email, credentials
    provider: text('provider').notNull(), // google, facebook, credentials
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),

    // Enhanced OAuth data
    providerData: text('providerData'), // JSON string for additional provider info

    // Timestamps
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    // Composite primary key as required by NextAuth
    primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
    // Indexes
    index('accounts_user_idx').on(table.userId),
    index('accounts_provider_idx').on(table.provider),
  ]
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  t => [primaryKey({ columns: [t.identifier, t.token] })]
);

export const tokens = pgTable('tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Token type: access / refresh / reset / verifyEmail
  type: token_enum('tokens_type').notNull(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userInformation = pgTable(
  'user_information',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    googlePlaceId: varchar('google_place_id', { length: 255 }).unique(),
    address: text('address').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }),
    longitude: decimal('longitude', { precision: 11, scale: 8 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('idx_user_information_user_id').on(table.userId),
    index('idx_user_information_place_id').on(table.googlePlaceId),
    index('idx_user_information_lat_lng').on(table.latitude, table.longitude),
    index('idx_user_information_created_at').on(table.createdAt),
  ]
);
