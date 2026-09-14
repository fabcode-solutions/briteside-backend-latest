import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const userNotificationSettings = pgTable('user_notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  eventUpdates: boolean('event_updates').default(true),
  purchaseConfirmation: boolean('purchase_confirmation').default(true),
  eventReminders: boolean('event_reminders').default(true),
  chatMessages: boolean('chat_messages').default(true),
  groupActivities: boolean('group_activities').default(true),
  socialUpdates: boolean('social_updates').default(true),
  birthdayNotifications: boolean('birthday_notifications').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    redirectTo: varchar('redirect_to', { length: 255 }),
    relatedId: uuid('related_id'),
    isRead: boolean('is_read').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  },
  table => [
    index('idx_notifications_user').on(table.userId),
    index('idx_notifications_read')
      .on(table.isRead)
      .where(sql`${table.isRead} = FALSE`),
  ]
);
