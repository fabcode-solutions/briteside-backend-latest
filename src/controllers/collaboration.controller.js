import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { CollaborationService } from '../services/social/postCollaboration.service.js';

// ─── POST OWNER: invite collaborators ────────────────────────────────────────

/**
 * POST /api/social/posts/:postId/collaborators
 * Body: { collaboratorIds: string[] }
 *
 * Invite one or more users to co-author this post.
 * Can be called before OR after publishing.
 */
export const inviteCollaborators = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const ownerId = req.user.id;
  const { collaboratorIds } = req.body;

  if (!Array.isArray(collaboratorIds) || collaboratorIds.length === 0) {
    throw new ApiError(400, 'collaboratorIds must be a non-empty array');
  }

  const results = await CollaborationService.inviteCollaborators(postId, ownerId, collaboratorIds);

  res.status(201).json({
    success: true,
    message: 'Collaboration invites sent',
    data: { results },
  });
});

// ─── COLLABORATOR: respond to invite ─────────────────────────────────────────

/**
 * PATCH /api/social/posts/:postId/collaborators/respond
 * Body: { action: 'accepted' | 'rejected' }
 *
 * The invited user accepts or declines.
 */
export const respondToCollabInvite = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const collaboratorId = req.user.id;
  const { action } = req.body;

  if (!['accepted', 'rejected'].includes(action)) {
    throw new ApiError(400, "action must be 'accepted' or 'rejected'");
  }

  const result = await CollaborationService.respondToInvite(postId, collaboratorId, action);

  res.json({
    success: true,
    message: action === 'accepted' ? 'You are now a collaborator' : 'Collaboration invite declined',
    data: { collaboration: result },
  });
});

// ─── REMOVE collaborator ─────────────────────────────────────────────────────

/**
 * DELETE /api/social/posts/:postId/collaborators/:collaboratorId
 *
 * - Post owner can remove any collaborator.
 * - A collaborator can remove themselves (collaboratorId === req.user.id).
 */
export const removeCollaborator = catchAsync(async (req, res) => {
  const { postId, collaboratorId } = req.params;
  const requesterId = req.user.id;

  const result = await CollaborationService.removeCollaborator(postId, requesterId, collaboratorId);

  res.json({
    success: true,
    message: 'Collaborator removed',
    data: { collaboration: result },
  });
});

// ─── GET: collaborators for a post ───────────────────────────────────────────

/**
 * GET /api/social/posts/:postId/collaborators
 * Query: includeAll=true  (owner-only: show pending/rejected/removed too)
 *
 * Public: returns accepted collaborators.
 * Owner: pass ?includeAll=true to see all invite states.
 */
export const getPostCollaborators = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const includeAll = req.query.includeAll === 'true';

  const collaborators = await CollaborationService.getPostCollaborators(postId, { includeAll });

  res.json({
    success: true,
    data: { collaborators },
  });
});

// ─── GET: pending invites for the current user ───────────────────────────────

/**
 * GET /api/social/collaborations/pending
 * Query: page, limit
 *
 * Returns all pending collab invites in the authenticated user's inbox.
 */
export const getPendingCollabInvites = catchAsync(async (req, res) => {
  const collaboratorId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  const invites = await CollaborationService.getPendingInvites(collaboratorId, { page, limit });

  res.json({
    success: true,
    data: {
      invites,
      pagination: { page, limit, hasMore: invites.length === limit },
    },
  });
});

// ─── GET: all posts a user has collaborated on ───────────────────────────────

/**
 * GET /api/social/users/:userId/collaborations
 * Query: page, limit
 *
 * Powers the "Collaborations" tab on a profile page.
 */
export const getUserCollaborations = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const viewerId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  const collabPosts = await CollaborationService.getCollaboratedPosts(userId, viewerId, {
    page,
    limit,
  });

  res.json({
    success: true,
    data: {
      posts: collabPosts,
      pagination: { page, limit, hasMore: collabPosts.length === limit },
    },
  });
});
