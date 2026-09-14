import { db } from '../../db/index.js';
import {
  postCollaborators,
  posts,
  users,
  socialProfiles,
  userBlocks,
  userFollows,
} from '../../db/schema/index.js';
import { eq, and, or, inArray, ne } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { createNotification } from '../notification.service.js';
import { MediaModerationService } from '../moderation/mediaModeration.service.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';

const MAX_COLLABORATORS = 4; // up to 4 invited + 1 owner = 5 total

export class CollaborationService {
  // ─────────────────────────────────────────────────────────────────────────
  // INVITE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Invite one or more users to co-author a post.
   * Can be called before OR after publishing (post-publication invite).
   *
   * @param {string} postId
   * @param {string} ownerId        - must be the post owner
   * @param {string[]} collaboratorIds
   * @returns {object[]} created/existing invite rows
   */
  static async inviteCollaborators(postId, ownerId, collaboratorIds) {
    if (!Array.isArray(collaboratorIds) || collaboratorIds.length === 0) {
      throw new ApiError(400, 'collaboratorIds must be a non-empty array');
    }

    // Deduplicate and remove owner from the list
    const uniqueIds = [...new Set(collaboratorIds)].filter(id => id !== ownerId);
    if (uniqueIds.length === 0) {
      throw new ApiError(400, 'Cannot invite yourself as a collaborator');
    }

    // Verify post exists and caller is owner
    const post = await db.query.posts.findFirst({
      where: and(eq(posts.id, postId), eq(posts.userId, ownerId)),
      columns: { id: true, userId: true },
    });
    if (!post) throw new ApiError(404, 'Post not found or you are not the owner');

    // Count current non-rejected/non-removed slots
    const existing = await db.query.postCollaborators.findMany({
      where: and(
        eq(postCollaborators.postId, postId),
        or(eq(postCollaborators.status, 'pending'), eq(postCollaborators.status, 'accepted'))
      ),
      columns: { collaboratorId: true },
    });

    const existingIds = new Set(existing.map(e => e.collaboratorId));
    const newInvites = uniqueIds.filter(id => !existingIds.has(id));

    if (existing.length + newInvites.length > MAX_COLLABORATORS) {
      throw new ApiError(
        400,
        `A post can have at most ${MAX_COLLABORATORS} collaborators (excluding owner). ` +
          `Currently ${existing.length} active, trying to add ${newInvites.length}.`
      );
    }

    // Block check: don't invite someone who has blocked the owner or vice versa
    const blocks = await db.query.userBlocks.findMany({
      where: or(
        and(eq(userBlocks.blockerId, ownerId), inArray(userBlocks.blockedId, uniqueIds)),
        and(inArray(userBlocks.blockerId, uniqueIds), eq(userBlocks.blockedId, ownerId))
      ),
      columns: { blockerId: true, blockedId: true },
    });
    const blockedSet = new Set(
      blocks.map(b => (b.blockerId === ownerId ? b.blockedId : b.blockerId))
    );

    const results = [];

    for (const collaboratorId of uniqueIds) {
      if (blockedSet.has(collaboratorId)) {
        results.push({ collaboratorId, status: 'skipped', reason: 'blocked' });
        continue;
      }

      // If re-inviting after rejection/removal, update the row instead of insert
      const staleRow = await db.query.postCollaborators.findFirst({
        where: and(
          eq(postCollaborators.postId, postId),
          eq(postCollaborators.collaboratorId, collaboratorId)
        ),
      });

      if (staleRow) {
        if (staleRow.status === 'pending' || staleRow.status === 'accepted') {
          results.push({ collaboratorId, status: staleRow.status, reason: 'already_invited' });
          continue;
        }
        // Reinvite after rejection or removal
        const [updated] = await db
          .update(postCollaborators)
          .set({ status: 'pending', respondedAt: null, updatedAt: new Date() })
          .where(eq(postCollaborators.id, staleRow.id))
          .returning();
        results.push({ collaboratorId, status: 'reinvited', row: updated });
      } else {
        const [row] = await db
          .insert(postCollaborators)
          .values({ postId, collaboratorId, invitedById: ownerId, status: 'pending' })
          .returning();
        results.push({ collaboratorId, status: 'invited', row });
      }

      // Fire-and-forget notification
      this._notifyInvite(postId, ownerId, collaboratorId).catch(err =>
        console.warn('[CollaborationService] invite notification failed', err)
      );
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESPOND (accept / reject)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Collaborator accepts or rejects their invite.
   *
   * @param {string} postId
   * @param {string} collaboratorId
   * @param {'accepted'|'rejected'} action
   */
  static async respondToInvite(postId, collaboratorId, action) {
    if (!['accepted', 'rejected'].includes(action)) {
      throw new ApiError(400, "action must be 'accepted' or 'rejected'");
    }

    const invite = await db.query.postCollaborators.findFirst({
      where: and(
        eq(postCollaborators.postId, postId),
        eq(postCollaborators.collaboratorId, collaboratorId),
        eq(postCollaborators.status, 'pending')
      ),
    });

    if (!invite) {
      throw new ApiError(404, 'No pending collaboration invite found for this post');
    }

    const [updated] = await db
      .update(postCollaborators)
      .set({ status: action, respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(postCollaborators.id, invite.id))
      .returning();

    // Notify the post owner of the response
    this._notifyResponse(postId, collaboratorId, invite.invitedById, action).catch(err =>
      console.warn('[CollaborationService] response notification failed', err)
    );

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REMOVE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Post owner removes an accepted/pending collaborator.
   * Also called when a collaborator removes themselves from a collab post.
   *
   * @param {string} postId
   * @param {string} requesterId  - either the post owner or the collaborator themselves
   * @param {string} collaboratorId
   */
  static async removeCollaborator(postId, requesterId, collaboratorId) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { id: true, userId: true },
    });
    if (!post) throw new ApiError(404, 'Post not found');

    const isOwner = post.userId === requesterId;
    const isSelf = requesterId === collaboratorId;

    if (!isOwner && !isSelf) {
      throw new ApiError(
        403,
        'Only the post owner or the collaborator themselves can remove a collaborator'
      );
    }

    const invite = await db.query.postCollaborators.findFirst({
      where: and(
        eq(postCollaborators.postId, postId),
        eq(postCollaborators.collaboratorId, collaboratorId)
      ),
    });
    if (!invite) throw new ApiError(404, 'Collaborator not found on this post');

    const [updated] = await db
      .update(postCollaborators)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(eq(postCollaborators.id, invite.id))
      .returning();

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all collaborators for a post (accepted only by default).
   * Used when rendering a post to show co-author avatars.
   */
  static async getPostCollaborators(postId, { includeAll = false } = {}) {
    const rows = await db.query.postCollaborators.findMany({
      where: includeAll
        ? eq(postCollaborators.postId, postId)
        : and(eq(postCollaborators.postId, postId), eq(postCollaborators.status, 'accepted')),
      with: {
        collaborator: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          with: {
            socialProfile: { columns: { bio: true, isPublic: true, isVerified: true } },
          },
        },
      },
      orderBy: rows => rows.createdAt,
    });

    return rows.map(r => ({
      id: r.id,
      postId: r.postId,
      status: r.status,
      invitedById: r.invitedById,
      respondedAt: r.respondedAt,
      createdAt: r.createdAt,
      user: {
        id: r.collaborator.id,
        username: r.collaborator.username,
        firstName: r.collaborator.firstName,
        lastName: r.collaborator.lastName,
        image: r.collaborator.image,
        bio: r.collaborator.socialProfile?.bio ?? null,
        isVerified: r.collaborator.socialProfile?.isVerified ?? false,
      },
    }));
  }

  /**
   * Pending collaboration invites for a user (their inbox).
   */
  static async getPendingInvites(collaboratorId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const rows = await db.query.postCollaborators.findMany({
      where: and(
        eq(postCollaborators.collaboratorId, collaboratorId),
        eq(postCollaborators.status, 'pending')
      ),
      with: {
        post: {
          columns: {
            id: true,
            caption: true,
            mediaUrls: true,
            mediaTypes: true,
            createdAt: true,
            visibility: true,
          },
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            },
          },
        },
      },
      orderBy: rows => [{ desc: rows.createdAt }],
      limit,
      offset,
    });

    return rows.map(r => ({
      inviteId: r.id,
      postId: r.postId,
      invitedById: r.invitedById,
      createdAt: r.createdAt,
      post: {
        id: r.post.id,
        caption: r.post.caption,
        mediaUrls: r.post.mediaUrls || [],
        mediaTypes: r.post.mediaTypes || [],
        createdAt: r.post.createdAt,
        visibility: r.post.visibility,
        owner: r.post.user,
      },
    }));
  }

  /**
   * All posts a user is an accepted collaborator on.
   * Powers the "Collaborations" tab on a profile grid.
   */
  static async getCollaboratedPosts(collaboratorId, viewerId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const rows = await db.query.postCollaborators.findMany({
      where: and(
        eq(postCollaborators.collaboratorId, collaboratorId),
        eq(postCollaborators.status, 'accepted')
      ),
      with: {
        post: {
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
              with: {
                socialProfile: { columns: { bio: true, isPublic: true, coverImages: true } },
              },
            },
          },
        },
      },
      orderBy: rows => [{ desc: rows.createdAt }],
      limit,
      offset,
    });

    const mapped = rows.map(r => ({
      ...r.post,
      mediaUrls: r.post.mediaUrls || [],
      mediaTypes: r.post.mediaTypes || [],
      aspectRatios: r.post.aspectRatios || [],
      collaboratedAt: r.createdAt,
      isCollaboration: true,
    }));
    const moderated = await MediaModerationService.applyPostModeration(mapped, viewerId);
    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedText(moderated, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER: attach collaborator data to shaped post objects
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Given an array of shaped post objects (from getFeed / getPosts / etc.),
   * batch-fetch accepted collaborators and attach them.
   *
   * Usage:
   *   const posts = [...shaped posts...];
   *   await CollaborationService.attachCollaborators(posts);
   *
   * Each post gets:
   *   post.collaborators = [{ id, username, firstName, lastName, image, isVerified }]
   *   post.isCollaboration = collaborators.length > 0
   */
  static async attachCollaborators(shapedPosts) {
    if (!shapedPosts || shapedPosts.length === 0) return;

    const postIds = shapedPosts.map(p => p.id).filter(Boolean);
    if (postIds.length === 0) return;

    const rows = await db.query.postCollaborators.findMany({
      where: and(
        inArray(postCollaborators.postId, postIds),
        eq(postCollaborators.status, 'accepted')
      ),
      with: {
        collaborator: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          with: {
            socialProfile: { columns: { isVerified: true } },
          },
        },
      },
    });

    // Group by postId
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.postId)) map.set(row.postId, []);
      map.get(row.postId).push({
        id: row.collaborator.id,
        username: row.collaborator.username,
        firstName: row.collaborator.firstName,
        lastName: row.collaborator.lastName,
        image: row.collaborator.image,
        isVerified: row.collaborator.socialProfile?.isVerified ?? false,
      });
    }

    for (const post of shapedPosts) {
      const collabs = map.get(post.id) || [];
      post.collaborators = collabs;
      post.isCollaboration = collabs.length > 0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: notifications
  // ─────────────────────────────────────────────────────────────────────────

  static async _notifyInvite(postId, ownerId, collaboratorId) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, ownerId),
      columns: { username: true },
    });

    await createNotification({
      userId: collaboratorId,
      title: 'Collaboration invite',
      message: `${owner?.username || 'Someone'} invited you to collaborate on a post`,
      type: 'social_update',
      relatedId: postId,
      redirectTo: `/feed/post/${postId}`,
      metadata: { postId, ownerId, ownerUsername: owner?.username, action: 'collab_invite' },
    });
  }

  static async _notifyResponse(postId, collaboratorId, ownerId, action) {
    const collaborator = await db.query.users.findFirst({
      where: eq(users.id, collaboratorId),
      columns: { username: true },
    });

    await createNotification({
      userId: ownerId,
      title: action === 'accepted' ? 'Collaboration accepted' : 'Collaboration declined',
      message:
        action === 'accepted'
          ? `${collaborator?.username || 'Someone'} accepted your collaboration invite`
          : `${collaborator?.username || 'Someone'} declined your collaboration invite`,
      type: 'social_update',
      relatedId: postId,
      redirectTo: `/feed/post/${postId}`,
      metadata: {
        postId,
        collaboratorId,
        collaboratorUsername: collaborator?.username,
        action: `collab_${action}`,
      },
    });
  }
}
