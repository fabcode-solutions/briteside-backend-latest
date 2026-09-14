import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { organizers } from './organizers.js';

export const trackingLinks = pgTable(
  'tracking_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    destinationUrl: text('destination_url'),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_tracking_links_event').on(table.eventId),
    index('idx_tracking_links_organizer').on(table.organizerId),
    index('idx_tracking_links_code').on(table.code),
  ]
);

export const trackingLinkClicks = pgTable(
  'tracking_link_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingLinkId: uuid('tracking_link_id')
      .notNull()
      .references(() => trackingLinks.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    referer: text('referer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('idx_tracking_link_clicks_link').on(table.trackingLinkId)]
);
