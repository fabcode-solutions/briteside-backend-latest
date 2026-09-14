import { index, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Status enum for username reservations
export const usernameReservationStatusEnum = pgEnum('username_reservation_status', [
  'pending',
  'approved',
  'rejected',
]);

// Social platform enum
export const socialPlatformEnum = pgEnum('social_platform', [
  'Instagram',
  'Tiktok',
  'YouTube',
  'Twitter',
  'Facebook',
  'LinkedIn',
  'Snapchat',
  'Twitch',
  'Other',
]);

// Follower count range enum
export const followerCountRangeEnum = pgEnum('follower_count_range', [
  '10k-50k',
  '50k-100k',
  '100k-500k',
  '500k-1M',
  '1M-5M',
  '5M-10M',
  '10M+',
]);

export const usernameReservations = pgTable(
  'username_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    username: varchar('username', { length: 100 }).notNull(),
    primaryPlatform: socialPlatformEnum('primary_platform').notNull(),
    followerCount: followerCountRangeEnum('follower_count').notNull(),
    profileUrl: text('profile_url').notNull(),

    // Additional info
    additionalInfo: text('additional_info'),
    status: usernameReservationStatusEnum('status').default('pending').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    rejectionReason: text('rejection_reason'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  table => [
    // Unique constraint on username for pending and approved reservations
    // This allows the same username to be re-applied after rejection
    index('idx_username_reservations_username').on(table.username),
    index('idx_username_reservations_email').on(table.email),
    index('idx_username_reservations_status').on(table.status),
    index('idx_username_reservations_created_at').on(table.createdAt),
  ]
);
