# Moderation — KT

## Overview

Moderation in gokyro-api covers three things that are wired together but stored/enforced
separately:

1. **Automated content moderation** — every piece of user-generated **text** (posts, comments,
   stories, discussions, groups, events, reviews, chat messages, talent profiles, priority
   messages) and every uploaded **image/video** is checked against policies configured in
   **GetStream's Moderation product** (`client.moderation.*` on the existing `@stream-io/node-sdk`
   client — the same Stream account used for video/chat, see
   [10-getstream-realtime.md](./10-getstream-realtime.md)). Text checks are synchronous
   (block-before-save); image/video checks are asynchronous (accepted immediately, verdict via
   webhook).
2. **User reports** — any user can report a post, comment, discussion, group, event, social-chat
   conversation, or another user (`userReports` table). Reports feed both a general admin queue
   and a group-scoped queue for group admins/moderators.
3. **Suspensions & appeals** — a platform admin (or an automated report-resolution action) can set
   `users.isSuspended` (optionally time-boxed via `suspendedUntil`). `authMiddleware` enforces the
   suspension on every authenticated request. A suspended user can file exactly one open appeal at
   a time (`suspensionAppeals` table), reviewed by an admin.

**Enforcement pipeline, end to end:**

```
content created (text/media)
  │
  ├─ text  → sync Stream check (TextModerationService.assertAllowed)
  │            keep → save as-is
  │            mask  → save + text_moderation row (masked view for viewers with the filter on)
  │            flag  → save (stays visible) + text_moderation row → Stream review queue
  │            remove → 422, never saved
  │
  └─ media → upload succeeds immediately, content_moderation row = 'pending'
               → pg-boss job → Stream async check → webhook → applyVerdict()
                    keep   → approved (visible to everyone)
                    flag   → flagged (visible, blurred/under-review)
                    remove → rejected (hidden from everyone but owner, S3 object made private)

user/community reporting
  → POST /api/reports (userReports row, status='pending')
  → admin (or group admin/moderator for discussions) reviews
  → resolve: delete/cancel the content, or suspend the user (users.isSuspended = true)

suspension
  → authMiddleware blocks every request from an effectively-suspended user (403)
  → suspended user can still hit /api/appeals (authMiddlewareAllowSuspended)
  → admin reviews appeal → approve (lift or shorten suspension) | reject (suspension stands)
```

Content moderation and the report/suspension/appeal system are **independent** — an item can be
auto-flagged by Stream *and* separately reported by users; a suspension can come from an admin's
direct action *or* as a side effect of resolving a `user`-type report. There is no single
"moderation case" object that ties an auto-flag, a report, and a suspension together.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/report.route.js` | `POST/GET /api/reports`, `PATCH /api/reports/:reportId/status` — user-facing report creation + listing/status update |
| `src/routes/appeal.route.js` | `GET/POST /api/appeals/*` — suspended-user appeal flow |
| `src/routes/admin.route.js` | Admin-side report/suspension/appeal/media-moderation-queue endpoints (mounted under `/api/admin`, all require `requireAdmin`) |
| `src/controllers/report.controller.js` | `createReport`, `getReports`, `updateReportStatus` |
| `src/controllers/appeal.controller.js` | `submitAppeal`, `getMyAppeals`, `getSuspensionStatus` |
| `src/controllers/admin.controller.js` | Admin report/suspension/moderation-queue/appeal handlers (large file, moderation-relevant handlers only) |
| `src/services/admin.service.js` | `toggleUserSuspension`, `updateReportStatus`, `resolveReportedEntity`, `bulkUpdateReportStatus`, `getReportStatistics`, `getReportById`, `writeAuditLog` |
| `src/services/appeal.service.js` | `submitAppeal`, `getUserAppeals`, `listAppeals`, `reviewAppeal` |
| `src/services/moderation/textModeration.service.js` | `TextModerationService` — sync/async Stream text checks, PII masking, flag persistence, reading masked text back for viewers |
| `src/services/moderation/textMasking.service.js` | `maskProfanity()` — local regex fallback masker using Stream's reserved profanity word list |
| `src/services/moderation/mediaModeration.service.js` | `MediaModerationService` — image/video moderation lifecycle: enqueue, Stream check, webhook verdict application, S3 quarantine, feed-gating SQL fragments, admin queue/review |
| `src/config/profanityWordList.js` | `PROFANITY_WORDS` — a copy of Stream's reserved `profanity` blocklist (1105 words), used only for local masking, not for blocking |
| `src/db/schema/moderation.js` | `content_moderation` (media/post/story/event/group/discussion verdicts) and `text_moderation` (flagged text + masked versions) tables |
| `src/db/schema/userReports.js` | `user_reports` table + relations |
| `src/db/schema/appeals.js` | `suspension_appeals` table + relations |
| `src/workers/moderationWorker.js` | pg-boss worker for queue `moderate-media` — calls `MediaModerationService.runCheck` |
| `src/cron/reconcileModeration.js` | node-cron job — re-queues `content_moderation` rows stuck `pending` > 30 min |
| `src/utils/suspension.js` | `isUserEffectivelySuspended()`, `suspensionDaysRemaining()` — pure helpers shared by auth middleware, appeal controller, appeal service |
| `src/middlewares/auth.middleware.js` | `authMiddleware` (blocks suspended users), `authMiddlewareAllowSuspended` (appeals only), `optionalAuthMiddleware` (treats suspended as anonymous) |
| `src/controllers/streamWebhook.controller.js` | Receives `moderation_check.completed` / `review_queue_item.*` events from Stream and dispatches to `MediaModerationService.applyVerdict` (or `TalentSessionService.applyFrameVerdict` for call-frame moderation) |
| `scripts/setup-moderation-config.js` | One-time/idempotent script that pushes the actual Stream policy config (`gokiro_text`, `gokiro_text_async`, `gokiro_media`) — this is the real source of truth for what's blocked vs flagged vs masked |
| `src/services/mail.service.js` | `sendSuspensionEmail`, `sendUnsuspensionEmail`, `sendAppealReceivedEmail`, `sendAppealReviewedEmail` |

## Data Model

### `content_moderation` (media/post/story/event/group/discussion verdicts)

One row per moderated **entity** (not per file) — exactly one of the FK columns is set (polymorphic,
enforced with real per-column unique indexes so each entity gets at most one row).

| Column | Notes |
|---|---|
| `media_id`, `post_id`, `story_id`, `event_id`, `group_id`, `discussion_id` | Exactly one set — polymorphic target, each with `onDelete: cascade` and its own unique index |
| `user_id` | Content creator, for dashboard filtering (`onDelete: set null`) |
| `entity_type` | Stream entity type string, e.g. `gokiro:post:media`, `gokiro:media:image` |
| `status` | `pending \| approved \| flagged \| rejected \| shadowed \| skipped \| error` |
| `review_id` | Stream review-queue item id |
| `labels` | jsonb array of Stream category labels |
| `moderated_at` | Set when status leaves `pending` |

Absence of a row for an entity = legacy/unmoderated content = treated as `approved`.

### `text_moderation` (flagged text only)

One row per flagged **text field group** on an entity — created only when Stream returns
`flag` or `mask`, never for `keep`.

| Column | Notes |
|---|---|
| `entity_type`, `entity_id` | Unique together — one row per entity (e.g. `gokiro:text:post` + post id) |
| `fields` | jsonb: `{ fieldName: { original, masked, matchedWords } }` — one entry per moderated text field on that entity (e.g. a post has just `caption`; an event has `title` + `description`) |
| `status` | `flagged` (no other values used today) |
| `severity` | Stream's `item.ai_text_severity` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`) |
| `labels` | jsonb array of category labels (e.g. `['VULGARITY']`) |
| `reviewed_by`, `reviewed_at` | Present in schema but **nothing in the codebase writes them** — there is no in-app admin endpoint for reviewing flagged text (see Gotchas) |

Absence of a row = text was never flagged, always shown as typed.

### `user_reports`

| Column | Notes |
|---|---|
| `reporter_id` | FK → `users`, cascade delete |
| `type` | enum: `user \| post \| group \| event \| comment \| social_chat \| discussion` |
| `target_user_id`, `post_id`, `group_id`, `event_id`, `conversation_id`, `discussion_id` | Polymorphic target — which one is set depends on `type`. Note: **comments have no dedicated FK** — a reported `postComment` or `discussionReply` id is stashed in `metadata.commentId` / `metadata.discussionReplyId` instead (see Gotchas) |
| `reason` | Required, free text (also the category, e.g. "Harassment") |
| `description`, `evidence_images` | Optional detail |
| `metadata` | jsonb, reused for the comment-id workaround above plus caller-supplied metadata |
| `status` | enum: `pending \| reviewed \| resolved \| dismissed` |
| `action_taken` | Free-text summary of what the admin did |
| `reviewed_by`, `reviewed_at` | Admin who actioned it |

Unique constraints: `(reporterId, postId)`, `(reporterId, groupId)`, `(reporterId, eventId)`,
`(reporterId, conversationId)`, `(reporterId, discussionId)` each prevent the same user from
filing a duplicate report on the same content. **No unique constraint on `(reporterId,
targetUserId)`** — a user can report the same other user any number of times (intentional, per
`report.controller.js`'s comment: "user reports allowed multiple times"). Comment reports are
deduplicated in application code (`report.controller.js`) via a `metadata->>'commentId'`/
`metadata->>'discussionReplyId'` lookup instead of a DB constraint.

Relations: `reporter`, `targetUser`, `reviewedBy` (all → `users`), plus `post`, `group`, `event`,
`socialConversation`, `discussion`.

### `suspension_appeals`

| Column | Notes |
|---|---|
| `user_id` | FK → `users`, cascade delete |
| `reason` | Required text, the user's appeal message |
| `status` | varchar, `pending \| approved \| rejected` |
| `admin_id`, `admin_response` | Set on review |
| `reviewed_at` | Set on review |
| `new_suspended_until` | Set only on `approved` decisions where the admin **reduces** (rather than fully lifts) the suspension; `null` on a full lift or on `rejected` |

Relations: `user` (relationName `appealUser`), `admin` (relationName `appealAdmin`), both → `users`.

### `users` (moderation-relevant columns)

`src/db/schema/users.js`: `is_suspended` (bool, default false), `suspended_until` (timestamptz,
nullable — `null` means permanent), `suspension_reason` (text), `profanity_filter_enabled` (bool,
default false — a **viewer's own** preference for whether flagged/masked text is shown masked to
them; toggled via the generic profile-update endpoint, not a moderation-specific one).

## API Endpoints

All paths are relative to `/api` (mounted in `src/app.js`: `app.use('/api', defaultLimiter, routes)`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/reports` | `authMiddleware` (any authenticated user) | File a report on a user/post/group/event/comment/social_chat/discussion |
| GET | `/api/reports` | `authMiddleware` (any authenticated user — **not admin-gated**, see Gotchas) | List all reports, paginated, with reporter/target/content details |
| PATCH | `/api/reports/:reportId/status` | `authMiddleware` (any authenticated user — **not admin-gated**, see Gotchas) | Set a report's `status`/`actionTaken` |
| GET | `/api/appeals/suspension-status` | `authMiddlewareAllowSuspended` | Check own current suspension state + days remaining |
| POST | `/api/appeals` | `authMiddlewareAllowSuspended` | File an appeal (only while suspended, only one pending at a time) |
| GET | `/api/appeals/me` | `authMiddlewareAllowSuspended` | List own appeal history |
| GET | `/api/admin/reports/statistics` | admin | Counts by status/type |
| GET | `/api/admin/reports` | admin | Same as `GET /api/reports`, admin-gated copy |
| GET | `/api/admin/reports/:reportId` | admin | One report with resolved content (post/event/group/comment/discussion-reply text) |
| PATCH | `/api/admin/reports/:reportId/status` | admin | Update a single report's status (Zod-validated) |
| PATCH | `/api/admin/reports/bulk-status` | admin | Update many reports at once |
| POST | `/api/admin/reports/:reportId/resolve` | admin | Take the report's implied action: delete/cancel the content, or suspend the reported user |
| PATCH | `/api/admin/users/:userId/suspension` | admin | Suspend or unsuspend a user directly (reason required to suspend, optional `duration` in days, optional `reportId` to auto-resolve) |
| DELETE | `/api/admin/posts/:postId` | admin | Soft-delete a post (optionally tied to a report) |
| GET | `/api/admin/moderation/media` | admin | Paginated `content_moderation` queue (images/videos), filterable by `status`/`entityType` |
| PATCH | `/api/admin/moderation/media/:id/action` | admin | Manually override a media verdict (`keep\|flag\|remove\|shadow\|shadow_block`) — replays the same pipeline a Stream webhook would trigger |
| GET | `/api/admin/moderation/calls` | admin | Talent video-session call-frame moderation queue (see Gotchas — narrow feature, full detail in [05-talent.md](./05-talent.md)) |
| GET | `/api/admin/appeals` | admin | List suspension appeals, filterable by `status` |
| PATCH | `/api/admin/appeals/:appealId/review` | admin | Approve (lift or reduce) or reject an appeal |
| GET | `/api/groups/:groupId/reported-discussions` | `authMiddleware` + inline group admin/moderator check | Group-scoped view of reports on that group's discussions |
| POST | `/api/groups/:groupId/reported-discussions/:reportId/resolve` | `authMiddleware` + inline group admin/moderator check | Soft-delete the reported discussion and resolve the report (delegates to `adminService.resolveReportedEntity`) |

## Core Flows

### 1. Automated text moderation on content creation

Almost every text-writing service (`post`, `comment`, `story`, `storyPoll`, `discussion`, `group`,
`event`, `review`, `livestream` chat/comments, `eventChat`, `socialChat`, `priorityMessage`,
`profile`/bio, `talentSession` profile/review) calls
`TextModerationService.assertAllowed({ entityType, entityId, entityCreatorId, texts, mask })`
before saving:

1. Calls `streamClient.moderation.check(...)` with `config_key: 'gokiro_text'` and
   `options: { force_sync: true }` — a real synchronous call, 4s timeout
   (`textModeration.service.js:49`).
2. Stream runs its blocklist + AI-Text (NLP) + LLM engines and returns
   `recommended_action ∈ { keep, flag, remove, mask }`.
3. **`remove`** → `assertAllowed` throws `ApiError(422, ..., { code: 'MODERATION_BLOCKED' })`.
   Content is **never saved**. The caller's controller surfaces this as a 4xx to the client.
4. **`flag`** or **`mask`** → content **is still saved as typed** (assertAllowed only blocks on
   `remove`); the caller then calls `TextModerationService.recordIfFlagged(...)`, which writes a
   `text_moderation` row containing both the original and a masked version (mask preference:
   Stream's Labels API `masked_content` for that policy, falling back to the local
   `maskProfanity()` regex if the Stream call fails/times out). Readers with
   `profanityFilterEnabled = true` get the masked version substituted in
   (`TextModerationService.maskFlaggedText`); everyone else still sees the original text as typed
   — flagging is a **review signal**, not a redaction, except for the profanity-filter viewer path.
5. **`keep`** → nothing else happens; no DB row.
6. **Fail-open on Stream error/timeout**: `check()` catches the error, logs it, fires an async
   check (`flagAsync`) so the item still reaches Stream's review queue, and returns `{ action:
   'keep', failedOpen: true }` — the request never fails just because Stream is down.

A few surfaces are **flag-only, never blocking**, using `flagAsync` instead of `assertAllowed`:
support/contact messages (`TEXT_ENTITY.SUPPORT` — used by report descriptions, appeal reasons,
contact form, talent issue descriptions). These use the separate `gokiro_text_async` policy where
every rule is forced to `flag` (see `setup-moderation-config.js` — "Async policy flags only —
reports/support text must never be blocked"). The rationale: a user reporting abusive content or
appealing a suspension must never have their own report/appeal text auto-rejected.

**What actually gets blocked vs merely flagged** (from `scripts/setup-moderation-config.js`, the
real source of truth — see Business Rules below for the full table): pedophilia, terrorism, and
doxxing are always removed; threats/self-harm/hatred/sexual-harassment escalate to removal only at
high/critical severity; plain vulgarity, scams, PII sharing, and platform-bypass attempts are
flagged, never removed.

### 2. Media moderation (image/video upload)

1. Any image/video through `UploadService.uploadFile()` (`src/services/upload.service.js:190`)
   — the shared upload endpoint used across the app — enqueues moderation for real user uploads
   (skipped for system-generated files with no `userId`, e.g. QR codes/receipts). Post/story/
   discussion/event/group creation instead call `MediaModerationService.adoptMediaVerdicts()`,
   which **reuses** the verdict already produced by the file's own upload-time check (no second
   Stream call) — a real check only runs if the file has no `content_moderation` row yet (e.g.
   presigned/import uploads).
2. `MediaModerationService.enqueue()` writes a `content_moderation` row with `status: 'pending'`
   immediately (so feed-gating queries see it right away) and pushes a pg-boss job onto the
   `moderate-media` queue (`retryLimit: 3`, exponential backoff).
3. `moderationWorker.js` picks up the job, calls `MediaModerationService.runCheck()` →
   `streamClient.moderation.check()` with `config_key: 'gokiro_media'`. Image/video engines are
   async in Stream — the immediate response is usually `pending`; only unsupported video formats
   (anything not `.mp4`/`.mov`) are resolved immediately to `skipped` (never silently approved).
4. The real verdict arrives later via the `moderation_check.completed` webhook
   (`src/controllers/streamWebhook.controller.js`) → `MediaModerationService.applyVerdict()`:
   - `keep` → `approved`, visible to everyone.
   - `flag` → `flagged`, visible but blurred/under-review to non-owners.
   - `remove` → `rejected` — the S3 object's ACL is flipped to `private` (URL 403s everywhere at
     once) and the verdict **cascades**: every post/story/discussion embedding that file, and any
     event/group whose *required* cover image is affected, gets its own aggregate status
     recomputed (`propagateMediaVerdict`, "worst-wins" aggregation across a post's multiple
     images).
   - `shadow`/`shadow_block` → `shadowed` — stays visible to the owner only (S3 stays public so the
     owner isn't tipped off), hidden from everyone else.
5. Rejected **required** media (event/group cover image) pauses ticket sales/joins for that
   event/group and triggers an email to the owner; rejected **optional** media (gallery images,
   priority-message attachments) never blocks anything — it's stripped from display and, for paid
   priority-message attachments, refunded (`PriorityMessageService.refundRejectedAttachment`).
6. Feed-visibility gating is enforced with raw SQL fragments
   (`postsModerationGate`, `storiesModerationGate`, `discussionsModerationGate`, and the strict
   author-included variants) — a post/story/discussion with `pending|rejected|shadowed|skipped|
   error` is hidden from everyone except its own owner (owner always sees their own content,
   except on the strict variant used when viewing *another user's* profile).

### 3. User files a report

`POST /api/reports` (`report.controller.js:createReport`):
1. Validates that the right target id is present for the given `type` (e.g. `postId` for
   `type: 'post'`).
2. Checks for a duplicate (unique-constraint-backed for post/group/event/social_chat/discussion;
   metadata-lookup-backed for comments; **no** dedup for `type: 'user'` — repeat reports allowed).
3. Inserts the `userReports` row (`status: 'pending'`).
4. Fires `TextModerationService.flagAsync(...)` on the report's own `reason`/`description` text
   (flag-only — a report is never blocked for containing flaggable language).
5. If reporting a **discussion**, notifies the group's admin (best-effort, swallows errors) —
   this is the only report type with an automatic notification.

### 4. Admin/moderator reviews a report and suspends a user

Two independent paths lead to a suspension, with **different behavior** — see Gotchas:

- **Direct suspension**: `PATCH /api/admin/users/:userId/suspension`
  (`adminService.toggleUserSuspension`) — admin explicitly sets `isSuspended: true`, a **required**
  `reason`, and an optional `duration` (days; omitted = permanent). Sends `sendSuspensionEmail`.
  Can optionally pass a `reportId` to mark that report `resolved` in the same call.
- **Via report resolution**: `POST /api/admin/reports/:reportId/resolve` with `action` implied by
  the report's `type` (`adminService.resolveReportedEntity`) — for `type: 'user'` reports this sets
  `isSuspended: true` directly with **no reason, no duration (i.e. permanent), and no email**.
  For other types it soft-deletes the post/discussion/group, or cancels/deletes the event.
  Every branch writes an audit log entry via `writeAuditLog`.
- Group-scoped equivalent for discussions: `POST /api/groups/:groupId/reported-discussions/:reportId/resolve`
  checks the caller is that group's admin/moderator, then **delegates to the same
  `adminService.resolveReportedEntity('delete', ...)`** used by the platform-admin path.

### 5. Suspended user files an appeal and how it resolves

1. `authMiddleware` returns 403 for every route except `/api/appeals/*`
   (`authMiddlewareAllowSuspended` deliberately skips the suspension check).
2. `POST /api/appeals` (`appealService.submitAppeal`) — rejects if the user isn't actually
   suspended, or if they already have a `pending` appeal (one open appeal at a time). On success,
   fires `TextModerationService.flagAsync` on the appeal reason text and sends
   `sendAppealReceivedEmail`.
3. Admin resolution: `PATCH /api/admin/appeals/:appealId/review`
   (`appealService.reviewAppeal(appealId, decision, adminResponse, newSuspendedUntil, adminId)`):
   - `decision: 'approved'`, no `newSuspendedUntil` → suspension **fully lifted**
     (`isSuspended: false`, `suspendedUntil: null`, `suspensionReason: null`).
   - `decision: 'approved'`, `newSuspendedUntil` set → suspension **reduced**, not lifted
     (only `suspendedUntil` is updated; `isSuspended` stays `true`).
   - `decision: 'rejected'` → no change to the user; `newSuspendedUntil` is forced to `null`
     regardless of what was passed.
   - An already-reviewed appeal (`status !== 'pending'`) is rejected with 400 — appeals are
     reviewed exactly once.
   - Writes an audit log (`appeal_approved`/`appeal_rejected`) and sends
     `sendAppealReviewedEmail`.
4. Next request from that user hits `authMiddleware` again: if the suspension window has expired
   (`suspendedUntil` in the past) or was lifted, they pass through; `authMiddleware` also
   **opportunistically auto-clears** an expired suspension in the DB the first time it notices
   (fire-and-forget update), so `isSuspended` doesn't linger `true` forever after the date passes.

### 6. pg-boss moderation worker + reconciliation cron

- **Worker** (`src/workers/moderationWorker.js`): subscribes to the `moderate-media` pg-boss queue
  (`teamSize: 5`), calls `MediaModerationService.runCheck(job.data)` for each job. On failure it
  **rethrows** so pg-boss retries per the job's `retryLimit`/backoff; after retries exhaust, the
  row is left `pending` for the cron to pick up (never marked `error` by the worker itself).
- **Cron** (`src/cron/reconcileModeration.js`, registered in `cronJobs.js`): sweeps
  `content_moderation` rows still `status: 'pending'` and `updatedAt` older than **30 minutes**
  (a dropped webhook or dead job), in batches of 100. Recovery differs by row level: a stuck
  **file** (`mediaId` set) re-enqueues its own Stream check; a stuck **post/story** just
  re-derives from its backing files via `adoptMediaVerdicts` (the file-level check is the real
  recovery — once the file resolves, re-deriving picks it up). Never auto-approves on timeout.

## Integrations

**GetStream Moderation** (`@stream-io/node-sdk`, `streamClient.moderation.*`) is the only
third-party moderation vendor actually wired into the codebase. It's the same Stream account/client
used for video/chat (see [10-getstream-realtime.md](./10-getstream-realtime.md) for the webhook
plumbing, signature verification, and general Stream integration — this doc covers the moderation
**policy**, not the transport).

- **Text**: `moderation.check({ config_key: 'gokiro_text' | 'gokiro_text_async', moderation_payload: { texts }, options: { force_sync: true } })` for the sync policy. Engines: a blocklist
  (Stream's reserved `profanity` list, action `mask`; a custom PII regex blocklist, action `flag`),
  Stream's AI-Text/NLP engine, and an LLM engine with an app-specific `app_context` prompt tuned for
  "social events platform... Users write in English, Hindi, and romanized Hinglish" (explicitly
  detects Hindi/Hinglish profanity like "gandu, chutiya, madarchod, bhosdike").
- **Media**: `moderation.check({ config_key: 'gokiro_media', moderation_payload: { images | videos } })`, async, backed by AWS Rekognition (image/video categories) plus an LLM pass over media
  captions. Verdicts land via webhook (`moderation_check.completed`, `review_queue_item.new/updated`)
  at the existing `POST /api/webhooks/stream` endpoint.
- **Local profanity list** (`src/config/profanityWordList.js`): a static copy of Stream's own
  reserved `profanity` blocklist (1105 entries), used **only** as a client-side fallback masker
  (`maskProfanity()` in `textMasking.service.js`) when the Stream Labels API call for masking fails
  or times out. It never blocks anything and is not the mechanism that decides `flag`/`remove` —
  that's entirely server-side in Stream's policy engines.
- **Call-frame moderation** (adjacent feature, not covered in depth here — see
  [05-talent.md](./05-talent.md)): paid talent video sessions submit periodic video-call frames to
  the same `gokiro_media` config under a distinct entity type
  (`gokiro:talentsession:frame`), and `TalentSessionService.applyFrameVerdict` escalates a
  per-session `moderationStatus` (worst-wins) and takes call actions (warn/mute-track/end-call).
  Surfaced to admins at `GET /api/admin/moderation/calls`.
- **AI Content Moderation (Claude/NSFWJS) design — superseded, not implemented**: an earlier design
  doc (`docs/superpowers/specs/2026-07-07-ai-content-moderation-design.md`) proposed a
  Claude-Haiku + NSFWJS + OpenAI-Moderation pipeline. None of that shipped — no `nsfwjs`,
  `obscenity`, or `@anthropic-ai/sdk` dependency exists in the codebase. The implementation that
  actually exists follows the later GetStream-based plan
  (`docs/superpowers/specs/2026-07-13-getstream-content-moderation-plan.md`) almost exactly. Don't
  assume the Claude doc describes current behavior.

## Business Rules & Gotchas

**Real policy — what's blocked vs flagged vs masked** (from `scripts/setup-moderation-config.js`,
the actual Stream config; the dashboard is the ultimate live source of truth, this script is what
provisioned it):

| Category | Sync (posts/comments/etc.) | Async/flag-only (reports/support/appeals) |
|---|---|---|
| Pedophilia, terrorism, doxxing | **remove** always | flag |
| Threat, self-harm, hatred | flag (low/medium) → **remove** (high/critical) | flag |
| Sexual harassment | flag (low) → **remove** (medium+) | flag |
| Vulgarity, sexually explicit | flag (low) → **remove** (high) | flag |
| Scam, platform-bypass, PII sharing | flag only, never removed | flag |
| Image: Explicit (nudity/sex acts) | **remove** at ≥90% confidence | — |
| Image: non-explicit nudity, violence, gore, drugs, hate symbols | flag at 50–85% confidence | — |
| Video: Explicit, Visually Disturbing, Hate Symbols | **remove** | — |
| Video: Violence, Drugs & Tobacco, Rude Gestures | flag | — |

- **Fail-safe direction differs by content type.** Text fails **open** on a Stream error/timeout
  (content is kept, an async re-check is queued) so a Stream outage never blocks users from
  posting. Media fails **closed** — an unmoderatable/unsupported format (e.g. non-mp4/mov video)
  is marked `skipped`, which is on the "hidden from everyone but the owner" list, and a check that
  errors out is marked `error`, same treatment. Never silently auto-approved.
- **Flagged ≠ hidden, for text.** A `flag`/`mask` verdict on text does **not** remove or hide the
  content from other users — it stays visible as typed to everyone except viewers who've turned on
  `profanityFilterEnabled`, who see the masked version. Only `remove` blocks text outright (before
  save). This is different from media, where `flag` gets visibly blurred and `remove` is hidden
  from everyone but the owner.
- **Two different "suspend a user" code paths, with different guarantees.**
  `toggleUserSuspension` (direct admin action) requires a `reason`, supports a time-boxed
  `duration`, and sends an email. `resolveReportedEntity` (resolving a `type: 'user'` report — its
  `user` case is hardcoded to suspend regardless of the request's `action` field, even though the
  endpoint's `action` enum is `delete|cancel|suspend`) sets `isSuspended: true` with **no
  `suspensionReason`, no `suspendedUntil` (so it's permanent), and no email notification**. If
  you're debugging "why does this suspended user have no reason on file," check which path
  suspended them.
- **No unsuspend path from report resolution** — `resolveReportedEntity`'s `user` branch only ever
  suspends; lifting a suspension always goes through `toggleUserSuspension` or an approved appeal.
- **Permanent vs time-based is just `suspendedUntil IS NULL`.** There's no separate boolean or
  enum for "permanent" — `isUserEffectivelySuspended()` (`src/utils/suspension.js`) treats a
  `null` `suspendedUntil` as permanent (always still-suspended) and a past `suspendedUntil` as
  expired (not suspended, even if `isSuspended` is stale-`true` in the DB — `authMiddleware`
  self-heals this on the next request).
  - `isUserEffectivelySuspended(user) = isSuspended && (!suspendedUntil || suspendedUntil > now)`.
- **`GET /api/reports` and `PATCH /api/reports/:reportId/status` are not admin-gated.**
  `report.route.js` only applies `authMiddleware` — any authenticated user can list every report
  on the platform (including reporter/target emails and names) and can set any report's
  `status`/`actionTaken`, attributing it to themselves as `reviewedBy`. The intended admin-only
  surface is the separate `/api/admin/reports` copy in `admin.route.js` (which does apply
  `requireAdmin`), but the non-admin route still exists and works. Worth confirming with the team
  whether this is intentional (e.g. some non-admin role is meant to triage reports) or a gap.
- **Flagged text has no in-app admin review UI.** `text_moderation.reviewedBy`/`reviewedAt` columns
  exist but nothing in the codebase writes them — unlike media (`reviewMediaModerationItem`),
  there's no `PATCH` endpoint to action a flagged text row. Moderators would have to use Stream's
  own dashboard review queue for text.
- **One appeal at a time.** `submitAppeal` rejects a new appeal while one is `pending`, and an
  appeal can only be reviewed once (`reviewAppeal` rejects if `status !== 'pending'`) — there's no
  re-open/re-appeal flow after a rejection; the user would need a fresh suspension event to get a
  new appeal.
- **Reused-media verdicts don't re-fire webhooks.** When a post/event/group is created with a
  media URL that was already moderated elsewhere (`adoptMediaVerdicts`), the verdict is copied
  from the existing `content_moderation` row for that file — no new Stream call. Owner
  notifications for event/group cover images are therefore triggered explicitly in this code path
  (comparing previous vs. new status) because the webhook path (`propagateMediaVerdict`) won't
  fire a second time for content that's simply referencing an already-resolved file.
- **Duplicate-report rules are inconsistent by design.** Post/group/event/social-chat/discussion
  reports are deduped via a DB unique constraint (one report per reporter per item). Comment
  reports are deduped via a `metadata` JSON lookup (no DB constraint — a race could theoretically
  slip a duplicate through). `user`-type reports are explicitly **not** deduped at all.
- **Idempotent verdict application.** `MediaModerationService.applyVerdict` is a no-op if the
  status is unchanged **and** there are no new labels — this specifically exists because
  `moderation_check.completed` fires first with no labels, then `review_queue_item.new/updated`
  fires with the same status but the real labels; without the labels-length check the second event
  would have been dropped as a redundant no-op and labels lost.

## Common Tasks

- **Add moderation to a new text-writing surface**: import `TextModerationService`, `TEXT_ENTITY`
  (add a new entry if needed) from `src/services/moderation/textModeration.service.js`. Call
  `assertAllowed({ entityType, entityId, entityCreatorId, texts: [...] })` before persisting;
  persist whatever it returns in `texts` if you passed `mask: true`. After the row is saved, call
  `TextModerationService.recordIfFlagged(moderationResult, { entityType, entityId, userId,
  fieldNames, texts })` so flags actually get recorded. If the surface should never block (support/
  report-style text), use `flagAsync` instead of `assertAllowed` and skip the throw-handling.
- **Add moderation to a new media-bearing entity**: add an entry to `MEDIA_ENTITY` and `ENTITY_FK`
  in `mediaModeration.service.js`, add the FK column + unique index to `content_moderation`
  (migration), call `MediaModerationService.enqueue(...)` (new files) or
  `adoptMediaVerdicts(...)` (files that may already be moderated) at creation time, and add a
  `... AND status NOT IN (pending, rejected, shadowed, skipped, error)` gate to whatever query
  lists that entity for other users (see the `*ModerationGate` SQL fragments for the pattern).
- **Change what gets auto-blocked vs flagged**: edit the rule tables in
  `scripts/setup-moderation-config.js` and re-run it (`node scripts/setup-moderation-config.js`,
  needs `USE_AWS_SECRETS`/Stream creds) — it's idempotent (`upsertConfig`). Verify in Stream
  Dashboard → Moderation → Policies afterward; the script prints the active sync policy JSON at
  the end.
- **Manually override a stuck/wrong media verdict**: `PATCH /api/admin/moderation/media/:id/action`
  with `{ action: 'keep'|'flag'|'remove'|'shadow'|'shadow_block', reason }` — replays
  `applyVerdict` exactly as a real webhook would (S3 ACL flip + cascade), so it's safe to use for
  correcting a bad Stream call.
- **Suspend a user for a fixed period**: `PATCH /api/admin/users/:userId/suspension` with
  `{ isSuspended: true, reason, duration: <days> }`. Omit `duration` for a permanent suspension.
- **Look up why a user is/was suspended**: check `users.suspensionReason` /
  `users.suspendedUntil` first; if empty despite `isSuspended: true`, check `audit_logs` for a
  `SUSPEND_USER_VIA_REPORT` entry (the report-resolution path doesn't set a reason) and cross-
  reference `user_reports` for the underlying report.
- **Investigate a flagged-but-not-removed piece of text**: query `text_moderation` by
  `entityType`/`entityId`; `fields.<name>.matchedWords` and `labels`/`severity` explain the trigger.
  There's no in-app action endpoint for this today (see Gotchas) — resolve via the content's own
  delete/edit endpoint, or Stream's dashboard.

## Related Modules

- [01-auth-users.md](./01-auth-users.md) — suspension enforcement lives in
  `src/middlewares/auth.middleware.js`; user account fields (`isSuspended`, `suspendedUntil`,
  `suspensionReason`) are part of the core `users` schema documented there.
- [10-getstream-realtime.md](./10-getstream-realtime.md) — the GetStream client, webhook signature
  verification, and webhook routing/dispatch plumbing that this module's async media/text verdicts
  and call-frame moderation ride on.
- [12-admin.md](./12-admin.md) — the broader admin console; this doc covers only the
  moderation-specific slice of `admin.controller.js`/`admin.service.js`/`admin.route.js`.
- [08-dashboards-analytics.md](./08-dashboards-analytics.md) — report/suspension/appeal counts and
  trends as surfaced on admin dashboards (`getReportStatistics`, activity logs, etc.).
- [03-groups.md](./03-groups.md) — group-level discussion moderation
  (`GET/POST /api/groups/:groupId/reported-discussions*`), group cover-image moderation gating,
  and general group discussion/membership behavior.
- [04-social.md](./04-social.md) — feed/post/story/comment moderation gating in practice (feed
  queries, profile pages), and the `profanityFilterEnabled` viewer preference.
