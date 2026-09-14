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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [uniqueIndex('idx_event_marketing_settings_event').on(table.eventId)]
);
