# Unified Analytics / Event-Tracking System — Implementation Plan

## Context

Briteside needs cross-module analytics (Post, Group, Event, Service/talent, Product/shop) covering the full engagement funnel — **impression** (shown in a feed/search result), **view** (2-4s+ dwell), **click** (opened), **comment**, **like**, **share**, plus room for **custom events** added later without a migration (gtag/GA4-style: event name + entity + free-form properties). Dashboards need per-owner funnels, time-series, and demographic/location breakdowns (gender, age, city/state/country), mirroring patterns that already exist for posts/profiles.

Today the codebase (`briteside-api`, Node/Express + Drizzle/Postgres) only has **bespoke, per-entity tracking**: `postViews`, `shopProductViews`, `profileViews`/`profileViewSessions` (all require a non-null `userId` — no anonymous tracking), plus counters (`posts.viewsCount`, `events.totalViews`, `shopProducts.viewsCount`) and one daily rollup precedent, `eventAnalytics`. Groups and talent/services have **no view tracking at all**. There is no generic event log, no impression/click concept anywhere, and no support for logged-out visitors. Demographic breakdowns exist in two places (`admin.service.js#getDemographicsStats`, `socialAnalytics.service.js#getProfileAnalytics`) with duplicated SQL that should be reused, not copied a third time.

Confirmed requirements from the user: web **and** mobile clients will emit events (mobile may be offline and batch-flush later); a 5-15 minute rollup latency for dashboards is acceptable (no real-time requirement); anonymous (`anonymousId`) activity should merge into the user's account on login; and expected volume is **high (100k+/day, bursty/viral)** — so the design below builds partitioning and async buffering in from Phase 1 rather than deferring them.

Goal of this plan: add a **generic, append-only event log** as an additive layer alongside the existing tables (no risky migration of live counters), with a clear ingestion → buffering → rollup → dashboard pipeline, following this repo's existing per-domain file conventions (`src/db/schema`, `src/services`, `src/controllers`, `src/routes`, `src/workers`, `src/cron`) and existing infra (`pg-boss`, `node-cron`, Passport JWT auth, `express-rate-limit`, `zod`).

---

## 1. Core schema

**New file `src/db/schema/analyticsEvents.js`** — raw event log, table `analytics_events`:

| column          | type                                          | notes                                                                                                                                                                                       |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid PK default random                        |                                                                                                                                                                                             |
| `eventName`     | varchar(64) NOT NULL                          | `impression`, `view`, `click`, `comment`, `like`, `share`, `search_performed`, or any future custom name — no enum, no migration needed for new names                                       |
| `entityType`    | varchar(32) NOT NULL                          | `post`, `group`, `event`, `product`, `service`, `profile`, or `none`                                                                                                                        |
| `entityId`      | uuid NULL                                     | no cross-table FK (polymorphic) — integrity enforced at service layer                                                                                                                       |
| `userId`        | uuid NULL, FK → `users.id` ON DELETE SET NULL | nullable to support anonymous events                                                                                                                                                        |
| `anonymousId`   | varchar(64) NULL                              | client-generated UUID (cookie/local storage), required when `userId` is null                                                                                                                |
| `sessionId`     | varchar(64) NULL                              | ties impression→view→click→comment together within one browse/search session                                                                                                                |
| `clientEventId` | uuid NOT NULL                                 | client-generated idempotency key; **unique** — required because mobile offline-queue retries can resend the same event after a flush that partially succeeded                               |
| `properties`    | jsonb NOT NULL default `{}`                   | `durationMs`, `position`, `searchQuery`, `resultSetId`, `surface` (`feed`/`search`/`group_discovery`/`shop_grid`/`talent_directory`), `referrer`, etc. — the escape hatch for custom events |
| `context`       | jsonb NULL                                    | server-captured: `ipHash`, `userAgent`, `platform` (`web`/`ios`/`android`), `appVersion`                                                                                                    |
| `occurredAt`    | timestamptz NOT NULL                          | client-supplied event time (preserves true order for offline/batched mobile events)                                                                                                         |
| `receivedAt`    | timestamptz NOT NULL default now()            | server insert time; drives partitioning/retention and clock-skew checks                                                                                                                     |
| `createdAt`     | timestamptz NOT NULL default now()            |                                                                                                                                                                                             |

Indexes:

- unique on `clientEventId` (idempotency)
- `(entityType, entityId, occurredAt)` — per-entity timeline
- `(entityType, entityId, eventName, occurredAt)` — funnel counts per event type
- partial `(userId, occurredAt) WHERE userId IS NOT NULL`
- partial `(anonymousId, occurredAt) WHERE anonymousId IS NOT NULL`
- `(sessionId)`
- Defer a GIN index on `properties` until a real ad-hoc-query need appears

**Partitioning**: given the confirmed high/bursty volume, **range-partition by month on `occurredAt` from Phase 1**, e.g. `analytics_events_2026_09`. Drizzle-kit will generate the base table shape; the partitioning DDL itself is a **hand-authored SQL migration** (not drizzle-kit generated). A cron job (`src/cron/analyticsPartitionMaintenance.cron.js`) pre-creates the next 3 months of partitions and can later drop/archive old ones for retention.

**New file `src/db/schema/analyticsIdentity.js`** — anonymous→user merge table (needed because the user confirmed merge-on-login is required):

`analytics_identity_links`: `id` PK, `anonymousId` varchar(64) NOT NULL, `userId` uuid FK → users.id NOT NULL, `linkedAt` timestamptz default now(), unique(`anonymousId`, `userId`). Populated by the auth/login flow (a small hook in the existing login controller/service) whenever a request carries both a known `anonymousId` and results in an authenticated session. Used by dashboard queries to optionally fold anonymous rows into the now-known user's demographic profile.

**New file `src/db/schema/analyticsRollups.js`** — one daily rollup table per entity type, mirroring the existing `eventAnalytics` shape (`date`, unique(entityId, date)):

- `postAnalyticsDaily`: postId, date, impressions, views, clicks, comments, likes, shares, saves
- `groupAnalyticsDaily`: groupId, date, impressions, views, clicks, joins
- `productAnalyticsDaily`: productId, date, impressions, views, clicks, sales, revenue
- `serviceAnalyticsDaily`: talentProfileId, date, impressions, views, clicks, bookingsStarted, bookingsCompleted
- `eventAnalytics` (existing, unchanged for now) — add `impressions`/`clicks` columns to it in a later migration once event impressions are wired up, instead of duplicating it

**New file `src/db/schema/analyticsEventDefinitions.js`** — lightweight, **advisory-only** registry (`eventName` PK, `label`, `description`, `applicableEntityTypes text[]`, `funnelOrder integer`, `isActive`), used to populate an admin dropdown and to define canonical funnel ordering (impression→view→click→comment) without hardcoding it in queries. Ingestion does **not** reject unknown event names — an unknown name is only flagged (logged) for an admin "unrecognized event" alert.

Update `src/db/schema/index.js` and `relations.js` to export/relate all new tables.

---

## 2. Ingestion path

- **Endpoint**: `POST /api/analytics/track`, new files `src/routes/analyticsTrack.route.js`, `src/controllers/analyticsTrack.controller.js`, `src/validations/analyticsTrack.validation.js` (zod). Kept separate from the existing `analytics.route.js` (organizer/event-scoped reads) since this is a public, anonymous-tolerant **write** path with different middleware needs.
- Middleware chain: `optionalAuthMiddleware` → new `analyticsTrackLimiter` (in `src/middlewares/rateLimiter.js`, keyed by IP + `anonymousId`, e.g. 300 events/min) → zod validation → controller.
- **Payload** (GA4-style batch): `{ anonymousId, sessionId, events: [{ clientEventId, eventName, entityType, entityId, occurredAt, properties }] }`. Validation caps batch size (~50/request), validates `eventName` pattern, `entityType` enum, `entityId` uuid, `occurredAt` within a bounded past/future window (reject wildly-skewed timestamps — important given mobile offline queues), `properties` size-capped (~8KB).
- **Dwell-time "view" (2-4s) is computed client-side**: client starts a visibility timer on viewport-enter and only emits `view` once the threshold passes (plus `properties.durationMs` for later tuning), flushed on threshold-reached, on unmount, and periodically. Server stays stateless per request — no reliance on a matching "left viewport" event.
- **Mobile offline support**: client persists unsent events locally (keyed by `clientEventId`) and flushes batches when connectivity returns; the server's unique `clientEventId` constraint makes re-sending a batch after a partial failure safe (`ON CONFLICT DO NOTHING` on insert).
- **Anonymous→user merge**: on any authenticated request that also carries a known `anonymousId` (login endpoint, or any authenticated `/track` call), upsert a row into `analytics_identity_links`.

## 3. Async processing

Given confirmed high/bursty volume, buffer at ingestion instead of writing directly under load:

1. `/track` controller validates the batch, then enqueues it to **pg-boss** (queue `analytics.track`, new worker `src/workers/analyticsWorker.js` following the `importWorker.js` pattern: `boss.createQueue`, `boss.work('analytics.track', { teamSize }, ...)`) and returns 202 immediately. The worker does the actual batched `db.insert(analyticsEvents).values([...]).onConflictDoNothing()`. This absorbs viral-traffic spikes without blocking the request or contending on write locks.
2. **Do not update denormalized counters synchronously.** A **node-cron job** (`src/cron/analyticsRollup.cron.js`, every 5-15 minutes — matches the confirmed acceptable freshness) reads new rows since the last cursor, groups by `(entityType, entityId, date, eventName)`, and upserts into the relevant `*AnalyticsDaily` table via `onConflictDoUpdate` (same idiom as existing upsert usage in `importWorker.js`).
3. A second cron step reconciles **existing** counters only where genuinely new (impressions/clicks have no existing counter anywhere, so this is pure net-new for those columns) — it must **not** touch `posts.viewsCount`/`shopProducts.viewsCount`/etc., which stay owned exclusively by the existing `postViews`/`shopProductViews` insert paths (see reconciliation rule below).
4. `src/cron/analyticsPartitionMaintenance.cron.js` pre-creates upcoming monthly partitions.

## 4. Relationship to existing tables

**Additive, not a replacement.** `postViews`, `shopProductViews`, `profileViews`/`profileViewSessions`, `postLikes`, `postUserComments`, `savedPosts`, `eventAnalytics`, `eventLikes` all keep working exactly as today, powering the existing endpoints unchanged — zero risk to the live schema or current dashboards.

**Reconciliation rule**: the new system's `view` event is the **feed/search-level dwell-view**, distinct from the existing "opened post detail" view in `postViews`. The rollup cron must never write to `posts.viewsCount` (that stays owned by `SocialAnalyticsService.viewPost`); new rollup tables get their own `impressions`/`views`/`clicks` columns, and dashboards show both metrics side by side, clearly labeled ("detail views" vs "feed impressions/dwell-views/clicks"). Groups and talent/services have no prior tracking, so their rollups are pure net-new with no reconciliation needed.

Longer-term consolidation (migrating old view tables onto the new event log) is explicitly deferred past this rollout.

## 5. Search impression tracking — sequencing

Two separate items:

1. **Feed/discovery-surface impressions** (main feed, group discovery, shop grid, talent directory) need **no prerequisite** — these surfaces already return posts/groups/products/services today. Client tags `properties.surface`. Build this in Phase 1/2.
2. **Search-surface impressions** require `posts`/`shopProducts` to first be searchable — `search.service.js#universalSearch` currently only covers users/events/groups/talent. Adding `postSearch`/`productSearch` tsvector columns + extending `universalSearch` is a real prerequisite migration, scheduled as Phase 3, after which impression events can carry `properties.searchQuery`/`resultSetId`/`position`.

## 6. Query/dashboard layer

New `src/services/analyticsQuery.service.js`, generic over `{ entityType, entityId }`:

- `getEventTotals`, `getFunnel` (impression→view→click→comment conversion %, reusing `computePercentageBreakdown` from `src/utils/helper.js`), `getTimeSeries`, `getTopEntities`, `getSearchImpressionStats` (Phase 3).
- `getDemographicBreakdown` — reuses the **existing** age-bucket/gender/location join pattern from `socialAnalytics.service.js#getProfileAnalytics` and `admin.service.js#getDemographicsStats`; extract the shared SQL (age CASE bucketing, gender group-by, `userInformation` city/state/country group-by) into `src/utils/demographics.js` so all three call sites share one implementation instead of a third copy. Joins `analytics_events.userId` → `socialProfiles`/`userInformation`, optionally folding in anonymous rows via `analytics_identity_links`.

Wiring into existing/new endpoints (additive fields on existing responses where possible, so current consumers aren't broken):

- Extend `SocialAnalyticsService.getPostAnalytics` (existing `GET /api/social/posts/:id/analytics`) with funnel data.
- Extend `groupAnalytics.service.js`/`.controller.js` similarly.
- New `src/services/shopAnalytics.service.js` + `GET /api/shop/products/:id/analytics` (shop has no analytics today).
- New `src/services/talentAnalytics.service.js` + `GET /api/talent/:id/analytics` (talent has no analytics today).
- New generic `GET /api/analytics/demographics?entityType=&entityId=` on top of `getDemographicBreakdown`, avoiding duplicate per-entity demographic endpoints.
- Admin: `GET /api/admin/analytics/top-entities`, `GET /api/admin/analytics/event-types` (reads the registry), under existing `requireAdmin`.

## 7. Extensibility for custom events

No migration needed to add an event type — a new `eventName` string + whatever `properties` shape flows straight through ingestion and shows up in `getEventTotals`/time-series automatically. The `analyticsEventDefinitions` registry (built in Phase 1, kept advisory-only) gives an admin dropdown of known names and canonical funnel ordering (`funnelOrder`), while ingestion logs (doesn't reject) unrecognized names for visibility.

## 8. Phased rollout

**Phase 1 — Schema + buffered ingestion (write-only, no dashboards yet)**

- `src/db/schema/analyticsEvents.js`, `analyticsIdentity.js`, `analyticsRollups.js`, `analyticsEventDefinitions.js`; update `index.js`/`relations.js`
- Hand-authored partition migration + `drizzle-kit generate` for the rest
- `src/validations/analyticsTrack.validation.js`, `src/services/analyticsIngest.service.js`, `src/controllers/analyticsTrack.controller.js`, `src/routes/analyticsTrack.route.js` (mounted in `src/routes/index.js`)
- `src/middlewares/rateLimiter.js` — add `analyticsTrackLimiter`
- `src/workers/analyticsWorker.js` (pg-boss consumer of `analytics.track` queue)
- Login flow hook to populate `analytics_identity_links`
- Web + mobile clients start emitting `impression`/`view`/`click`/`comment` for feed/discovery surfaces only

**Phase 2 — Rollups + dashboards**

- `src/cron/analyticsRollup.cron.js`, `src/cron/analyticsPartitionMaintenance.cron.js`, registered in `src/cron/cronJobs.js`
- `src/services/analyticsQuery.service.js`, `src/utils/demographics.js` (extracted shared SQL), `src/controllers/analyticsQuery.controller.js`, `src/routes/analyticsQuery.route.js`
- Extend `socialAnalytics.service.js`, `groupAnalytics.service.js`; add `shopAnalytics.service.js`, `talentAnalytics.service.js`
- Verify rollup totals reconcile against raw event counts before shipping to owner dashboards

**Phase 3 — Search integration**

- `postSearch`/`productSearch` tsvector columns + migration; extend `universalSearch`
- Client tags search-surface impressions with `searchQuery`/`resultSetId`/`position`
- `getSearchImpressionStats`

**Phase 4 — Demographic drill-down + admin tooling**

- `GET /api/analytics/demographics` fully wired for all entity types
- Admin CRUD for `analyticsEventDefinitions` + "unknown event name" alerting
- Re-evaluate pg-boss `teamSize`/partition-retention windows against real Phase 1-3 production volume

## Verification

- Phase 1: send a batch to `/api/analytics/track` (authenticated and anonymous), confirm rows land in `analytics_events` via a worker-queue round trip, confirm duplicate `clientEventId` resends are no-ops, confirm partitions exist for current/next months.
- Phase 2: run the rollup cron manually, confirm `*AnalyticsDaily` upserts match raw counts for a test entity, confirm `posts.viewsCount` is untouched by the new pipeline.
- Phase 2: hit the extended `GET /api/social/posts/:id/analytics` and confirm funnel fields appear alongside existing fields without breaking current response shape.
- Phase 3: confirm posts/products appear in `universalSearch` results and that impressions logged from that surface carry `searchQuery`.

## Open items to revisit during implementation

- Bot/abuse mitigation for `/track` beyond rate limiting (WAF/CDN-level, or in-app) — not found in current codebase, confirm before high-traffic launch.
- Whether `analyticsEventDefinitions` should ever become enforcing (reject unknown names) — currently advisory-only by design.
