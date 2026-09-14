import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  unique,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { stories, posts } from './social.js';

// Minimal 1:1 conversations between two users
export const socialConversations = pgTable(
  'social_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationType: varchar('conversation_type', { length: 20 }).notNull().default('social'),
    organizerUserId: uuid('organizer_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'cascade',
    }),
  },
  table => [
    unique('unique_social_conversation_pair').on(
      table.userAId,
      table.userBId,
      table.conversationType
    ),
    index('idx_social_conversations_user_a').on(table.userAId),
    index('idx_social_conversations_user_b').on(table.userBId),
    index('idx_social_conversations_type').on(table.conversationType),
    index('idx_social_conversations_last_message_at').on(table.lastMessageAt)
  ]
);

// Minimal messages with type + optional metadata and seen status
export const socialMessages = pgTable(
  'social_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => socialConversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    messageType: varchar('message_type', { length: 20 }).notNull().default('text'), // text | image | video | file | location
    content: text('content'), // optional for non-text types
    // Nested replies: reference another social message in the same table
    replyToId: uuid('reply_to_id').references(() => socialMessages.id),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    storyId: uuid('story_id')
      .references(() => stories.id)
      .default(null),
    postId: uuid('post_id')
      .references(() => posts.id)
      .default(null),
    // Seen by the recipient
    isSeen: boolean('is_seen').notNull().default(false),
    isPriority: boolean('is_priority').notNull().default(false),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  table => [
    index('idx_social_messages_conversation').on(table.conversationId),
    index('idx_social_messages_is_priority').on(table.isPriority),
    index('idx_social_messages_created').on(table.createdAt),
    index('idx_social_messages_sender').on(table.senderId),
    index('idx_social_messages_type').on(table.messageType),
    index('idx_social_messages_reply').on(table.replyToId),
    index('idx_social_messages_is_seen').on(table.isSeen),
    index('idx_social_messages_conv_created').on(table.conversationId, table.createdAt),
  ]
);
