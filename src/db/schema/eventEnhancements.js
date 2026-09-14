import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { users } from './users.js';
import { eventTickets } from './tickets.js';

// Event FAQ section
export const eventFaqs = pgTable('event_faqs', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Event sponsors
export const eventSponsors = pgTable('event_sponsors', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  sponsorshipLevel: varchar('sponsorship_level', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Event speakers/performers
export const eventSpeakers = pgTable('event_speakers', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }),
  bio: text('bio'),
  photoUrl: text('photo_url'),
  socialLinks: jsonb('social_links').default(sql`'{}'::jsonb`),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Event waitlist for sold out events
export const eventWaitlist = pgTable(
  'event_waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id').references(() => eventTickets.id, {
      onDelete: 'cascade',
    }),
    notified: boolean('notified').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_event_waitlist_event').on(table.eventId),
    index('idx_event_waitlist_user').on(table.userId),
  ]
);

// Event discount codes
export const eventDiscountCodes = pgTable(
  'event_discount_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 50 }).notNull(),
    discountType: varchar('discount_type', { length: 20 }).notNull(),
    discountValue: decimal('discount_value', {
      precision: 10,
      scale: 2,
    }).notNull(),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').default(0),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_event_discount_codes_event').on(table.eventId),
    index('idx_event_discount_codes_code').on(table.code),
  ]
);
