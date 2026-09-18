import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * user_devices
 *
 * Registers each mobile/web app install a user is logged into (NOT the
 * Taykie BLE pill dispenser — that's a separate `device` concept on
 * users.js). A user can be logged in on multiple phones (e.g. Android +
 * iOS) at once; each gets its own row and its own push notification token.
 */
export const devicePlatformEnum = pgEnum('device_platform_enum', ['ios', 'android', 'web']);

export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // FCM/APNs push token for this install
    notificationUid: text('notification_uid').notNull(),

    platform: devicePlatformEnum('platform'),
    deviceModel: varchar('device_model', { length: 100 }),
    appVersion: varchar('app_version', { length: 20 }),

    // false once the user logs out on this device / the token is revoked
    isActive: boolean('is_active').default(true).notNull(),

    firstLoginAt: timestamp('first_login_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('idx_user_devices_user_id').on(table.userId),
    // A push token belongs to exactly one device row (reinstall reuses/updates it)
    uniqueIndex('idx_user_devices_notification_uid').on(table.notificationUid),
    index('idx_user_devices_is_active').on(table.isActive),
  ]
);
