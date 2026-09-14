import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  pgEnum,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * Media Type Enum
 * Categorizes media files by type for frontend filtering
 */
export const mediaTypeEnum = pgEnum('media_type', ['image', 'video', 'audio', 'document']);

/**
 * Media Table
 * Stores metadata for all uploaded media files with deduplication via file hash
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileHash: varchar('file_hash', { length: 64 }).notNull().unique(), // SHA-256 hash
    s3Key: text('s3_key').notNull().unique(),
    s3Bucket: varchar('s3_bucket', { length: 255 }).notNull(),
    url: text('url').notNull(),
    mediaType: mediaTypeEnum('media_type').notNull(), // image, video, audio, document
    mimetype: varchar('mimetype', { length: 100 }).notNull(),
    extension: varchar('extension', { length: 20 }).notNull(), // .jpg, .png, .mp4, etc.
    size: integer('size').notNull(), // File size in bytes
    folder: varchar('folder', { length: 100 }).notNull(), // events, users, groups, etc.
    originalName: varchar('original_name', { length: 255 }),
    properties: jsonb('properties').default(sql`'{}'::jsonb`), // width, height, duration, etc.
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    referenceCount: integer('reference_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // Soft delete for grace period
  },
  table => [
    index('media_hash_idx').on(table.fileHash),
    index('media_s3_key_idx').on(table.s3Key),
    index('media_type_idx').on(table.mediaType),
    index('media_reference_count_idx').on(table.referenceCount),
    index('media_deleted_at_idx').on(table.deletedAt),
    index('media_uploaded_by_idx').on(table.uploadedBy),
  ]
);

/**
 * Media Owners
 * Tracks every user who has "uploaded" a given media row (content-hash dedup
 * means the same S3 object can be shared by multiple uploaders). uploadedBy on
 * the media table stays as the original/latest uploader for audit purposes;
 * this table is the source of truth for "can this user use this attachment".
 */
export const mediaOwners = pgTable(
  'media_owners',
  {
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.mediaId, table.userId] }),
    index('media_owners_user_idx').on(table.userId),
  ]
);
