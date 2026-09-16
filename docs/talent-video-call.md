# Talent Video Call Moderation — Reporting, Durable Screenshots & Recording Consent

## Context

Talent-session video calls (booker ↔ talent, via GetStream Video) already have a working **automated** moderation pipeline: Stream periodically captures frames from camera/screen-share, `TalentSessionService.submitFrameForModeration()`/`applyFrameVerdict()` (`src/services/talentSession.service.js`) runs them through image moderation, appends a verdict to `talentSessions.moderationEventsLog` (jsonb), escalates `talentSessions.moderationStatus` (worst-wins: approved→flagged→rejected→shadowed), and takes graduated action (warn → mute track → kick/block → end call). Admins can already list flagged sessions via `GET /api/admin/moderation/calls` (`TalentSessionService.listModeratedSessions`).

Three real gaps remain, confirmed with the user:

1. **No way for a user to report a call.** The generic report system (`user_reports` table, `report.controller.js`/`route.js`, enum `report_type` = user/post/group/event/comment/social_chat/discussion) has no `talent_session` type — a booker or talent can't flag a specific session for support review today.
2. **Frame "screenshots" aren't durably stored.** `moderationEventsLog` stores a `frameUrl` per event, but that URL is Stream-hosted and only bridged locally via an in-memory 5-minute-TTL cache (`pendingFrameUrls` in `talentSession.service.js`) to connect the sync moderation check to its async webhook — there's no guarantee that URL stays valid/accessible for support to review later, and no admin media viewer beyond the raw JSON.
3. **No recording consent/disclosure anywhere.** Frame recording is already enabled by default on every call (`frame_recording: auto-on` when the call is registered in `TalentSessionService.confirm()`), but there's no consent field, timestamp, or disclosure text in the schema or validations — a real legal/trust gap since users aren't told the call may capture frames.

Confirmed direction: extend the **existing** `user_reports` system (not a parallel one) to support reporting a talent session; **archive frames to our own S3** (reusing the existing private-bucket pattern from `src/services/moderation/mediaModeration.service.js`) so support has durable evidence; **add explicit recording consent/disclosure**, gating call-join on acknowledgment; and rely on the **existing** auto-captured moderation frames for support review rather than building a new on-demand live-capture tool.

## 1. Reporting a talent session (extend existing system)

- `src/db/schema/userReports.js`: add `'talent_session'` to `reportTypeEnum` (migration: `ALTER TYPE report_type ADD VALUE`), add `talentSessionId` uuid column (FK → `talentSessions.id`, `onDelete: 'cascade'`), add `unique('unique_talent_session_report').on(reporterId, talentSessionId)` and `index('idx_reports_talent_session')` — same shape as the existing per-entity unique constraints. Add the `talentSession: one(...)` relation alongside the existing `post`/`group`/`event` relations.
- `src/validations/report.validation.js` (or wherever report payloads are validated) — accept `type: 'talent_session'` + `talentSessionId`.
- `src/controllers/report.controller.js` — when `type === 'talent_session'`, verify the reporter is either the `bookerId` or the talent's `userId` on that session (authorization check mirroring how other report types confirm the target exists) before inserting.
- Admin review: extend the existing admin report detail view (wherever `report.controller.js`'s admin-side read lives, alongside `admin.controller.js`) so a `talent_session`-type report also returns the session's `moderationStatus`, `moderationEventsLog`, its archived flagged/rejected frames (section 2), **and** its random report-screenshot set (section 2b) inline — support shouldn't have to cross-reference `GET /api/admin/moderation/calls` separately when reviewing a specific report. The admin panel report detail page renders both frame sets as an image gallery (thumbnail grid → click to open full-size via the presigned URL), labeled separately ("Flagged frames" vs. "Random spot-checks") so reviewers know which images came from an automated flag vs. routine sampling.

## 2. Durable screenshot archival

- New file `src/db/schema/talentSessionFrames.js` — table `talent_session_frames`: `id` uuid PK, `sessionId` FK → `talentSessions.id` (`onDelete: cascade`), `trackType` varchar, `participantId` uuid, `s3Bucket` varchar, `s3Key` varchar, `moderationAction` varchar, `reviewQueueItemId` varchar NULL, `capturedAt` timestamptz, `createdAt` timestamptz default now(). Indexed on `sessionId`.
- In `TalentSessionService.applyFrameVerdict()` (`src/services/talentSession.service.js`, ~line 1803), after computing the verdict and before/alongside appending to `moderationEventsLog`: download the frame from the transient Stream `frameUrl` and `PutObjectCommand` it into the **existing private moderation bucket** (same bucket/credentials pattern as `src/services/moderation/mediaModeration.service.js`, key convention e.g. `call-moderation/{sessionId}/{trackType}-{participantId}-{capturedAt}.jpg`), then insert a `talentSessionFrames` row. Keep `moderationEventsLog` as the fast worst-wins/audit trail (it can keep the same event shape, optionally dropping the raw external `frameUrl` in favor of a `frameId` referencing the new table) — this only changes _where the image bytes live_, not the existing status-escalation logic.
- Bound storage cost the same way the graduated-action logic already does: archive frames for `flagged`/`rejected`/`shadowed`/`shadow_block` verdicts (i.e., anything that already produces a log event today) — not every routine "approved" frame. (Section 2b adds a second, small archival path for routine "approved" frames that are randomly selected as report screenshots.)
- Add a `reason` varchar column to `talent_session_frames` (`'moderation_flag'` | `'report_sample'`) so the two archival paths (flag-triggered vs. random-sample) share one table/S3 prefix but stay distinguishable in the admin gallery and in storage-cost accounting.
- Admin viewing: never return a permanent/public URL. Add a small helper (mirroring the presigned-URL pattern already used in `shopDeliverable.service.js`/`imports/presign.service.js`) that generates a short-TTL (~15 min) `GetObjectCommand` presigned URL **on demand** when an admin opens a session's moderation detail or a `talent_session` report — either inline in `listModeratedSessions`/the report detail response, or via a small `GET /api/admin/moderation/frames/:frameId/signed-url` endpoint if generating all URLs eagerly is wasteful.

## 2b. Randomized report screenshots (spot-check sampling, independent of moderation verdict)

Beyond the flag-triggered archival above, product also wants a small, randomly-timed set of screenshots per call — routine evidence for support to spot-check, regardless of whether any frame was ever flagged.

**Constraint confirmed against the GetStream Node SDK (`@stream-io/node-sdk`):** frame recording only exposes `startFrameRecording` / `stopFrameRecording` (`VideoApi.ts`) — no interval parameter, no on-demand "capture one frame right now" call. The capture cadence is a fixed setting on the call type's frame-recording config (currently "every few seconds," per the existing comment in `applyFrameVerdict()`), the same for every call. Stream cannot be told to capture at specific, arbitrary, per-call-randomized timestamps.

**Chosen approach: sample from the existing continuous capture, don't try to control its timing.** Stream keeps capturing a frame every few seconds exactly as it does today (unchanged — this also keeps the existing continuous moderation coverage intact, per the "additive" decision above). We independently pick which of those already-arriving frames count as "report screenshots":

- On session start (`confirm()`/call-join, wherever `applyFrameVerdict()` first has the session's `durationMins`), compute a list of random target offsets (seconds from call start) once per session:
  - Target count scales with call length: `count = clamp(round(durationMins / 10 * 10), 8, 12 scaled proportionally for longer calls)` — i.e. ~8–12 per 10 minutes, growing roughly linearly for longer bookings (e.g. a 30 min call → ~24–36 targets) rather than capping at 12 regardless of duration.
  - Offsets are drawn randomly (uniform jitter within evenly-spaced buckets, e.g. one random offset per `durationSeconds / count` bucket) so they land at varied, unpredictable points like ~0:30, ~1:20, ~1:50, ~3:00, etc., rather than a fixed cadence — avoids someone timing "safe" behavior around a predictable capture schedule.
  - Store the target-offset list somewhere cheap to read on every incoming frame — e.g. a `reportScreenshotTargets` jsonb column on `talentSessions` (offsets + a `consumed: boolean` per entry), set once at session start.
- In `applyFrameVerdict()` (or the webhook handler feeding it), for every incoming frame — not just flagged ones — compute `secondsSinceCallStart` and check whether it falls within a small tolerance window (e.g. ±5s, matching the "every few seconds" capture rate) of the next unconsumed target offset. If so: mark that target `consumed`, archive the frame to S3 with `reason: 'report_sample'` (same helper/bucket/key convention as section 2, regardless of the frame's own moderation verdict — even "approved" frames get archived when they land on a target), and insert the `talentSessionFrames` row.
- This reuses the moderation pipeline's own webhook cadence as the "clock" — no separate scheduler/cron needed, and it self-corrects if frames arrive late/irregularly (first frame inside the tolerance window wins; if none lands in a window before the next target, that slot is simply skipped rather than over- or under-shooting the count).
- Screenshots captured this way still flow through the existing moderation check first (per the "also moderated" decision above) — a `report_sample` frame that also happens to be flagged/rejected is archived once, tagged with both signals (`reason` could be an array, or keep `reason: 'moderation_flag'` when both apply since that's the stronger signal for the admin gallery's default filter).

## Verification (section 2b)

- Book test sessions at a few different `durationMins` (e.g. 10, 30, 60) and confirm the target-offset count scales roughly linearly (not capped at 12) and offsets are non-uniformly spaced (not a fixed interval).
- Run a full test call and confirm the resulting `talent_session_frames` rows with `reason: 'report_sample'` land close to (within the tolerance window of) their target offsets, and that the count matches expectations for that call's duration.
- Confirm a session with zero moderation flags still produces its full random report-screenshot set (i.e. sampling doesn't depend on anything being flagged).

## 3. Recording consent & disclosure

- `src/db/schema/talentSessions.js`: add `bookerRecordingConsentAt` timestamptz NULL, `talentRecordingConsentAt` timestamptz NULL, `recordingDisclosureVersion` varchar NULL (tracks which disclosure text version was shown, so future copy changes can be audited/re-prompted).
- New endpoint `POST /api/talent-sessions/:id/acknowledge-recording` (`authMiddleware`, caller must be the session's `bookerId` or the talent's `userId`) stamps the caller's consent timestamp + records the current disclosure version.
- Gate call access on consent: wherever the Stream call-join token is issued for a talent session (`stream.controller.js` / the join step in `talentSession.service.js`), reject (with a clear error telling the client to show the disclosure first) if the requesting party's consent timestamp is not yet set. This forces the client to show a "this call may be recorded for safety/moderation" disclosure and call the acknowledge endpoint before it can obtain a join token — for both booker and talent independently, since they join at different times.

## 4. Phased rollout

**Phase 1 — Schema**

- `userReports.js`: enum value + `talentSessionId` column + unique/index + relation
- `talentSessions.js`: three new consent/disclosure columns + `reportScreenshotTargets` jsonb (random offset list, computed once at session start)
- New `talentSessionFrames.js` table, including the `reason` (`'moderation_flag'` | `'report_sample'`) column
- Migrations via `drizzle-kit generate`; update `src/db/schema/index.js`/`relations.js`

**Phase 2 — Durable frame archival**

- Wire S3 archival into `applyFrameVerdict()`, insert `talentSessionFrames` rows for flagged/rejected/shadowed verdicts (`reason: 'moderation_flag'`)
- Add the presigned-URL helper for admin viewing

**Phase 2b — Randomized report screenshots**

- Compute `reportScreenshotTargets` (random offsets, count scaling with `durationMins`) once per session at call start
- Extend `applyFrameVerdict()`/the webhook handler to check every incoming frame (not just flagged ones) against the next unconsumed target offset and archive on match (`reason: 'report_sample'`)
- Surface the `report_sample` frame set alongside `moderation_flag` frames wherever section 2's frames are returned (admin moderation list, report detail)

**Phase 3 — Reporting**

- Extend report validation/controller/route for `talent_session` type + authorization check
- Extend admin report detail to surface linked session + both frame sets (flagged + random sample)
- Admin panel report page: render the two frame sets as a labeled image gallery (thumbnail grid, click-through to full size via presigned URL)

**Phase 4 — Consent gate**

- `acknowledge-recording` endpoint
- Gate join-token issuance on consent timestamp for both parties
- (Frontend disclosure UI/copy is outside this API repo's scope but should be coordinated)

## Verification

- Submit a `talent_session` report as the booker and as the talent on a test session; confirm it lands in `user_reports` with the FK populated, and that the admin report detail view shows the session's moderation history + both frame sets.
- Trigger a test frame verdict (flagged/rejected) and confirm an object lands in S3 and a `talent_session_frames` row is created with `reason: 'moderation_flag'`; confirm a presigned URL for it is retrievable by an admin call and expires after ~15 minutes.
- Run a full test call with zero flags and confirm the random `report_sample` set is still archived per section 2b's verification steps, and that the admin panel report page's image gallery renders it.
- Attempt to fetch a call-join token without calling `acknowledge-recording` first → rejected; call it, then retry → succeeds. Verify booker and talent are gated independently.

## Open items to revisit during implementation

- ~~Exact location of the Stream call-join-token issuance code path~~ — **resolved during implementation**: `GET /api/stream/generateToken` (`stream.controller.js`/`stream.service.js`) is a generic, session-unaware endpoint shared by every call type (talent sessions, DM calls, livestreams) and issues a token from just the caller's user id — it has no way to know which session a request is for, so it cannot itself be gated per session. The consent gate was instead added to `TalentSessionService.recordJoin()` (`POST /talent/sessions/:sessionId/join`), the one existing per-session, per-party checkpoint (it already enforces "is this user a participant" + the join-window check). `acknowledge-recording` writes the consent timestamp; `recordJoin` reads it and rejects with `428` if missing, independently for booker/talent.
- Whether existing sessions created before this change (no consent timestamps) need a backfill/grandfathering rule, or simply prompt on next join — **not resolved**; current behavior is "prompt on next join" (no backfill), since `recordJoin` will 428 any session missing the relevant party's consent timestamp, old or new.
- Exact scaling formula for report-screenshot count vs. `durationMins` (implemented as `count = max(8, round(durationMins/10 * 10))`, i.e. ~8-12 per 10 minutes, linear beyond that) — confirm the precise curve/cap with product.
- Tolerance window implemented as ±7s (Stream's capture interval is a confirmed 5s, set in `scripts/setup-frame-recording.js` and inherited by the `talent-session` call type) — confirm this is wide enough in practice once real capture-timing data exists.
- Confirm whether "approved" frames archived only because they hit a `report_sample` target should count against the same storage-cost budget as flagged frames, or be tracked/rotated (e.g. shorter retention) separately — not addressed; both reasons currently share the same `call-moderation/{sessionId}/...` S3 prefix and no retention/lifecycle policy was added.
