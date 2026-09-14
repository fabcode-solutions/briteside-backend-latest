# GoKyro API — Project Overview (Knowledge Transfer)

> This is the entry point for KT documentation. Start here, then read the module-specific
> file that matches what you're working on. All KT docs live in `docs/kt/`.

## What this project is

`gokyro-api` is the backend for **BriteSide** (also referred to internally as GoKyro/GoKiro —
see [Naming note](#naming-note-gokyro-vs-briteside)), an event management + social platform.
Organizers create and sell tickets to events, attendees discover events through a social feed
(posts, stories, follows, groups), talent/performers manage bookings and availability, and the
platform takes a cut via Stripe (direct payments + Stripe Connect payouts to organizers/talent).
Real-time features (chat, video calls, livestreams) are built on GetStream.

It is a single Node.js/Express REST API monolith — there is no separate services layer deployed
independently; "modules" in this doc set are logical groupings of routes/controllers/services/
DB tables, not separate deployables.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, ESM (`"type": "module"` in package.json) |
| Web framework | Express 5 |
| Database | PostgreSQL |
| ORM | Drizzle ORM (`drizzle-orm/node-postgres`) + `drizzle-kit` for migrations |
| Validation | Zod (`zod`, `drizzle-zod`) |
| Auth | Passport (JWT strategy + Google/Facebook OAuth; Apple wired via `apple-signin-auth` but currently disabled in `app.js`) |
| Payments | Stripe (`stripe` SDK) — checkout, subscriptions, Connect payouts, refunds |
| Realtime / video / chat | GetStream (`@stream-io/node-sdk`) + Socket.IO |
| Background jobs | `pg-boss` (Postgres-backed queue) for workers, `node-cron` for scheduled jobs |
| Cloud infra | AWS S3 (uploads/media), AWS Secrets Manager (prod secrets + DB credential rotation), AWS SES (email), AWS SNS |
| Docs | `swagger-jsdoc` + `swagger-ui-express`, dynamically generated at `/api-docs` |
| Logging | Winston (+ daily rotate file), Morgan for HTTP request logs |
| Process manager (dev) | `nodemon` |

### Naming note: GoKyro vs BriteSide

The repo, npm package, DB name (`gokryo`), and AWS secret names (`prod/gokryo`, `prod/gokryo/nonRotational`)
all use the legacy name **GoKyro/GoKiro**. The product is customer-facing as **BriteSide**
(see CORS allow-list in `src/app.js` — `www.briteside.app`, `api-briteside.thefabcode.com` — and
`docs/BRITESIDE_PLUS_FRONTEND.md`). Don't be confused when you see both names; they refer to the
same product. "BriteSide Plus" is the paid subscription tier (see
[07-payments-stripe.md](./07-payments-stripe.md)).

## Architecture

Layered monolith, one Express app (`src/app.js`), started by `src/server.js`:

```
Request → routes/*.route.js → middlewares (auth/validation/rate-limit) → controllers/*.controller.js
        → services/*.service.js (business logic + Drizzle queries) → db/schema/*.js (Postgres)
```

- **Routes** (`src/routes/`) — one file per resource, mounted under `/api/...` in `src/routes/index.js`.
  Each route file wires up middleware (auth, validation, rate limiting) and maps HTTP verbs to controller functions.
- **Controllers** (`src/controllers/`) — thin HTTP adapters: parse `req`, call a service, shape the response.
  Wrapped in `catchAsync` (`src/utils/catch-async.js`) so thrown errors reach the error middleware instead of crashing.
- **Services** (`src/services/`) — business logic and Drizzle ORM queries. This is where almost all
  actual logic lives. Some domains have a subfolder (`services/social/`, `services/shop/`, `services/moderation/`,
  `services/imports/`) when there are many related services.
- **DB schema** (`src/db/schema/`) — one file per table group, barrel-exported from `src/db/schema/index.js`,
  plus `relations.js` for Drizzle relational config. `src/db/index.js` creates the Drizzle client from a `Pool`.
- **Errors** — services/controllers throw `ApiError` (`src/utils/api-error.js`); `src/middlewares/error.middleware.js`
  converts unknown errors, handles 404s, and formats the final JSON error response.
- **Validation** — Zod schemas per route, applied via `src/middlewares/validate.middleware.js` /
  `validation.middleware.js`.

## Request lifecycle (typical authenticated request)

1. Hits Express, passes through `helmet`, `cors` (allow-list in `app.js`), `morgan` request logging, `cookie-parser`, `bodyParser`.
2. `/api/*` requests pass through `defaultLimiter` (rate limiting, `src/middlewares/rateLimiter.js`) before reaching `routes/index.js`.
3. Route-level middleware runs: `authMiddleware` (JWT via Passport, `src/middlewares/auth.middleware.js`) attaches `req.user`,
   and blocks/auto-clears suspended users (see [09-moderation.md](./09-moderation.md)); some routes use
   `optionalAuthMiddleware` (auth if present, otherwise anonymous) or `authMiddlewareAllowSuspended` (appeals only).
4. Zod validation middleware validates `req.body`/`req.params`/`req.query`.
5. Controller calls into a service; service runs Drizzle queries against Postgres and/or calls external
   integrations (Stripe, GetStream, S3, SES).
6. Response is JSON (`{ success, data }` shape is the convention — check existing controllers for exact
   shape per endpoint, it's not 100% uniform).
7. **Exception**: `/api/webhooks` is mounted with `express.raw()` *before* `bodyParser.json()` in `app.js`,
   because Stripe/GetStream webhook signature verification needs the raw request body.

## Directory map

```
src/
  app.js              Express app setup: middleware stack, route mounting, swagger, error handlers
  server.js            Entry point: loads AWS secrets, opens DB pool, sets up Socket.IO, pg-boss, cron, then listens
  routes/              One file per resource; routes/index.js is the top-level router
  controllers/         HTTP request/response handling
  services/            Business logic + DB queries (see subfolders: social/, shop/, moderation/, imports/)
  db/
    index.js            Drizzle client + Pool (supports live pool refresh on credential rotation)
    schema/              Table definitions, one file per group, index.js barrel + relations.js
  middlewares/          auth, validation, rate limiting, CSRF, error handling, subscription gating, etc.
  config/               env parsing (config.js), passport strategies, AWS secrets loader, logger, tokens
  cron/                 node-cron scheduled jobs (reminders, cleanup, reconciliation)
  workers/              pg-boss job processors (import processing, moderation)
  lib/pgboss.js         pg-boss (Postgres job queue) initialization
  socket/               Socket.IO namespaces (chat, event, notification, livestream) + emitter
  validations/          Zod schemas per resource
  utils/                Shared helpers (ApiError, catchAsync, code/slug generators, Stream client, etc.)
docs/
  kt/                   ← you are here (this KT doc set)
  api/, superpowers/    Existing design specs/plans and API reference docs written during feature work
scripts/                One-off/seed scripts (npm run seed:*, stripe:cutover)
```

## Auth model

- JWT bearer tokens (access + refresh), issued by `auth.service.js`; verified via Passport's `jwt` strategy
  (`src/config/passport.js`).
- Social login: Google and Facebook OAuth wired via Passport strategies; Apple Sign-In dependency is present
  (`apple-signin-auth`) but the strategy is commented out in `app.js` — check before assuming it's live.
- `authMiddleware` also enforces account suspension (time-based or permanent) — see [09-moderation.md](./09-moderation.md).
- Role-based checks are ad-hoc (`req.user.roles.includes('admin')` via `requireAdmin`), not a full RBAC system.
- Full detail: [01-auth-users.md](./01-auth-users.md).

## Background processing

- **node-cron** (`src/cron/`, registered in `cronJobs.js`, started from `server.js`): birthday reminders,
  event reminders, session reminders/emails, ticket reservation release, priority-message refunds,
  Stripe Connect account sweep, SNS topic cleanup, stale import cleanup, scheduled post publishing,
  status-post cleanup, moderation reconciliation.
- **pg-boss** (`src/lib/pgboss.js`, Postgres-backed queue): used by `workers/importWorker.js` and
  `workers/moderationWorker.js` for async job processing (initialized in `server.js` before cron jobs,
  to avoid blocking the event loop during cron registration).
- **Socket.IO** (`src/socket/`): real-time push for chat, event updates, notifications, livestream —
  separate from GetStream's own realtime chat/video. See [10-getstream-realtime.md](./10-getstream-realtime.md).

## Configuration & secrets

- Local dev: `.env` file, validated/parsed by `src/config/config.js` (Zod schema — will `process.exit(1)`
  on missing required vars). Copy `.env.example` as a starting point.
- Production: `USE_AWS_SECRETS=true` triggers `src/config/secrets.js` to pull secrets from AWS Secrets
  Manager (`prod/gokryo` for rotating RDS credentials, `prod/gokryo/nonRotational` for everything else)
  and inject them into `process.env` *before* the rest of the app loads. A background watcher polls every
  15 minutes for RDS credential rotation and hot-swaps the DB pool (`refreshPool()` in `db/index.js`)
  without restarting the process.
- `DATABASE_URL` is built dynamically from the `POSTGRESQL_*` vars (or taken from the RDS secret in prod) —
  it isn't something you set directly in most environments.

## Conventions to know before touching code

- ESM everywhere (`import`/`export`), no CommonJS.
- Async route handlers are wrapped in `catchAsync` — don't wrap your own try/catch for control flow that
  should just throw an `ApiError`.
- Prefer `ApiError` + `http-status` codes over raw `res.status(...).json(...)` error responses, to keep
  error formatting consistent through `error.middleware.js`.
- Money amounts: check the specific schema/service before assuming units — some payment tables store cents,
  confirm per-field (see [07-payments-stripe.md](./07-payments-stripe.md)).
- Prettier is configured (`npm run format`); no ESLint config was found — don't assume lint rules exist beyond formatting.
- Route files are the source of truth for "is this endpoint public, optionally authed, or required-auth" —
  don't infer auth requirements from the controller alone.

## Common commands

```bash
npm run dev              # nodemon src/server.js (local dev)
npm start                # node src/server.js
npm run db:generate      # drizzle-kit generate (create migration from schema changes)
npm run db:migrate       # drizzle-kit migrate
npm run db:push          # drizzle-kit push (dev-only schema sync, skips migration files)
npm run db:studio        # drizzle-kit studio (visual DB browser)
npm run seed             # seed:all + roles + categories + interests + venues + tags + users, in order
npm run format           # prettier --write .
```
Local API docs (Swagger UI, generated dynamically from `swagger-jsdoc` annotations): `http://localhost:<PORT>/api-docs`.

## Module documentation index

| File | Covers |
|---|---|
| [01-auth-users.md](./01-auth-users.md) | Auth (JWT/OAuth), user accounts, username reservations |
| [02-events.md](./02-events.md) | Events, schedules, teams, tickets, ticket scanning/door sales, reservations, categories, tracking links, gift codes, reviews |
| [03-groups.md](./03-groups.md) | Groups, membership questions, group courses, group discussions |
| [04-social.md](./04-social.md) | Posts, stories, comments, follows, blocks, feed, profiles, bio links, collaborations, social chat, search |
| [05-talent.md](./05-talent.md) | Talent profiles, availability, sessions/bookings, issues/disputes, reviews |
| [06-organizers-venues.md](./06-organizers-venues.md) | Organizer profiles, organizer teams/presets, venues |
| [07-payments-stripe.md](./07-payments-stripe.md) | Stripe payments, subscriptions (BriteSide Plus), Stripe Connect payouts, refunds, earnings dashboards, priority messages, gift codes |
| [08-dashboards-analytics.md](./08-dashboards-analytics.md) | Platform/admin analytics, group analytics, user expenditure analytics |
| [09-moderation.md](./09-moderation.md) | Content moderation (text/media), user reports, appeals, suspensions |
| [10-getstream-realtime.md](./10-getstream-realtime.md) | GetStream video/chat, livestreams, Socket.IO, notifications |
| [11-shop-merchandise.md](./11-shop-merchandise.md) | Creator shop: products, orders, deliverables, refunds |
| [12-admin.md](./12-admin.md) | Platform admin actions/console |
| [13-platform-services.md](./13-platform-services.md) | Uploads/media, mail, contact form, search, demo sessions, bulk imports |

## Where to look

| I want to... | Look at... |
|---|---|
| Add a new API endpoint | `src/routes/`, `src/controllers/`, `src/services/`, matching module doc above |
| Add/change a DB table | `src/db/schema/`, then `npm run db:generate` |
| Change auth/JWT behavior | `src/middlewares/auth.middleware.js`, `src/config/passport.js`, `src/services/auth.service.js` |
| Add a scheduled job | `src/cron/`, register in `src/cron/cronJobs.js` |
| Add an async background job | `src/lib/pgboss.js`, `src/workers/` |
| Debug a Stripe issue | [07-payments-stripe.md](./07-payments-stripe.md), `docs/stripe-payment-flow.md` |
| Debug a real-time chat/video issue | [10-getstream-realtime.md](./10-getstream-realtime.md) |
| Understand existing feature specs/plans | `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated design docs from past feature work) |
