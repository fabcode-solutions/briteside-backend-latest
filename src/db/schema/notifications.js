import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';

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
    isSeen: boolean('is_seen').default(false),
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

// One row per event reminder actually sent (user × event × 24h/6h stage).
// The reminder crons re-scan their whole window every run, so this is what
// stops a ticket holder getting the same reminder each hour. Kept separate
// from `notifications` because users can delete those (and may have in-app
// reminders turned off while still getting the email).
export const eventReminderLog = pgTable(
  'event_reminder_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hoursBefore: integer('hours_before').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('uq_event_reminder_log').on(table.eventId, table.userId, table.hoursBefore),
  ]
);
