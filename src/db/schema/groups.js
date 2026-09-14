import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  unique,
  index,
  primaryKey,
  uniqueIndex,
  decimal,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { categories } from './categories.js';

export const groupRoleEnum = pgEnum('group_role', ['admin', 'moderator', 'member']);
export const groupJoinRequestStatusEnum = pgEnum('group_join_request_status', [
  'pending',
  'approved',
  'rejected',
]);

export const groupMemberStatusEnum = pgEnum('group_member_status', [
  'joined',
  'pending',
  'rejected',
   'blocked',
]);

// Drizzle has no built-in tsvector type; customType maps it to the raw PG type.
const tsvector = customType({
  dataType() {
    return 'tsvector';
  },
});

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    coverImageUrl: text('cover_image_url'),
    isPublic: boolean('is_public').default(true),
    requiresApproval: boolean('requires_approval').default(false),
    maxMembers: integer('max_members'),
    memberCount: integer('member_count').default(0),
    googlePlaceId: varchar('google_place_id', { length: 255 }),
    address: text('address').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }),
    longitude: decimal('longitude', { precision: 11, scale: 8 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    countryCode: varchar('country_code', { length: 10 }),
    postalCode: varchar('postal_code', { length: 20 }),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    categoryId: uuid('category_id').references(() => groupCategories.id, {
      onDelete: 'set null',
    }),
    isPaid: boolean('is_paid').default(false).notNull(),
    subscriptionPrice: decimal('subscription_price', { precision: 10, scale: 2 }),
    // Plus-only outbound CTA — { label, url }, sanitized by utils/link-button.js.
    linkButton: jsonb('link_button'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Generated column — stored tsvector with setweight so name matches (A)
    // rank higher than description matches (B) in ts_rank ordering.
    groupSearch: tsvector('group_search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`
    ),
  },
  table => [
    index('idx_groups_public')
      .on(table.isPublic)
      .where(sql`${table.isPublic} = TRUE`),
    index('idx_groups_deleted')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_groups_search_fts').using('gin', table.groupSearch),
  ]
);

// Group member role enum (replaced with pgEnum)
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRoleEnum('role').notNull().default('member'),
    status: groupMemberStatusEnum('status').notNull().default('joined'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    unique().on(table.groupId, table.userId),
    index('idx_group_members_group').on(table.groupId),
    index('idx_group_members_user').on(table.userId),
    index('idx_group_members_status').on(table.status),
  ]
);

export const groupJoinRequests = pgTable(
  'group_join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: groupJoinRequestStatusEnum('status').notNull().default('pending'),
    message: text('message'),
    is_completed: boolean('is_completed').default(false),
    answers: jsonb('answers')
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    respondedBy: uuid('responded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  table => [unique().on(table.groupId, table.userId)]
);

export const groupCategories = pgTable('group_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  emoji: varchar('emoji', { length: 10 }),
  iconUrl: text('icon_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const discussions = pgTable('discussions', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  mediaUrls: text('media_urls').array(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, {
    onDelete: 'set null',
  }),
  metadata: jsonb('metadata'),
  sharesCount: integer('shares_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }).default(null),
});

export const discussionLikes = pgTable(
  'discussion_likes',
  {
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  t => ({
    pk: primaryKey(t.discussionId, t.userId),
  })
);

export const discussionReplies = pgTable(
  'discussion_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentReplyId: uuid('parent_reply_id').references(() => discussionReplies.id, {
      onDelete: 'cascade',
    }),
    likesCount: integer('likes_count').default(0).notNull(),
    repliesCount: integer('replies_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  table => [
    index('idx_discussion_replies_discussion').on(table.discussionId),
    index('idx_discussion_replies_parent').on(table.parentReplyId),
    index('idx_discussion_replies_user').on(table.userId),
    index('idx_discussion_replies_created_at').on(table.createdAt),
  ]
);

export const discussionReplyLikes = pgTable(
  'discussion_reply_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    replyId: uuid('reply_id')
      .notNull()
      .references(() => discussionReplies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_discussion_reply_likes_reply').on(table.replyId),
    index('idx_discussion_reply_likes_user').on(table.userId),
    uniqueIndex('idx_discussion_reply_likes_unique').on(table.replyId, table.userId),
  ]
);

export const discussionSubscriptions = pgTable(
  'discussion_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  t => [
    uniqueIndex('idx_discussion_subscriptions_unique').on(t.discussionId, t.userId),
    index('idx_discussion_subscriptions_discussion').on(t.discussionId),
    index('idx_discussion_subscriptions_user').on(t.userId),
  ]
);

export const discussionCategories = pgTable(
  'discussion_categories',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  t => [
    uniqueIndex('uq_discussion_category').on(t.discussionId, t.categoryId),
    index('idx_discussion_categories_discussion').on(t.discussionId),
    index('idx_discussion_categories_category').on(t.categoryId),
  ]
);

// DEPRECATED: Replaced by flattened discussionReplies with parentReplyId
// export const nestedDiscussionReplies = pgTable('nested_discussion_replies', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   content: text('content').notNull(),
//   parentReplyId: uuid('parent_reply_id')
//     .notNull()
//     .references(() => discussionReplies.id, { onDelete: 'cascade' }),
//   discussionId: uuid('discussion_id')
//     .notNull()
//     .references(() => discussions.id, { onDelete: 'cascade' }),
//   userId: uuid('user_id')
//     .notNull()
//     .references(() => users.id, { onDelete: 'cascade' }),
//   createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
// });

// export const nestedDiscussionReplyLikes = pgTable(
//   'nested_discussion_reply_likes',
//   {
//     nestedReplyId: uuid('nested_reply_id')
//       .notNull()
//       .references(() => nestedDiscussionReplies.id, { onDelete: 'cascade' }),
//     userId: uuid('user_id')
//       .notNull()
//       .references(() => users.id, { onDelete: 'cascade' }),
//   },
//   t => ({
//     pk: primaryKey(t.nestedReplyId, t.userId),
//   })
// );

// Group Media - Similar to Event Media
export const groupMedia = pgTable(
  'group_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaUrl: text('media_url').notNull(),
    mediaType: varchar('media_type', { length: 50 }).notNull(),
    caption: text('caption'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_media_group').on(table.groupId),
    index('idx_group_media_uploader').on(table.uploaderId),
  ]
);

// Group Featured Content - For featured content/announcements
export const groupFeaturedContent = pgTable(
  'group_featured_content',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    mediaUrl: text('media_url'),
    mediaType: varchar('media_type', { length: 50 }),
    url: text('url'),
    isPinned: boolean('is_pinned').default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_featured_content_group').on(table.groupId),
    index('idx_group_featured_content_pinned').on(table.isPinned),
    index('idx_group_featured_content_created_at').on(table.createdAt),
  ]
);

// Group Discussion Notifications - Users who want to be notified when new discussions are posted in a group
export const groupDiscussionNotifications = pgTable(
  'group_discussion_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    uniqueIndex('idx_group_discussion_notifications_unique').on(table.groupId, table.userId),
    index('idx_group_discussion_notifications_group').on(table.groupId),
    index('idx_group_discussion_notifications_user').on(table.userId),
  ]
);
export const groupAboutGallery = pgTable(
  'group_about_gallery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaUrl: text('media_url').notNull(),
    mediaType: varchar('media_type', { length: 50 }).notNull(),
    caption: text('caption'),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_about_gallery_group').on(table.groupId),
    index('idx_group_about_gallery_uploader').on(table.uploaderId),
  ]
);