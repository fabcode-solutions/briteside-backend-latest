import { db } from '../../db/index.js';
import {
  users,
  posts,
  postComments,
  commentLikes,
  postUserComments,
  mentions,
  postCollaborators,
} from '../../db/schema/index.js';
import { eq, and, asc, desc, sql, inArray, isNull } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';
import { createNotification } from '../notification.service.js';
import { BlockService } from './block.service.js';
import { StoryService } from './story.service.js';

/**
 * Comment management service for post comments
 */
export class CommentService {
  /**
   * Add a comment to a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The commenter's ID
   * @param {string} content - Comment content
   * @param {string|null} parentId - Parent comment ID for replies
   * @param {string[]} mentionedUserIds - Array of mentioned user IDs
   */
  static async addComment(postId, userId, content, parentId = null, mentionedUserIds = []) {
    // Check if post exists and not blocked
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    if (post.settings?.commentsDisabled === true) {
      throw new ApiError(403, 'Comments are disabled on this post');
    }

    const isBlocked = await BlockService.isBlocked(userId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot comment on this post');
    }

    if (parentId) {
      const parent = await db.query.postComments.findFirst({
        where: eq(postComments.id, parentId),
      });
      if (!parent) throw new ApiError(404, 'Parent comment not found');
      if (parent.parentId) throw new ApiError(400, 'Cannot reply to a reply');
    }

    const commentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.COMMENT,
      entityCreatorId: userId,
      texts: [content],
    });

    const [comment] = await db
      .insert(postComments)
      .values({ postId, userId, content, parentId })
      .returning();

    await TextModerationService.recordIfFlagged(commentModeration, {
      entityType: TEXT_ENTITY.COMMENT,
      entityId: comment.id,
      userId,
      fieldNames: ['content'],
      texts: [content],
    });

    // Update comments count
    await db
      .update(posts)
      .set({ commentsCount: sql`${posts.commentsCount} + 1` })
      .where(eq(posts.id, postId));

    // Upsert mapping in post_user_comments: keep latest comment id for (post,user)
    try {
      await db.transaction(async tx => {
        await tx
          .delete(postUserComments)
          .where(and(eq(postUserComments.postId, postId), eq(postUserComments.userId, userId)));
        await tx
          .insert(postUserComments)
          .values({ postId, userId, commentId: comment.id, commentedAt: comment.createdAt })
          .returning();
      });
    } catch (err) {
      console.warn('Failed to upsert post_user_comments mapping', err);
    }

    // Update parent comment replies count if it's a reply
    if (parentId) {
      await db
        .update(postComments)
        .set({ repliesCount: sql`${postComments.repliesCount} + 1` })
        .where(eq(postComments.id, parentId));
    }

    // Insert mentions
    if (mentionedUserIds.length > 0) {
      const mentionRows = mentionedUserIds.map(mentionedUserId => ({
        sourceType: 'comment',
        sourceId: comment.id,
        mentionedUserId,
        mentionedByUserId: userId,
      }));
      await db.insert(mentions).values(mentionRows);

      // Send notification to each mentioned user (except self)
      const commenter = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== userId) {
          try {
            await createNotification({
              userId: mentionedUserId,
              title: 'You were mentioned',
              message: `${commenter?.username || 'Someone'} mentioned you in a comment`,
              type: 'social_update',
              relatedId: comment.id,
              redirectTo: `/feed/post/${postId}`,
              metadata: {
                postId,
                commentId: comment.id,
                mentionedByUserId: userId,
                mentionedByUsername: commenter?.username,
              },
            });
          } catch (err) {
            console.warn('Failed to create mention notification', err);
          }
        }
      }
    }

    // Create notification: if this is a reply notify parent comment owner, otherwise notify post owner
    // Replace the existing "Create notification" try/catch block with this:
    try {
      const commenter = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (parentId) {
        // Reply — notify parent comment owner only (no co-author notification for replies)
        const parentComment = await db.query.postComments.findFirst({
          where: eq(postComments.id, parentId),
        });

        if (parentComment && parentComment.userId !== userId) {
          await createNotification({
            userId: parentComment.userId,
            title: 'Reply to your comment',
            message: `${commenter?.username || 'Someone'} replied to your comment`,
            type: 'social_update',
            relatedId: comment.id,
            redirectTo: `/feed/post/${postId}`,
            metadata: {
              postId,
              commenterId: userId,
              commenterUsername: commenter?.username,
              commentId: comment.id,
            },
          });
        }
      } else {
        // Top-level comment — notify post owner
        if (post.userId !== userId) {
          await createNotification({
            userId: post.userId,
            title: 'New comment on your post',
            message: `${commenter?.username || 'Someone'} commented on your post`,
            type: 'social_update',
            relatedId: comment.id,
            redirectTo: `/feed/post/${postId}`,
            metadata: {
              postId,
              commenterId: userId,
              commenterUsername: commenter?.username,
              commentId: comment.id,
            },
          });
        }

        // Notify co-authors
        const coAuthors = await db.query.postCollaborators.findMany({
          where: and(
            eq(postCollaborators.postId, postId),
            eq(postCollaborators.status, 'accepted')
          ),
          columns: { collaboratorId: true },
        });

        for (const { collaboratorId } of coAuthors) {
          if (collaboratorId !== userId && collaboratorId !== post.userId) {
            await createNotification({
              userId: collaboratorId,
              title: 'New comment on your post',
              message: `${commenter?.username || 'Someone'} commented on a post `,
              type: 'social_update',
              relatedId: comment.id,
              redirectTo: `/feed/post/${postId}`,
              metadata: {
                postId,
                commenterId: userId,
                commenterUsername: commenter?.username,
                commentId: comment.id,
              },
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to create comment notification', err);
    }

    const commentWithUser = await db.query.postComments.findFirst({
      where: eq(postComments.id, comment.id),
      with: {
        user: {
          with: {
            socialProfile: true,
          },
        },
        likes: {
          where: eq(commentLikes.userId, userId),
        },
      },
    });

    // Get hasStory status for the comment user
    const hasStory = await StoryService.hasActiveStory(commentWithUser.user.id);

    const result = {
      ...commentWithUser,
      user: {
        ...commentWithUser.user,
        hasStory,
      },
    };

    // Mask per the author's own filter setting — same as what getComments()
    // would show them on the next fetch, so the create response doesn't
    // flash raw text that then changes on reload.
    const filterEnabled = await TextModerationService.getFilterEnabled(userId);
    return TextModerationService.maskFlaggedTextSingle(result, {
      entityType: TEXT_ENTITY.COMMENT,
      fields: ['content'],
      filterEnabled,
    });
  }

  /**
   * Get comments for a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The viewer's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getComments(postId, userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const comments = await db.query.postComments.findMany({
      where: and(eq(postComments.postId, postId), isNull(postComments.parentId)),
      with: {
        user: {
          with: {
            socialProfile: true,
          },
        },
        likes: {
          where: eq(commentLikes.userId, userId),
        },
        replies: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(commentLikes.userId, userId),
            },
          },
          // Replies read oldest → newest so the thread stays chronological
          orderBy: asc(postComments.createdAt),
          limit: 3, // Show only first 3 replies
        },
      },
      orderBy: desc(postComments.createdAt),
      limit,
      offset,
    });

    // Gather all comment IDs (top-level + replies) for batch mention fetch
    const allCommentIds = [];
    for (const comment of comments) {
      allCommentIds.push(comment.id);
      if (comment.replies) {
        for (const reply of comment.replies) {
          allCommentIds.push(reply.id);
        }
      }
    }

    // Batch fetch mentions for all comments
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
        .where(and(eq(mentions.sourceType, 'comment'), inArray(mentions.sourceId, allCommentIds)));

      for (const m of mentionRows) {
        if (!mentionsByComment[m.sourceId]) mentionsByComment[m.sourceId] = [];
        mentionsByComment[m.sourceId].push({
          userId: m.mentionedUserId,
          username: m.mentionedUsername,
          name: m.mentionedName,
        });
      }
    }

    // Get hasStory status for all unique users in comments and replies
    const allUsers = [];
    for (const comment of comments) {
      allUsers.push(comment.user);
      if (comment.replies) {
        for (const reply of comment.replies) {
          allUsers.push(reply.user);
        }
      }
    }
    const uniqueUserIds = [...new Set(allUsers.map(user => user.id))];
    const userStoryStatus = await Promise.all(
      uniqueUserIds.map(async userId => ({
        userId,
        hasStory: await StoryService.hasActiveStory(userId),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );

    const formattedComments = comments.map(comment => ({
      ...comment,
      isLiked: comment.likes.length > 0,
      mentions: mentionsByComment[comment.id] || [],
      user: {
        ...comment.user,
        hasStory: storyStatusMap.get(comment.user.id) || false,
      },
      replies: comment.replies.map(reply => ({
        ...reply,
        isLiked: reply.likes.length > 0,
        mentions: mentionsByComment[reply.id] || [],
        user: {
          ...reply.user,
          hasStory: storyStatusMap.get(reply.user.id) || false,
        },
        likes: undefined,
      })),
      likes: undefined,
    }));

    const filterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(formattedComments, {
      entityType: TEXT_ENTITY.COMMENT,
      fields: ['content'],
      filterEnabled,
    });
    await TextModerationService.maskFlaggedText(
      formattedComments.flatMap(c => c.replies),
      { entityType: TEXT_ENTITY.COMMENT, fields: ['content'], filterEnabled }
    );

    return formattedComments;
  }

  static async getCommentReplies(commentId, userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const comment = await db.query.postComments.findFirst({
      where: and(eq(postComments.id, commentId), isNull(postComments.parentId)),
    });
    if (!comment) throw new ApiError(404, 'Comment not found');

    const replies = await db.query.postComments.findMany({
      where: eq(postComments.parentId, commentId),
      with: {
        user: { with: { socialProfile: true } },
        likes: { where: eq(commentLikes.userId, userId) },
      },
      // Replies read oldest → newest so the thread stays chronological
      orderBy: asc(postComments.createdAt),
      limit,
      offset,
    });

    const replyIds = replies.map(r => r.id);
    let mentionsByComment = {};
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
        .where(and(eq(mentions.sourceType, 'comment'), inArray(mentions.sourceId, replyIds)));

      for (const m of mentionRows) {
        if (!mentionsByComment[m.sourceId]) mentionsByComment[m.sourceId] = [];
        mentionsByComment[m.sourceId].push({
          userId: m.mentionedUserId,
          username: m.mentionedUsername,
          name: m.mentionedName,
        });
      }
    }

    const uniqueUserIds = [...new Set(replies.map(r => r.user.id))];
    const storyStatuses = await Promise.all(
      uniqueUserIds.map(async uid => ({ uid, hasStory: await StoryService.hasActiveStory(uid) }))
    );
    const storyMap = new Map(storyStatuses.map(({ uid, hasStory }) => [uid, hasStory]));

    const [{ count }] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(postComments)
      .where(eq(postComments.parentId, commentId));

    const formattedReplies = replies.map(r => ({
      ...r,
      isLiked: r.likes.length > 0,
      mentions: mentionsByComment[r.id] || [],
      user: { ...r.user, hasStory: storyMap.get(r.user.id) || false },
      likes: undefined,
    }));

    const filterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(formattedReplies, {
      entityType: TEXT_ENTITY.COMMENT,
      fields: ['content'],
      filterEnabled,
    });

    return {
      replies: formattedReplies,
      total: count,
      page,
      hasMore: offset + replies.length < count,
    };
  }

  /**
   * Update a comment
   * @param {string} commentId - The comment's ID
   * @param {string} userId - The user's ID
   * @param {string} content - New comment content
   */
  static async updateComment(commentId, userId, content, mentionedUserIds = []) {
    const commentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.COMMENT,
      entityId: commentId,
      entityCreatorId: userId,
      texts: [content],
    });

    const [updated] = await db
      .update(postComments)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(postComments.id, commentId), eq(postComments.userId, userId)))
      .returning();

    if (!updated) {
      throw new ApiError(404, 'Comment not found or unauthorized');
    }

    await TextModerationService.recordIfFlagged(commentModeration, {
      entityType: TEXT_ENTITY.COMMENT,
      entityId: commentId,
      userId,
      fieldNames: ['content'],
      texts: [content],
    });
    await db
      .delete(mentions)
      .where(and(eq(mentions.sourceType, 'comment'), eq(mentions.sourceId, commentId)));

    if (mentionedUserIds.length > 0) {
      const mentionRows = mentionedUserIds.map(mentionedUserId => ({
        sourceType: 'comment',
        sourceId: commentId,
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
              relatedId: commentId,
              redirectTo: `/feed/post/${updated.postId}`,
              metadata: {
                postId: updated.postId,
                commentId,
                mentionedByUserId: userId,
                mentionedByUsername: commenter?.username,
              },
            });
          } catch (err) {
            console.warn('Failed to create mention notification on edit', err);
          }
        }
      }
    }

    const updateFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    return TextModerationService.maskFlaggedTextSingle(updated, {
      entityType: TEXT_ENTITY.COMMENT,
      fields: ['content'],
      filterEnabled: updateFilterEnabled,
    });
  }

  /**
   * Delete a comment
   * @param {string} commentId - The comment's ID
   * @param {string} userId - The user's ID
   */
 static async deleteComment(commentId, userId) {
    const comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, commentId),
    });

    if (!comment) {
      throw new ApiError(404, 'Comment not found');
    }

    // Allow deletion by the comment's author OR the owner of the post it's on
    const isCommentAuthor = comment.userId === userId;
    let isPostOwner = false;

    if (!isCommentAuthor) {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, comment.postId),
        columns: { userId: true },
      });
      isPostOwner = post?.userId === userId;
    }

    if (!isCommentAuthor && !isPostOwner) {
      throw new ApiError(403, 'Unauthorized to delete this comment');
    }

    // Clean up mentions for this comment
    await db
      .delete(mentions)
      .where(and(eq(mentions.sourceType, 'comment'), eq(mentions.sourceId, commentId)));

    await db.delete(postComments).where(eq(postComments.id, commentId));

    // Update comments count
    await db
      .update(posts)
      .set({ commentsCount: sql`${posts.commentsCount} - 1` })
      .where(eq(posts.id, comment.postId));

    // Update parent comment replies count if it's a reply
    if (comment.parentId) {
      await db
        .update(postComments)
        .set({ repliesCount: sql`${postComments.repliesCount} - 1` })
        .where(eq(postComments.id, comment.parentId));
    }

    // Adjust post_user_comments mapping if it referenced the deleted comment
    try {
      await db.transaction(async tx => {
        const mapping = await tx.query.postUserComments.findFirst({
          where: and(
            eq(postUserComments.postId, comment.postId),
            eq(postUserComments.userId, comment.userId)
          ),
        });

        if (mapping && mapping.commentId === comment.id) {
          const latest = await tx.query.postComments.findFirst({
            where: and(
              eq(postComments.postId, comment.postId),
              eq(postComments.userId, comment.userId)
            ),
            orderBy: desc(postComments.createdAt),
          });

          if (latest) {
            await tx
              .update(postUserComments)
              .set({ commentId: latest.id, commentedAt: latest.createdAt })
              .where(eq(postUserComments.id, mapping.id));
          } else {
            await tx.delete(postUserComments).where(eq(postUserComments.id, mapping.id));
          }
        }
      });
    } catch (err) {
      console.warn('Failed to adjust post_user_comments after comment delete', err);
    }

    return { success: true };
  }

  /**
   * Toggle like on a comment
   * @param {string} commentId - The comment's ID
   * @param {string} userId - The user's ID
   */
  static async toggleLikeComment(commentId, userId) {
    // Check if comment exists (needed for notification + safety)
    const comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, commentId),
    });

    if (!comment) {
      throw new ApiError(404, 'Comment not found');
    }

    // Check if already liked
    const existing = await db.query.commentLikes.findFirst({
      where: and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)),
    });

    // ===============================
    // UNLIKE
    // ===============================
    if (existing) {
      await db
        .delete(commentLikes)
        .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)));

      // Update likes count
      await db
        .update(postComments)
        .set({ likesCount: sql`${postComments.likesCount} - 1` })
        .where(eq(postComments.id, commentId));

      return {
        liked: false,
      };
    }

    // ===============================
    // LIKE
    // ===============================
    const [like] = await db.insert(commentLikes).values({ commentId, userId }).returning();

    // Update likes count
    await db
      .update(postComments)
      .set({ likesCount: sql`${postComments.likesCount} + 1` })
      .where(eq(postComments.id, commentId));

    // Notify comment owner (non-blocking)
    try {
      if (comment.userId && comment.userId !== userId) {
        const liker = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        await createNotification({
          userId: comment.userId,
          title: 'Comment liked',
          message: `${liker?.username || 'Someone'} liked your comment`,
          type: 'social_update',
          relatedId: commentId,
          redirectTo: `/feed/post/${comment.postId}`,
          metadata: {
            commentId,
            actorUserId: userId,
            likerId: userId,
            likerUsername: liker?.username,
          },
        });
      }
    } catch (err) {
      console.warn('Failed to create like-comment notification', err);
    }

    return {
      liked: true,
      like,
    };
  }
}
