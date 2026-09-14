import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { users } from './users.js';

export const eventLikes = pgTable(
  'event_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Unique constraint: One like per user per event
    unique('unique_event_user_like').on(table.eventId, table.userId),

    // Performance indexes
    index('idx_event_likes_event_id').on(table.eventId),
    index('idx_event_likes_user_id').on(table.userId),

    // Composite index for efficient counting and user-specific queries
    index('idx_event_likes_event_user').on(table.eventId, table.userId),

    // Index for time-based queries (trending, recent likes)
    index('idx_event_likes_created_at').on(table.createdAt),
  ]
);
