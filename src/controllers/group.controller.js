import {
  GroupCategoryService,
  GroupMemberService,
  GroupService,
  GroupEventPromotionService,
  GroupTagService,
  GroupDiscussionNotificationService,
  GroupInvitationService,
} from '../services/group.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';

/**
 * @desc Create a new group
 * @route POST /api/v1/groups
 * @access Private (Authenticated User)
 */
export const createGroups = catchAsync(async (req, res) => {
  const group = await GroupService.createGroup(
    req.user.id,
    req.body,
    req.user.isBritesidePlus
  );

  res.status(201).json({
    success: true,
    message: 'Group created successfully',
    data: { group },
  });
});

export const getGroups = catchAsync(async (req, res) => {
  const filters = {
    slug: req.query.slug,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
    isPublic: req?.query?.isPublic, // Default to true to only show public groups
    categoryId: req.query.categoryId || null,
    search: req.query.search,
    country: req.query.country,
    state: req.query.state,
    city: req.query.city,
    isFree: req.query.isFree,
    priceRange: req.query.priceRange,
  };

  const result = await GroupService.getGroups(filters, req.query.userId);

  res.json({
    success: true,
    data: result,
  });
});

export const getGroupsById = catchAsync(async (req, res) => {
  // Note: The route uses `:groupsId` but the service should use `groupId`
  // Pass current user ID if authenticated, otherwise null
  const group = await GroupService.getGroupById(req.params.groupsId, req.user?.id || null);

  if (!group) {
    throw new ApiError(404, 'Group not found');
  }

  res.json({
    success: true,
    data: { group },
  });
});

export const getGroupsBySlug = catchAsync(async (req, res) => {
  // Get group by slug instead of ID
  // Pass current user ID if authenticated, otherwise null
  const group = await GroupService.getGroupBySlug(req.params.slug, req.user?.id || null);

  if (!group) {
    throw new ApiError(404, 'Group not found');
  }

  res.json({
    success: true,
    data: { group },
  });
});
export const getGroupsInfo = catchAsync(async (req, res) => {
  // Get group by slug instead of ID
  // Pass current user ID if authenticated, otherwise null
  const group = await GroupService.getGroupsInfo(req.params.slug, req.user?.id || null);

  if (!group) {
    throw new ApiError(404, 'Group not found');
  }

  res.json({
    success: true,
    data: { group },
  });
});

export const updateGroups = catchAsync(async (req, res) => {
  const group = await GroupService.updateGroup(
    req.params.groupsId,
    req.user.id, // Used for authorization check (only creator/admin can update)
    req.body,
    req.user.isBritesidePlus
  );

  res.json({
    success: true,
    message: 'Group updated successfully',
    data: { group },
  });
});

export const deleteGroups = catchAsync(async (req, res) => {
  await GroupService.deleteGroup(req.params.groupsId, req.user.id);

  res.json({
    success: true,
    message: 'Group deleted successfully',
  });
});

export const publishGroups = catchAsync(async (req, res) => {
  const group = await GroupService.publishGroup(req.params.groupsId, req.user.id);

  res.json({
    success: true,
    message: 'Group published successfully',
    data: { group },
  });
});

export const getGroupsAnalytics = catchAsync(async (req, res) => {
  const analytics = await GroupService.getGroupAnalytics(req.params.groupsId, req.user.id);

  res.json({
    success: true,
    data: { analytics },
  });
});

export const getMyGroups = catchAsync(async (req, res) => {
  const groups = await GroupService.getMyGroups(req.user.id);

  res.json({
    success: true,
    data: { groups },
  });
});

export const joinGroups = catchAsync(async (req, res) => {
  const { answers = [] } = req.body;
  const result = await GroupService.joinGroup(req.user.id, req.params.groupId, answers);

  res.json({
    success: true,
    message: 'Group join process initiated/completed successfully',
    data: result,
  });
});

export const joinGroupsRequests = catchAsync(async (req, res) => {
  const result = await GroupService.getPendingJoinRequests(req.user.id, req.params.groupId);

  res.json({
    success: true,
    message: 'Join requests received successfully',
    data: result,
  });
});

export const leaveGroups = catchAsync(async (req, res) => {
  await GroupService.leaveGroup(req.user.id, req.params.groupId);

  res.json({
    success: true,
    message: 'Successfully left the group',
  });
});
export const updateJoinRequestStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  await GroupService.updateJoinRequestStatus(req.user.id, req.params.requestId, status);

  res.json({
    success: true,
    message: 'Successfully updated the join request status',
  });
});

export const createGroupCategory = catchAsync(async (req, res) => {
  const category = await GroupCategoryService.createGroupCategory(req.body);

  res.status(201).json({
    success: true,
    message: 'Group category created successfully',
    data: { category },
  });
});

export const getGroupCategories = catchAsync(async (req, res) => {
  const categories = await GroupCategoryService.getGroupCategories();
  res.json({
    success: true,
    data: { categories },
  });
});

export const deleteGroupCategory = catchAsync(async (req, res) => {
  await GroupCategoryService.deleteGroupCategory(req.params.category_id);

  res.json({
    success: true,
    message: 'Group category deleted successfully',
  });
});

export const updateGroupCategory = catchAsync(async (req, res) => {
  const category = await GroupCategoryService.updateGroupCategory(req.params.category_id, req.body);

  res.json({
    success: true,
    message: 'Group category updated successfully',
    data: { category },
  });
});

// =======================
// GROUP MEMBERS CONTROLLERS
// =======================

export const addGroupMember = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { userId, role } = req.body; // Optional: admin can add other members

  const member = await GroupMemberService.addMember({
    groupId,
    addedBy: req.user.id,
    userId: userId || req.user.id,
    role: role || 'member',
  });

  res.status(201).json({
    success: true,
    message: 'Member added to group successfully',
    data: { member },
  });
});

export const getGroupMembers = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    search: req.query.search || '',
  };

  const members = await GroupMemberService.getMembers(groupId, req.user?.id, filters);

  res.json({
    success: true,
    data: { members },
  });
});

export const updateGroupMemberRole = catchAsync(async (req, res) => {
  const { groupId, userId } = req.params;
  const { role, status } = req.body;

  const member = await GroupMemberService.updateMemberRole({
    groupId,
    targetUserId: userId,
    performedBy: req.user.id,
    role,
    status,
  });

  res.json({
    success: true,
    message: 'Member updated successfully',
    data: { member },
  });
});

export const removeGroupMember = catchAsync(async (req, res) => {
  const { groupId, userId } = req.params;

  await GroupMemberService.removeMember({
    groupId,
    targetUserId: userId,
    performedBy: req.user.id,
  });

  res.json({
    success: true,
    message: 'Member removed from group successfully',
  });
});

// =======================
// EVENT PROMOTIONS CONTROLLERS
// =======================

export const createEventPromotion = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const { groupIds, message } = req.body;

  if (!groupIds || (Array.isArray(groupIds) && groupIds.length === 0)) {
    throw new ApiError(400, 'At least one group ID is required');
  }

  const promotions = await GroupEventPromotionService.createPromotions({
    groupIds,
    eventId,
    userId: req.user.id,
    message,
  });

  res.status(201).json({
    success: true,
    message: 'Event promotion(s) created successfully',
    data: {
      promotions,
      totalPromoted: promotions.length,
    },
  });
});

export const getGroupEventPromotions = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const filters = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  };

  const result = await GroupEventPromotionService.getGroupPromotions(groupId, filters);

  res.json({
    success: true,
    data: result,
  });
});

export const deleteEventPromotion = catchAsync(async (req, res) => {
  const { promotionId } = req.params;

  await GroupEventPromotionService.deletePromotion(promotionId, req.user.id);

  res.json({
    success: true,
    message: 'Event promotion removed successfully',
  });
});

export const addTagsToGroup = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { tags } = req.body; // array of strings

  const result = await GroupTagService.addTagsToGroup(groupId, req.user.id, tags);

  res.json({
    success: true,
    message: 'Tags updated successfully',
    data: result,
  });
});

export const getGroupTags = catchAsync(async (req, res) => {
  const tags = await GroupTagService.getGroupTags(req.params.groupId);

  res.json({
    success: true,
    data: { tags },
  });
});

export const removeTagFromGroup = catchAsync(async (req, res) => {
  await GroupTagService.removeTagFromGroup(req.params.groupId, req.params.tagId, req.user.id);

  res.json({
    success: true,
    message: 'Tag removed from group',
  });
});

export const getGroupsByTags = catchAsync(async (req, res) => {
  const { tags, page = 1, limit = 10 } = req.query;

  const result = await GroupTagService.getGroupsByTags({
    tags: typeof tags === 'string' ? tags.split(',') : [],
    page: Number(page),
    limit: Number(limit),
  });

  res.json({
    success: true,
    ...result,
  });
});

// Group Discussion Notifications

/**
 * @desc Subscribe to group discussion notifications
 * @route POST /api/v1/groups/:groupId/discussion-notifications/subscribe
 * @access Private (Authenticated User, Group Member)
 */
export const subscribeToGroupDiscussions = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const result = await GroupDiscussionNotificationService.subscribe(groupId, req.user.id);

  res.status(result.alreadySubscribed ? 200 : 201).json({
    success: true,
    message: result.alreadySubscribed
      ? 'Already subscribed to group discussion notifications'
      : 'Successfully subscribed to group discussion notifications',
    data: { subscription: result.subscription },
  });
});

/**
 * @desc Unsubscribe from group discussion notifications
 * @route DELETE /api/v1/groups/:groupId/discussion-notifications/subscribe
 * @access Private (Authenticated User)
 */
export const unsubscribeFromGroupDiscussions = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  await GroupDiscussionNotificationService.unsubscribe(groupId, req.user.id);

  res.json({
    success: true,
    message: 'Successfully unsubscribed from group discussion notifications',
  });
});

/**
 * @desc Check if user is subscribed to group discussion notifications
 * @route GET /api/v1/groups/:groupId/discussion-notifications/status
 * @access Private (Authenticated User)
 */
export const getGroupDiscussionNotificationStatus = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const isSubscribed = await GroupDiscussionNotificationService.isSubscribed(groupId, req.user.id);

  res.json({
    success: true,
    data: { isSubscribed },
  });
});

export const getGroupsLocation = catchAsync(async (req, res) => {
  const { country, state, city, search } = req.query;
  const groupLocations = await GroupService.getGroupsLocation({ country, state, city, search });

  res.json({
    success: true,
    data: { groupLocations },
  });
});

/**
 * @desc Invite users to a group
 * @route POST /api/v1/groups/:groupId/invite
 * @access Private (Group Members)
 */
export const inviteToGroup = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { inviteeIds } = req.body;

  if (!inviteeIds || !Array.isArray(inviteeIds) || inviteeIds.length === 0) {
    throw new ApiError(400, 'inviteeIds array is required and must not be empty');
  }

  const result = await GroupInvitationService.inviteUsersToGroup({
    groupId,
    inviterId: req.user.id,
    inviteeIds,
  });

  res.status(200).json(result);
});
