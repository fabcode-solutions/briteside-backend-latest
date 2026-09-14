# Auth & Users — KT

## Overview

This module owns three things:

1. **Authentication** — email/phone+password signup & login, OAuth (Google, Facebook; Apple wired but disabled), JWT issuance/refresh, password reset via OTP, email verification.
2. **User accounts** — the `users` table itself, profile CRUD, `userInformation` (address/geo), roles.
3. **Username reservations** — a separate pre-launch/creator-influencer intake flow that lets someone claim a username before they have an account, subject to admin approval.

Almost every other module depends on this one: `authMiddleware` (`src/middlewares/auth.middleware.js`) is the gate that populates `req.user` for nearly all authenticated routes across the app, and `passport.js`'s `jwt` strategy is what every bearer-token request is verified against. Roles (`req.user.roles`), organizer/talent linkage, and the BriteSide Plus flag (`isBritesidePlus`) are all resolved here and consumed everywhere else (organizer checks, talent profile checks, subscription gating).

Account **suspension** enforcement (blocking logins/requests for moderated users) lives partly in this module (`auth.middleware.js`, `utils/suspension.js`) but the full moderation/appeals workflow — reports, admin review, appeals — is documented in [09-moderation.md](./09-moderation.md). This doc only covers the gate, not the workflow behind it.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/auth.route.js` | All `/api/auth/*` routes: register/login (web + mobile), OTP password reset, email verification, OAuth (Google/Facebook/Apple), CSRF token issuance. Defines its own Zod schemas inline. |
| `src/routes/user.route.js` | `/api/users/*` — profile + user-information CRUD. Mounted behind `authMiddleware` at the router level ( `src/routes/index.js:69`). |
| `src/routes/reservation.route.js` | `/api/reservations/*` — public username-reservation intake endpoints. |
| `src/controllers/auth.controller.js` | HTTP layer for all auth flows, including all OAuth callback/mobile handlers. Also defines `toPublicUser()`, the shape returned to clients (strips `passwordHash`, adds derived `isSuspended`/`isPlus`/etc). |
| `src/controllers/user.controller.js` | Profile get/update, user-information get/upsert. Runs profile text (bio/name) through `TextModerationService` before saving. |
| `src/controllers/usernameReservation.controller.js` | Handlers for both the public reservation endpoints and the admin management endpoints (admin ones are routed from `admin.route.js`, not `reservation.route.js`). |
| `src/services/auth.service.js` | Core auth business logic: `registerUser`, `loginWithIdentifier`, `loginWithPhone`, OTP generate/verify/reset, email verification, `issueAccessToken`. Uses **bcryptjs**. |
| `src/services/oauth.service.js` | Google/Facebook/Apple token verification and find-or-create-user logic; links `accounts` rows per provider. |
| `src/services/token.service.js` | JWT signing (`generateToken`), `tokens` table persistence for refresh/reset/verify-email tokens, `generateAuthTokens`, `refreshAuth`. |
| `src/services/user.service.js` | Drizzle queries against `users`/`userInformation`/`roles`/`userRoles`: `findByEmail`, `findByPhone`, `getUserByUsernameOrEmail`, `getUserById`, `createUser`, `updateUserById`, `createUserInformation`, etc. Wraps every export in `withDbErrorHandling` which logs to `authLogger` and rethrows as `ApiError`. |
| `src/services/usernameReservation.service.js` | Reservation availability checks, create/list/approve/reject, statistics, and the registration-time check (`checkUsernameForRegistration`) that `auth.service.registerUser` calls. |
| `src/db/schema/users.js` | `users`, `roles`, `userRoles`, `accounts` (OAuth links), `sessions`/`verificationTokens` (NextAuth-shaped but unused by this app's own auth), `tokens` (JWT-adjacent refresh/reset/verify records), `userInformation`. |
| `src/db/schema/usernameReservations.js` | `usernameReservations` table + its enums (`status`, `primaryPlatform`, `followerCount`). |
| `src/config/passport.js` | Passport strategy definitions: `jwtStrategy`, `googleStrategy`, `facebookStrategy`, and a fully-commented-out `appleStrategy`. |
| `src/config/tokens.js` | `TOKEN_TYPES` enum: `ACCESS`, `REFRESH`, `RESET_PASSWORD`, `VERIFY_EMAIL`. |
| `src/config/authLogger.js` | Dedicated Winston logger (`logs/authlogs-*.log`), `warn` level threshold, used by both the controller and `user.service.js`'s error wrapper. |
| `src/middlewares/auth.middleware.js` | `authMiddleware`, `optionalAuthMiddleware`, `authMiddlewareAllowSuspended`, `requireAdmin` — JWT verification via Passport + suspension gating. |
| `src/utils/suspension.js` | `isUserEffectivelySuspended(user)`, `suspensionDaysRemaining(user)` — pure helper functions shared by the middleware and the controller's `toPublicUser`. |
| `src/config/config.js` | Zod-validated env vars: `JWT_SECRET`, JWT expirations, Google/Facebook/Apple OAuth env vars. |
| `src/db/schema.js` | *Not* part of `db/schema/` — a separate top-level file with legacy Zod request-schemas (`insertUserSchema`, `loginUserSchema`, `refreshTokenSchema`, etc). Only `refreshTokenSchema` is actually still imported (by `auth.route.js`); the rest look like dead/legacy schemas superseded by the inline Zod schemas in `auth.route.js`. |

## Data Model

```
users ──1:1── userInformation
users ──1:N── userRoles ──N:1── roles
users ──1:N── accounts            (OAuth provider links: google/facebook/apple)
users ──1:N── tokens              (refresh / resetPassword / verifyEmail JWTs)
users ──1:1── organizers (optional, via organizer relation)
users ──1:1── talentProfiles (optional, looked up by userId, not a formal FK relation object)
usernameReservations             (standalone — only loosely tied to users by email/username string match, no FK except reviewedBy)
```

### `users` (`src/db/schema/users.js:28`)

Key columns:

| Column | Notes |
|---|---|
| `id` | `uuid`, PK |
| `username`, `email`, `phoneNumber` | Each unique; `phoneNumber` and `firstName`/`lastName` are `notNull` — **email is nullable** (mobile registration can register with no email, see `allowEmptyEmail`) |
| `passwordHash` | `notNull` — OAuth-created users get `passwordHash: ''` (empty string, not null) |
| `isEmailVerified`, `verificationToken`, `verificationExpires` | Email verification flow |
| `resetPasswordToken`/`resetPasswordExpires`/`resetPasswordOtp`/`resetPasswordOtpExpires` | Present in schema but the **live** reset flow uses the in-memory OTP store in `auth.service.js`, not these columns (see Gotchas) |
| `isBritesidePlus` | Denormalized subscription flag, kept in sync by `passport.js`'s `jwtVerify` on every authenticated request (fire-and-forget update if drifted) |
| `isSuspended`, `suspendedUntil`, `suspensionReason` | Moderation fields — enforced in `auth.middleware.js`, full workflow in [09-moderation.md](./09-moderation.md) |
| `userSearch` | Generated `tsvector` column (first/last/username), GIN-indexed, used for search — never written directly by app code |
| `fcmTokens` | `text[]`, push notification tokens |
| `loginCount`, `lastLogin` | Updated by `authService.recordLogin` on every successful login (password or OAuth) |

### `roles` / `userRoles`

Simple many-to-many. `userService.createUser` auto-assigns the `authenticated` role to every new user (`user.service.js:103-118`) if that role row exists. `requireAdmin` middleware checks for an `admin` role string in `req.user.roles`.

### `accounts`

OAuth provider link table (NextAuth-shaped: composite PK on `(provider, providerAccountId)`). One row per linked provider per user. Access/refresh tokens from mobile flows are intentionally **not stored** (`id_token`/`access_token` set to `null`) — only web OAuth (passport strategies) persists provider tokens.

### `tokens`

Generic JWT record table keyed by `userId` + `type` (`token_enum`: `refresh`, `reset`, `verifyEmail` — note this enum doesn't include `access`, since access tokens are never persisted). Used for refresh-token rotation and reset/verify-email token validation (the token must exist in this table *and* pass `jwt.verify`, so revoking = deleting the row).

### `userInformation`

1:1 with `users` (unique `userId`), holds address/geo (`googlePlaceId`, `latitude`/`longitude` as `decimal`, city/state/country/postalCode).

### `usernameReservations` (`src/db/schema/usernameReservations.js`)

Not FK-linked to `users` except `reviewedBy → users.id`. Matched against real users/registrations by **case-insensitive username and email string comparison** (`ilike`), not by ID — see Core Flows #4.

## API Endpoints

All paths below are relative to `/api` (mounted in `src/app.js:178` → `src/routes/index.js`).

### Auth (`/api/auth`, mounted at `src/routes/index.js:51`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public (rate-limited, CSRF) | Web registration, email+password |
| POST | `/auth/login` | Public (rate-limited, CSRF) | Web login by email/phone/username + password |
| GET | `/auth/session` | `authMiddleware` | Return current user + talent/organizer flags (used by web SPA to hydrate session) |
| POST | `/auth/logout` | Public (no auth check in handler) | No-op success response — see Gotchas |
| POST | `/auth/refresh-token` | Public (body carries refresh token) | Exchange refresh token for new access+refresh pair |
| POST | `/auth/forgot-password` | Public (rate-limited) | Send OTP for password reset |
| POST | `/auth/resend-otp` | Public (rate-limited) | Resend OTP (same as forgot-password) |
| POST | `/auth/verify-otp` | Public (rate-limited) | Validate OTP without consuming it |
| POST | `/auth/reset-password` | Public (rate-limited) | Consume OTP, set new password |
| POST | `/auth/mobile/register` | Public (rate-limited) | Mobile registration, phone-first, email optional |
| POST | `/auth/mobile/login` | Public (rate-limited) | Mobile login by phone + password |
| GET | `/auth/verify-email` | Public (token in query string) | Consume email-verification token |
| GET | `/auth/csrf-token` | Public (CSRF middleware issues cookie/token) | Web clients fetch a CSRF token before register/login |
| GET | `/auth/google` | Public | Kick off Google OAuth (web, redirect flow) |
| GET | `/auth/google/callback` | Public | Google OAuth callback → redirects to frontend with token in query string |
| POST | `/auth/google/mobile` | Public | Mobile Google Sign-In via ID token |
| GET | `/auth/facebook` | Public | Kick off Facebook OAuth (web) |
| GET | `/auth/facebook/callback` | Public | Facebook OAuth callback → redirect |
| POST | `/auth/facebook/mobile` | Public (rate-limited) | Mobile Facebook Sign-In via access token or JWT |
| GET | `/auth/apple` | Public | **Route exists but strategy is disabled — will error at runtime**, see Core Flows #2 |
| GET / POST | `/auth/apple/callback` | Public | Same — dead route while Apple strategy is commented out |
| POST | `/auth/apple/mobile` | Public (rate-limited) | Mobile Apple Sign-In via identity token — this path bypasses Passport entirely (`verifyAppleIdentityTokenAndGetUser`), so it **does work** despite the strategy being disabled |

Note: `googleAuth`/`googleCallback`/`facebookAuth`/`facebookCallback` are **not** wrapped in a rate limiter in the route file, unlike most other auth endpoints.

### Users (`/api/users`, mounted at `src/routes/index.js:69` — router-level `authMiddleware`, so every route below requires auth even though `user.route.js` only re-applies it on some)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/users/profile` | `authMiddleware` (router-level) | Get the current user's profile |
| PUT | `/users/profile` | `authMiddleware` (router-level + explicit) | Update profile fields (name, bio, image, dob, privacy toggles); runs bio/name through text moderation |
| GET | `/users/information` | `authMiddleware` | Get `userInformation` row (address/geo) |
| PUT | `/users/information` | `authMiddleware` | Upsert `userInformation` |

### Username Reservations (`/api/reservations`, public; admin variants under `/api/admin/reservations`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/reservations/check-username/:username` | Public | Check if a username is free to reserve |
| POST | `/reservations` | Public | Submit a reservation (name/email/username/platform/followers/profile URL) |
| GET | `/reservations/status?email=` | Public | Look up reservation status by email |
| GET | `/admin/reservations/statistics` | `authMiddleware` + `requireAdmin` (router-level, `admin.route.js:47`) | Counts by status |
| GET | `/admin/reservations` | `authMiddleware` + `requireAdmin` | Paginated/filterable list |
| GET | `/admin/reservations/:reservationId` | `authMiddleware` + `requireAdmin` | Single reservation |
| PATCH | `/admin/reservations/:reservationId/status` | `authMiddleware` + `requireAdmin` | Approve/reject; triggers approval/rejection email |

## Core Flows

### 1. Signup / login with email+password

**Register** (`POST /api/auth/register` → `authController.registerBasic` → `authService.registerUser`, `src/services/auth.service.js:82`):

1. Normalize email (mobile flow can pass `allowEmptyEmail: true` and an empty string becomes `null`).
2. `ensureUniqueUserFields` checks phone/email/username aren't already taken **and**, for username, checks it isn't reserved-by-someone-else via `usernameReservationService.checkUsernameForRegistration` (auth.service.js:56-64).
3. Hash password with `bcrypt.hash(password, 10)` — **this is the `bcryptjs` package** (see Gotchas), not the native `bcrypt` binding.
4. Insert user (`userService.createUser`), which also assigns the `authenticated` role.
5. Optionally insert `userInformation`.
6. If username+email were used and match an approved reservation, `markReservationAsUsed` (best-effort, no error if not found).
7. Re-fetch the full user (with roles/userInformation) and issue a short-lived access token via `issueAccessToken` (7-day expiry constant `ACCESS_TOKEN_TTL_DAYS`, **independent of** the `JWT_ACCESS_EXPIRATION_MINUTES` config used elsewhere — see Gotchas).
8. If email present: generate + persist a verify-email token (`tokenService.generateVerifyEmailToken`), send verification + welcome emails (both best-effort; failures are logged, not thrown).
9. Controller wraps the user via `toPublicUser()` and returns `{ user, token }`.

**Login** (`POST /api/auth/login` → `authController.login` → `authService.loginWithIdentifier`, auth.service.js:161):

1. `userService.getUserByUsernameOrEmail(identifier)` — matches against email, phone, **or** username in one query (`or(...)` in `user.service.js:64-68`).
2. Reject if no user or no `passwordHash`.
3. `bcrypt.compare(password, user.passwordHash)`.
4. `recordLogin` (updates `lastLogin`/`loginCount`).
5. Issue access token (`issueAccessToken` — the 7-day token, not `tokenService.generateAuthTokens`).
6. Controller **also** calls `tokenService.generateAuthTokens(user)` on top (`auth.controller.js:166`), so the login response actually returns **both** an `authService`-issued `token` (7 days, `TOKEN_TYPES.ACCESS`, not persisted) **and** a `tokens` object (`access`/`refresh` pair, `access` = `JWT_ACCESS_EXPIRATION_MINUTES` from config, `refresh` persisted to the `tokens` table). Frontends need to know which one they're actually using — see Gotchas.

Mobile login/register (`mobileLogin`/`mobileRegister`) follow the identical service logic but key off phone number and only issue the single `authService` token (no `tokens.generateAuthTokens` call).

### 2. OAuth login (Google / Facebook; Apple disabled)

**Web flow (Google shown, Facebook identical shape):**

1. `GET /api/auth/google` → `passport.authenticate('google', { scope, session: false })` redirects to Google.
2. Google redirects to `GET /api/auth/google/callback`. `passport.authenticate('google', ...)` runs `googleVerify` (`src/config/passport.js:89`), which calls `findOrCreateGoogleUser` (`oauth.service.js:181`):
   - Looks up an existing `accounts` row for `(google, profile.id)`. If found, updates tokens and returns that user.
   - Else looks up by email; if no user, creates one with a **generated placeholder phone number** (`generateUniquePhoneNumber`, a random 10-digit number — because `phoneNumber` is `notNull` on `users`) and a generated unique username derived from the email local-part.
   - Links the `accounts` row.
3. Controller (`googleCallback`) issues an access token via `authService.issueAccessToken` (the 7-day one — **not** the refresh-pair), records the login, and **redirects** the browser to `${FRONTEND_URL}/auth/callback?token=...` — i.e., the token is delivered via a URL query param on a redirect, not a JSON body.
4. On error, redirects to `${FRONTEND_URL}/auth/error?message=...` instead of returning an HTTP error status.

**Mobile flow (Google/Facebook/Apple all follow this shape, bypassing Passport):**

- `POST /api/auth/google/mobile` (`googleMobileAuthController`) takes an `idToken`, verifies it directly against Google's `OAuth2Client` (`oauth.service.js:282`), converts the payload into a Passport-shaped `profile` object, and reuses `findOrCreateGoogleUser`. Returns JSON (`{ type: 'success', data: { accessToken, user } }`), not a redirect.
- `POST /api/auth/facebook/mobile` handles **both** legacy Facebook access tokens and iOS "Limited Login" JWTs, auto-detecting by counting `.`-separated JWT segments, with fallback logic if the primary path fails (`auth.controller.js:513-563`).
- `POST /api/auth/apple/mobile` (`appleMobileAuthController`) verifies the Apple identity token via `apple-signin-auth`'s `verifyIdToken` (`oauth.service.js:673`) — this is independent of Passport and **works even though the Apple passport strategy is disabled**.

**Apple web flow is dead code**: In `src/config/passport.js:171-180` the `appleOptions` config object and the `appleStrategy` export itself (line 216) are both commented out. In `src/app.js`, only `jwtStrategy`, `googleStrategy`, `facebookStrategy` are registered with `passport.use(...)` (lines 87-89); `passport.use('apple', appleStrategy)` is commented out (line 90). So `GET/POST /api/auth/apple` and `/api/auth/apple/callback` will fail at runtime (`passport.authenticate('apple', ...)` — no strategy named `'apple'` registered). The `appleVerify` callback function (passport.js:182) is defined but unreachable. Only the mobile Apple path (`/api/auth/apple/mobile`) is live.

### 3. JWT refresh

`POST /api/auth/refresh-token` → `authController.refreshTokens` → `tokenService.refreshAuth(refreshToken)` (`token.service.js:125`):

1. `verifyToken(refreshToken, TOKEN_TYPES.REFRESH)` — `jwt.verify`'s the signature/expiry **and** requires a matching row in the `tokens` table (userId + token + type) to exist, i.e. refresh tokens are revocable server-side by deleting the row.
2. Loads the user; if missing, throws (caught and re-thrown as generic 401 `ApiError(UNAUTHORIZED, 'Please authenticate')` — the specific failure reason is swallowed).
3. Deletes the old refresh token row (rotation — old refresh token is single-use).
4. Calls `generateAuthTokens(user)` again to mint a fresh access+refresh pair, persisting the new refresh token.

Access tokens themselves are **never persisted** and cannot be revoked individually — only refresh tokens are stored, so revocation is only meaningful for refresh (logout deletes the specific refresh token row via `POST /api/auth/logout` → the *unused* `authController.logout` handler, not `logoutBasic` — see Gotchas).

### 4. Username reservation flow

Public intake, independent of having an account — designed for influencers/creators to reserve a handle before BriteSide launch/their signup.

1. `POST /api/reservations` (`createReservation`) — validates via Zod (name/email/username/platform enum/follower-range enum/profile URL), then `usernameReservationService.createReservation`:
   - Re-checks availability (username not taken by a real user, no pending/approved reservation already covers it) — `checkUsernameAvailability` matches case-insensitively (`ilike`) against **both** `users.username` and `usernameReservations.username`.
   - Rejects if the same email already has a `pending` reservation.
   - Inserts with `status: 'pending'`.
2. Admin reviews via `PATCH /api/admin/reservations/:id/status` (`updateReservationStatus`):
   - On approve: re-verifies the username hasn't since been taken by a real user or approved under a different reservation (race protection at approval time, not just submission time).
   - Sets `reviewedBy`/`reviewedAt`, fires an approval or rejection email (fire-and-forget, logged not thrown on failure).
3. At registration time (`authService.registerUser` → `ensureUniqueUserFields` → `usernameReservationService.checkUsernameForRegistration`, `usernameReservation.service.js:320`): if the username has an `approved` reservation, the registering user can only use it if their **email matches** the reservation's email (case-insensitive) and the reservation hasn't `expiresAt`-expired. Otherwise registration is blocked with a 409.
4. On successful registration with a matching username+email, `markReservationAsUsed` stamps the reservation's `reviewNotes` (does **not** change `status` — the reservation stays `approved` forever, it's just annotated) — see Gotchas.

There is no FK linking a `usernameReservations` row to the `users` row it was ultimately used by; the relationship is entirely inferred by matching `username`+`email` strings at read time.

## Integrations

| Integration | Used for | Where |
|---|---|---|
| Google (`google-auth-library`, `passport-google-oauth20`) | OAuth login (web redirect + mobile ID-token verification) | `oauth.service.js`, `config/passport.js` |
| Facebook Graph API (`passport-facebook` + raw `fetch` to `graph.facebook.com`) | OAuth login (web redirect, mobile access-token/JWT verification) | `oauth.service.js` |
| Apple (`apple-signin-auth`, `passport-apple`) | Mobile Sign-In with Apple only (web strategy disabled) | `oauth.service.js`, `config/passport.js` |
| AWS SNS (`sendSMS`, `src/utils/aws.util.js`) | OTP delivery for phone-based password reset | `auth.service.js:242` (`generateAndSendOtp`) |
| Mail (`mail.service.js`, backed by SES per project overview) | Password-reset OTP emails, email verification, welcome email, username-reservation approve/reject emails | `auth.service.js`, `usernameReservation.controller.js` |
| Text moderation (`services/moderation/textModeration.service.js`) | Screens profile bio/first/last name edits before saving | `user.controller.js:100-126` — see [09-moderation.md](./09-moderation.md) |

## Business Rules & Gotchas

- **bcrypt vs bcryptjs — both are dependencies, but usage is split and inconsistent.** `package.json` lists both `bcrypt: ^6.0.0` (native binding) and `bcryptjs: ^3.0.2` (pure JS). `src/services/auth.service.js` imports **`bcryptjs`** and uses it for registration hashing, login comparison, and OTP-based password reset. `src/controllers/auth.controller.js` separately imports **`bcrypt`** (native) and uses it in the legacy `resetPassword` controller function (the token-based reset flow, not the OTP-based one wired into the current routes). Since `bcrypt` and `bcryptjs` produce compatible/interchangeable hash formats, this isn't a functional bug today, but don't assume one library everywhere — check the specific file.
- **Login returns two different token shapes simultaneously.** `authController.login` returns both `token` (a single 7-day access-only JWT from `authService.issueAccessToken`, never persisted, not refreshable) and `tokens` (an `{ access, refresh }` pair from `tokenService.generateAuthTokens`, `access` expiring per `JWT_ACCESS_EXPIRATION_MINUTES`, `refresh` persisted and rotatable via `/refresh-token`). `register`/`mobileRegister`/`mobileLogin`/OAuth flows only ever return the single `token` — they never call `generateAuthTokens`, so OAuth-authenticated sessions have **no refresh token** and must re-authenticate via the provider when the 7-day token expires.
- **Two different "logout" implementations exist.** `authController.logoutBasic` (wired to `POST /api/auth/logout` in `auth.route.js:148`) does nothing but return a success message — it never touches the `tokens` table. `authController.logout` (defined in the same file, exported, but **not routed anywhere**) is the one that actually deletes a refresh-token row. Net effect: hitting `/api/auth/logout` does not invalidate anything server-side.
- **Password reset has two parallel flows.** The OTP flow (`forgot-password` → `verify-otp` → `reset-password`, backed by an **in-memory `Map`** in `auth.service.js`, not the DB) is what the routes actually wire up. There's also an older token-based flow (`forgotPassword`/`resetPassword` controller functions using `tokenService.generateResetPasswordToken` + the `tokens` table) that's exported from the controller but not attached to any route in `auth.route.js` — dead code unless something else calls it directly. The in-memory OTP store also means **OTPs don't survive a process restart/redeploy**, and won't work correctly if this API ever runs multi-instance without sticky sessions (each instance has its own `Map`).
- **Apple web OAuth is fully disabled** — see Core Flows #2. If you need to re-enable it: uncomment `appleOptions`/`appleStrategy` in `config/passport.js`, uncomment `passport.use('apple', appleStrategy)` in `app.js:90`, and import `appleStrategy` into `app.js`'s destructured import on line 15. The route handlers (`appleAuth`/`appleCallback` in `auth.controller.js`) are already written and wired in `auth.route.js`.
- **JWT expiry is configured in three unrelated places**: `env.jwt.accessExpirationMinutes`/`refreshExpirationDays` (from `JWT_ACCESS_EXPIRATION_MINUTES`/`JWT_REFRESH_EXPIRATION_DAYS`, used by `tokenService.generateAuthTokens`), the hardcoded `ACCESS_TOKEN_TTL_DAYS = 7` constant in `auth.service.js` (used by `issueAccessToken`, called on every register/login/OAuth path), and `resetPasswordExpirationMinutes`/`verifyEmailExpirationMinutes` (also env-driven, used only by the dead token-based reset flow and by email verification respectively).
- **Suspension gating happens in `authMiddleware`, not in login.** A suspended user can still successfully log in (password check passes, tokens are issued) — enforcement happens on the *next* authenticated request, when `authMiddleware`/`optionalAuthMiddleware` check `req.user.isSuspended` via `isUserEffectivelySuspended()` (`src/utils/suspension.js`). Time-based suspensions (`suspendedUntil` in the past) are **auto-cleared** on the first request after expiry (fire-and-forget DB update) rather than by any cron job. `authMiddlewareAllowSuspended` exists specifically so a suspended user can still hit the appeals endpoint — see [09-moderation.md](./09-moderation.md) for the full workflow.
- **`isBritesidePlus` is self-healing on every request.** `passport.js`'s `jwtVerify` (run on every authenticated request) queries `userSubscriptions` for an active/trialing/comped row and overwrites the user object's flag in-memory for that request; if it drifted from the DB column, it fires an async update to fix the column too. Don't trust the raw `users.isBritesidePlus` column in a one-off query without accounting for lag — it's *eventually* consistent, corrected lazily on next auth.
- **Username matching for reservations is case-insensitive and string-based, not FK-based.** A user can only claim their `approved` reservation if their registration `email` matches (case-insensitively) — there's no login/session tie-in. `markReservationAsUsed` only annotates `reviewNotes`; it does not flip `status`, so an "approved" reservation stays queryable as approved indefinitely even after use.
- **`phoneNumber` is required on `users`** (`notNull` + unique). All OAuth-created users get a randomly generated placeholder phone number (`generateUniquePhoneNumber`) since they don't provide one — don't assume a real phone number implies the user actually verified/owns that number.
- **CSRF protection (`csurf`) only guards `/auth/register` and `/auth/login`** (plus the `/auth/csrf-token` issuance endpoint itself) — mobile/OTP/OAuth endpoints don't use it, since those aren't cookie-session-based flows.
- **Rate limits are dev-permissive.** Every limiter in `src/middlewares/rateLimiter.js` sets `max` to `1000` when `NODE_ENV !== 'production'`, so don't rely on local testing to catch rate-limit regressions — check the production `max` value (e.g. login: 25/15min, register: 3/20min, OTP: 5/20min) directly in that file.
- **`src/db/schema.js` (top-level) is distinct from `src/db/schema/` (the folder).** Only `refreshTokenSchema` from the top-level file is actually imported (by `auth.route.js`); the other exports there (`insertUserSchema`, `loginUserSchema`, etc.) look unused by any current route — the routes define their own inline Zod schemas instead.

## Common Tasks

| If you need to... | Look at... |
|---|---|
| Add a new OAuth provider | Add a passport strategy in `config/passport.js` (model off `googleStrategy`/`facebookStrategy`), register it with `passport.use(...)` in `app.js`, add find-or-create logic in `oauth.service.js`, add route handlers in `auth.controller.js` + `auth.route.js` (web redirect + mobile variants), and don't forget an `accounts.provider` value and env vars in `config/config.js` |
| Re-enable Apple web OAuth | Uncomment the three spots listed under "Apple web OAuth is fully disabled" above |
| Change what's inside the JWT access token payload | `tokenService.generateToken` (`token.service.js:21`) — payload is currently just `{ sub, iat, exp, type }`; also check `passport.js`'s `jwtVerify` since it re-derives roles/organizerId/isBritesidePlus from DB rather than trusting the token payload |
| Add a new field returned in the public user object | `toPublicUser()` in `auth.controller.js:24` — this is the single place that shapes what `/login`, `/register`, `/session` etc. send back |
| Change password hashing | Decide bcrypt vs bcryptjs deliberately and update both `auth.service.js` (bcryptjs) and the legacy `resetPassword` in `auth.controller.js` (bcrypt) if you want consistency — currently they differ |
| Add a new user profile field that needs moderation | Follow the pattern in `user.controller.js:updateUserProfile` — collect changed text fields into `profileTextEntries`, run `TextModerationService.assertAllowed` before persisting, `recordIfFlagged` after |
| Debug "why didn't my refresh token work" | Check the `tokens` table for a matching row (userId + token + type=`refresh`) — `verifyToken` requires both a valid JWT signature *and* a live DB row; a used/rotated/deleted refresh token will fail even with a valid signature |
| Add fields to the username reservation form | `createReservationSchema` in `reservation.route.js`, the `usernameReservations` table/enums in `db/schema/usernameReservations.js`, and thread the new field through `usernameReservation.service.js`'s `createReservation`/`getReservations` |
| Debug suspended-user access issues | `auth.middleware.js` + `utils/suspension.js` here; full moderation/appeal state machine in [09-moderation.md](./09-moderation.md) |

## Related Modules

- [09-moderation.md](./09-moderation.md) — full suspension/appeal workflow (this doc only covers the login/request-time enforcement gate) and the `TextModerationService` used on profile updates.
- [05-talent.md](./05-talent.md) — `talentProfiles` linkage (`talentProfileId`/`hasTalentProfile` surfaced in `toPublicUser`).
- [06-organizers-venues.md](./06-organizers-venues.md) — `organizers` linkage (`organizerId`/`hasOrganizerProfile`, resolved in `passport.js`'s `jwtVerify` and `auth.controller.js`'s `session`).
- [07-payments-stripe.md](./07-payments-stripe.md) — `userSubscriptions`/`isBritesidePlus`, kept in sync from this module's JWT verification path.
- [12-admin.md](./12-admin.md) — admin-side username reservation management endpoints live under `/api/admin/reservations` (routed from `admin.route.js`, handlers shared with `usernameReservation.controller.js`).
