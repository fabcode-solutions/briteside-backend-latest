import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { categories } from './categories.js';
import { groupCategories } from './groups.js';

// Event categories a user picked in the app setup flow — ranks the Events tab.
export const userEventCategoryPreferences = pgTable(
  'user_event_category_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('uq_user_event_category_pref').on(t.userId, t.categoryId)]
);

// Group categories a user picked in the app setup flow — ranks the Groups tab.
export const userGroupCategoryPreferences = pgTable(
  'user_group_category_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => groupCategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('uq_user_group_category_pref').on(t.userId, t.categoryId)]
);
