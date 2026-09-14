import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
  index,
  text,
  json,
  jsonb,
  uniqueIndex,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { organizers } from './organizers.js';
import { timeStamps } from '../schema-helper.js';

export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'prefer_not_to_say']);
// User follows (social connections)
export const userFollows = pgTable(
  'user_follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_user_follows_follower').on(table.followerId),
    index('idx_user_follows_following').on(table.followingId),
    uniqueIndex('idx_user_follows_unique').on(table.followerId, table.followingId),
  ]
);

// Social profiles (extended user info for social features)
export const socialProfiles = pgTable(
  'social_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    organizerId: uuid('organizer_id').references(() => organizers.id, {
      onDelete: 'set null',
    }),
    bio: varchar('bio', { length: 500 }),
    website: varchar('website', { length: 255 }),
    location: varchar('location', { length: 200 }),
    // Structured location, alongside the free-text `location` display string —
    // both are populated from the same map-picker geocode result.
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    isPublic: boolean('is_public').default(true).notNull(),
    followersCount: integer('followers_count').default(0).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    followingCount: integer('following_count').default(0).notNull(),
    hideFollowingCount: boolean('hide_following_count').default(false).notNull(),
    postsCount: integer('posts_count').default(0).notNull(),
    profileViewsCount: integer('profile_views_count').default(0).notNull(),
    coverMedia: json('cover_media').default([]),
    status: text('status'),
    // ID of the auto-created post for the current status (null if no active status post)
    statusPostId: uuid('status_post_id').references(() => posts.id, { onDelete: 'set null' }),
    // ID of the auto-created post for the current cover media (null if no active cover post)
    coverPostId: uuid('cover_post_id').references(() => posts.id, { onDelete: 'set null' }),
    countryFlag1: varchar('country_flag_1', { length: 2 }),
    countryFlag2: varchar('country_flag_2', { length: 2 }),
    buttonMeta: jsonb('button_meta').default(null),
    age: integer('age'),
    gender: genderEnum('gender'),
    // ── Shop (creator storefront) ────────────────────────────────────────────
    // Whether the Shop tab is shown to anyone other than the owner.
    shopVisible: boolean('shop_visible').default(true).notNull(),
    // Seller-set refund policy. Copied onto each order at purchase time, and
    // eligibility is judged against that snapshot — never these live values —
    // so changing the policy can't strip a right an existing buyer paid for.
    shopRefundsEnabled: boolean('shop_refunds_enabled').default(true).notNull(),
    defaultLandingTab: varchar('default_landing_tab', { length: 10 }).default('posts').notNull(),
    shopRefundWindowDays: integer('shop_refund_window_days').default(14).notNull(),
    shopRefundAfterDownload: boolean('shop_refund_after_download').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_social_profiles_user').on(table.userId),
    index('idx_social_profiles_organizer').on(table.organizerId),
  ]
);

// status enum for wall posts
export const wallPostStatusEnum = pgEnum('wall_post_status', ['pending', 'approved', 'rejected']);

// wall posts made by others on a profile
export const socialWallPosts = pgTable(
  'social_wall_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => socialProfiles.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),

    status: wallPostStatusEnum('status').notNull().default('pending'),
    ...timeStamps,
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
  },
  table => [
    index('idx_wall_posts_profile').on(table.profileId),
    index('idx_wall_posts_author').on(table.authorId),
    index('idx_wall_posts_status').on(table.status),
  ]
);

// Posts (Instagram-like posts)
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    mediaUrls: json('media_urls').notNull().default([]),
    mediaTypes: json('media_types').notNull().default([]),
    aspectRatios: json('aspect_ratios').default([]),
    location: varchar('location', { length: 255 }),
    likesCount: integer('likes_count').default(0).notNull(),
    commentsCount: integer('comments_count').default(0).notNull(),
    sharesCount: integer('shares_count').default(0).notNull(),
    repostsCount: integer('reposts_count').default(0).notNull(),
    viewsCount: integer('views_count').default(0).notNull(),
    isArchived: boolean('is_archived').default(false).notNull(),
    isStatusPost: boolean('is_status_post').default(false).notNull(),
    isCoverPost: boolean('is_cover_post').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
    settings: json('settings').default({ commentsDisabled: false, hideLikes: false }),
    tags: json('tags').default([]), // Array of tag strings for quick access
    wallPostId: uuid('wall_post_id').references(() => socialWallPosts.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull().default('published'), // 'published' | 'scheduled'
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    source: varchar('source', { length: 20 }).notNull().default('manual'), // 'manual' | 'import'
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_posts_user').on(table.userId),
    index('idx_posts_created_at').on(table.createdAt),
    index('idx_posts_archived').on(table.isArchived),
    index('idx_posts_wall_post').on(table.wallPostId),
    index('idx_posts_deleted').on(table.deletedAt),
    index('idx_posts_expires_at').on(table.expiresAt),
    index('idx_posts_status_post').on(table.isStatusPost),
    index('idx_posts_cover_post').on(table.isCoverPost),
    index('idx_posts_status').on(table.status),
    index('idx_posts_scheduled_at').on(table.scheduledAt),
    index('idx_posts_source').on(table.source),
  ]
);


export const postTabLinks = pgTable(
  'post_tab_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 100 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),

    // Same idea as shop_products' cover — a tile needs something to render.
    coverUrl: varchar('cover_url', { length: 500 }),
    coverType: varchar('cover_type', { length: 10 }), // 'image' | 'video'

    displayOrder: integer('display_order').notNull().default(0),
    clicksCount: integer('clicks_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_tab_links_user_order').on(table.userId, table.displayOrder),
  ]
);

// Shared library of preset logo/cover options shown in the "popular covers"
// picker for website-link tiles. A row with no createdByUserId is a
// system-seeded logo and can't be deleted by regular users; a row with an
// owner can only be deleted by that owner.
export const popularLinkCovers = pgTable(
  'popular_link_covers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 60 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),
    coverType: varchar('cover_type', { length: 10 }).default('image'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_popular_link_covers_order').on(table.displayOrder),
    index('idx_popular_link_covers_created_by').on(table.createdByUserId),
  ]
);

export const collaboratorStatusEnum = pgEnum('collaborator_status', [
  'pending',
  'accepted',
  'rejected',
  'removed',
]);

export const postCollaborators = pgTable(
  'post_collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    collaboratorId: uuid('collaborator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    invitedById: uuid('invited_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: collaboratorStatusEnum('status').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_collaborators_post').on(table.postId),
    index('idx_post_collaborators_user').on(table.collaboratorId),
    index('idx_post_collaborators_status').on(table.status),
    uniqueIndex('idx_post_collaborators_unique').on(table.postId, table.collaboratorId),
  ]
);

// Post likes
export const postLikes = pgTable(
  'post_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_likes_post').on(table.postId),
    index('idx_post_likes_user').on(table.userId),
    uniqueIndex('idx_post_likes_unique').on(table.postId, table.userId),
  ]
);

// Post comments
export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references(() => postComments.id, {
      onDelete: 'cascade',
    }),
    content: text('content').notNull(),
    likesCount: integer('likes_count').default(0).notNull(),
    repliesCount: integer('replies_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_comments_post').on(table.postId),
    index('idx_post_comments_user').on(table.userId),
    index('idx_post_comments_parent').on(table.parentId),
    index('idx_post_comments_created_at').on(table.createdAt),
  ]
);
// Post user comments mapping (tracks user's latest comment on a post)
export const postUserComments = pgTable(
  'post_user_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => postComments.id, { onDelete: 'set null' }),
    commentedAt: timestamp('commented_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_user_comments_user').on(table.userId),
    index('idx_post_user_comments_post').on(table.postId),
    index('idx_post_user_comments_commented_at').on(table.commentedAt),
    uniqueIndex('idx_post_user_comments_unique').on(table.postId, table.userId),
  ]
);
// Comment likes
export const commentLikes = pgTable(
  'comment_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => postComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_comment_likes_comment').on(table.commentId),
    index('idx_comment_likes_user').on(table.userId),
    uniqueIndex('idx_comment_likes_unique').on(table.commentId, table.userId),
  ]
);

// Stories (Instagram-like stories)
export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaUrl: varchar('media_url', { length: 500 }).notNull(),
    mediaType: varchar('media_type', { length: 10 }).notNull(), // 'image' or 'video'
    caption: text('caption'),
    meta: json('meta').default(null), // arbitrary frontend metadata (stickers, text overlays, etc.)
    viewsCount: integer('views_count').default(0).notNull(),
    likesCount: integer('likes_count').default(0).notNull(),
    commentsCount: integer('comments_count').default(0).notNull(),
    sharesCount: integer('shares_count').default(0).notNull(),
    visibility: varchar('visibility', { length: 20 }).notNull().default('followers'), // 'public' | 'followers'
    commentsDisabled: boolean('comments_disabled').default(false).notNull(),
    hideViewCount: boolean('hide_view_count').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_stories_user').on(table.userId),
    index('idx_stories_expires_at').on(table.expiresAt),
    index('idx_stories_created_at').on(table.createdAt),
    index('idx_stories_visibility').on(table.visibility),
  ]
);

// Story views
export const storyViews = pgTable(
  'story_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_views_story').on(table.storyId),
    index('idx_story_views_user').on(table.userId),
    uniqueIndex('idx_story_views_unique').on(table.storyId, table.userId),
  ]
);

// Story likes
export const storyLikes = pgTable(
  'story_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_likes_story').on(table.storyId),
    index('idx_story_likes_user').on(table.userId),
    uniqueIndex('idx_story_likes_unique').on(table.storyId, table.userId),
  ]
);

// Story comments (1-level threading: top-level + replies via parentId)
export const storyComments = pgTable(
  'story_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references(() => storyComments.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    likesCount: integer('likes_count').default(0).notNull(),
    repliesCount: integer('replies_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_comments_story').on(table.storyId),
    index('idx_story_comments_user').on(table.userId),
    index('idx_story_comments_parent').on(table.parentId),
    index('idx_story_comments_created_at').on(table.createdAt),
  ]
);

// Story shares
export const storyShares = pgTable(
  'story_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_shares_story').on(table.storyId),
    index('idx_story_shares_user').on(table.userId),
    index('idx_story_shares_created_at').on(table.createdAt),
  ]
);

// Story comment likes
export const storyCommentLikes = pgTable(
  'story_comment_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => storyComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_comment_likes_comment').on(table.commentId),
    index('idx_story_comment_likes_user').on(table.userId),
    uniqueIndex('idx_story_comment_likes_unique').on(table.commentId, table.userId),
  ]
);

// Story polls (poll / quiz / slider / question types attached to a story)
export const storyPollTypeEnum = pgEnum('story_poll_type', ['poll', 'quiz', 'slider', 'question']);

export const storyPolls = pgTable(
  'story_polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: storyPollTypeEnum('type').notNull(),
    question: text('question').notNull(),
    // meta per type:
    //   poll:     { options: string[] }
    //   quiz:     { options: string[], correctOption: number, explanation?: string }
    //   slider:   { emoji: string, minLabel?: string, maxLabel?: string, min?: number, max?: number }
    //   question: { placeholder?: string }
    meta: jsonb('meta').default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_polls_story').on(table.storyId),
    index('idx_story_polls_user').on(table.userId),
    index('idx_story_polls_type').on(table.type),
  ]
);

// Story poll responses — one per user per poll
export const storyPollResponses = pgTable(
  'story_poll_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => storyPolls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // response per type:
    //   poll/quiz:  { optionIndex: number }
    //   slider:     { value: number }   (0-100)
    //   question:   { text: string }
    response: jsonb('response').notNull(),
    // populated only for quiz — computed at insert time
    isCorrect: boolean('is_correct').default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_story_poll_responses_poll').on(table.pollId),
    index('idx_story_poll_responses_user').on(table.userId),
    uniqueIndex('idx_story_poll_responses_unique').on(table.pollId, table.userId),
  ]
);

// Post shares/reposts

// Post view tracking
export const postViews = pgTable(
  'post_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_views_post').on(table.postId),
    index('idx_post_views_user').on(table.userId),
    uniqueIndex('idx_post_views_unique').on(table.postId, table.userId),
  ]
);

// Profile view tracking
export const profileViews = pgTable(
  'profile_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => socialProfiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_profile_views_profile').on(table.profileId),
    index('idx_profile_views_user').on(table.userId),
    uniqueIndex('idx_profile_views_unique').on(table.profileId, table.userId),
  ]
);

// Profile view sessions — one row per actual visit (no unique constraint)
export const profileViewSessions = pgTable(
  'profile_view_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => socialProfiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_profile_view_sessions_profile').on(table.profileId),
    index('idx_profile_view_sessions_user').on(table.userId),
    index('idx_profile_view_sessions_viewed_at').on(table.viewedAt),
  ]
);

// Post shares/reposts
export const postShares = pgTable(
  'post_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_shares_post').on(table.postId),
    index('idx_post_shares_user').on(table.userId),
    index('idx_post_shares_created_at').on(table.createdAt),
  ]
);

// Post reposts
export const postReposts = pgTable(
  'post_reposts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_reposts_post').on(table.postId),
    index('idx_post_reposts_user').on(table.userId),
    uniqueIndex('idx_post_reposts_unique').on(table.postId, table.userId),
  ]
);

// Saved posts
export const savedPosts = pgTable(
  'saved_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_saved_posts_post').on(table.postId),
    index('idx_saved_posts_user').on(table.userId),
    uniqueIndex('idx_saved_posts_unique').on(table.postId, table.userId),
  ]
);

// User hidden posts (per-user hidden posts)
export const userHiddenPosts = pgTable(
  'user_hidden_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_user_hidden_posts_user').on(table.userId),
    index('idx_user_hidden_posts_post').on(table.postId),
    uniqueIndex('idx_user_hidden_posts_unique').on(table.postId, table.userId),
  ]
);

// User blocks
export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_user_blocks_blocker').on(table.blockerId),
    index('idx_user_blocks_blocked').on(table.blockedId),
    uniqueIndex('idx_user_blocks_unique').on(table.blockerId, table.blockedId),
  ]
);

// Interest categories
export const interestCategories = pgTable(
  'interest_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    icon: varchar('icon', { length: 50 }),
    color: varchar('color', { length: 7 }).default('#3B82F6'),
    isActive: boolean('is_active').default(true).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    usageCount: integer('usage_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_interest_categories_slug').on(table.slug),
    index('idx_interest_categories_active').on(table.isActive),
    index('idx_interest_categories_sort').on(table.sortOrder),
    index('idx_interest_categories_default').on(table.isDefault),
  ]
);

// User interests with intensity levels
export const userInterests = pgTable(
  'user_interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => interestCategories.id, { onDelete: 'cascade' }),
    intensity: integer('intensity').notNull().default(50), // 0-100 scale
    isVisible: boolean('is_visible').default(true).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_user_interests_user').on(table.userId),
    index('idx_user_interests_category').on(table.categoryId),
    index('idx_user_interests_intensity').on(table.intensity),
    index('idx_user_interests_visible').on(table.isVisible),
    uniqueIndex('idx_user_interests_unique').on(table.userId, table.categoryId),
  ]
);

// Post tags for interest categorization
export const postTags = pgTable(
  'post_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => interestCategories.id, { onDelete: 'cascade' }),
    confidence: integer('confidence').default(100).notNull(), // AI confidence score 0-100
    source: varchar('source', { length: 20 }).default('manual').notNull(), // 'manual', 'ai', 'hashtag'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_post_tags_post').on(table.postId),
    index('idx_post_tags_category').on(table.categoryId),
    index('idx_post_tags_confidence').on(table.confidence),
    index('idx_post_tags_source').on(table.source),
    uniqueIndex('idx_post_tags_unique').on(table.postId, table.categoryId),
  ]
);

// User mentions/tags in comments and discussion replies
export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: varchar('source_type', { length: 30 }).notNull(), // 'comment' | 'discussion_reply'
    sourceId: uuid('source_id').notNull(), // polymorphic: postComments.id or discussionReplies.id
    mentionedUserId: uuid('mentioned_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mentionedByUserId: uuid('mentioned_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_mentions_source').on(table.sourceType, table.sourceId),
    index('idx_mentions_mentioned_user').on(table.mentionedUserId),
    index('idx_mentions_mentioned_by').on(table.mentionedByUserId),
  ]
);

// Pinned posts (max 9 per user, ordered by pin_order)
export const pinnedPosts = pgTable(
  'pinned_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull().default('post'), // 'post' | 'link'
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').references(() => postTabLinks.id, { onDelete: 'cascade' }),
    pinOrder: integer('pin_order').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_pinned_posts_user_order').on(table.userId, table.pinOrder),
    index('idx_pinned_posts_post').on(table.postId),
    index('idx_pinned_posts_link').on(table.linkId),
    uniqueIndex('idx_pinned_posts_unique_post')
      .on(table.userId, table.postId)
      .where(sql`${table.postId} IS NOT NULL`),
    uniqueIndex('idx_pinned_posts_unique_link')
      .on(table.userId, table.linkId)
      .where(sql`${table.linkId} IS NOT NULL`),
    check('pin_order_range', sql`${table.pinOrder} BETWEEN 1 AND 9`),
    check(
      'pinned_item_type_consistency',
      sql`(${table.itemType} = 'post' AND ${table.postId} IS NOT NULL AND ${table.linkId} IS NULL)
       OR (${table.itemType} = 'link' AND ${table.linkId} IS NOT NULL AND ${table.postId} IS NULL)`
    ),
  ]
);

// Pinned profiles (a user bookmarking another user's profile for quick access)
export const pinnedProfiles = pgTable(
  'pinned_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pinnedUserId: uuid('pinned_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_pinned_profiles_user').on(table.userId),
    index('idx_pinned_profiles_pinned_user').on(table.pinnedUserId),
    uniqueIndex('idx_pinned_profiles_unique').on(table.userId, table.pinnedUserId),
  ]
);

export const userFollowRequests = pgTable(
  'user_follow_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_follow_requests_requester').on(table.requesterId),
    index('idx_follow_requests_target').on(table.targetId),
    uniqueIndex('idx_follow_requests_unique').on(table.requesterId, table.targetId),
  ]
);

// Per-user post display order — allows each user (creator or collaborator) to independently
// reorder posts on their own profile. Separate from the post itself so collaborators
// don't overwrite each other's order.
export const postTabItemTypeEnum = pgEnum('post_tab_item_type', ['post', 'link']);

export const userPostOrder = pgTable(
  'user_post_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: postTabItemTypeEnum('item_type').notNull().default('post'),
    // Exactly one of these is set, matching itemType.
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').references(() => postTabLinks.id, { onDelete: 'cascade' }),
    displayOrder: integer('display_order').notNull(),
  },
  table => [
    index('idx_user_post_order_user').on(table.userId, table.displayOrder),
    uniqueIndex('idx_user_post_order_unique_post').on(table.userId, table.postId),
    uniqueIndex('idx_user_post_order_unique_link').on(table.userId, table.linkId),
    check(
      'user_post_order_item_ref',
      sql`(${table.itemType} = 'post' AND ${table.postId} IS NOT NULL AND ${table.linkId} IS NULL)
       OR (${table.itemType} = 'link' AND ${table.linkId} IS NOT NULL AND ${table.postId} IS NULL)`
    ),
  ]
);  

// Atomic reservation counter for bulk-import displayOrder ranges. Counts DOWN
// from 0 — each import batch reserves the negative range just below the last
// one, so newer batches always sort above older ones (and above old,
// unordered posts) under the profile's (displayOrder ASC) sort. A single
// INSERT..ON CONFLICT against this one-row-per-user table lets concurrent
// import submissions each grab a non-overlapping range without racing a
// MAX(userPostOrder.displayOrder) read against still-in-flight writes.
export const userPostOrderCounter = pgTable('user_post_order_counter', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  nextOrder: integer('next_order').notNull().default(0),
});