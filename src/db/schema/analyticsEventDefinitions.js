import { pgTable, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

// Advisory-only registry: populates an admin dropdown and defines canonical
// funnel ordering. Ingestion never rejects an unknown eventName against this
// table — unrecognized names are only logged for an "unrecognized event" alert.
export const analyticsEventDefinitions = pgTable('analytics_event_definitions', {
  eventName: varchar('event_name', { length: 64 }).primaryKey(),
  label: varchar('label', { length: 128 }).notNull(),
  description: text('description'),
  applicableEntityTypes: text('applicable_entity_types').array().notNull().default([]),
  funnelOrder: integer('funnel_order'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
