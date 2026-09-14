import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  createGroups,
  getGroups,
  getGroupsById,
  getGroupsBySlug,
  updateGroups,
  deleteGroups,
  publishGroups,
  getGroupsAnalytics,
  getMyGroups,
  joinGroups,
  leaveGroups,
  createGroupCategory,
  getGroupCategories,
  deleteGroupCategory,
  updateGroupCategory,
  addGroupMember,
  getGroupMembers,
  updateGroupMemberRole,
  removeGroupMember,
  createEventPromotion,
  getGroupEventPromotions,
  deleteEventPromotion,
  updateJoinRequestStatus,
  joinGroupsRequests,
  addTagsToGroup,
  getGroupTags,
  removeTagFromGroup,
  getGroupsByTags,
  subscribeToGroupDiscussions,
  unsubscribeFromGroupDiscussions,
  getGroupDiscussionNotificationStatus,
  getGroupsLocation,
  inviteToGroup,
  getGroupsInfo,
} from '../controllers/group.controller.js';
import {
  getGroupAnalyticsOverview,
  getGroupMemberAnalytics,
  getGroupMemberTrends,
  getGroupDiscussionAnalytics,
  getGroupEngagementAnalytics,
  getGroupCategoryAnalytics,
  getGroupTopContributors,
  getGroupGrowthComparison,
  getUserInteractionSummary,
  getGroupRevenueAnalytics,
  getOrganizerAnalyticsOverview,
} from '../controllers/groupAnalytics.controller.js';
import {
  createDiscussion,
  getAllDiscussions,
  getDiscussionById,
  updateDiscussion,
  deleteDiscussion,
  toggleDiscussionLike,
  getDiscussionLikes,
  createReply,
  getReplies,
  updateReply,
  deleteReply,
  toggleReplyLike,
  getReplyLikes,
  subscribeToDiscussion,
  unsubscribeFromDiscussion,
  getReportedGroupDiscussions,
  resolveReportedDiscussion,
} from '../controllers/discussion.controller.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { joinWithAnswersSchema } from '../validations/groupQuestion.validation.js';
import { groupAccessMiddleware } from '../middlewares/group.access.middleware.js';
import {
  listGroupTiers,
  createGroupTier,
  updateGroupTier,
  deactivateGroupTier,
  getMyGroupSubscription,
  createGroupCheckoutSession,
  cancelGroupSubscription,
  refundGroupSubscription,
  getGroupSubscriptionPortal,
  listGroupMemberSubscriptions,
  getGroupMemberSubscription,
  adminCancelMemberSubscription,
  adminRefundMemberSubscription,
  checkGroupSubscriptionRefund,
} from '../controllers/groupSubscription.controller.js';
import {
  getGroupCreatorWallet,
  getGroupCreatorWalletSummary,
  listGroupCreatorTransactions,
  requestGroupCashout,
  getGroupCreatorPayouts,
  listPayoutMethods,
  addPayoutMethod,
  setDefaultPayoutMethod,
  deletePayoutMethod,
  listGroupTransactions,
  getGroupWalletSummary,
} from '../controllers/groupEarnings.controller.js';
import groupCourseRouter from './groupCourse.route.js';
import groupResourceRouter from './groupResource.route.js';

const router = express.Router();

// Public routes
router.get('/', getGroups);
router.get('/categories', getGroupCategories);
router.get('/getGroupsInfo/:slug', getGroupsInfo);
router.get('/groupLocations', getGroupsLocation);
router.get('/groupMembers/:groupId/members', getGroupMembers);
router.use(authMiddleware);
router.get('/slug/:slug', groupAccessMiddleware, getGroupsBySlug);
router.get('/getPublicDiscussions', getAllDiscussions);
router.get('/getGroupDiscussions', groupAccessMiddleware, getAllDiscussions);
router.get('/:groupsId', getGroupsById);

// Protected routes

router.post('/', checkBlockedUrl('description', { optional: true, scanText: true }), createGroups);
router.post('/category', createGroupCategory);
router.delete('/categories/:category_id', deleteGroupCategory);
router.put('/categories/:category_id', updateGroupCategory);
router.put(
  '/:groupsId',
  checkBlockedUrl('description', { optional: true, scanText: true }),
  updateGroups
);
router.delete('/:groupsId', deleteGroups);
router.post('/:groupsId/publish', publishGroups);
router.get('/:groupsId/analytics', getGroupsAnalytics);

// ── ORGANIZER-LEVEL ANALYTICS — must be registered BEFORE /:groupId/analytics/*
// so "analytics" as the first segment can never be swallowed by :groupId.
router.get('/analytics/organizer/overview', getOrganizerAnalyticsOverview);

// =====================
// GROUP ANALYTICS ROUTES
// =====================
router.get('/:groupId/analytics/revenue', getGroupRevenueAnalytics);
router.get('/:groupId/analytics/overview', getGroupAnalyticsOverview);
router.get('/:groupId/analytics/members', getGroupMemberAnalytics);
router.get('/:groupId/analytics/members/trends', getGroupMemberTrends);
router.get('/:groupId/analytics/discussions', getGroupDiscussionAnalytics);
router.get('/:groupId/analytics/engagement', getGroupEngagementAnalytics);
router.get('/:groupId/analytics/categories', getGroupCategoryAnalytics);
router.get('/:groupId/analytics/contributors', getGroupTopContributors);
router.get('/:groupId/analytics/growth', getGroupGrowthComparison);
router.get('/:groupId/analytics/users/:targetUserId', getUserInteractionSummary);

router.get('/my/Groups', getMyGroups);
router.post('/join/:groupId', validateMiddleware(joinWithAnswersSchema), joinGroups);
router.get('/joinRequests/:groupId', joinGroupsRequests);
router.delete('/leave/:groupId', leaveGroups);
router.patch('/updateJoinRequestStatus/:requestId', updateJoinRequestStatus);

//  GROUP MEMBERS CRUD for admin
// --------------------

router.post('/:groupId/members', addGroupMember);
router.put('/:groupId/members/:userId', updateGroupMemberRole);
router.delete('/:groupId/members/:userId', removeGroupMember);

// Group Invitations
router.post('/:groupId/invite', inviteToGroup);

// Reported discussions — visible to group admins and moderators only
router.get('/:groupId/reported-discussions', getReportedGroupDiscussions);
router.post('/:groupId/reported-discussions/:reportId/resolve', resolveReportedDiscussion);

// GET /api/discussions - Fetch all discussions (public view)
router.get('/discussion/:discussionId', getDiscussionById);
router.get('/discussion/:discussionId/replies', groupAccessMiddleware, getReplies);
router.get('/discussion/:discussionId/likes/count', groupAccessMiddleware, getDiscussionLikes);

// POST /api/discussions - Create a new discussion
router.post('/discussion', groupAccessMiddleware, createDiscussion);
router.put('/discussion/:discussionId', groupAccessMiddleware, updateDiscussion);
router.delete('/discussion/:discussionId', groupAccessMiddleware, deleteDiscussion);

// LIKES CRUD (TOGGLE)
// --------------------
router.post('/discussion/:discussionId/likes', groupAccessMiddleware, toggleDiscussionLike);

// REPLIES CRUD
// -------------------
router.post('/discussion/:discussionId/replies', groupAccessMiddleware, createReply);
router.post('/discussion/:discussionId/subscribe', groupAccessMiddleware, subscribeToDiscussion);
router.delete(
  '/discussion/:discussionId/subscribe',
  groupAccessMiddleware,
  unsubscribeFromDiscussion
);

router.put('/discussion/replies/:replyId', groupAccessMiddleware, updateReply);
router.delete('/discussion/replies/:replyId', groupAccessMiddleware, deleteReply);

// Reply likes
router.post('/discussion/replies/:replyId/likes', groupAccessMiddleware, toggleReplyLike);
router.get('/discussion/replies/:replyId/likes', groupAccessMiddleware, getReplyLikes);

// EVENT PROMOTIONS
// -------------------
router.post('/events/:eventId/promote', authMiddleware, createEventPromotion);
router.get('/:groupId/promotions', groupAccessMiddleware, getGroupEventPromotions);
router.delete('/promotions/:promotionId', groupAccessMiddleware, deleteEventPromotion);

//group tags

router.post('/groups-tags/:groupId/tags', authMiddleware, addTagsToGroup);

// get tags of a group
router.get('/groups-tags/:groupId/tags', getGroupTags);

// remove single tag from group
router.delete('/groups-tags/:groupId/tags/:tagId', authMiddleware, removeTagFromGroup);

// search groups-tags by tags
router.get('/groups-tags/by-tags', getGroupsByTags);

// Group Discussion Notifications
router.post('/:groupId/discussion-notifications/subscribe', subscribeToGroupDiscussions);
router.delete('/:groupId/discussion-notifications/subscribe', unsubscribeFromGroupDiscussions);
router.get('/:groupId/discussion-notifications/status', getGroupDiscussionNotificationStatus);

// ── GROUP SUBSCRIPTION TIERS (creator-only write, authenticated read) ──────
router.get('/:groupId/subscription/tiers', listGroupTiers);
router.post('/:groupId/subscription/tiers', createGroupTier);
router.put('/:groupId/subscription/tiers/:tierId', updateGroupTier);
router.delete('/:groupId/subscription/tiers/:tierId', deactivateGroupTier);

// ── USER SUBSCRIPTION MANAGEMENT ────────────────────────────────────
router.get('/:groupId/subscription/me', getMyGroupSubscription);
router.get('/:groupId/subscription/me/refund', checkGroupSubscriptionRefund);
router.post('/:groupId/subscription/checkout', createGroupCheckoutSession);
router.post('/:groupId/subscription/cancel', cancelGroupSubscription);
router.post('/:groupId/subscription/refund', refundGroupSubscription);
router.post('/:groupId/subscription/portal', getGroupSubscriptionPortal);

// ── CREATOR ADMIN — MEMBER SUBSCRIPTION MANAGEMENT ──────────────────
router.get('/:groupId/subscription/admin/members', listGroupMemberSubscriptions);
router.get('/:groupId/subscription/admin/members/:userId', getGroupMemberSubscription);
router.post('/:groupId/subscription/admin/members/:userId/cancel', adminCancelMemberSubscription);
router.post('/:groupId/subscription/admin/members/:userId/refund', adminRefundMemberSubscription);

// ── GROUP CREATOR WALLET (all groups) ────────────────────────────────
// /my/wallet/* routes are multi-segment — safe from /:groupsId wildcard
router.get('/my/wallet', getGroupCreatorWallet);
router.get('/my/wallet/summary', getGroupCreatorWalletSummary);
router.get('/my/wallet/transactions', listGroupCreatorTransactions);
router.post('/my/wallet/cashout', requestGroupCashout);
router.get('/my/wallet/payouts', getGroupCreatorPayouts);

// ── GROUP CREATOR PAYOUT METHODS ─────────────────────────────────────
router.get('/my/payout-methods', listPayoutMethods);
router.post('/my/payout-methods', addPayoutMethod);
router.put('/my/payout-methods/:methodId/default', setDefaultPayoutMethod);
router.delete('/my/payout-methods/:methodId', deletePayoutMethod);

// ── PER-GROUP WALLET (creator only) ──────────────────────────────────
router.get('/:groupId/wallet/transactions', listGroupTransactions);
router.get('/:groupId/wallet/summary', getGroupWalletSummary);

// ── GROUP COURSES ─────────────────────────────────────────────────────
router.use('/:groupId/courses', groupCourseRouter);

// ── GROUP RESOURCES ────────────────────────────────────────────────────
router.use('/:groupId/resources', groupResourceRouter);

export default router;