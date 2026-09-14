import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { venues } from './venues.js';

export const eventVenueProfiles = pgTable(
  'event_venue_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    description: text('description'),
    capacity: integer('capacity'),
    amenities: jsonb('amenities').default(sql`'[]'::jsonb`),
    additionalInformation: jsonb('additional_information').default(sql`'{}'::jsonb`),
    cancellationPolicy: text('cancellation_policy'),
    accessibility: jsonb('accessibility').default(sql`'[]'::jsonb`),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 20 }),
    parkingInfo: text('parking_info'),
    publicTransportInfo: text('public_transport_info'),
    emoji: varchar('emoji', { length: 10 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    uniqueIndex('idx_event_venue_profiles_event').on(table.eventId),
    index('idx_event_venue_profiles_venue').on(table.venueId),
  ]
);
