import { createNotification } from './notification.service.js';
import { getActorDisplayName } from '../utils/helper.js';
import { GroupDiscussionNotificationService } from './group.service.js';
import FileManagementService from './fileManagement.service.js';
import { db } from '../db/index.js';
import {
  discussions,
  discussionLikes,
  discussionReplies,
  discussionReplyLikes,
  discussionSubscriptions,
  discussionCategories,
  groups,
  groupMembers, // ← added
} from '../db/schema/groups.js';
import { categories } from '../db/schema/categories.js';
import { mentions } from '../db/schema/social.js';
import { stories } from '../db/schema/social.js';
import { users } from '../db/schema/users.js';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import {
  MediaModerationService,
  MEDIA_ENTITY,
  HELD_FROM_OTHERS,
  discussionsModerationGate,
  attachDiscussionModerationStatuses,
} from './moderation/mediaModeration.service.js';
import { and, eq, sql, desc, count, isNull, inArray, or, countDistinct } from 'drizzle-orm';

export class DiscussionService {
  /**
   * @desc Create a new discussion
   */
  static async createDiscussion(data) {
    let mediaUrls = data.mediaUrls || [];
    if (!Array.isArray(mediaUrls)) {
      mediaUrls = [mediaUrls];
    }

    if (mediaUrls.length > 10) {
      throw new ApiError(400, 'Maximum 10 media URLs allowed per discussion');
    }

    const discussionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.DISCUSSION,
      entityCreatorId: data.userId,
      texts: [data.title, data.content],
    });

    const [discussion] = await db
      .insert(discussions)
      .values({
        title: data.title,
        description: data.content || '',
        userId: data.userId,
        metadata: data.metadata || {},
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : null,
        groupId: data.groupId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await TextModerationService.recordIfFlagged(discussionModeration, {
      entityType: TEXT_ENTITY.DISCUSSION,
      entityId: discussion.id,
      userId: data.userId,
      fieldNames: ['title', 'description'],
      texts: [data.title, data.content || ''],
    });

    if (mediaUrls.length > 0) {
      const { imageUrls, videoUrls } = MediaModerationService.splitUrls(mediaUrls);
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.DISCUSSION,
        entityId: discussion.id,
        userId: data.userId,
        imageUrls,
        videoUrls,
      });
    }

    if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
      await insertDiscussionCategories(discussion.id, data.categoryIds);
    }

    if (data.groupId) {
      try {
        await GroupDiscussionNotificationService.notifyNewDiscussion(
          data.groupId,
          discussion.id,
          data.userId
        );
      } catch (error) {
        console.error('Error notifying group discussion subscribers:', error);
      }
    }

    return this.getDiscussionById(discussion.id, data.userId);
  }

  /**
   * @desc Get all discussions with optional filters (pagination, search, groupId, categoryIds)
   *       Excludes soft-deleted discussions.
   */
  static async getAllDiscussions({ page = 1, limit = 10, groupId, search, categoryIds }, userId) {
    const offset = (page - 1) * limit;

    const conditions = [];

    // ── Exclude soft-deleted ──────────────────────────────────────────────────
    conditions.push(isNull(discussions.deletedAt));
    conditions.push(discussionsModerationGate(userId));

    if (groupId) {
      conditions.push(eq(discussions.groupId, groupId));
    } else {
      conditions.push(isNull(discussions.groupId));
    }

    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        or(
          sql`${discussions.title} ILIKE ${searchTerm}`,
          sql`${discussions.description} ILIKE ${searchTerm}`
        )
      );
    }

    const baseWhere = conditions.length ? and(...conditions) : undefined;

    let mainQuery = db
      .select({
        ...discussions,
        user: {
          id: users.id,
          name: users.name,
          username: users?.username,
          profileImage: users.image,
          hasStory: sql`(
            SELECT COUNT(*) > 0 FROM stories s
            WHERE s.user_id = ${users.id}
            AND s.expires_at > NOW()
          )`,
        },
        likeCount: sql`(
          SELECT COUNT(*) FROM discussion_likes dl
          WHERE dl.discussion_id = ${discussions.id}
        )`,
        replyCount: sql`(
          SELECT COUNT(*) FROM discussion_replies dr
          WHERE dr.discussion_id = ${discussions.id}
        )`,
      })
      .from(discussions)
      .leftJoin(users, eq(users.id, discussions.userId));

    if (categoryIds?.length) {
      mainQuery = mainQuery
        .innerJoin(discussionCategories, eq(discussionCategories.discussionId, discussions.id))
        .where(
          baseWhere
            ? and(baseWhere, inArray(discussionCategories.categoryId, categoryIds))
            : inArray(discussionCategories.categoryId, categoryIds)
        )
        .groupBy(discussions.id, users.id);
    } else if (baseWhere) {
      mainQuery = mainQuery.where(baseWhere);
    }

    const orderByClause = [];
    if (userId && !groupId) {
      orderByClause.push(
        sql`CASE WHEN EXISTS (
          SELECT 1 FROM discussion_subscriptions ds
          WHERE ds.discussion_id = ${discussions.id} AND ds.user_id = ${userId}
        ) THEN 0 ELSE 1 END ASC`
      );
    }
    orderByClause.push(desc(discussions.createdAt));

    const discussionsData = await mainQuery
      .orderBy(...orderByClause)
      .limit(limit)
      .offset(offset);

    let total = 0;

    if (categoryIds?.length) {
      const countResult = await db
        .select({ count: countDistinct(discussions.id) })
        .from(discussions)
        .innerJoin(discussionCategories, eq(discussionCategories.discussionId, discussions.id))
        .where(
          baseWhere
            ? and(baseWhere, inArray(discussionCategories.categoryId, categoryIds))
            : inArray(discussionCategories.categoryId, categoryIds)
        );

      total = countResult[0]?.count ?? 0;
    } else {
      const totalResult = await db.select({ count: count() }).from(discussions).where(baseWhere);
      total = totalResult[0]?.count ?? 0;
    }

    const discussionIds = discussionsData.map(d => d.id);

    let categoriesMap = {};
    if (discussionIds.length) {
      categoriesMap = await getDiscussionCategories(discussionIds);
    }

    const likes = await this.getDiscussionLikes({ discussionId: null, userId });
    const subscriptions = await getUserDiscussionSubscriptions({ userId });

    const likedPostIds = new Set(likes.map(like => like.discussionId));
    const isSubscribedDiscussionIds = new Set(subscriptions.map(sub => sub.discussionId));

    const finalData = discussionsData.map(d => ({
      ...d,
      categories: categoriesMap[d.id] || [],
      isLiked: likedPostIds.has(d.id),
      isSubscribed: isSubscribedDiscussionIds.has(d.id),
    }));

    await attachDiscussionModerationStatuses(finalData);

    const discussionsFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(finalData, {
      entityType: TEXT_ENTITY.DISCUSSION,
      fields: ['title', 'description'],
      filterEnabled: discussionsFilterEnabled,
    });

    return {
      data: finalData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * @desc Get discussion by ID — excludes soft-deleted.
   */
  static async getDiscussionById(discussionId, userId = null) {
    const [discussion] = await db
      .select({
        ...discussions,
        user: {
          id: users.id,
          name: users.name,
          profileImage: users.image,
          hasStory: sql`(
            SELECT COUNT(*) > 0 FROM stories s
            WHERE s.user_id = ${users.id}
            AND s.expires_at > NOW()
          )`,
          latestGroupCreated: sql`(
            SELECT name FROM groups g
            WHERE g.created_by = ${users.id}
            AND g.deleted_at IS NULL
            ORDER BY g.created_at DESC
            LIMIT 1
          )`,
        },
        likeCount: sql`(
          SELECT COUNT(*) FROM discussion_likes dl WHERE dl.discussion_id = ${discussions.id}
        )`,
        replyCount: sql`(
          SELECT COUNT(*) FROM discussion_replies dr WHERE dr.discussion_id = ${discussions.id}
        )`,
      })
      .from(discussions)
      .leftJoin(users, eq(users.id, discussions.userId))
      // ── Exclude soft-deleted ──────────────────────────────────────────────
      .where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)));

    if (discussion) {
      await attachDiscussionModerationStatuses([discussion]);
      // Held content (pending/rejected/shadowed/…) is invisible to non-owners,
      // even by direct id. Owner still sees their own (with the removed/blur UI).
      if (HELD_FROM_OTHERS.has(discussion.moderationStatus) && discussion.userId !== userId) {
        return null;
      }

      const categoriesMap = await getDiscussionCategories(discussionId);
      discussion.categories = categoriesMap[discussionId] || [];
      discussion.isSubscribed = await isUserSubscribed(discussionId, userId);

      const discussionFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedTextSingle(discussion, {
        entityType: TEXT_ENTITY.DISCUSSION,
        fields: ['title', 'description'],
        filterEnabled: discussionFilterEnabled,
      });
    }

    return discussion;
  }

  /**
   * @desc Update discussion (only by creator)
   */
  static async updateDiscussion(discussionId, userId, data) {
    const existing = await db.query.discussions.findFirst({
      where: and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)),
    });

    if (!existing) throw new ApiError(404, 'Discussion not found');
    if (existing.userId !== userId)
      throw new ApiError(403, 'Unauthorized to update this discussion.');

    const { categoryIds, mediaUrls, ...discussionData } = data;

    let processedMediaUrl = undefined;
    if (mediaUrls !== undefined) {
      let mediaUrls = mediaUrls;
      if (!Array.isArray(mediaUrls)) {
        mediaUrls = [mediaUrls];
      }
      if (mediaUrls.length > 10) {
        throw new ApiError(400, 'Maximum 10 media URLs allowed per discussion');
      }
      processedMediaUrl = mediaUrls.length > 0 ? mediaUrls : null;
    }

    const updateTextEntries = [
      ['title', discussionData.title],
      ['description', discussionData.description],
      ['content', discussionData.content],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    let discussionModeration = { action: 'keep' };
    if (updateTextEntries.length > 0) {
      discussionModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.DISCUSSION,
        entityId: discussionId,
        entityCreatorId: userId,
        texts: updateTextEntries.map(([, value]) => value),
      });
    }

    const [updated] = await db
      .update(discussions)
      .set({
        ...discussionData,
        ...(processedMediaUrl !== undefined && { mediaUrls: processedMediaUrl }),
        updatedAt: new Date(),
      })
      .where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
      .returning();

    await TextModerationService.recordIfFlagged(discussionModeration, {
      entityType: TEXT_ENTITY.DISCUSSION,
      entityId: discussionId,
      userId,
      fieldNames: updateTextEntries.map(([name]) => name),
      texts: updateTextEntries.map(([, value]) => value),
    });

    if (processedMediaUrl) {
      const { imageUrls, videoUrls } = MediaModerationService.splitUrls(processedMediaUrl);
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.DISCUSSION,
        entityId: updated.id,
        userId,
        imageUrls,
        videoUrls,
      });
    }

    if (categoryIds !== undefined && Array.isArray(categoryIds)) {
      await db
        .delete(discussionCategories)
        .where(eq(discussionCategories.discussionId, discussionId));

      if (categoryIds.length > 0) {
        await insertDiscussionCategories(discussionId, categoryIds);
      }
    }

    return this.getDiscussionById(updated.id, userId);
  }

  /**
   * @desc Delete discussion.
   *
   * - Owner: hard delete (cleans up media, likes, replies — preserves existing behaviour)
   * - Group admin / moderator: soft delete (sets deletedAt, leaves data intact for audit)
   *
   * After a moderator soft-delete the post author is notified.
   */
  static async deleteDiscussion(discussionId, requesterId) {
    // ── 1. Fetch discussion — skip already-deleted rows ───────────────────
    const discussion = await db.query.discussions.findFirst({
      where: and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)),
      columns: {
        id: true,
        userId: true,
        groupId: true,
        title: true,
        mediaUrls: true,
      },
    });

    if (!discussion) throw new ApiError(404, 'Discussion not found.');

    const isOwner = discussion.userId === requesterId;

    // ── 2. Check moderator / admin role when requester is not the owner ───
    let isModerator = false;
    if (!isOwner && discussion.groupId) {
      const membership = await db.query.groupMembers.findFirst({
        where: and(
          eq(groupMembers.groupId, discussion.groupId),
          eq(groupMembers.userId, requesterId),
          eq(groupMembers.status, 'joined'),
          inArray(groupMembers.role, ['admin', 'moderator'])
        ),
        columns: { role: true },
      });
      isModerator = !!membership;
    }

    if (!isOwner && !isModerator) {
      throw new ApiError(403, 'Not authorized to delete this discussion.');
    }

    // ── 3a. OWNER → hard delete (original behaviour, full cleanup) ────────
    if (isOwner) {
      // Clean up media files
      try {
        if (discussion.mediaUrls && Array.isArray(discussion.mediaUrls)) {
          for (const url of discussion.mediaUrls) {
            const file = await FileManagementService.findByUrlOrKey(url);
            if (file) await FileManagementService.decrementReference(file.id);
          }
        }
      } catch (cleanupError) {
        console.error('Error cleaning up discussion media:', cleanupError);
      }

      // Clean up reply mentions
      const replies = await db
        .select({ id: discussionReplies.id })
        .from(discussionReplies)
        .where(eq(discussionReplies.discussionId, discussionId));
      const replyIds = replies.map(r => r.id);

      if (replyIds.length > 0) {
        await db
          .delete(mentions)
          .where(
            and(eq(mentions.sourceType, 'discussion_reply'), inArray(mentions.sourceId, replyIds))
          );
        await db
          .delete(discussionReplyLikes)
          .where(inArray(discussionReplyLikes.replyId, replyIds));
        await db.delete(discussionReplies).where(eq(discussionReplies.discussionId, discussionId));
      }

      await db.delete(discussionLikes).where(eq(discussionLikes.discussionId, discussionId));
      await db.delete(discussions).where(eq(discussions.id, discussionId));
      return;
    }

    // ── 3b. MODERATOR → soft delete ───────────────────────────────────────
    await db
      .update(discussions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(discussions.id, discussionId));

    // Notify the post author
    try {
      const group = await db.query.groups.findFirst({
        where: eq(groups.id, discussion.groupId),
        columns: { name: true, slug: true },
      });

      if (group) {
        await createNotification({
          userId: discussion.userId,
          title: 'Discussion Removed',
          message: `Your discussion "${discussion.title}" was removed by a moderator in "${group.name}".`,
          type: 'group_activity',
          relatedId: discussion.groupId,
          redirectTo: `/groups/${group.slug}`,
          metadata: { discussionId, removedBy: requesterId },
        });
      }
    } catch (notifyErr) {
      console.error('Failed to notify author of moderated discussion removal:', notifyErr);
    }
  }

  /**
   * @desc Toggle like for discussion
   */
  static async toggleLike(discussionId, userId) {
    const existing = await isDiscussionExists(discussionId, userId);

    if (existing) {
      await db
        .delete(discussionLikes)
        .where(
          and(eq(discussionLikes.discussionId, discussionId), eq(discussionLikes.userId, userId))
        );
      return { liked: false };
    } else {
      await db.insert(discussionLikes).values({ discussionId, userId }).onConflictDoNothing();

      const discussion = await db.query.discussions.findFirst({
        where: eq(discussions.id, discussionId),
      });
      const likerName = await getActorDisplayName(userId);
      if (discussion && discussion.userId !== userId) {
        await createNotification({
          userId: discussion.userId,
          title: 'Discussion Liked',
          message: `${likerName} liked your discussion.`,
          type: 'group_activity',
          relatedId: discussionId,
          redirectTo: `/discussion/${discussionId}`,
          metadata: { actorUserId: userId, likerId: userId },
        });
      }
      const replies = await db
        .select()
        .from(discussionReplies)
        .where(eq(discussionReplies.discussionId, discussionId));
      for (const reply of replies) {
        if (reply.userId !== userId) {
          await createNotification({
            userId: reply.userId,
            title: 'Your Comment Got a Like',
            message: `${likerName} liked a discussion you commented on.`,
            type: 'group_activity',
            relatedId: discussionId,
            redirectTo: `/discussion/${discussionId}`,
            metadata: { actorUserId: userId, likerId: userId },
          });
        }
      }
      return { liked: true };
    }
  }

  /**
   * @desc Get all likes for a discussion
   */
  static async getDiscussionLikes({ discussionId, userId }) {
    const conditions = [];
    if (discussionId) conditions.push(eq(discussionLikes.discussionId, discussionId));
    if (userId) conditions.push(eq(discussionLikes.userId, userId));

    const likes = await db
      .select({
        userId: discussionLikes.userId,
        userName: users.name,
        discussionId: discussionLikes.discussionId,
      })
      .from(discussionLikes)
      .leftJoin(users, eq(users.id, discussionLikes.userId))
      .where(conditions.length ? and(...conditions) : undefined);

    return likes;
  }

  /**
   * @desc Subscribe a user to a discussion
   */
  static async subscribe(discussionId, userId) {
    await db
      .insert(discussionSubscriptions)
      .values({ discussionId, userId, createdAt: new Date() })
      .onConflictDoNothing();
    return { success: true };
  }

  /**
   * @desc Unsubscribe a user from a discussion
   */
  static async unsubscribe(discussionId, userId) {
    await db
      .delete(discussionSubscriptions)
      .where(
        and(
          eq(discussionSubscriptions.discussionId, discussionId),
          eq(discussionSubscriptions.userId, userId)
        )
      );
    return { success: true };
  }

  /**
   * @desc Get subscribers for a discussion
   */
  static async getSubscribers(discussionId) {
    const rows = await db
      .select({ userId: discussionSubscriptions.userId })
      .from(discussionSubscriptions)
      .where(eq(discussionSubscriptions.discussionId, discussionId));
    return rows.map(r => r.userId);
  }

  /**
   * @desc Notify subscribers of a discussion about a new reply
   */
  static async notifySubscribers(discussion, reply, actorUserId) {
    try {
      const subs = await db
        .select({ userId: discussionSubscriptions.userId })
        .from(discussionSubscriptions)
        .where(eq(discussionSubscriptions.discussionId, discussion.id));

      const subscriberIds = [...new Set(subs.map(s => s.userId))].filter(
        id => id && id !== actorUserId && id !== discussion.userId
      );

      if (subscriberIds.length === 0) return;

      const author = await db.query.users.findFirst({ where: eq(users.id, actorUserId) });

      const notifyPromises = subscriberIds.map(id =>
        createNotification({
          userId: id,
          title: 'New reply in subscribed discussion',
          message: `${author?.username || author?.name || 'Someone'} replied to a discussion you subscribed to`,
          type: 'group_activity',
          relatedId: discussion.id,
          redirectTo: `/discussion/${discussion.id}`,
          metadata: { discussionId: discussion.id, replyId: reply.id, actorUserId },
        }).catch(err => console.warn('Failed to create subscriber notification', err))
      );

      await Promise.allSettled(notifyPromises);
    } catch (err) {
      console.warn('Failed to notify subscribers', err);
    }
  }

  /**
   * @desc Create reply for discussion (supports both top-level and nested replies via parentReplyId)
   */
  static async createReply({
    discussionId,
    userId,
    content,
    parentReplyId = null,
    mentionedUserIds = [],
  }) {
    const replyModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.DISCUSSION,
      entityCreatorId: userId,
      texts: [content],
    });

    const [reply] = await db
      .insert(discussionReplies)
      .values({
        discussionId,
        userId,
        content,
        parentReplyId,
        createdAt: new Date(),
      })
      .returning();

    await TextModerationService.recordIfFlagged(replyModeration, {
      entityType: TEXT_ENTITY.DISCUSSION,
      entityId: reply.id,
      userId,
      fieldNames: ['content'],
      texts: [content],
    });

    if (parentReplyId) {
      await db
        .update(discussionReplies)
        .set({ repliesCount: sql`${discussionReplies.repliesCount} + 1` })
        .where(eq(discussionReplies.id, parentReplyId));
    }

    if (mentionedUserIds.length > 0) {
      const mentionRows = mentionedUserIds.map(mentionedUserId => ({
        sourceType: 'discussion_reply',
        sourceId: reply.id,
        mentionedUserId,
        mentionedByUserId: userId,
      }));
      await db.insert(mentions).values(mentionRows);

      const mentioner = await db.query.users.findFirst({ where: eq(users.id, userId) });

      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== userId) {
          try {
            await createNotification({
              userId: mentionedUserId,
              title: 'You were mentioned',
              message: `${mentioner?.username || mentioner?.name || 'Someone'} mentioned you in a discussion reply`,
              type: 'group_activity',
              relatedId: discussionId,
              redirectTo: `/discussion/${discussionId}`,
              metadata: {
                discussionId,
                replyId: reply.id,
                mentionedByUserId: userId,
                mentionedByUsername: mentioner?.username,
              },
            });
          } catch (err) {
            console.warn('Failed to create mention notification', err);
          }
        }
      }
    }

    const discussion = await db.query.discussions.findFirst({
      where: eq(discussions.id, discussionId),
    });
    const replierName = await getActorDisplayName(userId);
    if (discussion && discussion.userId !== userId) {
      await createNotification({
        userId: discussion.userId,
        title: 'New Reply to Discussion',
        message: `${replierName} replied to your discussion.`,
        type: 'group_activity',
        relatedId: discussionId,
        redirectTo: `/discussion/${discussionId}`,
        metadata: { discussionId, replyId: reply.id, actorUserId: userId },
      });
    }

    if (parentReplyId) {
      const parentReply = await db.query.discussionReplies.findFirst({
        where: eq(discussionReplies.id, parentReplyId),
      });
      if (parentReply && parentReply.userId !== userId) {
        await createNotification({
          userId: parentReply.userId,
          title: 'Reply to Your Comment',
          message: `${replierName} replied to your comment in a discussion.`,
          type: 'group_activity',
          relatedId: discussionId,
          redirectTo: `/discussion/${discussionId}`,
          metadata: { discussionId, replyId: reply.id, actorUserId: userId },
        });
      }
    }

    await this.notifySubscribers(discussion, reply, userId);

    // Mask per the author's own filter setting — same as what getReplies()
    // would show them on the next fetch, so the create response doesn't
    // flash raw text that then changes on reload.
    const replyFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    return TextModerationService.maskFlaggedTextSingle(reply, {
      entityType: TEXT_ENTITY.DISCUSSION,
      fields: ['content'],
      filterEnabled: replyFilterEnabled,
    });
  }

  /**
   * @desc Get replies of a discussion (paginated, supports parentReplyId filter)
   */
  static async getReplies(
    discussionId,
    { page = 1, limit = 20, parentReplyId = null },
    userId = null
  ) {
    const offset = (page - 1) * limit;

    const conditions = [eq(discussionReplies.discussionId, discussionId)];
    if (parentReplyId) {
      conditions.push(eq(discussionReplies.parentReplyId, parentReplyId));
    }

    const [replies, total] = await Promise.all([
      db
        .select({
          id: discussionReplies.id,
          content: discussionReplies.content,
          discussionId: discussionReplies.discussionId,
          userId: discussionReplies.userId,
          parentReplyId: discussionReplies.parentReplyId,
          likesCount: discussionReplies.likesCount,
          repliesCount: discussionReplies.repliesCount,
          createdAt: discussionReplies.createdAt,
          user: {
            id: users.id,
            name: users.name,
            username: users.username,
            profileImage: users.image,
            hasStory: sql`(
              SELECT COUNT(*) > 0 FROM stories s
              WHERE s.user_id = ${users.id}
              AND s.expires_at > NOW()
            )`,
          },
        })
        .from(discussionReplies)
        .leftJoin(users, eq(users.id, discussionReplies.userId))
        .where(and(...conditions))
        .orderBy(desc(discussionReplies.createdAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ count: count() })
        .from(discussionReplies)
        .where(and(...conditions)),
    ]);

    // Query is newest-first so the returned page is the most recent one; flip it
    // here so the thread reads chronologically, oldest → newest.
    replies.reverse();

    if (userId) {
      for (const reply of replies) {
        const like = await db.query.discussionReplyLikes.findFirst({
          where: and(
            eq(discussionReplyLikes.replyId, reply.id),
            eq(discussionReplyLikes.userId, userId)
          ),
        });
        reply.isLiked = !!like;
      }
    }

    const replyIds = replies.map(r => r.id);
    if (replyIds.length > 0) {
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
          and(eq(mentions.sourceType, 'discussion_reply'), inArray(mentions.sourceId, replyIds))
        );

      const mentionsByReply = {};
      for (const m of mentionRows) {
        if (!mentionsByReply[m.sourceId]) mentionsByReply[m.sourceId] = [];
        mentionsByReply[m.sourceId].push({
          userId: m.mentionedUserId,
          username: m.mentionedUsername,
          name: m.mentionedName,
        });
      }

      for (const reply of replies) {
        reply.mentions = mentionsByReply[reply.id] || [];
      }
    }

    const repliesFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(replies, {
      entityType: TEXT_ENTITY.DISCUSSION,
      fields: ['content'],
      filterEnabled: repliesFilterEnabled,
    });

    return {
      replies,
      pagination: {
        page,
        limit,
        total: total[0].count,
        pages: Math.ceil(total[0].count / limit),
      },
    };
  }

  /**
   * @desc Update reply
   */
  static async updateReply(replyId, userId, data) {
    const existing = await db.query.discussionReplies.findFirst({
      where: eq(discussionReplies.id, replyId),
    });

    if (!existing) throw new ApiError(404, 'Reply not found');
    if (existing.userId !== userId) throw new ApiError(403, 'Unauthorized to update this reply.');

    let replyModeration = { action: 'keep' };
    if (typeof data.content === 'string' && data.content.trim()) {
      replyModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.DISCUSSION,
        entityId: replyId,
        entityCreatorId: userId,
        texts: [data.content],
      });
    }

    const [updated] = await db
      .update(discussionReplies)
      .set({ ...data })
      .where(eq(discussionReplies.id, replyId))
      .returning();

    await TextModerationService.recordIfFlagged(replyModeration, {
      entityType: TEXT_ENTITY.DISCUSSION,
      entityId: replyId,
      userId,
      fieldNames: ['content'],
      texts: [data.content],
    });

    const updateReplyFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    return TextModerationService.maskFlaggedTextSingle(updated, {
      entityType: TEXT_ENTITY.DISCUSSION,
      fields: ['content'],
      filterEnabled: updateReplyFilterEnabled,
    });
  }

  /**
   * @desc Delete reply
   */
  static async deleteReply(replyId, userId) {
    const existing = await db.query.discussionReplies.findFirst({
      where: eq(discussionReplies.id, replyId),
    });

    if (!existing) throw new ApiError(404, 'Reply not found');
    if (existing.userId !== userId) throw new ApiError(403, 'Unauthorized to delete this reply.');

    if (existing.parentReplyId) {
      await db
        .update(discussionReplies)
        .set({ repliesCount: sql`GREATEST(${discussionReplies.repliesCount} - 1, 0)` })
        .where(eq(discussionReplies.id, existing.parentReplyId));
    }

    await db
      .delete(mentions)
      .where(and(eq(mentions.sourceType, 'discussion_reply'), eq(mentions.sourceId, replyId)));

    await db.delete(discussionReplies).where(eq(discussionReplies.id, replyId));
  }

  /**
   * @desc Toggle like for a discussion reply
   */
  static async toggleReplyLike(replyId, userId) {
    const reply = await db.query.discussionReplies.findFirst({
      where: eq(discussionReplies.id, replyId),
    });

    if (!reply) throw new ApiError(404, 'Reply not found');

    const existing = await db.query.discussionReplyLikes.findFirst({
      where: and(
        eq(discussionReplyLikes.replyId, replyId),
        eq(discussionReplyLikes.userId, userId)
      ),
    });

    if (existing) {
      await db
        .delete(discussionReplyLikes)
        .where(
          and(eq(discussionReplyLikes.replyId, replyId), eq(discussionReplyLikes.userId, userId))
        );
      await db
        .update(discussionReplies)
        .set({ likesCount: sql`GREATEST(${discussionReplies.likesCount} - 1, 0)` })
        .where(eq(discussionReplies.id, replyId));
      return { liked: false };
    }

    await db.insert(discussionReplyLikes).values({ replyId, userId }).returning();
    await db
      .update(discussionReplies)
      .set({ likesCount: sql`${discussionReplies.likesCount} + 1` })
      .where(eq(discussionReplies.id, replyId));

    try {
      if (reply.userId !== userId) {
        const liker = await db.query.users.findFirst({ where: eq(users.id, userId) });
        await createNotification({
          userId: reply.userId,
          title: 'Your Reply Got a Like',
          message: `${liker?.username || 'Someone'} liked your reply in a discussion`,
          type: 'group_activity',
          relatedId: reply.discussionId,
          redirectTo: `/discussion/${reply.discussionId}`,
          metadata: {
            replyId,
            actorUserId: userId,
            likerId: userId,
            likerUsername: liker?.username,
          },
        });
      }
    } catch (err) {
      console.warn('Failed to create reply like notification', err);
    }

    return { liked: true };
  }

  /**
   * @desc Get all likes for a discussion reply
   */
  static async getReplyLikes(replyId) {
    const likes = await db
      .select({
        userId: discussionReplyLikes.userId,
        userName: users.name,
      })
      .from(discussionReplyLikes)
      .leftJoin(users, eq(users.id, discussionReplyLikes.userId))
      .where(eq(discussionReplyLikes.replyId, replyId));

    return likes;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

const isDiscussionExists = async (discussionId, userId) => {
  const result = await db.query.discussionLikes.findFirst({
    where: and(eq(discussionLikes.discussionId, discussionId), eq(discussionLikes.userId, userId)),
  });
  return !!result;
};

const isDiscussionLiked = async (discussionId, userId) => {
  const like = await db.query.discussionLikes.findFirst({
    where: and(eq(discussionLikes.discussionId, discussionId), eq(discussionLikes.userId, userId)),
  });
  return !!like;
};

const isUserSubscribed = async (discussionId, userId) => {
  if (!userId) return false;
  const subscription = await db.query.discussionSubscriptions.findFirst({
    where: and(
      eq(discussionSubscriptions.discussionId, discussionId),
      eq(discussionSubscriptions.userId, userId)
    ),
  });
  return !!subscription;
};

const getDiscussionCategories = async discussionIds => {
  const ids = Array.isArray(discussionIds) ? discussionIds : [discussionIds];
  if (ids.length === 0) return {};

  const categoryRecords = await db
    .select({
      discussionId: discussionCategories.discussionId,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      categoryIconUrl: categories.iconUrl,
    })
    .from(discussionCategories)
    .leftJoin(categories, eq(categories.id, discussionCategories.categoryId))
    .where(inArray(discussionCategories.discussionId, ids));

  const categoriesMap = {};
  for (const record of categoryRecords) {
    if (!categoriesMap[record.discussionId]) {
      categoriesMap[record.discussionId] = [];
    }
    categoriesMap[record.discussionId].push({
      id: record.categoryId,
      name: record.categoryName,
      emoji: record.categoryEmoji,
      iconUrl: record.categoryIconUrl,
    });
  }

  return categoriesMap;
};

const insertDiscussionCategories = async (discussionId, categoryIds) => {
  if (!categoryIds || categoryIds.length === 0) return;
  const categoryValues = categoryIds.map(categoryId => ({ discussionId, categoryId }));
  await db.insert(discussionCategories).values(categoryValues).onConflictDoNothing();
};

const getDiscussionIdsByCategories = async categoryIds => {
  if (!categoryIds || categoryIds.length === 0) return [];
  const result = await db
    .select({ discussionId: discussionCategories.discussionId })
    .from(discussionCategories)
    .where(inArray(discussionCategories.categoryId, categoryIds))
    .groupBy(discussionCategories.discussionId);
  return result.map(r => r.discussionId);
};

const getUserDiscussionSubscriptions = async ({ userId }) => {
  if (!userId) return false;
  const subscription = await db.query.discussionSubscriptions.findMany({
    where: eq(discussionSubscriptions.userId, userId),
  });
  return subscription;
};
