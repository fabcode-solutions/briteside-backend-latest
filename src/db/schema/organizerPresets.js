import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organizers } from './organizers.js';

export const organizerPresets = pgTable(
  'organizer_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    presetName: varchar('preset_name', { length: 255 }).notNull(),
    businessName: varchar('business_name', { length: 255 }),
    businessDescription: text('business_description'),
    businessType: varchar('business_type', { length: 50 }),
    logoUrl: text('logo_url'),
    coverImageUrl: text('cover_image_url').array(),
    websiteUrl: text('website_url'),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 50 }),
    businessAddress: text('business_address'),
    about: varchar('about', { length: 500 }),
    specialities: text('specialities').array(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_organizer_presets_organizer').on(table.organizerId),
    index('idx_organizer_presets_default').on(table.organizerId, table.isDefault),
  ]
);
