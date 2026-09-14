import { db } from '../../db/index.js';
import {
  userFollows,
  posts,
  postLikes,
  postReposts,
  postUserComments,
  savedPosts,
  userBlocks,
  userInterests,
  postCollaborators,
} from '../../db/schema/index.js';
import { eq, and, or, desc, sql, inArray, not, isNull, gt, ne } from 'drizzle-orm';
import { FollowService } from './follow.service.js';
import { StoryService } from './story.service.js';
import { ProfileService } from './profile.service.js';
import { PostService } from './post.service.js';
import {
  postsModerationGate,
  attachPostModerationStatuses,
} from '../moderation/mediaModeration.service.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';
import { userFollowRequests } from '../../db/schema/index.js';

export class FeedService {
  static async getFeed(userId, options = {}, categoryId) {
    const { page = 1, limit = 20, cursor = null, mediaType = null, hasMedia = null } = options;

    const offset = cursor ? 0 : (page - 1) * limit;

    const followingUsers = await db.query.userFollows.findMany({
      where: eq(userFollows.followerId, userId),
      columns: { followingId: true },
    });

    const followingIds = followingUsers.map(f => f.followingId);

    if (followingIds.length === 0) {
      return {
        posts: [],
        pagination: { page, limit, hasMore: false, nextCursor: null, total: 0 },
      };
    }

    const blockedUsers = await db.query.userBlocks.findMany({
      where: or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)),
      columns: { blockerId: true, blockedId: true },
    });

    const blockedIds = blockedUsers.map(b => (b.blockerId === userId ? b.blockedId : b.blockerId));

    const validFollowingIds = followingIds.filter(id => !blockedIds.includes(id));

    if (validFollowingIds.length === 0) {
      return {
        posts: [],
        pagination: { page, limit, hasMore: false, nextCursor: null, total: 0 },
      };
    }

    const followingIdsArray = sql`ARRAY[${sql.join(
      validFollowingIds.map(id => sql`${id}`),
      sql`, `
    )}]::uuid[]`;

    let whereConditions = [
      sql`(
    ${posts.userId} = ANY(${followingIdsArray})
    OR EXISTS (
      SELECT 1 FROM post_collaborators pc
      WHERE pc.post_id = ${posts.id}
        AND pc.collaborator_id = ANY(${followingIdsArray})
        AND pc.status = 'accepted'
    )
    OR (
      -- Someone I follow reposted this — surfaced even though I don't
      -- follow the original author. The visibility check below (not this
      -- clause) is what gates followers-only originals, by additionally
      -- allowing them through when reposted by someone I follow.
      EXISTS (
        SELECT 1 FROM post_reposts pr
        WHERE pr.post_id = ${posts.id}
          AND pr.user_id = ANY(${followingIdsArray})
      )
    )
  )`,
      eq(posts.isArchived, false),
      eq(posts.status, 'published'),
      ne(posts.source, 'import'),
      isNull(posts.deletedAt),
      or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date())),
      sql`(
    ${posts.wallPostId} IS NULL OR EXISTS (
      SELECT 1 FROM social_wall_posts swp
      JOIN social_profiles sp ON sp.id = swp.profile_id
      WHERE swp.id = ${posts.wallPostId}
      AND swp.author_id = sp.user_id
    )
  )`,
      postsModerationGate(userId),
    ];

    // Visibility — a followers-only original is also let through when
    // someone I follow reposted it. The reposter already had legitimate
    // access when they shared it, and choosing to repost extends it to
    // their own followers, same as a direct share on other platforms.
    whereConditions.push(sql`(
  ${posts.visibility} = 'public'
  OR (
    ${posts.visibility} = 'followers'
    AND (
      ${posts.userId} = ANY(${followingIdsArray})
      OR EXISTS (
        SELECT 1 FROM post_collaborators pc2
        WHERE pc2.post_id = ${posts.id}
          AND pc2.collaborator_id = ANY(${followingIdsArray})
          AND pc2.status = 'accepted'
      )
      OR EXISTS (
        SELECT 1 FROM post_reposts pr2
        WHERE pr2.post_id = ${posts.id}
          AND pr2.user_id = ANY(${followingIdsArray})
      )
    )
  )
)`);

    // Block filter: still show post if a followed collaborator exists,
    // even if the author is blocked
    if (blockedIds.length > 0) {
      whereConditions.push(sql`(
    ${posts.userId} NOT IN (${sql.join(
      blockedIds.map(id => sql`${id}`),
      sql`, `
    )})
    OR EXISTS (
      SELECT 1 FROM post_collaborators pc3
      WHERE pc3.post_id = ${posts.id}
        AND pc3.collaborator_id = ANY(${followingIdsArray})
        AND pc3.status = 'accepted'
    )
  )`);
    }

    // Hidden posts
    whereConditions.push(
      sql`NOT EXISTS (SELECT 1 FROM user_hidden_posts uhp WHERE uhp.post_id = ${posts.id} AND uhp.user_id = ${userId})`
    );

    if (cursor) {
      whereConditions.push(sql`${posts.createdAt} < ${cursor}`);
    }

    if (hasMedia === true) {
      whereConditions.push(sql`array_length(${posts.mediaUrls}, 1) > 0`);
    } else if (hasMedia === false) {
      whereConditions.push(
        sql`array_length(${posts.mediaUrls}, 1) = 0 OR ${posts.mediaUrls} IS NULL`
      );
    }

    if (mediaType) {
      whereConditions.push(sql`${posts.mediaTypes} @> ${JSON.stringify([mediaType])}`);
    }

    if (categoryId !== undefined) {
      whereConditions.push(
        sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = ${posts.id} AND pt.category_id = ${categoryId})`
      );
    }

    const feedPosts = await db.query.posts.findMany({
      where: and(...whereConditions),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
          with: {
            socialProfile: {
              columns: { bio: true, isPublic: true, coverImages: true },
            },
          },
        },
        likes: { where: eq(postLikes.userId, userId), columns: { id: true } },
        saves: { where: eq(savedPosts.userId, userId), columns: { id: true } },
        reposts: { where: eq(postReposts.userId, userId), columns: { id: true } },
        commented: { where: eq(postUserComments.userId, userId), columns: { commentId: true } },
        tags: { with: { category: true } },
      },
      orderBy: desc(posts.createdAt),
      limit: limit + 1,
      offset,
    });

    const hasMore = feedPosts.length > limit;
    const postsData = hasMore ? feedPosts.slice(0, limit) : feedPosts;
    const nextCursor = hasMore ? postsData[postsData.length - 1].createdAt : null;

    // Build isRequested set for post authors
    const authorIds = [...new Set(postsData.map(p => p.userId))];
    const pendingRequests = authorIds.length
      ? await db
          .select({ targetId: userFollowRequests.targetId })
          .from(userFollowRequests)
          .where(
            and(
              eq(userFollowRequests.requesterId, userId),
              eq(userFollowRequests.status, 'pending'),
              inArray(userFollowRequests.targetId, authorIds)
            )
          )
      : [];
    const requestedSet = new Set(pendingRequests.map(r => r.targetId));

    await attachPostModerationStatuses(postsData);

    const postIds = postsData.map(p => p.id);
    const collabRows = postIds.length
      ? await db.query.postCollaborators.findMany({
          where: and(
            inArray(postCollaborators.postId, postIds),
            eq(postCollaborators.status, 'accepted')
          ),
          with: {
            collaborator: {
              columns: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                image: true,
                isEmailVerified: true,
                isBritesidePlus: true,
              },
            },
          },
        })
      : [];
    const collaboratorsByPost = new Map();
    for (const row of collabRows) {
      if (!collaboratorsByPost.has(row.postId)) collaboratorsByPost.set(row.postId, []);
      collaboratorsByPost.get(row.postId).push(row.collaborator);
    }

    const linkedProductsByPost = await PostService._linkedProductsByPost(postsData.map(p => p.id));

    // Who among the people I follow reposted each of these posts — used to
    // attach "reposted by" attribution below for posts that only qualify
    // for this feed because of a repost (not direct authorship/collab).
    const repostRows = postIds.length
      ? await db.query.postReposts.findMany({
          where: and(inArray(postReposts.postId, postIds), inArray(postReposts.userId, validFollowingIds)),
          orderBy: desc(postReposts.createdAt),
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            },
          },
        })
      : [];
    const repostedByPost = new Map();
    for (const r of repostRows) {
      if (!repostedByPost.has(r.postId)) {
        repostedByPost.set(r.postId, {
          id: r.user.id,
          username: r.user.username,
          firstName: r.user.firstName,
          lastName: r.user.lastName,
          image: r.user.image,
          repostedAt: r.createdAt,
        });
      }
    }

    // NOW safe to use collaboratorsByPost
    const followingSet = new Set(validFollowingIds);
    for (const post of postsData) {
      if (followingSet.has(post.userId)) {
        post.isFollowing = true;
      } else {
        const postCollabs = collaboratorsByPost.get(post.id) || [];
        post.isFollowing = postCollabs.some(c => followingSet.has(c.id));
      }
    }

    const uniqueUserIds = [...new Set(postsData.map(post => post.userId))];
    const userStoryStatus = await Promise.all(
      uniqueUserIds.map(async userId => ({
        userId,
        hasStory: await StoryService.hasActiveStory(userId),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );

    const formattedPosts = postsData.map(post => ({
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      mediaUrls: post.mediaUrls || [],
      mediaTypes: post.mediaTypes || [],
      aspectRatios: post.aspectRatios || [],
      location: post.location,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      repostsCount: post.repostsCount,
      viewsCount: post.viewsCount || 0,
      isArchived: post.isArchived,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      isFollowing: post.isFollowing,
      // Only attached when this post is in my feed BECAUSE someone I follow
      // reposted it — not when I already see it via following the author
      // (matches how the whereConditions repost clause above admits it).
      repostedBy: post.isFollowing ? null : (repostedByPost.get(post.id) ?? null),
      isRequested: requestedSet.has(post.userId),
      visibility: post.visibility,
      isStatusPost: post.isStatusPost || false,
      isCoverPost: post.isCoverPost || false,
      commentsDisabled: post.settings?.commentsDisabled || false,
      hideLikes: post.settings?.hideLikes || false,
      linkButton: post.settings?.linkButton || null,
      linkedProducts: linkedProductsByPost.get(post.id) || [],
      collaborators: collaboratorsByPost.get(post.id) || [],
      user: {
        id: post.user.id,
        username: post.user.username,
        firstName: post.user.firstName,
        lastName: post.user.lastName,
        image: post.user.image,
        bio: post.user.socialProfile?.bio,
        isPublic: post.user.socialProfile?.isPublic,
        coverImages: post.user.socialProfile?.coverImages || [],
        hasStory: storyStatusMap.get(post.userId) || false,
        isEmailVerified: post.user.isEmailVerified,
        isBritesidePlus: post.user.isBritesidePlus,
      },
      isLiked: post.likes.length > 0,
      isSaved: post.saves.length > 0,
      isReposted: post.reposts ? post.reposts.length > 0 : false,
      moderationStatus: post.moderationStatus ?? 'approved',
    }));

    const filterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(formattedPosts, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled,
    });

    return {
      posts: formattedPosts,
      pagination: { page, limit, hasMore, nextCursor, total: null },
    };
  }

  static async getExploreFeed(userId, options = {}, categoryId) {
    const {
      page = 1,
      limit = 20,
      cursor = null,
      mediaType = null,
      hasMedia = null,
      sortBy = 'trending',
    } = options;

    const offset = cursor ? 0 : (page - 1) * limit;

    const [blockedUsers, stories] = await Promise.all([
      db.query.userBlocks.findMany({
        where: or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)),
        columns: { blockerId: true, blockedId: true },
      }),
      StoryService.getStories(userId, userId, true),
    ]);

    const blockedIds = blockedUsers.map(b => (b.blockerId === userId ? b.blockedId : b.blockerId));

    let whereConditions = [
      ...(blockedIds.length > 0 ? [not(inArray(posts.userId, blockedIds))] : []),
      eq(posts.isArchived, false),
      eq(posts.status, 'published'),
      eq(posts.isStatusPost, false),
      eq(posts.isCoverPost, false),
      ne(posts.source, 'import'),
      // isNull(posts.wallPostId),
      isNull(posts.deletedAt),
      or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date())),
      sql`(
  ${posts.wallPostId} IS NULL OR EXISTS (
    SELECT 1 FROM social_wall_posts swp
    JOIN social_profiles sp ON sp.id = swp.profile_id
    WHERE swp.id = ${posts.wallPostId}
    AND swp.author_id = sp.user_id
  )
)`,
      postsModerationGate(userId),
    ];

    whereConditions.push(sql`${posts.visibility} = 'public'`);

    whereConditions.push(ProfileService.viewerVisibilityCondition(userId));

    whereConditions.push(
      sql`NOT EXISTS (SELECT 1 FROM user_hidden_posts uhp WHERE uhp.post_id = ${posts.id} AND uhp.user_id = ${userId})`
    );

    if (cursor) {
      if (sortBy === 'recent') {
        whereConditions.push(sql`${posts.createdAt} < ${cursor}`);
      } else {
        whereConditions.push(sql`${posts.likesCount} < ${cursor}`);
      }
    }

    if (hasMedia === true) {
      whereConditions.push(sql`array_length(${posts.mediaUrls}, 1) > 0`);
    } else if (hasMedia === false) {
      whereConditions.push(
        sql`array_length(${posts.mediaUrls}, 1) = 0 OR ${posts.mediaUrls} IS NULL`
      );
    }

    if (mediaType) {
      whereConditions.push(sql`${posts.mediaTypes} @> ${JSON.stringify([mediaType])}`);
    }

    let orderBy;
    switch (sortBy) {
      case 'recent':
        orderBy = desc(posts.createdAt);
        break;
      case 'popular':
        orderBy = desc(posts.likesCount);
        break;
      case 'trending':
      default:
        orderBy = [
          desc(
            sql`(
      ${posts.likesCount}
      + ${posts.commentsCount} * 2
      + ${posts.sharesCount} * 3
    )
    / NULLIF(
        EXTRACT(EPOCH FROM (NOW() - ${posts.createdAt})),
        0
      )
    * 3600`
          ),
          desc(posts.createdAt),
        ];
        break;
    }

    if (categoryId !== undefined) {
      whereConditions.push(
        sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = ${posts.id} AND pt.category_id = ${categoryId})`
      );
    }

    const explorePosts = await db.query.posts.findMany({
      where: and(...whereConditions),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
          with: {
            socialProfile: {
              columns: { bio: true, isPublic: true, coverImages: true },
            },
          },
        },
        likes: { where: eq(postLikes.userId, userId), columns: { id: true } },
        saves: { where: eq(savedPosts.userId, userId), columns: { id: true } },
        reposts: { where: eq(postReposts.userId, userId), columns: { id: true } },
        tags: { with: { category: true } },
      },
      orderBy,
      limit: limit + 1,
      offset,
    });

    const hasMore = explorePosts.length > limit;
    const postsData = hasMore ? explorePosts.slice(0, limit) : explorePosts;
    const nextCursor = hasMore
      ? sortBy === 'recent'
        ? postsData[postsData.length - 1].createdAt
        : postsData[postsData.length - 1].likesCount
      : null;

    // Build isRequested set for post authors
    const authorIds = [...new Set(postsData.map(p => p.userId))];
    const pendingRequests = authorIds.length
      ? await db
          .select({ targetId: userFollowRequests.targetId })
          .from(userFollowRequests)
          .where(
            and(
              eq(userFollowRequests.requesterId, userId),
              eq(userFollowRequests.status, 'pending'),
              inArray(userFollowRequests.targetId, authorIds)
            )
          )
      : [];
    const requestedSet = new Set(pendingRequests.map(r => r.targetId));

    await attachPostModerationStatuses(postsData);

    for (const post of postsData) {
      post.isFollowing = await FollowService.isFollowing(userId, post.userId);
    }

    const uniqueUserIds = [...new Set(postsData.map(post => post.userId))];
    const userStoryStatus = await Promise.all(
      uniqueUserIds.map(async userId => ({
        userId,
        hasStory: await StoryService.hasActiveStory(userId),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );
    const postIds = postsData.map(p => p.id);
    const collabRows = postIds.length
      ? await db.query.postCollaborators.findMany({
          where: and(
            inArray(postCollaborators.postId, postIds),
            eq(postCollaborators.status, 'accepted')
          ),
          with: {
            collaborator: {
              columns: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                image: true,
                isEmailVerified: true,
                isBritesidePlus: true,
              },
            },
          },
        })
      : [];
    const collaboratorsByPost = new Map();
    for (const row of collabRows) {
      if (!collaboratorsByPost.has(row.postId)) collaboratorsByPost.set(row.postId, []);
      collaboratorsByPost.get(row.postId).push(row.collaborator);
    }

    const linkedProductsByPost = await PostService._linkedProductsByPost(postsData.map(p => p.id));

    const shapedPosts = postsData.map(post => ({
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      mediaUrls: post.mediaUrls || [],
      mediaTypes: post.mediaTypes || [],
      aspectRatios: post.aspectRatios || [],
      location: post.location,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      isArchived: post.isArchived,
      isStatusPost: post.isStatusPost || false,
      isCoverPost: post.isCoverPost || false,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      commentsDisabled: post.settings?.commentsDisabled || false,
      hideLikes: post.settings?.hideLikes || false,
      linkButton: post.settings?.linkButton || null,
      linkedProducts: linkedProductsByPost.get(post.id) || [],
      collaborators: collaboratorsByPost.get(post.id) || [],
      user: {
        id: post.user.id,
        username: post.user.username,
        firstName: post.user.firstName,
        lastName: post.user.lastName,
        image: post.user.image,
        isEmailVerified: post.user.isEmailVerified,
        isBritesidePlus: post.user.isBritesidePlus,
        bio: post.user.socialProfile?.bio,
        isPublic: post.user.socialProfile?.isPublic,
        coverImages: post.user.socialProfile?.coverImages || [],
        hasStory: storyStatusMap.get(post.userId) || false,
      },
      isLiked: post.likes.length > 0,
      isSaved: post.saves.length > 0,
      isReposted: post.reposts ? post.reposts.length > 0 : false,
      repostsCount: post.repostsCount,
      isFollowing: post.isFollowing,
      isRequested: requestedSet.has(post.userId),
      tags: post.tags,
      visibility: post.visibility,
      moderationStatus: post.moderationStatus ?? 'approved',
    }));

    const exploreFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(shapedPosts, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled: exploreFilterEnabled,
    });

    if (stories.length === 0) {
      return {
        posts: shapedPosts,
        pagination: { page, limit, hasMore, nextCursor, total: null },
      };
    }

    const STORY_INTERVAL = 3;
    const storyStartIdx = Math.floor(offset / STORY_INTERVAL);
    let storyIdx = storyStartIdx;
    const feed = [];
    for (let i = 0; i < shapedPosts.length; i++) {
      feed.push(shapedPosts[i]);
      if ((i + 1) % STORY_INTERVAL === 0 && storyIdx < stories.length) {
        feed.push({ isStory: true, ...stories[storyIdx++] });
      }
    }

    return {
      posts: feed,
      pagination: { page, limit, hasMore, nextCursor, total: null },
    };
  }
  /**
   * Get personalized feed based on user interests AND following
   * Priority: Following + Interests > Following > Interests > All Other Posts
   * @param {string} userId - The user's ID
   * @param {object} options - Query options
   * @param {string} categoryId - Optional category filter
   */
  static async getPersonalizedFeed(userId, options = {}, categoryId) {
    const { page = 1, limit = 20 } = options;

    const [followingUsers, userInterestData, blockedUsers, viewerCollabPosts] = await Promise.all([
      db.query.userFollows.findMany({
        where: eq(userFollows.followerId, userId),
        columns: { followingId: true },
      }),
      db.query.userInterests.findMany({
        where: eq(userInterests.userId, userId),
        with: { category: true },
      }),
      db.query.userBlocks.findMany({
        where: or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)),
        columns: { blockerId: true, blockedId: true },
      }),
      db.query.postCollaborators.findMany({
        where: and(
          eq(postCollaborators.collaboratorId, userId),
          eq(postCollaborators.status, 'accepted')
        ),
        columns: { postId: true },
      }),
    ]);

    const followingIds = new Set(followingUsers.map(f => f.followingId));
    const interestMap = new Map(userInterestData.map(ui => [ui.categoryId, ui.intensity]));
    const blockedIds = blockedUsers.map(b => (b.blockerId === userId ? b.blockedId : b.blockerId));

    const viewerCollabPostIds = viewerCollabPosts.map(c => c.postId);
    const viewerIsCollabCondition =
      viewerCollabPostIds.length > 0 ? inArray(posts.id, viewerCollabPostIds) : sql`false`;

    const whereConditions = [
      eq(posts.isArchived, false),
      eq(posts.status, 'published'),
      ne(posts.source, 'import'),
      // isNull(posts.wallPostId),
      isNull(posts.deletedAt),
      or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date())),
      sql`(
  ${posts.wallPostId} IS NULL OR EXISTS (
    SELECT 1 FROM social_wall_posts swp
    JOIN social_profiles sp ON sp.id = swp.profile_id
    WHERE swp.id = ${posts.wallPostId}
    AND swp.author_id = sp.user_id
  )
)`,
      postsModerationGate(userId),
    ];

    // Add visibility filtering for personalized feed — a followers-only
    // post is also let through when someone I follow reposted it, so the
    // repost-aware scoring below actually gets a chance to surface it (the
    // reposter already had legitimate access, and choosing to repost
    // extends it to their own followers).
    whereConditions.push(
      sql`(
        ${posts.visibility} = 'public' OR
        (${posts.visibility} = 'followers' AND ${posts.userId} IN (
          SELECT following_id FROM user_follows WHERE follower_id = ${userId}
        )) OR
        ${posts.userId} = ${userId} OR
        ${viewerIsCollabCondition} OR
        EXISTS (
          SELECT 1 FROM post_collaborators pc_vis
          WHERE pc_vis.post_id = ${posts.id}
            AND pc_vis.status = 'accepted'
            AND pc_vis.collaborator_id IN (
              SELECT following_id FROM user_follows WHERE follower_id = ${userId}
            )
        ) OR
        EXISTS (
          SELECT 1 FROM post_reposts pr_vis
          WHERE pr_vis.post_id = ${posts.id}
            AND pr_vis.user_id IN (
              SELECT following_id FROM user_follows WHERE follower_id = ${userId}
            )
        )
      )`
    );

    whereConditions.push(
      or(viewerIsCollabCondition, ProfileService.viewerVisibilityCondition(userId))
    );

    if (blockedIds.length > 0) {
      whereConditions.push(not(inArray(posts.userId, blockedIds)));
    }

    whereConditions.push(
      sql`NOT EXISTS (
    SELECT 1 FROM user_hidden_posts uhp
    WHERE uhp.post_id = ${posts.id}
      AND uhp.user_id = ${userId}
  )`
    );

    if (categoryId !== undefined) {
      whereConditions.push(
        sql`EXISTS (
          SELECT 1 FROM post_tags pt
          WHERE pt.post_id = ${posts.id}
            AND pt.category_id = ${categoryId}
        )`
      );
    }
    // Fetch a generous pool — enough to score and paginate properly
    // 500 is a safe ceiling; tune based on your traffic/DB size
    const POOL_SIZE = 500;

    const feedPosts = await db.query.posts.findMany({
      where: and(...whereConditions),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
          with: {
            socialProfile: {
              columns: { bio: true, isPublic: true, coverImages: true },
            },
          },
        },
        likes: { where: eq(postLikes.userId, userId), columns: { id: true } },
        saves: { where: eq(savedPosts.userId, userId), columns: { id: true } },
        reposts: { where: eq(postReposts.userId, userId), columns: { id: true } },
        tags: { with: { category: true } },
      },
      orderBy: desc(posts.createdAt),
      limit: POOL_SIZE,
    });

    const feedPostIds = feedPosts.map(p => p.id);
    const poolCollabRows = feedPostIds.length
      ? await db.query.postCollaborators.findMany({
          where: and(
            inArray(postCollaborators.postId, feedPostIds),
            eq(postCollaborators.status, 'accepted')
          ),
          columns: { postId: true, collaboratorId: true },
        })
      : [];
    const collabIdsByPost = new Map();
    for (const row of poolCollabRows) {
      if (!collabIdsByPost.has(row.postId)) collabIdsByPost.set(row.postId, []);
      collabIdsByPost.get(row.postId).push(row.collaboratorId);
    }

    // Who among the people I follow reposted each pooled post — used both
    // for "reposted by" attribution and to treat a fresh repost like a
    // fresh post (bumped by repostedAt instead of buried at its original
    // createdAt), so reposting something old actually resurfaces it.
    const followingIdsArrayForReposts = [...followingIds];
    const poolRepostRows =
      feedPostIds.length && followingIdsArrayForReposts.length
        ? await db.query.postReposts.findMany({
            where: and(
              inArray(postReposts.postId, feedPostIds),
              inArray(postReposts.userId, followingIdsArrayForReposts)
            ),
            orderBy: desc(postReposts.createdAt),
            with: {
              user: {
                columns: { id: true, username: true, firstName: true, lastName: true, image: true },
              },
            },
          })
        : [];
    const repostedByPost = new Map();
    for (const r of poolRepostRows) {
      if (!repostedByPost.has(r.postId)) {
        repostedByPost.set(r.postId, {
          id: r.user.id,
          username: r.user.username,
          firstName: r.user.firstName,
          lastName: r.user.lastName,
          image: r.user.image,
          repostedAt: r.createdAt,
        });
      }
    }

    const now = Date.now();
    // Score every post
    const scoredPosts = feedPosts.map(post => {
      const collabIds = collabIdsByPost.get(post.id) || [];
      const repostInfo = repostedByPost.get(post.id) ?? null;
      const isFollowing =
        followingIds.has(post.userId) ||
        collabIds.some(id => followingIds.has(id)) ||
        !!repostInfo;

      const isViewerCollab = collabIds.includes(userId);

      // A repost from someone I follow should resurface like a fresh post —
      // sort/age by when it was reposted, not its original createdAt, or an
      // old post a friend just reposted would stay buried at its old spot.
      const effectiveTimestamp = repostInfo?.repostedAt ?? post.createdAt;

      let interestScore = 0;
      let hasInterestMatch = false;

      if (interestMap.size > 0) {
        for (const tag of post.tags) {
          const intensity = interestMap.get(tag.categoryId);
          if (intensity) {
            hasInterestMatch = true;
            interestScore += (intensity / 100) * (tag.confidence / 100);
          }
        }
      }

      const ageHours = (now - new Date(effectiveTimestamp).getTime()) / 3_600_000;
      const engagementScore =
        (post.likesCount + post.commentsCount * 2 + post.sharesCount * 3 + post.repostsCount * 2) /
        Math.max(ageHours, 1);

      let priorityTier, finalScore;

      if ((isFollowing || isViewerCollab) && hasInterestMatch) {
        priorityTier = 1;
        finalScore = 1_000_000 + interestScore * 0.7 + engagementScore * 0.3;
      } else if (isFollowing || isViewerCollab) {
        priorityTier = 2;
        finalScore = 100_000 + engagementScore;
      } else if (hasInterestMatch) {
        priorityTier = 3;
        finalScore = 10_000 + interestScore * 0.7 + engagementScore * 0.3;
      } else {
        priorityTier = 4;
        finalScore = engagementScore;
      }

      return {
        post,
        priorityTier,
        finalScore,
        isFollowing: isFollowing || isViewerCollab,
        effectiveTimestamp,
        // Only attach attribution when the post isn't already mine/from
        // someone I directly follow — matches getFeed's convention of only
        // showing "reposted by" when the repost is the reason it's here.
        repostedBy: followingIds.has(post.userId) || post.userId === userId ? null : repostInfo,
      };
    });
    // Sort across the full pool, then paginate
    // scoredPosts.sort((a, b) =>
    //   a.priorityTier !== b.priorityTier
    //     ? a.priorityTier - b.priorityTier
    //     : b.finalScore - a.finalScore
    // );
    scoredPosts.sort(
      (a, b) => new Date(b.effectiveTimestamp).getTime() - new Date(a.effectiveTimestamp).getTime()
    );

    const start = (page - 1) * limit;
    const pageItems = scoredPosts.slice(start, start + limit);
    const hasMore = scoredPosts.length > start + limit;

    // Build isRequested set for post authors
    const authorIds = [...new Set(pageItems.map(({ post }) => post.userId))];
    const pendingRequests = authorIds.length
      ? await db
          .select({ targetId: userFollowRequests.targetId })
          .from(userFollowRequests)
          .where(
            and(
              eq(userFollowRequests.requesterId, userId),
              eq(userFollowRequests.status, 'pending'),
              inArray(userFollowRequests.targetId, authorIds)
            )
          )
      : [];
    const requestedSet = new Set(pendingRequests.map(r => r.targetId));

    await attachPostModerationStatuses(pageItems.map(({ post }) => post));

    const uniqueUserIds = [...new Set(pageItems.map(({ post }) => post.userId))];
    const userStoryStatus = await Promise.all(
      uniqueUserIds.map(async userId => ({
        userId,
        hasStory: await StoryService.hasActiveStory(userId),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );
    const postIds = pageItems.map(({ post }) => post.id);
    const collabRows = postIds.length
      ? await db.query.postCollaborators.findMany({
          where: and(
            inArray(postCollaborators.postId, postIds),
            eq(postCollaborators.status, 'accepted')
          ),
          with: {
            collaborator: {
              columns: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                image: true,
                isEmailVerified: true,
                isBritesidePlus: true,
              },
            },
          },
        })
      : [];
    const collaboratorsByPost = new Map();
    for (const row of collabRows) {
      if (!collaboratorsByPost.has(row.postId)) collaboratorsByPost.set(row.postId, []);
      collaboratorsByPost.get(row.postId).push(row.collaborator);
    }

    const linkedProductsByPost = await PostService._linkedProductsByPost(
      pageItems.map(({ post }) => post.id)
    );

    const shapedPosts = pageItems.map(({ post, isFollowing, repostedBy }) => ({
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      mediaUrls: post.mediaUrls ?? [],
      mediaTypes: post.mediaTypes ?? [],
      aspectRatios: post.aspectRatios ?? [],
      location: post.location,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      repostsCount: post.repostsCount,
      isArchived: post.isArchived,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      tags: post.tags?.map(t => t.category.name) ?? [],
      visibility: post.visibility,
      repostedBy,
      commentsDisabled: post.settings?.commentsDisabled || false,
      hideLikes: post.settings?.hideLikes || false,
      linkButton: post.settings?.linkButton || null,
      linkedProducts: linkedProductsByPost.get(post.id) || [],
      collaborators: collaboratorsByPost.get(post.id) || [],
      user: {
        id: post.user.id,
        username: post.user.username,
        firstName: post.user.firstName,
        lastName: post.user.lastName,
        image: post.user.image,
        bio: post.user.socialProfile?.bio ?? null,
        isPublic: post.user.socialProfile?.isPublic ?? true,
        coverImages: post.user.socialProfile?.coverImages ?? [],
        hasStory: storyStatusMap.get(post.userId) || false,
        isEmailVerified: post.user.isEmailVerified,
        isBritesidePlus: post.user.isBritesidePlus,
      },
      isLiked: post.likes.length > 0,
      isSaved: post.saves.length > 0,
      isReposted: post.reposts.length > 0,
      isFollowing,
      isRequested: requestedSet.has(post.userId),
      isStatusPost: post.isStatusPost || false,
      isCoverPost: post.isCoverPost || false,
      moderationStatus: post.moderationStatus ?? 'approved',
    }));

    const personalizedFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(shapedPosts, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled: personalizedFilterEnabled,
    });

    return {
      posts: shapedPosts,
      pagination: { page, limit, hasMore, total: scoredPosts.length },
    };
  }
}
