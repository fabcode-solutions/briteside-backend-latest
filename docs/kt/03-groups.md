# Groups — KT

## Overview

A **group** is a community hub inside BriteSide — closer to a Facebook Group / Locals.org
community than to a chat room. Every group has:

- A profile (name, description, cover image, location, category, tags) and a unique `slug`.
- **Members** with a role (`admin` / `moderator` / `member`) and a status (`joined` / `pending` / `rejected`).
- **Discussions** (threaded posts + replies + likes), similar in shape to the social feed
  (see [04-social.md](./04-social.md)) but scoped to a group and gated by membership/visibility.
- Optional **paid membership** (`isPaid`) — private-only, billed via Stripe subscription tiers
  (BriteSide Plus-style monetization; full detail in [07-payments-stripe.md](./07-payments-stripe.md)).
- Optional **courses** — an organiser can publish free or paid video courses to their group's members.
- **Event promotions** — a group admin can cross-post an event into the group's feed
  (`groupEventPromotions`, shared with [02-events.md](./02-events.md)).
- **Analytics** and a **creator wallet/payout** surface for group monetization
  (see [08-dashboards-analytics.md](./08-dashboards-analytics.md) and [07-payments-stripe.md](./07-payments-stripe.md)).

Groups intentionally reuse a lot of platform-wide machinery: text/media moderation
(`TextModerationService`, `MediaModerationService` — [09-moderation.md](./09-moderation.md)),
notifications (`notification.service.js`), email (`mailService`), Stripe Connect payouts, and the
shop-product linking system also used by posts (`groupShopProducts`, BriteSide Plus-gated).

**Important routing fact (not obvious from `src/routes/index.js`):** almost the entire Groups
surface — group CRUD, membership, discussions, subscriptions, wallet, and courses — is mounted
under a single base path, `/api/groups`, defined by `src/routes/group.route.js`. Discussions,
subscriptions ("group earnings"), and courses are *not* separate top-level resources even though
they have their own controller/service files — see [Key Files](#key-files) and
[API Endpoints](#api-endpoints) below for exactly how each is wired in.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/group.route.js` | The real hub of the module. Mounts group CRUD, membership, tags, event promotions, invitations, discussion endpoints, group-subscription endpoints, and group-wallet endpoints directly. Also nests `groupCourse.route.js` as a sub-router. Mounted at `/groups` in `src/routes/index.js` → `/api/groups`. |
| `src/routes/groupQuestion.route.js` | Membership intake-question CRUD + join-request-answers listing. Mounted **separately** at `/groupQuestions` in `routes/index.js` → `/api/groupQuestions` (not nested under `/api/groups`, despite its own path segments starting with `/:groupId/questions`). |
| `src/routes/groupCourse.route.js` | Course/lesson/enrollment/progress endpoints. Not imported in `routes/index.js` — mounted as a sub-router from `group.route.js` line ~262 via `router.use('/:groupId/courses', groupCourseRouter)`, using `Router({ mergeParams: true })` so `:groupId` from the parent is visible. Real path: `/api/groups/:groupId/courses/...`. |
| `src/controllers/group.controller.js` | Group CRUD, discovery/search, join/leave, join-request approval, member CRUD, tags, event promotions, group invitations, discussion-notification subscribe/unsubscribe. |
| `src/controllers/groupQuestion.controller.js` | Thin wrapper around `GroupQuestionService` (question CRUD, reorder, join-request-answers). |
| `src/controllers/groupCourse.controller.js` | Thin wrapper around `GroupCourseService` (courses, lessons, enrollment, progress, organiser analytics). |
| `src/controllers/discussion.controller.js` | Discussion/reply/like CRUD + reported-discussions moderation endpoints. Imported directly into `group.route.js` — there is **no** `discussion.route.js` file. |
| `src/controllers/groupSubscription.controller.js` | Group subscription tiers + user/creator-admin subscription management. Money — full detail in [07-payments-stripe.md](./07-payments-stripe.md). |
| `src/controllers/groupEarnings.controller.js` | Group creator wallet, cashout requests, payout methods, per-group transaction ledger. Money — full detail in [07-payments-stripe.md](./07-payments-stripe.md). |
| `src/controllers/groupAnalytics.controller.js` | Group/organizer analytics endpoints. Full detail in [08-dashboards-analytics.md](./08-dashboards-analytics.md). |
| `src/services/group.service.js` | **The biggest file in the module (~2000 lines).** Exports `GroupService`, `GroupCategoryService`, `GroupEventPromotionService`, `GroupMemberService`, `GroupTagService`, `GroupDiscussionNotificationService`, `GroupInvitationService`. Core business logic for almost everything except questions/courses/discussions/subscriptions/earnings/analytics (each of which has its own service file). |
| `src/services/groupQuestion.service.js` | `GroupQuestionService` — question CRUD, answer validation/snapshotting, join-request-answers listing (free vs paid group branch). |
| `src/services/groupCourse.service.js` | `GroupCourseService` — course/lesson CRUD, Stripe product/price creation for paid courses, enrollment (free + Stripe Checkout), progress tracking, organiser + platform-admin analytics. |
| `src/services/discussion.service.js` | `DiscussionService` — discussion/reply/like CRUD, subscriptions, reported-discussion helpers. Discussions can belong to a group (`groupId` set) or be a general/public discussion (`groupId` null). |
| `src/services/groupSubscription.service.js` | `GroupSubscriptionService` (~1400 lines). Tiers, Stripe Checkout, webhooks-driven activation, cancel/refund, creator-admin member management. See [07-payments-stripe.md](./07-payments-stripe.md). |
| `src/services/groupAnalytics.service.js` | Group/organizer analytics queries (~1100 lines). See [08-dashboards-analytics.md](./08-dashboards-analytics.md). |
| `src/db/schema/groups.js` | Core tables: `groups`, `groupMembers`, `groupJoinRequests`, `groupCategories`, `discussions`, `discussionLikes`, `discussionReplies`, `discussionReplyLikes`, `discussionSubscriptions`, `discussionCategories`, `groupMedia`, `groupFeaturedContent`, `groupDiscussionNotifications`. |
| `src/db/schema/groupEnhancements.js` | `tags`, `groupTags` (used), plus `groupRules`, `groupMemberRoles`, `groupAnnouncements` (defined, **no controller/service reads or writes them** — dead schema today). |
| `src/db/schema/groupQuestions.js` | `groupQuestions` table. |
| `src/db/schema/groupCourses.js` | `groupCourses`, `groupCourseLessons`, `groupCourseEnrollments`, `groupCourseLessonProgress`. |
| `src/db/schema/subscriptions.js` | `groupSubscriptionTiers`, `groupSubscriptions` (money — [07-payments-stripe.md](./07-payments-stripe.md)). |
| `src/db/schema/stripeConnect.js` (lines ~135–163) | `groupPayouts` — creator cashout requests (money — [07-payments-stripe.md](./07-payments-stripe.md)). |
| `src/db/schema/shop.js` (line ~242) | `groupShopProducts` — Plus-gated link between a group and up to 6 of the organizer's shop products. |
| `src/middlewares/group.access.middleware.js` | `groupAccessMiddleware` — resolves discussion → group → membership, decides `public` / `view-only` / `full` access for discussion read/write routes. |
| `src/utils/group-helpers.js` | `verifyGroupMembership`, `checkGroupMembership`, `checkPendingJoinRequest`, `requireGroupAdmin`, `requireGroupAdminOrModerator`, `requireGroupCreator`, slug generation (`createUniqueSlugForGroup`, `generateUniqueGroupSlug`), `getGroupDiscussionIds`/`getGroupDiscussions` (used by analytics). |
| `src/validations/groupQuestion.validation.js` | Zod schemas: `createQuestionSchema`, `updateQuestionSchema`, `reorderQuestionsSchema`, `joinWithAnswersSchema`, `getJoinRequestAnswersSchema`. |

## Data Model

```
groups ──┬──< groupMembers >── users
         ├──< groupJoinRequests >── users
         ├──< groupQuestions
         ├──< discussions ──┬──< discussionReplies (self-referencing parentReplyId)
         │                  ├──< discussionLikes
         │                  ├──< discussionReplyLikes (via reply)
         │                  ├──< discussionSubscriptions
         │                  └──< discussionCategories >── categories
         ├──< groupCourses ──┬──< groupCourseLessons
         │                   └──< groupCourseEnrollments ──< groupCourseLessonProgress
         ├──< groupSubscriptionTiers ──< groupSubscriptions >── users
         ├──< groupPayouts >── users              (no DB FK — enforced at service layer)
         ├──< groupMedia, groupFeaturedContent, groupDiscussionNotifications
         ├──< groupTags >── tags
         ├──< groupEventPromotions >── events
         └──< groupShopProducts >── shopProducts
```

Key tables (see cited files for full column lists):

| Table | Key columns | Notes |
|---|---|---|
| `groups` | `id`, `name`, `slug` (unique), `isPublic`, `requiresApproval`, `isPaid`, `subscriptionPrice`, `maxMembers`, `memberCount`, `categoryId` → `groupCategories`, `createdBy` → `users`, `linkButton` (jsonb, Plus-only CTA), `groupSearch` (generated `tsvector`, GIN-indexed) | `address` is `NOT NULL` at the DB level — creating a group without a location string fails. Soft-deleted via `deletedAt`. |
| `groupMembers` | `groupId`, `userId`, `role` (`admin`\|`moderator`\|`member`), `status` (`joined`\|`pending`\|`rejected`), `joinedAt` | Unique on `(groupId, userId)`. Note: `status` here is really only used as `joined` in practice — pending/rejected membership states live in `groupJoinRequests` instead (see gotchas). |
| `groupJoinRequests` | `groupId`, `userId`, `status` (`pending`\|`approved`\|`rejected`), `answers` (jsonb array, defaults `[]`), `is_completed`, `respondedAt`, `respondedBy` | Unique on `(groupId, userId)`. Holds the intake-question answer snapshot for **free** groups only (see Core Flows #2). |
| `groupQuestions` | `groupId`, `questionText` (varchar 500), `sortOrder`, `meta` (jsonb, frontend-defined question type/options), `isActive` | Ordered by `sortOrder` then `createdAt`. |
| `discussions` | `id`, `title`, `description`, `mediaUrls` (text array, max 10), `userId`, `groupId` (nullable — null means a general/public discussion, not scoped to any group), `metadata` (jsonb), `sharesCount`, `deletedAt` | `groupId` FK is `onDelete: 'set null'`, not cascade — deleting a group's discussions is done explicitly in `GroupService.deleteAllGroupDiscussions`, not left to the FK. |
| `discussionReplies` | `discussionId`, `userId`, `parentReplyId` (self-FK, cascade) | Flat table with `parentReplyId` — nested threading, not a separate "nested reply" table (an old `nestedDiscussionReplies`/`nestedDiscussionReplyLikes` pair is commented out in `groups.js` as deprecated). |
| `groupCourses` | `groupId`, `createdBy`, `isFree`, `price`, `stripeProductId`/`stripePriceId`, `status` (`draft`\|`published`\|`archived`), `totalLessons`, `totalEnrollments` | Soft-deleted via `deletedAt`. |
| `groupCourseLessons` | `courseId`, `sortOrder`, `duration` (seconds), `isPublished`, `isFreePreview` | |
| `groupCourseEnrollments` | `courseId`, `userId`, `status` (`active`\|`completed`\|`refunded`), `amountPaid`, `stripePaymentIntentId`/`stripeSessionId` | Unique on `(courseId, userId)`. |
| `groupCourseLessonProgress` | `enrollmentId`, `lessonId`, `watchedSeconds`, `completedAt` | Unique on `(enrollmentId, lessonId)`. A lesson is "completed" at ≥90% of `duration` watched (or any watch time if `duration` is 0). |
| `groupSubscriptionTiers` / `groupSubscriptions` | see [07-payments-stripe.md](./07-payments-stripe.md) | `group_subscription_tiers`, `group_subscriptions` in `src/db/schema/subscriptions.js`. |
| `groupPayouts` | see [07-payments-stripe.md](./07-payments-stripe.md) | `group_payouts` in `src/db/schema/stripeConnect.js` lines 135–163. |

## API Endpoints

All paths below are relative to the API root and already include `/api` (confirmed from
`app.use('/api', defaultLimiter, routes)` in `src/app.js` and `router.use('/groups', groupRoute)` /
`router.use('/groupQuestions', groupQuestionRoute)` in `src/routes/index.js`). "Auth" means the
route sits after `router.use(authMiddleware)` in the file — required bearer JWT, 401 if missing.

> Existing docs (`docs/api/group-subscriptions.md`, `docs/api/group-subscription-admin.md`) refer
> to these as `/api/v1/groups/...`. **There is no `/v1` prefix in the actual mount** — verify against
> `src/routes/index.js` before trusting path prefixes in older hand-written docs.

### Groups — core CRUD, discovery, membership (`src/routes/group.route.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups` | Public | List/search/filter groups (pagination, category, location, price range, free/paid). |
| GET | `/api/groups/categories` | Public | List group categories. |
| GET | `/api/groups/getGroupsInfo/:slug` | Public | Get a group by slug (public variant — same underlying query as `/slug/:slug` below). |
| GET | `/api/groups/groupLocations` | Public | Distinct location rows for map/filter UI. |
| GET | `/api/groups/groupMembers/:groupId/members` | Public | List a group's members (no auth required — see gotchas). |
| GET | `/api/groups/slug/:slug` | Auth + `groupAccessMiddleware` | Get a group by slug (authenticated variant). |
| GET | `/api/groups/getPublicDiscussions` | Auth | List general (non-group) discussions. |
| GET | `/api/groups/getGroupDiscussions` | Auth + `groupAccessMiddleware` | List discussions for a group (`groupId` via query). |
| GET | `/api/groups/:groupsId` | Auth | Get a group by id (note the route param is `groupsId`, not `groupId`). |
| POST | `/api/groups` | Auth | Create a group. |
| POST | `/api/groups/category` | Auth | Create a group category — **no admin check** (see gotchas). |
| PUT / DELETE | `/api/groups/categories/:category_id` | Auth | Update/delete a group category — **no admin check**. |
| PUT | `/api/groups/:groupsId` | Auth | Update a group (service-layer enforces group admin). |
| DELETE | `/api/groups/:groupsId` | Auth | Soft-delete a group (service-layer enforces group admin). |
| POST | `/api/groups/:groupsId/publish` | Auth | Publish (make public) a group; blocked if the cover image was moderation-rejected. |
| GET | `/api/groups/:groupsId/analytics` | Auth | **Legacy** lightweight analytics (member count + pending join requests) — distinct from the richer `/analytics/*` routes below. |
| GET | `/api/groups/my/Groups` | Auth | Current user's joined groups (note the capital `G`). |
| POST | `/api/groups/join/:groupId` | Auth | Join a group / submit a join request (see Core Flows #2). |
| GET | `/api/groups/joinRequests/:groupId` | Auth | List pending join requests for a group. |
| DELETE | `/api/groups/leave/:groupId` | Auth | Leave a group (admin cannot leave; cancels an active paid subscription first). |
| PATCH | `/api/groups/updateJoinRequestStatus/:requestId` | Auth | Approve/reject a pending join request. |
| POST | `/api/groups/:groupId/members` | Auth | Add a member directly (admin, or self-join). |
| PUT | `/api/groups/:groupId/members/:userId` | Auth | Update a member's role/status. |
| DELETE | `/api/groups/:groupId/members/:userId` | Auth | Remove a member. |
| POST | `/api/groups/:groupId/invite` | Auth | Invite users to a group (notification + email). |
| GET | `/api/groups/:groupId/reported-discussions` | Auth | List reported discussions in a group — admin/moderator only (checked inline). |
| POST | `/api/groups/:groupId/reported-discussions/:reportId/resolve` | Auth | Resolve a reported discussion (soft-deletes it) — admin/moderator only. |
| POST | `/api/groups/events/:eventId/promote` | Auth | Promote an event into one or more groups. |
| GET | `/api/groups/:groupId/promotions` | Auth + `groupAccessMiddleware` | List event promotions for a group. |
| DELETE | `/api/groups/promotions/:promotionId` | Auth + `groupAccessMiddleware` | Remove an event promotion. |
| POST | `/api/groups/groups-tags/:groupId/tags` | Auth | Add tags to a group. |
| GET | `/api/groups/groups-tags/:groupId/tags` | Auth | List a group's tags. |
| DELETE | `/api/groups/groups-tags/:groupId/tags/:tagId` | Auth | Remove one tag from a group. |
| GET | `/api/groups/groups-tags/by-tags` | Auth | Search groups by tag names. |
| POST / DELETE | `/api/groups/:groupId/discussion-notifications/subscribe` | Auth | Subscribe/unsubscribe to new-discussion notifications for a group. |
| GET | `/api/groups/:groupId/discussion-notifications/status` | Auth | Check subscription status. |

### Group Discussions (also `group.route.js` — flat, **not** nested under `:groupId`)

`groupId` is supplied via `req.body.groupId` (create) or resolved from `discussionId` by
`groupAccessMiddleware` (everything else) — see Core Flows #4.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups/discussion/:discussionId` | Auth | Get a discussion by id. |
| GET | `/api/groups/discussion/:discussionId/replies` | Auth + `groupAccessMiddleware` | List replies. |
| GET | `/api/groups/discussion/:discussionId/likes/count` | Auth + `groupAccessMiddleware` | List/count likes. |
| POST | `/api/groups/discussion` | Auth + `groupAccessMiddleware` | Create a discussion (group-scoped if `groupId` given, else general). |
| PUT / DELETE | `/api/groups/discussion/:discussionId` | Auth + `groupAccessMiddleware` | Update/delete a discussion (owner hard-deletes; group admin/moderator soft-deletes). |
| POST | `/api/groups/discussion/:discussionId/likes` | Auth + `groupAccessMiddleware` | Toggle like. |
| POST | `/api/groups/discussion/:discussionId/replies` | Auth + `groupAccessMiddleware` | Create a reply (top-level or nested via `parentReplyId`). |
| POST / DELETE | `/api/groups/discussion/:discussionId/subscribe` | Auth + `groupAccessMiddleware` | Subscribe/unsubscribe to a single discussion's reply notifications. |
| PUT / DELETE | `/api/groups/discussion/replies/:replyId` | Auth + `groupAccessMiddleware` | Update/delete a reply. |
| POST / GET | `/api/groups/discussion/replies/:replyId/likes` | Auth + `groupAccessMiddleware` | Toggle/list reply likes. |

### Group Membership Questions (`src/routes/groupQuestion.route.js` — mounted at `/api/groupQuestions`, top-level)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groupQuestions/:groupId/questions` | Public | List active intake questions for a group. |
| GET | `/api/groupQuestions/:groupId/join-requests` | Auth (admin/moderator) | List join requests/members with their submitted answers. |
| POST | `/api/groupQuestions/:groupId/questions` | Auth (admin) | Create a question. |
| PUT | `/api/groupQuestions/:groupId/questions/reorder` | Auth (admin) | Reorder questions. |
| PUT | `/api/groupQuestions/:groupId/questions/:questionId` | Auth (admin) | Update a question. |
| DELETE | `/api/groupQuestions/:groupId/questions/:questionId` | Auth (admin) | Delete a question. |

### Group Courses (`src/routes/groupCourse.route.js` — sub-router, real path `/api/groups/:groupId/courses/...`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups/:groupId/courses/my` | Auth | Current user's enrolled courses (any group). |
| GET | `/api/groups/:groupId/courses/analytics` | Auth (group creator) | Organiser course analytics for this group. |
| GET | `/api/groups/:groupId/courses` | Public (optional auth) | List courses (non-members only see `published`). |
| POST | `/api/groups/:groupId/courses` | Auth (group creator) | Create a course. |
| GET | `/api/groups/:groupId/courses/:courseId` | Public (optional auth) | Get a course + lessons — **no membership/status check** (see gotchas). |
| PATCH / DELETE | `/api/groups/:groupId/courses/:courseId` | Auth (group creator) | Update / soft-delete a course. |
| POST | `/api/groups/:groupId/courses/:courseId/publish` \| `/archive` | Auth (group creator) | Change course status. |
| POST | `/api/groups/:groupId/courses/:courseId/lessons` | Auth (group creator) | Add a lesson. |
| PATCH / DELETE | `/api/groups/:groupId/courses/:courseId/lessons/:lessonId` | Auth (group creator) | Update/delete a lesson. |
| PUT | `/api/groups/:groupId/courses/:courseId/lessons/reorder` | Auth (group creator) | Reorder lessons. |
| POST | `/api/groups/:groupId/courses/:courseId/enroll` | Auth (group member) | Enroll in a free course. |
| POST | `/api/groups/:groupId/courses/:courseId/checkout` | Auth (group member) | Stripe Checkout session for a paid course. |
| GET | `/api/groups/:groupId/courses/:courseId/progress` | Auth (enrolled) | Get progress for a course. |
| POST | `/api/groups/:groupId/courses/:courseId/lessons/:lessonId/progress` | Auth (enrolled) | Report watch progress for a lesson. |

`/my` and `/analytics` are registered before `/:courseId` in the route file for the same reason
`group.route.js` registers `/analytics/organizer/overview` before `/:groupId/analytics/*` — otherwise
Express would swallow the literal segment into the `:courseId`/`:groupId` wildcard.

### Group Subscriptions & Wallet (money — full detail in [07-payments-stripe.md](./07-payments-stripe.md))

Also mounted directly in `group.route.js`, all under `/api/groups/:groupId/subscription/*` (tiers,
checkout, cancel/refund, portal, creator-admin member management) and `/api/groups/my/wallet/*`,
`/api/groups/my/payout-methods/*`, `/api/groups/:groupId/wallet/*` (creator wallet, cashout, payout
methods, per-group ledger). Not re-listed here — see the payments doc and
`docs/api/group-subscriptions.md` / `docs/api/group-subscription-admin.md`.

### Group Analytics (full detail in [08-dashboards-analytics.md](./08-dashboards-analytics.md))

Also mounted in `group.route.js` under `/api/groups/:groupId/analytics/*` (overview, revenue,
members, member trends, discussions, engagement, categories, top contributors, growth comparison,
per-user interaction summary) plus `/api/groups/analytics/organizer/overview`. Not re-listed here.

## Core Flows

### 1. Creating a group

`POST /api/groups` → `group.controller.js:createGroups` → `GroupService.createGroup`
(`src/services/group.service.js`):

1. Requires `coverImageUrl`; enforces `MAX_GROUP_MEDIA` (5) and `MAX_FEATURED_CONTENT` (10).
2. `sanitizeLinkButton` and shop-product selection (`shopProductIds`, max 6) are both **BriteSide
   Plus-gated** — rejected with a 403 if the creator isn't Plus and tries to use them.
3. `enforceGroupPrivacyRules` runs *before* insert: `isPaid: true` forces `isPublic: false` and
   `requiresApproval: false` (payment is the gate, not manual approval). A free group is left as
   the creator configured it, unless it already has active questions (only relevant on update,
   since a brand-new group has none yet).
4. `TextModerationService.assertAllowed` checks `name`/`description`; the row is only inserted if
   allowed, then `recordIfFlagged` logs any moderation record.
5. Insert `groups` row with a unique slug (`createUniqueSlugForGroup`); insert the creator as a
   `groupMembers` row with `role: 'admin'`, `status: 'joined'`; increment `memberCount`;
   auto-subscribe the creator to discussion notifications.
6. Optionally create `groupMedia`, `groupFeaturedContent`, `groupShopProducts` rows, and send
   invitation notifications+emails to `inviteeIds`.
7. **If `isPaid && subscriptionPrice`**, dynamically `import('./groupSubscription.service.js')` and
   auto-create a default "Membership" monthly tier. The import is dynamic (not a top-level import)
   specifically to avoid a circular dependency — `groupSubscription.service.js` imports things that
   ultimately import back into `group.service.js`. The same pattern repeats in `updateGroup` when
   `subscriptionPrice`/`isPaid` changes.
8. Returns the full `getGroupById` projection (with media, featured content, shop products, etc.).

### 2. Membership questions / join-approval flow

Design docs: `docs/superpowers/specs/2026-04-16-group-membership-questions-design.md`,
`docs/superpowers/plans/2026-04-16-group-membership-questions.md`,
`docs/superpowers/group-membership-questions-frontend.md` — read those for the original design
rationale; this section documents current behavior in code.

1. A group admin defines questions via `/api/groupQuestions/:groupId/questions` (admin-only
   writes, public read). `meta` is free-form jsonb — the *frontend* defines question type/options.
2. `GroupService.enforceGroupPrivacyRules(groupFields, groupId)` — on **update** only, if the group
   is free and has ≥1 active question, it forces `isPublic: false`, `requiresApproval: true`. So
   adding an intake question to a free group automatically makes it private + approval-gated.
3. `POST /api/groups/join/:groupId` → `GroupService.joinGroup`:
   - **Paid group**: no `groupJoinRequests` row is created. `GroupQuestionService.validateAndSnapshot`
     is called only to validate answers early, and its result is **discarded**
     (`.catch(() => {})`, not persisted) — see gotchas. Returns
     `{ status: 'awaiting_payment', redirectTo: '/groups/:slug/subscription' }`; the client is
     expected to drive Stripe Checkout from there (see [07-payments-stripe.md](./07-payments-stripe.md)).
   - **Free group**: `validateAndSnapshot` throws 400 with the list of unanswered required
     questions if any are missing; otherwise:
     - if `isPublic && !requiresApproval` → member is joined immediately (insert `groupMembers`,
       increment count, auto-subscribe to notifications, welcome email).
     - else → insert a `groupJoinRequests` row (`status: 'pending'`, `answers` snapshot); notify
       every admin/moderator.
4. `PATCH /api/groups/updateJoinRequestStatus/:requestId` (admin) → approve inserts the member
   (`GroupMemberService.addMember`), auto-subscribes them, sends a welcome email, notifies the
   user, then deletes the join-request row either way (approved or rejected).
5. Admin/moderator views answers via `GET /api/groupQuestions/:groupId/join-requests`
   (`GroupQuestionService.getJoinRequestsWithAnswers`) — branches on `group.isPaid`: free groups
   return pending/approved/rejected join requests with answers; **paid groups return the list of
   already-joined members** left-joined against any `groupJoinRequests` row for that user (there
   normally isn't one for paid groups today — see gotchas).

### 3. Group courses

1. Only the group **creator** (`groups.createdBy`, checked via `requireGroupCreator` — *not*
   `requireGroupAdmin`, so a promoted `admin` member who isn't the original creator cannot manage
   courses) creates a course as `draft`. If `!isFree && price > 0`, a Stripe Product + Price are
   created synchronously (`groupCourse.service.js` `getStripe()`).
2. Creator adds/reorders/publishes lessons (`groupCourseLessons`, ordered by `sortOrder`); a lesson
   can be flagged `isFreePreview` to be watchable without enrollment even on a paid course.
3. Creator calls `publishCourse` (`status: 'published'`) — only published courses show up for
   non-members in `listGroupCourses`.
4. Member enrolls: `enrollFree` (requires group membership + published + `isFree`) inserts an
   enrollment directly; a paid course goes through `createEnrollmentCheckout` → Stripe Checkout
   Session (`metadata.type = 'group_course_enrollment'`) → `webhook.controller.js` routes the
   completed session to `GroupCourseService.handleCourseCheckoutCompleted`, which inserts the
   enrollment.
5. Progress: `trackLessonProgress` requires an active enrollment; a lesson is marked complete at
   ≥90% of `duration` watched (or any watch time if `duration` is `0`); once every published lesson
   is complete, the enrollment's `status` flips to `completed`.
6. Two analytics surfaces exist: `getOrganizerCourseAnalytics` (per-group, creator-only, routed at
   `/api/groups/:groupId/courses/analytics`) and `getAdminCourseAnalytics` (platform-wide, called
   from `admin.controller.js` — cross-ref [12-admin.md](./12-admin.md) /
   [08-dashboards-analytics.md](./08-dashboards-analytics.md)).

### 4. Group discussions

Confirmed wired up — not a separate `discussion.route.js`, but imported straight into
`group.route.js` and mounted under `/api/groups/discussion*` (flat, **not**
`/api/groups/:groupId/discussions`).

1. `groupAccessMiddleware` (`src/middlewares/group.access.middleware.js`) resolves access on every
   discussion route except plain `getDiscussionById`/create-list: it looks up `discussionId` (from
   params/body/query) to find the discussion's `groupId` if not given directly, then:
   - no group (general discussion) → `level: 'public'`, full access.
   - private group, not a member → 403 (`allowJoin: true`).
   - public group, not a member → view-only; write attempts (`req.method !== 'GET'`) get 403.
   - member → `level: 'full'`.
2. `createDiscussion` runs `TextModerationService.assertAllowed` on title/content and
   `MediaModerationService.adoptMediaVerdicts` on up to 10 `mediaUrls`, then — if `groupId` is set —
   fans out a notification to everyone subscribed via `groupDiscussionNotifications`
   (`GroupDiscussionNotificationService.notifyNewDiscussion`).
3. Delete has two paths: **owner** → hard delete (cleans up media references, replies, likes,
   mentions); **group admin/moderator** (checked via `groupMembers` role, not creator-only) →
   soft delete (`deletedAt`) + notifies the original author. This is the same mechanism the
   moderator-facing "reported discussions" feature uses to remove content — see
   `docs/superpowers/plans/2026-04-13-reported-discussions-moderator.md` and
   [09-moderation.md](./09-moderation.md).
4. Replies support one level of nesting via `parentReplyId` (flat table, not a tree of tables — an
   older `nestedDiscussionReplies` design is commented out in `groups.js`). Likes, mentions
   (`@user` in reply content), and per-discussion subscriptions each have their own notification
   fan-out in `discussion.service.js`.

## Integrations

- **Stripe** — paid groups (subscription tiers, Checkout, Customer Portal, refunds — see
  [07-payments-stripe.md](./07-payments-stripe.md)) and paid courses (one-off Checkout per course).
  Both go through the shared `webhook.controller.js` Stripe webhook handler, routed by
  `metadata.type`.
- **Stripe Connect** — group creator payouts/cashouts (`groupEarnings.controller.js` →
  `StripeConnectService`) — shared payout infrastructure with organizer/talent payouts.
- **Content moderation** — `TextModerationService` (group name/description, discussion
  title/content/replies) and `MediaModerationService` (group cover image, group media, discussion
  media) gate creation/publish/join. See [09-moderation.md](./09-moderation.md).
- **Notifications & email** — `notification.service.js` (`createNotification`, `type:
  'group_activity'`) for join requests/approvals/removals/role changes/invites/likes/replies/
  mentions/event promotions; `mailService` / `src/templates/index.js` for the corresponding emails
  (`sendGroupInvitationEmail`, `sendPaidGroupSubscriptionEmail`, generic `sendGeneralEmail`).
- **File management** — `FileManagementService` reference-counts uploaded media (`decrementReference`)
  when a group's cover image, media items, featured content, or discussion attachments are
  replaced/deleted, so orphaned S3 files can be garbage-collected.
- **Social** — `groupShopProducts` reuses the creator-shop module ([11-shop-merchandise.md](./11-shop-merchandise.md),
  per the module index in `00-project-overview.md`); discussions share the `mentions`/`stories`
  tables with the social module ([04-social.md](./04-social.md)).
- **Events** — `groupEventPromotions` cross-links a group to an event; `getGroups`/`getGroupById`
  surface the group's next upcoming promoted event.

## Business Rules & Gotchas

- **Paid ⇒ private, always.** `isPaid: true` always forces `isPublic: false` and
  `requiresApproval: false` — you cannot have a public paid group, and a paid group never uses the
  join-request/approval mechanism (payment *is* the approval).
- **Free + active questions ⇒ forced approval-gated.** Adding even one active question to a free
  group flips it to private + `requiresApproval: true` on the next update. There's no way to have
  intake questions on a fully open (no-approval) free group.
- **Paid-group question answers are validated but not persisted anywhere today.**
  `GroupService.joinGroup`'s paid-group branch calls
  `GroupQuestionService.validateAndSnapshot(groupId, answers).catch(() => {})` — the snapshot result
  is thrown away, not written to `groupJoinRequests.answers` or anywhere else. Separately,
  `GroupSubscriptionService.handleCheckoutCompleted` (`groupSubscription.service.js` ~line 691) tries
  to resolve "any pending join request (created when user answered questions before checkout)" by
  updating a `groupJoinRequests` row with `status: 'pending'` — but no code path currently inserts
  such a row for a paid group. In practice this means `GroupQuestionService.getJoinRequestsWithAnswers`'s
  paid-group branch (which left-joins `groupJoinRequests.answers` onto members) will show `answers:
  []` for members who joined through Checkout. If you're asked to fix "paid group answers aren't
  showing up," this is why — the gap is in `joinGroup`/checkout, not in the query.
- **`GET /api/groups/:groupId/courses/:courseId` has no visibility check at all** — no auth
  required, no membership check, no `status` check. Anyone with a `courseId` can fetch a draft or
  archived course's metadata and any `isFreePreview` lesson video from any group, public or private.
  Video URLs for non-preview lessons are still gated by enrollment, so the leak is limited to
  metadata + preview content, but it's a real gap if course details are meant to be private.
- **Category CRUD has no admin check.** `POST /api/groups/category`, and
  `PUT`/`DELETE /api/groups/categories/:category_id` only require `authMiddleware` (any logged-in
  user) — `GroupCategoryService.createGroupCategory`/`updateGroupCategory`/`deleteGroupCategory`
  perform no role check. Any authenticated user can create/edit/delete global group categories.
- **Course management is creator-only, not admin-inclusive.** `requireGroupCreator` (checks
  `groups.createdBy === userId`) gates all course-organiser actions, unlike most other admin
  surfaces in this module which use `requireGroupAdmin`/`requireGroupAdminOrModerator` (any member
  with `role: 'admin'`). A group admin who isn't the original creator cannot manage courses.
- **`groupRules`, `groupMemberRoles`, `groupAnnouncements` are unused.** Defined in
  `src/db/schema/groupEnhancements.js` and referenced in `relations.js`, but no controller or
  service reads or writes them — dead schema, not wired to any endpoint.
- **`verifyGroupMembership` is called with a `'creator'` role in `publishGroup`**, but the
  `group_role` enum only has `admin`/`moderator`/`member` — no row will ever have `role: 'creator'`,
  so that check effectively only passes for `role: 'admin'`. Harmless (admin still works) but the
  `'creator'` value is dead/misleading.
- **Group discussions are not path-nested under `/groups/:groupId`.** They live at
  `/api/groups/discussion*` with `groupId` passed via body/query/derived-from-`discussionId`, not
  `/api/groups/:groupId/discussions`. Don't assume REST nesting — grep `group.route.js` before
  guessing a discussion path.
- **`/api/groupQuestions` is a fully separate top-level mount**, not nested under `/api/groups`
  despite its internal route paths (`/:groupId/questions`) looking like they belong there.
- **Route-ordering hazard, already flagged by inline comments in the code**: literal path segments
  that could collide with a `:groupId`/`:courseId` wildcard (`/analytics/organizer/overview`,
  `/my`, `/analytics`) must be registered *before* the wildcard routes, or Express will swallow them
  into the param. Follow the existing pattern if you add new literal sub-paths.
- **Hand-written docs use a stale `/api/v1/groups` prefix.** `docs/api/group-subscriptions.md` and
  `docs/api/group-subscription-admin.md` reference `/api/v1/groups/...`; the actual mount (verified
  in `src/routes/index.js` / `src/app.js`) is `/api/groups/...` with no version segment. Trust the
  code, not those docs, for the exact prefix.
- **`docs/superpowers/plans/2026-04-24-group-deal-tickets.md` is unrelated to this module** — despite
  the "group" in its name, it's about buying event *tickets* in bulk multiples (`groupDealSize` on
  `event_tickets`), part of [02-events.md](./02-events.md)'s ticketing system, not the Groups feature.
- **Money units**: `groups.subscriptionPrice` / `groupCourses.price` / `groupCourseEnrollments.amountPaid`
  are decimal dollars; `groupPayouts.amountCents` is integer cents. Don't assume a single convention
  across the module — check the specific column.

## Common Tasks

- **Add a new group-scoped field**: add the column to `src/db/schema/groups.js`, run
  `npm run db:generate` + `npm run db:migrate`, thread it through `createGroups`/`updateGroups` in
  `group.controller.js` + the corresponding `GroupService` methods, and add it to the `getGroups`/
  `getMyGroups` select lists in `group.service.js` if it should appear in list views.
- **Add a new membership intake question type**: no backend change needed — `meta` is free-form
  jsonb; add the new `type` value in the frontend's question editor/renderer only. Backend only
  validates that every active question has a non-empty `answer` string.
  (`GroupQuestionService.validateAndSnapshot`).
- **Change who can manage courses**: swap `requireGroupCreator` for `requireGroupAdmin` in
  `groupCourse.service.js` if course management should extend to all group admins, not just the
  original creator — check with product first, this looks intentional (creator-only) rather than an
  oversight, given it's used consistently across every course/lesson mutation in that file.
- **Add a new discussion sub-feature (e.g. pinning)**: add the column to the relevant table in
  `src/db/schema/groups.js`, add a controller/route pair in `group.route.js` under the `discussion*`
  section, and remember `groupAccessMiddleware` needs `discussionId` or `groupId` reachable from
  `req.params`/`req.body`/`req.query` to compute access.
- **Debug "why can't this user join/see this group"**: check, in order — `groups.deletedAt`,
  `MediaModerationService.statusOf(MEDIA_ENTITY.GROUP, groupId)` (a `'rejected'` cover image pauses
  joins/publish), `groups.isPaid`/`isPublic`/`requiresApproval`, active `groupQuestions`, then the
  `groupMembers` / `groupJoinRequests` rows for that user+group.
- **Debug a group-course access issue**: remember `getCourse` has no gate at all (see gotchas above)
  — if something unexpectedly *is* visible, that's why; if something expected to be visible isn't,
  check `listGroupCourses`'s membership + `status` filter instead, since that's where the real gate
  lives.

## Related Modules

- [07-payments-stripe.md](./07-payments-stripe.md) — group subscription tiers/billing
  (`groupSubscription.controller.js`/`service.js`) and group creator wallet/payouts
  (`groupEarnings.controller.js`, `groupPayouts` table) in full detail.
- [08-dashboards-analytics.md](./08-dashboards-analytics.md) — group and organizer analytics
  (`groupAnalytics.controller.js`/`service.js`) in full detail.
- [09-moderation.md](./09-moderation.md) — text/media moderation gating used throughout this module,
  plus the reported-discussions moderator flow (`getReportedGroupDiscussions`/`resolveReportedDiscussion`
  in `discussion.controller.js`).
- [04-social.md](./04-social.md) — the social feed/posts module that discussions parallel in shape
  (and share `mentions`/`stories` tables with).
- [02-events.md](./02-events.md) — events promoted into groups (`groupEventPromotions`); unrelated
  "group deal" ticket-bundle feature on the ticketing side.
