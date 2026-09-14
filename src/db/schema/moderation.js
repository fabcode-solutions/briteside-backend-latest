import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { media } from './fileTracking.js';
import { posts, stories } from './social.js';
import { events } from './events.js';
import { groups, discussions } from './groups.js';

/**
 * Content Moderation
 * One row per moderated entity (Stream verdict state). Exactly one of the
 * target FKs is set — polymorphic reference with real FK constraints and
 * cascade cleanup. Absence of a row = legacy content, treated as approved.
 */
export const contentModeration = pgTable(
  'content_moderation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Exactly one of these is set per row
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    discussionId: uuid('discussion_id').references(() => discussions.id, { onDelete: 'cascade' }),
    // Content creator (for dashboard filtering / user-level actions)
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // Stream entity_type submitted with the check (e.g. gokiro:post:media)
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    // pending | approved | flagged | rejected | shadowed | skipped | error
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    reviewId: text('review_id'), // Stream review_queue_item id
    labels: jsonb('labels').default(sql`'[]'::jsonb`),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Unique per target — multiple NULLs allowed, one moderation row per entity
    uniqueIndex('idx_content_moderation_media').on(table.mediaId),
    uniqueIndex('idx_content_moderation_post').on(table.postId),
    uniqueIndex('idx_content_moderation_story').on(table.storyId),
    uniqueIndex('idx_content_moderation_event').on(table.eventId),
    uniqueIndex('idx_content_moderation_group').on(table.groupId),
    uniqueIndex('idx_content_moderation_discussion').on(table.discussionId),
    index('idx_content_moderation_status').on(table.status),
    index('idx_content_moderation_user').on(table.userId),
  ]
);

/**
 * Text Moderation
 * One row per flagged text entity. `fields` holds one entry per moderated
 * text field on that entity (e.g. a post only has `caption`; an event has
 * `title` and `description`) shaped as:
 *   { fieldName: { original: string, masked: string, matchedWords: string[] } }
 * Absence of a row = never flagged, always shown as-is.
 */
export const textModeration = pgTable(
  'text_moderation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('flagged'),
    fields: jsonb('fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
    reviewId: text('review_id'),
    labels: jsonb('labels').default(sql`'[]'::jsonb`),
    severity: varchar('severity', { length: 16 }), // Stream's item.ai_text_severity (e.g. LOW/MEDIUM/HIGH/CRITICAL)
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('idx_text_moderation_entity').on(table.entityType, table.entityId),
    index('idx_text_moderation_status').on(table.status),
    index('idx_text_moderation_user').on(table.userId),
  ]
);
