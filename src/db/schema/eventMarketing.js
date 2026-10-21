import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { events } from './events.js';

export const eventMarketingSettings = pgTable(
  'event_marketing_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    metaPixelId: varchar('meta_pixel_id', { length: 100 }),
    tiktokPixelId: varchar('tiktok_pixel_id', { length: 100 }),
    googleAdsId: varchar('google_ads_id', { length: 100 }),
    googleAnalyticsId: varchar('google_analytics_id', { length: 100 }),
    // Short organizer-chosen slug resolved at briteside.app/<vanitySlug> (shares
    // its namespace with the user-profile vanity route — see
    // usernameReservation.service.js's RESERVED_USERNAMES). Always stored
    // lowercased so the plain unique index below enforces case-insensitive
    // uniqueness. Expires at the event's endDate (see EventMarketingService).
    vanitySlug: varchar('vanity_slug', { length: 50 }),
    vanitySlugExpiresAt: timestamp('vanity_slug_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    uniqueIndex('idx_event_marketing_settings_event').on(table.eventId),
    uniqueIndex('idx_event_marketing_settings_vanity_slug').on(table.vanitySlug),
  ]
);
