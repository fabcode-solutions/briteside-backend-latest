import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * A business sign-up whose business isn't created yet (business type and
 * @username picked at sign-up). Lets any device bring the user back to
 * onboarding. Deleted when the business is created or the user dismisses it.
 * (drizzle/0182_pending_business_setups.sql)
 */
export const pendingBusinessSetups = pgTable('pending_business_setups', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  category: varchar('category', { length: 40 }).notNull(),
  subcategory: varchar('subcategory', { length: 100 }),
  handle: varchar('handle', { length: 30 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
