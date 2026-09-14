import { DiscussionService } from '../services/discussion.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { db } from '../db/index.js';
import { userReports } from '../db/schema/userReports.js';
import { discussions, groupMembers } from '../db/schema/groups.js';
import { eq, and, inArray, desc, isNull, count } from 'drizzle-orm';
import httpStatus from 'http-status';
import { adminService } from '../services/admin.service.js';

// Discussion Controllers
export const createDiscussion = catchAsync(async (req, res) => {
  const { title, content, groupId, mediaUrls, categoryIds, metadata } = req.body; // mediaUrls: array of URLs (max 10)

  const discussion = await DiscussionService.createDiscussion({
    title,
    content,
    metadata: metadata || {}, // Ensure metadata is an object
    mediaUrls, // Can be a single URL (will be converted to array) or an array of URLs
    groupId: groupId || null, // Ensure null is handled properly
    categoryIds: categoryIds || [], // Array of category IDs
    userId: req.user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Discussion created successfully',
    data: { discussion },
  });
});

export const getAllDiscussions = catchAsync(async (req, res) => {
  const userId = req.user.id;

  // Parse categoryIds from query string (can be comma-separated or array)
  let categoryIds = req.query.categoryIds;
  if (categoryIds) {
    if (typeof categoryIds === 'string') {
      categoryIds = categoryIds
        .split(',')
        .map(id => id.trim())
        .filter(id => id);
    } else if (!Array.isArray(categoryIds)) {
      categoryIds = [categoryIds];
    }
  }

  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
    groupId: req.query.groupId,
    search: req.query.search,
    categoryIds: categoryIds || [],
  };

  const discussions = await DiscussionService.getAllDiscussions(filters, userId);

  res.json({
    success: true,
    data: { discussions },
  });
});

export const getDiscussionById = catchAsync(async (req, res) => {
  const discussion = await DiscussionService.getDiscussionById(
    req.params.discussionId,
    req.user?.id
  );

  if (!discussion) {
    throw new ApiError(404, 'Discussion not found');
  }

  res.json({
    success: true,
    data: { discussion },
  });
});

export const updateDiscussion = catchAsync(async (req, res) => {
  const discussion = await DiscussionService.updateDiscussion(
    req.params.discussionId,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Discussion updated successfully',
    data: { discussion },
  });
});

export const deleteDiscussion = catchAsync(async (req, res) => {
  await DiscussionService.deleteDiscussion(req.params.discussionId, req.user.id);

  res.json({
    success: true,
    message: 'Discussion deleted successfully',
  });
});

// Discussion Likes Controllers
export const toggleDiscussionLike = catchAsync(async (req, res) => {
  const result = await DiscussionService.toggleLike(req.params.discussionId, req.user.id);

  res.json({
    success: true,
    message: result.liked ? 'Discussion liked' : 'Discussion unliked',
    data: result,
  });
});

export const getDiscussionLikes = catchAsync(async (req, res) => {
  const likes = await DiscussionService.getDiscussionLikes({
    discussionId: req.params.discussionId,
  });

  res.json({
    success: true,
    data: { likes },
  });
});

// Discussion Replies Controllers
export const createReply = catchAsync(async (req, res) => {
  const { content, parentReplyId, mentionedUserIds } = req.body;

  const reply = await DiscussionService.createReply({
    content,
    parentReplyId: parentReplyId || null,
    mentionedUserIds: Array.isArray(mentionedUserIds) ? mentionedUserIds : [],
    discussionId: req.params.discussionId,
    userId: req.user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Reply created successfully',
    data: { reply },
  });
});

export const getReplies = catchAsync(async (req, res) => {
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    parentReplyId: req.query.parentReplyId || null,
  };

  const replies = await DiscussionService.getReplies(req.params.discussionId, filters, req.user.id);

  res.json({
    success: true,
    data: { replies },
  });
});

export const updateReply = catchAsync(async (req, res) => {
  const reply = await DiscussionService.updateReply(req.params.replyId, req.user.id, req.body);

  res.json({
    success: true,
    message: 'Reply updated successfully',
    data: { reply },
  });
});

export const deleteReply = catchAsync(async (req, res) => {
  await DiscussionService.deleteReply(req.params.replyId, req.user.id);

  res.json({
    success: true,
    message: 'Reply deleted successfully',
  });
});

// Subscribe/Unsubscribe Controllers
export const subscribeToDiscussion = catchAsync(async (req, res) => {
  await DiscussionService.subscribe(req.params.discussionId, req.user.id);
  res.json({ success: true, message: 'Subscribed to discussion' });
});

export const unsubscribeFromDiscussion = catchAsync(async (req, res) => {
  await DiscussionService.unsubscribe(req.params.discussionId, req.user.id);
  res.json({ success: true, message: 'Unsubscribed from discussion' });
});

// Reply Likes Controllers
export const toggleReplyLike = catchAsync(async (req, res) => {
  const result = await DiscussionService.toggleReplyLike(req.params.replyId, req.user.id);

  res.json({
    success: true,
    message: result.liked ? 'Reply liked' : 'Reply unliked',
    data: result,
  });
});

export const getReplyLikes = catchAsync(async (req, res) => {
  const likes = await DiscussionService.getReplyLikes(req.params.replyId);

  res.json({
    success: true,
    data: { likes },
  });
});

export const getReportedGroupDiscussions = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const status = req.query.status;

  // ── 1. Verify requester is admin or moderator of this group ──────────
  const membership = await db.query.groupMembers.findFirst({
    where: and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.userId, userId),
      eq(groupMembers.status, 'joined'),
      inArray(groupMembers.role, ['admin', 'moderator'])
    ),
    columns: { role: true },
  });

  if (!membership) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only group admins and moderators can view reported discussions.'
    );
  }

  // ── 2. Get discussion IDs belonging to this group ────────────────────
  const groupDiscussions = await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(and(eq(discussions.groupId, groupId), isNull(discussions.deletedAt)));

  const discussionIds = groupDiscussions.map(d => d.id);

  if (discussionIds.length === 0) {
    return res.json({ success: true, data: { reports: [], total: 0, page, limit } });
  }

  // ── 3. Build filter conditions ────────────────────────────────────────
  const conditions = [
    eq(userReports.type, 'discussion'),
    inArray(userReports.discussionId, discussionIds),
  ];
  if (status) conditions.push(eq(userReports.status, status));

  // ── 4. Count total ────────────────────────────────────────────────────
  const [{ total }] = await db
    .select({ total: count() })
    .from(userReports)
    .where(and(...conditions));

  // ── 5. Fetch paginated reports with relations ─────────────────────────
  const reports = await db.query.userReports.findMany({
    where: and(...conditions),
    limit,
    offset: (page - 1) * limit,
    orderBy: [desc(userReports.createdAt)],
    with: {
      reporter: {
        columns: { id: true, username: true, firstName: true, lastName: true, image: true },
      },
      discussion: {
        columns: { id: true, title: true, groupId: true, userId: true, createdAt: true },
      },
    },
  });

  res.json({
    success: true,
    data: { reports, total: Number(total), page, limit },
  });
});

export const resolveReportedDiscussion = catchAsync(async (req, res) => {
  const { groupId, reportId } = req.params;
  const userId = req.user.id;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Reason is required.');
  }

  // ── 1. Verify requester is admin or moderator of this group ──────────
  const membership = await db.query.groupMembers.findFirst({
    where: and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.userId, userId),
      eq(groupMembers.status, 'joined'),
      inArray(groupMembers.role, ['admin', 'moderator'])
    ),
    columns: { role: true },
  });

  if (!membership) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only group admins and moderators can resolve reported discussions.'
    );
  }

  // ── 2. Verify the report belongs to a discussion in this group ────────
  const report = await db.query.userReports.findFirst({
    where: and(eq(userReports.id, reportId), eq(userReports.type, 'discussion')),
    with: {
      discussion: {
        columns: { id: true, groupId: true },
      },
    },
  });

  if (!report) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report not found.');
  }

  if (report.discussion?.groupId !== groupId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'This report does not belong to a discussion in your group.'
    );
  }

  // ── 3. Delegate to adminService — soft-deletes discussion + resolves report
  const result = await adminService.resolveReportedEntity(reportId, 'delete', reason, userId);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Discussion removed and report resolved.',
    data: result,
  });
});
