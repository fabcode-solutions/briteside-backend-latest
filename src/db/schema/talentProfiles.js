import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  decimal,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// Drizzle has no built-in tsvector type; customType maps it to the raw PG type.
const tsvector = customType({
  dataType() {
    return 'tsvector';
  },
});

export const talentProfiles = pgTable(
  'talent_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Display info
    category: varchar('category', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    bio: text('bio'),
    location: varchar('location', { length: 255 }),
    introVideoUrl: varchar('intro_video_url', { length: 500 }),
    media: jsonb('media')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Rates per duration: { "15": 100, "30": 180, "45": 250, "60": 320 }
    rates: jsonb('rates')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Languages spoken e.g. ["English", "Spanish"]
    languages: jsonb('languages')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Experience: [{ role, company, period, description }]
    experience: jsonb('experience')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Education: [{ school, degree, period }]
    education: jsonb('education')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Qualifications: [{ certification, issuingOrg, year }]
    qualifications: jsonb('qualifications')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Skills: ["Brand Strategy", "Marketing"]
    skills: jsonb('skills')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Verification & status
    isVerified: boolean('is_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
       showShopProducts: boolean('show_shop_products').notNull().default(false),
    // Talent opt-in: whether they're currently accepting priority (paid)
    // messages. ANDed with the subscription plan's PRIORITY_MESSAGING feature
    // in TalentProfileService._featureFlags — both must be true for
    // priorityMessagingAvailable to be true.
    priorityMessagingEnabled: boolean('priority_messaging_enabled').notNull().default(true),
    // Aggregated stats — updated after each completed session
    rating: decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
    reviewCount: integer('review_count').notNull().default(0),
    totalSessions: integer('total_sessions').notNull().default(0),
    location: varchar('location', { length: 255 }),
city: varchar('city', { length: 100 }),
state: varchar('state', { length: 100 }),
country: varchar('country', { length: 100 }),
countryCode: varchar('country_code', { length: 4 }),
latitude: decimal('latitude', { precision: 10, scale: 7 }),
longitude: decimal('longitude', { precision: 10, scale: 7 }),

    // Priority message fee in cents (e.g. 500 = $5.00)
    priorityMessageFee: integer('priority_message_fee').notNull().default(500),

    // Engagement counters
    shareCount: integer('share_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // Generated column — stored tsvector for full-text search across category (A),
    // title (B), and bio (C). Recomputed by PG on every insert/update.
    talentSearch: tsvector('talent_search').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(category, '')), 'A') || setweight(to_tsvector('english', coalesce(title, '')), 'B') || setweight(to_tsvector('english', coalesce(bio, '')), 'C')`
    ),
  },
  table => [
    index('idx_talent_profiles_user').on(table.userId),
    index('idx_talent_profiles_category').on(table.category),
    index('idx_talent_profiles_active').on(table.isActive),
    index('idx_talent_profiles_rating').on(table.rating),
    index('idx_talent_profiles_deleted').on(table.deletedAt),
    index('idx_talent_profiles_search_fts').using('gin', table.talentSearch),
  ]
);
