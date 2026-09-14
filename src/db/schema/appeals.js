import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';

export const suspensionAppeals = pgTable(
  'suspension_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    adminId: uuid('admin_id').references(() => users.id),
    adminResponse: text('admin_response'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    newSuspendedUntil: timestamp('new_suspended_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_suspension_appeals_user').on(table.userId),
    index('idx_suspension_appeals_status').on(table.status),
  ]
);

export const suspensionAppealsRelations = relations(suspensionAppeals, ({ one }) => ({
  user: one(users, {
    fields: [suspensionAppeals.userId],
    references: [users.id],
    relationName: 'appealUser',
  }),
  admin: one(users, {
    fields: [suspensionAppeals.adminId],
    references: [users.id],
    relationName: 'appealAdmin',
  }),
}));
