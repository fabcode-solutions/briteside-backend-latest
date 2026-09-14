import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  decimal,
  check,
  index,
  pgEnum,
  jsonb,
  customType,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizers } from './organizers.js';
import { categories } from './categories.js';
import { venues } from './venues.js';
import { groups } from './groups.js';
import { organizerPresets } from './organizerPresets.js';
import { eventTickets } from './tickets.js';
export const hostedEnum = pgEnum('hosted_enum', ['organizer', 'group']);

// Drizzle has no built-in tsvector type; customType maps it to the raw PG type.
const tsvector = customType({
  dataType() {
    return 'tsvector';
  },
});

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventCode: varchar('event_code', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 300 }).notNull().unique(),
    description: text('description'),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    categoryIds: jsonb('category_ids').default(sql`'[]'::jsonb`),
    venueId: uuid('venue_id').references(() => venues.id, {
      onDelete: 'set null',
    }),
    eventType: varchar('event_type', { length: 20 }).notNull().default('public'),
    eventStatus: varchar('event_status', { length: 20 }).notNull().default('draft'),
    eventMode: varchar('event_mode', { length: 20 }).notNull().default('in_person'),
    isFree: boolean('is_free').default(false),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    capacity: integer('capacity'),
    totalViews: integer('total_views').default(0),
    uniqueVisitors: integer('unique_visitors').default(0),
    conversionRate: decimal('conversion_rate', {
      precision: 5,
      scale: 2,
    }).default('0'),
    totalRevenue: decimal('total_revenue', { precision: 12, scale: 2 }).default('0'),
    checkInCount: integer('check_in_count').default(0),
    noShowCount: integer('no_show_count').default(0),
    likeCount: integer('like_count').default(0).notNull(),
    showLikeCount: boolean('show_like_count').default(true).notNull(),
    platformFeePercentage: decimal('platform_fee_percentage', {
      precision: 3,
      scale: 1,
    })
      .default('0.0')
      .notNull(),
    isRefundable: boolean('is_refundable').default(true).notNull(),
    refundCutoffDays: integer('refund_cutoff_days').default(3).notNull(),
    refundPolicy: text('refund_policy'),
    groupId: uuid('group_id').references(() => groups.id, {
      onDelete: 'set null',
    }),
    hostedBy: hostedEnum('hosted_by').default('organizer').notNull(),
    termsConditions: text('terms_conditions'),
    coverImages: jsonb('cover_images').default(sql`'[]'::jsonb`),
    attendReason: varchar('attend_reason', { length: 500 }),
    eventHighlights: jsonb('event_highlights').default(sql`'[]'::jsonb`),
    showAttendeeCount: boolean('show_attendee_count').default(true).notNull(),
    isChatEnabled: boolean('is_chat_enabled').default(true).notNull(),
    recurrenceRule: jsonb('recurrence_rule'),
    doorSalesEnabled: boolean('door_sales_enabled').default(false).notNull(),
    doorSalesToken: varchar('door_sales_token', { length: 64 }),
    doorSalesTokenCreatedAt: timestamp('door_sales_token_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    // Generated column — stored tsvector with setweight so title matches (A)
    // rank higher than description matches (B) in ts_rank ordering.
    eventSearch: tsvector('event_search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`
    ),
    youtubeVideoUrl: varchar('youtube_video_url', { length: 500 }),
    presetId: uuid('preset_id').references(() => organizerPresets.id, { onDelete: 'set null' }),
    snsTopicArn: varchar('sns_topic_arn', { length: 255 }),
    showTicketsRemaining: boolean('show_tickets_remaining').default(true).notNull(),
  },
  table => [
    check('end_date_check', sql`${table.endDate} > ${table.startDate}`),
    check(
      'cover_images_length_check',
      sql`jsonb_array_length(${table.coverImages}) >= 1 AND jsonb_array_length(${table.coverImages}) <= 5`
    ),
    check(
      'category_ids_length_check',
      sql`jsonb_array_length(${table.categoryIds}) >= 1 AND jsonb_array_length(${table.categoryIds}) <= 3`
    ),
    index('idx_events_organizer').on(table.organizerId),
    index('idx_events_venue').on(table.venueId),
    index('idx_events_status').on(table.eventStatus),
    index('idx_events_start_date').on(table.startDate),
    index('idx_events_deleted').on(table.deletedAt),
    index('idx_events_dates').on(table.startDate, table.endDate),
    index('idx_events_slug').on(table.slug),
    index('idx_events_search_fts').using('gin', table.eventSearch),
    index('idx_events_preset').on(table.presetId),
  ]
);

export const eventSchedules = pgTable(
  'event_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(), // Session date
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    duration: integer('duration').notNull(), // Duration in minutes
    ticketsSold: integer('tickets_sold').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    check('end_time_check', sql`${table.endTime} > ${table.startTime}`),
    check('tickets_sold_check', sql`${table.ticketsSold} >= 0`),
    index('idx_event_schedules_event').on(table.eventId),
    index('idx_event_schedules_date').on(table.date),
    index('idx_event_schedules_start_time').on(table.startTime),
    index('idx_event_schedules_deleted').on(table.deletedAt),
  ]
);
export const eventTicketScheduleInventory = pgTable(
  'event_ticket_schedule_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketTierId: uuid('ticket_tier_id')
      .notNull()
      .references(() => eventTickets.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => eventSchedules.id, { onDelete: 'cascade' }),

    quantityAvailable: integer('quantity_available').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    // One row per ticket-type + session combination
    unique('uq_ticket_schedule').on(table.ticketTierId, table.scheduleId),
    check('qty_available_check', sql`${table.quantityAvailable} >= 0`),
    check('qty_sold_check', sql`${table.quantitySold} >= 0`),
    check('qty_sold_lte_available', sql`${table.quantitySold} <= ${table.quantityAvailable}`),
    index('idx_ticket_schedule_inv_ticket').on(table.ticketTierId),
    index('idx_ticket_schedule_inv_schedule').on(table.scheduleId),
    index('idx_ticket_schedule_inv_event').on(table.eventId),
  ]
);
