import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    email: varchar('email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    message: text('message').notNull(),
    status: varchar('status', { length: 20 }).default('new').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('idx_contact_messages_email').on(table.email),
    index('idx_contact_messages_status').on(table.status),
    index('idx_contact_messages_created_at').on(table.createdAt),
  ]
);
