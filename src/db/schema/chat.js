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
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';
import { groups } from './groups.js';
import { users } from './users.js';
import { organizers } from './organizers.js';

/**
 * Event Chat Rooms - One chat room per event, automatically created when event is published
 * Access restricted to ticket holders and organizers
 */
export const eventChatRooms = pgTable(
  'event_chat_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .unique()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).default('Event Chat'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    maxParticipants: integer('max_participants').default(1000),
    messageRetentionDays: integer('message_retention_days').default(30),
    settings: jsonb('settings').default(
      sql`'{"allowMedia": true, "allowLinks": true, "moderationEnabled": false}'::jsonb`
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_event_chat_rooms_event_id').on(table.eventId),
    index('idx_event_chat_rooms_active').on(table.isActive),
  ]
);

/**
 * Event Chat Participants - Track who has access to event chat
 * Automatically populated when users purchase tickets
 */
export const eventChatParticipants = pgTable(
  'event_chat_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventChatRoomId: uuid('event_chat_room_id')
      .notNull()
      .references(() => eventChatRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('participant'), // participant, moderator, organizer
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    isMuted: boolean('is_muted').notNull().default(false),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    mutedBy: uuid('muted_by').references(() => users.id),
  },
  table => [
    unique('unique_event_chat_participant').on(table.eventChatRoomId, table.userId),
    index('idx_event_chat_participants_room').on(table.eventChatRoomId),
    index('idx_event_chat_participants_user').on(table.userId),
    index('idx_event_chat_participants_role').on(table.role),
    index('idx_event_chat_participants_active').on(table.lastActiveAt),
  ]
);

/**
 * Event Chat Messages - Enhanced with better metadata and moderation features
 */
export const eventChatMessages = pgTable(
  'event_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventChatRoomId: uuid('event_chat_room_id')
      .notNull()
      .references(() => eventChatRooms.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    messageType: varchar('message_type', { length: 20 }).notNull().default('text'), // text, image, file, system, announcement
    replyToId: uuid('reply_to_id').references(() => eventChatMessages.id),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`), // file info, image dimensions, etc.
    isEdited: boolean('is_edited').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    isDeleted: boolean('is_deleted').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    isPinned: boolean('is_pinned').notNull().default(false),
    pinnedBy: uuid('pinned_by').references(() => users.id),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_event_chat_messages_room').on(table.eventChatRoomId),
    index('idx_event_chat_messages_created').on(table.createdAt),
    index('idx_event_chat_messages_sender').on(table.senderId),
    index('idx_event_chat_messages_reply').on(table.replyToId),
    index('idx_event_chat_messages_deleted').on(table.isDeleted),
    index('idx_event_chat_messages_pinned').on(table.isPinned),
    // Composite index for efficient message fetching
    index('idx_event_chat_messages_room_created').on(table.eventChatRoomId, table.createdAt),
  ]
);

/**
 * Event Message Read Receipts - Optimized for performance with batch updates
 */
export const eventMessageReadReceipts = pgTable(
  'event_message_read_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventChatRoomId: uuid('event_chat_room_id')
      .notNull()
      .references(() => eventChatRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id').references(() => eventChatMessages.id),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
    unreadCount: integer('unread_count').notNull().default(0),
  },
  table => [
    unique('unique_event_read_receipt').on(table.eventChatRoomId, table.userId),
    index('idx_event_read_receipts_room').on(table.eventChatRoomId),
    index('idx_event_read_receipts_user').on(table.userId),
    index('idx_event_read_receipts_unread').on(table.unreadCount),
  ]
);

/**
 * Event Chat Reactions - Like/emoji reactions to messages
 */
export const eventMessageReactions = pgTable(
  'event_message_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => eventChatMessages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar('emoji', { length: 10 }).notNull(), // 👍, ❤️, 😂, etc.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('unique_message_user_emoji').on(table.messageId, table.userId, table.emoji),
    index('idx_message_reactions_message').on(table.messageId),
    index('idx_message_reactions_user').on(table.userId),
    index('idx_message_reactions_emoji').on(table.emoji),
  ]
);

/**
 * Group Chat Rooms - Enhanced for better group management
 */
export const groupChatRooms = pgTable(
  'group_chat_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .unique()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).default('Group Chat'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    settings: jsonb('settings').default(sql`'{"allowMedia": true, "allowLinks": true}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_group_chat_rooms_group_id').on(table.groupId),
    index('idx_group_chat_rooms_active').on(table.isActive),
  ]
);

/**
 * Group Chat Messages - Enhanced with moderation features
 */
export const groupChatMessages = pgTable(
  'group_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupChatRoomId: uuid('group_chat_room_id')
      .notNull()
      .references(() => groupChatRooms.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    messageType: varchar('message_type', { length: 20 }).notNull().default('text'),
    replyToId: uuid('reply_to_id').references(() => groupChatMessages.id),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    isEdited: boolean('is_edited').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    isDeleted: boolean('is_deleted').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_group_chat_messages_room').on(table.groupChatRoomId),
    index('idx_group_chat_messages_created').on(table.createdAt),
    index('idx_group_chat_messages_sender').on(table.senderId),
    index('idx_group_chat_messages_reply').on(table.replyToId),
    index('idx_group_chat_messages_deleted').on(table.isDeleted),
  ]
);

/**
 * Group Message Read Receipts - Optimized for performance
 */
/**
 * Group Message Read Receipts - Optimized for performance
 */
/**
 * Group Message Read Receipts - Optimized for performance
 */
export const groupMessageReadReceipts = pgTable(
  'group_message_read_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupChatRoomId: uuid('group_chat_room_id')
      .notNull()
      .references(() => groupChatRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id').references(() => groupChatMessages.id),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
    unreadCount: integer('unread_count').notNull().default(0),
  },
  table => [
    unique('unique_group_read_receipt').on(table.groupChatRoomId, table.userId),
    index('idx_group_read_receipts_room').on(table.groupChatRoomId),
    index('idx_group_read_receipts_user').on(table.userId),
  ]
);

/**
 * Chat Moderation Actions - Track moderation actions for audit purposes
 */
export const chatModerationActions = pgTable(
  'chat_moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatRoomId: uuid('chat_room_id').notNull(), // Can be event or group chat room
    chatRoomType: varchar('chat_room_type', { length: 10 }).notNull(), // 'event' or 'group'
    moderatorId: uuid('moderator_id')
      .notNull()
      .references(() => users.id),
    targetUserId: uuid('target_user_id').references(() => users.id),
    targetMessageId: uuid('target_message_id'), // Can reference either event or group messages
    actionType: varchar('action_type', { length: 20 }).notNull(), // mute, unmute, delete_message, pin_message, etc.
    reason: text('reason'),
    duration: integer('duration'), // Duration in minutes for temporary actions
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_moderation_actions_room').on(table.chatRoomId, table.chatRoomType),
    index('idx_moderation_actions_moderator').on(table.moderatorId),
    index('idx_moderation_actions_target_user').on(table.targetUserId),
    index('idx_moderation_actions_created').on(table.createdAt),
  ]
);


/**
 * Group Chat Reactions - Like/emoji reactions to group chat messages.
 */
export const groupMessageReactions = pgTable(
  'group_message_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => groupChatMessages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar('emoji', { length: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('unique_group_message_user_emoji').on(table.messageId, table.userId, table.emoji),
    index('idx_group_message_reactions_message').on(table.messageId),
    index('idx_group_message_reactions_user').on(table.userId),
    index('idx_group_message_reactions_emoji').on(table.emoji),
  ]
);
