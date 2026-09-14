/**
 * src/services/social/suggestedUsers.service.js
 *
 * Scoring algorithm:
 *   +10  per mutual follow (someone both users follow)
 *   +5   per shared interest category
 *   +3   if candidate liked/commented a post the current user also liked/commented
 *   +2   if the current user liked/commented on any of the candidate's posts
 *   Final list is sorted descending by score, already-followed and blocked users removed.
 */

import { db } from '../../db/index.js';
import {
  users,
  userFollows,
  userBlocks,
  userInterests,
  postLikes,
  postUserComments,
  socialProfiles,
} from '../../db/schema/index.js';
import { eq, and, or, inArray, not, ne, sql } from 'drizzle-orm';

export class SuggestedUsersService {
  /**
   * Get suggested users for the authenticated user.
   *
   * @param {string} currentUserId
   * @param {object} options
   * @param {number} options.limit   - max results (default 10)
   * @param {number} options.page    - 1-based (default 1)
   * @returns {{ users: SuggestedUser[], total: number }}
   */
  static async getSuggestions(currentUserId, { limit = 10, page = 1 } = {}) {
    // ── 1. Gather current user context in parallel ─────────────────────────
    const [myFollowing, myBlocks, myInterests, myLikedPostIds, myCommentedPostIds] =
      await Promise.all([
        // who I already follow
        db.query.userFollows.findMany({
          where: eq(userFollows.followerId, currentUserId),
          columns: { followingId: true },
        }),
        // who I blocked / who blocked me
        db.query.userBlocks.findMany({
          where: or(
            eq(userBlocks.blockerId, currentUserId),
            eq(userBlocks.blockedId, currentUserId)
          ),
          columns: { blockerId: true, blockedId: true },
        }),
        // my interest category IDs
        db.query.userInterests.findMany({
          where: eq(userInterests.userId, currentUserId),
          columns: { categoryId: true },
        }),
        // post IDs I liked
        db.query.postLikes.findMany({
          where: eq(postLikes.userId, currentUserId),
          columns: { postId: true },
        }),
        // post IDs I commented on
        db.query.postUserComments.findMany({
          where: eq(postUserComments.userId, currentUserId),
          columns: { postId: true },
        }),
      ]);

    const followingIds = new Set(myFollowing.map(f => f.followingId));
    const blockedIds = new Set(
      myBlocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== currentUserId)
    );
    const myInterestIds = new Set(myInterests.map(i => i.categoryId));
    const myLikedIds = new Set(myLikedPostIds.map(l => l.postId));
    const myCommentedIds = new Set(myCommentedPostIds.map(c => c.postId));

    // IDs to exclude from candidates: self + already following + blocked
    const excludeIds = new Set([currentUserId, ...followingIds, ...blockedIds]);

    // ── 2. Find all candidate user IDs (active, public or private) ─────────
    // We fetch from users who have a socialProfile so we know they're active
    const candidateProfiles = await db.query.socialProfiles.findMany({
      columns: { userId: true },
    });

    const candidateIds = candidateProfiles.map(p => p.userId).filter(id => !excludeIds.has(id));

    if (candidateIds.length === 0) {
      return { users: [], total: 0, page, limit };
    }

    // ── 3. Score each candidate ─────────────────────────────────────────────
    const scoreMap = new Map(); // candidateId → score

    const initScore = id => {
      if (!scoreMap.has(id)) scoreMap.set(id, 0);
    };
    const addScore = (id, pts) => {
      initScore(id);
      scoreMap.set(id, scoreMap.get(id) + pts);
    };

    // ── 3a. Mutual follows (+10 each) ──────────────────────────────────────
    // "People that someone I follow also follows"
    if (followingIds.size > 0) {
      const followingArray = [...followingIds];
      // fetch who each person I follow is following
      const secondDegree = await db.query.userFollows.findMany({
        where: and(
          inArray(userFollows.followerId, followingArray),
          not(inArray(userFollows.followingId, [...excludeIds]))
        ),
        columns: { followingId: true },
      });
      secondDegree.forEach(row => {
        if (candidateIds.includes(row.followingId)) {
          addScore(row.followingId, 10);
        }
      });

      // Also: candidates who follow back someone I follow (+8)
      const candidatesWhoFollowMyConnections = await db.query.userFollows.findMany({
        where: and(
          inArray(userFollows.followerId, candidateIds),
          inArray(userFollows.followingId, followingArray)
        ),
        columns: { followerId: true },
      });
      candidatesWhoFollowMyConnections.forEach(row => addScore(row.followerId, 8));
    }

    // ── 3b. Shared interests (+5 each) ────────────────────────────────────
    if (myInterestIds.size > 0) {
      const candidateInterests = await db.query.userInterests.findMany({
        where: and(
          inArray(userInterests.userId, candidateIds),
          inArray(userInterests.categoryId, [...myInterestIds])
        ),
        columns: { userId: true, categoryId: true },
      });
      candidateInterests.forEach(row => addScore(row.userId, 5));
    }

    // ── 3c. Interaction overlap (+3) ─────────────────────────────────────
    // Candidates who liked/commented the same posts as me
    const interactionPostIds = [...new Set([...myLikedIds, ...myCommentedIds])];

    if (interactionPostIds.length > 0) {
      const [overlapLikes, overlapComments] = await Promise.all([
        db.query.postLikes.findMany({
          where: and(
            inArray(postLikes.userId, candidateIds),
            inArray(postLikes.postId, interactionPostIds)
          ),
          columns: { userId: true },
        }),
        db.query.postUserComments.findMany({
          where: and(
            inArray(postUserComments.userId, candidateIds),
            inArray(postUserComments.postId, interactionPostIds)
          ),
          columns: { userId: true },
        }),
      ]);
      overlapLikes.forEach(row => addScore(row.userId, 3));
      overlapComments.forEach(row => addScore(row.userId, 3));
    }

    // ── 3d. Engagement on candidate posts (+2) ────────────────────────────
    // Current user liked or commented on candidate's posts
    // (they may already appear from overlap above — extra affinity signal)
    if (myLikedIds.size > 0 || myCommentedIds.size > 0) {
      // Find which posts belong to candidates
      const { posts } = await import('../../db/schema/index.js');
      const candidatePosts = await db.query.posts.findMany({
        where: inArray(posts.userId, candidateIds),
        columns: { id: true, userId: true },
      });
      const candidatePostIds = candidatePosts.map(p => p.id);
      const postOwnerMap = new Map(candidatePosts.map(p => [p.id, p.userId]));

      const myEngagedPosts = candidatePostIds.filter(
        id => myLikedIds.has(id) || myCommentedIds.has(id)
      );
      myEngagedPosts.forEach(postId => {
        const ownerId = postOwnerMap.get(postId);
        if (ownerId) addScore(ownerId, 2);
      });
    }

    // ── 4. Seed every un-scored candidate with 1 (random discovery) ────────
    candidateIds.forEach(id => initScore(id));

    // ── 5. Sort, paginate ──────────────────────────────────────────────────
    const sorted = [...scoreMap.entries()]
      .sort((a, b) => b[1] - a[1]) // highest score first
      .map(([id, score]) => ({ id, score }));

    const total = sorted.length;
    const offset = (page - 1) * limit;
    const paged = sorted.slice(offset, offset + limit);

    if (paged.length === 0) return { users: [], total, page, limit };

    // ── 6. Hydrate user details ────────────────────────────────────────────
    const pagedIds = paged.map(p => p.id);

    const [userRows, profileRows, followerRows] = await Promise.all([
      db.query.users.findMany({
        where: inArray(users.id, pagedIds),
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          image: true,
        },
      }),
      db.query.socialProfiles.findMany({
        where: inArray(socialProfiles.userId, pagedIds),
        columns: {
          userId: true,
          bio: true,
          followersCount: true,
          isVerified: true,
          isPublic: true,
        },
      }),
      // How many of my followings also follow each candidate → "X mutual"
      followingIds.size > 0
        ? db.query.userFollows.findMany({
            where: and(
              inArray(userFollows.followerId, [...followingIds]),
              inArray(userFollows.followingId, pagedIds)
            ),
            columns: { followingId: true },
          })
        : Promise.resolve([]),
    ]);

    // Build mutual count map
    const mutualCountMap = new Map();
    followerRows.forEach(row => {
      mutualCountMap.set(row.followingId, (mutualCountMap.get(row.followingId) || 0) + 1);
    });

    const profileMap = new Map(profileRows.map(p => [p.userId, p]));
    const scoreIndex = new Map(paged.map(p => [p.id, p.score]));

    const result = userRows
      .map(u => {
        const profile = profileMap.get(u.id) || {};
        const mutualCount = mutualCountMap.get(u.id) || 0;
        const score = scoreIndex.get(u.id) || 1;

        // Generate a human-readable reason for the suggestion
        let reason = 'Suggested for you';
        if (score >= 30) reason = `${mutualCount} mutual connection${mutualCount !== 1 ? 's' : ''}`;
        else if (score >= 20) reason = 'Followed by people you follow';
        else if (score >= 10) reason = 'Shares your interests';
        else if (score >= 5) reason = 'Active in posts you like';

        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          image: u.image || null,
          bio: profile.bio || null,
          followersCount: profile.followersCount || 0,
          isVerified: profile.isVerified || false,
          isPublic: profile.isPublic ?? true,
          mutualFollowersCount: mutualCount,
          score,
          reason,
        };
      })
      // Re-sort by score after hydration (map may reorder)
      .sort((a, b) => b.score - a.score);

    return { users: result, total, page, limit };
  }
}
