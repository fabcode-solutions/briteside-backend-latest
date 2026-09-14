import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { demoSessions } from './demoSessions.js';

export const demoRegistrations = pgTable('demo_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  demoSessionId: uuid('demo_session_id')
    .notNull()
    .references(() => demoSessions.id, { onDelete: 'cascade' }),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  audience: varchar('audience', { length: 20 }).notNull(),
  audienceType: varchar('audience_type', { length: 100 }),
  primaryCategory: varchar('primary_category', { length: 255 }).notNull(),
  scaleMetric: varchar('scale_metric', { length: 255 }).notNull(),
  currentPlatform: varchar('current_platform', { length: 255 }),
  goals: text('goals'),
  status: varchar('status', { length: 20 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
