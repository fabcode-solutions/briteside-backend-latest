# Platform Services — KT

> Cross-cutting infrastructure features that don't belong to a single business domain: file
> uploads/media storage, transactional/bulk email, the public contact form, universal search,
> sales-demo bookings, and bulk (influencer) media import. See
> [00-project-overview.md](./00-project-overview.md) for the general architecture/conventions this
> doc assumes.

## Overview

"Platform Services" is a grab-bag of six independent sub-features that happen to share
infrastructure (S3, SES) or a "utility" flavor rather than a domain model:

| Sub-feature | What it is |
|---|---|
| **Uploads & Media** | Generic authenticated file upload to S3 with content-hash dedup, reference counting, and a `media` tracking table used by every other module (events, posts, groups, tickets, talent, shop). |
| **Mail** | Two mail primitives: `mail.service.js` (single transactional email via SES `SendEmailCommand`, used everywhere — auth OTP, suspensions, demo confirmations, talent-issue notices) and `bulkMail.service.js` (SES `SendBulkTemplatedEmailCommand`, batches of 50, one retry pass), used by CSV-based bulk invites and event/group blast emails. |
| **Contact Form** | Public "contact us" form. Persists to `contact_messages`, forwards to `admin@briteside.app`, is text-moderated async, and is manageable from the admin console. |
| **Universal Search** | Public, unauthenticated, cross-entity search (users + events + groups + talent profiles) via Postgres full-text search. **Distinct from** the social/mention search (`src/services/social/search.service.js`) — see [Universal Search](#universal-search-1) below. |
| **Demo Sessions** | **Sales demo booking**, not a talent-booking session. Admin schedules a GetStream video call (or external meeting link) for prospective customers (event organizers / influencers / group organizers); the public books a slot and gets a confirmation email. Unrelated to talent availability/booking "sessions". |
| **Bulk Import** | "Influencer import" — a user (typically an influencer/creator) uploads up to 60 photos/videos at once (e.g., migrating a portfolio from another platform); each is presigned directly to S3, then a pg-boss worker turns each into a published post on the user's profile. Not a CSV/contacts import. |

Also touched on briefly because they were named in scope: `src/cron/snsTopicCleanup.js` (AWS SNS —
turns out to back **per-event SMS blast topics**, not push notifications — see
[Integrations](#integrations)) and `docs/skimlinks-integration-estimate.md` (an **unbuilt, planned**
affiliate-monetization feature, unrelated to bulk import — see the note at the end of
[Integrations](#integrations)).

## Key Files

### Uploads & Media

| Path | Purpose |
|---|---|
| `src/routes/upload.route.js` | Mounts `/api/upload`. Configures `multer` (memory storage, 100MB limit, mimetype/extension allow-list) and also mounts the bulk-invite CSV endpoint (see Mail below). |
| `src/controllers/upload.controller.js` | `uploadFile` (single/multiple), `deleteFile`, `getUserFiles`. Validates `folder` and basic file shape before calling the service. |
| `src/services/upload.service.js` (`UploadService`) | Core upload logic: file validation, SHA-256 dedup lookup, S3 `PutObjectCommand`, builds the S3 key (`folder/[entityId]/[userId]/filename`), triggers async media moderation for images/videos, delete (soft/permanent), `getUserFiles` query. |
| `src/services/fileManagement.service.js` (`FileManagementService`) | Lower-level S3 + DB helper reused by `UploadService` and the import pipeline: hashing, `findByHash`, `createOrIncrementReference`, `buildPublicUrl` (CDN-aware), batch/individual S3 delete, 30-day grace-period cleanup, `getMediaType` from mimetype. |
| `src/db/schema/fileTracking.js` | Defines the **`media`** table (dedup'd file registry: hash, S3 key/bucket, url, mediaType enum, size, folder, referenceCount, `deletedAt` soft-delete) and **`media_owners`** (many-to-many: which users can "use" a shared/deduped media row). |
| `src/cron/fileCleanup.js` | `cleanupDeletedFiles` (hard-deletes `media` rows soft-deleted 30+ days ago, from S3 + DB) and `cleanupOrphanedReferences` (currently a no-op stub — relies on FK cascades). Also exports `triggerFileCleanup` for manual invocation. |

### Mail

| Path | Purpose |
|---|---|
| `src/services/mail.service.js` | `sendMail` (raw SES `SendEmailCommand` wrapper) plus ~12 pre-built transactional templates: transaction confirmation, general/welcome, OTP, reset-password, username-reservation approved/rejected, suspension/unsuspension, appeal received/reviewed, demo confirmation, talent-issue submitted/resolved/warning. This is the workhorse used by nearly every other module. |
| `src/services/bulkMail.service.js` | `sendBulkTemplatedEmail(templateName, defaultData, recipients)` — SES `SendBulkTemplatedEmailCommand`, chunks recipients into batches of 50 (100ms delay between batches), one retry pass over failures. Requires the named template to already exist in SES (not managed by this repo). |
| `src/controllers/bulkMail.controller.js` | `bulkInviteFromCsv` — parses an uploaded CSV (see [Core Flows](#2-sending-a-transactional-email-vs-a-bulk-email-blast)), looks up the target event/group, builds per-recipient template data, calls `sendBulkTemplatedEmail`. **Not mounted on its own route file** — wired into `upload.route.js` (see [API Endpoints](#mail-1)). |
| `src/cron/emailTemplates.js` | **Not a cron job.** Despite living in `src/cron/`, it only exports HTML/text template builders (`generateEventReminderEmail`, `generateMerchandiseUpsellEmail`, `generatePromotionalEmail`) consumed by `src/services/eventMail.helper.js`, which in turn is used by the actual event-reminder cron jobs (`src/cron/eventReminders.js`, registered in `cronJobs.js`). Belongs conceptually to the Events module; listed here only because the KT scope named it. |
| `src/services/eventMail.helper.js` | Not in original scope, but referenced above for clarity — wraps `mail.service.js`/`bulkMail.service.js` + the templates from `emailTemplates.js` into event-specific senders (published, ticket purchase, reminders, merch upsell, promo). |
| `src/services/social/eventInvitation.service.js` | A **second, separate** consumer of `bulkMail.service.js` — "invite all my followers to this event" from the social/events module (`inviteAllFollowers`, mounted at `/api/events/...`). Not part of Platform Services; mentioned so it isn't confused with `bulkMail.controller.js`. |

### Contact Form

| Path | Purpose |
|---|---|
| `src/routes/contact.route.js` | Mounts `/api/contact`. Public, rate-limited, inline Zod validation. |
| `src/controllers/contact.controller.js` | `sendContactMessage` (public submit), plus admin-only `getContactMessages`, `getContactMessageById`, `updateContactMessageStatus` (mounted under `/api/admin`, see below). |
| `src/services/contact.service.js` (`contactService`) | `createMessage` (persists + fires async text moderation), `getMessages` (paginated/filterable), `getMessageById`, `updateMessageStatus`. |
| `src/db/schema/contactMessages.js` | **`contact_messages`** table: name, email, subject, message, `status` (`new`/`sent`/`failed`/admin-set values), `errorMessage`, timestamps. |

### Universal Search

| Path | Purpose |
|---|---|
| `src/routes/search.route.js` | Mounts `/api/search`. Public, its own tighter rate limiter (60/min prod, fans out to 3 parallel queries). |
| `src/controllers/search.controller.js` | `universalSearch` — thin wrapper, forwards `q`, `limit`, and `viewerId` (from optional auth, but auth isn't actually attached — see gotchas) to the service. |
| `src/services/search.service.js` (`SearchService`) | Cross-entity search: users (always), plus events/groups/talent profiles when the query has real text tokens. Postgres `tsvector`/`to_tsquery` on precomputed search columns (`userSearch`, `eventSearch`, `groupSearch`, `talentSearch`), with block-list filtering. |
| `src/validations/search.validation.js` | `searchQuerySchema` (Zod) — **defined but not wired into the route** (see gotchas). |
| `src/services/social/search.service.js` (`SearchService`, social) | **Different service, same class name** — searches only `users` (ILIKE on username/first/last name), used for in-app @mention/follow-style search, with `forMention` gating on `allowTagging`. Documented in `04-social.md`. Do not confuse with the universal search service above — see the callout below. |

### Demo Sessions

| Path | Purpose |
|---|---|
| `src/routes/demo.route.js` | Mounts `/api/demo-sessions`. Public: `GET /upcoming`, `POST /:sessionId/register`. |
| `src/controllers/demo.controller.js` (`demoController`) | Full CRUD surface (`createSession`, `listSessions`, `updateSession`, `updateStatus`, `deleteSession`, `listRegistrations`, `getUpcoming`, `register`) — the admin-facing half is mounted from `admin.route.js`, not `demo.route.js`. |
| `src/services/demo.service.js` (`DemoSessionService`, `DemoRegistrationService`) | Session CRUD (creates a GetStream video call when `meetingType === 'stream'`, or stores an external link), registration creation + confirmation email. |
| `src/db/schema/demoSessions.js` | **`demo_sessions`**: title/description, `scheduledAt`, duration, `sessionType` (`event`/`influencer`/`group` — sales-vertical tag), `meetingType` (`stream`/`external`), Stream call id/type, invite link, status. |
| `src/db/schema/demoRegistrations.js` | **`demo_registrations`**: FK to session, registrant name/email, `audience` (`event`/`influencer`/`group`), `primaryCategory`, `scaleMetric`, `currentPlatform`, `goals`, status. |
| `src/routes/admin.route.js` (lines ~700–770) | Admin CRUD for demo sessions/registrations — see [API Endpoints](#demo-sessions-1). |

### Bulk Import

| Path | Purpose |
|---|---|
| `src/routes/import.route.js` | Mounts `/api/imports` (route-index comment: "influencer import sessions"). All routes require auth; per-import routes also require `importOwner`. |
| `src/controllers/import.controller.js` | Thin controllers over `ImportService`: status, create, presign, submit, get, get-images, delete. |
| `src/services/imports/import.service.js` (`ImportService`) | Core state machine: `getImportStatus`, `createImport` (one draft per user, DB-enforced), `presignImages` (dedup by hash, quota check, calls `PresignService`), `submitImport` (enqueues one pg-boss job per image, reserves a negative-`displayOrder` block so new posts sort above everything else), `getImport`/`getImportImages`, `deleteImport` (draft-only), `recordImageResult` (called by the worker). |
| `src/services/imports/presign.service.js` (`PresignService`) | Generates S3 pre-signed `PUT` URLs (15 min TTL), scoped key `imports/{userId}/{importId}/{imageId}/{filename}`, restricted content-type allow-list. `verifyUploaded` (HeadObject) exists but isn't currently called anywhere in the flow. |
| `src/db/schema/imports.js` | **`imports`** (one row per batch: status enum `draft→pending→processing→completed/failed`, image counters, one-active-draft-per-user unique index) and **`import_images`** (per-image row: S3 key, hash, caption, `displayOrder`, status enum, `createdPostId` FK to `posts`, `failReason`). |
| `src/middlewares/importOwner.middleware.js` | Loads the import by `:id` + `req.user.id`, 404s if not found/not owned, attaches `req.import`. |
| `src/workers/importWorker.js` | pg-boss worker (`process-import-image` queue, `teamSize: 10`) — turns one `import_images` row into one published `posts` row, registers `userPostOrder`, enqueues async media moderation, updates `import_images`/`imports` status. |
| `src/cron/cleanupStaleImports.js` | Two jobs in one: force-fails imports stuck `pending`/`processing` for 30+ min (crashed worker recovery), and hard-deletes abandoned `draft` imports (+ their S3 objects) older than 2 hours. |
| `src/lib/pgboss.js` | pg-boss client init (shared with the moderation worker). |

### Other (noted per scope, not core Platform Services)

| Path | Purpose |
|---|---|
| `src/cron/snsTopicCleanup.js` | Deletes AWS SNS topics for events whose `endDate` has passed. These topics back **per-event SMS blast subscriptions** (`src/services/blast.service.js`, `src/utils/aws.util.js`), i.e. organizer-to-attendee SMS alerts — **not** GetStream/push-notification infra. See [Integrations](#integrations) for the correction. |
| `docs/skimlinks-integration-estimate.md` | A build **estimate for a not-yet-built** affiliate-monetization feature (wrapping creator outbound links via Skimlinks, revenue split, payouts). Unrelated to bulk import. See the note in [Integrations](#integrations). |

## Data Model

```
media (fileTracking.js)                 media_owners
├── id (uuid, pk)                       ├── mediaId (fk → media.id)
├── fileHash (sha256, unique)  ─────┐   └── userId (fk → users.id)
├── s3Key (unique), s3Bucket        │        (composite pk; "who may use this file")
├── url                             │
├── mediaType enum (image/video/    │
│   audio/document)                 │
├── mimetype, extension, size       │
├── folder, originalName            │
├── properties (jsonb)              │
├── uploadedBy (fk → users, nullable│  original/latest uploader
├── referenceCount (int)            │  dedup refcount; 0 + deletedAt = pending hard delete
└── deletedAt (soft delete, 30d grace)

contact_messages
├── id, firstName, lastName, email
├── subject, message
├── status ('new'/'sent'/'failed'/admin values)
├── errorMessage
└── createdAt/updatedAt

demo_sessions                            demo_registrations
├── id, title, description               ├── id
├── scheduledAt, durationMinutes         ├── demoSessionId (fk → demo_sessions, cascade)
├── sessionType ('event'/'influencer'    ├── firstName, lastName, email
│   /'group') — sales vertical tag       ├── audience ('event'/'influencer'/'group')
├── meetingType ('stream'/'external')    ├── audienceType, primaryCategory, scaleMetric,
├── streamCallId, streamCallType         │   currentPlatform, goals
├── externalMeetingLink, inviteLink      └── status ('pending'/admin values)
├── maxParticipants, status, notes
└── createdAt/updatedAt

imports                                  import_images
├── id, userId (fk → users, cascade)     ├── id
├── status enum (draft/pending/          ├── importId (fk → imports, cascade)
│   processing/completed/failed)         ├── userId (denormalized, fk → users)
├── totalImages, duplicateImages,        ├── s3Key, fileHash, originalFilename
│   processedImages, failedImages        ├── caption, displayOrder (smallint)
├── unique partial index: one            ├── status enum (pending/processing/
│   'draft' row per userId               │   published/rejected/failed)
└── createdAt, completedAt               ├── createdPostId (fk → posts, set null)
                                          ├── failReason, retryCount
                                          └── createdAt
```

Notable relationships:
- `media` is referenced (by URL, not FK — see gotchas) from nearly every other domain table
  (event cover images, post media, group covers, talent portfolio, shop products, etc.).
- `import_images.createdPostId` links a bulk-imported image to the `posts` row the worker created
  from it (social module).
- `demo_registrations.demoSessionId` cascades on delete — deleting a demo session deletes its
  registrations.
- `contact_messages` has no FK to `users` — the contact form is intentionally anonymous/public.

## API Endpoints

All paths below are relative to the `/api` prefix (mounted in `src/app.js`: `app.use('/api', defaultLimiter, routes)`).

### Uploads & Media

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/upload` | Required | Upload one file (`multipart/form-data`, field `file`). Body: `folder`, optional `entityId`. |
| POST | `/api/upload/multiple` | Required | Upload up to 10 files at once (field `files`). |
| GET | `/api/upload/my-files` | Required | List the caller's uploaded files (filter by `mediaType`/`folder`, paginated). |
| DELETE | `/api/upload/:fileId` | Required | Delete (decrement ref / soft-delete by default; `?permanent=true` hard-deletes if `referenceCount <= 1`). |

### Mail

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/upload/bulk-invite` | Required + `bulkInviteLimiter` (3/day/IP in prod) | **Actual mount point for `bulkMail.controller.js`.** Upload a CSV of emails, body `{ type: "event"\|"group", entityId }`, field `file`. Sends the SES template `Briteside-event-invite` or `Briteside-group-invite` to every parsed recipient. There is no standalone `bulkMail.route.js` or `/api/mail` path — this lives entirely inside `upload.route.js`. |

No direct route for `mail.service.js` — it has no controller/route of its own; it's called
in-process from other modules' services (auth, moderation, appeals, talent issues, demo
registration, event notifications).

### Contact Form

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/contact` | Public + `contactLimiter` (10/hr/IP in prod) | Submit the contact form. Persists, forwards to `admin@briteside.app`, always returns a friendly success message even if the email send fails (failure is recorded on the row). |
| GET | `/api/admin/contact-messages` | Admin (`authMiddleware` + `requireAdmin`) | Paginated list, filter by `status`/`search`, sortable. |
| GET | `/api/admin/contact-messages/:id` | Admin | Single message. |
| PATCH | `/api/admin/contact-messages/:id/status` | Admin | Update status (read/archived/etc — free-form string). |

### Universal Search

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/search?q=&limit=` | Public (optional auth — see gotchas) | Cross-entity search: users, events, groups, talent profiles. |

### Demo Sessions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/demo-sessions/upcoming` | Public | Next upcoming session (optionally filtered by `type`/`sessionType` via query — see gotchas on param naming). |
| POST | `/api/demo-sessions/:sessionId/register` | Public | Register for a specific session; sends a confirmation email with the join link. |
| POST | `/api/admin/demo-sessions` | Admin | Create a session (Stream call or external link). |
| GET | `/api/admin/demo-sessions` | Admin | List sessions (paginated, filter by `status`). |
| PATCH | `/api/admin/demo-sessions/:sessionId` | Admin | Update session fields. |
| PATCH | `/api/admin/demo-sessions/:sessionId/status` | Admin | Update status (`upcoming`/`active`/`completed`/`cancelled`). |
| DELETE | `/api/admin/demo-sessions/:sessionId` | Admin | Delete session (also deletes its Stream call, if any). |
| GET | `/api/admin/demo-sessions/:sessionId/registrations` | Admin | List registrants for a session. |

### Bulk Import

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/imports/status` | Required | `{ canImport, activeImport, totalUploaded, remaining }` — frontend uses `canImport` to show/hide the onboarding CTA. |
| POST | `/api/imports` | Required | Create (or resume) a draft import. |
| POST | `/api/imports/:id/presign` | Required + owner + `importPresignLimiter` (3/hr/user in prod) | Generate S3 pre-signed PUT URLs for a batch of images (dedup-aware). |
| POST | `/api/imports/:id/submit` | Required + owner | Lock the draft and enqueue one pg-boss job per image. |
| GET | `/api/imports/:id` | Required + owner | Progress/status summary. |
| GET | `/api/imports/:id/images` | Required + owner | Per-image status list. |
| DELETE | `/api/imports/:id` | Required + owner | Delete a draft (blocked once submitted). |

## Core Flows

### 1. File upload flow

Uploads are **not** presigned-direct-to-S3 by default — they go through the API via `multer`
memory storage, then the server itself streams to S3:

1. Client sends `multipart/form-data` to `POST /api/upload` (or `/multiple`); `multer` buffers the
   file in memory (`upload.route.js`, 100MB cap, mimetype/extension allow-list).
2. `upload.controller.js` validates folder name and basic file shape.
3. `UploadService.uploadFile` (`src/services/upload.service.js`):
   - Computes SHA-256 of the buffer.
   - `FileManagementService.findByHash` — if a match exists, **skips the S3 PUT entirely**,
     increments `referenceCount`, adds the caller to `media_owners`, returns the existing URL
     (`isDuplicate: true`).
   - Otherwise: sanitizes filename, builds a structured S3 key
     (`folder/[entityId]/[userId]/filename`), `PutObjectCommand` with `ACL: public-read`, builds
     the public URL via `FileManagementService.buildPublicUrl` (CDN domain if `CDN_BASE_URL` is
     set, else raw S3 URL), inserts a `media` row.
   - If the uploader is a real user and the media type is image/video, **asynchronously enqueues
     media moderation** (`MediaModerationService.enqueue`) — the upload response returns before
     moderation completes; see [09-moderation.md](./09-moderation.md).
4. Deletion (`DELETE /api/upload/:fileId`) is reference-counted: default decrements
   `referenceCount` (soft-deletes at 0, with a 30-day grace period); `?permanent=true` hard-deletes
   immediately but is refused if `referenceCount > 1` (would break other referencing rows).
5. `src/cron/fileCleanup.js` runs daily at 3 AM and permanently removes S3 objects + `media` rows
   whose soft-delete grace period (30 days) has expired.

The **bulk import** flow (see #5 below) is the one place that *does* use presigned direct-to-S3
uploads — the two upload paths in this codebase are genuinely different mechanisms.

### 2. Sending a transactional email vs. a bulk email blast

**Transactional** (`mail.service.js`): any service calls `sendMail(to, subject, html, text)` (or one
of the pre-built template functions) directly and awaits a single SES `SendEmailCommand`. This is
synchronous, one-recipient-at-a-time, used for OTPs, password resets, suspension notices, demo
confirmations, etc.

**Bulk** (`bulkMail.service.js` + `bulkMail.controller.js`), concretely the CSV bulk-invite flow:
1. Organizer/group-owner uploads a CSV to `POST /api/upload/bulk-invite` with `{ type, entityId }`.
2. `bulkInviteFromCsv` parses the CSV itself (no external CSV library) — handles header/no-header,
   single/multi-column, scans every cell for anything matching an email regex, dedupes, and can
   pick up a personalization name from a `name` column if present.
3. Looks up the target `event` or `group` by `entityId`, builds per-recipient template data
   (`user_name`, event/group name, date/location, organizer name, invite URL).
4. Calls `sendBulkTemplatedEmail('Briteside-event-invite'|'Briteside-group-invite', defaultData, recipients)`
   — this requires those two **SES templates to already exist** in the AWS account; nothing in
   this repo creates them.
5. `bulkMail.service.js` batches recipients 50 at a time (`SendBulkTemplatedEmailCommand`), waits
   100ms between batches, then does **one retry pass** over anything that failed, and returns
   `{ sent, failed }`.
6. Rate-limited to 3 bulk invites per day per IP (`bulkInviteLimiter`) since it's SES-call- and
   CSV-processing-heavy.

### 3. Contact form submission

1. `POST /api/contact` (public, rate-limited 10/hr/IP) validates with an inline Zod schema
   (firstName/lastName optional, email/subject/message required).
2. `contact.controller.js` persists the message first (`contactService.createMessage`) — so a
   record exists even if the follow-up email fails.
3. `createMessage` fires `TextModerationService.flagAsync` (fire-and-forget) on the subject+message
   for abuse/spam detection — see [09-moderation.md](./09-moderation.md).
4. Controller builds an HTML email (manually HTML-escaped) and sends it to the hardcoded
   `admin@briteside.app` via `mail.service.js`.
5. On success, `status` is updated to `sent`; on failure, `status` becomes `failed` with
   `errorMessage` recorded — but the **HTTP response to the submitter is 200 either way**, with a
   slightly different message when delivery failed. The submitter is never shown a hard error.
6. Admins review/manage messages via `/api/admin/contact-messages*`.

### 4. Universal search across resource types

1. `GET /api/search?q=&limit=` (public, own rate limiter: 60/min/IP in prod, 1000 in dev — tighter
   than default because of the fan-out below).
2. `search.controller.js` passes `q`, `limit`, and `viewerId` (`req.user?.id`, populated only if
   some upstream auth attached a user — the route itself does **not** apply
   `optionalAuthMiddleware`, so `viewerId` is effectively always `undefined` in practice; see
   gotchas) to `SearchService.universalSearch`.
3. `buildTsQuery` strips non-alphanumeric characters and turns the remaining words into a
   Postgres `word:* & word:*` prefix-match `tsquery`.
4. **Users** are always searched: full-text match on a precomputed `userSearch` tsvector column,
   OR-ed with opt-in email/phone LIKE-matches (gated by each user's `allowSearchByEmail` /
   `allowSearchByPhone` flags), excluding blocked/blocking users for the viewer.
5. If the query has no usable tokens (e.g., only punctuation), **only users** are returned (via the
   email/phone LIKE branch) — events/groups/talent are skipped entirely, since full-text search on
   those needs actual tokens.
6. Otherwise, events (published, non-deleted), groups (non-deleted), and talent profiles (active,
   non-deleted, block-filtered) are searched **in parallel** against their own tsvector columns,
   each ranked by `ts_rank`.
7. Response shape: `{ users, events, groups, talents, meta: { query, totals } }`.

### 5. Bulk influencer import

The multi-step, resumable pipeline behind the "influencer import" onboarding flow:

1. **Status check** — `GET /api/imports/status` tells the client whether the user can still
   import (global cap: 60 images per user, across all their imports combined) and whether they
   have an active draft.
2. **Create draft** — `POST /api/imports` — returns the existing draft if one exists (idempotent
   resume), otherwise inserts a new `imports` row (`status: draft`). DB-enforced: only one `draft`
   row per user at a time (partial unique index).
3. **Presign** — `POST /api/imports/:id/presign` (owner-checked, rate-limited 3/hr/user) — client
   sends `{ images: [{ filename, contentType, sha256?, caption?, displayOrder? }] }`.
   - Server checks each image's `sha256` against the user's existing (non-failed) `import_images`
     rows — duplicates are returned immediately with `existingUrl`, no new S3 work.
   - Remaining images are checked against the 60-image cap.
   - `PresignService.generateUploadUrls` validates content-type against a small allow-list
     (`jpeg`/`png`/`webp`/`mp4`/`quicktime`) and returns one S3 pre-signed `PUT` URL per image
     (15-minute TTL), key scoped as `imports/{userId}/{importId}/{imageId}/{filename}`.
   - `import_images` rows are inserted and `imports.totalImages`/`duplicateImages` incremented in
     one transaction.
   - **Client is responsible for actually `PUT`-ing the file bytes to the returned URLs** — the
     API never sees the file content at this step.
4. **Submit** — `POST /api/imports/:id/submit` (owner-checked) — flips `imports.status` to
   `pending`, reserves a block of negative `displayOrder` values (via `userPostOrderCounter`) so
   the new batch sorts above every existing post, and enqueues one pg-boss job
   (`process-import-image`) per image via `getBoss().send(...)`.
5. **Async processing** — `src/workers/importWorker.js` (pg-boss `teamSize: 10`, so up to 10 images
   process concurrently): for each job, builds the public media URL from the already-uploaded S3
   key, inserts a `posts` row (`source: 'import'`, `visibility: 'public'`, `status: 'published'`),
   registers `userPostOrder`, marks the `import_images` row `published` with `createdPostId`, and
   fires async media moderation on the new post. Failures mark the image `failed` with
   `failReason` and still call `recordImageResult` so the parent `imports` row's counters/status
   stay accurate.
6. **Progress polling** — `GET /api/imports/:id` returns counters
   (`total/posted/duplicates/failed`); `GET /api/imports/:id/images` returns per-image status.
7. **Cleanup** — `src/cron/cleanupStaleImports.js` (hourly): force-fails any import stuck in
   `pending`/`processing` for 30+ minutes (crashed-worker recovery, since 60 images at
   `teamSize: 10` should finish in minutes) and hard-deletes abandoned `draft` imports (+ their S3
   objects) older than 2 hours.

## Integrations

### AWS S3
- Used by: Uploads & Media (`upload.service.js`, `fileManagement.service.js`) and Bulk Import
  (`presign.service.js`, `cleanupStaleImports.js`).
- Two distinct upload mechanisms: **server-side buffered upload** (multer → `PutObjectCommand`,
  general uploads) vs. **client-side presigned PUT** (bulk import only).
- All objects are uploaded with `ACL: 'public-read'` — there is no private/signed-read path for
  media; public URLs are the only access model.
- Public URL building goes through `FileManagementService.buildPublicUrl`, which prefers
  `CDN_BASE_URL` (CloudFront) over the raw `https://{bucket}.s3.{region}.amazonaws.com/{key}` form
  — check which is active in a given environment before assuming URLs are CDN-fronted.
- Bucket/region come from `process.env.AWS_S3_BUCKET` / `AWS_REGION`, read directly (not part of
  the Zod-validated `config.js` schema) — they won't fail fast at boot if missing.

### AWS SES
- Used by: `mail.service.js` (single `SendEmailCommand`) and `bulkMail.service.js` (batch
  `SendBulkTemplatedEmailCommand`).
- Sender address: `process.env.AWS_SES_FROM_MAIL`, must be a **verified SES identity**.
- Bulk mail depends on two **SES-side templates** (`Briteside-event-invite`,
  `Briteside-group-invite`) that must be created directly in AWS SES — nothing in this repo
  provisions them; if they don't exist in an environment, bulk invite will fail outright.
- Region: `process.env.AWS_SES_REGION`, separate env var from the general `AWS_REGION`.

### AWS SNS
- **Not** push-notification infra and **not** related to GetStream. It backs **per-event SMS
  blast subscriptions**: an event gets its own SNS topic (`aws.util.js: createEventTopic`),
  attendees subscribe via SMS (`subscribeToEvent`), organizers publish blasts
  (`blast.service.js` → `sendEventBlast`). `src/cron/snsTopicCleanup.js` runs every 10 days and
  deletes topics for events whose `endDate` has passed, clearing `events.snsTopicArn`. If you're
  looking for GetStream's own push-notification setup, that's a separate mechanism documented in
  [10-getstream-realtime.md](./10-getstream-realtime.md) — this SNS usage is unrelated to it.

### Skimlinks (not integrated — planning doc only)
`docs/skimlinks-integration-estimate.md` is a **build estimate for a feature that does not exist
in this codebase yet** — sub-affiliate monetization of creator outbound links (wrap links via
Skimlinks, ingest their commission-report API, split revenue, pay out via Stripe Connect). It
explicitly plans to **reuse** `src/services/trackingLink.service.js` / `trackingLinks` /
`trackingLinkClicks` (event/organizer tracking-link click counting) by generalizing them to a
polymorphic owner. It has **no relationship to the bulk/influencer import feature** — the shared
word "affiliate"/"influencer" is coincidental; import is about turning uploaded photos into posts,
Skimlinks is about monetizing outbound product links. Treat this doc as a future-work estimate,
not documentation of shipped behavior.

## Business Rules & Gotchas

- **File size limit is inconsistent in error messaging.** The actual enforced limit is **100MB**
  (`upload.route.js` multer config: `fileSize: 100 * 1024 * 1024`, and
  `upload.service.js: MAX_FILE_SIZE = 100 * 1024 * 1024`), but the multer error handler
  (`upload.route.js: handleMulterError`) hardcodes the message *"Maximum size is 50MB"* — a stale
  comment/message, not the real cap.
- **Upload allow-list**: images (any `image/*`), video restricted to **`mp4`/`quicktime` (.mov)
  only** (explicitly to match what Stream's moderation pipeline can analyze — other video mimetypes
  are rejected), audio (any `audio/*`), plus an explicit list of documents/archives (`pdf`,
  `zip`/`x-zip-compressed`, `x-msdownload` for `.rar`, `xls`/`xlsx`, `csv`) and an extension-based
  fallback for generic browser mimetypes.
- **Bulk import content-type allow-list is narrower and separate**: `presign.service.js` only
  allows `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime` — its own error
  message additionally mentions `webm`/`avi`/`mpeg` as "allowed", which is **not actually true**
  (those extensions only appear in `importWorker.js`'s post-hoc `VIDEO_EXTENSIONS` classification
  set, unrelated to what's accepted at presign time).
- **`media` rows are referenced by URL/S3 key across the codebase, not by foreign key** — deleting
  or permanently removing a `media` row does not cascade-update whatever other table's column
  happens to store that URL. Permanent delete is blocked when `referenceCount > 1` specifically to
  reduce (not eliminate) this risk.
- **Universal search validation is defined but unused.** `search.route.js` imports
  `validateMiddleware` and `searchQuerySchema` but the actual route registration
  (`router.get('/', searchLimiter, universalSearch)`) never applies them. In practice this means a
  missing/malformed `q` will reach `SearchService.buildTsQuery`, which calls `q.replace(...)` —
  an **unhandled TypeError on `q === undefined`** rather than a clean 400. `limit` similarly isn't
  clamped by the route; the service passes it straight to Drizzle's `.limit()`.
- **Universal search's `viewerId` is effectively always undefined in real traffic** — the route has
  no auth middleware (not even `optionalAuthMiddleware`), so `req.user` is never populated unless
  some other global middleware sets it, meaning block-list filtering silently doesn't apply to
  anonymous callers (which is all of them, by construction of this route).
- **Contact form always returns HTTP 200** to the submitter even when the admin email fails to
  send — by design, to avoid leaking delivery failures to the public, but means client-side
  "success" toasts don't guarantee the admin was actually notified; check `contact_messages.status`
  if a submission seems to have gone missing.
- **Demo session registration has no rate limiter and no captcha** — unlike the contact form
  (`contactLimiter`) or bulk invite (`bulkInviteLimiter`), `POST /api/demo-sessions/:sessionId/register`
  is public with only Zod body validation; there's nothing in the route or controller layer
  stopping scripted spam registrations beyond the global `defaultLimiter`.
- **Demo sessions are sales-lead-gen, not talent bookings.** `sessionType`/`audience` values are
  `event` | `influencer` | `group` — these describe which *type of prospective BriteSide customer*
  is booking a sales call, not a talent-booking category. Don't confuse with talent
  availability/booking sessions in the talent module.
- **Bulk import cap is 60 images total per user, cumulative across all their imports** (not per
  import) — `MAX_IMAGES = 60` in `import.service.js`, checked against `sum(total_images)` across
  every `imports` row the user has, including old completed/failed ones. There is currently no
  admin override/reset path visible in this module.
- **One draft import per user, enforced at the DB level** (partial unique index
  `one_draft_per_user ... where status = 'draft'`), not just in application logic — so a rogue
  concurrent `createImport` call safely resolves to "resume existing draft" rather than a
  constraint violation surfacing as a 500 (the service checks first, but the index is the real
  backstop).
- **`PresignService.verifyUploaded` (HeadObject check) is defined but not called anywhere** in the
  current submit/worker flow — nothing currently verifies the client actually completed the S3
  `PUT` before a job is enqueued; a failed/aborted client upload surfaces later as a worker job
  failure (`failReason`) rather than being caught at submit time.
- **`bulkInviteFromCsv`'s CSV parser is hand-rolled** (no library) — it treats any cell matching an
  email regex as a recipient regardless of column position, and infers a header row by checking
  whether the first row contains anything email-shaped. Malformed/quoted CSVs with edge-case
  commas may not parse as expected; there's no explicit CSV RFC 4180 handling beyond basic
  quote-toggling.
- **`FRONTEND_URL` fallback in `bulkMail.controller.js` is a broken-looking default**
  (`'http://localhost:3330.com'`) — only matters in local dev when the env var is unset; don't read
  it as a real production fallback.

## Common Tasks

| Task | Where to look |
|---|---|
| Add a new allowed upload file type | `src/routes/upload.route.js` (`fileFilter`) — and consider whether `presign.service.js`'s separate allow-list also needs updating if the type should be importable. |
| Add a new transactional email | Add a template function to `src/services/mail.service.js`, call `sendMail(...)` from wherever the trigger lives. Don't add it to `bulkMail.service.js` unless it's genuinely a batch send. |
| Add a new bulk-invite recipient type (beyond event/group) | `src/controllers/bulkMail.controller.js` — extend the `type` check and the `templateName`/`defaultData`/`buildData` branch; create the matching SES template out-of-band in AWS. |
| Change contact form spam/abuse limits | `src/middlewares/rateLimiter.js` (`contactLimiter`) for rate limiting; `TextModerationService` config for content moderation thresholds (see [09-moderation.md](./09-moderation.md)). |
| Add a new searchable entity type to universal search | `src/services/search.service.js` — add a parallel query against that entity's tsvector column (need a precomputed search column + GIN index on that table first), extend the returned shape and `meta.totals`. |
| Fix the missing search validation | Wire `validateMiddleware(searchQuerySchema)` into `search.route.js`'s `GET /` handler chain. |
| Add a new demo-session audience/vertical | Extend the `sessionType`/`audience` enums-in-practice (currently plain `varchar`, validated only via Zod `z.enum([...])` in `demo.route.js` and `admin.route.js` — update **both** places). |
| Raise/lower the bulk-import per-user image cap | `MAX_IMAGES` constant in `src/services/imports/import.service.js`. |
| Debug a stuck bulk import | Check `imports.status` — if stuck `pending`/`processing` past 30 min, `cleanupStaleImports` will force-fail it on its next hourly run; check `import_images.failReason` for the per-image worker error. |
| Change the pg-boss worker concurrency for imports | `teamSize` option in `src/workers/importWorker.js` (`boss.work(JOB_PROCESS_IMAGE, { teamSize: 10 }, ...)`). |

## Related Modules

- [04-social.md](./04-social.md) — home of `src/services/social/search.service.js`, the
  **different** search service (user-only, ILIKE-based, mention/follow-oriented) that this doc's
  Universal Search must not be confused with; also home of `posts` (the table bulk-imported images
  become) and `eventInvitation.service.js` (the other consumer of `bulkMail.service.js`).
- [05-talent.md](./05-talent.md) — talent availability/booking "sessions" are a **different concept**
  from the "demo sessions" documented here; if you're looking for talent booking flows, they're not
  in this file.
- [09-moderation.md](./09-moderation.md) — async text moderation (contact messages) and media
  moderation (uploads, bulk-imported posts) both fire into the moderation pipeline documented
  there.
- [10-getstream-realtime.md](./10-getstream-realtime.md) — demo sessions optionally create a
  GetStream video call (`meetingType: 'stream'`); GetStream's own push-notification plumbing is
  documented there and is unrelated to the AWS SNS usage described in this doc's Integrations
  section.
- [02-events.md](./02-events.md) *(not yet written at time of this doc)* — owns
  `blast.service.js`/`blast.route.js`, the actual feature behind the SNS topics that
  `snsTopicCleanup.js` cleans up, and `eventMail.helper.js`/`emailTemplates.js`'s real caller
  (`eventReminders.js`).
