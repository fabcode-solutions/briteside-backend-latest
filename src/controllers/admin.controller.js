import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { adminService } from '../services/admin.service.js';
import ApiError from '../utils/api-error.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { GroupAnalyticsService } from '../services/groupAnalytics.service.js';
import { SocialAnalyticsService } from '../services/social/socialAnalytics.service.js';
import { TicketService } from '../services/ticket.service.js';
import { OrderService } from '../services/order.service.js';
import { RefundService } from '../services/refund.service.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { EventTeamService } from '../services/eventTeam.service.js';
import * as appealService from '../services/appeal.service.js';
import { GroupCourseService } from '../services/groupCourse.service.js';
import { GroupSubscriptionService } from '../services/groupSubscription.service.js';
import { MediaModerationService } from '../services/moderation/mediaModeration.service.js';
import { TalentSessionService } from '../services/talentSession.service.js';
import { PopularCoverService } from '../services/social/popularCover.service.js';

/**
 * Update report status
 * @route PATCH /api/admin/reports/:reportId/status
 */
const updateReportStatus = catchAsync(async (req, res) => {
  const { reportId } = req.params;
  const { status, actionTaken } = req.body;

  if (!status) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Status is required');
  }

  const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Status must be one of: ${validStatuses.join(', ')}`
    );
  }

  const report = await adminService.updateReportStatus(
    reportId,
    { status, actionTaken },
    req.user.id
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Report status updated successfully',
    data: report,
  });
});

/**
 * Toggle user suspension (suspend or unsuspend)
 * @route PATCH /api/admin/users/:userId/suspension
 */
const toggleUserSuspension = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const { isSuspended, reason, duration, reportId } = req.body;

  if (isSuspended === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'isSuspended field is required');
  }

  if (isSuspended && !reason) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Suspension reason is required when suspending');
  }

  const user = await adminService.toggleUserSuspension(
    userId,
    { isSuspended, reason, duration, reportId },
    req.user.id
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: isSuspended ? 'User suspended successfully' : 'User unsuspended successfully',
    data: user,
  });
});

/**
 * Delete a post (soft delete)
 * @route DELETE /api/admin/posts/:postId
 */
const deletePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const { reason, reportId } = req.body;

  const post = await adminService.deletePost(postId, { reason, reportId }, req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Post deleted successfully',
    data: post,
  });
});

/**
 * Get report statistics
 * @route GET /api/admin/reports/statistics
 */
const getReportStatistics = catchAsync(async (req, res) => {
  const stats = await adminService.getReportStatistics();

  res.status(httpStatus.OK).json({
    success: true,
    data: stats,
  });
});

/**
 * Create a new category
 * @route POST /api/admin/categories
 */
const createCategory = catchAsync(async (req, res) => {
  const { name, description, iconUrl, emoji } = req.body;

  const category = await adminService.createCategory({
    name,
    description,
    iconUrl,
    emoji,
  });

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Category created successfully',
    data: category,
  });
});

/**
 * Update a category
 * @route PATCH /api/admin/categories/:categoryId
 */
const updateCategory = catchAsync(async (req, res) => {
  const { categoryId } = req.params;
  const { name, description, iconUrl, emoji } = req.body;

  const category = await adminService.updateCategory(categoryId, {
    name,
    description,
    iconUrl,
    emoji,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Category updated successfully',
    data: category,
  });
});

/**
 * Delete a category
 * @route DELETE /api/admin/categories/:categoryId
 */
const deleteCategory = catchAsync(async (req, res) => {
  const { categoryId } = req.params;

  await adminService.deleteCategory(categoryId);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Category deleted successfully',
  });
});

/**
 * List logos in the shared popular-covers library
 * @route GET /api/admin/logos
 */
const listLogos = catchAsync(async (req, res) => {
  const logos = await PopularCoverService.list();

  res.status(httpStatus.OK).json({
    success: true,
    data: logos,
  });
});

/**
 * Add a logo to the shared popular-covers library.
 * Admin-added logos are system-seeded (no owner), so regular users can't
 * remove them — only another admin can, via deleteLogo.
 * @route POST /api/admin/logos
 */
const createLogo = catchAsync(async (req, res) => {
  const { name, url, coverType } = req.body;

  const logo = await PopularCoverService.add(null, { name, url, coverType });

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Logo added successfully',
    data: logo,
  });
});

/**
 * Update a logo in the shared popular-covers library — bypasses the
 * ownership check regular users are subject to, so any admin can edit any
 * logo including system-seeded ones.
 * @route PATCH /api/admin/logos/:logoId
 */
const updateLogo = catchAsync(async (req, res) => {
  const { logoId } = req.params;
  const { name, url, coverType } = req.body;

  const logo = await PopularCoverService.adminUpdate(logoId, { name, url, coverType });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Logo updated successfully',
    data: logo,
  });
});

/**
 * Delete a logo from the shared popular-covers library — bypasses the
 * ownership check regular users are subject to.
 * @route DELETE /api/admin/logos/:logoId
 */
const deleteLogo = catchAsync(async (req, res) => {
  const { logoId } = req.params;

  await PopularCoverService.adminRemove(logoId);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Logo deleted successfully',
  });
});

/**
 * Get current platform fee percentage
 * @route GET /api/admin/platform-fee
 */
const getPlatformFeePercentage = catchAsync(async (req, res) => {
  const data = await adminService.getPlatformFeePercentage();

  res.status(httpStatus.OK).json({
    success: true,
    data: { percentage: data.percentage },
  });
});

/**
 * Update platform fee percentage
 * @route PATCH /api/admin/platform-fee
 */
const updatePlatformFeePercentage = catchAsync(async (req, res) => {
  const { percentage } = req.body;

  const data = await adminService.updatePlatformFeePercentage(percentage, req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Platform fee percentage updated successfully',
    data,
  });
});
/**
 * List all talent profiles for verification review.
 * Supports filtering by verification status.
 *
 * @route GET /api/admin/talent
 * @query isVerified  'true' | 'false' | omit for all
 * @query page, limit
 */
const listTalentForVerification = catchAsync(async (req, res) => {
  const { isVerified, page = 1, limit = 20 } = req.query;

  const result = await adminService.listTalentForVerification({
    isVerified: isVerified === undefined ? undefined : isVerified === 'true',
    page: parseInt(page),
    limit: parseInt(limit),
  });

  res.status(httpStatus.OK).json({ success: true, data: result });
});

/**
 * Verify or unverify a talent profile.
 *
 * @route PATCH /api/admin/talent/:talentProfileId/verify
 * @body { isVerified: boolean, note?: string }
 */
const verifyTalent = catchAsync(async (req, res) => {
  const { talentProfileId } = req.params;
  const { isVerified, note } = req.body;

  if (typeof isVerified !== 'boolean') {
    throw new ApiError(httpStatus.BAD_REQUEST, '`isVerified` must be a boolean');
  }

  const profile = await adminService.setTalentVerification(
    talentProfileId,
    isVerified,
    req.user.id,
    note
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: isVerified ? 'Talent profile verified' : 'Talent verification removed',
    data: { profile },
  });
});

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

const listUsers = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const { page, limit, search, status, sortBy } = query;
  const result = await adminService.listUsers({ page, limit, search, status, sortBy });
  res.status(httpStatus.OK).json({ success: true, data: result });
});

const getUserById = catchAsync(async (req, res) => {
  const user = await adminService.getAdminUserById(req.params.userId);
  res.status(httpStatus.OK).json({ success: true, data: user });
});

const updateUser = catchAsync(async (req, res) => {
  const user = await adminService.updateUserByAdmin(req.params.userId, req.body, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'User updated successfully', data: user });
});

const deleteUser = catchAsync(async (req, res) => {
  const user = await adminService.deleteUserByAdmin(req.params.userId, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'User deleted successfully', data: user });
});

const assignUserRole = catchAsync(async (req, res) => {
  const result = await adminService.assignRole(req.params.userId, req.body.roleName, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Role assigned successfully', data: result });
});

const removeUserRole = catchAsync(async (req, res) => {
  const result = await adminService.removeRole(req.params.userId, req.params.roleName, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Role removed successfully', data: result });
});

// ─── EVENT MODERATION ─────────────────────────────────────────────────────────

const listEvents = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const { page, limit, search, status, sortBy } = query;
  const result = await adminService.listAllEvents({ page, limit, search, status, sortBy });
  res.status(httpStatus.OK).json({ success: true, data: result });
});

const getEventById = catchAsync(async (req, res) => {
  const event = await adminService.getAdminEventById(req.params.eventId);
  res.status(httpStatus.OK).json({ success: true, data: event });
});

const cancelEvent = catchAsync(async (req, res) => {
  const event = await adminService.cancelEvent(req.params.eventId, req.body.reason, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Event cancelled successfully', data: event });
});

const updateEventByAdmin = catchAsync(async (req, res) => {
  const event = await adminService.updateEventByAdmin(req.params.eventId, req.body, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Event updated successfully', data: event });
});

const deleteEvent = catchAsync(async (req, res) => {
  const event = await adminService.deleteEvent(req.params.eventId, req.body.reason, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Event deleted successfully', data: event });
});

// ─── GROUP MODERATION ─────────────────────────────────────────────────────────

const listGroups = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const { page, limit, search, sortBy } = query;
  const result = await adminService.listAllGroups({ page, limit, search, sortBy });
  res.status(httpStatus.OK).json({ success: true, data: result });
});

const getGroupById = catchAsync(async (req, res) => {
  const group = await adminService.getAdminGroupById(req.params.groupId);
  res.status(httpStatus.OK).json({ success: true, data: group });
});

const deleteGroupById = catchAsync(async (req, res) => {
  const group = await adminService.deleteGroup(req.params.groupId, req.body.reason, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Group deleted successfully', data: group });
});

const updateGroupByAdmin = catchAsync(async (req, res) => {
  const group = await adminService.updateGroupByAdmin(req.params.groupId, req.body, req.user.id);
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Group updated successfully', data: group });
});

const removeGroupMember = catchAsync(async (req, res) => {
  const result = await adminService.removeGroupMember(
    req.params.groupId,
    req.params.userId,
    req.body.reason,
    req.user.id
  );
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Member removed successfully', data: result });
});

const getGroupSubscriptions = catchAsync(async (req, res) => {
  const data = await GroupSubscriptionService.getGroupSubscriptionsForAdmin(req.params.groupId);
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── SOCIAL MODERATION ────────────────────────────────────────────────────────

const listPosts = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const { page, limit, userId, sortBy } = query;
  const result = await adminService.listAllPosts({ page, limit, userId, sortBy });
  res.status(httpStatus.OK).json({ success: true, data: result });
});

const deleteCommentById = catchAsync(async (req, res) => {
  const result = await adminService.deleteComment(
    req.params.commentId,
    req.body.reason,
    req.user.id
  );
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Comment deleted successfully', data: result });
});

// ─── REPORTS ENHANCED ─────────────────────────────────────────────────────────

const getReportById = catchAsync(async (req, res) => {
  const report = await adminService.getReportById(req.params.reportId);
  res.status(httpStatus.OK).json({ success: true, data: report });
});

const resolveReportedEntity = catchAsync(async (req, res) => {
  const { action, reason } = req.body;
  const result = await adminService.resolveReportedEntity(
    req.params.reportId,
    action,
    reason,
    req.user.id
  );
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Reported entity removed and report resolved', data: result });
});

const bulkUpdateReportStatus = catchAsync(async (req, res) => {
  const { reportIds, status, actionTaken } = req.body;
  const result = await adminService.bulkUpdateReportStatus(
    reportIds,
    status,
    actionTaken,
    req.user.id
  );
  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Reports updated successfully', data: result });
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

const getDashboardStats = catchAsync(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.status(httpStatus.OK).json({ success: true, data: stats });
});

// ─── Event Analytics ───
const getAllEventsAnalyticsAdmin = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await AnalyticsService.getOrganizerEvents(null, query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventAnalyticsAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await AnalyticsService.getEventAnalytics(eventId, null, query, { isAdmin: true });
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Events overview (admin-wide) ───
const getAdminEventsOverview = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await AnalyticsService.getOrganizerOverview(null, query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventSalesAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const data = await AnalyticsService.getEventSalesAnalytics(eventId);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventAudienceAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const data = await AnalyticsService.getEventAudienceAnalytics(eventId);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventTicketPerformanceAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const data = await AnalyticsService.getTicketPerformanceAnalytics(eventId);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventEngagementAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const data = await AnalyticsService.getEventEngagementAnalytics(eventId);
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Group Analytics ───
const getGroupAnalyticsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getGroupOverview(groupId, null, query, {
    isAdmin: true,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupMemberAnalyticsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getMemberStatistics(groupId, dateFrom, dateTo);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupMemberTrendsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getMemberTrends(groupId, dateFrom, dateTo);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupDiscussionAnalyticsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getDiscussionStatistics(groupId, dateFrom, dateTo);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupEngagementAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getEngagementMetrics(groupId, dateFrom, dateTo);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupCategoryAnalyticsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getCategoryBasedAnalytics(groupId, dateFrom, dateTo);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupTopContributorsAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { dateFrom, dateTo, limit } = res.locals.validatedQuery || req.query;
  const data = await GroupAnalyticsService.getTopContributors(
    groupId,
    dateFrom,
    dateTo,
    limit ? parseInt(limit) : undefined
  );
  res.status(httpStatus.OK).json({ success: true, data });
});

const getGroupGrowthAdmin = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { currentFrom, currentTo, previousFrom, previousTo } =
    res.locals.validatedQuery || req.query;
  if (!currentFrom || !currentTo || !previousFrom || !previousTo) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'currentFrom, currentTo, previousFrom, previousTo are required'
    );
  }
  const currentPeriod = { from: currentFrom, to: currentTo };
  const previousPeriod = { from: previousFrom, to: previousTo };
  const data = await GroupAnalyticsService.getGrowthComparison(
    groupId,
    null,
    currentPeriod,
    previousPeriod,
    { isAdmin: true }
  );
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Social Analytics ───
const getPostAnalyticsAdmin = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await SocialAnalyticsService.getPostAnalytics(postId, null, query, {
    isAdmin: true,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

const getProfileAnalyticsAdmin = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await SocialAnalyticsService.getProfileAnalytics(userId, null, query, {
    isAdmin: true,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Ticket Sales ───
const getAllTicketSalesAdmin = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await TicketService.getOrganizerAllSales(null, query, { isAdmin: true });
  res.status(httpStatus.OK).json({ success: true, data });
});

const getEventTicketSalesAdmin = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await TicketService.getOrganizerEventTickets(null, eventId, query, {
    isAdmin: true,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── User Data ───
const getUserTicketsAdmin = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const data = await TicketService.getUserTickets(userId);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getUserOrdersAdmin = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await OrderService.listUserOrders(userId, query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getUserOrderDetailAdmin = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const data = await OrderService.getOrderById(orderId, null);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getUserRefundsAdmin = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const query = res.locals.validatedQuery || req.query;
  const data = await RefundService.listUserRefunds(userId, null, false, query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getUserRefundDetailAdmin = catchAsync(async (req, res) => {
  const { refundId } = req.params;
  const data = await RefundService.getRefundById(refundId, null);
  res.status(httpStatus.OK).json({ success: true, data });
});
const respondToRefundAdmin = catchAsync(async (req, res) => {
  const { refundId } = req.params;
  const { status, reason } = req.body;

  if (!status) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'status is required');
  }

  const result = await RefundService.adminUpdateRefund(refundId, req.user.id, { status, reason });

  res.status(httpStatus.OK).json({
    success: true,
    message:
      status === 'approved' ? 'Refund approved successfully' : 'Refund rejected successfully',
    data: result,
  });
});
const deleteRefundRequestAdmin = catchAsync(async (req, res) => {
  const { refundId } = req.params;

  const deleted = await RefundService.deleteRefundRequest(refundId, req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Refund request deleted successfully',
    data: deleted,
  });
});
// ─── SUBSCRIPTION MANAGEMENT ─────────────────────────────────────────────────

const createSubscriptionPlan = catchAsync(async (req, res) => {
  const plan = await SubscriptionService.createPlan(req.body, req.user.id);
  res.status(httpStatus.CREATED).json({ success: true, message: 'Plan created', data: plan });
});

const updateSubscriptionPlan = catchAsync(async (req, res) => {
  const plan = await SubscriptionService.updatePlan(req.params.planId, req.body, req.user.id);
  res.json({ success: true, message: 'Plan updated', data: plan });
});

const deactivateSubscriptionPlan = catchAsync(async (req, res) => {
  await SubscriptionService.deactivatePlan(req.params.planId, req.user.id);
  res.json({ success: true, message: 'Plan deactivated' });
});

const getSubscriptionPlan = catchAsync(async (req, res) => {
  const plan = await SubscriptionService.getPlan(req.params.planId);
  res.json({ success: true, data: plan });
});

const listSubscriptionPlans = catchAsync(async (req, res) => {
  const plans = await SubscriptionService.listPlans({ includeInactive: true });
  res.json({ success: true, data: plans });
});

const addFeatureToPlan = catchAsync(async (req, res) => {
  const feature = await SubscriptionService.addFeatureToPlan(
    req.params.planId,
    req.body,
    req.user.id
  );
  res.status(httpStatus.CREATED).json({ success: true, message: 'Feature added', data: feature });
});

const removeFeatureFromPlan = catchAsync(async (req, res) => {
  await SubscriptionService.removeFeatureFromPlan(
    req.params.planId,
    req.params.featureId,
    req.user.id
  );
  res.json({ success: true, message: 'Feature removed' });
});

const listAllUserSubscriptions = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const result = await SubscriptionService.listAllSubscriptions(query);
  res.json({ success: true, data: result });
});

const getUserSubscriptionDetail = catchAsync(async (req, res) => {
  const subscription = await SubscriptionService.getSubscriptionById(req.params.subscriptionId);
  res.json({ success: true, data: subscription });
});

const grantSubscriptionToUser = catchAsync(async (req, res) => {
  const { userId, planId, reason } = req.body;
  const subscription = await SubscriptionService.grantSubscription(
    userId,
    planId,
    req.user.id,
    reason
  );
  res
    .status(httpStatus.CREATED)
    .json({ success: true, message: 'Subscription granted', data: subscription });
});

const revokeUserSubscription = catchAsync(async (req, res) => {
  const { reason } = req.body;
  await SubscriptionService.revokeSubscription(req.params.subscriptionId, req.user.id, reason);
  res.json({ success: true, message: 'Subscription revoked' });
});

const syncUserSubscriptionFlag = catchAsync(async (req, res) => {
  await SubscriptionService._syncPlusFlag(req.params.userId);
  res.json({ success: true, message: 'Subscription flag synced' });
});

const syncAllSubscriptionFlags = catchAsync(async (req, res) => {
  const result = await SubscriptionService.syncAllPlusFlags();
  res.json({ success: true, message: `Synced ${result.synced} users`, data: result });
});

const getSubscriptionAnalytics = catchAsync(async (req, res) => {
  console.log('Admin requesting subscription analytics');
  const analytics = await SubscriptionService.getSubscriptionAnalytics();
  res.json({ success: true, data: analytics });
});

const createSubscriptionCoupon = catchAsync(async (req, res) => {
  const coupon = await SubscriptionService.createCoupon(req.body, req.user.id);
  res.status(httpStatus.CREATED).json({ success: true, message: 'Coupon created', data: coupon });
});

const listSubscriptionCoupons = catchAsync(async (req, res) => {
  const { limit, starting_after } = req.query;
  const result = await SubscriptionService.listCoupons({
    limit: limit ? parseInt(limit, 10) : 20,
    startingAfter: starting_after,
  });
  res.json({ success: true, data: result });
});

const applySubscriptionCoupon = catchAsync(async (req, res) => {
  const result = await SubscriptionService.applyCouponToSubscription(
    req.params.subscriptionId,
    req.body.couponId,
    req.user.id
  );
  res.json({ success: true, message: 'Coupon applied', data: result });
});

const removeSubscriptionCoupon = catchAsync(async (req, res) => {
  const result = await SubscriptionService.removeCouponFromSubscription(
    req.params.subscriptionId,
    req.user.id
  );
  res.json({ success: true, message: 'Coupon removed', data: result });
});

const updateSubscriptionCoupon = catchAsync(async (req, res) => {
  const coupon = await SubscriptionService.updateCoupon(req.params.couponId, req.body, req.user.id);
  res.json({ success: true, message: 'Coupon updated', data: coupon });
});

const deleteSubscriptionCoupon = catchAsync(async (req, res) => {
  const result = await SubscriptionService.deleteCoupon(req.params.couponId, req.user.id);
  res.json({ success: true, message: 'Coupon deleted', data: result });
});

// ─── TEAM ROLE MANAGEMENT (universal / platform-level) ─────────────────────

const listTeamRoles = catchAsync(async (req, res) => {
  const roles = await EventTeamService.getAllRoles();
  res.json({ success: true, data: roles });
});

const createTeamRole = catchAsync(async (req, res) => {
  const role = await EventTeamService.createRole(req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: role });
});

const updateTeamRole = catchAsync(async (req, res) => {
  const role = await EventTeamService.updateRole(req.params.roleId, req.body);
  res.json({ success: true, data: role });
});

const deleteTeamRole = catchAsync(async (req, res) => {
  await EventTeamService.deleteRole(req.params.roleId);
  res.json({ success: true, message: 'Team role deleted' });
});

// ─── Activity Logs ────────────────────────────────────────────────────────────

const getActivityLogs = catchAsync(async (req, res) => {
  const { page, limit, action, resourceType, adminId, dateFrom, dateTo } = req.query;
  const data = await adminService.getActivityLogs({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
    action,
    resourceType,
    adminId,
    dateFrom,
    dateTo,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

const getOverviewStats = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getOverviewStats(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getUserMetrics = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getUserMetrics(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getMauTrend = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getMauTrend(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getSignupsTrend = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getSignupsTrend(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getDemographicsStats = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getDemographicsStats(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

const getInterestsAnalytics = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await adminService.getInterestsAnalytics(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Group Course Analytics (admin) ───────────────────────────────────────────

const getGroupCourseAnalyticsAdmin = catchAsync(async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const data = await GroupCourseService.getAdminCourseAnalytics({ dateFrom, dateTo });
  res.status(httpStatus.OK).json({ success: true, data });
});

// ─── Appeals (admin side) ─────────────────────────────────────────────────────

const listAppeals = catchAsync(async (req, res) => {
  const { page, limit, status } = req.query;
  const data = await appealService.listAppeals({
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
    status,
  });
  res.status(httpStatus.OK).json({ success: true, ...data });
});

const reviewAppeal = catchAsync(async (req, res) => {
  const { appealId } = req.params;
  const { decision, adminResponse, newSuspendedUntil } = req.body;
  const appeal = await appealService.reviewAppeal(
    appealId,
    decision,
    adminResponse,
    newSuspendedUntil ? new Date(newSuspendedUntil) : null,
    req.user.id
  );
  res.status(httpStatus.OK).json({ success: true, data: appeal });
});

const listAllRefundsAdmin = catchAsync(async (req, res) => {
  const query = res.locals.validatedQuery || req.query;
  const data = await RefundService.listAllRefundsAdmin(query);
  res.status(httpStatus.OK).json({ success: true, data });
});

/**
 * List image/video content_moderation rows for the admin dashboard.
 * @route GET /api/admin/moderation/media
 */
const listMediaModerationQueue = catchAsync(async (req, res) => {
  const { status, entityType, page, limit } = req.query;
  const data = await MediaModerationService.queryModerationQueue({
    status,
    entityType,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

/**
 * List talent sessions with call-moderation history (frame verdicts).
 * @route GET /api/admin/moderation/calls
 */
const listCallModerationQueue = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const data = await TalentSessionService.listModeratedSessions({
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  res.status(httpStatus.OK).json({ success: true, data });
});

/**
 * Admin manually approves/rejects/flags/shadow-bans a moderated media entity.
 * @route PATCH /api/admin/moderation/media/:id/action
 */
const reviewMediaModerationItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  const item = await MediaModerationService.reviewEntity({
    id,
    action,
    adminId: req.user.id,
    reason,
  });

  res
    .status(httpStatus.OK)
    .json({ success: true, message: 'Moderation item reviewed', data: item });
});

const impersonateUser = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
 
  const result = await adminService.impersonateUser(userId, req.user.id, reason);
 
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Impersonation session started',
    data: result,
  });
});
 

export const adminController = {
  // Existing
  updateReportStatus,
  toggleUserSuspension,
  deletePost,
  listMediaModerationQueue,
  reviewMediaModerationItem,
  listCallModerationQueue,
  getReportStatistics,
  listLogos,
  createLogo,
  updateLogo,
  deleteLogo,
  createCategory,
  updateCategory,
  deleteCategory,
  getPlatformFeePercentage,
  updatePlatformFeePercentage,
  listTalentForVerification,
  verifyTalent,
  // User management
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  assignUserRole,
  removeUserRole,
  // Event moderation
  listEvents,
  getEventById,
  cancelEvent,
  deleteEvent,
  // Group moderation
  listGroups,
  getGroupById,
  updateGroupByAdmin,
  getGroupSubscriptions,
  deleteGroupById,
  removeGroupMember,
  // Social moderation
  listPosts,
  deleteCommentById,
  // Reports enhanced
  getReportById,
  resolveReportedEntity,
  bulkUpdateReportStatus,
  // Dashboard
  getDashboardStats,
  // Analytics — Events
  getAllEventsAnalyticsAdmin,
  getEventAnalyticsAdmin,
  getEventSalesAdmin,
  getEventAudienceAdmin,
  getEventTicketPerformanceAdmin,
  getEventEngagementAdmin,
  // Analytics — Groups
  getGroupAnalyticsAdmin,
  getGroupMemberAnalyticsAdmin,
  getGroupMemberTrendsAdmin,
  getGroupDiscussionAnalyticsAdmin,
  getGroupEngagementAdmin,
  getGroupCategoryAnalyticsAdmin,
  getGroupTopContributorsAdmin,
  getGroupGrowthAdmin,
  // Analytics — Social
  getPostAnalyticsAdmin,
  getProfileAnalyticsAdmin,
  // Ticket Sales
  getAllTicketSalesAdmin,
  getEventTicketSalesAdmin,
  // User Data
  getUserTicketsAdmin,
  getUserOrdersAdmin,
  getUserOrderDetailAdmin,
  getUserRefundsAdmin,
  getUserRefundDetailAdmin,
  respondToRefundAdmin,
  deleteRefundRequestAdmin,
  // Subscriptions
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deactivateSubscriptionPlan,
  getSubscriptionPlan,
  listSubscriptionPlans,
  addFeatureToPlan,
  removeFeatureFromPlan,
  listAllUserSubscriptions,
  getUserSubscriptionDetail,
  grantSubscriptionToUser,
  revokeUserSubscription,
  syncUserSubscriptionFlag,
  syncAllSubscriptionFlags,
  getSubscriptionAnalytics,
  createSubscriptionCoupon,
  listSubscriptionCoupons,
  applySubscriptionCoupon,
  removeSubscriptionCoupon,
  updateSubscriptionCoupon,
  deleteSubscriptionCoupon,
  // Team role management
  listTeamRoles,
  createTeamRole,
  updateTeamRole,
  deleteTeamRole,
  // Activity logs
  getActivityLogs,
  // Stats
  getOverviewStats,
  getUserMetrics,
  getMauTrend,
  getSignupsTrend,
  getDemographicsStats,
  getInterestsAnalytics,
  // Appeals
  listAppeals,
  reviewAppeal,
  // Group Courses
  getGroupCourseAnalyticsAdmin,
  listAllRefundsAdmin,
  impersonateUser,
  updateEventByAdmin,
  getAdminEventsOverview,
  

};
