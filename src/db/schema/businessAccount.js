/**
 * A business is its own account. These are the business's own copies of the
 * personal-account tools: pinned profiles, blocked accounts and interests.
 * (Notification and privacy settings are columns on `businesses`.)
 */
import { pgTable, uuid, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users.js';
import { businesses } from './businesses.js';
import { categories } from './categories.js';
import { groupCategories } from './groups.js';

// Profiles the business pinned (like pinned_profiles, per business)
export const businessPinnedProfiles = pgTable(
  'business_pinned_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    // Exactly one of pinned_user_id (a person) / pinned_business_id (a business page)
    pinnedUserId: uuid('pinned_user_id').references(() => users.id, { onDelete: 'cascade' }),
    pinnedBusinessId: uuid('pinned_business_id').references(() => businesses.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    uniqueIndex('uq_business_pinned_profiles').on(t.businessId, t.pinnedUserId),
    uniqueIndex('uq_business_pinned_businesses').on(t.businessId, t.pinnedBusinessId),
    check(
      'chk_business_pinned_target',
      sql`(${t.pinnedUserId} IS NULL) <> (${t.pinnedBusinessId} IS NULL)`
    ),
    index('idx_business_pinned_profiles_business').on(t.businessId, t.createdAt),
  ]
);

// Accounts the business blocked: they can't message, post on the wall,
// comment, follow, book or review the business.
export const businessBlocks = pgTable(
  'business_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    uniqueIndex('uq_business_blocks').on(t.businessId, t.blockedUserId),
    index('idx_business_blocks_user').on(t.blockedUserId),
  ]
);

// Event categories the business is interested in — ranks the Events tab while acting as it
export const businessEventCategoryPreferences = pgTable(
  'business_event_category_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('uq_business_event_category_pref').on(t.businessId, t.categoryId)]
);

// Group categories the business is interested in — ranks the Groups tab while acting as it
export const businessGroupCategoryPreferences = pgTable(
  'business_group_category_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => groupCategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('uq_business_group_category_pref').on(t.businessId, t.categoryId)]
);

export const businessPinnedProfilesRelations = relations(businessPinnedProfiles, ({ one }) => ({
  business: one(businesses, { fields: [businessPinnedProfiles.businessId], references: [businesses.id] }),
  pinnedUser: one(users, { fields: [businessPinnedProfiles.pinnedUserId], references: [users.id] }),
}));

export const businessBlocksRelations = relations(businessBlocks, ({ one }) => ({
  business: one(businesses, { fields: [businessBlocks.businessId], references: [businesses.id] }),
  blockedUser: one(users, { fields: [businessBlocks.blockedUserId], references: [users.id] }),
}));
