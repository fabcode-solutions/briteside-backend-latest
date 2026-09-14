# Dashboards & Analytics — KT

> Scope note: this doc covers **reporting/analytics dashboards** — platform-wide admin analytics,
> organizer/event analytics, group analytics, social post/profile analytics, and user spend
> ("expenditure") analytics. It deliberately excludes the **money-earnings dashboards**
> (talent/organizer/group/admin payout & earnings views) — those live in
> [07-payments-stripe.md](./07-payments-stripe.md). Where a route or service straddles both
> (e.g. group revenue analytics, which reads subscription/MRR data but isn't a payout ledger),
> it's covered here and cross-referenced there.

## Overview

BriteSide has five distinct analytics surfaces, all computed **on-the-fly from the primary
Postgres database** — there is no separate OLAP/warehouse system live in the codebase today
(see [Business Rules & Gotchas](#business-rules--gotchas) for the one designed-but-not-built
exception).

| Surface | Consumers | Entry point |
|---|---|---|
| Organizer / event analytics | Event organizers, event team members with `analytics.view_sales` permission, platform admins (read-only override) | `src/routes/analytics.route.js`, mirrored read-only under `src/routes/admin.route.js` |
| Platform-wide admin analytics | Platform admins only | `src/routes/admin-analytics.route.js` (+ some overlapping stats under `admin.route.js`'s `/dashboard`) |
| Group analytics (member growth, discussions, engagement, revenue) | Group members/admins/moderators (self-service), group organizers (aggregate across their groups), platform admins (read-only override) | `src/routes/group.route.js` (analytics sub-routes), mirrored under `admin.route.js` |
| Social analytics (post + profile views/engagement) | Post/profile owners (self-service), platform admins (read-only override) | `src/routes/social.route.js`, mirrored under `admin.route.js` |
| User expenditure / spend analytics | Any authenticated end user, for their own spend only | `src/routes/userSpend.route.js` |

A recurring pattern across all five: the **same service method** is called both from the
"owner" route (self-service, membership/ownership-checked) and from an admin route, with an
`{ isAdmin: true }` option that skips the ownership check. There is no duplicated analytics
logic for the admin views — they're thin admin-only wrappers around the same services.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/analytics.route.js` | Organizer/event analytics endpoints, mounted at `/api/analytics` |
| `src/routes/admin-analytics.route.js` | Platform-wide admin stats/demographics endpoints, mounted at `/api/admin/analytics` |
| `src/routes/admin.route.js` | Admin console routes; also re-exposes event/group/social analytics (admin override) under `/api/admin/analytics/*` and `/api/admin/dashboard` |
| `src/routes/userSpend.route.js` | User expenditure endpoints, mounted at `/api/user/expenditure` |
| `src/routes/group.route.js` | Group analytics sub-routes (`/api/groups/:groupId/analytics/*`) |
| `src/routes/social.route.js` | Post/profile analytics endpoints (`/api/social/posts/:postId/analytics`, `/api/social/profile/:username/analytics`) |
| `src/controllers/analytics.controller.js` | Organizer/event analytics controllers |
| `src/controllers/groupAnalytics.controller.js` | Group analytics controllers |
| `src/controllers/userSpend.controller.js` | User spend controllers |
| `src/controllers/admin.controller.js` | Admin stats + admin-override analytics controllers (very large file; analytics-related handlers are grouped under `// ─── Event Analytics ───`, `// ─── Group Analytics ───`, `// ─── Social Analytics ───`, `// ─── Stats ───`) |
| `src/services/analytics.service.js` (`AnalyticsService`) | Organizer overview, event sales/audience/ticket-performance/engagement analytics |
| `src/services/groupAnalytics.service.js` (`GroupAnalyticsService`) | Group overview, member stats/trends, discussion stats, engagement, categories, top contributors, growth comparison, revenue/MRR, organizer-level rollup |
| `src/services/social/socialAnalytics.service.js` (`SocialAnalyticsService`) | Post analytics (views/likes/comments/shares/saves, viewer geo, peak comment hour), profile analytics (views, follower growth, gender/age breakdown) |
| `src/services/userSpend.service.js` (`UserSpendService`) | `recordSpend()` ledger writer + all user spend analytics reads |
| `src/services/admin.service.js` | Platform-wide stats (`getOverviewStats`, `getUserMetrics`, `getMauTrend`, `getSignupsTrend`, `getDemographicsStats`, `getInterestsAnalytics`, `getDashboardStats`, `getActivityLogs`) |
| `src/services/group.service.js` (`getGroupAnalytics`, line ~944) | A separate, much simpler "quick" group analytics method (member count + pending join requests) — **not** the same as `GroupAnalyticsService`; see gotcha below |
| `src/services/groupCourse.service.js` (`GroupCourseService.getAdminCourseAnalytics`) | Admin-only group-course analytics, called from `admin-analytics.route.js` `/group-courses` |
| `src/db/schema/analytics.js` | `event_analytics` table (per-event, per-day pre-aggregation rollup) — **defined but currently unused by any query/write path** |
| `src/db/schema/userSpends.js` | `user_spends` ledger table + `spend_type` enum |
| `docs/superpowers/specs/2026-04-20-user-expenditure-analytics-design.md` | Original design spec for the user-spend ledger + API |
| `docs/superpowers/plans/2026-04-20-user-expenditure-analytics.md` | Step-by-step implementation plan for the same feature |
| `docs/superpowers/plans/2026-05-12-admin-suspension-appeals-stats.md` | Implementation plan that added `admin-analytics.route.js` + the platform stats functions in `admin.service.js` |
| `docs/superpowers/specs/2026-07-01-feed-ranking-olap-moderation-design.md` | Design (not yet implemented) for a Tinybird/ClickHouse OLAP layer feeding feed ranking; see [Core Flows](#4-feed-rankingolap-design-not-yet-implemented) |

## Data Model

Analytics in this codebase is overwhelmingly **query-time aggregation over transactional
tables**, not a separate star-schema/warehouse. Two purpose-built tables exist:

| Table | Schema file | Key columns | Notes |
|---|---|---|---|
| `event_analytics` | `src/db/schema/analytics.js` | `eventId` (FK → `events`, cascade), `date`, `pageViews`, `uniqueVisitors`, `ticketsSold`, `revenue` (decimal 10,2), unique on `(eventId, date)` | Modeled as a daily-rollup table (one row per event per day) — but **no code path currently inserts, updates, or reads it**. `AnalyticsService` computes everything live from `purchasedTickets`/`events`/`eventReviews` instead. Related in `src/db/schema/relations.js` (`eventAnalyticsRelations`, `events.analytics: many(eventAnalytics)`) but otherwise orphaned. Treat as a **placeholder for future pre-aggregation**, not a live table. |
| `user_spends` | `src/db/schema/userSpends.js` | `id`, `userId` (FK → `users`), `spendType` (enum: `ticket_purchase`, `platform_subscription`, `group_subscription`, `talent_session`, `priority_message`, `shop`), `amountCents` (signed — positive = spend, negative = refund), `referenceId` (uuid, FK to the source order/session/payment/subscription, not a DB-level FK), `referenceType` (varchar mirror of spendType), `eventId`/`talentUserId`/`groupId` (nullable context FKs), `metadata` (jsonb, shape varies per `spendType` — see spec), `stripePaymentIntentId`/`stripeSessionId` (varchar, **never returned to the frontend**), `isRefunded` (bool), `refundMeta` (jsonb), `paidAt`, `createdAt`. Indexed on `userId`, `spendType`, `paidAt`, `isRefunded`, `eventId`, `talentUserId`, `referenceId`. | This is a genuine **append-only ledger** — the only true "analytics table" that's actually written to, via `UserSpendService.recordSpend()`. `spendType` enum values were appended (`shop` added after the original 5); the schema comment explicitly warns never to reorder the enum since Postgres orders enum values by declaration position. |

Everything else — organizer/event analytics, group analytics, social post/profile analytics,
platform admin stats — is computed **live** at request time via Drizzle aggregate queries
(`count()`, `sum()`, `avg()`, `sql`-templated `GROUP BY`/`DATE_TRUNC` expressions) against the
tables those domains already own:

| Analytics domain | Tables queried live |
|---|---|
| Organizer/event | `events`, `purchasedTickets`, `eventTickets`, `purchasedMerchandise`, `eventReviews`, `eventSchedules` |
| Group | `groups`, `groupMembers`, `groupJoinRequests`, `discussions`, `discussionReplies`, `discussionLikes`, `discussionReplyLikes`, `discussionCategories`, `categories`, `groupSubscriptions`, `groupSubscriptionTiers` |
| Social (post/profile) | `posts`, `postViews`, `postLikes`, `postShares`, `postReposts`, `savedPosts`, `postUserComments`, `userFollows`, `socialProfiles`, `profileViews`, `profileViewSessions`, `users`, `userInformation` |
| Platform admin stats | `users`, `userInformation`, `socialProfiles`, `events`, `userReports`, `orders`, `userInterests`, `interestCategories`, `auditLogs` |
| User spend | `user_spends` (ledger reads) + live reads of `userSubscriptions`/`groupSubscriptions`/`stripeCustomers` for active-subscription status (not sourced from the ledger, to stay authoritative) |

## API Endpoints

All paths below are relative to the API base path `/api` (see `src/app.js`, `app.use('/api', defaultLimiter, routes)`).

### Organizer / event analytics — `src/routes/analytics.route.js` (mounted at `/api/analytics`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/analytics/overview` | `authMiddleware` (organizer only — 404 if no `organizerId`) | Organizer-wide revenue/tickets/ratings overview |
| GET | `/api/analytics/events` | `authMiddleware` (organizer only) | Paginated list of organizer's events, each with a lightweight analytics summary |
| GET | `/api/analytics/events/:eventId` | `optionalAuthMiddleware` + `teamMemberAuthMiddleware` + `eventAccessMiddleware` + `requireEventPermission(ANALYTICS_VIEW_SALES)` | Full event analytics (sales + audience + ticket performance + engagement), optional `?scheduleId=` |
| GET | `/api/analytics/events/:eventId/sales` | same as above | Sales-only slice (revenue, tickets sold, 30-day trend) |
| GET | `/api/analytics/events/:eventId/audience` | same as above | Audience-only slice (attendee count, avg tickets/user, purchase-hour distribution) |
| GET | `/api/analytics/events/:eventId/tickets` | same as above | Per-ticket-tier performance (sell-through rate, remaining) |
| GET | `/api/analytics/events/:eventId/engagement` | same as above | Reviews/ratings + views/likes engagement rate |

`requireEventPermission` allows access to: the event's own organizer, platform admins
(`user.roles.includes('admin')`), or an event team member with the `analytics.view_sales`
permission (`PERMISSIONS.ANALYTICS_VIEW_SALES`, `src/config/event-team-permissions.js:7`).

### Group analytics — `src/routes/group.route.js` (mounted at `/api/groups`)

All behind `authMiddleware` (applied at `group.route.js:113`, before any analytics route);
membership/role is then checked inside the service layer.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups/:groupsId/analytics` | Authenticated + `verifyGroupMembership` inside `GroupService.getGroupAnalytics` | **Legacy/lightweight** analytics: member count + pending join request count only |
| GET | `/api/groups/analytics/organizer/overview` | Authenticated | Aggregated analytics across every group the caller owns (`createdBy`) |
| GET | `/api/groups/:groupId/analytics/revenue` | Authenticated + `requireGroupAdminOrModerator` | Subscription revenue/MRR/churn for a paid group |
| GET | `/api/groups/:groupId/analytics/overview` | Authenticated + `verifyGroupMembership` | Full group analytics bundle (member/discussion/engagement/category/contributor stats) |
| GET | `/api/groups/:groupId/analytics/members` | Authenticated | Member counts, role distribution, weekly growth rate |
| GET | `/api/groups/:groupId/analytics/members/trends` | Authenticated | Daily new-member trend + cumulative total |
| GET | `/api/groups/:groupId/analytics/discussions` | Authenticated | Discussion/reply counts + daily trend |
| GET | `/api/groups/:groupId/analytics/engagement` | Authenticated | Like counts, engagement rate, most-liked discussions |
| GET | `/api/groups/:groupId/analytics/categories` | Authenticated | Discussion counts by category |
| GET | `/api/groups/:groupId/analytics/contributors` | Authenticated | Top contributors by post+reply count (`?limit=`) |
| GET | `/api/groups/:groupId/analytics/growth` | Authenticated + `verifyGroupMembership` | Period-over-period growth comparison (`?currentFrom&currentTo&previousFrom&previousTo`, all required) |
| GET | `/api/groups/:groupId/analytics/users/:targetUserId` | Authenticated + `verifyGroupMembership` | One user's discussion/reply/like activity within the group |

> **Route-order gotcha**: `/analytics/organizer/overview` (line 132) is registered *after*
> `/:groupsId/analytics` (line 128) but *before* the `/:groupId/analytics/*` block — the code
> has an explicit comment (`group.route.js:130-132`) explaining this ordering is required so
> Express's `:groupId` param never swallows the literal `analytics` segment.

### Social (post/profile) analytics — `src/routes/social.route.js` (mounted at `/api/social`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/social/posts/:postId/analytics` | Post owner only (`_ensurePostOwner`) | Post views/likes/comments/shares/saves, viewer list + geo, peak comment hour |
| GET | `/api/social/profile/:username/analytics` | Profile owner only (`_ensureProfileOwner`) | Profile views, follower growth, viewer geo/gender/age breakdown |

### Platform-wide admin analytics — `src/routes/admin-analytics.route.js` (mounted at `/api/admin/analytics`)

All behind `authMiddleware` + `requireAdmin` (`admin-analytics.route.js:22`). Query params: `?dateFrom=&dateTo=` (both optional, Zod-validated).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/analytics/overview` | Top-line cards: total users, BriteSide Plus members, active events, pending reports — each with week-over-week % change |
| GET | `/api/admin/analytics/user-metrics` | MAU, DAU, DAU/MAU ratio, new signups this month + MoM change, active countries |
| GET | `/api/admin/analytics/mau-trend` | 12-month MAU time series |
| GET | `/api/admin/analytics/signups-trend` | 12-month signups time series |
| GET | `/api/admin/analytics/demographics` | Age buckets, gender breakdown, top 10 cities, country distribution |
| GET | `/api/admin/analytics/interests` | Top interest categories, intensity-tier breakdown, total users with interests |
| GET | `/api/admin/analytics/group-courses` | Admin-wide group-course analytics (`GroupCourseService.getAdminCourseAnalytics`) |

### Admin-override analytics (read-only mirrors) — `src/routes/admin.route.js` (mounted at `/api/admin`)

Same `authMiddleware` + `requireAdmin` gate as the rest of `admin.route.js`. These call the
**same** `AnalyticsService` / `GroupAnalyticsService` / `SocialAnalyticsService` methods as the
self-service routes above, with `{ isAdmin: true }` to bypass ownership checks — no separate
analytics logic.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/dashboard` | Platform dashboard snapshot: user/event/group/post/report counts, total revenue, 12-month user-growth series (`adminService.getDashboardStats`) |
| GET | `/api/admin/analytics/events` | All events with analytics (admin, unscoped) |
| GET | `/api/admin/analytics/events/:eventId` | Event analytics (admin override) |
| GET | `/api/admin/analytics/events/:eventId/sales` | Event sales (admin override) |
| GET | `/api/admin/analytics/events/:eventId/audience` | Event audience (admin override) |
| GET | `/api/admin/analytics/events/:eventId/ticket-performance` | Ticket performance (admin override) |
| GET | `/api/admin/analytics/events/:eventId/engagement` | Event engagement (admin override) |
| GET | `/api/admin/analytics/groups/:groupId` | Group overview (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/members` | Group member stats (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/members/trends` | Group member trends (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/discussions` | Group discussion stats (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/engagement` | Group engagement (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/categories` | Group category stats (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/contributors` | Group top contributors (admin override) |
| GET | `/api/admin/analytics/groups/:groupId/growth` | Group growth comparison (admin override) |
| GET | `/api/admin/analytics/posts/:postId` | Post analytics (admin override) |
| GET | `/api/admin/analytics/users/:userId/social` | Profile analytics (admin override) |

> **Gotcha**: `/api/admin/analytics/*` is served by **two different routers** —
> `admin.route.js`'s own `/analytics/events`, `/analytics/groups/:groupId`, etc. sub-paths
> (mounted at `/admin`), and `admin-analytics.route.js`'s `/overview`, `/user-metrics`, etc.
> (mounted directly at `/admin/analytics`). They don't collide on any actual sub-path today,
> but a request that doesn't match anything in `admin.route.js`'s analytics block falls through
> to `admin-analytics.route.js` because both are registered as Express middleware on
> overlapping prefixes (`routes/index.js:57,60`). Don't assume all `/admin/analytics/*` paths
> live in one file.

### User expenditure / spend analytics — `src/routes/userSpend.route.js` (mounted at `/api/user/expenditure`)

All behind `authMiddleware` (`userSpend.route.js:13`); every query is implicitly scoped to `req.user.id` — there is no way for a user to query another user's spend through this router.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/user/expenditure/summary` | Totals by `spendType`, gross spend, total refunded, net spend |
| GET | `/api/user/expenditure/timeline` | `?year=&month=` — monthly buckets for a year, or daily buckets for one month |
| GET | `/api/user/expenditure/events/:eventId` | All ticket-purchase ledger entries for one event + total |
| GET | `/api/user/expenditure/subscriptions` | Active platform + group subscriptions (read live, not from the ledger) |
| GET | `/api/user/expenditure/recent` | `?page=&limit=&type=` — paginated ledger history, Stripe IDs stripped |

## Core Flows

### 1. Platform-wide admin analytics

1. Admin hits e.g. `GET /api/admin/analytics/overview?dateFrom=...&dateTo=...`.
2. `admin-analytics.route.js` runs `authMiddleware` → `requireAdmin` → a small inline Zod
   validator (`validateQuery(dateRangeQuery)`, defined right in the route file) that puts the
   parsed query on `res.locals.validatedQuery`.
3. Controller (`admin.controller.js` → `getOverviewStats`) reads `res.locals.validatedQuery ||
   req.query` and calls `adminService.getOverviewStats(query)`.
4. `admin.service.js` runs several `Promise.all`-batched Drizzle queries directly against
   `users`/`events`/`userReports` with `count(*)::int` aggregates, computing week-over-week
   percentage change in JS (`pct()` helper) when no explicit date range is given. When a date
   range **is** given, week-change comparisons are suppressed (`weekChange: null`) because
   "this week vs date range" isn't a meaningful comparison — see the `hasRange` branching in
   `getOverviewStats`/`getUserMetrics` (`admin.service.js:1572-1792`).
5. Trend endpoints (`getMauTrend`, `getSignupsTrend`) use `DATE_TRUNC('month', ...)` +
   `to_char(..., 'Mon ''YY')` SQL templates to produce a 12-month (or date-range-bounded) series
   in one query each — no app-level date bucketing.
6. `getDashboardStats` (used by `/api/admin/dashboard`, not date-range-aware) runs 7 queries in
   parallel using Postgres `count(*) filter (where ...)` for multi-bucket counts in a single
   pass (e.g. total/new-last-30-days/suspended users in one query).

### 2. Group analytics

1. Caller hits e.g. `GET /api/groups/:groupId/analytics/overview`.
2. `group.route.js` → `getGroupAnalyticsOverview` (`groupAnalytics.controller.js:10`) → calls
   `GroupAnalyticsService.getGroupOverview(groupId, userId, filters)`.
3. `GroupAnalyticsService.getGroupOverview` first calls `verifyGroupMembership` (from
   `src/utils/group-helpers.js`) unless `{ isAdmin: true }` was passed by an admin-route caller;
   throws `ApiError(403)` if the caller isn't a member.
4. It then fires **six** analytics sub-methods in parallel via `Promise.all`
   (`getMemberStatistics`, `getMemberTrends`, `getDiscussionStatistics`, `getEngagementMetrics`,
   `getCategoryBasedAnalytics`, `getTopContributors`) and assembles them into one response
   object alongside basic group info.
5. Each sub-method is independently exposed as its own endpoint too (e.g.
   `/api/groups/:groupId/analytics/members`), so the frontend can fetch just one slice instead
   of the full overview.
6. `getRevenueAnalytics` (the `/revenue` endpoint) is separate: it requires
   `requireGroupAdminOrModerator` (stricter than plain membership), 403s if the group isn't
   `isPaid`, and computes MRR by normalizing yearly-billed tiers to a monthly figure
   (`price / 12`) summed across active/trialing `groupSubscriptions` joined to
   `groupSubscriptionTiers`. See [07-payments-stripe.md](./07-payments-stripe.md) for how those
   subscription rows themselves get created/billed.
7. `getOrganizerOverview` (the `/analytics/organizer/overview` endpoint) fetches every group the
   caller created, runs `getMemberStatistics`/`getDiscussionStatistics`/`getEngagementMetrics`/
   `getRevenueAnalytics` per group in parallel, and reduces them into grand totals — a per-group
   revenue-fetch failure is swallowed (`.catch(() => null)`) so one broken group doesn't 500 the
   whole rollup (`groupAnalytics.service.js:316-321`).

### 3. User expenditure / spend analytics

1. **Write path** (happens once, at payment confirmation, from six-plus different services —
   never from the analytics routes themselves): `webhook.controller.js` (ticket orders),
   `priorityMessage.service.js`, `talentSession.service.js`, `subscription.service.js` (platform
   Plus), `groupSubscription.service.js`, `shop/shopOrder.service.js` all call
   `UserSpendService.recordSpend({...})` after their respective payment reaches a confirmed
   state (`paid`/`completed`/`active`). `recordSpend` never throws — it logs and swallows
   DB errors so a ledger-write failure can never roll back an already-confirmed payment
   (`userSpend.service.js:27-31`).
2. Refunds call `UserSpendService.markSpendRefunded(...)` (or the talent-session-specific
   `markTalentSessionRefunded`) from `refund.service.js`, `groupSubscription.service.js`,
   `talentSession.service.js`, `talentIssue.service.js`, `shop/shopRefund.service.js` — this
   updates the **original** spend row's `isRefunded`/`refundMeta` rather than inserting a
   negative-amount row itself (negative rows are inserted separately per the design spec for a
   distinct refund entry — check the calling service if you need the exact shape for a new spend
   type).
3. **Read path**: `GET /api/user/expenditure/summary` groups `user_spends` by `spendType` with
   `SUM(amountCents)`, splitting `grossCents`/`refundCents` in JS based on sign
   (`userSpend.service.js:160-188`).
4. `getTimeline` switches its `DATE_TRUNC` granularity based on whether `month` was supplied —
   year-only → monthly buckets, year+month → daily buckets (`userSpend.service.js:195-230`).
5. `getActiveSubscriptions` deliberately reads live `userSubscriptions`/`groupSubscriptions`
   tables rather than the ledger, so cancellation state and period-end dates are always current
   (the ledger only records the *payment event*, not ongoing subscription state).
6. `getRecentSpends` and `_serialize()` strip `stripePaymentIntentId`/`stripeSessionId` from
   every row before it leaves the service — this is the single point where that redaction
   happens, so a new read method that queries `userSpends` directly (bypassing `_serialize`)
   would leak Stripe IDs. `getStripeTransactions`/`syncAmountsFromStripe` are maintenance/admin
   helpers that call the Stripe API directly to reconcile `amountCents` drift; not used by any
   route currently, kept for scripted syncing.

### 4. Feed-ranking/OLAP design (not yet implemented)

`docs/superpowers/specs/2026-07-01-feed-ranking-olap-moderation-design.md` is a **design doc,
status "Design approved (shape), pending spec sign-off"** — it describes a planned Tinybird
(managed ClickHouse) OLAP layer, not something currently running. Confirmed by searching the
codebase: there is no `tinybird` package, `TINYBIRD_*` config, or `feed_events` table/write path
anywhere in `src/`.

What the design proposes, and how it maps to today's code:

- **Split of responsibility**: Postgres stays authoritative for durable state (counts, likes,
  moderation decisions); a new Tinybird layer would hold only an append-only behavioral event
  stream (`feed_events`: impressions, views, scroll-past, dwell time, etc.) plus derived
  materialized views (`post_velocity_mv`, `user_category_affinity_mv`, `post_reach_mv`) queried
  through one batched `feed_signals` endpoint at feed-read time.
- **Why OLAP at all**: the doc's own stated trigger is scale (50k–500k DAU → millions of
  behavioral events/day), explicitly framed as *not* worth it below that scale, and explicitly
  rules out Kafka/Kinesis/self-hosted ClickHouse/ML feature stores as premature.
- **Current code already has the "before" state the doc describes fixing**: in
  `src/services/social/feed.service.js`, `finalScore`/`priorityTier` are computed per-post from
  interest match + a recency-weighted engagement score (`engagementScore`, line ~768–770) — but
  the actual sort at the end (`feed.service.js:796-798`) ignores that score entirely and sorts
  purely by `createdAt` descending; the score-based sort is present as a **commented-out** line
  (`feed.service.js:791-795`). The design doc calls this out explicitly (§6, "Redundant/To-Update
  in Existing Code") as dead code to revive once Tinybird signals exist.
- **Moderation angle**: the same doc proposes a hybrid local-rules + AI-escalation moderation
  pipeline (local blocklist/regex pass synchronously, uncertain content escalated via pg-boss to
  an AI moderation API, decision stored in Postgres only). See
  [09-moderation.md](./09-moderation.md) for the moderation module and how much of that pipeline
  is actually built today.
- **Net effect for this doc**: there is currently **no OLAP/warehouse analytics path** for feed
  ranking or anything else — all analytics in this codebase (including feed "trending" sort,
  `feed.service.js:394`, which time-decays denormalized Postgres counters) query Postgres
  directly. If you're asked to add heavy analytical queries at scale, this design doc is the
  intended blueprint to follow rather than inventing a new approach; see
  [04-social.md](./04-social.md) for the feed module this would plug into.

## Integrations

- **Stripe** — `UserSpendService.getStripeTransactions`/`syncAmountsFromStripe` call the Stripe
  API directly (`paymentIntents.list`/`retrieve`) to reconcile ledger amounts against actual
  charged amounts; not on the hot read path of any current route. Group revenue analytics reads
  local subscription/tier tables only — it does **not** call Stripe Connect (explicit comment,
  `groupAnalytics.service.js:149`, "Platform fee total (local computation — no Stripe Connect)").
  See [07-payments-stripe.md](./07-payments-stripe.md) for the payout/earnings side.
- **AWS Secrets Manager / SES** — no direct analytics dependency; standard project-wide config
  (see [00-project-overview.md](./00-project-overview.md)).
- **Tinybird (ClickHouse)** — proposed, not integrated; see Core Flow 4 above.
- **AI moderation API (OpenAI moderation / AWS Comprehend/Rekognition)** — proposed as part of
  the same OLAP design doc, for content moderation rather than analytics per se; see
  [09-moderation.md](./09-moderation.md).

## Business Rules & Gotchas

- **No pre-aggregation is actually used.** `event_analytics` (`src/db/schema/analytics.js`) is a
  daily-rollup table shape that looks purpose-built for cheap dashboard reads, but nothing
  writes to it and nothing reads from it — `AnalyticsService` computes every event metric live
  from `purchasedTickets`/`eventTickets`/`eventReviews` on every request. If you're asked to
  speed up event analytics, populating and reading this table (e.g. from a nightly cron) is the
  most natural next step, not a new table.
- **Performance shape of live queries**: most analytics methods fire 3-8 independent Drizzle
  queries via `Promise.all` per request (e.g. `getGroupOverview` runs 6 sub-analytics calls in
  parallel, each of which itself runs several queries). None of these are wrapped in a single
  SQL query with CTEs — so a "group overview" request can be a dozen+ round trips to Postgres.
  `GroupAnalyticsService.getTopContributors` is the worst offender: for each of the top N
  contributors it does 2-3 more sequential queries in a `Promise.all(topByDiscussions.map(...))`
  — effectively N× extra round trips (`groupAnalytics.service.js:830-904`). No caching layer sits
  in front of any of this today.
- **No caching anywhere in this module.** No Redis, no in-memory TTL cache, no HTTP cache
  headers on analytics responses that were found in this codebase. Every request re-runs every
  query. If dashboards get slow under load, caching is a gap to fill, not something to tune.
- **`user_spends.amountCents` can be negative** (refunds) — always confirm whether a query needs
  `SUM` (nets out refunds automatically) or needs to filter `isRefunded = false` first depending
  on intent; `getSummary` and `getTimeline` both filter `isRefunded = false` and rely on
  `amountCents` sign for gross/refund splitting within that filtered set — read the exact
  predicate before copying the pattern.
- **`spend_type` enum ordering is load-bearing.** The schema comment
  (`userSpends.js:22-25`) explicitly warns: Postgres orders enum values by declaration position,
  so new spend types must be **appended**, never inserted mid-list. `shop` was added this way
  after the original five.
- **Two different "group analytics" services exist** — don't confuse them: `GroupService.
  getGroupAnalytics` (`group.service.js:944`, used by the single legacy endpoint
  `GET /api/groups/:groupsId/analytics`) is a 2-field summary (member count + pending requests).
  `GroupAnalyticsService` (`groupAnalytics.service.js`, used by every `/analytics/*` sub-route)
  is the real, comprehensive analytics service. If asked to "add a field to group analytics",
  confirm which of the two the requester means.
- **Admin override pattern**: every admin-facing analytics endpoint calls the exact same service
  method as the self-service one, passing `{ isAdmin: true }` to skip ownership/membership
  checks — there is intentionally no separate "admin analytics" business logic to keep in sync.
  When changing a metric's calculation, changing the one shared service method is enough; you
  don't need to hunt for a duplicate admin implementation.
- **Stripe field redaction is a single choke point** (`UserSpendService._serialize`) — any new
  read method added to `UserSpendService` that returns raw `userSpends` rows must route through
  it (or replicate the destructure) to avoid leaking `stripePaymentIntentId`/`stripeSessionId`.
- **No OLAP/warehouse today, one is designed.** See Core Flow 4 — don't assume Tinybird/
  ClickHouse exists; it's a proposal document only. If a task references "the analytics
  pipeline" or "OLAP layer" in a way that implies it's live, verify against `src/` before
  building on it.
- **Date-range params are inconsistently named** across surfaces: `dateFrom`/`dateTo` (most
  routes), `startDate`/`endDate` (group revenue analytics), `currentFrom/currentTo/previousFrom/
  previousTo` (growth comparison). No shared query-schema module unifies these — check the
  specific controller/route before assuming a param name.

## Common Tasks

- **Add a new metric to an existing analytics response** — find the service method (table above
  under Key Files), add the query (usually alongside existing `Promise.all` siblings), add the
  field to the returned object. No schema change needed unless the metric requires new raw data.
- **Add a new admin-only analytics endpoint that reuses existing logic** — add a controller in
  `admin.controller.js` that calls the existing service method with `{ isAdmin: true }`, then a
  route in `admin.route.js` (or `admin-analytics.route.js` if it's a platform-wide stat rather
  than a per-entity override) behind `requireAdmin`. Don't write new query logic.
- **Add a new `spendType`** — append (never insert mid-list) to `spendTypeEnum` in
  `src/db/schema/userSpends.js`, run `npm run db:generate && npm run db:migrate`, add a
  `UserSpendService.recordSpend()` call at the new payment-confirmation point, document the
  `metadata` shape (see the table in
  `docs/superpowers/specs/2026-04-20-user-expenditure-analytics-design.md`).
- **Debug why an analytics number looks wrong** — first check if the query filters by
  `isRefunded`/`deletedAt`/status the way you expect; most discrepancies in this module come
  from a live-computed query missing a soft-delete or status filter that a sibling query has.
- **Make a slow analytics endpoint faster** — there's no cache to invalidate (there isn't one).
  Options in order of effort: reduce round trips by merging `Promise.all` siblings into fewer
  queries, populate/read the currently-unused `event_analytics` rollup table for event stats, or
  (at real scale) refer to the OLAP design doc for the intended pattern.
- **Add a group/event/social analytics field visible to admins too** — add it once to the shared
  service method; both the self-service and admin routes pick it up automatically.

## Related Modules

- [07-payments-stripe.md](./07-payments-stripe.md) — money-earnings dashboards (talent/organizer/
  group/admin payouts), Stripe Connect, subscriptions/MRR billing mechanics behind group revenue
  analytics, refunds.
- [03-groups.md](./03-groups.md) — group membership, discussions, subscriptions that
  `GroupAnalyticsService` reports on.
- [04-social.md](./04-social.md) — posts, profiles, feed ranking (`feed.service.js`) that the
  OLAP design doc (Core Flow 4) proposes to change.
- [09-moderation.md](./09-moderation.md) — content moderation; the same OLAP design doc's
  moderation-pipeline proposal, and the suspension-appeals feature whose admin stats
  (`getOverviewStats`, `getDemographicsStats`, etc.) live in this doc.
- [12-admin.md](./12-admin.md) — the broader admin console (`admin.route.js`) that
  `admin-analytics.route.js` and the admin-override analytics endpoints are part of.
