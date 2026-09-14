import { db } from '../../db/index.js';
import { userFollows, userBlocks } from '../../db/schema/index.js';
import { eq, and, or, desc } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';

/**
 * Block service for managing user block relationships
 */
export class BlockService {
  /**
   * Block a user
   * @param {string} blockerId - The blocker's user ID
   * @param {string} blockedId - The user to block
   */
  static async blockUser(blockerId, blockedId) {
    if (blockerId === blockedId) {
      throw new ApiError(400, 'Cannot block yourself');
    }

    // Check if already blocked
    const existing = await db.query.userBlocks.findFirst({
      where: and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)),
    });

    if (existing) {
      throw new ApiError(400, 'User already blocked');
    }

    const [block] = await db.insert(userBlocks).values({ blockerId, blockedId }).returning();

    // Remove follow relationships
    await db
      .delete(userFollows)
      .where(
        or(
          and(eq(userFollows.followerId, blockerId), eq(userFollows.followingId, blockedId)),
          and(eq(userFollows.followerId, blockedId), eq(userFollows.followingId, blockerId))
        )
      );

    return block;
  }

  /**
   * Unblock a user
   * @param {string} blockerId - The blocker's user ID
   * @param {string} blockedId - The user to unblock
   */
  static async unblockUser(blockerId, blockedId) {
    const deleted = await db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
      .returning();

    if (deleted.length === 0) {
      throw new ApiError(404, 'Block relationship not found');
    }

    return { success: true };
  }

  /**
   * Get list of blocked users
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getBlockedUsers(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const blocked = await db.query.userBlocks.findMany({
      where: eq(userBlocks.blockerId, userId),
      with: {
        blocked: {
          with: {
            socialProfile: true,
          },
        },
      },
      orderBy: desc(userBlocks.createdAt),
      limit,
      offset,
    });

    return blocked.map(b => ({
      id: b.blocked.id,
      username: b.blocked.username,
      firstName: b.blocked.firstName,
      lastName: b.blocked.lastName,
      image: b.blocked.image,
      blockedAt: b.createdAt,
    }));
  }

  /**
   * All user IDs involved in ANY block relationship with `userId` — both
   * people they've blocked and people who've blocked them. Meant for bulk
   * client-side filtering (conversation lists, search results) where
   * calling isBlocked() once per row would be a query per row instead of one
   * query total.
   */
  static async getAllBlockRelationshipUserIds(userId) {
    const rows = await db.query.userBlocks.findMany({
      where: or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)),
      columns: { blockerId: true, blockedId: true },
    });
    const ids = new Set();
    for (const row of rows) {
      ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }
    return [...ids];
  }

  /**
   * Check if blockerId has blocked blockedId (one direction only)
   */
  static async isBlockedBy(blockerId, blockedId) {
    try {
      const block = await db.query.userBlocks.findFirst({
        where: and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)),
      });
      return !!block;
    } catch {
      return false;
    }
  }

  /**
   * Check if either user has blocked the other
   * @param {string} userId1 - First user's ID
   * @param {string} userId2 - Second user's ID
   */
  static async isBlocked(userId1, userId2) {
    try {
      const block = await db.query.userBlocks.findFirst({
        where: or(
          and(eq(userBlocks.blockerId, userId1), eq(userBlocks.blockedId, userId2)),
          and(eq(userBlocks.blockerId, userId2), eq(userBlocks.blockedId, userId1))
        ),
      });

      return !!block;
    } catch (error) {
      // If userBlocks table doesn't exist yet, return false
      console.warn('userBlocks table not found, assuming no blocks exist');
      return false;
    }
  }
}
