import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { groups } from './groups.js';

export const groupQuestions = pgTable(
  'group_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    questionText: varchar('question_text', { length: 500 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    meta: jsonb('meta')
      .default(sql`'{}'::jsonb`)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  t => [
    index('idx_group_questions_group').on(t.groupId),
    index('idx_group_questions_active').on(t.groupId, t.isActive),
  ]
);
