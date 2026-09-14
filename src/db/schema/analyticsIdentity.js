import { pgTable, uuid, varchar, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Anonymous → user identity merge, populated on login whenever a request
// carries a known anonymousId. Lets dashboard demographic queries fold
// pre-login anonymous events into the now-known user's profile.
export const analyticsIdentityLinks = pgTable(
  'analytics_identity_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anonymousId: varchar('anonymous_id', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('uq_analytics_identity_links').on(table.anonymousId, table.userId),
    index('idx_analytics_identity_links_user').on(table.userId),
  ]
);
