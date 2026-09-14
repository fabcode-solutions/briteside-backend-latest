import { pgTable, uuid, date, integer, decimal, timestamp, unique } from 'drizzle-orm/pg-core';
import { posts } from './social.js';
import { groups } from './groups.js';
import { shopProducts } from './shop.js';
import { talentProfiles } from './talentProfiles.js';

// Daily rollup tables fed by src/cron/analyticsRollup.cron.js from the raw
// analytics_events log — mirrors the existing eventAnalytics shape. Pure
// net-new counters; never write to posts.viewsCount / shopProducts.viewsCount /
// etc, which stay owned by the existing view-tracking insert paths.

export const postAnalyticsDaily = pgTable(
  'post_analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    saves: integer('saves').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [unique('uq_post_analytics_daily').on(table.postId, table.date)]
);

export const groupAnalyticsDaily = pgTable(
  'group_analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    joins: integer('joins').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [unique('uq_group_analytics_daily').on(table.groupId, table.date)]
);

export const productAnalyticsDaily = pgTable(
  'product_analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => shopProducts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    sales: integer('sales').notNull().default(0),
    revenue: decimal('revenue', { precision: 10, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [unique('uq_product_analytics_daily').on(table.productId, table.date)]
);

export const serviceAnalyticsDaily = pgTable(
  'service_analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    bookingsStarted: integer('bookings_started').notNull().default(0),
    bookingsCompleted: integer('bookings_completed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [unique('uq_service_analytics_daily').on(table.talentProfileId, table.date)]
);
