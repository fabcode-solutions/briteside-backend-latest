import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const bioLinks = pgTable(
  'bio_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 100 }).notNull(),
    url: varchar('url', { length: 2000 }).notNull(),
    icon: varchar('icon', { length: 50 }),
    clickCount: integer('click_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('bio_links_user_id_idx').on(t.userId),
    index('bio_links_user_created_at_idx').on(t.userId, t.createdAt),
  ]
);
