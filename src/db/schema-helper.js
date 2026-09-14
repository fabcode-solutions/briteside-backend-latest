import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './schema/users.js';

export const timeStamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .default(null),
  updatedBy: uuid('updated_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .default(null),
  deletedBy: uuid('deleted_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .default(null),
};
