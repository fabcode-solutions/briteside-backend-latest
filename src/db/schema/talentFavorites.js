/**
 * src/db/schema/talentFavorites.js
 *
 * talent_favorites
 *
 * Stores a user's saved/favourite talent profiles.
 * One row per (userId, talentProfileId) pair — unique constraint prevents dupes.
 * Deleting a talent profile cascades and removes all favourites for it.
 */

import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';

export const talentFavorites = pgTable(
  'talent_favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_talent_favorites_user').on(table.userId),
    index('idx_talent_favorites_profile').on(table.talentProfileId),
    uniqueIndex('idx_talent_favorites_unique').on(table.userId, table.talentProfileId),
  ]
);
