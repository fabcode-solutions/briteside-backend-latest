import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

// ─── Livestreams ────────────────────────────────────────────────────────────
export const livestreams = pgTable(
  'livestreams',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Owner
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Stream metadata
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),

    // GetStream identifiers
    streamCallId: varchar('stream_call_id', { length: 255 }).notNull(), // GetStream call id
    streamCallCid: varchar('stream_call_cid', { length: 255 }), // e.g. "livestream:<id>"

    // State
    status: varchar('status', { length: 20 }).notNull().default('idle'),
    // idle | live | ended

    // Settings
    allowComments: boolean('allow_comments').notNull().default(true),
    thumbnailUrl: text('thumbnail_url'),

    // Stats (denormalised for fast reads)
    viewerCount: integer('viewer_count').notNull().default(0),
    peakViewerCount: integer('peak_viewer_count').notNull().default(0),
    totalReactions: integer('total_reactions').notNull().default(0),

    // Timestamps
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_livestreams_user').on(table.userId),
    index('idx_livestreams_status').on(table.status),
    index('idx_livestreams_started_at').on(table.startedAt),
    uniqueIndex('idx_livestreams_stream_call_id').on(table.streamCallId),
  ]
);

// ─── Livestream Reactions (Instagram-style burst reactions) ─────────────────
export const livestreamReactions = pgTable(
  'livestream_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    livestreamId: uuid('livestream_id')
      .notNull()
      .references(() => livestreams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar('emoji', { length: 10 }).notNull(), // e.g. "❤️", "🔥", "👏"
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_livestream_reactions_stream').on(table.livestreamId),
    index('idx_livestream_reactions_user').on(table.userId),
    index('idx_livestream_reactions_created').on(table.createdAt),
  ]
);

// ─── Livestream Comments ─────────────────────────────────────────────────────
export const livestreamComments = pgTable(
  'livestream_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    livestreamId: uuid('livestream_id')
      .notNull()
      .references(() => livestreams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_livestream_comments_stream').on(table.livestreamId),
    index('idx_livestream_comments_user').on(table.userId),
    index('idx_livestream_comments_created').on(table.createdAt),
  ]
);

// ─── Livestream Viewers ──────────────────────────────────────────────────────
export const livestreamViewers = pgTable(
  'livestream_viewers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    livestreamId: uuid('livestream_id')
      .notNull()
      .references(() => livestreams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  table => [
    index('idx_livestream_viewers_stream').on(table.livestreamId),
    index('idx_livestream_viewers_user').on(table.userId),
    uniqueIndex('idx_livestream_viewers_unique').on(table.livestreamId, table.userId),
  ]
);
