import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    googlePlaceId: varchar('google_place_id', { length: 255 }).unique(),
    address: text('address').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }),
    longitude: decimal('longitude', { precision: 11, scale: 8 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    countryCode: varchar('country_code', { length: 10 }),
    postalCode: varchar('postal_code', { length: 20 }),
    websiteUrl: text('website_url'),
    isVerified: boolean('is_verified').default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_venues_google_place').on(table.googlePlaceId),
    index('idx_venues_deleted')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);
