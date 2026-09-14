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
- Admin review: extend the existing admin report detail view (wherever `report.controller.js`'s admin-side read lives, alongside `admin.controller.js`) so a `talent_session`-type report also returns the session's `moderationStatus`, `moderationEventsLog`, and its archived frames (section 2) inline — support shouldn't have to cross-reference `GET /api/admin/moderation/calls` separately when reviewing a specific report.

## 2. Durable screenshot archival

- New file `src/db/schema/talentSessionFrames.js` — table `talent_session_frames`: `id` uuid PK, `sessionId` FK → `talentSessions.id` (`onDelete: cascade`), `trackType` varchar, `participantId` uuid, `s3Bucket` varchar, `s3Key` varchar, `moderationAction` varchar, `reviewQueueItemId` varchar NULL, `capturedAt` timestamptz, `createdAt` timestamptz default now(). Indexed on `sessionId`.
- In `TalentSessionService.applyFrameVerdict()` (`src/services/talentSession.service.js`, ~line 1803), after computing the verdict and before/alongside appending to `moderationEventsLog`: download the frame from the transient Stream `frameUrl` and `PutObjectCommand` it into the **existing private moderation bucket** (same bucket/credentials pattern as `src/services/moderation/mediaModeration.service.js`, key convention e.g. `call-moderation/{sessionId}/{trackType}-{participantId}-{capturedAt}.jpg`), then insert a `talentSessionFrames` row. Keep `moderationEventsLog` as the fast worst-wins/audit trail (it can keep the same event shape, optionally dropping the raw external `frameUrl` in favor of a `frameId` referencing the new table) — this only changes _where the image bytes live_, not the existing status-escalation logic.
- Bound storage cost the same way the graduated-action logic already does: archive frames for `flagged`/`rejected`/`shadowed`/`shadow_block` verdicts (i.e., anything that already produces a log event today) — not every routine "approved" frame.
- Admin viewing: never return a permanent/public URL. Add a small helper (mirroring the presigned-URL pattern already used in `shopDeliverable.service.js`/`imports/presign.service.js`) that generates a short-TTL (~15 min) `GetObjectCommand` presigned URL **on demand** when an admin opens a session's moderation detail or a `talent_session` report — either inline in `listModeratedSessions`/the report detail response, or via a small `GET /api/admin/moderation/frames/:frameId/signed-url` endpoint if generating all URLs eagerly is wasteful.

## 3. Recording consent & disclosure

- `src/db/schema/talentSessions.js`: add `bookerRecordingConsentAt` timestamptz NULL, `talentRecordingConsentAt` timestamptz NULL, `recordingDisclosureVersion` varchar NULL (tracks which disclosure text version was shown, so future copy changes can be audited/re-prompted).
- New endpoint `POST /api/talent-sessions/:id/acknowledge-recording` (`authMiddleware`, caller must be the session's `bookerId` or the talent's `userId`) stamps the caller's consent timestamp + records the current disclosure version.
- Gate call access on consent: wherever the Stream call-join token is issued for a talent session (`stream.controller.js` / the join step in `talentSession.service.js`), reject (with a clear error telling the client to show the disclosure first) if the requesting party's consent timestamp is not yet set. This forces the client to show a "this call may be recorded for safety/moderation" disclosure and call the acknowledge endpoint before it can obtain a join token — for both booker and talent independently, since they join at different times.

## 4. Phased rollout

**Phase 1 — Schema**

- `userReports.js`: enum value + `talentSessionId` column + unique/index + relation
- `talentSessions.js`: three new consent/disclosure columns
- New `talentSessionFrames.js` table
- Migrations via `drizzle-kit generate`; update `src/db/schema/index.js`/`relations.js`

**Phase 2 — Durable frame archival**

- Wire S3 archival into `applyFrameVerdict()`, insert `talentSessionFrames` rows
- Add the presigned-URL helper for admin viewing

**Phase 3 — Reporting**

- Extend report validation/controller/route for `talent_session` type + authorization check
- Extend admin report detail to surface linked session + frames

**Phase 4 — Consent gate**

- `acknowledge-recording` endpoint
- Gate join-token issuance on consent timestamp for both parties
- (Frontend disclosure UI/copy is outside this API repo's scope but should be coordinated)

## Verification

- Submit a `talent_session` report as the booker and as the talent on a test session; confirm it lands in `user_reports` with the FK populated, and that the admin report detail view shows the session's moderation history + frame list.
- Trigger a test frame verdict (flagged/rejected) and confirm an object lands in S3 and a `talent_session_frames` row is created; confirm a presigned URL for it is retrievable by an admin call and expires after ~15 minutes.
- Attempt to fetch a call-join token without calling `acknowledge-recording` first → rejected; call it, then retry → succeeds. Verify booker and talent are gated independently.

## Open items to revisit during implementation

- Exact location of the Stream call-join-token issuance code path to add the consent gate (`stream.controller.js` vs. a method inside `talentSession.service.js` — confirm during implementation).
- Whether existing sessions created before this change (no consent timestamps) need a backfill/grandfathering rule, or simply prompt on next join.
