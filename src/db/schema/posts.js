import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';
import { events } from './events.js';

export const groupEventPromotions = pgTable(
  'group_event_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    promotedBy: uuid('promoted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [unique().on(table.groupId, table.eventId)]
);
