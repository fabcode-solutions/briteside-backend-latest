import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  decimal,
  integer,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { check, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';
import { sql } from 'drizzle-orm';
export const organizers = pgTable('organizers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizerCode: varchar('organizer_code', { length: 50 }).notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  businessName: varchar('business_name', { length: 255 }),
  coverImageUrl: text('cover_image_url').array(),
  businessDescription: text('business_description'),
  businessType: varchar('business_type', { length: 50 }),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 50 }),
  businessAddress: text('business_address'),
  country: varchar('country', { length: 2 }).default('US'),
  taxId: varchar('tax_id', { length: 100 }),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }),
  bankAccountInfo: jsonb('bank_account_info'),
  isVerified: boolean('is_verified').default(false),
  showTicketsSold: boolean('show_tickets_sold').default(true).notNull(),
  specialities: text('specialities').array(),
  about: varchar('about', { length: 500 }),
  rating: decimal('rating', { precision: 3, scale: 2 }).default('0'),
  totalEvents: integer('total_events').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});




export const organizerSocialLinks = pgTable(
  'organizer_social_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .references(() => organizers.id, { onDelete: 'cascade' })
      .unique(),
    talentProfileId: uuid('talent_profile_id')
      .references(() => talentProfiles.id, { onDelete: 'cascade' })
      .unique(),
    instagram: text('instagram'),
    twitter: text('twitter'),
    facebook: text('facebook'),
    linkedin: text('linkedin'),
    youtube: text('youtube'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    check(
      'chk_social_links_one_owner',
      sql`(${table.organizerId} IS NOT NULL AND ${table.talentProfileId} IS NULL) OR
          (${table.organizerId} IS NULL AND ${table.talentProfileId} IS NOT NULL)`
    ),
  ]
);
