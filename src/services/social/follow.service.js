import { db } from '../../db/index.js';
import { users, userFollows, socialProfiles, userFollowRequests } from '../../db/schema/index.js';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { getActorDisplayName } from '../../utils/helper.js';
import {
  createNotification,
  deleteNotificationByTypeAndRelatedId,
} from '../notification.service.js';
import { BlockService } from './block.service.js';
import { randomUUID } from 'crypto';
/**
 * Follow system service for managing user follow relationships
 */
export class FollowService {
  /**
   * Toggle follow/unfollow a user
   * @param {string} followerId - The follower's user ID
   * @param {string} followingId - The user to follow/unfollow
   */
  // In social.service.js

  static async toggleFollowUser(followerId, targetUserId) {
    // Check if already following — if so, unfollow
    const existingFollow = await db.query.userFollows.findFirst({
      where: and(eq(userFollows.followerId, followerId), eq(userFollows.followingId, targetUserId)),
    });

    if (existingFollow) {
      await db.delete(userFollows).where(eq(userFollows.id, existingFollow.id));

      await db
        .update(socialProfiles)
        .set({ followingCount: sql`${socialProfiles.followingCount} - 1` })
        .where(eq(socialProfiles.userId, followerId));

      await db
        .update(socialProfiles)
        .set({ followersCount: sql`${socialProfiles.followersCount} - 1` })
        .where(eq(socialProfiles.userId, targetUserId));

      return { following: false, requested: false };
    }

    // Check if a pending follow request already exists — if so, cancel it
    const existingRequest = await db.query.userFollowRequests.findFirst({
      where: and(
        eq(userFollowRequests.requesterId, followerId),
        eq(userFollowRequests.targetId, targetUserId),
        eq(userFollowRequests.status, 'pending')
      ),
    });

    if (existingRequest) {
      await db.delete(userFollowRequests).where(eq(userFollowRequests.id, existingRequest.id));

      // Delete the follow_request notification from target's inbox
      await deleteNotificationByTypeAndRelatedId(
        targetUserId, // who received the notification
        'follow_request',
        followerId // who triggered it
      );

      return { following: false, requested: false };
    }

    // Only guards creating a NEW follow/request below — unfollowing or
    // cancelling a pending request (above) always stays allowed either way.
    if (await BlockService.isBlocked(followerId, targetUserId)) {
      throw new ApiError(403, 'You cannot follow this user');
    }

    // Check if target profile is private
    const targetProfile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, targetUserId),
      columns: { isPublic: true },
    });

    const isPrivate = targetProfile ? !targetProfile.isPublic : false;

    if (isPrivate) {
      // Send a follow request
      await db.insert(userFollowRequests).values({
        id: randomUUID(),
        requesterId: followerId,
        targetId: targetUserId,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const followerName = await getActorDisplayName(followerId);

      await createNotification({
        userId: targetUserId,
        title: 'New Follow Request',
        message: `${followerName} wants to follow you.`,
        type: 'follow_request',
        relatedId: followerId,
        redirectTo: `/notifications`,
        metadata: { requesterId: followerId },
      });

      return { following: false, requested: true };
    }

    // Public profile — follow directly
    await db.insert(userFollows).values({
      id: randomUUID(),
      followerId,
      followingId: targetUserId,
      createdAt: new Date(),
    });

    await db
      .update(socialProfiles)
      .set({ followingCount: sql`${socialProfiles.followingCount} + 1` })
      .where(eq(socialProfiles.userId, followerId));

    await db
      .update(socialProfiles)
      .set({ followersCount: sql`${socialProfiles.followersCount} + 1` })
      .where(eq(socialProfiles.userId, targetUserId));

    const followerName = await getActorDisplayName(followerId);

    await createNotification({
      userId: targetUserId,
      title: 'New Follower',
      message: `${followerName} started following you.`,
      type: 'follow',
      relatedId: followerId,
      redirectTo: `/notifications`,
      metadata: { followerId },
    });

    return { following: true, requested: false };
  }

  /**
   * Update follow counts for both users
   * @param {string} followerId - The follower's user ID
   * @param {string} followingId - The followed user's ID
   */
  static async updateFollowCounts(followerId, followingId) {
    // Update follower's following count
    const followingCount = await db
      .select({ count: count() })
      .from(userFollows)
      .where(eq(userFollows.followerId, followerId));

    await db
      .update(socialProfiles)
      .set({ followingCount: followingCount[0].count })
      .where(eq(socialProfiles.userId, followerId));

    // Update following user's followers count
    const followersCount = await db
      .select({ count: count() })
      .from(userFollows)
      .where(eq(userFollows.followingId, followingId));

    await db
      .update(socialProfiles)
      .set({ followersCount: followersCount[0].count })
      .where(eq(socialProfiles.userId, followingId));
  }

  /**
   * Get followers of a user
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getFollowers(userId, page = 1, limit = 20, viewerId = null) {
    if (viewerId && viewerId !== userId) {
      const targetProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.userId, userId),
        columns: { isPublic: true },
      });

      if (targetProfile && !targetProfile.isPublic) {
        const isFollowing = await db.query.userFollows.findFirst({
          where: and(eq(userFollows.followerId, viewerId), eq(userFollows.followingId, userId)),
        });
        if (!isFollowing) {
          throw new ApiError(403, 'This account is private');
        }
      }
    }
    const offset = (page - 1) * limit;

    const followers = await db.query.userFollows.findMany({
      where: eq(userFollows.followingId, userId),
      with: {
        follower: {
          with: {
            socialProfile: true,
          },
        },
      },
      orderBy: desc(userFollows.createdAt),
      limit,
      offset,
    });

    return followers.map(f => ({
      id: f.follower.id,
      username: f.follower.username,
      firstName: f.follower.firstName,
      lastName: f.follower.lastName,
      image: f.follower.image,
      bio: f.follower.socialProfile?.bio,
      followedAt: f.createdAt,
      allowTagging: f.follower.allowTagging ?? true,
    }));
  }

  /**
   * Get users that a user is following
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getFollowing(userId, page = 1, limit = 20, viewerId = null) {
    if (viewerId && viewerId !== userId) {
      const targetProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.userId, userId),
        columns: { isPublic: true },
      });

      if (targetProfile && !targetProfile.isPublic) {
        const isFollowing = await db.query.userFollows.findFirst({
          where: and(eq(userFollows.followerId, viewerId), eq(userFollows.followingId, userId)),
        });
        if (!isFollowing) {
          throw new ApiError(403, 'This account is private');
        }
      }
    }
    const offset = (page - 1) * limit;

    const following = await db.query.userFollows.findMany({
      where: eq(userFollows.followerId, userId),
      with: {
        following: {
          with: {
            socialProfile: true,
          },
        },
      },
      orderBy: desc(userFollows.createdAt),
      limit,
      offset,
    });

    return following.map(f => ({
      id: f.following.id,
      username: f.following.username,
      firstName: f.following.firstName,
      lastName: f.following.lastName,
      image: f.following.image,
      bio: f.following.socialProfile?.bio,
      followedAt: f.createdAt,
      allowMessagesFrom: f.following.allowMessagesFrom ?? 'everyone',
    }));
  }

  /**
   * Check if a user is following another user
   * @param {string} followerId - The potential follower's ID
   * @param {string} followingId - The potentially followed user's ID
   */
  static async isFollowing(followerId, followingId) {
    const follow = await db.query.userFollows.findFirst({
      where: and(eq(userFollows.followerId, followerId), eq(userFollows.followingId, followingId)),
    });

    return !!follow;
  }
}
