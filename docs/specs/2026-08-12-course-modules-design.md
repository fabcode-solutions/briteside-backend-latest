# Course Modules, Lesson Attachments & Video Upload — Design

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning
**Repos affected:** `gokyro-api` (backend), `gokiro-web-app` (frontend)

## Problem

Group Courses currently model lessons as a flat list directly on a course (`group_courses` → `group_course_lessons`, ordered only by `sort_order`). The client compared this to Skool and asked for a proper chapter structure:

- Organizer creates **modules** (chapters), each with a title.
- Organizer creates any number of **lessons** within a module.
- Organizer creates any number of **modules** within a course.
- Lessons support uploading a **video file**, in addition to the existing YouTube/Vimeo URL embed.
- Lessons support uploading **documents / other file types** as downloadable attachments.
- Course **cover image** must be visible (already implemented in `CourseDetails.tsx`; verify only, no schema change).

This spec covers the Course subsystem only. A separate Services API (bookable/sellable service listings) is out of scope here and will get its own design.

## Data Model

### New table: `group_course_modules`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `course_id` | uuid | FK → `group_courses.id`, cascade |
| `title` | varchar(255) | not null |
| `description` | text | nullable |
| `sort_order` | integer | default 0 |
| `created_at` / `updated_at` | timestamp | |

### `group_course_lessons` — additive changes

| Column | Type | Notes |
|---|---|---|
| `module_id` | uuid | FK → `group_course_modules.id`, cascade. **Not nullable** after backfill. |
| `video_source_type` | enum(`youtube`, `vimeo`, `upload`) | nullable; set whenever `video_url` is set |

### New table: `group_course_lesson_attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `lesson_id` | uuid | FK → `group_course_lessons.id`, cascade |
| `title` | varchar(255) | display name shown to learners |
| `file_url` | text | URL returned by `/api/upload` |
| `file_type` | varchar(50) | mime type or extension |
| `size` | integer | bytes |
| `sort_order` | integer | default 0 |
| `created_at` | timestamp | |

### Migration plan

Single transaction:
1. Create `group_course_modules`.
2. Create `group_course_lesson_attachments`.
3. Add `module_id` (nullable) and `video_source_type` to `group_course_lessons`.
4. Backfill: for every existing `group_courses` row, insert one module titled `"Module 1"` with `sort_order = 0`; set `module_id` on all of that course's existing lessons to the new module's id.
5. Alter `group_course_lessons.module_id` to `NOT NULL`.

No backfill needed for `video_source_type` — existing `video_url` values keep working through the existing YouTube/Vimeo regex detection in the frontend (`toEmbedUrl`); the field is simply unset (`null`) for legacy rows and the player falls back to iframe-embed behavior for any lesson where it's null but `video_url` looks like a YouTube/Vimeo URL.

## API Endpoints

All new/changed endpoints are under the existing `groupCourse.route.js` mount (`/groups/:groupId/courses`), matching current auth/ownership patterns (`authMiddleware`, organizer-only via `req.user.id === course.createdBy`).

### Modules

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/:courseId/modules` | organizer | Create module `{title, description?}` |
| PATCH | `/:courseId/modules/:moduleId` | organizer | Update `{title?, description?}` |
| DELETE | `/:courseId/modules/:moduleId` | organizer | Cascade-deletes its lessons/attachments |
| PUT | `/:courseId/modules/reorder` | organizer | `{orders: [{id, sortOrder}]}` |

### Lessons (existing routes, extended payloads)

- `POST /:courseId/lessons` — payload gains required `moduleId`, optional `videoSourceType`
- `PATCH /:courseId/lessons/:lessonId` — payload gains optional `moduleId` (move between modules), `videoSourceType`
- `PUT /:courseId/lessons/reorder` — payload extended to `{orders: [{id, sortOrder, moduleId}]}` so a single call can move a lesson across modules and reorder in one step

### Attachments (new)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/:courseId/lessons/:lessonId/attachments` | organizer | `{title, fileUrl, fileType, size}` — registers a file already uploaded via `/api/upload` |
| DELETE | `/:courseId/lessons/:lessonId/attachments/:attachmentId` | organizer | Remove attachment record (file itself cleaned up by existing media reference-counting) |

### Response shape change

`GET /:courseId` (getCourse) response nests lessons under modules:

```
course.modules: [
  { id, title, description, sortOrder,
    lessons: [
      { id, title, description, videoUrl, videoSourceType, duration, sortOrder,
        isPublished, isFreePreview,
        attachments: [{ id, title, fileUrl, fileType, size, sortOrder }]
      }
    ]
  }
]
```
replacing the current flat `course.lessons`.

## Access Control (fixing an existing gap)

Today, `getCourse` only redacts `videoUrl` server-side for locked lessons (`canAccessVideos || l.isFreePreview` in `groupCourse.service.js`) — `description` is spread from the full lesson row and returned to every caller regardless of enrollment, including anonymous requests, since `GET /:courseId` has no `authMiddleware`. That's a real content leak bypassable by calling the API directly, independent of the frontend's `isLocked` UI logic.

While reshaping `getCourse` for the modules/lessons nesting, apply the same redaction rule already used for `videoUrl` to every field that constitutes real lesson content:

- `description`, `videoUrl`, and every `attachments[]` entry are set to `null`/`[]` for a lesson where `!isFreePreview && !canAccessVideos` (i.e. not free-preview, not enrolled, course isn't free, and — per the existing gap — not the course creator either; this spec also fixes that: the course creator/organizer gets full access regardless of enrollment, checked via `req.user?.id === course.createdBy`).
- `title`, `duration`, `sortOrder`, `isPublished`, `isFreePreview` remain visible to everyone (needed to render the locked lesson list with a lock icon, as `CourseDetails.tsx` already does).
- This redaction rule is centralized in one place in the service (the same spot that already nulls `videoUrl`) so it automatically covers the new module/lesson/attachment nesting — no separate redaction logic needed per field type.

## Upload Flow

Reuse the existing generic `/api/upload` endpoint (multer memory storage, SHA-256 dedup, S3, `media` table) for both lesson video files and lesson attachments — the same two-step pattern already used for course cover images in `CourseDetails.tsx` (`useImageUpload` → `updateCourse({thumbnailUrl})`). No new upload endpoint, no presign flow, no new size/mimetype limits — server-side limits (100MB, existing allow-list) are the enforced ceiling; the frontend file picker's `accept` attribute is UX-only guidance, not a security boundary.

A new `useFileUpload` hook is added on the frontend (mirroring `useImageUpload`'s shape but accepting any file type), rather than generalizing `useImageUpload` itself, to avoid touching existing image-only call sites.

## Frontend Changes (`gokiro-web-app`)

- **`types/course.ts`**: add `CourseModule` type; `CourseLesson` gains `videoSourceType`, `attachments: LessonAttachment[]`; `CourseDetail.lessons` replaced by `CourseDetail.modules`; new payload types for module CRUD/reorder and attachment create.
- **`hooks/useGroupCourses.ts`**: add `useModuleActions(groupId, courseId)`; extend `useLessonActions` for `moduleId`/`videoSourceType`; add `addAttachment`/`deleteAttachment`.
- **`hooks/useFileUpload.ts`** (new): generic file upload hook for video/document uploads via `/api/upload`.
- **`CourseDetails.tsx`**: restructure the flat lesson list into collapsible module sections (module header: title, add-lesson button, drag handle for module reorder; lessons nested inside with drag-reorder extended to move across module boundaries). Lesson add/edit dialog gains a video-source toggle (paste YouTube/Vimeo URL vs. upload a video file) and an attachments sub-list (upload + list with remove). Cover image upload is unchanged — already implemented (`CourseDetails.tsx:426-460`); verify only.
- **`CoursesCard.tsx`**: unchanged structurally. Its flat lesson-title list during group creation still posts lessons that land in an auto-created default module server-side (created by the `createCourse` service, same backfill pattern as migration).

## Error Handling & Validation

- Reject a lesson's `moduleId` that doesn't belong to the same `courseId` (400).
- Locked-lesson content (`description`, `videoUrl`, `attachments`) is redacted server-side per the Access Control section above — verify this with a direct API call (not just the UI) as part of testing, since that's exactly how the original gap was invisible.
- Module delete cascades lessons/attachments; frontend shows a confirmation dialog stating the lesson count that will be removed (reuse `DeleteConfirmationDialog`).
- Reorder endpoints (`modules/reorder`, `lessons/reorder`) validate all referenced IDs belong to the given course before applying changes, atomically.
- Upload limits/mimetypes: enforced entirely by the existing `/api/upload` endpoint; no new limits introduced.

## Testing / Verification

**Backend:** verify migration backfill correctness against a course that already has flat lessons (pre-migration fixture → confirm a "Module 1" is created and all lessons attach to it). Exercise new module/attachment endpoints for auth (non-organizer rejected), cross-course module/lesson validation, and cascade delete behavior.

**Frontend (manual, dev server):** create module → add lesson via YouTube URL → add lesson via uploaded video file → add attachment to a lesson → drag-reorder a lesson across modules → verify learner view (locked/free-preview logic, progress tracking) is unaffected → confirm cover image upload still works in edit mode.

## Out of Scope (explicitly deferred, not part of this spec)

Per the wider Skool-comparison note from the previous developer, the following are real gaps but were not requested by the client for this pass and are not included here: rich-text lesson body editor, drip/scheduled release, subscription-tier gating, sequential unlock/prerequisites enforcement, real video-playback progress tracking, lesson comments, per-member progress table for admins, completion certificates, and gamification/level-gated access. Flag these separately if the client asks.
