import { db } from '../../db/index.js';
import {
  userFollows,
  userBlocks,
  users,
  stories,
  storyViews,
  storyLikes,
  storyComments,
  storyCommentLikes,
  storyShares,
  storyPolls,
  storyPollResponses,
  mentions,
} from '../../db/schema/index.js';
import { storyCollections, storyCollectionItems } from '../../db/schema/storyCollections.js';
import { eq, and, asc, desc, sql, inArray, gte, isNull, ne } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';
import {
  MediaModerationService,
  MEDIA_ENTITY,
  storiesModerationGate,
  storiesModerationGateStrict,
  attachStoryModerationStatuses,
} from '../moderation/mediaModeration.service.js';
import FileManagementService from '../fileManagement.service.js';
import { BlockService } from './block.service.js';
import { computePollAnalytics } from './storyPoll.service.js';
import { createNotification } from '../notification.service.js';

/**
 * Decorate a story with ALL its polls shaped for the given viewer.
 *
 * story.polls is now an array (one-to-many after schema fix).
 * Each poll has meta.stickerId so the frontend matches sticker → poll
 * by sticker.id === poll.meta.stickerId inside StickerWidget.resolvePollData.
 *
 * Returns: { ...story, polls: StoryPollData[] }
 */
function decorateStoryWithPolls(story, viewerId) {
  const rawPolls = story.polls ?? []; // array after relation fix
  const isCreator = story.userId === viewerId;

  const decoratedPolls = rawPolls.map(poll => {
    const responses = poll.responses ?? [];
    const myResponse = responses.find(r => r.userId === viewerId) ?? null;

    // Hide quiz answer from viewer who hasn't responded yet
    let meta = poll.meta ? { ...poll.meta } : null;
    if (poll.type === 'quiz' && meta && !isCreator && !myResponse) {
      const { correctOption, explanation, ...safeMeta } = meta; // eslint-disable-line no-unused-vars
      meta = safeMeta;
    }

    const pollPayload = {
      id: poll.id,
      type: poll.type,
      question: poll.question,
      meta, // includes stickerId → frontend uses this to match sticker → poll
      createdAt: poll.createdAt,
      updatedAt: poll.updatedAt,
      myResponse: myResponse
        ? {
            response: myResponse.response,
            isCorrect: myResponse.isCorrect,
            createdAt: myResponse.createdAt,
          }
        : null,
    };

    // Creator sees analytics for every poll
    if (isCreator) {
      pollPayload.analytics = computePollAnalytics(poll.type, poll.meta, responses);
    }

    return pollPayload;
  });

  const { polls: _polls, ...storyWithout } = story;
  return { ...storyWithout, polls: decoratedPolls };
}

export class StoryService {
  static async isStoryFavourited(storyId, userId) {
    const row = await db
      .select({ id: storyCollectionItems.id })
      .from(storyCollectionItems)
      .innerJoin(storyCollections, eq(storyCollections.id, storyCollectionItems.collectionId))
      .where(
        and(
          eq(storyCollections.userId, userId),
          eq(storyCollectionItems.storyId, storyId),
          eq(storyCollectionItems.itemType, 'story')
        )
      )
      .limit(1);
    return row.length > 0;
  }
  static async createStory(
    userId,
    {
      mediaUrl,
      mediaType,
      caption,
      meta,
      visibility,
      commentsDisabled,
      hideViewCount,
      mentionedUserIds,
    }
  ) {
    const VALID_VISIBILITY = ['public', 'followers'];
    const resolvedVisibility = VALID_VISIBILITY.includes(visibility) ? visibility : 'followers';

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const captionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.STORY,
      entityCreatorId: userId,
      texts: [caption],
    });

    const [story] = await db
      .insert(stories)
      .values({
        userId,
        mediaUrl,
        mediaType,
        caption,
        meta: meta ?? null,
        visibility: resolvedVisibility,
        commentsDisabled: commentsDisabled ?? false,
        hideViewCount: hideViewCount ?? false,
        expiresAt,
      })
      .returning();

    await MediaModerationService.adoptMediaVerdicts({
      entityType: MEDIA_ENTITY.STORY,
      entityId: story.id,
      userId,
      imageUrls: mediaType === 'video' ? [] : [mediaUrl],
      videoUrls: mediaType === 'video' ? [mediaUrl] : [],
    });

    await TextModerationService.recordIfFlagged(captionModeration, {
      entityType: TEXT_ENTITY.STORY,
      entityId: story.id,
      userId,
      fieldNames: ['caption'],
      texts: [caption],
    });

    // ── Mentions ────────────────────────────────────────────────────────────
    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const mentionedUsers = await db.query.users.findMany({
        where: inArray(users.id, mentionedUserIds),
        columns: { id: true, username: true, allowTagging: true },
      });
      const allowedUserIds = mentionedUsers.filter(u => u.allowTagging !== false).map(u => u.id);

      if (allowedUserIds.length > 0) {
        await db.insert(mentions).values(
          allowedUserIds.map(mentionedUserId => ({
            sourceType: 'story',
            sourceId: story.id,
            mentionedUserId,
            mentionedByUserId: userId,
          }))
        );
        const mentionUser = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        for (const mentionedUserId of allowedUserIds) {
          if (mentionedUserId !== userId) {
            await createNotification({
              userId: mentionedUserId,
              title: 'You were mentioned',
              message: `${mentionUser?.username || 'Someone'} mentioned you in a your stroy`,
              type: 'social_update',
              relatedId: story.id,
              redirectTo: `/feed/story/${story.id}`,
              metadata: { storyId: story.id, mentionedByUserId: userId },
            });
          }
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    return story;
  }

  /**
   * Get stories for the feed.
   *
   * KEY CHANGE: `polls: { with: { responses: true } }` (was `poll: ...` singular)
   * Now returns ALL poll stickers for each story so the frontend can render
   * and accept responses for every poll sticker independently.
   */
  static async getStories(userId, viewerId, isTrending) {
    const now = new Date();

    const followingRows = await db.query.userFollows.findMany({
      where: eq(userFollows.followerId, viewerId),
    });
    const followingIds = followingRows.map(f => f.followingId);

    const blockedRows = await db
      .select({ userId: userBlocks.blockedId })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, viewerId));
    const blockerRows = await db
      .select({ userId: userBlocks.blockerId })
      .from(userBlocks)
      .where(eq(userBlocks.blockedId, viewerId));
    const blockedIds = new Set([
      ...blockedRows.map(r => r.userId),
      ...blockerRows.map(r => r.userId),
    ]);

    const setAIds = [...followingIds, viewerId];

    // Fetch story IDs the viewer has saved to any collection (one query, O(1) lookup later)
    const collectionItems = await db
      .select({ storyId: storyCollectionItems.storyId })
      .from(storyCollectionItems)
      .innerJoin(storyCollections, eq(storyCollections.id, storyCollectionItems.collectionId))
      .where(
        and(eq(storyCollections.userId, viewerId), eq(storyCollectionItems.itemType, 'story'))
      );
    const collectionStoryIds = new Set(collectionItems.map(i => i.storyId).filter(Boolean));

    // Shared query fragment — fetch ALL polls for each story (one-to-many)
    const withPolls = {
      with: { responses: true },
    };

    const safeUserWith = {
      columns: { id: true, username: true, firstName: true, lastName: true, image: true },
      with: { socialProfile: { columns: { bio: true, isPublic: true, coverMedia: true } } },
    };

    const setAStories =
      setAIds.length > 0
        ? await db.query.stories.findMany({
            where: and(
              inArray(stories.userId, setAIds),
              gte(stories.expiresAt, now),
              storiesModerationGate(viewerId)
            ),
            with: {
              user: safeUserWith,
              views: { where: eq(storyViews.userId, viewerId) },
              likes: { where: eq(storyLikes.userId, viewerId) },
              polls: withPolls,
            },
            orderBy: desc(stories.createdAt),
          })
        : [];

    const setAUserIds = new Set(setAIds);

    const setBStories = await db.query.stories.findMany({
      where: and(
        eq(stories.visibility, 'public'),
        gte(stories.expiresAt, now),
        ne(stories.userId, viewerId),
        storiesModerationGate(viewerId)
      ),
      with: {
        user: safeUserWith,
        views: { where: eq(storyViews.userId, viewerId) },
        likes: { where: eq(storyLikes.userId, viewerId) },
        polls: withPolls,
      },
      orderBy: desc(isTrending ? stories.viewsCount : stories.createdAt),
    });

    await attachStoryModerationStatuses(setAStories);
    await attachStoryModerationStatuses(setBStories);

    const storiesFilterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    const allStories = [...setAStories, ...setBStories];
    await TextModerationService.maskFlaggedText(allStories, {
      entityType: TEXT_ENTITY.STORY,
      fields: ['caption'],
      filterEnabled: storiesFilterEnabled,
    });
    await TextModerationService.maskFlaggedText(
      allStories.flatMap(s => s.polls ?? []),
      { entityType: TEXT_ENTITY.STORY, fields: ['question'], filterEnabled: storiesFilterEnabled }
    );

    const groupByUser = (storyList, isFollowerSet, savedIds) => {
      const grouped = {};
      for (const story of storyList) {
        if (blockedIds.has(story.userId)) continue;
        if (!isFollowerSet && setAUserIds.has(story.userId)) continue;

        if (!grouped[story.userId]) {
          grouped[story.userId] = {
            user: story.user,
            stories: [],
            hasUnviewed: false,
            isFollowing: isFollowerSet,
            latestCreatedAt: story.createdAt,
          };
        }

        const isViewed = story.views.length > 0;
        const isLiked = story.likes.length > 0;

        const decorated = decorateStoryWithPolls(story, viewerId);

        grouped[story.userId].stories.push({
          ...decorated,
          isViewed,
          isLiked,
          isInCollection: savedIds.has(story.id),
          views: undefined,
          likes: undefined,
        });

        if (!isViewed) grouped[story.userId].hasUnviewed = true;
        if (story.createdAt > grouped[story.userId].latestCreatedAt) {
          grouped[story.userId].latestCreatedAt = story.createdAt;
        }
      }

      return Object.values(grouped).sort((a, b) => {
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
        return b.latestCreatedAt - a.latestCreatedAt;
      });
    };

    const followerGroups = groupByUser(setAStories, true, collectionStoryIds);
    const publicGroups = groupByUser(setBStories, false, collectionStoryIds);
    return [...followerGroups, ...publicGroups];
  }

  static async hasActiveStory(userId) {
    const now = new Date();
    const row = await db.query.stories.findFirst({
      // Exclude held (removed/pending/etc.) stories — they aren't viewable, so
      // they must not light the story ring (clicking would open an empty viewer).
      where: and(
        eq(stories.userId, userId),
        gte(stories.expiresAt, now),
        storiesModerationGateStrict()
      ),
      columns: { id: true },
    });
    return !!row;
  }

 static async getMyStories(userId) {
  const rows = await db.query.stories.findMany({
    where: eq(stories.userId, userId),
    with: {
      views: { with: { user: true } },
      polls: { with: { responses: true } },
    },
    orderBy: desc(stories.createdAt),
  });

    const myStoriesFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(rows, {
      entityType: TEXT_ENTITY.STORY,
      fields: ['caption'],
      filterEnabled: myStoriesFilterEnabled,
    });
    await TextModerationService.maskFlaggedText(
      rows.flatMap(s => s.polls ?? []),
      { entityType: TEXT_ENTITY.STORY, fields: ['question'], filterEnabled: myStoriesFilterEnabled }
    );

    return rows.map(story => decorateStoryWithPolls(story, userId));
  }

 static async viewStory(storyId, userId) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');
    if (
      story.expiresAt < new Date() &&
      story.userId !== userId &&
      !(await StoryService.isStoryFavourited(story.id, story.userId))
    )
      throw new ApiError(410, 'Story has expired');

    const isBlocked = await BlockService.isBlocked(userId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot view this story');

    const existing = await db.query.storyViews.findFirst({
      where: and(eq(storyViews.storyId, storyId), eq(storyViews.userId, userId)),
    });

    if (!existing) {
      await db.insert(storyViews).values({ storyId, userId });
      await db
        .update(stories)
        .set({ viewsCount: sql`${stories.viewsCount} + 1` })
        .where(eq(stories.id, storyId));
    }

    const updated = await db.query.stories.findFirst({
      where: eq(stories.id, storyId),
      columns: { viewsCount: true },
    });

    return { success: true, viewsCount: updated?.viewsCount ?? story.viewsCount };
  }
  static async deleteStory(storyId, userId) {
    const storyData = await db.query.stories.findFirst({
      where: and(eq(stories.id, storyId), eq(stories.userId, userId)),
    });
    if (!storyData) throw new ApiError(404, 'Story not found or unauthorized');

    try {
      if (storyData.mediaUrl) {
        const file = await FileManagementService.findByUrlOrKey(storyData.mediaUrl);
        if (file) await FileManagementService.decrementReference(file.id);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up story media:', cleanupError);
    }

    const deleted = await db
      .delete(stories)
      .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
      .returning();

    if (deleted.length === 0) throw new ApiError(404, 'Story not found or unauthorized');
    return { success: true };
  }

  static async toggleLikeStory(storyId, userId) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');
    if (
      story.expiresAt < new Date() &&
      story.userId !== userId &&
      !(await StoryService.isStoryFavourited(story.id, story.userId))
    )
      throw new ApiError(410, 'Story has expired');

    const isBlocked = await BlockService.isBlocked(userId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot interact with this story');

    const existing = await db.query.storyLikes.findFirst({
      where: and(eq(storyLikes.storyId, storyId), eq(storyLikes.userId, userId)),
    });

    if (existing) {
      await db
        .delete(storyLikes)
        .where(and(eq(storyLikes.storyId, storyId), eq(storyLikes.userId, userId)));
      await db
        .update(stories)
        .set({ likesCount: sql`GREATEST(${stories.likesCount} - 1, 0)` })
        .where(eq(stories.id, storyId));
      return { liked: false };
    }

    const [like] = await db.insert(storyLikes).values({ storyId, userId }).returning();
    await db
      .update(stories)
      .set({ likesCount: sql`${stories.likesCount} + 1` })
      .where(eq(stories.id, storyId));
    return { liked: true, like };
  }

  static async getStoryLikes(storyId, viewerId, page = 1, limit = 20) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');

    const isBlocked = await BlockService.isBlocked(viewerId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot access this story');

    const offset = (page - 1) * limit;
    const rows = await db.query.storyLikes.findMany({
      where: eq(storyLikes.storyId, storyId),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          with: { socialProfile: { columns: { bio: true, isPublic: true } } },
        },
      },
      orderBy: desc(storyLikes.createdAt),
      limit: limit + 1,
      offset,
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      likes: data.map(r => ({ ...r.user, likedAt: r.createdAt })),
      pagination: { page, limit, hasMore },
    };
  }
static async addStoryComment(storyId, userId, content, parentId = null, mentionedUserIds = []) {
    const resolvedParentId = parentId || null;

    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');
    if (
      story.expiresAt < new Date() &&
      story.userId !== userId &&
      !(await StoryService.isStoryFavourited(story.id, story.userId))
    )
      throw new ApiError(410, 'Story has expired');

    const isBlocked = await BlockService.isBlocked(userId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot comment on this story');
    if (story.commentsDisabled && story.userId !== userId) {
      throw new ApiError(403, 'Comments are disabled for this story');
    }

    if (resolvedParentId) {
      const parent = await db.query.storyComments.findFirst({
        where: and(eq(storyComments.id, resolvedParentId), eq(storyComments.storyId, storyId)),
      });
      if (!parent) throw new ApiError(404, 'Parent comment not found');
      if (parent.parentId !== null)
        throw new ApiError(400, 'Cannot reply to a reply — only 1-level threading allowed');
    }

    const commentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.COMMENT,
      entityCreatorId: userId,
      texts: [content],
    });

    const [comment] = await db
      .insert(storyComments)
      .values({ storyId, userId, content, parentId: resolvedParentId })
      .returning();

    await TextModerationService.recordIfFlagged(commentModeration, {
      entityType: TEXT_ENTITY.COMMENT,
      entityId: comment.id,
      userId,
      fieldNames: ['content'],
      texts: [content],
    });

    if (resolvedParentId) {
      await db
        .update(storyComments)
        .set({ repliesCount: sql`${storyComments.repliesCount} + 1` })
        .where(eq(storyComments.id, resolvedParentId));
    }

    await db
      .update(stories)
      .set({ commentsCount: sql`${stories.commentsCount} + 1` })
      .where(eq(stories.id, storyId));

    // ── Mentions ────────────────────────────────────────────────────────────
    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const mentionRows = mentionedUserIds.map(mentionedUserId => ({
        sourceType: 'story_comment',
        sourceId: comment.id,
        mentionedUserId,
        mentionedByUserId: userId,
      }));
      await db.insert(mentions).values(mentionRows);

      const commenter = await db.query.users.findFirst({ where: eq(users.id, userId) });
      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== userId) {
          try {
            await createNotification({
              userId: mentionedUserId,
              title: 'You were mentioned',
              message: `${commenter?.username || 'Someone'} mentioned you in a comment`,
              type: 'social_update',
              relatedId: comment.id,
              redirectTo: `/feed/story/${storyId}`,
              metadata: { storyId, commentId: comment.id, mentionedByUserId: userId },
            });
          } catch (err) {
            console.warn('Failed to create story-comment mention notification', err);
          }
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    return await db.query.storyComments.findFirst({
      where: eq(storyComments.id, comment.id),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
    });
  }

  static async updateStoryComment(storyId, commentId, userId, content, mentionedUserIds = []) {
    const comment = await db.query.storyComments.findFirst({
      where: and(eq(storyComments.id, commentId), eq(storyComments.storyId, storyId)),
    });
    if (!comment) throw new ApiError(404, 'Comment not found');
    if (comment.userId !== userId) throw new ApiError(403, 'Not authorized to edit this comment');

    const commentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.COMMENT,
      entityId: commentId,
      entityCreatorId: userId,
      texts: [content],
    });

    const [updated] = await db
      .update(storyComments)
      .set({ content, updatedAt: new Date() })
      .where(eq(storyComments.id, commentId))
      .returning();

    await TextModerationService.recordIfFlagged(commentModeration, {
      entityType: TEXT_ENTITY.COMMENT,
      entityId: commentId,
      userId,
      fieldNames: ['content'],
      texts: [content],
    });

    // Replace mentions to match edited content
    await db
      .delete(mentions)
      .where(and(eq(mentions.sourceType, 'story_comment'), eq(mentions.sourceId, commentId)));

    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      await db.insert(mentions).values(
        mentionedUserIds.map(mentionedUserId => ({
          sourceType: 'story_comment',
          sourceId: commentId,
          mentionedUserId,
          mentionedByUserId: userId,
        }))
      );

      const commenter = await db.query.users.findFirst({ where: eq(users.id, userId) });
      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== userId) {
          try {
            await createNotification({
              userId: mentionedUserId,
              title: 'You were mentioned',
              message: `${commenter?.username || 'Someone'} mentioned you in a comment`,
              type: 'social_update',
              relatedId: commentId,
              redirectTo: `/feed/story/${storyId}`,
              metadata: { storyId, commentId, mentionedByUserId: userId },
            });
          } catch (err) {
            console.warn('Failed to create story-comment mention notification on edit', err);
          }
        }
      }
    }

    return await db.query.storyComments.findFirst({
      where: eq(storyComments.id, updated.id),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
    });
  }
  static async getStoryComments(storyId, viewerId, page = 1, limit = 20) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');

    const isBlocked = await BlockService.isBlocked(viewerId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot access this story');

    if (story.commentsDisabled && story.userId !== viewerId) {
      throw new ApiError(403, 'Comments are disabled for this story');
    }

    const offset = (page - 1) * limit;
    const topLevel = await db.query.storyComments.findMany({
      where: and(eq(storyComments.storyId, storyId), isNull(storyComments.parentId)),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
        likes: { where: eq(storyCommentLikes.userId, viewerId), columns: { id: true } },
        replies: {
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            },
            likes: { where: eq(storyCommentLikes.userId, viewerId), columns: { id: true } },
          },
          // Replies read oldest → newest so the thread stays chronological
          orderBy: asc(storyComments.createdAt),
          limit: 3,
        },
      },
      orderBy: desc(storyComments.createdAt),
      limit: limit + 1,
      offset,
    });

    const hasMore = topLevel.length > limit;
    const data = hasMore ? topLevel.slice(0, limit) : topLevel;

    // ── Batch fetch mentions for all top-level + reply comments ──────────────
    const allCommentIds = [];
    for (const c of data) {
      allCommentIds.push(c.id);
      for (const r of c.replies ?? []) allCommentIds.push(r.id);
    }

    let mentionsByComment = {};
    if (allCommentIds.length > 0) {
      const mentionRows = await db
        .select({
          sourceId: mentions.sourceId,
          mentionedUserId: mentions.mentionedUserId,
          mentionedUsername: users.username,
          mentionedName: users.name,
        })
        .from(mentions)
        .leftJoin(users, eq(users.id, mentions.mentionedUserId))
        .where(
          and(eq(mentions.sourceType, 'story_comment'), inArray(mentions.sourceId, allCommentIds))
        );

      for (const m of mentionRows) {
        if (!mentionsByComment[m.sourceId]) mentionsByComment[m.sourceId] = [];
        mentionsByComment[m.sourceId].push({
          userId: m.mentionedUserId,
          username: m.mentionedUsername,
          name: m.mentionedName,
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const formattedComments = data.map(c => ({
      ...c,
      isLiked: c.likes.length > 0,
      mentions: mentionsByComment[c.id] || [],
      likes: undefined,
      replies: c.replies.map(r => ({
        ...r,
        isLiked: r.likes.length > 0,
        mentions: mentionsByComment[r.id] || [],
        likes: undefined,
      })),
    }));

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    await TextModerationService.maskFlaggedText(formattedComments, {
      entityType: TEXT_ENTITY.COMMENT,
      fields: ['content'],
      filterEnabled,
    });
    await TextModerationService.maskFlaggedText(
      formattedComments.flatMap(c => c.replies),
      { entityType: TEXT_ENTITY.COMMENT, fields: ['content'], filterEnabled }
    );

    return {
      comments: formattedComments,
      pagination: { page, limit, hasMore },
    };
  }

  static async deleteStoryComment(storyId, commentId, userId) {
    const comment = await db.query.storyComments.findFirst({
      where: and(eq(storyComments.id, commentId), eq(storyComments.storyId, storyId)),
    });
    if (!comment) throw new ApiError(404, 'Comment not found');

    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (comment.userId !== userId && story?.userId !== userId)
      throw new ApiError(403, 'Not authorized to delete this comment');

    await db.delete(storyComments).where(eq(storyComments.id, commentId));

    if (comment.parentId) {
      await db
        .update(storyComments)
        .set({ repliesCount: sql`GREATEST(${storyComments.repliesCount} - 1, 0)` })
        .where(eq(storyComments.id, comment.parentId));
    }

    await db
      .update(stories)
      .set({ commentsCount: sql`GREATEST(${stories.commentsCount} - 1, 0)` })
      .where(eq(stories.id, storyId));
    return { success: true };
  }

  static async toggleLikeStoryComment(commentId, userId) {
    const comment = await db.query.storyComments.findFirst({
      where: eq(storyComments.id, commentId),
    });
    if (!comment) throw new ApiError(404, 'Comment not found');

    const existing = await db.query.storyCommentLikes.findFirst({
      where: and(eq(storyCommentLikes.commentId, commentId), eq(storyCommentLikes.userId, userId)),
    });

    if (existing) {
      await db
        .delete(storyCommentLikes)
        .where(
          and(eq(storyCommentLikes.commentId, commentId), eq(storyCommentLikes.userId, userId))
        );
      await db
        .update(storyComments)
        .set({ likesCount: sql`GREATEST(${storyComments.likesCount} - 1, 0)` })
        .where(eq(storyComments.id, commentId));
      return { liked: false };
    }

    await db.insert(storyCommentLikes).values({ commentId, userId });
    await db
      .update(storyComments)
      .set({ likesCount: sql`${storyComments.likesCount} + 1` })
      .where(eq(storyComments.id, commentId));
    return { liked: true };
  }

  static async shareStory(storyId, userId, caption) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');
    if (
      story.expiresAt < new Date() &&
      story.userId !== userId &&
      !(await StoryService.isStoryFavourited(story.id, story.userId))
    )
      throw new ApiError(410, 'Story has expired');

    const isBlocked = await BlockService.isBlocked(userId, story.userId);
    if (isBlocked) throw new ApiError(403, 'Cannot share this story');

    const captionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.STORY,
      entityCreatorId: userId,
      texts: [caption],
    });

    const [share] = await db.insert(storyShares).values({ storyId, userId, caption }).returning();
    await db
      .update(stories)
      .set({ sharesCount: sql`${stories.sharesCount} + 1` })
      .where(eq(stories.id, storyId));

    await TextModerationService.recordIfFlagged(captionModeration, {
      entityType: TEXT_ENTITY.STORY,
      entityId: share.id,
      userId,
      fieldNames: ['caption'],
      texts: [caption],
    });

    return share;
  }

  /**
   * GET /social/stories/:storyId/viewers
   *
   * Returns a paginated list of viewers for a story, enriched with:
   *  - each viewer's poll responses (for all polls on this story)
   *  - view timestamp
   *
   * Only the story owner may call this endpoint.
   */
  static async getStoryViewers(storyId, requesterId, page = 1, limit = 20) {
    // 1. Verify story exists and requester is the owner
    const story = await db.query.stories.findFirst({
      where: eq(stories.id, storyId),
      columns: { id: true, userId: true },
    });

    if (!story) throw new ApiError(404, 'Story not found');
    if (story.userId !== requesterId)
      throw new ApiError(403, 'Only the story owner can view responses');

    const offset = (page - 1) * limit;

    // 2. Fetch ALL story views for this story
    const viewRows = await db.query.storyViews.findMany({
      where: eq(storyViews.storyId, storyId),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
          },
        },
      },
      orderBy: desc(storyViews.viewedAt),
    });

    // Build a map: userId → viewedAt (for users who hit the view endpoint)
    const viewedAtByUser = {};
    for (const v of viewRows) {
      viewedAtByUser[v.user.id] = { viewedAt: v.viewedAt, user: v.user };
    }

    // 3. Fetch ALL polls for this story with all responses + user info
    const pollRows = await db.query.storyPolls.findMany({
      where: eq(storyPolls.storyId, storyId),
      with: {
        responses: {
          with: {
            user: {
              columns: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                image: true,
              },
            },
          },
        },
      },
    });

    // 4. Build lookup: userId → { user, responses[], earliestRespondedAt }
    //    This captures users who responded to polls even without a storyView row
    const responderMap = {};
    for (const poll of pollRows) {
      for (const resp of poll.responses ?? []) {
        // resp.user may be null if the relation join failed — skip broken rows
        if (!resp.userId) continue;

        if (!responderMap[resp.userId]) {
          responderMap[resp.userId] = {
            // Use resp.user if available; fall back to a minimal object using userId
            user: resp.user ?? {
              id: resp.userId,
              username: resp.userId,
              firstName: null,
              lastName: null,
              image: null,
            },
            responses: [],
            earliestAt: resp.createdAt,
          };
        } else if (!responderMap[resp.userId].user?.username && resp.user) {
          // Upgrade the user object if we now have the full data
          responderMap[resp.userId].user = resp.user;
        }

        responderMap[resp.userId].responses.push({
          pollId: poll.id,
          pollType: poll.type,
          pollQuestion: poll.question,
          pollMeta: poll.meta,
          response: resp.response,
          isCorrect: resp.isCorrect,
          respondedAt: resp.createdAt,
        });
        if (resp.createdAt < responderMap[resp.userId].earliestAt) {
          responderMap[resp.userId].earliestAt = resp.createdAt;
        }
      }
    }

    // If resp.user was null for some entries, fetch their user data in one query
    const missingUserIds = Object.entries(responderMap)
      .filter(([, v]) => !v.user?.username || v.user.username === v.user.id)
      .map(([id]) => id);

    if (missingUserIds.length > 0) {
      const userRows = await db.query.users.findMany({
        where: inArray(users.id, missingUserIds),
        columns: { id: true, username: true, firstName: true, lastName: true, image: true },
      });
      for (const u of userRows) {
        if (responderMap[u.id]) responderMap[u.id].user = u;
      }
    }

    // 5. Merge: start with storyView rows, then add any poll responders not in views
    //    Result: every user who either viewed OR responded appears exactly once
    const mergedMap = {};

    // Add viewers first (they have an explicit viewedAt timestamp)
    for (const v of viewRows) {
      mergedMap[v.user.id] = {
        id: v.id,
        viewedAt: v.viewedAt,
        user: v.user,
        pollResponses: responderMap[v.user.id]?.responses ?? [],
      };
    }

    // Add poll responders who never triggered viewStory (viewedAt = their earliest response)
    for (const [userId, data] of Object.entries(responderMap)) {
      if (!mergedMap[userId]) {
        mergedMap[userId] = {
          id: `poll-only-${userId}`, // synthetic id since no storyView row
          viewedAt: data.earliestAt, // use earliest poll response as proxy
          user: data.user,
          pollResponses: data.responses,
        };
      }
    }

    // Sort merged list: most recent first
    const allViewers = Object.values(mergedMap).sort(
      (a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
    );

    // 6. Paginate the merged list
    const totalCount = allViewers.length;
    const pageSlice = allViewers.slice(offset, offset + limit);
    const hasMore = offset + limit < totalCount;

    // 7. Compute analytics for each poll
    const pollSummaries = pollRows.map(poll => ({
      pollId: poll.id,
      pollType: poll.type,
      pollQuestion: poll.question,
      pollMeta: poll.meta,
      analytics: computePollAnalytics(poll.type, poll.meta, poll.responses ?? []),
    }));

    return {
      viewers: pageSlice,
      pollSummaries,
      pagination: { page, limit, hasMore },
      // totalViewers = unique users who viewed OR responded (most accurate metric)
      totalViewers: totalCount,
    };
  }
}
