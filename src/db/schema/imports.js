import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  smallint,
  text,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { posts } from './social.js';

export const importStatusEnum = pgEnum('import_status', [
  'draft',
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const imageStatusEnum = pgEnum('image_status', [
  'pending',
  'processing',
  'published',
  'rejected',
  'failed',
]);

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: importStatusEnum('status').notNull().default('draft'),
    totalImages: integer('total_images').notNull().default(0),
    duplicateImages: integer('duplicate_images').notNull().default(0),
    processedImages: integer('processed_images').notNull().default(0),
    failedImages: integer('failed_images').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => [
    // One active draft per user enforced at DB level
    uniqueIndex('one_draft_per_user')
      .on(table.userId)
      .where(sql`status = 'draft'`),
    index('idx_imports_status').on(table.status),
    index('idx_imports_user_id').on(table.userId),
  ]
);

export const importImages = pgTable(
  'import_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    // Denormalized: avoids joining through imports in worker/analytics queries
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key').notNull(),
    fileHash: varchar('file_hash', { length: 64 }),
    originalFilename: varchar('original_filename', { length: 255 }),
    caption: varchar('caption', { length: 500 }),
    displayOrder: smallint('display_order').notNull(),
    status: imageStatusEnum('status').notNull().default('pending'),
    createdPostId: uuid('created_post_id').references(() => posts.id, { onDelete: 'set null' }),
    // Stores AI rejection reason or S3/processing error
    failReason: text('fail_reason'),
    // Future: tracks AI moderation retries
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_import_images_import_status').on(table.importId, table.status),
    index('idx_import_images_import_id').on(table.importId),
    index('idx_import_images_user_id').on(table.userId),
    index('idx_import_images_user_hash')
      .on(table.userId, table.fileHash)
      .where(sql`file_hash IS NOT NULL`),
  ]
);
