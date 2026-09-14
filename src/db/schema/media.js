import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { events } from './events.js';

export const eventMedia = pgTable('event_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  uploaderId: uuid('uploader_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaUrl: text('media_url').notNull(),
  mediaType: varchar('media_type', { length: 50 }).notNull(),
  caption: text('caption'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
