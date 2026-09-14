/**
 * talent_issues
 *
 * Customer-raised disputes against a talent for a session booking or
 * priority message that was paid but not fulfilled.
 *
 * Status lifecycle:
 *   pending → resolved
 *          ↘ dismissed
 *
 * entityType:
 *   'session'          — references talent_sessions.id
 *   'priority_message' — references priority_message_payments.id
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';

export const talentIssues = pgTable(
  'talent_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Reporter — the customer who raised the issue
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Talent being reported
    talentUserId: uuid('talent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),

    // Which paid entity is in dispute
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    // 'session' | 'priority_message'
    entityId: uuid('entity_id').notNull(),
    // FK to talent_sessions.id or priority_message_payments.id
    // (no DB-level FK — points to two different tables, enforced in service)

    // Issue details
    reason: varchar('reason', { length: 50 }).notNull(),
    // 'no_reply' | 'no_show' | 'no_attend' | 'other'
    message: text('message').notNull(),

    // Payment snapshot — copied at issue-creation time for admin convenience
    amountCents: integer('amount_cents').notNull(),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // pending | resolved | dismissed

    // Admin resolution fields
    adminId: uuid('admin_id').references(() => users.id),
    adminNote: text('admin_note'),

    refundIssued: boolean('refund_issued').notNull().default(false),
    refundAmountCents: integer('refund_amount_cents'),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }),

    warningIssued: boolean('warning_issued').notNull().default(false),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_talent_issues_reporter').on(table.reporterId),
    index('idx_talent_issues_talent_user').on(table.talentUserId),
    index('idx_talent_issues_status').on(table.status),
    index('idx_talent_issues_entity').on(table.entityType, table.entityId),
  ]
);

export const talentIssuesRelations = relations(talentIssues, ({ one }) => ({
  reporter: one(users, {
    fields: [talentIssues.reporterId],
    references: [users.id],
    relationName: 'talentIssuesReporter',
  }),
  talentUser: one(users, {
    fields: [talentIssues.talentUserId],
    references: [users.id],
    relationName: 'talentIssuesTarget',
  }),
  talentProfile: one(talentProfiles, {
    fields: [talentIssues.talentProfileId],
    references: [talentProfiles.id],
  }),
  admin: one(users, {
    fields: [talentIssues.adminId],
    references: [users.id],
    relationName: 'talentIssuesAdmin',
  }),
}));
