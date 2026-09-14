import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  unique,
  check,
  index,
  boolean,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { users } from './users.js';
import { organizers } from './organizers.js';
import { purchasedTickets } from './purchasedTickets.js';

/**
 * Event Reviews - Enhanced for scalability and detailed feedback
 */
export const eventReviews = pgTable(
  'event_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => purchasedTickets.id, { onDelete: 'set null' }),

    // Rating breakdown for detailed feedback
    overallRating: integer('overall_rating').notNull(),
    venueRating: integer('venue_rating'),
    organizationRating: integer('organization_rating'),
    valueRating: integer('value_rating'),

    // Review content
    title: varchar('title', { length: 200 }),
    comment: text('comment'),

    // Review metadata
    isVerifiedAttendee: boolean('is_verified_attendee').notNull().default(false),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    helpfulCount: integer('helpful_count').notNull().default(0),

    // Moderation
    isModerated: boolean('is_moderated').notNull().default(false),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedBy: uuid('moderated_by').references(() => users.id),
    moderationReason: text('moderation_reason'),

    // Additional structured feedback
    tags: jsonb('tags').default(sql`'[]'::jsonb`), // ["great-venue", "poor-sound", etc.]
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`), // Additional data

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('unique_event_user_review').on(table.eventId, table.userId),
    check('overall_rating_check', sql`${table.overallRating} >= 1 AND ${table.overallRating} <= 5`),
    check(
      'venue_rating_check',
      sql`${table.venueRating} IS NULL OR (${table.venueRating} >= 1 AND ${table.venueRating} <= 5)`
    ),
    check(
      'organization_rating_check',
      sql`${table.organizationRating} IS NULL OR (${table.organizationRating} >= 1 AND ${table.organizationRating} <= 5)`
    ),
    check(
      'value_rating_check',
      sql`${table.valueRating} IS NULL OR (${table.valueRating} >= 1 AND ${table.valueRating} <= 5)`
    ),

    // Performance indexes
    index('idx_event_reviews_event').on(table.eventId),
    index('idx_event_reviews_user').on(table.userId),
    index('idx_event_reviews_rating').on(table.overallRating),
    index('idx_event_reviews_verified').on(table.isVerifiedAttendee),
    index('idx_event_reviews_created').on(table.createdAt),
    index('idx_event_reviews_helpful').on(table.helpfulCount),

    // Composite indexes for common queries
    index('idx_event_reviews_event_rating').on(table.eventId, table.overallRating),
    index('idx_event_reviews_event_verified').on(table.eventId, table.isVerifiedAttendee),
  ]
);

/**
 * Review Helpfulness - Track which reviews users find helpful
 */
export const reviewHelpfulness = pgTable(
  'review_helpfulness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => eventReviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isHelpful: boolean('is_helpful').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('unique_review_user_helpful').on(table.reviewId, table.userId),
    index('idx_review_helpfulness_review').on(table.reviewId),
    index('idx_review_helpfulness_user').on(table.userId),
  ]
);

/**
 * Organizer Reviews - Enhanced for better feedback
 */
export const organizerReviews = pgTable(
  'organizer_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),

    // Rating breakdown
    overallRating: integer('overall_rating').notNull(),
    communicationRating: integer('communication_rating'),
    professionalismRating: integer('professionalism_rating'),

    title: varchar('title', { length: 200 }),
    comment: text('comment'),

    isVerifiedAttendee: boolean('is_verified_attendee').notNull().default(false),
    isAnonymous: boolean('is_anonymous').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('unique_organizer_user_review').on(table.organizerId, table.userId),
    check('overall_rating_check', sql`${table.overallRating} >= 1 AND ${table.overallRating} <= 5`),
    check(
      'communication_rating_check',
      sql`${table.communicationRating} IS NULL OR (${table.communicationRating} >= 1 AND ${table.communicationRating} <= 5)`
    ),
    check(
      'professionalism_rating_check',
      sql`${table.professionalismRating} IS NULL OR (${table.professionalismRating} >= 1 AND ${table.professionalismRating} <= 5)`
    ),

    index('idx_organizer_reviews_organizer').on(table.organizerId),
    index('idx_organizer_reviews_user').on(table.userId),
    index('idx_organizer_reviews_event').on(table.eventId),
    index('idx_organizer_reviews_rating').on(table.overallRating),
  ]
);
