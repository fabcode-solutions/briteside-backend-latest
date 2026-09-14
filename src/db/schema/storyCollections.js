import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { stories, posts } from './social.js';

export const storyCollections = pgTable(
  'story_collections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    coverImage: text('cover_image'),
    sortOrder: integer('sort_order').default(0).notNull(),
    itemsCount: integer('items_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('story_collections_user_id_idx').on(t.userId),
    index('story_collections_user_sort_idx').on(t.userId, t.sortOrder),
  ]
);

export const storyCollectionItems = pgTable(
  'story_collection_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => storyCollections.id, { onDelete: 'cascade' }),
    itemType: varchar('item_type', { length: 10 }).notNull(), // 'story' | 'post'
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('story_collection_items_collection_id_idx').on(t.collectionId),
    index('story_collection_items_story_id_idx').on(t.storyId),
    index('story_collection_items_post_id_idx').on(t.postId),
    index('story_collection_items_item_type_idx').on(t.itemType),
  ]
);
