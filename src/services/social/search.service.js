import { db } from '../../db/index.js';
import { users, userFollows, userBlocks } from '../../db/schema/index.js';
import { eq, and, or, sql, inArray, not } from 'drizzle-orm';
import { StoryService } from './story.service.js';

export class SearchService {
  static async searchUsers(query, currentUserId, page = 1, limit = 20, forMention = false) {
    const offset = (page - 1) * limit;

    const blockedUsers = await db.query.userBlocks.findMany({
      where: or(eq(userBlocks.blockerId, currentUserId), eq(userBlocks.blockedId, currentUserId)),
    });

    const blockedIds = blockedUsers.map(b =>
      b.blockerId === currentUserId ? b.blockedId : b.blockerId
    );
    blockedIds.push(currentUserId);

    const nameCondition = or(
      sql`${users.username} ILIKE ${`%${query}%`}`,
      sql`${users.firstName} ILIKE ${`%${query}%`}`,
      sql`${users.lastName} ILIKE ${`%${query}%`}`
    );
    const whereCondition = and(
      nameCondition,
      not(inArray(users.id, blockedIds)),
      forMention ? sql`${users.allowTagging} IS NOT FALSE` : undefined
    );

    const searchResults = await db.query.users.findMany({
      where: whereCondition,
      with: {
        socialProfile: true,
      },
      limit,
      offset,
    });

    console.log(
      '[SearchService] searchResults:',
      searchResults.map(u => ({
        username: u.username,
        allowTagging: u.allowTagging, // ← what value does Drizzle read?
        forMention,
      }))
    );

    const userIds = searchResults.map(u => u.id).filter(Boolean);
    let followingSet = new Set();
    if (userIds.length > 0) {
      const follows = await db.query.userFollows.findMany({
        where: and(
          eq(userFollows.followerId, currentUserId),
          inArray(userFollows.followingId, userIds)
        ),
        columns: { followingId: true },
      });
      followingSet = new Set(follows.map(f => f.followingId));
    }

    const userStoryStatus = await Promise.all(
      searchResults.map(async user => ({
        userId: user.id,
        hasStory: await StoryService.hasActiveStory(user.id),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );

    return searchResults.map(user => ({
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      image: user.image,
      bio: user.socialProfile?.bio,
      followersCount: user.socialProfile?.followersCount || 0,
      followingCount: user.socialProfile?.followingCount || 0,
      postsCount: user.socialProfile?.postsCount || 0,
      coverImages: user.socialProfile?.coverImages || [],
      isFollowing: followingSet.has(user.id),
      hasStory: storyStatusMap.get(user.id) || false,
      allowMessagesFrom: user.allowMessagesFrom ?? 'everyone',
    }));
  }
}
