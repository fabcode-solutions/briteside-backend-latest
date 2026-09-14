import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';

// Generic files/documents an organizer attaches to a group's Resources
// section — distinct from group_courses, which are structured video lessons.
export const groupResources = pgTable(
  'group_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    fileUrl: text('file_url').notNull(),
    fileName: varchar('file_name', { length: 255 }),
    fileType: varchar('file_type', { length: 100 }),
    size: integer('size'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_group_resources_group').on(table.groupId, table.sortOrder),
    index('idx_group_resources_creator').on(table.createdBy),
  ]
);
