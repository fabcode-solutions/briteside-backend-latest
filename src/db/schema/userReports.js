import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  pgEnum,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { posts } from './social.js';
import { groups } from './groups.js';
import { events } from './events.js';
import { users } from './users.js';
import { socialConversations } from './socialChat.js';
import { discussions } from './groups.js';
import { talentSessions } from './talentSessions.js';
export const reportTypeEnum = pgEnum('report_type', [
  'user',
  'post',
  'group',
  'event',
  'comment',
  'social_chat',
  'discussion',
  'talent_session',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'pending',
  'reviewed',
  'resolved',
  'dismissed',
]);

export const userReports = pgTable(
  'user_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: reportTypeEnum('type').notNull(),

    // Target Foreign Keys
    targetUserId: uuid('target_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => groups.id, {
      onDelete: 'cascade',
    }),
    eventId: uuid('event_id').references(() => events.id, {
      onDelete: 'cascade',
    }),
    conversationId: uuid('conversation_id').references(() => socialConversations.id, {
      onDelete: 'cascade',
    }),
    discussionId: uuid('discussion_id').references(() => discussions.id, {
      onDelete: 'cascade',
    }),
    talentSessionId: uuid('talent_session_id').references(() => talentSessions.id, {
      onDelete: 'cascade',
    }),
    reason: varchar('reason', { length: 255 }).notNull(),
    description: text('description'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    evidenceImages: text('evidence_images')
      .array()
      .default(sql`'{}'::text[]`),

    status: reportStatusEnum('status').default('pending'),
    actionTaken: varchar('action_taken', { length: 255 }),

    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_reports_status').on(table.status),
    index('idx_reports_reporter').on(table.reporterId),
    index('idx_reports_target_user').on(table.targetUserId),
    index('idx_reports_discussion').on(table.discussionId),
    index('idx_reports_talent_session').on(table.talentSessionId),
    // Unique constraints to prevent spamming reports on same content
    unique('unique_post_report').on(table.reporterId, table.postId),
    unique('unique_group_report').on(table.reporterId, table.groupId),
    unique('unique_event_report').on(table.reporterId, table.eventId),
    unique('unique_social_chat_report').on(table.reporterId, table.conversationId),
    unique('unique_discussion_report').on(table.reporterId, table.discussionId),
    unique('unique_talent_session_report').on(table.reporterId, table.talentSessionId),
  ]
);

export const userReportsRelations = relations(userReports, ({ one }) => ({
  reporter: one(users, {
    fields: [userReports.reporterId],
    references: [users.id],
    relationName: 'reportsSubmitted',
  }),
  reviewedBy: one(users, {
    fields: [userReports.reviewedBy],
    references: [users.id],
    relationName: 'reportsReviewed',
  }),
  targetUser: one(users, {
    fields: [userReports.targetUserId],
    references: [users.id],
    relationName: 'reportsReceived',
  }),
  post: one(posts, {
    fields: [userReports.postId],
    references: [posts.id],
  }),
  group: one(groups, {
    fields: [userReports.groupId],
    references: [groups.id],
  }),
  event: one(events, {
    fields: [userReports.eventId],
    references: [events.id],
  }),
  socialConversation: one(socialConversations, {
    fields: [userReports.conversationId],
    references: [socialConversations.id],
  }),
  discussion: one(discussions, {
    fields: [userReports.discussionId],
    references: [discussions.id],
  }),
  talentSession: one(talentSessions, {
    fields: [userReports.talentSessionId],
    references: [talentSessions.id],
  }),
}));
