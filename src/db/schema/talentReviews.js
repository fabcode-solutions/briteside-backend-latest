/**
 * src/db/schema/talentReviews.js
 *
 * talent_reviews
 *
 * Reviews for a talent, submitted by people who:
 *   (a) completed a session with the talent   → sourceType = 'session'
 *   (b) sent a paid priority message           → sourceType = 'priority_message'
 *
 * Rating fields:
 *   rating              — overall 1–5 stars (required)
 *   communicationRating — 1–5 (optional)
 *   valueRating         — 1–5 (optional)
 *
 * Moderation:
 *   isVisible   — false when admin removes the review
 *   reportedAt  — set when the talent flags the review as wrong
 *   reportReason— the reason text provided by the talent
 *
 * After insert/update the service recomputes talent_profiles.rating
 * and talent_profiles.review_count from the aggregate.
 *
 * Uniqueness:
 *   - One review per session          → unique constraint on sessionId (NULLs exempt in PG)
 *   - One review per priority message → partial unique index in migration SQL
 */

import {
  pgTable,
  uuid,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';
import { talentSessions } from './talentSessions.js';
import { shopCustomServiceOffers } from './shop.js';
export const talentReviews = pgTable(
  'talent_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // The talent being reviewed
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    // The person who wrote the review
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 'session' | 'priority_message'
    sourceType: varchar('source_type', { length: 30 }).notNull().default('session'),

    // Set when sourceType = 'session'; null for priority_message reviews
    sessionId: uuid('session_id').references(() => talentSessions.id, { onDelete: 'cascade' }),

    // Set when sourceType = 'priority_message'; null for session reviews
    // Partial unique index (WHERE priority_message_id IS NOT NULL) is in migration SQL
    priorityMessageId: uuid('priority_message_id'),
    shopCustomOfferId: uuid('shop_custom_offer_id').references(
      () => shopCustomServiceOffers.id,
      { onDelete: 'cascade' }
    ),
    // Ratings
    rating: integer('rating').notNull(), // 1–5 overall
    communicationRating: integer('communication_rating'), // 1–5 optional
    valueRating: integer('value_rating'), // 1–5 optional

    // Written review
    title: varchar('title', { length: 150 }),
    comment: text('comment'),

    // Moderation — admin can hide; talent can report
    isVisible: boolean('is_visible').notNull().default(true),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    reportReason: text('report_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // One review per session (NULLs do not violate unique in PG)
    unique('uq_talent_reviews_session').on(table.sessionId),

    // Rating range checks
    check('rating_range', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    check(
      'communication_rating_range',
      sql`${table.communicationRating} IS NULL OR (${table.communicationRating} >= 1 AND ${table.communicationRating} <= 5)`
    ),
    check(
      'value_rating_range',
      sql`${table.valueRating} IS NULL OR (${table.valueRating} >= 1 AND ${table.valueRating} <= 5)`
    ),

    // Performance indexes
    index('idx_talent_reviews_profile').on(table.talentProfileId),
    index('idx_talent_reviews_reviewer').on(table.reviewerId),
    index('idx_talent_reviews_session').on(table.sessionId),
    index('idx_talent_reviews_custom_offer').on(table.shopCustomOfferId),
    index('idx_talent_reviews_source').on(table.sourceType),
    index('idx_talent_reviews_rating').on(table.rating),
    index('idx_talent_reviews_created').on(table.createdAt),
  ]
);
