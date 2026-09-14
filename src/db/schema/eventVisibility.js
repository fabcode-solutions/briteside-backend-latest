import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { groups } from './groups.js';
import { users } from './users.js';

// Event-Group linking for visibility
export const eventGroupLinks = pgTable(
  'event_group_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    unique().on(table.eventId, table.groupId),
    index('idx_event_group_links_event').on(table.eventId),
    index('idx_event_group_links_group').on(table.groupId),
  ]
);

// Private event access control
export const eventAccessControl = pgTable(
  'event_access_control',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [unique().on(table.eventId, table.userId)]
);
