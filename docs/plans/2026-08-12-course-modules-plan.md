# Course Modules, Lesson Attachments & Video Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a module (chapter) → lesson hierarchy to Group Courses, lesson video-file upload alongside YouTube/Vimeo embed, per-lesson file attachments, and fix an existing server-side content-leak (locked lesson `description`/attachments not redacted).

**Architecture:** Two new tables (`group_course_modules`, `group_course_lesson_attachments`), two new columns on `group_course_lessons` (`module_id`, `video_source_type`). Backend: extend the existing `GroupCourseService`/`groupCourse.controller.js`/`groupCourse.route.js` trio with module CRUD/reorder and attachment CRUD, rewrite `getCourse` to nest lessons under modules and redact locked content server-side. Frontend: extend `types/course.ts` and `useGroupCourses.ts`, add a new `useFileUpload` hook, restructure `CourseDetails.tsx`'s flat lesson list into collapsible module sections.

**Tech Stack:** Node/Express, Drizzle ORM (Postgres), Next.js/React/TypeScript frontend, existing `/api/upload` endpoint for all file uploads.

## Global Constraints

- Spec doc: `docs/specs/2026-08-12-course-modules-design.md` — every task here traces to a section of it.
- No test framework exists in `gokyro-api` (no jest/vitest/mocha, no `test` script). Every backend task's verification step is a `curl` command run against a local dev server, not an automated test file. Do not introduce a new test framework as part of this plan — out of scope.
- Migrations are generated via `npm run db:generate` (drizzle-kit) from schema file diffs, never hand-written SQL — review the generated file before running `npm run db:migrate`.
- No existing service method in `groupCourse.service.js` uses `db.transaction(...)`; multi-step mutations are sequential `await` calls. This plan introduces `db.transaction` only where the spec requires real atomicity (the backfill script, reorder validation) — don't refactor unrelated existing methods to add transactions.
- All new/changed lesson and module endpoints go under the existing `/groups/:groupId/courses` mount in `groupCourse.route.js`, `authMiddleware`-protected, using the existing `requireCourseOrganiser` helper for organizer-only actions.
- Reuse the existing generic `/api/upload` endpoint for all file uploads (video and documents) — no new upload endpoint, no presign flow.

---

### Task 1: Schema — add modules table, attachments table, lesson columns

**Files:**
- Modify: `src/db/schema/groupCourses.js`
- Modify: `src/db/schema/relations.js:1704-1742` (the four `groupCourse*Relations` blocks)

**Interfaces:**
- Produces: `groupCourseModules` table export, `groupCourseLessonAttachments` table export, `videoSourceTypeEnum` export, `groupCourseLessons.moduleId`/`groupCourseLessons.videoSourceType` columns — all consumed by Task 2 (backfill) and Task 4+ (service layer).

- [ ] **Step 1: Add the new enum and `group_course_modules` table**

In `src/db/schema/groupCourses.js`, after the existing `courseEnrollmentStatusEnum` (around line 23), add:

```js
export const videoSourceTypeEnum = pgEnum('video_source_type', ['youtube', 'vimeo', 'upload']);
```

After the `groupCourses` table definition (after its closing `);` around line 57), add the new table:

```js
export const groupCourseModules = pgTable(
  'group_course_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => groupCourses.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_group_course_modules_course_order').on(table.courseId, table.sortOrder),
  ]
);
```

- [ ] **Step 2: Add `moduleId` and `videoSourceType` columns to `group_course_lessons`**

In the existing `groupCourseLessons` table definition (lines 60-82), add two columns right after `courseId`:

```js
    moduleId: uuid('module_id')
      .notNull()
      .references(() => groupCourseModules.id, { onDelete: 'cascade' }),
```

and, alongside the existing `videoUrl`/`thumbnailUrl` columns:

```js
    videoSourceType: videoSourceTypeEnum('video_source_type'),
```

Note: `moduleId` is declared `.notNull()` here even though existing rows don't have one yet — Task 2's migration splits into two steps (add nullable, backfill, then set not-null) so this is the *end state* of the schema file; the migration sequence handles the transition.

- [ ] **Step 3: Add the `group_course_lesson_attachments` table**

After the `groupCourseLessons` table (after its closing `);`), add:

```js
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
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_group_course_lesson_attachments_lesson').on(table.lessonId, table.sortOrder),
  ]
);
```

- [ ] **Step 4: Update `src/db/schema/relations.js`**

Add a new relations block for the modules table, and wire it into the existing course/lesson relations blocks (lines 1704-1742):

```js
export const groupCourseModulesRelations = relations(groupCourseModules, ({ one, many }) => ({
  course: one(groupCourses, { fields: [groupCourseModules.courseId], references: [groupCourses.id] }),
  lessons: many(groupCourseLessons),
}));

export const groupCourseLessonAttachmentsRelations = relations(groupCourseLessonAttachments, ({ one }) => ({
  lesson: one(groupCourseLessons, { fields: [groupCourseLessonAttachments.lessonId], references: [groupCourseLessons.id] }),
}));
```

Update the existing `groupCoursesRelations` to add `modules: many(groupCourseModules)`, and the existing `groupCourseLessonsRelations` to add `module: one(groupCourseModules, { fields: [groupCourseLessons.moduleId], references: [groupCourseModules.id] })` and `attachments: many(groupCourseLessonAttachments)`.

Also add the two new imports (`groupCourseModules`, `groupCourseLessonAttachments`) to whatever import line at the top of `relations.js` currently imports `groupCourseLessons` etc. from `./groupCourses.js`.

- [ ] **Step 5: Verify the schema file has no syntax errors**

Run: `node --check src/db/schema/groupCourses.js && node --check src/db/schema/relations.js`
Expected: no output (success) from both.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/groupCourses.js src/db/schema/relations.js
git commit -m "feat(courses): add modules and lesson-attachments schema"
```

---

### Task 2: Migration — generate DDL, backfill data, enforce not-null

**Files:**
- Create: `drizzle/<generated>.sql` (via drizzle-kit, name auto-assigned)
- Create: `scripts/backfill-course-modules.js`
- Create: `drizzle/<generated-2>.sql` (second migration, after backfill)

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: a populated `group_course_modules` row per existing course, every existing lesson's `module_id` set, `group_course_lessons.module_id` is `NOT NULL` in the database.

- [ ] **Step 1: Generate the first migration (adds tables/columns, `module_id` nullable)**

Temporarily change `moduleId` in `groupCourseLessons` (Task 1, Step 2) to **not** have `.notNull()` yet — generate the migration with it nullable first, since drizzle-kit can't backfill data itself:

```bash
npm run db:generate
```

Expected: a new file appears in `drizzle/`, e.g. `drizzle/0113_<slug>.sql`, containing `CREATE TYPE "public"."video_source_type"...`, `CREATE TABLE "group_course_modules"...`, `ALTER TABLE "group_course_lessons" ADD COLUMN "module_id" uuid...` (nullable — no `NOT NULL`), `ALTER TABLE "group_course_lessons" ADD COLUMN "video_source_type"...`, `CREATE TABLE "group_course_lesson_attachments"...`, plus the FK constraints and indexes. Open the generated file and confirm `module_id` has no `NOT NULL` in this migration.

- [ ] **Step 2: Run the first migration**

```bash
npm run db:migrate
```

Expected: command completes without error; the four schema objects exist in the dev database.

- [ ] **Step 3: Write the backfill script**

```js
// scripts/backfill-course-modules.js
import { db } from '../src/db/index.js';
import { groupCourses, groupCourseModules, groupCourseLessons } from '../src/db/schema/groupCourses.js';
import { eq, isNull } from 'drizzle-orm';

async function backfill() {
  const courses = await db.query.groupCourses.findMany({
    columns: { id: true },
  });

  let migrated = 0;
  for (const course of courses) {
    const existingLessons = await db.query.groupCourseLessons.findMany({
      where: eq(groupCourseLessons.courseId, course.id),
    });
    if (existingLessons.length === 0) continue;

    await db.transaction(async tx => {
      const [module] = await tx
        .insert(groupCourseModules)
        .values({ courseId: course.id, title: 'Module 1', sortOrder: 0 })
        .returning();

      for (const lesson of existingLessons) {
        await tx
          .update(groupCourseLessons)
          .set({ moduleId: module.id })
          .where(eq(groupCourseLessons.id, lesson.id));
      }
    });
    migrated++;
  }

  console.log(`Backfilled ${migrated} course(s) with a default module.`);
  process.exit(0);
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the backfill script against the dev database**

```bash
node scripts/backfill-course-modules.js
```

Expected: prints `Backfilled N course(s) with a default module.` with `N` matching the number of courses that had at least one lesson.

- [ ] **Step 5: Verify backfill correctness manually**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM group_course_lessons WHERE module_id IS NULL;"
```

Expected: `0` (every existing lesson now has a `module_id`). If any courses had zero lessons, they correctly have zero modules too — that's fine, an empty course.

- [ ] **Step 6: Set `module_id` to `NOT NULL` and generate the second migration**

Now edit `src/db/schema/groupCourses.js` to add `.notNull()` to `moduleId` (the Task 1 Step 2 code block as originally written). Then:

```bash
npm run db:generate
```

Expected: a new migration file containing `ALTER TABLE "group_course_lessons" ALTER COLUMN "module_id" SET NOT NULL;`. Run it:

```bash
npm run db:migrate
```

Expected: succeeds because Step 5 already confirmed no NULLs remain.

- [ ] **Step 7: Commit**

```bash
git add drizzle/ scripts/backfill-course-modules.js src/db/schema/groupCourses.js
git commit -m "feat(courses): migrate schema for modules/attachments, backfill default modules"
```

---

### Task 3: Service — module CRUD and reorder

**Files:**
- Modify: `src/services/groupCourse.service.js`

**Interfaces:**
- Consumes: `requireCourseOrganiser(courseId, userId)` (existing, line 25), `groupCourseModules` (Task 1).
- Produces: `GroupCourseService.createModule(courseId, userId, {title, description})`, `updateModule(moduleId, courseId, userId, {title?, description?})`, `deleteModule(moduleId, courseId, userId)`, `reorderModules(courseId, userId, orders)` — all consumed by Task 5 (controller).

- [ ] **Step 1: Add `import { groupCourseModules, groupCourseLessonAttachments } from '../db/schema/groupCourses.js';`** to the existing import block (line 6-11).

- [ ] **Step 2: Add `createModule`**

Add as a new static method on `GroupCourseService`, near `addLesson`:

```js
static async createModule(courseId, userId, data) {
  await requireCourseOrganiser(courseId, userId);
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql`COALESCE(MAX(${groupCourseModules.sortOrder}), -1)` })
    .from(groupCourseModules)
    .where(eq(groupCourseModules.courseId, courseId));

  const [module] = await db
    .insert(groupCourseModules)
    .values({
      courseId,
      title: data.title,
      description: data.description ?? null,
      sortOrder: Number(maxOrder) + 1,
    })
    .returning();
  return module;
}
```

- [ ] **Step 3: Add `updateModule`**

```js
static async updateModule(moduleId, courseId, userId, data) {
  await requireCourseOrganiser(courseId, userId);
  const patch = { updatedAt: new Date() };
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;

  const [module] = await db
    .update(groupCourseModules)
    .set(patch)
    .where(and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)))
    .returning();
  if (!module) throw new ApiError(404, 'Module not found');
  return module;
}
```

- [ ] **Step 4: Add `deleteModule`**

```js
static async deleteModule(moduleId, courseId, userId) {
  await requireCourseOrganiser(courseId, userId);
  const [deleted] = await db
    .delete(groupCourseModules)
    .where(and(eq(groupCourseModules.id, moduleId), eq(groupCourseModules.courseId, courseId)))
    .returning();
  if (!deleted) throw new ApiError(404, 'Module not found');
  return { deleted: true };
}
```

(Cascade on `group_course_lessons.module_id` FK removes its lessons and, transitively, their attachments — enforced at the DB level by the `onDelete: 'cascade'` set in Task 1.)

- [ ] **Step 5: Add `reorderModules`**

```js
static async reorderModules(courseId, userId, orders) {
  await requireCourseOrganiser(courseId, userId);
  const ids = orders.map(o => o.id);
  const existing = await db.query.groupCourseModules.findMany({
    where: and(eq(groupCourseModules.courseId, courseId), inArray(groupCourseModules.id, ids)),
    columns: { id: true },
  });
  if (existing.length !== ids.length) {
    throw new ApiError(400, 'One or more modules do not belong to this course');
  }

  await db.transaction(async tx => {
    for (const { id, sortOrder } of orders) {
      await tx
        .update(groupCourseModules)
        .set({ sortOrder, updatedAt: new Date() })
        .where(and(eq(groupCourseModules.id, id), eq(groupCourseModules.courseId, courseId)));
    }
  });
  return { reordered: true };
}
```

Add `inArray` to the existing `drizzle-orm` import line (line 4): `import { eq, and, desc, asc, count, sum, sql, isNull, inArray } from 'drizzle-orm';`

- [ ] **Step 6: Verify no syntax errors**

Run: `node --check src/services/groupCourse.service.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/services/groupCourse.service.js
git commit -m "feat(courses): add module CRUD and reorder to GroupCourseService"
```

---

### Task 4: Service — extend lessons for modules/video source, add attachment methods, fix `getCourse`

**Files:**
- Modify: `src/services/groupCourse.service.js`

**Interfaces:**
- Consumes: Task 3's module methods (for cross-course validation pattern reuse).
- Produces: updated `addLesson`/`updateLesson`/`reorderLessons` signatures, `addAttachment(lessonId, courseId, userId, {title, fileUrl, fileType, size})`, `deleteAttachment(attachmentId, lessonId, courseId, userId)`, rewritten `getCourse(courseId, userId)` returning `modules[].lessons[].attachments[]` with server-side redaction — consumed by Task 5 (controller) and the frontend (Task 8+).

- [ ] **Step 1: Update `addLesson` to require and validate `moduleId`**

Replace the existing `addLesson` (lines 246-280) body's lesson-insert section so it validates the module belongs to the course before inserting, and accepts `videoSourceType`:

```js
static async addLesson(courseId, userId, data) {
  await requireCourseOrganiser(courseId, userId);

  const module = await db.query.groupCourseModules.findFirst({
    where: and(eq(groupCourseModules.id, data.moduleId), eq(groupCourseModules.courseId, courseId)),
  });
  if (!module) throw new ApiError(400, 'moduleId does not belong to this course');

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql`COALESCE(MAX(${groupCourseLessons.sortOrder}), -1)` })
    .from(groupCourseLessons)
    .where(eq(groupCourseLessons.moduleId, data.moduleId));

  const [lesson] = await db
    .insert(groupCourseLessons)
    .values({
      courseId,
      moduleId: data.moduleId,
      title: data.title,
      description: data.description ?? null,
      videoUrl: data.videoUrl ?? null,
      videoSourceType: data.videoSourceType ?? null,
      duration: data.duration ?? 0,
      isFreePreview: !!data.isFreePreview,
      sortOrder: Number(maxOrder) + 1,
    })
    .returning();

  await db
    .update(groupCourses)
    .set({ totalLessons: sql`${groupCourses.totalLessons} + 1` })
    .where(eq(groupCourses.id, courseId));

  return { ...lesson, attachments: [] };
}
```

- [ ] **Step 2: Update `updateLesson` to allow `moduleId` and `videoSourceType` in the patch**

In the existing `updateLesson` (lines 282-307), add to the `patch`-building block:

```js
if (data.moduleId !== undefined) {
  const module = await db.query.groupCourseModules.findFirst({
    where: and(eq(groupCourseModules.id, data.moduleId), eq(groupCourseModules.courseId, courseId)),
  });
  if (!module) throw new ApiError(400, 'moduleId does not belong to this course');
  patch.moduleId = data.moduleId;
}
if (data.videoSourceType !== undefined) patch.videoSourceType = data.videoSourceType;
```

(`courseId` must already be in scope in `updateLesson` — confirm it's a parameter; if the existing signature is `updateLesson(lessonId, courseId, userId, data)` per the controller call in `groupCourse.controller.js:68`, it already is.)

- [ ] **Step 3: Update `reorderLessons` for the extended `{id, sortOrder, moduleId}` payload**

Replace the existing `reorderLessons` (lines 324-337):

```js
static async reorderLessons(courseId, userId, orders) {
  await requireCourseOrganiser(courseId, userId);

  const moduleIds = [...new Set(orders.map(o => o.moduleId))];
  const existingModules = await db.query.groupCourseModules.findMany({
    where: and(eq(groupCourseModules.courseId, courseId), inArray(groupCourseModules.id, moduleIds)),
    columns: { id: true },
  });
  if (existingModules.length !== moduleIds.length) {
    throw new ApiError(400, 'One or more modules do not belong to this course');
  }

  await db.transaction(async tx => {
    for (const { id, sortOrder, moduleId } of orders) {
      await tx
        .update(groupCourseLessons)
        .set({ sortOrder, moduleId, updatedAt: new Date() })
        .where(and(eq(groupCourseLessons.id, id), eq(groupCourseLessons.courseId, courseId)));
    }
  });
  return { reordered: true };
}
```

- [ ] **Step 4: Add `addAttachment` and `deleteAttachment`**

```js
static async addAttachment(lessonId, courseId, userId, data) {
  await requireCourseOrganiser(courseId, userId);
  const lesson = await db.query.groupCourseLessons.findFirst({
    where: and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)),
  });
  if (!lesson) throw new ApiError(404, 'Lesson not found');

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql`COALESCE(MAX(${groupCourseLessonAttachments.sortOrder}), -1)` })
    .from(groupCourseLessonAttachments)
    .where(eq(groupCourseLessonAttachments.lessonId, lessonId));

  const [attachment] = await db
    .insert(groupCourseLessonAttachments)
    .values({
      lessonId,
      title: data.title,
      fileUrl: data.fileUrl,
      fileType: data.fileType ?? null,
      size: data.size ?? null,
      sortOrder: Number(maxOrder) + 1,
    })
    .returning();
  return attachment;
}

static async deleteAttachment(attachmentId, lessonId, courseId, userId) {
  await requireCourseOrganiser(courseId, userId);
  const lesson = await db.query.groupCourseLessons.findFirst({
    where: and(eq(groupCourseLessons.id, lessonId), eq(groupCourseLessons.courseId, courseId)),
  });
  if (!lesson) throw new ApiError(404, 'Lesson not found');

  const [deleted] = await db
    .delete(groupCourseLessonAttachments)
    .where(and(eq(groupCourseLessonAttachments.id, attachmentId), eq(groupCourseLessonAttachments.lessonId, lessonId)))
    .returning();
  if (!deleted) throw new ApiError(404, 'Attachment not found');
  return { deleted: true };
}
```

- [ ] **Step 5: Rewrite `getCourse` — nest modules, redact locked content, fix creator access**

Replace the existing `getCourse` (lines 214-240) entirely:

```js
static async getCourse(courseId, userId) {
  const course = await db.query.groupCourses.findFirst({
    where: and(eq(groupCourses.id, courseId), isNull(groupCourses.deletedAt)),
    with: {
      createdBy: { columns: { id: true, firstName: true, lastName: true, image: true } },
      modules: {
        orderBy: [asc(groupCourseModules.sortOrder)],
        with: {
          lessons: {
            where: eq(groupCourseLessons.isPublished, true),
            orderBy: [asc(groupCourseLessons.sortOrder)],
            with: {
              attachments: { orderBy: [asc(groupCourseLessonAttachments.sortOrder)] },
            },
          },
        },
      },
    },
  });
  if (!course) throw new ApiError(404, 'Course not found');

  let enrollment = null;
  if (userId) enrollment = await getEnrollment(courseId, userId);
  const isCreator = !!userId && userId === course.createdBy.id;
  const canAccessFull = isCreator || course.isFree || !!enrollment;

  return {
    ...course,
    modules: course.modules.map(module => ({
      ...module,
      lessons: module.lessons.map(l => {
        const unlocked = canAccessFull || l.isFreePreview;
        return {
          ...l,
          description: unlocked ? l.description : null,
          videoUrl: unlocked ? l.videoUrl : null,
          attachments: unlocked ? l.attachments : [],
        };
      }),
    })),
    isEnrolled: !!enrollment,
  };
}
```

- [ ] **Step 6: Verify no syntax errors**

Run: `node --check src/services/groupCourse.service.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/services/groupCourse.service.js
git commit -m "feat(courses): module-aware lessons, attachments, redact locked content in getCourse"
```

---

### Task 5: Controller and routes — module and attachment endpoints

**Files:**
- Modify: `src/controllers/groupCourse.controller.js`
- Modify: `src/routes/groupCourse.route.js`

**Interfaces:**
- Consumes: Task 3 and Task 4's service methods.
- Produces: `POST/PATCH/DELETE /:courseId/modules[/:moduleId]`, `PUT /:courseId/modules/reorder`, `POST/DELETE /:courseId/lessons/:lessonId/attachments[/:attachmentId]`.

- [ ] **Step 1: Add module controller functions**

In `src/controllers/groupCourse.controller.js`, after the existing `reorderLessons` export (line 84), add:

```js
export const createModule = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const module = await GroupCourseService.createModule(courseId, req.user.id, req.body);
  res.status(201).json({ success: true, data: module });
});

export const updateModule = catchAsync(async (req, res) => {
  const { courseId, moduleId } = req.params;
  const module = await GroupCourseService.updateModule(moduleId, courseId, req.user.id, req.body);
  res.json({ success: true, data: module });
});

export const deleteModule = catchAsync(async (req, res) => {
  const { courseId, moduleId } = req.params;
  await GroupCourseService.deleteModule(moduleId, courseId, req.user.id);
  res.json({ success: true, message: 'Module deleted' });
});

export const reorderModules = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const { orders } = req.body;
  if (!Array.isArray(orders)) throw new ApiError(400, 'orders must be an array');
  await GroupCourseService.reorderModules(courseId, req.user.id, orders);
  res.json({ success: true, message: 'Modules reordered' });
});

export const addAttachment = catchAsync(async (req, res) => {
  const { courseId, lessonId } = req.params;
  const attachment = await GroupCourseService.addAttachment(lessonId, courseId, req.user.id, req.body);
  res.status(201).json({ success: true, data: attachment });
});

export const deleteAttachment = catchAsync(async (req, res) => {
  const { courseId, lessonId, attachmentId } = req.params;
  await GroupCourseService.deleteAttachment(attachmentId, lessonId, courseId, req.user.id);
  res.json({ success: true, message: 'Attachment deleted' });
});
```

- [ ] **Step 2: Wire up routes**

In `src/routes/groupCourse.route.js`, add the new imports to the existing import block, and add routes after the existing lesson routes (after line 51, before the enrollment section):

```js
// Modules (organiser)
router.post('/:courseId/modules', authMiddleware, createModule);
router.patch('/:courseId/modules/:moduleId', authMiddleware, updateModule);
router.delete('/:courseId/modules/:moduleId', authMiddleware, deleteModule);
router.put('/:courseId/modules/reorder', authMiddleware, reorderModules);

// Lesson attachments (organiser)
router.post('/:courseId/lessons/:lessonId/attachments', authMiddleware, addAttachment);
router.delete('/:courseId/lessons/:lessonId/attachments/:attachmentId', authMiddleware, deleteAttachment);
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check src/controllers/groupCourse.controller.js && node --check src/routes/groupCourse.route.js`
Expected: no output from both.

- [ ] **Step 4: Start the dev server and manually verify the new endpoints**

Run: `npm run dev` (in one terminal), then in another, using a valid organizer session cookie/token and an existing `courseId`:

```bash
curl -X POST http://localhost:<port>/api/groups/<groupId>/courses/<courseId>/modules \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"title": "Module 2"}'
```
Expected: `201` with `{"success":true,"data":{"id":"...","title":"Module 2",...}}`.

```bash
curl http://localhost:<port>/api/groups/<groupId>/courses/<courseId>
```
Expected: response body has `modules: [...]` (not `lessons: [...]` at the top level), each module has a nested `lessons` array, each lesson has an `attachments` array.

- [ ] **Step 5: Manually verify the access-control fix**

As an anonymous/non-enrolled request (no `Authorization` header, or a different user's token) against a paid, non-free course with a locked (non-free-preview) lesson:

```bash
curl http://localhost:<port>/api/groups/<groupId>/courses/<paidCourseId>
```
Expected: the locked lesson's `description` is `null`, `videoUrl` is `null`, `attachments` is `[]` — **not** the real content. This confirms the redaction fix from the spec's Access Control section actually works via direct API call, not just hidden in the UI.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/groupCourse.controller.js src/routes/groupCourse.route.js
git commit -m "feat(courses): expose module and attachment endpoints"
```

---

### Task 6: Frontend types — `types/course.ts`

**Files:**
- Modify: `gokiro-web-app/src/types/course.ts`

**Interfaces:**
- Produces: `CourseModule`, `LessonAttachment`, updated `CourseLesson`/`CourseDetail`, new payload types — consumed by Task 7 (hooks) and Task 9+ (UI).

- [ ] **Step 1: Add `LessonAttachment` and `VideoSourceType`**

At the top of `types/course.ts`, after the existing `EnrollmentStatus` type (line 2):

```ts
export type VideoSourceType = 'youtube' | 'vimeo' | 'upload';

export interface LessonAttachment {
  id: string;
  title: string;
  fileUrl: string;
  fileType: string | null;
  size: number | null;
  sortOrder: number;
}
```

- [ ] **Step 2: Update `CourseLesson`, add `CourseModule`, update `CourseDetail`**

Replace the existing `CourseLesson` interface (lines 36-47) — add two fields:

```ts
export interface CourseLesson {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  videoSourceType: VideoSourceType | null;
  thumbnailUrl: string | null;
  /** Duration in seconds */
  duration: number;
  sortOrder: number;
  isPublished: boolean;
  isFreePreview: boolean;
  attachments: LessonAttachment[];
}

export interface CourseModule {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  lessons: CourseLesson[];
}
```

Replace the existing `CourseDetail` interface (lines 49-51):

```ts
export interface CourseDetail extends Course {
  modules: CourseModule[];
}
```

- [ ] **Step 3: Add module/attachment payload types**

After the existing `CreateLessonPayload`/`UpdateLessonPayload` (lines 145-162), add:

```ts
export interface CreateModulePayload {
  title: string;
  description?: string;
}

export interface UpdateModulePayload {
  title?: string;
  description?: string;
}

export interface ReorderModulesPayload {
  orders: { id: string; sortOrder: number }[];
}

export interface ReorderLessonsPayload {
  orders: { id: string; sortOrder: number; moduleId: string }[];
}

export interface CreateAttachmentPayload {
  title: string;
  fileUrl: string;
  fileType?: string;
  size?: number;
}
```

Update `CreateLessonPayload` (lines 145-152) to require `moduleId` and accept `videoSourceType`:

```ts
export interface CreateLessonPayload {
  moduleId: string;
  title: string;
  description?: string;
  videoUrl?: string;
  videoSourceType?: VideoSourceType;
  duration?: number;
  isFreePreview?: boolean;
  sortOrder?: number;
}
```

Update `UpdateLessonPayload` (lines 154-162) to add `moduleId?: string` and `videoSourceType?: VideoSourceType`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd gokiro-web-app && npx tsc --noEmit` — expect errors in `CourseDetails.tsx` (Task 9 fixes those) but no errors in `types/course.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add gokiro-web-app/src/types/course.ts
git commit -m "feat(courses): add module/attachment types"
```

---

### Task 7: Frontend hooks — `useModuleActions`, extended `useLessonActions`, attachments

**Files:**
- Modify: `gokiro-web-app/src/hooks/useGroupCourses.ts`

**Interfaces:**
- Consumes: Task 6's types.
- Produces: `useModuleActions(groupId, courseId)` returning `{loading, createModule, updateModule, deleteModule, reorderModules}`; `useLessonActions` gains `reorderLessons`, `addAttachment`, `deleteAttachment`.

- [ ] **Step 1: Add `useModuleActions`**

After the existing `useLessonActions` export (ends around line 263), add:

```ts
export const useModuleActions = (groupId: string, courseId: string) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const createModule = useCallback(
    async (payload: CreateModulePayload): Promise<CourseModule | null> => {
      try {
        setLoading(true);
        const res = await apiClient.post(`/groups/${groupId}/courses/${courseId}/modules`, payload);
        const module = res.data as CourseModule;
        toast.success('Module Added', `"${module.title}" has been added.`);
        return { ...module, lessons: [] };
      } catch (err: unknown) {
        toast.error('Error', err instanceof Error ? err.message : 'Failed to add module');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [groupId, courseId]
  );

  const updateModule = useCallback(
    async (moduleId: string, payload: UpdateModulePayload): Promise<CourseModule | null> => {
      try {
        setLoading(true);
        const res = await apiClient.patch(
          `/groups/${groupId}/courses/${courseId}/modules/${moduleId}`,
          payload
        );
        toast.success('Module Updated');
        return res.data as CourseModule;
      } catch (err: unknown) {
        toast.error('Error', err instanceof Error ? err.message : 'Failed to update module');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [groupId, courseId]
  );

  const deleteModule = useCallback(
    async (moduleId: string): Promise<boolean> => {
      try {
        setLoading(true);
        await apiClient.delete(`/groups/${groupId}/courses/${courseId}/modules/${moduleId}`);
        toast.success('Module Deleted');
        return true;
      } catch (err: unknown) {
        toast.error('Error', err instanceof Error ? err.message : 'Failed to delete module');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [groupId, courseId]
  );

  const reorderModules = useCallback(
    async (payload: ReorderModulesPayload): Promise<boolean> => {
      try {
        await apiClient.put(`/groups/${groupId}/courses/${courseId}/modules/reorder`, payload);
        return true;
      } catch {
        toast.error('Error', 'Failed to reorder modules');
        return false;
      }
    },
    [groupId, courseId]
  );

  return { loading, createModule, updateModule, deleteModule, reorderModules };
};
```

- [ ] **Step 2: Add `reorderLessons`, `addAttachment`, `deleteAttachment` to `useLessonActions`**

In the existing `useLessonActions` (lines 202-263), add three more callbacks before the final `return`:

```ts
  const reorderLessons = useCallback(
    async (payload: ReorderLessonsPayload): Promise<boolean> => {
      try {
        await apiClient.put(`/groups/${groupId}/courses/${courseId}/lessons/reorder`, payload);
        return true;
      } catch {
        toast.error('Error', 'Failed to reorder lessons');
        return false;
      }
    },
    [groupId, courseId]
  );

  const addAttachment = useCallback(
    async (lessonId: string, payload: CreateAttachmentPayload): Promise<LessonAttachment | null> => {
      try {
        setLoading(true);
        const res = await apiClient.post(
          `/groups/${groupId}/courses/${courseId}/lessons/${lessonId}/attachments`,
          payload
        );
        return res.data as LessonAttachment;
      } catch (err: unknown) {
        toast.error('Error', err instanceof Error ? err.message : 'Failed to add attachment');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [groupId, courseId]
  );

  const deleteAttachment = useCallback(
    async (lessonId: string, attachmentId: string): Promise<boolean> => {
      try {
        await apiClient.delete(
          `/groups/${groupId}/courses/${courseId}/lessons/${lessonId}/attachments/${attachmentId}`
        );
        return true;
      } catch {
        toast.error('Error', 'Failed to delete attachment');
        return false;
      }
    },
    [groupId, courseId]
  );
```

Update the `return` statement to include `reorderLessons, addAttachment, deleteAttachment`.

- [ ] **Step 3: Update the import block**

Add `CourseModule`, `CreateModulePayload`, `UpdateModulePayload`, `ReorderModulesPayload`, `ReorderLessonsPayload`, `CreateAttachmentPayload`, `LessonAttachment` to the existing `import type {...} from '@/types/course'` block (lines 5-18).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd gokiro-web-app && npx tsc --noEmit` — expect the same remaining `CourseDetails.tsx` errors as Task 6, nothing new from this file.

- [ ] **Step 5: Commit**

```bash
git add gokiro-web-app/src/hooks/useGroupCourses.ts
git commit -m "feat(courses): add module actions, extend lesson actions with reorder/attachments"
```

---

### Task 8: Frontend — new `useFileUpload` hook

**Files:**
- Create: `gokiro-web-app/src/hooks/useFileUpload.ts`
- Reference: `gokiro-web-app/src/hooks/useImageUpload.ts` (read it first to match its exact shape/error-handling style)

**Interfaces:**
- Produces: `useFileUpload()` returning `{ uploadFile: (file: File, folder: string) => Promise<{url: string, fileType: string, size: number}>, uploading: boolean }` — consumed by Task 9/10 (lesson dialog video/attachment upload).

- [ ] **Step 1: Read `useImageUpload.ts` to confirm its exact call signature and error style**

Run: read the file, note whether it posts to `/api/upload` directly or via `apiClient`, and how it surfaces errors (thrown vs. returned null) so `useFileUpload` matches the same convention.

- [ ] **Step 2: Write `useFileUpload.ts`**

```ts
import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface UploadedFile {
  url: string;
  fileType: string;
  size: number;
  fileName: string;
}

export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);

  const uploadFile = useCallback(async (file: File, folder: string): Promise<UploadedFile> => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);
      const res = await apiClient.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = res.data.data;
      return {
        url: data.url,
        fileType: data.mimetype,
        size: data.size,
        fileName: data.originalName,
      };
    } finally {
      setUploading(false);
    }
  }, []);

  return { uploadFile, uploading };
};
```

(Field names `url`/`mimetype`/`size`/`originalName` match the confirmed `/api/upload` response shape from `upload.service.js` lines 199-210.)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd gokiro-web-app && npx tsc --noEmit` — no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add gokiro-web-app/src/hooks/useFileUpload.ts
git commit -m "feat(courses): add generic useFileUpload hook for video/attachment uploads"
```

---

### Task 9: Frontend — `CourseDetails.tsx` module-aware state and read-only rendering

**Files:**
- Modify: `gokiro-web-app/src/components/groups/CourseDetails.tsx`

**Interfaces:**
- Consumes: Task 6 types, Task 7 `useModuleActions`.
- Produces: page renders modules with nested lessons (no editing yet — that's Task 10).

- [ ] **Step 1: Replace flat `lessons` state with `modules` state**

Replace lines 139 (`const [lessons, setLessons] = useState<CourseLesson[]>([]);`) with:

```tsx
const [modules, setModules] = useState<CourseModule[]>([]);
```

Replace the `useEffect` at lines 167-174 that sorts and sets `lessons`:

```tsx
useEffect(() => {
  if (course) {
    const sortedModules = [...course.modules]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(m => ({ ...m, lessons: [...m.lessons].sort((a, b) => a.sortOrder - b.sortOrder) }));
    setModules(sortedModules);
    setCourseTitle(course.title);
    setCourseDescription(course.description ?? '');
  }
}, [course]);
```

- [ ] **Step 2: Add `useModuleActions` alongside the existing hooks**

Near line 132-137 where `useLessonActions` is called, add:

```tsx
const {
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
  loading: moduleLoading,
} = useModuleActions(groupId, courseId);
```

Import it: add `useModuleActions` to the existing `import { useCourseDetail, useCourseProgress, useCourseActions, useLessonActions } from '@/hooks/useGroupCourses';` (line 45-50), and add `CourseModule` to the `import type { CourseLesson } from '@/types/course';` (line 51) as `import type { CourseLesson, CourseModule } from '@/types/course';`.

- [ ] **Step 3: Replace derived counts (`lessons.length`) with flattened equivalents**

Everywhere the file currently reads `lessons.length` (e.g. line 463, 539) or `completedIds.has(lesson.id)` against a flat `lessons.map(...)` (lines 565-716), introduce a flattened helper near the top of the component body:

```tsx
const allLessons = modules.flatMap(m => m.lessons);
```

Replace `lessons.length` with `allLessons.length`, and replace the lesson-rendering block's `lessons.map((lesson, idx) => {...})` (line 565) with a two-level render: outer `.map` over `modules`, inner `.map` over `module.lessons`, using a running index for the `idx + 1` numbering shown per lesson (e.g. compute `let runningIndex = 0` before the modules map and increment it inside the inner map, or use `allLessons.findIndex(l => l.id === lesson.id)` for the number since course sizes are small).

- [ ] **Step 4: Render module headers**

Wrap the existing per-lesson `<div>` block (lines 570-714) inside a per-module section. For each module in `modules`, render a header row (module title, lesson count, and — only in `editMode` — edit/delete icon buttons wired to `updateModule`/`deleteModule` from Step 2) above that module's lessons, reusing the existing `Card`/`CardContent` wrapper structure already in the file (lines 560-561) — one `Card` per module rather than one shared `Card` for all lessons.

- [ ] **Step 5: Manually verify in the browser**

Run: `cd gokiro-web-app && npm run dev`, open a course detail page as the organizer. Expected: lessons render grouped under a "Module 1" header (from the backfill), matching the original flat list's content and order, just with a module header added. No editing controls need to work yet.

- [ ] **Step 6: Commit**

```bash
git add gokiro-web-app/src/components/groups/CourseDetails.tsx
git commit -m "feat(courses): render lessons nested under modules"
```

---

### Task 10: Frontend — add/edit/delete module UI and cross-module drag reorder

**Files:**
- Modify: `gokiro-web-app/src/components/groups/CourseDetails.tsx`

**Interfaces:**
- Consumes: Task 9's module rendering.
- Produces: "Add Module" button + inline module rename/delete in edit mode; lesson drag-and-drop extended to move a lesson between modules.

- [ ] **Step 1: Add "Add Module" control**

In edit mode, above the modules list (near where "Add Lesson" currently sits at lines 553-557), add an "Add Module" button that opens a small inline input (title only) and calls `createModule({title})` from Task 9's hook wiring, then appends the result to `modules` state on success.

- [ ] **Step 2: Add module rename (inline edit) and delete**

In each module header (from Task 9 Step 4), in edit mode, add a pencil icon that turns the title into an `<Input>` calling `updateModule(moduleId, {title})` on blur/Enter, and a trash icon that opens `DeleteConfirmationDialog` (already imported, line 23) stating how many lessons will be removed (`module.lessons.length`), calling `deleteModule(moduleId)` on confirm and removing it from `modules` state.

- [ ] **Step 3: Extend drag-and-drop to cross module boundaries**

The existing `handleLessonDragStart`/`handleLessonDragOver`/`handleLessonDrop`/`resetDrag` (lines 272-309) operate on a flat `lessons` array. Rewrite `handleLessonDrop` to:
1. Find the source lesson's current `moduleId` and the target lesson's `moduleId` (searching `modules`).
2. Remove the source lesson from its module's `lessons` array and insert it into the target module's `lessons` array at the drop position (same `above`/`below` logic already computed by `handleLessonDragOver`).
3. After updating local `modules` state, call `reorderLessons({ orders: <every lesson in the affected module(s), each with {id, sortOrder: index, moduleId}> })` from Task 7's hook — send both the source and target module's lessons if the lesson moved across modules, or just the one module's lessons if it moved within the same module.

- [ ] **Step 4: Add module-level drag-reorder**

Add a drag handle to each module header (reusing the existing `GripVertical` icon import, line 39) with its own `dragModuleId`/`dropModuleTargetId` state (parallel to the existing lesson drag state), and on drop, reorder the `modules` array locally and call `reorderModules({orders: [...]})` from Task 7.

- [ ] **Step 5: Manually verify in the browser**

As organizer, in edit mode: add a second module, rename it, drag a lesson from Module 1 into it, drag the modules to swap their order, refresh the page and confirm the new arrangement persisted (calls actually saved, not just local state).

- [ ] **Step 6: Commit**

```bash
git add gokiro-web-app/src/components/groups/CourseDetails.tsx
git commit -m "feat(courses): add module management UI and cross-module lesson drag-reorder"
```

---

### Task 11: Frontend — video-source toggle and file upload in the lesson dialog

**Files:**
- Modify: `gokiro-web-app/src/components/groups/CourseDetails.tsx`

**Interfaces:**
- Consumes: Task 8's `useFileUpload`, Task 6's `videoSourceType` field.
- Produces: Add/Edit Lesson dialogs let the organizer choose "Paste a video URL" (YouTube/Vimeo, existing behavior) or "Upload a video file" (new).

- [ ] **Step 1: Add a source toggle to `LessonFormData`-driven state**

The existing `LessonFormData` type (lines 64-72) already has `videoUrl`; add `videoSourceType: VideoSourceType | ''` to it and to `defaultLessonForm` (lines 74-82), defaulting to `''`.

- [ ] **Step 2: Add toggle UI in the Add Lesson dialog**

In the Add Lesson dialog's "Video URL (optional)" section (lines 758-764), add two buttons/tabs above the existing `<Input>`: "Paste URL" and "Upload video". When "Upload video" is selected, hide the URL `<Input>` and show a file picker (`accept="video/*"`) wired to `useFileUpload().uploadFile(file, 'course-videos')`; on success, set `addForm.videoUrl` to the returned `url` and `addForm.videoSourceType` to `'upload'`. When "Paste URL" is selected (default), keep existing behavior and set `videoSourceType` by sniffing the URL (`youtube.com`/`youtu.be` → `'youtube'`, `vimeo.com` → `'vimeo'`) when the form submits.

- [ ] **Step 3: Repeat for the Edit Lesson dialog**

Same toggle added to the Edit Lesson dialog's "Video URL (optional)" section (lines 834-840), pre-selecting "Upload video" vs "Paste URL" based on `editForm.videoSourceType === 'upload'` when the dialog opens.

- [ ] **Step 4: Update `handleAddLesson`/`handleSaveEditLesson` to send `videoSourceType`**

In `handleAddLesson` (lines 208-224) and `handleSaveEditLesson` (lines 239-253), include `videoSourceType: addForm.videoSourceType || undefined` / `editForm.videoSourceType || undefined` in the payload passed to `addLesson`/`updateLesson`.

- [ ] **Step 5: Update the lesson video player to branch on `videoSourceType`**

In the expanded lesson content block (lines 688-703), where `lesson.videoUrl` currently always renders an `<iframe src={toEmbedUrl(lesson.videoUrl)}>`, branch: if `lesson.videoSourceType === 'upload'`, render `<video src={lesson.videoUrl} controls className="w-full h-full" />` instead of the iframe; otherwise keep the existing iframe/`toEmbedUrl` behavior.

- [ ] **Step 6: Manually verify in the browser**

Add a lesson with a pasted YouTube URL — confirm it still embeds and plays as before. Add a second lesson uploading a real video file — confirm it uploads, saves, and plays back via a native `<video>` tag (with scrub bar/controls) rather than an iframe.

- [ ] **Step 7: Commit**

```bash
git add gokiro-web-app/src/components/groups/CourseDetails.tsx
git commit -m "feat(courses): support uploaded video files alongside YouTube/Vimeo embeds"
```

---

### Task 12: Frontend — attachments sub-list in the lesson dialog and expanded view

**Files:**
- Modify: `gokiro-web-app/src/components/groups/CourseDetails.tsx`

**Interfaces:**
- Consumes: Task 7's `addAttachment`/`deleteAttachment`, Task 8's `useFileUpload`.
- Produces: organizer can add/remove any number of file attachments per lesson; enrolled learners see a download list.

- [ ] **Step 1: Add attachments UI to the Edit Lesson dialog**

Attachments only make sense once a lesson exists (they're added via a separate endpoint keyed on `lessonId`), so add this section only to the **Edit** Lesson dialog (not Add) — after `handleAddLesson` creates a lesson, the organizer reopens it via edit to add attachments, OR (better UX, still simple) auto-open the Edit dialog immediately after a successful `handleAddLesson`. Implement the latter: in `handleAddLesson` (Task 11 Step 4), after `setLessons`/`setModules` update succeeds, call `handleOpenEditLesson(newLesson)` instead of just closing the Add dialog.

- [ ] **Step 2: Render the attachments list and upload control**

In the Edit Lesson dialog (after the "Published" switch, around line 869), add:

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">Attachments</label>
  {editingLesson?.attachments?.map(att => (
    <div key={att.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
      <span className="truncate">{att.title}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-destructive"
        onClick={async () => {
          if (!editingLesson) return;
          const ok = await deleteAttachment(editingLesson.id, att.id);
          if (ok) {
            setEditingLesson(prev =>
              prev ? { ...prev, attachments: prev.attachments.filter(a => a.id !== att.id) } : prev
            );
          }
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ))}
  <input
    type="file"
    className="hidden"
    id="lesson-attachment-input"
    onChange={async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !editingLesson) return;
      const uploaded = await uploadFile(file, 'course-attachments');
      const attachment = await addAttachment(editingLesson.id, {
        title: file.name,
        fileUrl: uploaded.url,
        fileType: uploaded.fileType,
        size: uploaded.size,
      });
      if (attachment) {
        setEditingLesson(prev =>
          prev ? { ...prev, attachments: [...prev.attachments, attachment] } : prev
        );
      }
    }}
  />
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => document.getElementById('lesson-attachment-input')?.click()}
  >
    <Upload className="h-4 w-4 mr-1" /> Add Attachment
  </Button>
</div>
```

Import `useFileUpload`'s `uploadFile` and `useLessonActions`'s `deleteAttachment`/`addAttachment` at the top of the component (Task 7/8 already export them; wire into the existing hook-call lines).

- [ ] **Step 3: Render attachments in the learner-facing expanded lesson view**

In the expanded lesson content block (Task 11 Step 5's edit target, lines 688-713), after the description paragraph, add a download list for `lesson.attachments` (each rendered as an `<a href={att.fileUrl} download target="_blank">{att.title}</a>` with a file icon), only shown when `lesson.attachments.length > 0`.

- [ ] **Step 4: Manually verify in the browser**

As organizer: add a lesson, confirm the Edit dialog auto-opens, upload two different files as attachments, confirm both appear in the list, remove one, refresh and confirm only the remaining one persisted. As an enrolled/free-preview learner viewing that lesson: confirm the attachment download links appear and work. As a locked (non-enrolled, non-preview) viewer: confirm attachments do NOT appear (validates the Task 4/5 server-side redaction end-to-end through the UI).

- [ ] **Step 5: Commit**

```bash
git add gokiro-web-app/src/components/groups/CourseDetails.tsx
git commit -m "feat(courses): add per-lesson file attachments UI"
```

---

## Post-Plan Verification Checklist

Run through this end-to-end as the last step, confirming every spec requirement has a working, testable outcome:

- [ ] Organizer can create multiple modules in a course, each with multiple lessons.
- [ ] Organizer can add a lesson with a pasted YouTube URL (still embeds/plays).
- [ ] Organizer can add a lesson with an uploaded video file (plays via native `<video>`).
- [ ] Organizer can attach multiple files to a lesson and remove them.
- [ ] Course cover image upload still works (unchanged from before this plan).
- [ ] Drag-reordering lessons within and across modules persists after a page refresh.
- [ ] Dragging modules to reorder them persists after a page refresh.
- [ ] A non-enrolled, unauthenticated `curl` request to `GET /:courseId` on a paid course returns `null`/`[]` for `description`/`videoUrl`/`attachments` on locked lessons.
- [ ] The course creator sees full content even without an explicit enrollment record.
- [ ] Existing courses created before this migration show their old flat lesson list correctly nested under an auto-created "Module 1".
