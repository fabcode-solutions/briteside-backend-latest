# Talent — KT

## Overview

"Talent" is BriteSide's creator/performer marketplace: any user can create a **talent profile**
(a public, bookable page showing bio, rates, media, languages, skills, reviews) and sell **1:1 paid
video sessions** ("bookings") to other users. It is a separate concept from **organizers/venues**
(who run ticketed events — see [06-organizers-venues.md](./06-organizers-venues.md)) and from
**posts/social profiles** (see [04-social.md](./04-social.md)); a single user account can be a
regular user, an event organizer, *and* a talent all at once — `talentProfiles` is keyed 1:1 off
`users.id`, not a separate account type.

Talent does not currently intersect with **events** in the DB — there is no FK between
`talentSessions`/`talentProfiles` and the `events` tables. The "booked events" endpoint
(`GET /api/talent/me/booked-events`) is a UI convenience that merges a user's ticket orders
(`OrderService.listUserOrders`) and their talent sessions into one "my bookings" list — it doesn't
mean talent sessions belong to events.

Monetization is gated by **BriteSide Plus** subscription features (`src/constants/features.js`):
`TALENT_PROFILE`, `VIDEO_BOOKING`, `PRIORITY_MESSAGING`, `VERIFIED_BADGE`. Creating a profile itself
is *not* gated in the route layer (`POST /api/talent/me/profile` only requires `authMiddleware`),
but confirming/accepting a video booking (`requireFeature(FEATURES.VIDEO_BOOKING)`) and viewing the
dashboard (`requireActiveSubscription`) are. `TalentSessionService.createCheckout`/`book` also
double-check the talent's `VIDEO_BOOKING` feature server-side before letting anyone pay — see
Business Rules below.

### Important: there is no `talent.service.js`

`src/controllers/talent.controller.js` looks like it should pair with a `talent.service.js`, but no
such file exists. Its imports (lines 11–20) reveal the real home of the logic:

```js
import {
  TalentProfileService,
  TalentAvailabilityService,
  TalentSessionService,
  TalentReviewService,
  TalentFavoritesService,
  TalentProfileShareService,
  listTalentProfiles as listTalentProfilesService,
} from '../services/talentSession.service.js';
```

**All core talent CRUD (profiles, availability, sessions, reviews, favorites, profile-share count)
lives in one ~3,670-line file: `src/services/talentSession.service.js`.** It exports six classes
plus two standalone functions (`listTalentProfiles`, `listSessionsForUser` — the latter appears
unused by the controller, which calls the `TalentSessionService.listForUser` instance method
instead; treat `listSessionsForUser` as legacy/dead code, don't extend it blindly).

Talent *disputes* and *earnings/payouts* are split into their own service files (`talentIssue.service.js`,
`talentEarnings.service.js`) — those do follow the expected one-file-per-controller convention.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/talent.route.js` | All talent profile/availability/session/review/favorite/share endpoints, plus (re-exported here) Stripe Connect + earnings + wallet + payout-method endpoints from `talentEarnings.controller.js`. Mounted at `/api/talent`. |
| `src/routes/talentIssue.route.js` | Customer-facing dispute endpoints. Mounted at `/api/talent-issues`. |
| `src/routes/admin.route.js` | Admin endpoints for talent issues (`/talent-issues*`), reported reviews (`/talent-reviews*`), and per-talent admin dashboard stats (`/talent/:talentProfileId/dashboard-stats`). Mounted at `/api/admin`. |
| `src/controllers/talent.controller.js` | Thin HTTP layer for profiles/availability/sessions/reviews/favorites/dashboard stats. No business logic. |
| `src/controllers/talentIssue.controller.js` | HTTP layer for issue create/list/admin-resolve. |
| `src/controllers/talentEarnings.controller.js` | HTTP layer for Stripe Connect onboarding, earnings, wallet, payout methods. Full detail: [07-payments-stripe.md](./07-payments-stripe.md). |
| `src/services/talentSession.service.js` | **The real "talent.service.js".** Exports `TalentProfileService`, `TalentAvailabilityService`, `TalentSessionService`, `TalentProfileShareService`, `TalentFavoritesService`, `TalentReviewService`, plus `listTalentProfiles()`. Also handles Stripe Checkout for sessions, GetStream call creation/moderation for live sessions, and gift-code redemption hooks. |
| `src/services/talentIssue.service.js` | `TalentIssueService` — dispute creation, eligibility lookup, admin resolution (refund/warn/dismiss). |
| `src/services/talentEarnings.service.js` | `TalentEarningsService` — earnings chart/summary, wallet, cashout requests, payout history. See [07-payments-stripe.md](./07-payments-stripe.md). |
| `src/services/giftCode.service.js` | `GiftCodeService` — generate/validate/redeem/email gift codes for talent sessions (backs the `talentGiftCodes` table). |
| `src/db/schema/talentProfiles.js` | The talent profile table — 1:1 with `users`, rates as jsonb, generated `tsvector` search column. |
| `src/db/schema/talentAvailability.js` | Recurring weekly availability windows. |
| `src/db/schema/talentDateOverrides.js` | Per-date overrides (block a day, or replace that day's windows). |
| `src/db/schema/talentFavorites.js` | User ↔ talent-profile favorites (unique per pair). |
| `src/db/schema/talentGiftCodes.js` | Gift vouchers for sessions. |
| `src/db/schema/talentIssues.js` | Customer disputes against a talent (session or priority message). |
| `src/db/schema/talentReviews.js` | Reviews left by bookers/priority-message senders. |
| `src/db/schema/talentSessions.js` | One row per booked 1:1 session — the central talent table. |
| `src/cron/sessionEmails.js` | Pure email-template builders (`reminder24h`, `sessionConfirmedForBooker`, `talentNoShowForBooker`, etc.) — no DB access, imported by both `talentSession.service.js` and `sessionReminders.js`. |
| `src/cron/sessionReminders.js` | The actual scheduled jobs: 24h/1h/15m/1m reminders, no-show auto-cancel, expired-pending auto-cancel, auto-end live sessions past duration, 24h post-session review-reminder email. Registered in `src/cron/cronJobs.js`. |
| `src/constants/features.js` | `FEATURES.TALENT_PROFILE` / `VIDEO_BOOKING` / `PRIORITY_MESSAGING` / `VERIFIED_BADGE` — the BriteSide Plus gates talent functionality checks against. |

## Data Model

```
users ──1:1── talentProfiles ──1:N── talentAvailability
                   │                 talentDateOverrides
                   │                 talentFavorites (N:M with users)
                   │                 talentGiftCodes
                   │                 talentReviews
                   │                 talentSessions ──1:1── talentReviews (via sessionId)
                   │                                  ──1:1── talentGiftCodes (via redeemedSessionId)
                   └── priorityMessagePayments (separate feature, cross-referenced by talentIssues/talentReviews)
```

| Table | Key columns | Notes |
|---|---|---|
| `talent_profiles` | `id`, `userId` (unique FK → users, cascade), `category`, `title`, `bio`, `rates` (jsonb `{"15":100,"30":180,...}` dollars-as-numbers, not cents), `languages`/`experience`/`education`/`qualifications`/`skills` (jsonb arrays), `isVerified`, `isActive`, `rating` (decimal, recomputed from reviews), `reviewCount`, `totalSessions`, `priorityMessageFee` (cents), `shareCount`, `deletedAt` (soft delete), `talentSearch` (generated `tsvector`, GIN-indexed) | One profile per user (`unique` on `userId`). `talentSearch` auto-recomputes from `category`+`title`+`bio` on every write — don't try to write to it. |
| `talent_availability` | `id`, `talentProfileId`, `dayOfWeek` (jsonb int array, 0=Sun..6=Sat), `startTime`/`endTime` (`"HH:MM"`, in the talent's local `timezone`), `timezone` (IANA string), `durations` (jsonb int array, e.g. `[15,30,45,60]`), `priceOverrides` (jsonb `{"09:00-12:00":1.2}` multiplier map), `blockedDates` (jsonb date-string array), `isActive` | Recurring **weekly** pattern. A talent can have multiple rows (e.g. one for Mon–Fri, another for weekends with different hours/prices). |
| `talent_date_overrides` | `id`, `talentProfileId`, `overrideDate` (date), `isBlocked`, `startTime`/`endTime` (null when blocked) | Per-**date** exceptions. See interaction rule below. |
| `talent_favorites` | `id`, `userId`, `talentProfileId` | Unique on `(userId, talentProfileId)`. |
| `talent_gift_codes` | `id`, `gifterId`, `talentProfileId`, `code` (unique, `GIFT-XXXXXXXX`), `durationMins`, `priceCents` (locked at purchase), `recipient*`, `status` (`active`/`redeemed`/`expired`/`cancelled`), `redeemedSessionId`, `expiresAt` (1 year from generation) | |
| `talent_issues` | `id`, `reporterId`, `talentUserId`, `talentProfileId`, `entityType` (`session`\|`priority_message`), `entityId` (no DB FK — points at two different tables depending on `entityType`, enforced only in the service), `reason` (`no_reply`\|`no_show`\|`no_attend`\|`other`), `message`, `amountCents`/`stripePaymentIntentId` (snapshotted at creation), `status` (`pending`\|`resolved`\|`dismissed`), `adminId`, `adminNote`, `refundIssued`, `refundAmountCents`, `stripeRefundId`, `warningIssued`, `resolvedAt` | |
| `talent_reviews` | `id`, `talentProfileId`, `reviewerId`, `sourceType` (`session`\|`priority_message`), `sessionId` (unique, nullable), `priorityMessageId` (nullable, partial-unique in migration SQL), `rating` (1–5, DB `check`), `communicationRating`/`valueRating` (optional 1–5), `title`, `comment`, `isVisible`, `reportedAt`, `reportReason` | Exactly one of `sessionId`/`priorityMessageId` is set per row. |
| `talent_sessions` | `id`, `talentProfileId`, `bookerId`, `scheduledAt`, `durationMins`, `joinAllowedAt` (`scheduledAt - 5min`, or `-3min` for the legacy `book()` path), `bookerJoinedAt`/`talentJoinedAt`, `billingStartedAt`/`billingEndedAt`, `actualDurationMins`, `priceCents` (locked at booking), `status`, `subject`, `discussion`, `isGift`/`giftDetails`/`giftCode`, `streamCallCid`, `moderationStatus`/`moderationEventsLog` (call frame moderation), `stripeSessionId`/`stripePaymentIntentId`/`transferId`/`transferredAt`, five `reminder*SentAt` flags + `reviewReminderSentAt`, `cancelledBy`/`cancellationReason`/`refundIssuedAt`, `rescheduledFromId`, `reserveAmountCents`/`platformShareCents`/`stripeFeeCents`, `bookerCallRating`/`bookerCallFeedback`/`talentCallRating`/`talentCallFeedback` | The central table — see status lifecycle below. |

### `talentAvailability` vs `talentDateOverrides`

Both feed `TalentAvailabilityService.getAvailableSlots(talentProfileId, date, durationMins)`
(`src/services/talentSession.service.js:820`), which is the single source of truth for "what times
can this talent be booked on this date." Priority order, checked in this sequence:

1. **Blocked override wins first.** If any `talentDateOverrides` row for that exact date has
   `isBlocked = true`, return `[]` immediately — no slots, regardless of weekly availability.
2. **Date-specific override slots, if present, fully replace the weekly pattern for that date.**
   If there are non-blocked override rows for the date, `getAvailableSlots` uses **only** those
   rows' `startTime`/`endTime` windows — it does not also consult `talentAvailability` for that day.
3. **Otherwise, fall back to the recurring weekly `talentAvailability` rows** matching that date's
   day-of-week (computed in UTC via `new Date(`${date}T12:00:00Z`).getUTCDay()` specifically to
   avoid server-timezone date-shift bugs near midnight) and containing the requested `durationMins`.
   `blockedDates` (an array column *on* `talentAvailability` itself) is also checked here as an
   older/alternate way to exclude a single date from a weekly window.
4. Slots are then generated by walking each matching window in `durationMins` increments, pricing
   each via `priceOverrides` multipliers, and marking a slot unavailable if it overlaps an existing
   non-cancelled `talentSessions` row for that talent on that day (statuses `awaiting_payment`,
   `pending`, `confirmed`, `live` all block the slot).

In short: **`talentDateOverrides` is an all-or-nothing swap per date** (either "day fully blocked"
or "day's windows replaced with these specific ones"), while **`talentAvailability` is the
recurring default** used whenever no override exists for that date. `TalentAvailabilityService.saveSchedule`
(the endpoint behind `PUT /api/talent/me/schedule`) writes to both in one call: it fully replaces
all `talentAvailability` rows for the profile, then upserts any `dateOverrides` passed in via
`upsertDateOverrides` (which deletes-then-reinserts per date, so it's idempotent per date).

Note `getAvailableSlots` currently contains verbose `console.log('=== SLOTS DEBUG ===', ...)` /
`console.log('❌ RETURNING EARLY...')` debug statements left in the code
(`src/services/talentSession.service.js:826-997`) — noisy in production logs, not removed as of
this writing; be aware when grepping logs for booking issues.

## API Endpoints

All mounted under `/api` (`src/app.js:178`); talent routes are further mounted at `/api/talent`
and `/api/talent-issues` (`src/routes/index.js:135,149`). **Route order matters**: `talent.route.js`
explicitly comments that literal-segment routes (`/me/*`, `/sessions/*`, `/reviews/*`) must be
registered before the `/:profileId` wildcard, since Express matches top-to-bottom and would
otherwise treat `"sessions"` as a `profileId` value.

### Profiles, availability, favorites, discovery

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/talent` | optional | List/search/filter talent profiles (`category`, `minRating`, `language`, `search`, `minPrice`, `maxPrice`, `favoritesOnly`, `page`, `limit`). |
| POST | `/api/talent/me/profile` | required | Create the caller's talent profile (409 if one already exists). |
| PUT | `/api/talent/me/profile` | required | Update the caller's talent profile. |
| GET | `/api/talent/me/profile` | required | Get the caller's own talent profile. |
| PUT | `/api/talent/me/availability` | required | Replace weekly availability windows (raw upsert, no profile bootstrap). |
| GET | `/api/talent/me/availability` | required | Get the caller's weekly availability windows. |
| PUT | `/api/talent/me/schedule` | required | Combined "manage schedule" save: bootstrap-or-update profile + rates + windows + date overrides in one call. |
| GET | `/api/talent/:username` | optional | Get a public talent profile by username. |
| GET | `/api/talent/me/booked-events` | required | Merged "my bookings": ticket orders + talent sessions. |
| GET | `/api/talent/me/dashboard-stats` | required + active subscription | Influencer dashboard metrics (earnings, acceptance rate, monthly chart, recent sessions). |
| GET | `/api/talent/me/favorites/ids` | required | List of talent-profile IDs the caller has favorited. |
| GET | `/api/talent/me/reviews` | required | Reviews the caller has written (as a booker). |
| GET | `/api/talent/:profileId` | optional | Get a public talent profile by ID. |
| GET | `/api/talent/:profileId/availability` | none | Raw weekly availability windows for a profile. |
| GET | `/api/talent/:profileId/slots?date=&duration=` | none | Computed bookable time slots for a specific date + duration. |
| GET | `/api/talent/:profileId/reviews` | none | Visible reviews + rating breakdown for a profile (accepts a `talentProfileId` or `userId` in the path — resolves either). |
| POST | `/api/talent/:profileId/favorite` | required | Toggle favorite. |
| POST | `/api/talent/:profileId/share` | optional | Increment share count, returns a shareable URL. |

### Sessions (bookings)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/talent/sessions/checkout` | required | Create a Stripe Checkout session for a booking (redirect flow). |
| POST | `/api/talent/sessions/book` | required | Book directly without a Stripe redirect (legacy/alt path — no payment collection, see gotcha below). |
| GET | `/api/talent/sessions` | required | List the caller's sessions (`role=booker\|talent\|all`, `tab=upcoming\|pending\|past\|cancelled\|all`, `status`, `date`, pagination). |
| GET | `/api/talent/me/video-requests` | required + `VIDEO_BOOKING` feature | Pending session requests where the caller is the talent. |
| GET | `/api/talent/sessions/:sessionId` | required (participant only) | Get one session. |
| PUT | `/api/talent/sessions/:sessionId/confirm` | required + `VIDEO_BOOKING` feature | Talent accepts a pending request. |
| PUT | `/api/talent/sessions/:sessionId/decline` | required + `VIDEO_BOOKING` feature | Talent declines — triggers full refund. |
| PUT | `/api/talent/sessions/:sessionId/cancel` | required | Either party cancels — refund % depends on notice given (see Business Rules). |
| POST | `/api/talent/sessions/:sessionId/join` | required | Record a participant joining the call; starts billing once both have joined. |
| POST | `/api/talent/sessions/:sessionId/end` | required | End the session; stops billing clock and frame recording. |
| POST | `/api/talent/sessions/:sessionId/reschedule` | required (booker only) | Booker reschedules; old session → `rescheduled`, new one created `pending`. |
| POST | `/api/talent/sessions/:sessionId/review` | required (booker only) | Submit a review for a completed session. |
| GET | `/api/talent/sessions/:sessionId/review` | required (participant only) | Get the review for a session, if any. |
| POST | `/api/talent/sessions/:sessionId/call-feedback` | required (participant only) | Post-call quality rating (separate from the public review). |
| POST | `/api/talent/priority-messages/:paymentId/review` | required (sender only) | Submit a review after a paid priority message. |
| PATCH | `/api/talent/reviews/:reviewId` | required (own review only) | Edit a review. |
| POST | `/api/talent/reviews/:reviewId/report` | required (talent being reviewed only) | Flag a review as wrong/fake. |

### Disputes (`talentIssue.route.js`, mounted at `/api/talent-issues`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/talent-issues/eligible` | required | List the caller's sessions/priority messages eligible to dispute. |
| POST | `/api/talent-issues` | required | File a dispute against a session or priority message. |
| GET | `/api/talent-issues/mine` | required | List the caller's own filed disputes. |

### Admin (`admin.route.js`, mounted at `/api/admin`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/talent-issues` | admin | List all disputes (filter by `status`, `entityType`). |
| GET | `/api/admin/talent-issues/:issueId` | admin | Get one dispute with reporter/talent/admin relations. |
| PATCH | `/api/admin/talent-issues/:issueId/resolve` | admin | Resolve: `refund` (Stripe refund + warn talent), `warn` (no refund), or `dismiss`. |
| GET | `/api/admin/talent-reviews` | admin | List all reviews reported by talents. |
| PATCH | `/api/admin/talent-reviews/:reviewId/remove` | admin | Hide a review (`isVisible=false`) + recompute the talent's rating. |
| PATCH | `/api/admin/talent-reviews/:reviewId/dismiss` | admin | Dismiss a report, review stays visible. |
| GET | `/api/admin/talent/:talentProfileId/dashboard-stats` | admin | Same dashboard-stats payload as `/me/dashboard-stats`, for any talent. |

Earnings/payout endpoints (`/api/talent/me/stripe/connect*`, `/api/talent/me/earnings`,
`/api/talent/me/wallet*`, `/api/talent/me/payout-methods*`) are also mounted on this router but are
documented in full in [07-payments-stripe.md](./07-payments-stripe.md).

## Core Flows

### 1. Talent profile creation / verification

- **Two ways to create a profile:**
  - `POST /api/talent/me/profile` (`TalentProfileService.create`) — full form: `category`, `title`,
    `bio`, `rates`, `languages`, `experience`, `education`, `qualifications`, `skills`,
    `priorityMessageFee` (default 2000¢ = $20), `media`. 409s if a profile already exists for the user.
  - `PUT /api/talent/me/schedule` (`TalentAvailabilityService.saveSchedule`) — the "Manage Schedule"
    UI's combined save. If no profile exists yet, `title` + `category` are **required** in the body
    and a minimal profile is bootstrapped (`priorityMessageFee` defaults to 500¢ = $5, `isVerified: false`).
    Every subsequent call (profile now exists) just updates `rates`/`isActive` and replaces availability.
- **Validation on both paths:** any `rates` value below **$20** throws `400` — "Session rates must be
  at least $20" (checked in `create`, `update`, and `saveSchedule`).
- **Text moderation:** `title`/`bio` go through `TextModerationService.assertAllowed` before insert
  (entity `TEXT_ENTITY.PROFILE`) and flagged text is recorded against `TEXT_ENTITY.TALENT_PROFILE`
  after insert (`recordIfFlagged`). Reads (`getById`/`getByUsername`/`getByUserId`) call
  `maskFlaggedTextSingle` to hide/mask previously-flagged text per the viewer's filter setting. See
  [09-moderation.md](./09-moderation.md) for the text-moderation pipeline itself.
- **"Verification"** here means `talentProfiles.isVerified` (drives the `VERIFIED_BADGE` display) —
  it is a boolean column with **no dedicated verification endpoint or workflow** in this codebase;
  it must currently be flipped directly in the DB or via a future admin action (not present as of
  this writing). Don't confuse it with subscription-feature gating (`FEATURES.VERIFIED_BADGE`),
  which is a separate BriteSide Plus entitlement check, not what sets this column.
- **Stripe Connect account** is created fire-and-forget on profile creation (`create`, not
  `saveSchedule`) — prefilled with the user's email, `businessType: 'individual'`. Failures are
  logged, not thrown (a talent without a Connect account yet can still receive bookings; payouts
  just route through the platform balance until they onboard — see [07-payments-stripe.md](./07-payments-stripe.md)).

### 2. Setting availability + booking a session

1. Talent sets weekly windows via `PUT /me/availability` (raw) or `PUT /me/schedule` (combined),
   optionally adding per-date overrides (block a day, or swap that day's hours) via the same
   `saveSchedule` call's `dateOverrides` array.
2. Booker calls `GET /:profileId/slots?date=YYYY-MM-DD&duration=15|30|45|60` →
   `TalentAvailabilityService.getAvailableSlots` returns `[{ time, durationMins, priceCents, available }]`
   per the override/weekly resolution described above, with already-booked times marked `available: false`.
3. Booker either:
   - `POST /sessions/checkout` (`TalentSessionService.createCheckout`) — re-validates the slot is
     still free, re-checks the talent has `VIDEO_BOOKING` enabled, creates a GetStream call
     (`type: 'talent-session'`), inserts a `talentSessions` row with `status: 'awaiting_payment'`,
     computes Stripe fee split (talent gets 95% of the listed price; platform nets ~10% total — see
     Business Rules), and returns a Stripe Checkout URL. The row only advances past
     `awaiting_payment` once the `checkout.session.completed`/`async_payment_succeeded` webhook
     calls `handlePaymentWebhook` — which uses an atomic
     `UPDATE ... WHERE status='awaiting_payment'` to guard against Stripe's at-least-once webhook
     delivery double-processing the same session.
   - `POST /sessions/book` (`TalentSessionService.book`) — same slot/feature validation, but inserts
     the session directly at `status: 'pending'` with **no Stripe charge created here** — see gotcha below.
4. On success, `status: 'pending'` triggers notifications + email to the talent
   (`sessionEmails.newBookingRequestForTalent`) and a `talent:request:new` socket event; the booker
   gets a confirmation email/notification.
5. Talent calls `PUT /sessions/:id/confirm` or `/decline`:
   - `confirm` → `status: 'confirmed'`, registers the GetStream call for real (`registerOnStream`,
     `max_duration_seconds = durationMins*60 + 180` grace), emails the booker.
   - `decline` → `status: 'declined'`, issues a full Stripe refund if a payment intent exists,
     emails the booker.
6. Both parties `POST /sessions/:id/join` as they enter the call (`recordJoin`). `joinAllowedAt`
   (5 min before `scheduledAt` on the checkout path, 3 min on the direct-book path) gates early
   joins. When **both** `bookerJoinedAt` and `talentJoinedAt` are set, `billingStartedAt` is
   stamped and `status` flips to `live`.
7. `POST /sessions/:id/end` (or the `processAutoEndSessions` cron once elapsed time exceeds
   `durationMins`) → `status: 'completed'`, `actualDurationMins` computed from the billing window,
   talent's `totalSessions` incremented, spend recorded (`UserSpendService`), booker prompted by
   email to leave a review.
8. Background cron (`src/cron/sessionReminders.js`, registered in `cronJobs.js`) handles the rest of
   the lifecycle automatically: 24h/1h/15m/1m reminders, no-show auto-cancellation (10-min grace —
   full refund if talent never joined, no refund to booker if only the booker no-showed), auto-
   cancelling `pending` sessions whose time passed without talent confirmation (full refund), and a
   24h post-completion review-reminder email.

### 3. Talent gift codes

1. A booker checks the "gift this session" option on `POST /sessions/book` or `/sessions/checkout`
   (`isGift: true`, `giftDetails: { recipientName, recipientEmail, recipientPhone, occasion,
   personalMessage, deliveryDate }`).
2. On successful payment/booking, `GiftCodeService.generate()` creates a `talent_gift_codes` row
   (code format `GIFT-XXXXXXXX`, 1-year expiry) with the duration/price locked in, and immediately
   emails the recipient (`sendEmail`) if `recipientEmail` was provided. On the checkout (Stripe) path,
   the underlying session is created with `status: 'gift_purchased'` instead of `'pending'` — the
   *gifter's* payment is done, but no one has actually booked a session slot for the recipient yet.
3. The gift recipient later books their own session and supplies the code (`giftCode` field on
   `book`/`checkout`); `GiftCodeService.redeem()` validates it (active, not expired, matches
   talent + duration) and marks it `redeemed`, linking `redeemedSessionId` to the new session.
4. `GiftCodeService.validate()` backs a lighter "Apply code" check in the booking UI (pre-fills
   talent + duration without creating anything).

### 4. Issue/dispute filing and resolution

1. Customer calls `GET /api/talent-issues/eligible` to see which of their sessions/priority messages
   qualify (sessions: status `confirmed`/`completed`/`live`; priority messages: `status: 'paid'`;
   both exclude entities that already have an open `pending` issue).
2. Customer files `POST /api/talent-issues` with `{ entityType: 'session'|'priority_message',
   entityId, reason: 'no_reply'|'no_show'|'no_attend'|'other', message (10-2000 chars) }`
   (`TalentIssueService.createIssue`). The service snapshots `amountCents` and
   `stripePaymentIntentId` from the source entity at creation time, and blocks a second open issue
   on the same entity (`409`). `reason`+`message` are sent through async text moderation
   (`TextModerationService.flagAsync`, entity `TEXT_ENTITY.SUPPORT`) — fire-and-forget, doesn't
   block issue creation.
3. Admin reviews via `GET /api/admin/talent-issues` / `/:issueId` and resolves with
   `PATCH /:issueId/resolve`, `action` one of:
   - `refund` — issues a full Stripe refund (`refundFullAmount` defaults `true`; the service does
     not currently support a partial-amount refund parameter despite the "full amount" naming),
     flips the source entity (`talentSessions.status = 'cancelled'` or
     `priorityMessagePayments.status = 'refunded'`), marks the spend ledger refunded, **and** sets
     `warningIssued: true` — a refund always also warns the talent.
   - `warn` — no refund, `warningIssued: true`, talent gets a warning email.
   - `dismiss` — `status: 'dismissed'`, no refund, no warning.
4. Emails go to the reporter (outcome) and, if `warningIssued`, to the talent
   (`sendIssueWarningToTalentEmail`) — both fire-and-forget, failures only logged.

Talent issues are a **payment-dispute mechanism**, distinct from the platform's general content
**moderation reports** (user-generated-content flags) covered in
[09-moderation.md](./09-moderation.md) — different table (`talentIssues` vs the moderation
report tables), different admin surface, no shared code path. The only overlap is that issue
`reason`/`message` text and talent profile/review text both flow through the same
`TextModerationService` (see [09-moderation.md](./09-moderation.md)), and live-call video frames
during a session go through the *same* Stream-based moderation pipeline as photos/media
(`TalentSessionService.submitFrameForModeration`/`applyFrameVerdict`, entity type
`gokiro:talentsession:frame`) — escalating warn → mute → kick → block on repeated violations,
worst-status-wins on the session's `moderationStatus`.

### 5. Leaving a talent review

1. Eligibility is computed by `TalentProfileService._getReviewStatus` (surfaced as
   `reviewStatus` on `GET /:profileId` and `GET /:username`): a logged-in viewer who is not the
   talent themselves, has a `completed` session with this talent with no existing review → `canReview: true,
   source: 'session'`; same idea for a `paid` priority-message payment. If they already reviewed
   that source, it returns `existingReviewId` for the edit flow instead.
2. `POST /sessions/:sessionId/review` (booker only, session must be `completed`, one review per
   session — DB `unique` constraint on `sessionId`) or
   `POST /priority-messages/:paymentId/review` (sender only, payment must be `paid`, one review per
   payment via a partial unique index) — both call `TalentReviewService.create`.
3. `title`/`comment` pass through `TextModerationService.assertAllowed` (entity `TEXT_ENTITY.REVIEW`).
4. On insert, `TalentReviewService._recomputeRating` recalculates `talentProfiles.rating` (avg of all
   `isVisible=true` reviews) and `reviewCount` — this happens on **every** create/update(rating
   change)/admin-remove, not cached or batched.
5. Talent gets a notification + `/talent-dashboard` redirect ("New review received ⭐").
6. Reviewer can edit their own review (`PATCH /reviews/:reviewId`) — re-triggers moderation on
   changed text and rating recompute if `rating` changed.
7. Talent can report a review on their own profile as wrong/fake (`POST /reviews/:reviewId/report`)
   — one report per review (`409` if `reportedAt` already set); admin then dismisses
   (`PATCH /admin/talent-reviews/:reviewId/dismiss`, clears the report, review stays visible) or
   removes it (`PATCH /admin/talent-reviews/:reviewId/remove`, sets `isVisible: false` + recomputes
   rating).

## Integrations

| Integration | Where | Purpose |
|---|---|---|
| **Stripe** | `talentSession.service.js` (`createCheckout`, `handlePaymentWebhook`, refunds in `decline`/`cancel`/`handleNoShow`/`autoExpirePending`); `talentIssue.service.js` (refund on dispute resolution) | Checkout Sessions for session payments, direct `stripe.refunds.create` for cancellations/no-shows/disputes. Uses Stripe Connect `transfer_data`/`application_fee_amount` when the talent's connected account has `chargesEnabled`; otherwise the full charge sits in the platform balance (self-healed via `StripeConnectService.syncStatus`). Full detail: [07-payments-stripe.md](./07-payments-stripe.md). |
| **GetStream (video)** | `StreamCallService.createCall`/`registerOnStream`, `streamClient.video.call(...)` | Each session gets a `talent-session`-type Stream call, created at booking time and "registered" (frame recording enabled) only once the talent confirms. Also used for live call moderation actions (mute/kick/block) and to end a call on severe moderation verdicts. See [10-getstream-realtime.md](./10-getstream-realtime.md). |
| **GetStream (moderation)** | `TalentSessionService.submitFrameForModeration`/`applyFrameVerdict`, `TALENT_SESSION_FRAME_ENTITY = 'gokiro:talentsession:frame'` | Periodic call-frame captures are submitted to Stream's moderation `check()`; the recommended action (keep/flag/remove/shadow/shadow_block) drives escalating in-call actions. |
| **Text moderation** | `TextModerationService` (`assertAllowed`, `recordIfFlagged`, `maskFlaggedText(Single)`, `flagAsync`) | Gates/masks talent profile `title`/`bio`, review `title`/`comment`, and issue `reason`/`message`. See [09-moderation.md](./09-moderation.md). |
| **Socket.IO** | `emitSocialChat(io, 'user:<id>', 'talent:request:new' \| 'session:confirmed' \| 'session:moderation_action', ...)` | Real-time push for new booking requests, confirmations, and live in-call moderation warnings. Separate from GetStream's own chat/video signaling. |
| **Notifications + email** | `notification.service.js` (`createNotification`), `mail.service.js`, `src/templates/index.js` (`sendBookingConfirmationEmail`, `sendBookingCancellationEmail`, `sendBookingRescheduledEmail`), `src/cron/sessionEmails.js` (reminder/no-show/completed/review-reminder templates) | Every state transition in the session lifecycle fires both an in-app notification and an email; both are wrapped so failures are logged, never thrown (a failed email never blocks the booking action). |
| **Subscriptions (BriteSide Plus)** | `SubscriptionService.checkFeatureAccess`/`getActiveFeaturesForUsers`, `requireFeature`/`requireActiveSubscription` middleware | Gates `VIDEO_BOOKING` (server-checked again inside `createCheckout`/`book`, not just at the route), `PRIORITY_MESSAGING`, dashboard access. See [07-payments-stripe.md](./07-payments-stripe.md). |
| **UserSpendService** | `talentSession.service.js`, `talentIssue.service.js` | Records/reverses a ledger entry per paid session or refund, for the user-expenditure analytics module. |

## Business Rules & Gotchas

- **`checkout` vs `book` are two different payment paths with different guarantees.**
  `createCheckout` always creates a real Stripe Checkout Session and only advances the booking past
  `awaiting_payment` on a verified webhook. `book` inserts the session straight to `status: 'pending'`
  with **no Stripe charge in that function at all** — its "Fee structure" comment block (accounting
  for Stripe fees, application fee split, etc.) only exists in `createCheckout`. Treat `book` as a
  legacy/free/manual-payment path; don't assume every `talentSessions` row has a Stripe payment
  behind it.
- **Fee split (checkout path only):** talent receives 95% of the listed price
  (`talentReceiveCents = round(base * 0.95)`); the booker is actually charged
  `round((base*1.05 + 30)/0.971)` cents so that after Stripe's ~2.9%+$0.30 fee, the platform nets
  ~10% of `base` (5% "buyer fee" + 5% "talent commission") while the talent still nets exactly 95%
  of the listed price — i.e. **the talent, not the platform, effectively absorbs the Stripe
  processing fee** via this pricing formula.
- **Rates are stored in dollars in the jsonb `rates` field but everywhere else (session `priceCents`,
  Stripe amounts) is cents.** `basePriceCents = Math.round(rates[String(durationMins)] * 100)`. Don't
  assume consistent units across `talentProfiles.rates` and `talentSessions.priceCents`.
- **Minimum rate is $20** for any duration — enforced in `create`, `update`, and `saveSchedule`, not
  at the DB level (no CHECK constraint on `rates` jsonb).
- **Cancellation refund tiers** (`TalentSessionService.cancel`): talent-initiated cancellation or
  ≥48h notice → full refund; 24–48h notice → 50% refund; <24h notice → no refund. Who cancelled
  matters, not just timing.
- **No-show handling is asymmetric.** If the talent never joins (10-min grace past `scheduledAt`) →
  full refund to booker, session cancelled, talent penalized. If the talent joined but the booker
  didn't → session cancelled but **no refund** — the talent keeps their fee since they showed up.
- **Rescheduling creates a new row, doesn't mutate the original.** The original session flips to
  `status: 'rescheduled'` (excluded from most list views via `ne(status, 'rescheduled')` in
  `listForUser`) and a brand-new session is inserted with `status: 'pending'` and
  `rescheduledFromId` pointing back — the talent must re-confirm the new time even if they'd already
  confirmed the original.
- **Availability override resolution is all-or-nothing per date**, not merged: if any override rows
  exist for a date, the weekly `talentAvailability` windows for that date are ignored entirely (see
  Data Model section). A talent who wants to just "add an extra hour" on top of their normal Tuesday
  hours must re-enter *all* of Tuesday's slots as override rows for that date, not just the extra one.
- **`getAvailableSlots` has debug `console.log` statements still active** in production code
  (`src/services/talentSession.service.js` ~lines 826–997) — noisy but harmless; useful when
  debugging why a slot isn't showing up, but should probably be removed/gated behind a debug flag
  eventually (flagging per repo convention: don't delete pre-existing code unless asked, just be
  aware of it).
- **`talentIssues.entityId` has no DB-level foreign key** — it points to either `talentSessions.id`
  or `priorityMessagePayments.id` depending on `entityType`, and referential integrity is enforced
  only in `TalentIssueService`, not the schema. A raw SQL join without checking `entityType` first
  will silently produce wrong results.
- **`isVerified` has no workflow** — see Core Flow 1. Don't assume there's an admin "verify talent"
  button; as of this writing there isn't one in this codebase.
- **`talentProfiles.deletedAt` is a soft-delete column** consulted via `isNull(talentProfiles.deletedAt)`
  in most reads (`getById`, `getByUsername`, `update`, `listTalentProfiles`, etc.) — but
  `getByUserId` (used internally e.g. by `TalentEarningsService._resolveProfile`) also filters on
  it, while a few internal helpers (`getAvailableSlots`, `_getSessionForTalent`'s profile lookup)
  fetch by `talentProfiles.id` **without** the `deletedAt` filter. There is no route to actually set
  `deletedAt` in the code reviewed here (no delete-profile endpoint exists) — treat it as a reserved
  hook for a future soft-delete admin action, not an active code path today.
- **`listSessionsForUser` (standalone exported function, near end of `talentSession.service.js`) is
  not called anywhere in the controller** — `TalentSessionService.listForUser` (instance method,
  slightly different pagination behavior — it paginates in JS after fetching *all* matching rows in
  both cases, so neither actually pushes `LIMIT`/`OFFSET` to SQL) is what `listMySessions` actually
  uses. Don't be misled into "fixing" the wrong one.

## Common Tasks

- **Add a new talent profile field** — add the column to `src/db/schema/talentProfiles.js`, run
  `npm run db:generate` + `npm run db:migrate`, thread it through `TalentProfileService.create`/`update`
  (and `saveSchedule` if it should be settable from the "Manage Schedule" combined form), and add it
  to the relevant `columns`/`with` selection wherever profiles are fetched (`getById`, `getByUsername`,
  `listTalentProfiles`) if it should be publicly visible.
- **Change the booking fee split** — edit the `talentReceiveCents`/`chargedCents`/`applicationFeeCents`
  formula in `TalentSessionService.createCheckout` (`src/services/talentSession.service.js` ~line
  1093). Remember `book()` has no equivalent fee logic at all.
- **Change cancellation/no-show refund policy** — `TalentSessionService.cancel` (refund tiers) and
  `TalentSessionService.handleNoShow` / `sessionReminders.processNoShowCancellations` (no-show
  grace period, currently 10 minutes, and the asymmetric refund rule).
  Also update the `cancellation_policy` string embedded in the booking confirmation email
  (`createCheckout`/`book`) so the copy stays in sync with the actual logic.
- **Add a new reminder type** — add a template function to `src/cron/sessionEmails.js`, add a
  `reminder<X>SentAt` column to `talentSessions`, add a `process...` function to
  `src/cron/sessionReminders.js` following the `processReminders(minutesBefore, type, sentAtField, windowMins)`
  pattern, and register a `cron.schedule(...)` call in `src/cron/cronJobs.js`.
- **Debug "why isn't this slot showing up"** — check server logs for the existing
  `=== SLOTS DEBUG ===` block from `getAvailableSlots`; it logs the resolved day-of-week, matching
  windows, override rows, and booked-session conflicts step by step.
- **Add a new dispute reason or entity type** — extend `VALID_REASONS`/`VALID_ENTITY_TYPES` in
  `src/services/talentIssue.service.js` and the matching Zod enum in `src/routes/talentIssue.route.js`
  (`createIssueSchema`); if adding an entity type, also extend the `entityType === 'session'` /
  `else` branch in `createIssue` and the equivalent branching in `getEligibleEntities`.
- **Investigate a stuck/missing Stripe transfer to a talent** — check `talentSessions.transferId`/
  `transferredAt` (null means the charge is still sitting in the platform balance, usually because
  the talent's Connect account wasn't `chargesEnabled` at charge time); cross-reference
  [07-payments-stripe.md](./07-payments-stripe.md).

## Related Modules

- [07-payments-stripe.md](./07-payments-stripe.md) — full detail on talent Stripe Connect
  onboarding, earnings dashboard math, wallet/cashout, payout methods, and how talent-session
  Stripe fees/transfers work end-to-end (this doc only summarizes the pieces that live in
  `talent.route.js`/`talentSession.service.js`).
- [13-platform-services.md](./13-platform-services.md) — covers `src/routes/demo.route.js` /
  `src/services/demo.service.js` ("demo sessions"). **Note:** despite the similar name, these
  "demo sessions" are **not** talent bookings — they're generic BriteSide product-demo signups
  (audience `event`/`influencer`/`group`, admin-created via a separate `demoSessions`/
  `demoRegistrations` schema, e.g. a prospective organizer booking a sales demo call). They do
  reuse the same GetStream video-call primitives (`streamClient.video.call(...)`) as talent
  sessions, but there is no shared table, service, or business logic with the talent module — do
  not conflate the two when searching for "session" code.
- [09-moderation.md](./09-moderation.md) — the text-moderation pipeline (`TextModerationService`)
  that talent profiles, reviews, and issue reports all flow through, and the Stream-based
  live-call frame moderation that talent video sessions use. Talent *disputes* (`talentIssues`)
  are a distinct payment-dispute mechanism, not part of the content-moderation report system
  covered there — see Core Flow 4 above for how they differ.
- [10-getstream-realtime.md](./10-getstream-realtime.md) — GetStream video call setup/lifecycle
  underlying every talent session's actual video room.
- [04-social.md](./04-social.md) — user profiles/follows are a separate concept from talent
  profiles; a talent's public page is additional to, not a replacement for, their social profile.
- [06-organizers-venues.md](./06-organizers-venues.md) — organizers/events are unrelated in the DB
  to talent sessions; only loosely joined client-side via `GET /api/talent/me/booked-events`.
