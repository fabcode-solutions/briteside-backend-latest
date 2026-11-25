import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { businesses } from './businesses.js';
import { pendingBusinessSetups } from './pendingBusinessSetups.js';

/**
 * One namespace for personal usernames and business @usernames (slugs).
 * Rows are written only by database triggers on users.username and
 * businesses.slug (drizzle/0180_shared_handles.sql) — never insert here from
 * app code. `name` is lowercased, so names are unique regardless of case.
 */
export const handles = pgTable(
  'handles',
  {
    name: varchar('name', { length: 120 }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    // Held for a business sign-up until its business is created (0183)
    pendingUserId: uuid('pending_user_id').references(() => pendingBusinessSetups.userId, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    check(
      'chk_handles_one_owner',
      sql`num_nonnulls(${table.userId}, ${table.businessId}, ${table.pendingUserId}) = 1`
    ),
    uniqueIndex('uq_handles_pending').on(table.pendingUserId).where(sql`${table.pendingUserId} IS NOT NULL`),
    check('chk_handles_lowercase', sql`${table.name} = lower(${table.name})`),
    uniqueIndex('uq_handles_user').on(table.userId).where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex('uq_handles_business').on(table.businessId).where(sql`${table.businessId} IS NOT NULL`),
  ]
);

/**
 * A renamed business's old @usernames, so /business/<old> redirects to it.
 * Written only by the businesses slug trigger; a row is deleted as soon as its
 * name is claimed in `handles` (drizzle/0181_business_previous_handles.sql).
 */
export const businessPreviousHandles = pgTable(
  'business_previous_handles',
  {
    name: varchar('name', { length: 120 }).primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    check('chk_business_previous_handles_lowercase', sql`${table.name} = lower(${table.name})`),
    index('idx_business_previous_handles_business').on(table.businessId),
  ]
);
