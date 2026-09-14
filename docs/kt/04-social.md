# Social — KT

## Overview

The Social module is the Instagram/Twitter-like layer of BriteSide: posts, 24-hour stories,
comments, follows/blocks, a personalized feed, public profiles with bio links, post
collaborations, interests (for feed personalization), and a fully custom (non-GetStream) DM
system ("social chat"). It also hosts the "wall" (visitors can post on your profile, subject to
approval) and status updates (auto-posted to your wall + feed).

Almost everything here hangs off two identity concepts:

- **`socialProfiles`** — a 1:1 extension of `users` holding bio/website/location/counts/cover
  media/status, created lazily on first access (`ProfileService.getOrCreateSocialProfile`).
- **`userFollows`** / **`userFollowRequests`** — the follow graph. Private accounts route follows
  through a request/accept flow; public accounts follow directly.

Two things are easy to get wrong in this module and are called out explicitly below:

1. **There are two unrelated "search" services** with similar names — see
   [Search](#search-social--user-search-vs-universal-search) and cross-ref
   [13-platform-services.md](./13-platform-services.md).
2. **Social chat/DMs are not GetStream** — they are a hand-rolled Postgres-backed chat
   (`social_conversations` / `social_messages`) pushed over Socket.IO's `/chat` namespace. See
   [Social Chat/DMs](#social-chatdms).

There is also a dead-code branch: `src/controllers/collaboration.controller.js` and
`src/services/social/postCollaboration.service.js` (`CollaborationService`) implement a full
second collaboration system that **no route file ever imports**. The live collaboration
endpoints (wired in `social.route.js`) go through `social.controller.js` →
`services/social/post.service.js` (`PostService`), which has its own independent, slightly
different implementation of the same feature (see [Business Rules & Gotchas](#business-rules--gotchas)).

## Key Files

### Routes & controllers

| Path | Purpose |
|---|---|
| `src/routes/social.route.js` | All `/api/social/*` routes — profile, wall, follow, posts, comments, stories, story polls, blocks, feed, interests, legacy event invitations, suggested users, follow requests, bio links, story collections. One public exception (bio-link click tracking); everything else behind `authMiddleware`. |
| `src/routes/socialChat.route.js` | All `/api/socialChat/*` routes — conversations + messages for the custom DM system. Fully behind `authMiddleware`. |
| `src/routes/search.route.js` | `/api/search` — the **universal** (public) search endpoint. Own rate limiter (60/min prod). Not part of this module's controllers, documented fully in [13-platform-services.md](./13-platform-services.md); mentioned here only to disambiguate from social/mention search. |
| `src/controllers/social.controller.js` | The one big controller behind almost every `/api/social/*` route: profile, wall, follow, posts, comments, stories, story polls, blocks, feed, interests, legacy event invitations, suggested users, follow-request response, and (despite similarly-named functions living in `collaboration.controller.js` too) the collaboration endpoints actually used by routes. |
| `src/controllers/storyCollection.controller.js` | `/api/social/collections/*` — "highlights"-style saved collections of stories/posts. |
| `src/controllers/bioLink.controller.js` | `/api/social/bio-links/*` — Linktree-style link list on a profile. |
| `src/controllers/collaboration.controller.js` | **Dead code.** Defines `inviteCollaborators`, `respondToCollabInvite`, `removeCollaborator`, `getPostCollaborators`, `getPendingCollabInvites`, `getUserCollaborations` — not imported by any route file. |
| `src/controllers/socialChat.controller.js` | `/api/socialChat/*` — conversations, messages, share-post/discussion-to-DM, missed-call notification, mark-seen. |
| `src/controllers/search.controller.js` | `universalSearch` — thin wrapper around the **top-level** `src/services/search.service.js`. This is the controller behind `/api/search`, not anything in `services/social/`. |

### Services (top-level)

| Path | Purpose |
|---|---|
| `src/services/social.service.js` | Backward-compat facade: re-exports every `services/social/*` class and additionally exposes a `SocialService` class whose static methods mostly just delegate 1:1 to the specific service (e.g. `SocialService.createPost` → `PostService.createPost`). Also directly implements `respondToFollowRequest` / `getFollowRequests` (not delegated). New code should prefer importing the specific service. |
| `src/services/socialChat.service.js` | `SocialChatService` — all DM logic: conversations, messages, seen-state, sharing a post/story/group/discussion into a DM. Fully Postgres, no GetStream. |
| `src/services/search.service.js` | `SearchService.universalSearch` — the **platform-wide** search (users + events + groups + talent profiles) behind public `/api/search`. Fully documented in [13-platform-services.md](./13-platform-services.md). **Not** the same class as `services/social/search.service.js` below, despite the identical export name `SearchService`. |

### Services (`src/services/social/`)

| Path | Purpose |
|---|---|
| `index.js` | Barrel — re-exports `ProfileService`, `FollowService`, `PinnedProfileService`, `PostService`, `CommentService`, `StoryService`, `StoryPollService` (+ `computePollAnalytics`), `BlockService`, `FeedService`, `SearchService`, `InterestService`, `EventInvitationService`. |
| `profile.service.js` | `ProfileService` — get-or-create profile (with live follower/following/post-count reconciliation), update profile, cover-media → auto cover-post sync, status → auto wall-post sync, wall post CRUD/moderation, organizer linkage. |
| `follow.service.js` | `FollowService` — toggle follow/unfollow/request, followers/following lists (private-account gating), `isFollowing`. |
| `block.service.js` | `BlockService` — block/unblock, blocked list, `isBlocked`/`isBlockedBy`. Blocking also deletes any existing follow relationship in both directions. |
| `pinnedProfile.service.js` | `PinnedProfileService` — bookmark another user's profile for quick access (distinct from "pinned posts" on your own profile). |
| `post.service.js` | `PostService` — the largest service: create/update/delete posts, scheduling, linked shop products, pin/reorder, like/save/hide/repost/share, saved/liked/hidden/reposted/shared/commented-posts lists, and (the *live*) collaboration invite/respond/remove/pending-invites logic. |
| `comment.service.js` | `CommentService` — add/update/delete comments (1-level threaded replies), mentions, like/unlike, notifies post owner + accepted collaborators. |
| `story.service.js` | `StoryService` — create story (24h TTL), feed-style grouped story fetch, view/like/comment/share, story-poll decoration, `hasActiveStory` (used all over the feed/comments/search code to light up the "has story" ring), `getStoryViewers`. |
| `storyPoll.service.js` | `StoryPollService` + `computePollAnalytics` — poll/quiz/slider/question stickers attached to a story; one response per user per poll (DB unique constraint), analytics only visible to the story creator. |
| `storyCollection.service.js` | `StoryCollectionService` — named collections ("highlights") a user curates from their own stories/posts. |
| `bioLink.service.js` | `BioLinkService` — Linktree-style links; free plan capped at 5, unlimited for BriteSide Plus; URL protocol allow-list (`http`/`https` only); click tracking. |
| `interest.service.js` | `InterestService` — interest categories (global + user-created), fuzzy search (`pg_trgm`), per-user intensity (0–100), max 10 interests/user; feeds `getPersonalizedFeed`'s scoring and `post_tags`. |
| `suggestedUsers.service.js` | `SuggestedUsersService` — "who to follow" ranking (mutual follows, shared interests, interaction overlap). Not the same thing as `feed.service.js`'s post ranking. |
| `postCollaboration.service.js` | `CollaborationService` — **dead code**, see Overview. Duplicate implementation of collaboration invite/respond/remove; only consumed by the also-dead `collaboration.controller.js`. |
| `eventInvitation.service.js` | `EventInvitationService` — the **social/follow-graph** side of event invitations: inviting individual users to an event (legacy `/api/social/events/:eventId/invite`) and bulk-inviting *all of your followers* to an event (`inviteAllFollowers`, rate-limited to 3 lifetime / 1 per day). The event-owning/RSVP side of invitations is documented in [02-events.md](./02-events.md) — this file only covers the follower-graph angle. |
| `socialAnalytics.service.js` | `SocialAnalyticsService` — post-view and profile-view recording + per-post/per-profile analytics queries. Summarized only here; full analytics/dashboard treatment is in [08-dashboards-analytics.md](./08-dashboards-analytics.md). |
| `search.service.js` | `SearchService.searchUsers` — the **social/mention** search (search users to follow or @-mention; respects blocks and `allowTagging`). Powers `GET /api/social/search`. Distinct from the top-level universal search above. |
| `feed.service.js` | `FeedService` — `getFeed` (strict following-only, reverse-chron), `getExploreFeed` (public, trending/recent/popular + story interleaving), `getPersonalizedFeed` (following + interests, scored — see Gotchas: the score is computed but not actually used to sort). |

### DB schema

| Path | Key tables |
|---|---|
| `src/db/schema/social.js` | `userFollows`, `socialProfiles`, `socialWallPosts`, **`posts`** (the actual posts table lives here, *not* in `posts.js` — see Gotchas), `postCollaborators`, `postLikes`, `postComments`, `postUserComments`, `commentLikes`, `stories`, `storyViews`, `storyLikes`, `storyComments`, `storyShares`, `storyCommentLikes`, `storyPolls`, `storyPollResponses`, `postViews`, `profileViews`, `profileViewSessions`, `postShares`, `postReposts`, `savedPosts`, `userHiddenPosts`, `userBlocks`, `interestCategories`, `userInterests`, `postTags`, `mentions`, `pinnedPosts`, `pinnedProfiles`, `userFollowRequests`, `userPostOrder`, `userPostOrderCounter`. |
| `src/db/schema/posts.js` | **Misleading filename** — only defines `groupEventPromotions` (a Groups feature; see [03-groups.md](./03-groups.md)). Nothing about the `posts` table lives here. |
| `src/db/schema/bioLinks.js` | `bioLinks`. |
| `src/db/schema/storyCollections.js` | `storyCollections`, `storyCollectionItems` (polymorphic: `storyId` OR `postId`). |
| `src/db/schema/socialChat.js` | `socialConversations`, `socialMessages` — the custom DM tables (see [Social Chat/DMs](#social-chatdms)). |

### Cron

| Path | Purpose |
|---|---|
| `src/cron/publishScheduledPosts.js` | Runs every minute (`* * * * *`, registered in `cronJobs.js`). Publishes due scheduled posts (`status='scheduled'` + `scheduledAt <= now`), bumps `createdAt` so it appears fresh in the feed, increments the author's `postsCount`, and prepends it to `userPostOrder`. |
| `src/cron/statusPostCleanup.js` | Runs hourly at :30. Soft-deletes expired `isStatusPost` posts (auto-posts created from a profile "status" update) and clears `socialProfiles.statusPostId`. |

Note: there is **no cron job that hard-deletes expired stories or comments** — expired stories
simply stop matching the `expiresAt >= now` filter used everywhere they're queried, and remain in
the table until the user deletes them or (unimplemented) a retention job is added.

## Data Model

```
users ──1:1── socialProfiles ──N:1── organizers (optional link)
socialProfiles ──1:N── socialWallPosts ──N:1── users (author)
                                       └─0:1── posts (feedPost mirror)

users ──N:M── users   via userFollows (followerId → followingId)
users ──N:M── users   via userFollowRequests (pending follow requests, private accounts)
users ──N:M── users   via userBlocks (blockerId → blockedId)
users ──N:M── users   via pinnedProfiles (userId → pinnedUserId)

posts ──N:1── users (author)
posts ──0:1── socialWallPosts (wallPostId, if created via wall/status)
posts ──1:N── postLikes, postComments, postShares, postReposts, postViews,
              postUserComments, postTags, userHiddenPosts, pinnedPosts,
              postCollaborators, savedPosts
postComments ──0:1── postComments (parentId — 1-level threaded replies only)
postComments ──1:N── commentLikes

postCollaborators (postId, collaboratorId, invitedById, status: pending|accepted|rejected|removed)
  — join table making a post multi-authored; max 5 total collaborators (see Gotchas for the
    inconsistent cap in the dead-code implementation)

stories ──N:1── users (author)
stories ──1:N── storyViews, storyLikes, storyComments, storyShares, storyPolls
storyComments ──0:1── storyComments (parentId, 1-level threading)
storyPolls ──1:N── storyPollResponses (unique per pollId+userId)

storyCollections ──N:1── users
storyCollections ──1:N── storyCollectionItems ──0:1── stories, ──0:1── posts (polymorphic)

bioLinks ──N:1── users

interestCategories ──1:N── userInterests ──N:1── users
interestCategories ──1:N── postTags ──N:1── posts

socialConversations (userAId, userBId, conversationType: social|organizer, unique per pair+type)
  ──1:N── socialMessages (senderId, messageType, content, metadata jsonb, replyToId self-FK,
                           isSeen, isPriority)
```

Key columns worth knowing:

| Table | Column | Notes |
|---|---|---|
| `posts` | `status` | `'published'` \| `'scheduled'` — scheduled posts are invisible to feed/profile queries until the cron flips this. |
| `posts` | `source` | `'manual'` \| `'import'` — feed queries explicitly exclude `source='import'`. |
| `posts` | `isStatusPost` / `isCoverPost` | Auto-generated posts backing a profile's "status" text or cover media; excluded from Explore/Personalized feeds. |
| `posts` | `wallPostId` | Set when the post originated from a wall post (or status update, which is also a wall post). |
| `posts` | `settings` (json) | `{ commentsDisabled, hideLikes, linkButton }` — `linkButton` is a BriteSide Plus–gated CTA, mutually exclusive with linked shop products. |
| `socialProfiles` | `coverMedia` (json) | The actual cover-image field. **Not** `coverImages` — see Gotchas, several feed queries request a nonexistent `coverImages` column. |
| `socialProfiles` | `statusPostId` / `coverPostId` | Point at the auto-created `posts` row backing the current status/cover; nulled out when it expires or is cleared. |
| `stories` | `expiresAt` | Always `createdAt + 24h`, set at creation — not configurable. |
| `socialMessages` | `messageType` | `text\|image\|video\|file\|location\|post\|story\|group\|discussion\|inquiry` — `inquiry` and priority messages get moderated; plain 1:1 text does not (see Gotchas). |

## API Endpoints

All paths below are prefixed with `/api` (mounted in `src/routes/index.js`). Auth column: **Y** =
`authMiddleware` required, **N** = public.

### Profile & wall

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/social/profile/check-username` | Y | Username availability check. |
| GET | `/social/profile/:username/analytics` | Y | Post/profile view analytics (owner-gated inside service). |
| GET | `/social/profile/:username` | Y | Full profile: follow/block/pin state, interests, bio links, shop product count, cover moderation status. |
| PUT | `/social/profile` | Y | Update own profile (bio, cover, privacy toggles, username, DOB, messaging/tagging prefs, Plus-gated cover button). |
| GET | `/social/organizers` | Y | Organizers linked to the caller's account. |
| POST | `/social/profile/link-organizer` | Y | Link an organizer profile to the social profile. |
| POST | `/social/profile/:username/wall` | Y | Post on someone's wall (pending moderation unless self). |
| GET | `/social/profile/:username/wall` | Y | List wall posts + active status post. |
| GET | `/social/profile/:username/wall/pending-count` | Y | Count of pending wall posts (owner only). |
| PUT | `/social/wall/:postId/status` | Y | Approve/reject a wall post (profile owner). |
| DELETE | `/social/wall/:postId` | Y | Author deletes their own still-pending wall post. |

### Follow / block / pinned profiles

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/social/follow/:userId` | Y | Toggle follow/unfollow/cancel-request. |
| GET | `/social/followers/:userId` | Y | Followers list (paginated; private-account gated). |
| GET | `/social/following/:userId` | Y | Following list. |
| GET | `/social/follow-requests` | Y | Pending follow requests targeting the caller. |
| PUT | `/social/follow-requests/:requestId/respond` | Y | Accept/reject a follow request. |
| GET | `/social/suggested-users` | Y | "Who to follow" suggestions. |
| POST | `/social/block/:userId` | Y | Block a user (also removes any mutual follow). |
| DELETE | `/social/block/:userId` | Y | Unblock. |
| GET | `/social/block/status/:userId` | Y | `{ blockedByMe, blockedByThem }`. |
| GET | `/social/blocked-users` | Y | Caller's block list. |
| GET | `/social/pinned-profiles` | Y | Caller's pinned profiles (searchable). |
| POST | `/social/pinned-profiles/:username` | Y | Toggle pin. |
| GET | `/social/search` | Y | **Social/mention search** — see [Search](#search-social--user-search-vs-universal-search). |

### Posts & collaborations

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/social/posts` | Y | Create post (or schedule if `scheduledAt` given). |
| GET | `/social/posts` | Y | List a user's posts (self or by `userId`/`username`). |
| GET | `/social/posts/scheduled` | Y | Caller's own scheduled (unpublished) posts. |
| GET | `/social/collaborations/pending` | Y | Caller's pending collaboration invites. |
| GET | `/social/posts/:postId/collaborators/pending` | Y | Pending invites for a specific post (owner only). |
| POST | `/social/collaborations/:collaborationId/respond` | Y | Accept/reject a collaboration invite. |
| DELETE | `/social/posts/:postId/collaborators/:collaboratorId` | Y | Remove a collaborator (owner or self). |
| POST | `/social/posts/:postId/collaborators/invite` | Y | Invite collaborators to an existing post. |
| PUT | `/social/posts/pins/reorder` | Y | Reorder pinned posts. |
| PUT | `/social/posts/reorder` | Y | Reorder all posts (per-viewer `userPostOrder`). |
| GET | `/social/posts/:postId` | Y | Get a single post. |
| POST | `/social/posts/:postId/view` | Y | Record a view. |
| GET | `/social/posts/:postId/analytics` | Y | Post analytics (owner). |
| PUT | `/social/posts/:postId` | Y | Update post. |
| DELETE | `/social/posts/:postId` | Y | Delete post. |
| POST \| DELETE | `/social/posts/:postId/pin` | Y | Pin/unpin (max 9, DB check constraint). |
| POST | `/social/posts/:postId/like` | Y | Toggle like. |
| POST | `/social/posts/:postId/repost` | Y | Toggle repost. |
| GET | `/social/reposted-posts` | Y | Caller's reposts. |
| POST | `/social/posts/:postId/share` | Y | Share (internal share record, distinct from social-chat sharing). |
| GET | `/social/shared-posts` | Y | Caller's shares. |
| POST | `/social/posts/:postId/save` | Y | Toggle save. |
| POST | `/social/posts/:postId/hide` | Y | Toggle hide from own feed. |
| GET | `/social/saved-posts` \| `/hidden-posts` \| `/liked-posts` \| `/commented-posts` | Y | Respective per-user lists. |

### Comments

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/social/posts/:postId/comments` | Y | Add comment/reply. |
| GET | `/social/posts/:postId/comments` | Y | List top-level comments (first 3 replies inline). |
| GET | `/social/comments/:commentId/replies` | Y | Paginated replies for one comment. |
| PUT | `/social/comments/:commentId` | Y | Edit own comment. |
| DELETE | `/social/comments/:commentId` | Y | Delete own comment. |
| POST | `/social/comments/:commentId/like` | Y | Toggle like. |

### Stories & story polls

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/social/stories` | Y | Create a story (24h TTL). |
| GET | `/social/stories` | Y | Feed-style grouped stories (following + public). |
| GET | `/social/my-stories` | Y | Caller's own stories, incl. expired-but-not-deleted. |
| POST | `/social/stories/:storyId/view` | Y | Record view. |
| DELETE | `/social/stories/:storyId` | Y | Delete own story. |
| POST | `/social/stories/:storyId/like` \| GET `.../likes` | Y | Toggle like / list likers. |
| POST | `/social/stories/:storyId/comments` \| GET `.../comments` | Y | Add / list story comments. |
| PUT \| DELETE | `/social/stories/:storyId/comments/:commentId` | Y | Edit / delete own story comment. |
| POST | `/social/stories/comments/:commentId/like` | Y | Toggle like on a story comment. |
| POST | `/social/stories/:storyId/share` | Y | Internal share record. |
| GET | `/social/stories/:storyId/viewers` | Y | Owner-only: viewers + poll responses merged. |
| POST | `/social/stories/:storyId/polls` | Y | Attach a poll/quiz/slider/question sticker. |
| POST | `/social/stories/:storyId/polls/:pollId/respond` | Y | Respond (once) to a poll. |
| DELETE | `/social/stories/:storyId/polls/:pollId` | Y | Delete poll (creator only). |

### Feed & interests

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/social/feed` | Y | Strict following-only, reverse-chronological. |
| GET | `/social/explore` | Y | Public posts, trending/recent/popular, interleaved with trending stories. |
| GET | `/social/personalized-feed` | Y | Following + interest-scored (see Core Flows #4 and Gotchas). |
| GET | `/social/interests/categories` | Y | Browsable interest categories. |
| GET | `/social/interests/search` | Y | Fuzzy category search. |
| GET \| PUT \| POST | `/social/interests` | Y | Get / bulk-replace / add one interest. |
| DELETE | `/social/interests/:categoryId` | Y | Remove an interest. |

### Bio links & story collections

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/bio-links/:linkId/click` | **N** | Public click-through tracker (mounted directly on `social.route.js`, before the router-wide `authMiddleware`). |
| POST \| GET | `/social/bio-links` | Y | Create / list own bio links. |
| GET | `/social/users/:userId/bio-links` | Y | Another user's bio links. |
| PUT \| DELETE | `/social/bio-links/:linkId` | Y | Edit / delete own link. |
| POST \| GET | `/social/collections` | Y | Create / list own story collections. |
| GET | `/social/collections/:collectionId/items` | Y | Collection contents. |
| PUT \| DELETE | `/social/collections/:collectionId` | Y | Edit / delete collection. |
| POST \| DELETE | `/social/collections/:collectionId/items[/:itemId]` | Y | Add / remove an item. |
| GET | `/social/users/:userId/collections` | Y | Another user's collections. |

### Legacy event invitations (social/follow-graph side)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/social/events/:eventId/invite` | Y | Invite specific users to an event. See [02-events.md](./02-events.md) for the event-owning side and RSVP flow. |
| GET | `/social/invitations` | Y | Caller's received invitations. |
| PUT | `/social/invitations/:invitationId/respond` | Y | Accept/decline. |

### Social chat (`/api/socialChat/*`, all Y)

| Method | Path | Purpose |
|---|---|---|
| GET \| POST | `/socialChat/conversations` | List conversations / get-or-create a 1:1 conversation. |
| GET \| DELETE | `/socialChat/conversations/:conversationId` | Get / delete a conversation. |
| GET \| POST | `/socialChat/conversations/:conversationId/messages` | List / send messages. |
| PATCH | `/socialChat/conversations/messages/:messageId` | Edit own message. |
| POST | `/socialChat/messages/:messageId/seen` | Mark one message seen. |
| POST | `/socialChat/conversations/:conversationId/seen` | Mark all (optionally scoped to priority/inquiry) seen in a conversation. |
| DELETE | `/socialChat/messages/:messageId` | Delete own message. |
| POST | `/socialChat/share-post` \| `/share-discussion` | Share a post/story/group or a group discussion into 1+ DMs. |
| POST | `/socialChat/calls/missed` | Record a missed-call notification (video call tied to a conversation). |

### Universal search (not part of this module, listed for disambiguation)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/search` | N (optional) | Cross-entity search (users/events/groups/talent). See [13-platform-services.md](./13-platform-services.md). |

## Core Flows

### 1. Creating / publishing a post

1. `POST /api/social/posts` → `social.controller.createPost` → `PostService.createPost`.
2. Validation: caption may not contain a bare link (`LINK_REGEX`); a `mediaType === 'youtube'` entry
   must be a real YouTube URL; `visibility` defaults to `public` if invalid; `settings.linkButton`
   is sanitized and rejected (403) for non-Plus users.
3. If `linkedProductIds` is set: requires Plus, rejects if a `linkButton` is also set (mutually
   exclusive), caps at 3 products, and every product must belong to the caller and not be
   soft-deleted (`shop.controller`/`shopProducts` — see [11-shop-merchandise.md](./11-shop-merchandise.md)).
4. `scheduledAt` in the future ⇒ `status: 'scheduled'`, row inserted but **excluded from all feed
   queries** and does not increment `socialProfiles.postsCount` yet.
5. Caption goes through `TextModerationService.assertAllowed` (throws/masks per rules — see
   [09-moderation.md](./09-moderation.md)); media URLs go through
   `MediaModerationService.adoptMediaVerdicts` (adopts prior verdicts if the same file was
   already moderated elsewhere, e.g. re-used upload).
6. Tags (`interestCategories`) are attached via `postTags`; mentions create `mentions` rows +
   notifications (skipped for users with `allowTagging === false`).
7. If `collaboratorIds` provided (cap 5, blocked users silently filtered out): inserts `pending`
   `postCollaborators` rows and notifies each invitee. The post does **not** count toward a
   collaborator's `postsCount` until they accept (`respondToCollaboration`).
8. If `collectionId` provided in the request body, the new post is silently added to that story
   collection (`StoryCollectionService.addItemSilent` — swallows errors, never blocks creation).
9. `publishScheduledPosts` cron (every minute) later flips `status → 'published'`, bumps
   `createdAt` to "now" (so it doesn't appear stale), increments `postsCount`, and prepends the
   post to `userPostOrder` so it also appears first in manual-order views.

### 2. Story lifecycle (including expiry)

1. `POST /api/social/stories` → `StoryService.createStory`. `expiresAt` is hardcoded to
   `now + 24h` — there is no way to set a custom duration.
2. Media is moderated (`MediaModerationService.adoptMediaVerdicts`); caption through
   `TextModerationService`.
3. While active, the story appears in `GET /social/stories` (grouped by author: followed users +
   the viewer's own stories first, then public strangers' stories) and lights up
   `hasActiveStory`/`hasStory` flags used across posts, comments, and search results.
4. Any read/write against a specific story (`viewStory`, `toggleLikeStory`, `addStoryComment`,
   `shareStory`) checks `expiresAt < now`; if expired **and** the caller isn't the author **and**
   the story isn't saved into one of the author's own `storyCollections` (a "favourited"/highlight
   story), the call throws `410 Story has expired`.
5. **Expiry is enforced entirely by query filters and the 410 check above — there is no cron that
   deletes or archives expired stories.** They remain in the `stories` table indefinitely (or
   until the author calls `DELETE /social/stories/:storyId`, which also decrements the referenced
   S3 file's reference count via `FileManagementService`).
6. Story polls (`storyPolls`/`storyPollResponses`) are one-per-user-per-poll (DB unique
   constraint enforces this — a duplicate `respond` call gets `409`), and analytics
   (`computePollAnalytics`) are only returned to the story's creator.

### 3. Follow / block flow

1. `POST /api/social/follow/:userId` → `FollowService.toggleFollowUser`:
   - Already following → delete the follow, decrement both counters.
   - Pending request already sent → cancel it, delete the `follow_request` notification.
   - Target's `socialProfiles.isPublic === false` → insert a `pending` `userFollowRequests` row +
     notify target (`follow_request`). No follow row is created yet.
   - Otherwise → insert `userFollows` directly, increment both counters, notify target (`follow`).
2. `PUT /api/social/follow-requests/:requestId/respond` (accept/reject) — accept inserts the
   `userFollows` row + increments counters + notifies the requester, then deletes the request row
   either way.
3. Turning a **private profile public** (`PUT /api/social/profile` with `isPublic: true`)
   auto-accepts every pending request targeting that user in one pass
   (`ProfileService.updateSocialProfile`).
4. `POST /api/social/block/:userId` → `BlockService.blockUser` — inserts `userBlocks` **and**
   deletes any existing follow relationship in either direction. Almost every read path in this
   module (feed, posts, comments, stories, search, suggested users, collaboration invites) filters
   out blocked users/authors.

### 4. Feed generation & ranking (high-level)

There are three feed endpoints, all in `FeedService`, all filtering out: archived/deleted/
non-published posts, imported posts (`source='import'`), expired posts, blocked-user posts,
hidden posts, and posts failing the moderation gate (`postsModerationGate`) — then applying
visibility rules (`public`/`followers`/collaborator-of-a-followed-user).

- **`getFeed`** — following-only, strict reverse-chronological, cursor-paginated.
- **`getExploreFeed`** — public posts from anyone, sortable `recent`/`popular`/`trending`
  (trending = a time-decayed engagement formula computed in SQL), with stories interleaved every
  3rd item.
- **`getPersonalizedFeed`** — pulls a pool of up to 500 candidate posts, computes a
  `priorityTier` + `finalScore` per post from follow-affinity and interest-tag overlap
  (`user_interests` intensity × `post_tags` confidence) plus an engagement/age ratio... but then
  **sorts the pool by `createdAt` descending instead of by that score** (the scoring sort is
  present in the code but commented out). In practice this endpoint currently behaves like a
  filtered reverse-chronological feed, not a ranked one.

A full OLAP-based ranking redesign (Tinybird signals + revived scoring) is planned but not yet
built — see `docs/superpowers/specs/2026-07-01-feed-ranking-olap-moderation-design.md`, which
explicitly calls out this same dead-code sort as the thing its P1/P3 phases will revive. Also
cross-ref [08-dashboards-analytics.md](./08-dashboards-analytics.md) (the Tinybird/OLAP signals
side) and [09-moderation.md](./09-moderation.md) (the moderation gate every feed query applies).

### 5. Social chat / DM flow

**This is not GetStream.** It is a small custom Postgres schema
(`social_conversations` + `social_messages`, `src/db/schema/socialChat.js`) fronted by
`SocialChatService`, with delivery pushed over **Socket.IO's `/chat` namespace**
(`src/socket/emitter.js`'s `emitSocialChat`, `io.of('/chat')`) — not the GetStream chat SDK
described in [10-getstream-realtime.md](./10-getstream-realtime.md) (which covers video calls,
livestreams, and GetStream's own chat feature used elsewhere in the app).

1. `POST /api/socialChat/conversations` → `getOrCreateConversation` — user IDs are canonicalized
   (`orderUserPair`, lower UUID always `userAId`) so `(userAId, userBId, conversationType)` has a
   stable unique constraint and repeated calls return the same row. `conversationType` is
   `'social'` (default) or `'organizer'` (sets `organizerUserId` for org-branded DMs).
2. `POST /api/socialChat/conversations/:id/messages` → `sendMessage`. Moderation is selective:
   **plain 1:1 `text` messages are never moderated**; only `messageType === 'inquiry'` or
   `isPriority === true` messages go through `TextModerationService.assertAllowed` (talent/paid
   messaging — see [07-payments-stripe.md](./07-payments-stripe.md) for `PriorityMessageService`,
   which the controller also calls post-send to release escrowed priority payments on reply).
   `skipModeration` is accepted by the service but is **not** exposed on the controller's request
   body allow-list, specifically so a client can't grant itself a moderation bypass.
3. After insert, the controller fetches/derives the conversation and emits
   `social:message:new` to the sender's own room and (separately, re-masked per that recipient's
   own profanity-filter preference) to the recipient's own room — plus an in-app notification if
   the recipient isn't actively viewing that conversation's Socket.IO room.
4. Read receipts: `POST /socialChat/messages/:id/seen` (single) or
   `POST /socialChat/conversations/:id/seen` (bulk, optionally scoped to `isPriority`/`inquiryOnly`
   so the General and Priority tabs each mark only their own subset seen) — both broadcast
   `social:message:seen` back to the sender.
5. Sharing: `sharePostToUsers`/`shareDiscussionToUsers` resolve a post, an **unexpired** story, or
   a group by ID (falling through in that order), fan out a DM to each recipient via the same
   `sendMessage` path, and bump the source content's share counter.

## Integrations

| Integration | Where used | Notes |
|---|---|---|
| Text moderation (`TextModerationService`) | Post/comment/story/wall/profile/message text, story-poll questions | Selective by content type — see per-flow notes above. Full detail: [09-moderation.md](./09-moderation.md). |
| Media moderation (`MediaModerationService`) | Post/story/cover media uploads and gating feed/story visibility | `postsModerationGate`/`storiesModerationGate` filter query results; `adoptMediaVerdicts` reuses a prior verdict for a re-uploaded/shared file. |
| S3 / File management (`FileManagementService`) | Story deletion decrements the referenced file's ref-count | Full upload flow in [13-platform-services.md](./13-platform-services.md). |
| BriteSide Plus (`req.user.isBritesidePlus`) | Post link-button, linked shop products, unlimited bio links, profile cover button | Gated inline in controllers/services (403 `ApiError`), not via a shared middleware. |
| Notifications (`notification.service.js`) | Follows, follow requests, mentions, comments, likes, wall posts, collaboration invites/responses, DM messages/shares | Fire-and-forget (`try/catch` + `console.warn`), never blocks the primary action. |
| Socket.IO `/chat` namespace | Social chat delivery, seen receipts, online/offline presence broadcast on `showOnlineStatus` toggle | See [10-getstream-realtime.md](./10-getstream-realtime.md) for the separate GetStream integration used for calls/livestreams. |
| Shop (`shopProducts`, [11-shop-merchandise.md](./11-shop-merchandise.md)) | Posts can link up to 3 of the author's own live shop products | Enforced in `PostService._resolveLinkedProducts`. |
| Priority messaging / Stripe (`PriorityMessageService`, [07-payments-stripe.md](./07-payments-stripe.md)) | `socialChat.controller.sendMessage` releases escrowed payment on reply | Only relevant to `isPriority` DMs. |
| Analytics (`SocialAnalyticsService`) | Post/profile view tracking + owner-facing analytics | Full dashboard treatment: [08-dashboards-analytics.md](./08-dashboards-analytics.md). |
| pg_trgm (Postgres extension) | `InterestService.searchInterests` fuzzy matching | `similarity()` SQL function. |

## Business Rules & Gotchas

- **Two dead-but-present collaboration implementations.** `src/controllers/collaboration.controller.js`
  + `src/services/social/postCollaboration.service.js` (`CollaborationService`, caps at 4 invited
  collaborators + 1 owner = 5 total) are never wired to any route and can be safely ignored/removed.
  The actual live path is `social.controller.js` → `PostService` (caps at 5 collaborators total,
  no separate owner-slot math) inside `services/social/post.service.js`. If you're asked to change
  collaboration behavior, change `post.service.js` — changing `postCollaboration.service.js` will
  have zero effect on the API.
- **`src/db/schema/posts.js` does not define the `posts` table.** It only defines
  `groupEventPromotions` (a Groups feature). The actual `posts` table (and almost every other
  social table) is in `src/db/schema/social.js`. Don't go looking in `posts.js` for post columns.
- **`socialProfile.coverImages` doesn't exist** — the schema column is `coverMedia`. Several
  `FeedService` queries (`getFeed`, `getExploreFeed`, `getPersonalizedFeed`) request
  `socialProfile: { columns: { coverImages: true } }`; since that key doesn't match a real
  column, Drizzle silently omits it, so `user.coverImages` in every feed response is always `[]`
  regardless of what the author actually set. Profile fetch (`getSocialProfile`) is unaffected —
  it reads the whole profile object, so `coverMedia` comes through fine there.
- **`socialChat.service.js` references an unimported `StoryService`.** `sharePostToUsers`'s
  story-fallback branch calls `StoryService.isStoryFavourited(...)` but the file never imports
  `StoryService`. Sharing an **expired, non-favourited** story into a DM will throw a
  `ReferenceError` instead of the intended `410 Story has expired`. Sharing a live (unexpired)
  story is unaffected, since the check short-circuits on `expiresAt < new Date()` first.
- **Personalized feed's scoring is computed but not applied.** `FeedService.getPersonalizedFeed`
  builds `priorityTier`/`finalScore` per post (follow-affinity + interest match + engagement) but
  the actual `.sort()` call sorts by `createdAt` only — the scored sort is present as commented-out
  code. Functionally it's a filtered, following+interest-scoped reverse-chron feed today. This is
  a known/tracked gap — see the OLAP design doc referenced in Core Flow #4.
- **No Zod validation on `/api/social/*` or `/api/socialChat/*` routes.** Unlike `auth.route.js`,
  neither route file applies `validate.middleware.js`; all input shape/type checking happens ad hoc
  inside controllers (`if (!content) throw new ApiError(400, ...)`-style guards). Be careful when
  adding new fields — there's no schema enforcing them.
- **Plain 1:1 chat messages are never moderated.** Only `inquiry` and `isPriority` messages go
  through text moderation. This is intentional (per the code comment) — private DMs aren't
  filtered, only business/paid messaging.
- **Pin limits are enforced differently for posts vs profiles.** Pinned *posts* have a DB check
  constraint (`pin_order_range`, 1–9). Pinned *profiles* have no numeric cap in either the schema
  or the service — only global uniqueness per (user, pinnedUser).
- **Wall posts are stored twice.** Every wall post (including auto-generated status updates) gets
  a row in both `socialWallPosts` (for the wall UI) and `posts` (`isStatusPost`/`wallPostId`, so it
  also shows in the normal feed/profile grid). Moderation flags and deletions have to be kept in
  sync across both — see `changeWallPostStatus`/`deleteWallPost` in `profile.service.js`, which do
  this manually rather than via a single source of truth.
- **BriteSide Plus feature gates are enforced inline, not centrally.** Link buttons, linked shop
  products (mutually exclusive with each other), unlimited bio links, and the profile cover button
  are each checked with an ad hoc `if (!isPlus) throw new ApiError(403, ...)` in the relevant
  service/controller. There's no shared "requires Plus" middleware for this module.
- **`GET /api/search` is public** (only rate-limited, no `authMiddleware`) — `viewerId` is
  `req.user?.id`, so unauthenticated callers get results with no block-filtering applied against
  them specifically (there's simply no viewer to filter for).

## Search (social/user search vs universal search)

- **`GET /api/social/search`** (`social.controller.searchUsers` → `services/social/search.service.js`
  `SearchService.searchUsers`) — searches `users` by username/first/last name (`ILIKE`), excludes
  blocked users and self, and can be scoped for `@mention` autocomplete (`forMention=true`, which
  additionally excludes users with `allowTagging === false`). Returns social-shaped fields
  (`isFollowing`, `hasStory`, `followersCount`, etc.) via each user's `socialProfile`.
- **`GET /api/search`** (`search.controller.universalSearch` → the top-level
  `src/services/search.service.js` `SearchService.universalSearch`) — a public, cross-entity search
  (users + published events + groups + active talent profiles) using Postgres full-text search
  (`to_tsquery`) with an email/phone `LIKE` fallback for users when `allowSearchByEmail`/
  `allowSearchByPhone` is set. This is a **different class with the same export name** as the one
  above — always check the import path, not just the name, when tracing a bug through either
  search path. Fully documented in [13-platform-services.md](./13-platform-services.md).

## Common Tasks

- **Add a field to posts/stories/comments**: edit the table in `src/db/schema/social.js` (not
  `posts.js`), run `npm run db:generate` + `npm run db:migrate`, then thread the field through the
  relevant service in `services/social/` (create/update method) and the shaping code in
  `feed.service.js` if it should appear in feed responses.
- **Change feed ranking**: `services/social/feed.service.js`. Read the OLAP design doc first
  (`docs/superpowers/specs/2026-07-01-feed-ranking-olap-moderation-design.md`) — reviving the
  commented-out scored sort without the planned Tinybird signals is explicitly called out there as
  premature.
- **Add a new moderated text field**: call `TextModerationService.assertAllowed` before insert and
  `recordIfFlagged` after, mirroring the pattern in `post.service.js`/`comment.service.js`. See
  [09-moderation.md](./09-moderation.md).
- **Debug "why didn't my follow go through"**: check `socialProfiles.isPublic` for the target —
  private accounts always route through `userFollowRequests`, never a direct `userFollows` insert.
- **Debug "collaborator invite didn't do anything"**: confirm you're changing `post.service.js`,
  not `postCollaboration.service.js` (dead code, see Gotchas).
- **Add a new DM message type**: extend the `messageType` handling in `socialChat.service.js`
  (`sendMessage`) and the emit/notification branching in `socialChat.controller.js` — follow the
  `sharePostToUsers` pattern (metadata shape + notification `type`/`redirectTo`) for anything that
  embeds another entity.
- **Investigate a stuck scheduled post**: check `src/cron/publishScheduledPosts.js` is registered
  in `src/cron/cronJobs.js` and actually running (every minute); the post's `scheduledAt` must be
  `<= now` and `status` still `'scheduled'`.

## Related Modules

- [02-events.md](./02-events.md) — event-owning side of invitations (RSVP, event visibility),
  complementing this module's follower-graph invite flow (`EventInvitationService`).
- [08-dashboards-analytics.md](./08-dashboards-analytics.md) — full analytics/dashboard treatment
  of `SocialAnalyticsService` data, plus the planned Tinybird/OLAP feed-signal layer.
- [09-moderation.md](./09-moderation.md) — text/media moderation services this module calls into
  constantly (posts, comments, stories, wall posts, profiles, priority/inquiry DMs).
- [10-getstream-realtime.md](./10-getstream-realtime.md) — the actual GetStream integration (video
  calls, livestreams) and Socket.IO setup; social chat (this doc) is a separate, non-GetStream
  system that happens to share the same Socket.IO server.
- [13-platform-services.md](./13-platform-services.md) — the universal `/api/search` endpoint
  (`src/services/search.service.js`), uploads/media, mail — disambiguated from this module's
  social/mention search above.
