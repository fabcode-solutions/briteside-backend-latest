import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';

export const courseStatusEnum = pgEnum('course_status', ['draft', 'published', 'archived']);
export const courseEnrollmentStatusEnum = pgEnum('course_enrollment_status', [
  'active',
  'completed',
  'refunded',
]);
export const videoSourceTypeEnum = pgEnum('video_source_type', ['youtube', 'vimeo', 'upload']);

// Courses created by group organisers
export const groupCourses = pgTable(
  'group_courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    thumbnailUrl: text('thumbnail_url'),
    isFree: boolean('is_free').default(true).notNull(),
    price: decimal('price', { precision: 10, scale: 2 }),
    stripeProductId: varchar('stripe_product_id', { length: 255 }),
    stripePriceId: varchar('stripe_price_id', { length: 255 }),
    status: courseStatusEnum('status').default('draft').notNull(),
    // metadata: { level, language, tags, estimatedDuration, prerequisites }
    metadata: jsonb('metadata').$type().default({}),
    totalLessons: integer('total_lessons').default(0).notNull(),
    totalEnrollments: integer('total_enrollments').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('idx_group_courses_group').on(table.groupId),
    index('idx_group_courses_creator').on(table.createdBy),
    index('idx_group_courses_status').on(table.groupId, table.status),
  ]
);

// Chapters within a course. Every lesson belongs to exactly one module —
// existing courses are backfilled with a single "Module 1" (see
// scripts/backfill-course-modules.js) before module_id becomes NOT NULL.
export const groupCourseModules = pgTable(
  'group_course_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => groupCourses.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('idx_group_course_modules_course_order').on(table.courseId, table.sortOrder)]
);

// Video lessons belonging to a module
export const groupCourseLessons = pgTable(
  'group_course_lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => groupCourses.id, { onDelete: 'cascade' }),
    // Nullable until scripts/backfill-course-modules.js has run against a given
    // database and every existing lesson has been assigned a module — then
    // flip this to .notNull() and push/migrate again. See that script's header.
    moduleId: uuid('module_id').references(() => groupCourseModules.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    videoUrl: text('video_url'),
    videoSourceType: videoSourceTypeEnum('video_source_type'),
    thumbnailUrl: text('thumbnail_url'),
    duration: integer('duration').default(0),
    sortOrder: integer('sort_order').default(0).notNull(),
    isPublished: boolean('is_published').default(true).notNull(),
    isFreePreview: boolean('is_free_preview').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_course_lessons_course').on(table.courseId),
    index('idx_group_course_lessons_order').on(table.courseId, table.sortOrder),
    index('idx_group_course_lessons_module_order').on(table.moduleId, table.sortOrder),
  ]
);

// Downloadable files (worksheets, slides, etc.) attached to a lesson
export const groupCourseLessonAttachments = pgTable(
  'group_course_lesson_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => groupCourseLessons.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileType: varchar('file_type', { length: 50 }),
    size: integer('size'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_group_course_lesson_attachments_lesson').on(table.lessonId, table.sortOrder),
  ]
);

// Members enrolling in a course (free or paid)
export const groupCourseEnrollments = pgTable(
  'group_course_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => groupCourses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: courseEnrollmentStatusEnum('status').default('active').notNull(),
    amountPaid: decimal('amount_paid', { precision: 10, scale: 2 }).default('0').notNull(),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    uniqueIndex('idx_course_enrollments_unique').on(table.courseId, table.userId),
    index('idx_course_enrollments_user').on(table.userId),
    index('idx_course_enrollments_course').on(table.courseId),
  ]
);

// Per-lesson progress for each enrolled member
export const groupCourseLessonProgress = pgTable(
  'group_course_lesson_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => groupCourseEnrollments.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => groupCourseLessons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchedSeconds: integer('watched_seconds').default(0).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    uniqueIndex('idx_lesson_progress_unique').on(table.enrollmentId, table.lessonId),
    index('idx_lesson_progress_enrollment').on(table.enrollmentId),
    index('idx_lesson_progress_user').on(table.userId),
    index('idx_lesson_progress_lesson').on(table.lessonId),
  ]
);
