import { GroupAnalyticsService } from '../services/groupAnalytics.service.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';

/**
 * @desc Get comprehensive group analytics overview
 * @route GET /api/v1/groups/:groupId/analytics/overview
 * @access Private (Group Member/Admin)
 */
export const getGroupAnalyticsOverview = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.id;

  const filters = {
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
  };

  const analytics = await GroupAnalyticsService.getGroupOverview(groupId, userId, filters);

  res.json({
    success: true,
    data: analytics,
  });
});

export const getGroupRevenueAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { startDate, endDate } = req.query;

  const data = await GroupAnalyticsService.getRevenueAnalytics(groupId, req.user.id, {
    startDate,
    endDate,
  });

  res.json({ success: true, data });
});

/**
 * @desc Get member statistics for a group
 * @route GET /api/v1/groups/:groupId/analytics/members
 * @access Private (Group Member/Admin)
 */
export const getGroupMemberAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.id;

  // Verify membership
  const membership = await GroupAnalyticsService.getMemberStatistics(
    groupId,
    req.query.dateFrom,
    req.query.dateTo
  );

  res.json({
    success: true,
    data: membership,
  });
});

/**
 * @desc Get member trends over time
 * @route GET /api/v1/groups/:groupId/analytics/members/trends
 * @access Private (Group Member/Admin)
 */
export const getGroupMemberTrends = catchAsync(async (req, res) => {
  const { groupId } = req.params;

  const trends = await GroupAnalyticsService.getMemberTrends(
    groupId,
    req.query.dateFrom,
    req.query.dateTo
  );

  res.json({
    success: true,
    data: trends,
  });
});

/**
 * @desc Get discussion statistics
 * @route GET /api/v1/groups/:groupId/analytics/discussions
 * @access Private (Group Member/Admin)
 */
export const getGroupDiscussionAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;

  const stats = await GroupAnalyticsService.getDiscussionStatistics(
    groupId,
    req.query.dateFrom,
    req.query.dateTo
  );

  res.json({
    success: true,
    data: stats,
  });
});

/**
 * @desc Get engagement metrics (likes, interactions)
 * @route GET /api/v1/groups/:groupId/analytics/engagement
 * @access Private (Group Member/Admin)
 */
export const getGroupEngagementAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;

  const metrics = await GroupAnalyticsService.getEngagementMetrics(
    groupId,
    req.query.dateFrom,
    req.query.dateTo
  );

  res.json({
    success: true,
    data: metrics,
  });
});

/**
 * @desc Get category-based discussion analytics
 * @route GET /api/v1/groups/:groupId/analytics/categories
 * @access Private (Group Member/Admin)
 */
export const getGroupCategoryAnalytics = catchAsync(async (req, res) => {
  const { groupId } = req.params;

  const categoryStats = await GroupAnalyticsService.getCategoryBasedAnalytics(
    groupId,
    req.query.dateFrom,
    req.query.dateTo
  );

  res.json({
    success: true,
    data: categoryStats,
  });
});

/**
 * @desc Get top contributors in the group
 * @route GET /api/v1/groups/:groupId/analytics/contributors
 * @access Private (Group Member/Admin)
 */
export const getGroupTopContributors = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const limit = parseInt(req.query.limit) || 10;

  const contributors = await GroupAnalyticsService.getTopContributors(
    groupId,
    req.query.dateFrom,
    req.query.dateTo,
    limit
  );

  res.json({
    success: true,
    data: { contributors },
  });
});

/**
 * @desc Get growth comparison between two periods
 * @route GET /api/v1/groups/:groupId/analytics/growth
 * @access Private (Group Member/Admin)
 */
export const getGroupGrowthComparison = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.id;

  // Validate required query params
  const { currentFrom, currentTo, previousFrom, previousTo } = req.query;

  if (!currentFrom || !currentTo || !previousFrom || !previousTo) {
    throw new ApiError(
      400,
      'All date parameters are required: currentFrom, currentTo, previousFrom, previousTo'
    );
  }

  const currentPeriod = { from: currentFrom, to: currentTo };
  const previousPeriod = { from: previousFrom, to: previousTo };

  const comparison = await GroupAnalyticsService.getGrowthComparison(
    groupId,
    userId,
    currentPeriod,
    previousPeriod
  );

  res.json({
    success: true,
    data: comparison,
  });
});

/**
 * @desc Get user interaction summary in a group
 * @route GET /api/v1/groups/:groupId/analytics/users/:targetUserId
 * @access Private (Group Member/Admin)
 */
export const getUserInteractionSummary = catchAsync(async (req, res) => {
  const { groupId, targetUserId } = req.params;
  const requestingUserId = req.user.id;

  const summary = await GroupAnalyticsService.getUserInteractionSummary(
    groupId,
    targetUserId,
    requestingUserId
  );

  res.json({
    success: true,
    data: summary,
  });
});

/**
 * @desc Get aggregated analytics across all groups an organizer owns
 * @route GET /api/v1/groups/analytics/organizer/overview
 * @access Private (Group Organizer)
 */
export const getOrganizerAnalyticsOverview = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const filters = {
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
  };

  const analytics = await GroupAnalyticsService.getOrganizerOverview(userId, filters);

  res.json({
    success: true,
    data: analytics,
  });
});
