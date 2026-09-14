# Admin — KT

## Overview

"Admin" in this codebase is not a separate service — it's a single router (`src/routes/admin.route.js`)
mounted at `/api/admin`, gated by `requireAdmin`, that acts as a **hub**: part of it is genuine
admin-only business logic living in `src/controllers/admin.controller.js` +
`src/services/admin.service.js`, and a large part of it is thin re-exports of controllers that
belong to *other* modules (venues, reserves, demo sessions, talent issues, shop refunds, talent
reviews, contact messages, username reservations, earnings/wallet, analytics). The route file is
the actual definition of "what admin can do" — you cannot infer that from `admin.controller.js`
alone.

What genuinely lives in `admin.controller.js` / `admin.service.js` and is **not** documented
elsewhere:

- **General user management** — list/search/filter users, view a user's full admin profile
  (roles, org/talent linkage, report count), edit a limited set of fields, soft-delete a user,
  assign/remove platform roles (`admin`, etc.).
- **Event moderation (admin override)** — list/search all events platform-wide, view any event,
  force-cancel or soft-delete any event regardless of owner.
- **Group moderation (admin override)** — list/search all groups, view any group, edit group
  settings, soft-delete a group, kick a member.
- **Social moderation (admin override)** — list all posts platform-wide, force-delete any post or
  comment.
- **Content-report resolution** — a `status`-only update path (`updateReportStatus`,
  `bulkUpdateReportStatus`) and a "resolve the underlying content" path
  (`resolveReportedEntity`) that deletes/cancels/suspends whatever the report points to and
  closes the report in one call. (The report *submission*, *review queue*, and *user
  suspension/appeal* mechanics themselves are covered in
  [09-moderation.md](./09-moderation.md) — this doc only covers the admin-side resolution
  actions and their audit trail.)
- **Category management** — CRUD on the platform-wide `categories` table (event/interest
  categories).
- **Platform fee configuration** — get/set the percentage platform cut applied to events, stored
  as a row in a generic `system_settings` key/value table and read back by
  `event.service.js`/`organizerEarnings.service.js` at payout-calculation time.
- **Talent verification** — list talent profiles pending review, toggle the "verified" badge.
- **Team role catalog** — CRUD on the global list of event-team roles (e.g. the roles organizers
  can assign to their event team members), exposed only through admin.
- **BriteSide Plus subscription administration** — create/update/deactivate subscription plans
  and their feature list, list/inspect all user subscriptions, grant a free ("comped")
  subscription, revoke a subscription, force-sync the `isBritesidePlus` flag, and manage Stripe
  coupons. (The Stripe billing/webhook/checkout mechanics underneath are covered in
  [07-payments-stripe.md](./07-payments-stripe.md) — this doc covers the admin CRUD surface only.)
- **Activity log viewer** — read-only, paginated view over the `audit_logs` table written by
  `writeAuditLog()` (see Business Rules & Gotchas — it's not written on every action).
- **Admin dashboard summary** — one aggregate endpoint (users/events/groups/posts/reports/revenue
  counts + 12-month user growth) separate from the fuller platform-analytics endpoints.

Everything else reachable under `/api/admin/*` is a **pass-through** to another module's
controller/service, mounted here purely so the frontend admin console has one base path and one
`requireAdmin` gate. Those are summarized briefly below and linked to their real home doc.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/admin.route.js` | The actual definition of the admin API surface — 800+ lines wiring `adminController` plus **9 other controllers** under `/api/admin`. All routes gated by `authMiddleware, requireAdmin`. |
| `src/routes/admin-analytics.route.js` | Separate router mounted at `/api/admin/analytics`, thin wrapper delegating to `adminController` platform-analytics functions. Gated the same way. |
| `src/controllers/admin.controller.js` | HTTP layer for the admin-native functionality listed above, plus several endpoints that call other services directly (`AnalyticsService`, `SubscriptionService`, `EventTeamService`, `appealService`, `RefundService`, `MediaModerationService`, etc.) rather than `adminService`. |
| `src/services/admin.service.js` | Business logic + Drizzle queries for user/event/group/post/comment/report/category/platform-fee/talent-verification management, the dashboard aggregate, activity-log query, and the `writeAuditLog()` helper. ~2000 lines. |
| `src/db/schema/admin.js` | `contentReports`, `adminTasks`, `taskSubtasks`, `auditLogs`, `adminReports`, `systemSettings`. Only `auditLogs` and `systemSettings` are actually used by live code — see Gotchas. |
| `src/middlewares/auth.middleware.js` | Defines `requireAdmin` (line 41) — the sole admin gate. |
| `src/services/subscription.service.js` | Owns the actual subscription plan/coupon/grant logic that `admin.controller.js` exposes; writes its own separate `subscriptionAuditLogs`, not `admin.js`'s `auditLogs`. |
| `src/services/eventTeam.service.js` | Owns the `eventTeamRoles` CRUD that the "team role management" admin routes expose. |
| `src/services/appeal.service.js` | Owns suspension-appeal review, exposed via `/api/admin/appeals` (see [09-moderation.md](./09-moderation.md)). |
| `src/controllers/adminEarnings.controller.js` | Owns the Connect/wallet/payout endpoints under `/api/admin/...` (see [07-payments-stripe.md](./07-payments-stripe.md)). |
| `src/controllers/reserves.controller.js` | Owns the payout-reserve summary/list/manual-release endpoints (see [07-payments-stripe.md](./07-payments-stripe.md)). |

## Data Model

All admin-native tables live in `src/db/schema/admin.js`. Only two are wired into live code paths;
the other three are defined (and even have Drizzle relations in `relations.js`) but nothing in
`src/controllers` or `src/services` reads or writes them — they appear to be leftover/planned
schema. See Gotchas.

| Table | Key columns | Notes |
|---|---|---|
| `audit_logs` | `id`, `action`, `resourceType`, `resourceId`, `userId` (FK `users.id`, `ON DELETE SET NULL`), `userIp`, `userAgent`, `previousValues`/`newValues`/`changes` (jsonb), `createdAt` | **Live.** Written by `writeAuditLog()` in `admin.service.js`. Read by `GET /api/admin/activity-logs`. Indexed on `(resourceType, resourceId)`, `userId`, `createdAt`. |
| `system_settings` | `id`, `settingKey` (unique), `settingValue` (jsonb), `description`, `isPublic`, timestamps | **Live**, generic key/value config store. Known keys in use: `platform_fee_percentage` (admin-managed, read by `event.service.js` / `organizerEarnings.service.js`), `payout_reserve_rate` (read by `organizerEarnings.service.js`; not exposed through any admin route). |
| `content_reports` | `id`, `reporterId`, `contentType`, `contentId`, `reason`, `status`, `reviewedBy`, `actionTaken`, `createdAt` | **Dead.** Structurally similar to the *actual* live report table `userReports` (`src/db/schema/userReports.js`), but no service imports `contentReports`. Its `relations.js` back-reference from `users` is explicitly commented out (`// contentReports: many(contentReports), // Removed`). Don't confuse the two when reading code. |
| `admin_tasks` / `task_subtasks` | task/subtask CRUD columns (`title`, `assignedTo`, `priority`, `status`, `dueDate`, `completedAt`, `createdBy`) | **Dead.** No controller/service references these tables at all (only the schema + relations exist). Looks like a planned "internal admin to-do list" feature that was never built. |
| `admin_reports` | `id`, `reportType`, `title`, `parameters`/`data` (jsonb), `generatedBy`, `generatedAt`, `expiresAt` | **Dead.** Looks like a planned "saved/generated report" feature (e.g. exportable analytics snapshots); no code path creates or reads rows. |

Related tables owned by *other* modules but touched by admin.service.js queries: `users`, `roles`,
`userRoles`, `events`, `groups`, `groupMembers`, `posts`, `postComments`, `categories`,
`talentProfiles`, `userReports`, `orders`, `discussions`, `discussionReplies`.

## API Endpoints

All routes below are mounted under `/api/admin` (from `routes/index.js`:
`router.use('/admin', adminRoutes)`) and require `authMiddleware, requireAdmin` — no exceptions,
the whole router has `router.use(authMiddleware, requireAdmin)` at the top of
`admin.route.js`. "Owner" = which controller/service actually implements it.

### Native admin functionality (this module)

| Method | Path | Purpose | Owner |
|---|---|---|---|
| GET | `/api/admin/reports/statistics` | Report counts by status/type | `admin.controller.getReportStatistics` |
| GET | `/api/admin/reports` | List content reports (paginated/filterable) | `report.controller.getReports` |
| PATCH | `/api/admin/reports/:reportId/status` | Set report status (`pending/reviewed/resolved/dismissed`) | `admin.controller.updateReportStatus` |
| PATCH | `/api/admin/reports/bulk-status` | Bulk set status on many reports | `admin.controller.bulkUpdateReportStatus` |
| POST | `/api/admin/reports/:reportId/resolve` | Resolve a report by acting on the reported entity (delete/cancel/suspend) | `admin.controller.resolveReportedEntity` |
| GET | `/api/admin/reports/:reportId` | Full report detail incl. resolved reported content | `admin.controller.getReportById` |
| PATCH | `/api/admin/users/:userId/suspension` | Suspend/unsuspend a user | `admin.controller.toggleUserSuspension` |
| DELETE | `/api/admin/posts/:postId` | Soft-delete a post directly | `admin.controller.deletePost` |
| GET | `/api/admin/moderation/media` | Media (image/video) moderation queue | `MediaModerationService` |
| PATCH | `/api/admin/moderation/media/:id/action` | Approve/flag/remove/shadow-ban a media item | `MediaModerationService` |
| GET | `/api/admin/moderation/calls` | Talent-session call moderation history | `TalentSessionService` |
| POST | `/api/admin/categories` | Create category | `admin.controller.createCategory` |
| PATCH | `/api/admin/categories/:categoryId` | Update category | `admin.controller.updateCategory` |
| DELETE | `/api/admin/categories/:categoryId` | Delete category | `admin.controller.deleteCategory` |
| GET | `/api/admin/platform-fee/manage` | Get current platform fee % | `admin.controller.getPlatformFeePercentage` |
| PATCH | `/api/admin/platform-fee` | Set platform fee % | `admin.controller.updatePlatformFeePercentage` |
| GET | `/api/admin/talent` | List talent profiles for verification review | `admin.controller.listTalentForVerification` |
| PATCH | `/api/admin/talent/:talentProfileId/verify` | Verify/unverify a talent profile | `admin.controller.verifyTalent` |
| GET | `/api/admin/users` | List/search/filter users | `admin.controller.listUsers` |
| GET | `/api/admin/users/:userId` | Full admin view of one user | `admin.controller.getUserById` |
| PATCH | `/api/admin/users/:userId` | Edit limited user fields | `admin.controller.updateUser` |
| DELETE | `/api/admin/users/:userId` | Soft-delete a user | `admin.controller.deleteUser` |
| POST | `/api/admin/users/:userId/roles` | Assign a platform role | `admin.controller.assignUserRole` |
| DELETE | `/api/admin/users/:userId/roles/:roleName` | Remove a platform role | `admin.controller.removeUserRole` |
| GET | `/api/admin/events` | List/search all events | `admin.controller.listEvents` |
| GET | `/api/admin/events/:eventId` | Full admin view of one event | `admin.controller.getEventById` |
| PATCH | `/api/admin/events/:eventId/cancel` | Force-cancel an event | `admin.controller.cancelEvent` |
| DELETE | `/api/admin/events/:eventId` | Soft-delete an event | `admin.controller.deleteEvent` |
| GET | `/api/admin/groups` | List/search all groups | `admin.controller.listGroups` |
| GET | `/api/admin/groups/:groupId` | Full admin view of one group | `admin.controller.getGroupById` |
| PATCH | `/api/admin/groups/:groupId` | Edit group settings as admin | `admin.controller.updateGroupByAdmin` |
| GET | `/api/admin/groups/:groupId/subscriptions` | Group's paid-subscription list | `GroupSubscriptionService` |
| DELETE | `/api/admin/groups/:groupId` | Soft-delete a group | `admin.controller.deleteGroupById` |
| DELETE | `/api/admin/groups/:groupId/members/:userId` | Remove a member from a group | `admin.controller.removeGroupMember` |
| GET | `/api/admin/posts` | List all posts platform-wide | `admin.controller.listPosts` |
| DELETE | `/api/admin/comments/:commentId` | Force-delete a comment | `admin.controller.deleteCommentById` |
| GET | `/api/admin/dashboard` | Aggregate dashboard stats (users/events/groups/posts/reports/revenue) | `admin.controller.getDashboardStats` |
| GET | `/api/admin/activity-logs` | Query the `audit_logs` table | `admin.controller.getActivityLogs` |
| GET | `/api/admin/team-roles` | List global event-team roles | `EventTeamService.getAllRoles` |
| POST | `/api/admin/team-roles` | Create a team role | `EventTeamService.createRole` |
| PATCH | `/api/admin/team-roles/:roleId` | Update a team role | `EventTeamService.updateRole` |
| DELETE | `/api/admin/team-roles/:roleId` | Delete a team role | `EventTeamService.deleteRole` |
| POST | `/api/admin/subscriptions/plans` | Create BriteSide Plus plan | `SubscriptionService.createPlan` |
| GET | `/api/admin/subscriptions/plans` | List all plans (incl. inactive) | `SubscriptionService.listPlans` |
| GET | `/api/admin/subscriptions/plans/:planId` | Get one plan | `SubscriptionService.getPlan` |
| PATCH | `/api/admin/subscriptions/plans/:planId` | Update plan | `SubscriptionService.updatePlan` |
| PATCH | `/api/admin/subscriptions/plans/:planId/deactivate` | Deactivate plan | `SubscriptionService.deactivatePlan` |
| GET | `/api/admin/subscriptions/features/registry` | Static feature-key registry (`FEATURE_REGISTRY`) | inline in route file |
| POST | `/api/admin/subscriptions/plans/:planId/features` | Attach feature to plan | `SubscriptionService.addFeatureToPlan` |
| DELETE | `/api/admin/subscriptions/plans/:planId/features/:featureId` | Detach feature from plan | `SubscriptionService.removeFeatureFromPlan` |
| GET | `/api/admin/subscriptions` | List all user subscriptions | `SubscriptionService.listAllSubscriptions` |
| GET | `/api/admin/subscriptions/analytics` | Subscription analytics | `SubscriptionService.getSubscriptionAnalytics` |
| GET | `/api/admin/subscriptions/coupons` | List Stripe coupons | `SubscriptionService.listCoupons` |
| POST | `/api/admin/subscriptions/sync-all` | Re-sync `isBritesidePlus` flag for all users | `SubscriptionService.syncAllPlusFlags` |
| GET | `/api/admin/subscriptions/:subscriptionId` | Subscription detail (incl. its own audit log) | `SubscriptionService.getSubscriptionById` |
| POST | `/api/admin/subscriptions/grant` | Grant a comped subscription | `SubscriptionService.grantSubscription` |
| POST | `/api/admin/subscriptions/users/:userId/sync` | Re-sync one user's `isBritesidePlus` flag | `SubscriptionService._syncPlusFlag` |
| PATCH | `/api/admin/subscriptions/:subscriptionId/revoke` | Revoke a subscription | `SubscriptionService.revokeSubscription` |
| POST | `/api/admin/subscriptions/coupons` | Create Stripe coupon | `SubscriptionService.createCoupon` |
| POST | `/api/admin/subscriptions/:subscriptionId/coupon` | Apply coupon to a subscription | `SubscriptionService.applyCouponToSubscription` |
| DELETE | `/api/admin/subscriptions/:subscriptionId/coupon` | Remove coupon from subscription | `SubscriptionService.removeCouponFromSubscription` |
| PATCH | `/api/admin/subscriptions/coupons/:couponId` | Rename coupon | `SubscriptionService.updateCoupon` |
| DELETE | `/api/admin/subscriptions/coupons/:couponId` | Delete coupon | `SubscriptionService.deleteCoupon` |
| GET | `/api/admin/appeals` | List suspension appeals | `appealService.listAppeals` (see [09-moderation.md](./09-moderation.md)) |
| PATCH | `/api/admin/appeals/:appealId/review` | Approve/reject an appeal | `appealService.reviewAppeal` (see [09-moderation.md](./09-moderation.md)) |

### Platform analytics (`/api/admin/analytics/*`) — see [08-dashboards-analytics.md](./08-dashboards-analytics.md)

Mounted separately as `router.use('/admin/analytics', adminAnalyticsRoutes)` — a distinct router
file (`admin-analytics.route.js`) with its own `authMiddleware, requireAdmin`. `GET /overview`,
`/user-metrics`, `/mau-trend`, `/signups-trend`, `/demographics`, `/interests`, `/group-courses`
plus, under `admin.route.js` itself, per-event/per-group/per-post/per-profile/ticket-sales
analytics endpoints (`/api/admin/analytics/events*`, `/analytics/groups/:groupId*`,
`/analytics/posts/:postId`, `/analytics/users/:userId/social`, `/analytics/ticket-sales`). These
all just call `AnalyticsService`/`GroupAnalyticsService`/`SocialAnalyticsService`/`TicketService`
with `{ isAdmin: true }` (bypasses ownership checks) — no admin-specific business logic beyond
that flag.

### Earnings / payouts / reserves — see [07-payments-stripe.md](./07-payments-stripe.md)

`GET /connect-accounts`, `/payouts`, `/users/:userId/connect-status`, `/stripe-dashboard`,
`/wallet`, `/wallet-summary`, `/transactions`, `/payouts`, `/earnings` (all via
`adminEarnings.controller.js`), plus `/users/:userId/tickets|orders|refunds`, `/refunds`,
`PATCH /refunds/:refundId/status`, `DELETE /refunds/:refundId` (via `TicketService`/
`OrderService`/`RefundService`), plus `GET /reserves/summary`, `GET /reserves`,
`POST /reserves/release` (payout-reserve holdback tracking + manual early release, via
`reserves.controller.js`).

### Other pass-throughs (each documented in its own module's KT file)

| Routes | Delegates to | Documented in |
|---|---|---|
| `GET /venues`, `GET /venues/:venueId` | `venue.controller.js` (`VenueService`) | [06-organizers-venues.md](./06-organizers-venues.md) |
| `GET /demo-sessions*`, CRUD + registrations | `demo.controller.js` | [13-platform-services.md](./13-platform-services.md) |
| `GET /talent-issues*`, `PATCH /talent-issues/:issueId/resolve` | `talentIssue.controller.js` (`TalentIssueService`) | [05-talent.md](./05-talent.md) |
| `GET /shop-refund-requests`, `PATCH /shop-refund-requests/:requestId/override` | `shop.controller.js` (`ShopRefundService`) | [11-shop-merchandise.md](./11-shop-merchandise.md) |
| `GET /talent/:talentProfileId/dashboard-stats` | `talent.controller.js` | [05-talent.md](./05-talent.md) |
| `GET /talent-reviews`, `PATCH /talent-reviews/:reviewId/remove`, `PATCH /talent-reviews/:reviewId/dismiss` | `talent.controller.js` (`TalentReviewService`) | [05-talent.md](./05-talent.md) |
| `GET /reservations*` (username reservations) | `usernameReservation.controller.js` | [01-auth-users.md](./01-auth-users.md) |
| `GET /contact-messages*` | `contact.controller.js` | [13-platform-services.md](./13-platform-services.md) |

## Core Flows

### 1. Report → resolve reported content in one action

The report-review queue itself lives in [09-moderation.md](./09-moderation.md); the part specific
to this module is `resolveReportedEntity` (`src/services/admin.service.js:1265`), the "one-click"
resolution an admin uses from a report's detail view:

1. Admin calls `POST /api/admin/reports/:reportId/resolve` with `{ action: 'delete'|'cancel'|'suspend', reason }`.
2. Service loads the report, rejects if already `resolved`.
3. Switches on `report.type` (`post`, `comment`, `event`, `group`, `user`, `discussion`) and takes
   the matching action — e.g. `type: 'post'` soft-deletes the post; `type: 'event'` either
   soft-deletes or sets `eventStatus: 'cancelled'` depending on `action`; `type: 'user'` sets
   `isSuspended: true` directly (note: this bypasses `toggleUserSuspension`'s duration/email logic
   — it's a raw suspend flag, no `suspendedUntil`, no suspension email).
4. Writes one audit-log row (action name like `DELETE_POST_VIA_REPORT`,
   `CANCEL_EVENT_VIA_REPORT`, `SUSPEND_USER_VIA_REPORT`) with `{ reportId, reason }` in `changes`.
5. Marks the report `resolved` with an auto-built `actionTaken` string.
6. Comment/discussion-reply reports are special-cased: the report's `postId`/`discussionId` FK is
   the *parent* thread, not the comment itself — the actual comment/reply id is read out of
   `report.metadata.commentId` / `.discussionReplyId` (no dedicated FK column exists for it; see
   the comment in `getReportById`, `admin.service.js:1242`).

### 2. General user management (list, view, edit, delete, role assignment)

1. `GET /api/admin/users` — `listUsers()` filters by `status` (`active` = not deleted & not
   suspended, `suspended`, `deleted`), free-text `search` across first/last name, email, username
   (case-insensitive `ilike`), sorts by `createdAt`/`name`/`email`, paginates (max `limit=100`).
2. `GET /api/admin/users/:userId` — `getAdminUserById()` returns a wide column set (preferences,
   privacy toggles, timezone, login stats) plus `roles`, `userInformation`, `socialProfile`
   summary, `organizer` link if any, and a live `reportCount` (count of `userReports` targeting
   this user).
3. `PATCH /api/admin/users/:userId` — `updateUserByAdmin()` only allows
   `firstName/lastName/email/phoneNumber/bio/image` to change (allow-list, not a raw `.set(body)`);
   diffs old vs. new and writes an audit log **only if something actually changed**.
4. `DELETE /api/admin/users/:userId` — `deleteUserByAdmin()` is a soft delete (`deletedAt`),
   always audit-logged.
5. `POST /users/:userId/roles` / `DELETE /users/:userId/roles/:roleName` — `assignRole`/
   `removeRole()` operate on the `userRoles` join table against a fixed `roles` catalog by name;
   both 404 on unknown role name, `assignRole` 409s if the user already has it. This is how a user
   becomes an admin — there's no separate "make admin" endpoint, it's
   `POST /api/admin/users/:userId/roles { "roleName": "admin" }`.

### 3. Event / group / post / comment moderation-by-override

Same shape repeated four times (`listAllEvents`/`getAdminEventById`/`cancelEvent`/`deleteEvent`,
`listAllGroups`/`getAdminGroupById`/`updateGroupByAdmin`/`deleteGroup`/`removeGroupMember`,
`listAllPosts`, `deleteComment`) — these let an admin act on *any* event/group/post/comment
platform-wide bypassing the normal ownership check that the owner-facing endpoints in
[02-events.md](./02-events.md), [03-groups.md](./03-groups.md), [04-social.md](./04-social.md)
enforce. All are soft-deletes (`deletedAt`) except `cancelEvent` (status flip) and
`removeGroupMember`/`deleteComment` (hard delete row, since there's no soft-delete column on those).
`updateGroupByAdmin` uses the same "diff + audit-log only if changed" pattern as user updates.

### 4. Platform fee configuration

1. `GET /api/admin/platform-fee/manage` — reads the `system_settings` row keyed
   `platform_fee_percentage`; defaults to `10` if the row doesn't exist yet.
2. `PATCH /api/admin/platform-fee` — upserts that row (`{ percentage: number }` in `settingValue`
   jsonb), validated `0-100`.
3. This value is **not** applied by admin.service.js itself — it's read later by
   `event.service.js` and `organizerEarnings.service.js` when computing the platform's cut of an
   order/payout. **No audit log is written on this change** (see Gotchas).

### 5. BriteSide Plus plan & subscription administration

1. Admin defines pricing tiers: `POST /api/admin/subscriptions/plans` (`SubscriptionService.createPlan`),
   attaches gated features from the fixed `FEATURE_REGISTRY` (`src/constants/features.js` — 4 keys:
   talent profile, video booking, priority messaging, verified badge) via
   `POST /subscriptions/plans/:planId/features`.
2. Admin can bypass Stripe entirely for a specific user: `POST /subscriptions/grant` inserts a
   `userSubscriptions` row with `status: 'comped'`, `grantedBy: adminId` — no payment, no Stripe
   subscription object created. `PATCH /subscriptions/:subscriptionId/revoke` reverses it.
3. `POST /subscriptions/sync-all` / `POST /subscriptions/users/:userId/sync` recompute the
   denormalized `users.isBritesidePlus` boolean flag from the actual subscription state — an
   escape hatch for when the flag and the subscription table disagree.
4. All of the above call `writeSubscriptionAuditLog()` into a **separate**
   `subscription_audit_logs` table (not `admin.js`'s `audit_logs`) — visible only via
   `GET /subscriptions/:subscriptionId` (embedded), not via `GET /admin/activity-logs`.

## Integrations

- **Email (AWS SES via `mail.service.js`)** — `toggleUserSuspension` fire-and-forgets
  `sendSuspensionEmail`/`sendUnsuspensionEmail`; failures are swallowed (`.catch(() => {})`) so a
  broken mail send never fails the admin API call.
- **Stripe** — indirectly, through `SubscriptionService` (coupons, subscription objects) — the
  admin routes here are a management UI over Stripe-backed subscriptions/coupons, not a direct
  Stripe integration themselves.
- **Postgres only** — no GetStream, S3, or queue involvement in `admin.controller.js`/
  `admin.service.js` proper. (Other modules reached through the admin router do use those — e.g.
  media moderation touches S3-hosted content — but that's their integration, not admin's.)

## Business Rules & Gotchas

- **Access gate is a single flat role check.** `requireAdmin` (`src/middlewares/auth.middleware.js:41`)
  is just `req.user?.roles?.includes('admin')` — there is no permission granularity, no "admin
  levels," no per-endpoint scoping. Anyone with the `admin` role in `userRoles` can do everything
  in this entire file, including granting themselves other roles, deleting any user, and changing
  the platform fee. Every admin route in `admin.route.js` and `admin-analytics.route.js` is gated
  identically via `router.use(authMiddleware, requireAdmin)` at the top of each file — there is no
  route in either file that skips it.
- **No impersonation feature exists.** Grepped the codebase — there's no "log in as user" /
  impersonation endpoint anywhere. Admin acts *on* users via dedicated endpoints, never *as* them.
- **No "organizer approval" gate here.** Organizer account creation/verification is not part of
  this module (check [06-organizers-venues.md](./06-organizers-venues.md) if you're looking for
  it) — admin.service.js only *reads* the `organizers` table (joins) for display, it never
  approves/rejects an organizer application.
- **Audit logging is inconsistent — don't assume every admin action is logged.** `writeAuditLog()`
  (`admin.service.js:42`) writes to `audit_logs`, and it **is** called for: user update/delete,
  role assign/remove, talent verify/unverify, event cancel/delete, group delete/update/member-
  removal, comment delete, and every `resolveReportedEntity` branch (`*_VIA_REPORT` actions). It is
  **NOT** called for: `updateReportStatus`, `bulkUpdateReportStatus`, `toggleUserSuspension`,
  `deletePost` (the direct delete path, as opposed to the report-resolution path),
  `createCategory`/`updateCategory`/`deleteCategory`, or `updatePlatformFeePercentage`. If you're
  debugging "why isn't this admin action showing up in `/admin/activity-logs`," check this list
  first before assuming a bug.
- **Two separate audit-log systems exist.** Generic admin actions go to `audit_logs`
  (`src/db/schema/admin.js`), read by `GET /api/admin/activity-logs`. Subscription lifecycle
  actions (grant/revoke/coupon/plan changes) go to a *different* table,
  `subscription_audit_logs` (`subscription.service.js`), only visible per-subscription via
  `GET /admin/subscriptions/:subscriptionId`. They're not merged anywhere.
- **`resolveReportedEntity`'s user-suspend branch bypasses `toggleUserSuspension`.** It sets
  `isSuspended: true` directly with no `suspendedUntil`/duration and no suspension email — a
  report-resolved "suspend" is always indefinite and silent, unlike the dedicated suspension
  endpoint.
- **Three schema tables in `admin.js` are dead code**: `contentReports`, `adminTasks` +
  `taskSubtasks`, and `adminReports`. They have full Drizzle table definitions and (mostly) live
  relations in `relations.js`, but no controller or service anywhere reads/writes them. Don't
  confuse `contentReports` with the actual live report table, `userReports`
  (`src/db/schema/userReports.js`) — they look similar but only one is real.
- **Admin edits use field allow-lists, not raw body spreads** (`updateUserByAdmin`,
  `updateGroupByAdmin`) — extending what an admin can edit means adding to the `allowedFields`
  array in `admin.service.js`, not just adding a field to the Zod schema in `admin.route.js`.
- **Platform fee is a single global percentage**, not per-organizer/per-event — 10% default,
  overridable in `system_settings.platform_fee_percentage`, consumed at payout time by
  `event.service.js`/`organizerEarnings.service.js`. There's a second, related settings key,
  `payout_reserve_rate`, that is admin-editable *in principle* (read via the same `systemSettings`
  table) but has **no admin route to change it** in `admin.route.js` — only the reserve summary/
  list/manual-release actions are exposed (see [07-payments-stripe.md](./07-payments-stripe.md)).
- **Validation is duplicated per-route** — `admin.route.js` defines its own local `validate`/
  `validateQuery` helpers (not the shared `src/middlewares/validate.middleware.js`) and a large
  block of inline Zod schemas at the top of the file. If you add a route, follow that local
  pattern rather than importing the global validation middleware.

## Common Tasks

| Task | How |
|---|---|
| Make a user an admin | `POST /api/admin/users/:userId/roles` with `{ "roleName": "admin" }` |
| Investigate what an admin changed | `GET /api/admin/activity-logs?adminId=...&resourceType=...&dateFrom=...&dateTo=...` — remember this misses report-status changes, suspensions, category/fee edits, and all subscription actions (see Gotchas) |
| Change the platform's cut of ticket sales | `PATCH /api/admin/platform-fee { "percentage": 12 }` |
| Add a new event-team role organizers can assign | `POST /api/admin/team-roles { "name": ..., "permissions": [...] }` |
| Give a user free BriteSide Plus | `POST /api/admin/subscriptions/grant { "userId", "planId", "reason" }` |
| Add a new gated subscription feature | Add a key to `FEATURES`/`FEATURE_REGISTRY` in `src/constants/features.js`, then `POST /admin/subscriptions/plans/:planId/features` to attach it to a plan |
| Force-take-down a post/comment/event/group without going through the report queue | `DELETE /api/admin/posts/:postId`, `/comments/:commentId`, `/events/:eventId`, `/groups/:groupId` |
| Resolve a report and remove the offending content in one step | `POST /api/admin/reports/:reportId/resolve { "action": "delete"|"cancel"|"suspend", "reason" }` |
| Add a new category | `POST /api/admin/categories { "name", "description", "iconUrl", "emoji" }` |

## Related Modules

- [08-dashboards-analytics.md](./08-dashboards-analytics.md) — the platform/admin analytics
  endpoints reachable under `/api/admin/analytics/*` and the per-entity `isAdmin: true` analytics
  passthroughs in `admin.route.js` (events, groups, posts, profiles, ticket sales).
- [07-payments-stripe.md](./07-payments-stripe.md) — admin earnings/wallet/Connect/payout
  dashboards (`adminEarnings.controller.js`), payout reserves (`reserves.controller.js`), and the
  Stripe billing mechanics underneath the subscription plan/coupon admin CRUD documented above.
- [09-moderation.md](./09-moderation.md) — report submission and review-queue mechanics, user
  suspension (self-service side) and appeal review; this doc only covers the admin-only
  *resolution* actions (`resolveReportedEntity`, bulk status updates) layered on top.
- [01-auth-users.md](./01-auth-users.md) — `requireAdmin`/`authMiddleware` definitions, the
  `roles`/`userRoles` model that admin access depends on, and the username-reservation admin
  endpoints passed through this router.
