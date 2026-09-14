/**
 *
 * One row per gift voucher purchased by a "gifter" for a specific
 * talent profile and session duration.
 *
 * Lifecycle:
 *   active    → code has been generated and emailed to the recipient
 *   redeemed  → recipient used the code to book a session
 *   expired   → code was never used and its validity period passed
 *   cancelled → gifter cancelled before delivery / support action
 *
 * The code itself is an 8-character uppercase alphanumeric string
 * (e.g. "GIFT-A3K9") that is unique across the table.
 *
 * Redemption links the code to the talent_sessions row it created
 * so customer support can always trace gift → session.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';
import { talentSessions } from './talentSessions.js';

export const talentGiftCodes = pgTable(
  'talent_gift_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // The person who purchased the gift
    gifterId: uuid('gifter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Which talent the gift is for
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    // The unique redeemable code — e.g. "GIFT-A3K9"
    code: varchar('code', { length: 20 }).notNull(),

    // Session parameters locked at purchase time
    durationMins: integer('duration_mins').notNull(), // 15 | 30 | 45 | 60
    priceCents: integer('price_cents').notNull(), // locked at generation time

    // Recipient details (from giftDetails in BookOneOnOne)
    recipientName: varchar('recipient_name', { length: 255 }),
    recipientEmail: varchar('recipient_email', { length: 255 }),
    recipientPhone: varchar('recipient_phone', { length: 50 }),
    occasion: varchar('occasion', { length: 100 }),
    personalMessage: text('personal_message'),

    // Delivery
    deliveryDate: timestamp('delivery_date', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }), // when email was sent

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active'),
    // active | redeemed | expired | cancelled

    // Set when redeemed
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    redeemedSessionId: uuid('redeemed_session_id').references(() => talentSessions.id, {
      onDelete: 'set null',
    }),

    // Expiry — default 1 year from generation
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('idx_talent_gift_codes_code').on(table.code),
    index('idx_talent_gift_codes_gifter').on(table.gifterId),
    index('idx_talent_gift_codes_talent').on(table.talentProfileId),
    index('idx_talent_gift_codes_status').on(table.status),
    index('idx_talent_gift_codes_recipient_email').on(table.recipientEmail),
    index('idx_talent_gift_codes_expires').on(table.expiresAt),
  ]
);
