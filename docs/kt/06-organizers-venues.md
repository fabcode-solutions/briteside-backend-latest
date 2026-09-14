# Organizers & Venues — KT

> Part of the [gokyro-api KT doc set](./00-project-overview.md). Read
> [00-project-overview.md](./00-project-overview.md) first if you haven't.

## Overview

**Organizers** are the account type that creates and sells events. An organizer is a 1:1
extension of a `users` row (`organizers.userId`, unique) — any user can "become an organizer" by
calling `POST /api/organizers`, which creates an `organizers` row and fires off a Stripe Connect
account creation in the background (see [07-payments-stripe.md](./07-payments-stripe.md)). The
organizer record holds business-facing profile data (business name/description/type, logo, cover
images, contact info, tax ID, social links in a side table) plus a denormalized `totalEvents`
counter and `rating` bumped by other modules.

**Organizer members** (`organizer_members`) are lightweight staff accounts scoped to one
organizer, primarily for **ticket scanning at the door**. They are *not* the same thing as
**event teams** (`event_teams` / `event_team_members`, documented in
[02-events.md](./02-events.md)) — see [Related Modules](#related-modules) for the full
distinction. In short: organizer members are org-wide, simple (memberCode + password, a
`role` string, a flat `permissions` text array, default `scan_tickets`), and created by the
organizer owner. Event teams are per-event, richer (JSONB permissions, seedable roles,
`requireEventPermission` middleware), and cover more than scanning (analytics, refunds, etc.).
Both member types can authenticate into the same ticket-scanning flow
(`TicketScanningService.authenticateMember`, `src/services/ticketScanning.service.js:27`) and
both are recorded on `ticket_scans` (`scannedBy` → organizer member, `scannedByTeamMember` →
event team member).

**Organizer presets** (`organizer_presets`) are reusable snapshots of the organizer's
business-profile fields (name, description, logo, cover images, contact info, etc.) that can be
selected when creating an event (`events.presetId`). They let an organizer that runs multiple
sub-brands present different branding per event without maintaining multiple organizer accounts.
The preset is not copied field-by-field onto the event — the event just stores a `presetId` FK,
and the preset is joined back in when the event is read (`preset: true` in
`src/services/event.service.js:1601`, exposed as `activePreset`).

**Venues** are shared, global records (`venues` table) — any user can create one and any event
can reference one; only the venue's creator can edit the canonical row (see gotchas below for the
one caveat). When an event is created with a `venueId`, the API also writes an
**`event_venue_profiles`** row: a 1:1 (unique on `eventId`) per-event overlay with event-specific
details (capacity for *this* event, amenities, accessibility, cancellation policy, contact info,
parking/public-transport info, an emoji) that can differ from the venue's own global metadata.
There is a separate, **designed-but-unimplemented** feature for a *per-user* venue override layer
— see [Business Rules & Gotchas](#business-rules--gotchas).

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/organizer.route.js` | Organizer CRUD, presets, members, Stripe Connect, earnings/wallet/payouts — mounted at `/api/organizers` |
| `src/routes/organizerProfile.route.js` | Public organizer profile/events/reviews + a second members surface — mounted at `/api/organizer-profiles` |
| `src/routes/venue.route.js` | Venue CRUD/search — mounted at `/api/venues` |
| `src/controllers/organizer.controller.js` | Organizer CRUD, member CRUD (mixed backing services — see gotchas) |
| `src/controllers/organizerProfile.controller.js` | Public profile/events/reviews; member CRUD scoped by `:organizerId` param |
| `src/controllers/organizerPreset.controller.js` | Preset CRUD |
| `src/controllers/organizerEarnings.controller.js` | Stripe Connect onboarding, earnings, wallet, payouts, payout methods (thin; see [07-payments-stripe.md](./07-payments-stripe.md)) |
| `src/controllers/venue.controller.js` | Venue CRUD/search + admin list/get (admin PATCH not implemented, see gotchas) |
| `src/services/organizer.service.js` | Organizer profile CRUD, event-count increment/decrement, social links upsert |
| `src/services/organizerProfile.service.js` | Public profile/stats/events/reviews aggregation; **the working** member CRUD implementation |
| `src/services/organizerMember.service.js` | An older, schema-mismatched member-creation path (see gotchas) — still wired to two routes |
| `src/services/organizerPreset.service.js` | Preset CRUD, default-preset exclusivity, ownership validation (used by event creation) |
| `src/services/organizerEarnings.service.js` | Earnings/fee-calculator/wallet/cashout/payouts logic — cross-ref [07-payments-stripe.md](./07-payments-stripe.md) |
| `src/services/venue.service.js` | Venue CRUD, search, locations-by-user, admin list/get |
| `src/db/schema/organizers.js` | `organizers`, `organizer_social_links` |
| `src/db/schema/organizerMembers.js` | `organizer_members`, `ticket_scans` |
| `src/db/schema/organizerPresets.js` | `organizer_presets` |
| `src/db/schema/venues.js` | `venues` |
| `src/db/schema/eventVenueProfiles.js` | `event_venue_profiles` |
| `src/db/schema/eventTeams.js` | `event_teams`, `event_team_roles`, `event_team_members` — the *other* member system (see [Related Modules](#related-modules)) |
| `src/services/ticketScanning.service.js` | Shared scan-auth flow used by both organizer members and event team members |
| `docs/superpowers/permissions-flow.md` | Hand-written map of which event-team permission keys are actually enforced |
| `docs/superpowers/specs/2026-04-21-venue-user-settings-design.md`, `docs/superpowers/plans/2026-04-21-venue-user-settings.md` | Design/plan for a per-user venue override layer — **not implemented** in current code (see gotchas) |

## Data Model

| Table | Key columns | Relationships |
|---|---|---|
| `organizers` | `id`, `organizer_code` (unique), `user_id` (unique FK → `users`), `business_name`, `logo_url`, `cover_image_url[]`, `contact_email/phone`, `country`, `tax_id`, `stripe_account_id`, `is_verified`, `specialities[]`, `rating`, `total_events` | 1:1 with `users`; 1:many with `events`, `organizer_members`, `organizer_presets` |
| `organizer_social_links` | `id`, `organizer_id` (unique FK), `instagram/twitter/facebook/linkedin/youtube` | 1:1 with `organizers` |
| `organizer_members` | `id`, `organizer_id` (FK), `member_code` (unique), `member_name`, `member_password` (bcrypt hash), `role` (default `scanner`), `permissions text[]` (default `['scan_tickets']`), `is_active`, `total_scans`, `last_scan_at`, `last_login_at` | many:1 with `organizers`; referenced by `ticket_scans.scanned_by` |
| `ticket_scans` | `id`, `ticket_id`, `event_id`, `organizer_id`, `scanned_by` (FK → `organizer_members`), `scanned_by_team_member` (FK → `event_team_members`), `scan_type`, `is_valid`, `session_id`, `device_info` jsonb | Audit trail of every scan; exactly one of `scanned_by` / `scanned_by_team_member` is normally set |
| `organizer_presets` | `id`, `organizer_id` (FK), `preset_name`, business-profile fields mirroring `organizers`, `is_default` | many:1 with `organizers`; referenced by `events.preset_id` (`ON DELETE SET NULL`) |
| `venues` | `id`, `name`, `google_place_id` (unique), `address`, `latitude/longitude`, `city/state/country/country_code/postal_code`, `website_url`, `is_verified`, `created_by` (FK → `users`), `deleted_at` (soft delete) | 1:many with `events` (`events.venue_id`), `event_venue_profiles` |
| `event_venue_profiles` | `id`, `event_id` (FK → `events`, **unique** — 1:1), `venue_id` (FK → `venues`, `ON DELETE RESTRICT`), `description`, `capacity`, `amenities` jsonb, `additional_information` jsonb, `cancellation_policy`, `accessibility` jsonb, `contact_email/phone`, `parking_info`, `public_transport_info`, `emoji` | 1:1 with `events`, many:1 with `venues` — the per-event overlay on top of the global venue |

Notes:
- `venues.deleted_at` has a partial index (`idx_venues_deleted ... WHERE deleted_at IS NULL`) but
  no route in `venue.route.js`/`venue.service.js` actually sets `deleted_at` — soft-delete plumbing
  exists in the schema without a corresponding delete endpoint.
- `event_venue_profiles.venue_id` is `ON DELETE RESTRICT` — you cannot delete a venue that any
  event still references via a profile row (there is no venue delete endpoint anyway).

## API Endpoints

### Organizers, presets, members, Stripe/earnings — `src/routes/organizer.route.js` (mounted at `/api/organizers`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/organizers` | Public | List all organizers (with basic user info) |
| POST | `/api/organizers` | Required | Create organizer profile for the current user; fires background Stripe Connect account creation |
| GET | `/api/organizers/profile` | Required | Get the current user's own organizer profile |
| PUT | `/api/organizers/profile` | Required | Update own organizer profile + upsert social links |
| POST | `/api/organizers/presets` | Required | Create a preset |
| GET | `/api/organizers/presets` | Required | List own presets (default first) |
| GET | `/api/organizers/presets/:presetId` | Required | Get one preset |
| PUT | `/api/organizers/presets/:presetId` | Required | Update a preset |
| DELETE | `/api/organizers/presets/:presetId` | Required | Delete a preset |
| POST | `/api/organizers/members` | Required | Create member — **uses the schema-mismatched `OrganizerMemberService`, see gotchas** |
| GET | `/api/organizers/members?organizerId=` | Required | List members — **same broken service** |
| GET | `/api/organizers/members/:memberId?organizerId=` | Required | Get one member (ownership-checked) |
| PUT | `/api/organizers/members/:memberId` | Required | Update member fields (ownership-checked) |
| PATCH | `/api/organizers/members/:memberId/status` | Required | Activate/deactivate member — **no ownership check, see gotchas** |
| POST | `/api/organizers/members/:memberId/password/regenerate` | Required | Regenerate member password — **no ownership check, see gotchas** |
| DELETE | `/api/organizers/members/:memberId` | Required | Delete member — **no ownership check, see gotchas** |
| POST | `/api/organizers/stripe/connect` | Required | Create Stripe Connect account (see [07-payments-stripe.md](./07-payments-stripe.md)) |
| GET | `/api/organizers/stripe/connect/status` | Required | Sync/get Connect account status |
| GET | `/api/organizers/stripe/connect/link` | Required | Get onboarding link |
| GET | `/api/organizers/stripe/connect/dashboard` | Required | Get Stripe Express dashboard link |
| GET | `/api/organizers/wallet/transactions` | Required | List wallet transactions (delegates to talent earnings controller) |
| GET | `/api/organizers/earnings` | Required | Earnings summary (`?period=weekly\|monthly\|yearly\|custom&start=&end=`) |
| GET | `/api/organizers/earnings/events/:eventId` | Required | Earnings for one event |
| GET | `/api/organizers/fee-calculator` | Required | Platform/Stripe fee calculator |
| GET | `/api/organizers/fee-calculator/events/:eventId` | Required | Fee calculator scoped to an event |
| GET | `/api/organizers/wallet` | Required | Wallet balance |
| GET | `/api/organizers/wallet/summary` | Required | Aggregate wallet summary (gross/refunds/fees/net by type) |
| POST | `/api/organizers/wallet/cashout` | Required | Request a cashout/payout |
| GET | `/api/organizers/wallet/payouts` | Required | List past payouts |
| GET | `/api/organizers/payout-methods` | Required | List payout methods |
| POST | `/api/organizers/payout-methods` | Required | Add a payout method |
| PUT | `/api/organizers/payout-methods/:methodId/default` | Required | Set default payout method |
| DELETE | `/api/organizers/payout-methods/:methodId` | Required | Remove a payout method |

### Public organizer profile + second members surface — `src/routes/organizerProfile.route.js` (mounted at `/api/organizer-profiles`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/organizer-profiles/:organizerId` | Public | Public organizer profile (stats + recent events + reviews) |
| GET | `/api/organizer-profiles/:organizerId/events` | Public | Paginated organizer events (`page`, `limit`, `status`, `timeFilter`, `search`) |
| GET | `/api/organizer-profiles/:organizerId/reviews` | Public | Paginated organizer reviews (`page`, `limit`, `rating`) |
| POST | `/api/organizer-profiles/:organizerId/members` | Required, ownership-checked (`req.user.organizerId === :organizerId`) | Create member — **this is the correct/working member creation path** |
| GET | `/api/organizer-profiles/:organizerId/members` | Required, ownership-checked | List members (`page`, `limit`, `isActive`) |
| PATCH | `/api/organizer-profiles/:organizerId/members/:memberId/status` | Required, ownership-checked | Activate/deactivate member |
| PATCH | `/api/organizer-profiles/:organizerId/members/:memberId/regenerate-password` | Required, ownership-checked | Regenerate member password |
| DELETE | `/api/organizer-profiles/:organizerId/members/:memberId` | Required, ownership-checked | Delete member |

### Venues — `src/routes/venue.route.js` (mounted at `/api/venues`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/venues` | Public | List all venues, alphabetical |
| GET | `/api/venues/search?query=` | Public | Search venues by name (`ilike`) |
| GET | `/api/venues/venues-locations` | Public (optional auth) | Distinct location fields, filterable by `country`/`state`/`city`, defaults to the requesting user's own country if no `country` given |
| GET | `/api/venues/:venueId` | Public | Get one venue |
| POST | `/api/venues` | Required | Create a venue (`createdBy` = caller) |
| PATCH | `/api/venues/:venueId` | Required, owner-only (`createdBy`) | Update a venue |

### Admin venue endpoints — `src/routes/admin.route.js` (mounted at `/api/admin`, `authMiddleware` + `requireAdmin`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/venues` | Admin | List all venues (reuses `VenueService.getVenues`, no pagination applied despite `adminListVenues` naming) |
| GET | `/api/admin/venues/:venueId` | Admin | Get one venue |

*(No admin PATCH for venues exists yet — the design spec calls for one; see gotchas.)*

### Event ↔ venue attachment (lives in the events module, not a separate venue endpoint)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/events` | Required | Create event; body `venueId` + optional `venueProfile` object writes `event_venue_profiles` |
| PUT | `/api/events/:eventId` | Required, organizer-owned | Update event; changing `venueId` or passing `venueProfile` upserts the `event_venue_profiles` row (`onConflictDoUpdate` on `eventId`) |

## Core Flows

### 1. Organizer profile setup

1. Authenticated user calls `POST /api/organizers` (`organizer.controller.js:createOrganizer` →
   `OrganizerService.createOrganizer`, `src/services/organizer.service.js:10`).
2. Service generates a unique `organizerCode` (`generateOrganizerCode`,
   `src/utils/code-generator.js:6`), inserts the `organizers` row.
3. **Fire-and-forget**: kicks off `StripeConnectService.createAccount()` then
   `prefillAccount()` with whatever business info was supplied — failures here are logged, not
   thrown, so profile creation never blocks on Stripe (`organizer.service.js:25-41`). See
   [07-payments-stripe.md](./07-payments-stripe.md) for the Connect onboarding flow.
4. User edits via `PUT /api/organizers/profile` (`updateOrganizerProfile`) — only an allow-listed
   set of fields is written (`businessName`, `businessDescription`, `websiteUrl`, `about`,
   `specialities`, `logoUrl`, `coverImageUrl`, `contactEmail`, `contactPhone`); array fields are
   coerced to arrays if a single value is sent. Social links (`instagram`/`twitter`/etc.) are
   upserted into `organizer_social_links` via `onConflictDoUpdate` keyed on `organizerId`.
5. Public consumers read the profile via `GET /api/organizer-profiles/:organizerId`
   (`OrganizerProfileService.getPublicProfile`), which also computes stats
   (`getOrganizerStats`: total/published/upcoming events, average rating, tickets sold) and pulls
   recent published events + recent reviews in the same response.

### 2. Adding/managing organizer team members and their permissions

There are **two route surfaces backed by inconsistent service logic** — know which one you're
touching:

- **Use this one**: `POST/GET/PATCH/DELETE /api/organizer-profiles/:organizerId/members*`
  (`organizerProfile.controller.js` → `OrganizerProfileService`). Ownership is checked in the
  controller via `req.user.organizerId !== organizerId` before every call. Member creation here
  hashes `memberPassword` directly with bcrypt (cost 12) and generates a `memberCode`
  (`generateMemberCode`, `src/utils/codeGenerator.js:41`) — matches the actual `organizer_members`
  schema (no linked user account, just `memberName` + `memberPassword` + `role` +
  `permissions text[]`, default role `scanner` / permissions `['scan_tickets']`).
- **Avoid this one for create/list**: `POST/GET /api/organizers/members`
  (`organizer.controller.js` → `OrganizerMemberService.createMember` /
  `getOrganizerMembers`). This path tries to create a full platform **user account** for the
  member (`createUser(...)` in `user.service.js`) and insert `userId` into `organizer_members` —
  but the `organizer_members` schema (`src/db/schema/organizerMembers.js`) has **no `userId`
  column** and no relation named `user`. The insert also never sets `memberName`/`memberPassword`,
  which are `NOT NULL` with no default. This will fail at the database with a not-null
  constraint violation (create) or throw on the undefined `user` relation (list) — it does not
  match the current schema. The other five member endpoints under `/api/organizers/members/*`
  (`GET/:memberId`, `PUT/:memberId`, `PATCH/:memberId/status`,
  `POST/:memberId/password/regenerate`, `DELETE/:memberId`) all correctly delegate to
  `OrganizerProfileService`, so only **create** and **list** are affected on this surface.
6. Member login for scanning is a *separate* auth flow from the platform JWT: memberCode +
   password against `TicketScanningService.authenticateMember`
   (`src/services/ticketScanning.service.js:27`), which checks `organizer_members` first, then
   falls back to `event_team_members` by `memberCode`. This is how a scanner app authenticates —
   not via `/api/auth/*`.
7. Effective permissions for an organizer member are just the flat `permissions` text array on
   the row — there is no role→permission indirection like event teams have (`event_team_roles`).
   `permissions` defaults to `['scan_tickets']` and is only enforced by whatever the *calling*
   code chooses to check (ticket scanning itself does not gate on it — see gotchas).

### 3. Organizer presets

Presets are reusable **business-profile snapshots** an organizer can create ahead of time and
apply when creating an event, instead of typing branding info per event.

1. `POST /api/organizers/presets` — `OrganizerPresetService.createPreset` resolves the caller's
   organizer row, then inserts an `organizer_presets` row with the same profile-shaped fields as
   `organizers` (name, description, type, logo, cover images, website, contact info, address,
   about, specialities) plus `presetName` and `isDefault`.
2. If `isDefault: true` is passed, any existing default preset for that organizer is flipped to
   `false` first (`organizerPreset.service.js:18-25`) — **at most one default preset per
   organizer**, enforced in application code, not a DB constraint.
3. `GET/PUT/DELETE /api/organizers/presets/:presetId` all re-resolve the caller's organizer and
   scope the query by `organizerId`, so presets are implicitly owner-scoped (404, not 403, if you
   try to touch someone else's preset — the `WHERE organizerId = ...` just won't match).
4. At event creation (`POST /api/events`), if the request includes `presetId`,
   `EventService.createEvent` calls `OrganizerPresetService.validatePresetOwnership(organizerId,
   presetId)` (throws 403 if the preset doesn't belong to that organizer) then stores
   `events.presetId` as a plain FK (`ON DELETE SET NULL`) — **preset fields are not copied onto
   the event row**. When an event is later read with the preset relation included, it comes back
   as `activePreset` (`event.service.js:1719`).

### 4. Venue creation and attaching a venue to an event

1. Any authenticated user can create a venue: `POST /api/venues`
   (`VenueService.createVenue`) — spreads the request body into the insert plus `createdBy:
   userId`. There is no dedupe against `googlePlaceId` beyond the DB's `unique` constraint
   (which will throw on duplicate Google Place IDs — the service doesn't pre-check or catch it
   into a friendlier error).
2. Venues are looked up publicly (`GET /api/venues`, `/search`, `/:venueId`) and are
   **global/shared** — any organizer can attach any venue to their event.
3. Only the venue's `createdBy` user can `PATCH /api/venues/:venueId` (403 otherwise) — there is
   no venue-level ownership transfer, and no delete endpoint (soft-delete column exists in the
   schema but nothing sets it).
4. Attaching a venue to an event happens as part of event create/update, not a separate venue
   endpoint:
   - `POST /api/events` with `venueId` (+ optional `venueProfile` object) → `EventService.createEvent`
     sets `events.venueId` and inserts a matching `event_venue_profiles` row scoped to that
     `eventId` (`event.service.js:298-316`). `venueProfile` fields (description, capacity,
     amenities, accessibility, cancellation policy, contact info, parking/transit info, emoji)
     default to `null`/`[]`/`{}` if omitted.
   - `PUT /api/events/:eventId` — if `venueId` changes or a `venueProfile` is supplied, the
     `event_venue_profiles` row is upserted (`onConflictDoUpdate` on `eventId`,
     `event.service.js:~1948`), so switching venues on an existing event replaces the profile
     rather than leaving stale data from the old venue.
   - The event-venue relationship is 1:1 per event (`idx_event_venue_profiles_event` unique
     index) but many-to-one from the venue side (many events can share one venue), and
     `event_venue_profiles.venue_id` is `ON DELETE RESTRICT` so a venue can't be hard-deleted
     while any event profile still points at it (moot today since there is no venue delete
     endpoint).

## Integrations

- **Stripe Connect** — organizer creation kicks off account creation + prefill; earnings/wallet/
  payout endpoints under `/api/organizers/{stripe,earnings,wallet,payout-methods}` are thin
  controllers over `StripeConnectService` / `OrganizerEarningsService` / `PayoutMethodService`.
  Fully documented in [07-payments-stripe.md](./07-payments-stripe.md) — this doc only lists the
  routes for completeness.
- **Google Places** — `venues.googlePlaceId` (unique) suggests venues are meant to be
  deduplicated against Google Places results client-side before `POST /api/venues`; the server
  does not call the Google Places API itself anywhere in this module.
- **Text/media moderation** — event creation runs `TextModerationService.assertAllowed` on the
  event title/description and adopts media verdicts for cover images
  (`event.service.js:264-288`); this is an events-module concern, not organizer/venue-specific,
  but it's the moderation gate that title/description on an *organizer profile* does **not** go
  through — `updateOrganizerProfile` writes `businessDescription`/`about` with no moderation call.

## Business Rules & Gotchas

- **Two member-creation code paths, one is broken.** `POST /api/organizers/members` and
  `GET /api/organizers/members` go through `OrganizerMemberService`
  (`src/services/organizerMember.service.js`), which assumes a `userId` FK and a `user` relation
  on `organizer_members` that do not exist in the current schema
  (`src/db/schema/organizerMembers.js`) or `relations.js`. It also never sets the `NOT NULL`
  `memberName`/`memberPassword` columns. Expect a 500 from a DB constraint violation on create,
  and a relation-not-found error on list. Use the `/api/organizer-profiles/:organizerId/members*`
  surface (or the other endpoints under `/api/organizers/members/*`, which correctly use
  `OrganizerProfileService`) instead.
- **Missing ownership checks on three `/api/organizers/members/*` endpoints.**
  `PATCH /members/:memberId/status`, `POST /members/:memberId/password/regenerate`, and
  `DELETE /members/:memberId` (all in `organizer.controller.js`) only require `organizerId` to be
  present in the request body — they never verify that `organizerId` belongs to `req.user`. Since
  the underlying `OrganizerProfileService` methods (`updateMemberStatus`, `regeneratePassword`,
  `deleteMember` in `organizerProfile.service.js`) also don't check ownership themselves (they
  scope only by the `organizerId` passed in), **any authenticated user who can guess/obtain
  another organizer's `organizerId` and one of their `memberId`s can deactivate, delete, or reset
  the password of that organizer's staff member** — and the password-regenerate response returns
  the new plaintext password to the caller. Contrast with `getMember` and `updateMember` on the
  same controller, which *do* verify ownership, and with the `organizer-profiles` route surface,
  where the controller checks `req.user.organizerId !== organizerId` before calling the exact same
  service methods. If you touch this area, add the same ownership check to those three handlers.
- **`organizerId` is looked up fresh on every request.** `req.user.organizerId` is populated by
  the JWT strategy on every verified request via a live DB lookup
  (`src/config/passport.js:42-46`), not baked into the token — so it reflects the current state
  even if the user became/stopped being an organizer after the token was issued.
- **Organizer members vs. event teams are genuinely different systems** — see
  [Related Modules](#related-modules). Don't assume `organizerMembers` rows show up anywhere in
  event-team permission checks, or vice versa.
- **Ticket scanning doesn't check the `permissions` array.** Both member types authenticate via
  memberCode+password for scanning, but neither `TicketScanningService` nor the route enforces
  `event.checkin_attendees` or `scan_tickets` from the `permissions` field — any active member
  (organizer or team) with valid credentials can scan. This mirrors what
  `docs/superpowers/permissions-flow.md` documents for event teams.
- **No default-preset DB constraint.** "At most one default preset per organizer" is enforced by
  the service unsetting other defaults before insert/update — a direct SQL insert or a race
  between two concurrent requests could leave more than one `isDefault: true` row.
- **No request-body validation on this module's routes.** None of `organizer.route.js`,
  `organizerProfile.route.js`, or `venue.route.js` apply Zod validation middleware (unlike the
  general convention noted in [00-project-overview.md](./00-project-overview.md)). Services
  either allow-list fields explicitly (`OrganizerService.updateOrganizerProfile`,
  `VenueService.updateVenue`) or spread the raw body into the insert
  (`OrganizerService.createOrganizer`, `VenueService.createVenue`) — Drizzle only writes columns
  it knows about, so stray extra fields in the request body are silently dropped rather than
  rejected, but there's no input-shape validation (type checking, required fields, string
  length) before hitting the DB.
- **`venue_user_settings` (per-user venue overrides) is designed but not implemented.**
  `docs/superpowers/specs/2026-04-21-venue-user-settings-design.md` and
  `docs/superpowers/plans/2026-04-21-venue-user-settings.md` describe a `venue_user_settings`
  table letting each user override a venue's non-identity fields, plus an admin
  `PATCH /api/admin/venues/:venueId`. In the current codebase: the `venue_user_settings` schema
  file does not exist, `VenueService` has no `upsertUserSettings`/`getMergedVenue`/etc., and
  `venue.route.js` has no `/settings` sub-routes. Only the **admin list/get** half of that plan
  made it in (`adminListVenues`, `adminGetVenue` in `venue.controller.js`, wired at
  `GET /api/admin/venues` and `GET /api/admin/venues/:venueId`) — there is no admin PATCH for
  venues yet, despite the plan calling for one. Don't assume the settings-override behavior
  exists when reading the spec/plan docs; verify against the current `venue.service.js` first.
- **Duplicate code-generator utilities.** `src/utils/code-generator.js` and
  `src/utils/codeGenerator.js` both export `generateOrganizerCode`/`generateMemberCode` (used by
  different call sites in this module) — likely produce differently-formatted codes depending on
  which service created the record. Not a functional bug today, but a trap if you go looking for
  "the" code generator.
- **`/api/admin/venues` isn't actually paginated** despite being named like the paginated admin
  list pattern elsewhere — it calls `VenueService.getVenues()` (all rows, alphabetical), not the
  `adminListVenues({ page, limit, search })` method described in the design plan.

## Common Tasks

| I want to... | Do this |
|---|---|
| Add a field to the organizer profile | Add the column to `src/db/schema/organizers.js`, add it to the `fields` allow-list in `OrganizerService.updateOrganizerProfile` (`organizer.service.js:103-113`), run `npm run db:generate` |
| Add/change a member permission check | Decide whether it belongs to organizer members (`organizer_members.permissions`) or event teams (`event_team_members`/`event_team_roles` — richer, has `requireEventPermission`); for the latter see [02-events.md](./02-events.md) and `docs/superpowers/permissions-flow.md` |
| Create a member correctly | Use `POST /api/organizer-profiles/:organizerId/members`, not `POST /api/organizers/members` (see gotchas) |
| Add a new preset field | Mirror the column in `organizers.js` and `organizerPresets.js`, no allow-list to update since `OrganizerPresetService.createPreset`/`updatePreset` spread `data` directly |
| Add a field to venues | Add column to `venues.js`; if it should be updatable, add it to the destructure + `if (x !== undefined)` block in `VenueService.updateVenue` (`venue.service.js:65-92`) |
| Add a per-event venue detail field | Add column to `eventVenueProfiles.js`; wire it into the `venueProfile` handling in `event.service.js` (create path ~line 298, update path ~line 1920+) |
| Debug why an event isn't showing venue info | Check `event_venue_profiles` (per-event overlay) first, then `venues` (global defaults) — different event-read queries join different things; confirm which one the specific query you're debugging uses |
| Reset an organizer staff member's password | `POST /api/organizer-profiles/:organizerId/members/:memberId/regenerate-password` (ownership-checked) — response includes the new plaintext password once, it is not retrievable again |
| Investigate a Stripe Connect / payout issue for an organizer | Start in [07-payments-stripe.md](./07-payments-stripe.md); this module only owns the route surface (`organizer.route.js` STRIPE CONNECT / EARNINGS / WALLET sections), not the logic |

## Related Modules

- **[02-events.md](./02-events.md) — Event teams.** `organizer_members` (this doc) and
  `event_teams`/`event_team_members` (events doc) are **two separate tables and two separate
  systems**, not two names for the same concept:

  | | Organizer members (`organizer_members`) | Event teams (`event_team_members`) |
  |---|---|---|
  | Scope | Whole organizer (all their events) | One specific event (`event_teams.eventId`) |
  | Created via | `/api/organizer-profiles/:organizerId/members*` | `/api/events/:eventId/teams/...` |
  | Permissions shape | Flat `permissions text[]` on the member row, default `['scan_tickets']` | `event_team_roles.permissions` (jsonb) ∪ `event_team_members.permissions` (jsonb) — role + per-member override |
  | Permission enforcement | None beyond `authMiddleware` at the route (nothing checks the array) | `requireEventPermission()` middleware / `EventTeamService.hasPermission()`, though many keys are still unenforced (`docs/superpowers/permissions-flow.md`) |
  | Auth for scanning | memberCode + password via `TicketScanningService.authenticateMember` | Same function, same memberCode+password mechanism, different table |
  | Linked user account | No — standalone `memberName`/`memberPassword` | Optional — `event_team_members.userId` can link to a real platform user |

  They intersect only at the ticket-scanning layer (`ticket_scans` has one FK to each) and at the
  organizer-owner bypass (`platformUserCan` in `permissions-flow.md`: the organizer owner and
  admins always bypass event-team permission checks — organizer members do **not** get this
  bypass, they only have whatever's in their own `permissions` array).

- **[07-payments-stripe.md](./07-payments-stripe.md) — Earnings & payouts.** All of
  `/api/organizers/{stripe/connect/*, earnings/*, fee-calculator/*, wallet/*, payout-methods/*}`
  is routed through `organizer.route.js` (this module owns the routes) but the actual logic lives
  in `StripeConnectService`, `OrganizerEarningsService`, and `PayoutMethodService`, fully covered
  in the payments doc. In short: organizer signup triggers Connect account creation, the
  organizer completes onboarding via a hosted link, sales accrue into a wallet balance net of
  platform/Stripe fees, and the organizer requests cashouts against configured payout methods.
