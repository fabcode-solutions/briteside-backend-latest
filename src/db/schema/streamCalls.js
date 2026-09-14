import { pgTable, uuid, varchar, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const streamCalls = pgTable(
  'stream_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cid: varchar('cid', { length: 255 }).notNull().unique(), // e.g., default:123
    type: varchar('type', { length: 50 }).notNull().default('default'),
    created_by_user_id: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ended_at: timestamp('ended_at', { withTimezone: true }),
    starts_at: timestamp('starts_at', { withTimezone: true }),
    backstage: boolean('backstage').notNull().default(false),
    members: jsonb('members').default(sql`'[]'::jsonb`), // Array of member objects
    ongoing: boolean('ongoing').notNull().default(false),
    custom: jsonb('custom').default(sql`'{}'::jsonb`), // Flexible custom data
  },
  table => [
    index('idx_stream_calls_cid').on(table.cid),
    index('idx_stream_calls_type').on(table.type),
    index('idx_stream_calls_created_by').on(table.created_by_user_id),
    index('idx_stream_calls_ongoing').on(table.ongoing),
  ]
);
