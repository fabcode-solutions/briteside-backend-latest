import express from 'express';
import { z } from 'zod';
import { adminController, } from '../controllers/admin.controller.js';
import { usernameReservationController } from '../controllers/usernameReservation.controller.js';
import { contactController } from '../controllers/contact.controller.js';
import { authMiddleware, requireAdmin } from '../middlewares/auth.middleware.js';
import {
  getAdminTalentDashboardStats,
  adminListReportedReviews,
  adminRemoveTalentReview,
  adminDismissReviewReport,
} from '../controllers/talent.controller.js';
import { FEATURE_REGISTRY } from '../constants/features.js';
import { catchAsync } from '../utils/catch-async.js';
import { reportController } from '../controllers/report.controller.js';
import { adminListVenues, adminGetVenue } from '../controllers/venue.controller.js';
import { demoController } from '../controllers/demo.controller.js';
import {
  adminListIssues,
  adminGetIssue,
  adminResolveIssue,
} from '../controllers/talentIssue.controller.js';
import {
  adminListShopRefundRequests,
  adminOverrideShopRefundRequest,
} from '../controllers/shop.controller.js';
import {
  listConnectAccounts,
  getUserConnectStatus,
  getUserStripeDashboard,
  getUserWallet,
  getUserWalletSummary,
  getUserTransactions,
  getUserPayouts,
  getUserEarnings,
  listAllPayouts,
} from '../controllers/adminEarnings.controller.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  getReserveSummary,
  listReserves,
  triggerReserveRelease,
  adminAdjustOrderReserveAmount,
  adminReleaseOrderReserveEarly,
  adminReleaseEventReserveEarly,
  adminReleaseOrganizerReservesEarly,
} from '../controllers/reserves.controller.js';

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authMiddleware, requireAdmin);

// Validation middleware
const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    console.log('Validation error:', error);
    next(error);
  }
};
// Validation schemas
const updateReportStatusSchema = z.object({
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']),
  actionTaken: z.string().optional(),
});

const toggleSuspensionSchema = z.object({
  isSuspended: z.boolean(),
  reason: z.string().min(1, 'Reason is required').optional(),
  duration: z.number().positive().optional(), // Duration in days
  reportId: z.string().uuid().optional(),
});

const deletePostSchema = z.object({
  reason: z.string().optional(),
  reportId: z.string().uuid().optional(),
});

const reviewModerationItemSchema = z.object({
  action: z.enum(['keep', 'flag', 'remove', 'shadow', 'shadow_block']),
  reason: z.string().max(1000).optional(),
});

const createCategorySchema = z.object({
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(100, 'Category name cannot exceed 100 characters'),
  description: z.string().optional(),
  iconUrl: z.string().url('Icon URL must be a valid URL').optional(),
  emoji: z.string().max(10, 'Emoji cannot exceed 10 characters').optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  iconUrl: z.string().url('Icon URL must be a valid URL').optional(),
  emoji: z.string().max(10).optional(),
});

const createLogoSchema = z.object({
  name: z.string().min(1, 'Logo name is required').max(30, 'Name must be 30 characters or fewer'),
  url: z.string().min(1, 'Logo image is required'),
  coverType: z.enum(['image', 'video']).optional(),
});

const updateLogoSchema = z.object({
  name: z.string().min(1).max(30, 'Name must be 30 characters or fewer').optional(),
  url: z.string().min(1).optional(),
  coverType: z.enum(['image', 'video']).optional(),
});

const updateReservationStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewNotes: z.string().max(2000).optional(),
  rejectionReason: z.string().max(1000).optional(),
});

const contactMessageStatusSchema = z.object({
  status: z.enum(['new', 'sent', 'failed', 'read', 'archived']),
});

// Report management routes
router.get('/reports/statistics', adminController.getReportStatistics);
router.get('/reports', reportController.getReports);
router.patch(
  '/reports/:reportId/status',
  validate(updateReportStatusSchema),
  adminController.updateReportStatus
);

// User moderation routes
router.patch(
  '/users/:userId/suspension',
  validate(toggleSuspensionSchema),
  adminController.toggleUserSuspension
);

// Post moderation routes
router.delete('/posts/:postId', validate(deletePostSchema), adminController.deletePost);

// Content moderation dashboard routes (images/videos)
router.get('/moderation/media', adminController.listMediaModerationQueue);
router.patch(
  '/moderation/media/:id/action',
  validate(reviewModerationItemSchema),
  adminController.reviewMediaModerationItem
);
router.get('/moderation/calls', adminController.listCallModerationQueue);

// Logo library management routes (shared "popular covers" picker)
router.get('/logos', adminController.listLogos);
router.post('/logos', checkBlockedUrl('url'), validate(createLogoSchema), adminController.createLogo);
router.patch(
  '/logos/:logoId',
  checkBlockedUrl('url', { optional: true }),
  validate(updateLogoSchema),
  adminController.updateLogo
);
router.delete('/logos/:logoId', adminController.deleteLogo);

// Category management routes
router.post('/categories', validate(createCategorySchema), adminController.createCategory);
router.patch(
  '/categories/:categoryId',
  validate(updateCategorySchema),
  adminController.updateCategory
);
router.delete('/categories/:categoryId', adminController.deleteCategory);

// Username Reservation management routes
router.get('/reservations/statistics', usernameReservationController.getReservationStatistics);
router.get('/reservations', usernameReservationController.getReservations);
router.get('/reservations/:reservationId', usernameReservationController.getReservationById);
router.patch(
  '/reservations/:reservationId/status',
  validate(updateReservationStatusSchema),
  usernameReservationController.updateReservationStatus
);

// Contact messages (admin)
router.get('/contact-messages', catchAsync(contactController.getContactMessages));
router.get('/contact-messages/:id', catchAsync(contactController.getContactMessageById));
router.patch(
  '/contact-messages/:id/status',
  validate(contactMessageStatusSchema),
  catchAsync(contactController.updateContactMessageStatus)
);

// Platform fee management (admin only — auth required)
const platformFeeSchema = z.object({
  percentage: z
    .number({ invalid_type_error: 'Percentage must be a number' })
    .min(0, 'Percentage cannot be negative')
    .max(100, 'Percentage cannot exceed 100'),
});

router.get('/platform-fee/manage', adminController.getPlatformFeePercentage);
router.patch(
  '/platform-fee',
  validate(platformFeeSchema),
  adminController.updatePlatformFeePercentage
);

// Add Zod schema at top with other schemas:
const verifyTalentSchema = z.object({
  isVerified: z.boolean(),
  note: z.string().max(500).optional(),
});

const reviewAppealSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  adminResponse: z.string().optional(),
  newSuspendedUntil: z.string().datetime().optional().nullable(),
});

// Add routes (before the export default router line):
router.get('/talent', adminController.listTalentForVerification);

router.patch(
  '/talent/:talentProfileId/verify',
  validate(verifyTalentSchema),
  adminController.verifyTalent
);

router.get('/talent/:talentProfileId/dashboard-stats', getAdminTalentDashboardStats);

// ─── QUERY VALIDATION HELPER ─────────────────────────────────────────────────
const validateQuery = schema => (req, res, next) => {
  try {
    const parsed = schema.parse(req.query);
    res.locals.validatedQuery = parsed;
    next();
  } catch (error) {
    next(error);
  }
};

// ─── NEW VALIDATION SCHEMAS ──────────────────────────────────────────────────

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const userListQuery = paginationQuery.extend({
  search: z.string().optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  sortBy: z.enum(['createdAt', 'firstName', 'email']).default('createdAt'),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().max(20).optional(),
  bio: z.string().max(1000).optional(),
  image: z.string().url().optional(),
});

const assignRoleSchema = z.object({
  roleName: z.string().min(1),
});

const eventListQuery = paginationQuery.extend({
  search: z.string().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
  sortBy: z.enum(['createdAt', 'startDate', 'title']).default('createdAt'),
});

const reasonSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

const optionalReasonSchema = z.object({
  reason: z.string().optional(),
});

const groupListQuery = paginationQuery.extend({
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'name', 'memberCount']).default('createdAt'),
});

const postListQuery = paginationQuery.extend({
  userId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'likesCount']).default('createdAt'),
});

const bulkReportStatusSchema = z.object({
  reportIds: z.array(z.string().uuid()).min(1),
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']),
  actionTaken: z.string().optional(),
});

// ─── ANALYTICS QUERY SCHEMAS ─────────────────────────────────────────────────

const analyticsEventsQuery = paginationQuery.extend({
  search: z.string().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(['createdAt', 'startDate', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const analyticsDateRangeQuery = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const growthQuery = z.object({
  currentFrom: z.string(),
  currentTo: z.string(),
  previousFrom: z.string(),
  previousTo: z.string(),
});

const ticketSalesQuery = paginationQuery.extend({
  search: z.string().optional(),
  eventId: z.string().uuid().optional(),
});

const orderListQuery = paginationQuery.extend({
  status: z.enum(['pending', 'paid', 'cancelled']).optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  sortBy: z.enum(['createdAt', 'totalAmount', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const refundListQuery = paginationQuery.extend({
  status: z.string().optional(),
});
const adminRefundStatusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(1000).optional(),
});
const updateGroupAdminSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  subscriptionPrice: z.number().nonnegative().optional(),
  maxMembers: z.number().int().positive().optional(),
  categoryId: z.string().uuid().optional(),
  coverImageUrl: z.string().url().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});
// ─── USER MANAGEMENT ROUTES ──────────────────────────────────────────────────

router.get('/users', validateQuery(userListQuery), adminController.listUsers);
router.get('/users/:userId', adminController.getUserById);
router.patch('/users/:userId', validate(updateUserSchema), adminController.updateUser);
router.delete('/users/:userId', adminController.deleteUser);
router.post('/users/:userId/roles', validate(assignRoleSchema), adminController.assignUserRole);
router.delete('/users/:userId/roles/:roleName', adminController.removeUserRole);

// ── Add near the USER MANAGEMENT ROUTES section of admin.routes.js ──────────

const impersonateUserSchema = z.object({
  reason: z.string().max(500).optional(),
});

router.post(
  '/users/:userId/impersonate',
  validate(impersonateUserSchema),
  adminController.impersonateUser
);

// ─── EVENT MODERATION ROUTES ─────────────────────────────────────────────────

router.get('/events', validateQuery(eventListQuery), adminController.listEvents);
router.get('/events/:eventId', adminController.getEventById);
router.put(
  '/events/:eventId',
  checkBlockedUrl('title', { optional: true, scanText: true }),
  checkBlockedUrl('description', { optional: true, scanText: true }),
  checkBlockedUrl('shortDescription', { optional: true, scanText: true }),
  checkBlockedUrl('location', { optional: true, scanText: true }),
  checkBlockedUrl('youtubeVideoUrl', { optional: true }),
  adminController.updateEventByAdmin
);
router.patch('/events/:eventId/cancel', validate(reasonSchema), adminController.cancelEvent);
router.delete('/events/:eventId', validate(optionalReasonSchema), adminController.deleteEvent);

// ─── GROUP MODERATION ROUTES ─────────────────────────────────────────────────

router.get('/groups', validateQuery(groupListQuery), adminController.listGroups);
router.get('/groups/:groupId', adminController.getGroupById);
router.patch('/groups/:groupId',validate(updateGroupAdminSchema),adminController.updateGroupByAdmin);
router.get('/groups/:groupId/subscriptions', catchAsync(adminController.getGroupSubscriptions));
router.delete('/groups/:groupId', validate(optionalReasonSchema), adminController.deleteGroupById);
router.delete(
  '/groups/:groupId/members/:userId',
  validate(optionalReasonSchema),
  adminController.removeGroupMember
);

// ─── SOCIAL MODERATION ROUTES ────────────────────────────────────────────────

router.get('/posts', validateQuery(postListQuery), adminController.listPosts);
router.delete(
  '/comments/:commentId',
  validate(optionalReasonSchema),
  adminController.deleteCommentById
);

// ─── REPORTS ENHANCED ROUTES ─────────────────────────────────────────────────

const resolveReportSchema = z.object({
  action: z.enum(['delete', 'cancel', 'suspend']).default('delete'),
  reason: z.string().min(1, 'Reason is required'),
});

router.patch(
  '/reports/bulk-status',
  validate(bulkReportStatusSchema),
  adminController.bulkUpdateReportStatus
);
router.post(
  '/reports/:reportId/resolve',
  validate(resolveReportSchema),
  adminController.resolveReportedEntity
);
router.get('/reports/:reportId', adminController.getReportById);

// ─── DASHBOARD ROUTE ─────────────────────────────────────────────────────────

router.get('/dashboard', adminController.getDashboardStats);

// ─── ANALYTICS — EVENTS ─────────────────────────────────────────────────────

router.get(
  '/analytics/events',
  validateQuery(analyticsEventsQuery),
  adminController.getAllEventsAnalyticsAdmin
);
router.get('/analytics/events/:eventId', adminController.getEventAnalyticsAdmin);
router.get('/analytics/events/:eventId/sales', adminController.getEventSalesAdmin);
router.get('/analytics/events/:eventId/audience', adminController.getEventAudienceAdmin);
router.get(
  '/analytics/events/:eventId/ticket-performance',
  adminController.getEventTicketPerformanceAdmin
);
router.get('/analytics/events/:eventId/engagement', adminController.getEventEngagementAdmin);
router.get(
  '/analytics/events/:eventId/ticket-sales',
  validateQuery(ticketSalesQuery),
  adminController.getEventTicketSalesAdmin
);

// ─── ANALYTICS — TICKET SALES (PLATFORM-WIDE) ───────────────────────────────

router.get(
  '/analytics/ticket-sales',
  validateQuery(ticketSalesQuery),
  adminController.getAllTicketSalesAdmin
);

// ─── ANALYTICS — GROUPS ──────────────────────────────────────────────────────

router.get(
  '/analytics/groups/:groupId',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupAnalyticsAdmin
);
router.get(
  '/analytics/groups/:groupId/members',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupMemberAnalyticsAdmin
);
router.get(
  '/analytics/groups/:groupId/members/trends',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupMemberTrendsAdmin
);
router.get(
  '/analytics/groups/:groupId/discussions',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupDiscussionAnalyticsAdmin
);
router.get(
  '/analytics/groups/:groupId/engagement',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupEngagementAdmin
);
router.get(
  '/analytics/groups/:groupId/categories',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupCategoryAnalyticsAdmin
);
router.get(
  '/analytics/groups/:groupId/contributors',
  validateQuery(analyticsDateRangeQuery),
  adminController.getGroupTopContributorsAdmin
);
router.get(
  '/analytics/groups/:groupId/growth',
  validateQuery(growthQuery),
  adminController.getGroupGrowthAdmin
);

// ─── ANALYTICS — SOCIAL ─────────────────────────────────────────────────────

router.get(
  '/analytics/posts/:postId',
  validateQuery(analyticsDateRangeQuery),
  adminController.getPostAnalyticsAdmin
);
router.get(
  '/analytics/users/:userId/social',
  validateQuery(analyticsDateRangeQuery),
  adminController.getProfileAnalyticsAdmin
);

// ─── USER DATA ───────────────────────────────────────────────────────────────

router.get('/users/:userId/tickets', adminController.getUserTicketsAdmin);
router.get(
  '/users/:userId/orders',
  validateQuery(orderListQuery),
  adminController.getUserOrdersAdmin
);
router.get('/users/:userId/orders/:orderId', adminController.getUserOrderDetailAdmin);
router.get(
  '/refunds',
  validateQuery(refundListQuery.extend({ overdue: z.string().optional() })),
  adminController.listAllRefundsAdmin
);
router.get(
  '/users/:userId/refunds',
  validateQuery(refundListQuery),
  adminController.getUserRefundsAdmin
);
router.get('/users/:userId/refunds/:refundId', adminController.getUserRefundDetailAdmin);
router.patch(
  '/refunds/:refundId/status',
  validate(adminRefundStatusSchema),
  adminController.respondToRefundAdmin
);
router.delete('/refunds/:refundId', adminController.deleteRefundRequestAdmin);
// ─── SUBSCRIPTION MANAGEMENT SCHEMAS ─────────────────────────────────────────

const createSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative(),
  interval: z.enum(['month', 'year']),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().nonnegative().default(0),
  features: z
    .array(
      z.object({
        featureKey: z.string().min(1).max(100),
        featureLabel: z.string().min(1).max(255),
      })
    )
    .optional(),
});

const updateSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative().optional(),
  interval: z.enum(['month', 'year']).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

const addFeatureSchema = z.object({
  featureKey: z.string().min(1).max(100),
  featureLabel: z.string().min(1).max(255),
});

const grantSubscriptionSchema = z.object({
  userId: z.string().uuid(),
  planId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});

const revokeSubscriptionSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const subscriptionListQuery = paginationQuery.extend({
  status: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'status', 'currentPeriodEnd']).default('createdAt'),
});

// ─── SUBSCRIPTION MANAGEMENT ROUTES ──────────────────────────────────────────

// Plans
router.post(
  '/subscriptions/plans',
  validate(createSubscriptionPlanSchema),
  adminController.createSubscriptionPlan
);
router.get('/subscriptions/plans', adminController.listSubscriptionPlans);
router.get('/subscriptions/plans/:planId', adminController.getSubscriptionPlan);
router.patch(
  '/subscriptions/plans/:planId',
  validate(updateSubscriptionPlanSchema),
  adminController.updateSubscriptionPlan
);
router.patch('/subscriptions/plans/:planId/deactivate', adminController.deactivateSubscriptionPlan);

// Plan features
// Registry — returns all available feature keys so admin UI knows what to assign
router.get('/subscriptions/features/registry', (req, res) => {
  res.json({ success: true, features: FEATURE_REGISTRY });
});
router.post(
  '/subscriptions/plans/:planId/features',
  validate(addFeatureSchema),
  adminController.addFeatureToPlan
);
router.delete(
  '/subscriptions/plans/:planId/features/:featureId',
  adminController.removeFeatureFromPlan
);

// User subscriptions
router.get(
  '/subscriptions',
  validateQuery(subscriptionListQuery),
  adminController.listAllUserSubscriptions
);
// Move analytics route before dynamic :subscriptionId route to avoid route parameter collision
router.get('/subscriptions/analytics', adminController.getSubscriptionAnalytics);
router.get('/subscriptions/coupons', adminController.listSubscriptionCoupons);
router.post('/subscriptions/sync-all', adminController.syncAllSubscriptionFlags);
router.get('/subscriptions/:subscriptionId', adminController.getUserSubscriptionDetail);
router.post(
  '/subscriptions/grant',
  validate(grantSubscriptionSchema),
  adminController.grantSubscriptionToUser
);
router.post('/subscriptions/users/:userId/sync', adminController.syncUserSubscriptionFlag);
router.patch(
  '/subscriptions/:subscriptionId/revoke',
  validate(revokeSubscriptionSchema),
  adminController.revokeUserSubscription
);

// ─── SUBSCRIPTION COUPON ROUTES ───────────────────────────────────────────────

const createCouponSchema = z.object({
  name: z.string().min(1).max(100),
  percentOff: z.number().int().min(1).max(100),
  durationMonths: z.number().int().positive().optional(),
  maxRedemptions: z.number().int().positive().optional(),
  couponId: z.string().max(100).optional(),
});

const applyCouponSchema = z.object({
  couponId: z.string().min(1),
});

router.post(
  '/subscriptions/coupons',
  validate(createCouponSchema),
  adminController.createSubscriptionCoupon
);
router.post(
  '/subscriptions/:subscriptionId/coupon',
  validate(applyCouponSchema),
  adminController.applySubscriptionCoupon
);
router.delete('/subscriptions/:subscriptionId/coupon', adminController.removeSubscriptionCoupon);

const updateCouponSchema = z.object({
  name: z.string().min(1).max(100),
});

router.patch(
  '/subscriptions/coupons/:couponId',
  validate(updateCouponSchema),
  adminController.updateSubscriptionCoupon
);
router.delete('/subscriptions/coupons/:couponId', adminController.deleteSubscriptionCoupon);

// ─── TEAM ROLE MANAGEMENT ────────────────────────────────────────────────────

const createTeamRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

const updateTeamRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

const orderReserveAdjustSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_amount'),
    amountCents: z.number().int().nonnegative(),
    reason: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('adjust_amount'),
    deltaCents: z.number().int(),
    reason: z.string().max(1000).optional(),
  }),
]);

const releaseReasonSchema = z.object({
  reason: z.string().max(1000).optional(),
});


router.get('/team-roles', adminController.listTeamRoles);
router.post('/team-roles', validate(createTeamRoleSchema), adminController.createTeamRole);
router.patch('/team-roles/:roleId', validate(updateTeamRoleSchema), adminController.updateTeamRole);
router.delete('/team-roles/:roleId', adminController.deleteTeamRole);

// ─── VENUE MANAGEMENT ────────────────────────────────────────────────────────

router.get('/venues', adminListVenues);
router.get('/venues/:venueId', adminGetVenue);

// ─── RESERVES ────────────────────────────────────────────────────────────────

router.get('/reserves/summary', catchAsync(getReserveSummary));
router.get('/reserves', catchAsync(listReserves));
router.post('/reserves/release', catchAsync(triggerReserveRelease));

router.patch(
  '/reserves/orders/:orderId/adjust',
  validate(orderReserveAdjustSchema),
  adminAdjustOrderReserveAmount
);
router.post(
  '/reserves/orders/:orderId/release',
  validate(releaseReasonSchema),
  adminReleaseOrderReserveEarly
);
router.post(
  '/reserves/events/:eventId/release',
  validate(releaseReasonSchema),
  adminReleaseEventReserveEarly
);
router.post(
  '/reserves/organizers/:organizerId/release',
  validate(releaseReasonSchema),
  adminReleaseOrganizerReservesEarly
);

// ─── ACTIVITY LOGS ───────────────────────────────────────────────────────────
router.get('/activity-logs', adminController.getActivityLogs);

// ─── APPEALS MANAGEMENT ──────────────────────────────────────────────────────
router.get('/appeals', adminController.listAppeals);
router.patch(
  '/appeals/:appealId/review',
  validate(reviewAppealSchema),
  adminController.reviewAppeal
);

// ─── EARNINGS & WALLET (ADMIN) ────────────────────────────────────────────────

// List all users who have Stripe Connect accounts
// ?connectStatus=incomplete|onboarded|enabled &isSuspended=true|false &search &page &limit &sortOrder
router.get('/connect-accounts', catchAsync(listConnectAccounts));

// Platform-wide payout list (all talent cash-out requests)
// ?status=pending|approved|paid|rejected|failed &userId &type &start &end &page &limit &sortOrder
router.get('/payouts', catchAsync(listAllPayouts));

// Per-user earnings/wallet endpoints (works for talents and organizers)
router.get('/users/:userId/connect-status', catchAsync(getUserConnectStatus));
router.get('/users/:userId/stripe-dashboard', catchAsync(getUserStripeDashboard));
router.get('/users/:userId/wallet', catchAsync(getUserWallet));
router.get('/users/:userId/wallet-summary', catchAsync(getUserWalletSummary));
router.get('/users/:userId/transactions', catchAsync(getUserTransactions));
router.get('/users/:userId/payouts', catchAsync(getUserPayouts));
router.get('/users/:userId/earnings', catchAsync(getUserEarnings));

// ─── DEMO SESSIONS (ADMIN) ────────────────────────────────────────────────────

const createDemoSessionSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int().positive().default(60),
    maxParticipants: z.number().int().positive().optional(),
    notes: z.string().optional(),
    sessionType: z.enum(['event', 'influencer', 'group']).optional(),
    meetingType: z.enum(['stream', 'external']).default('stream'),
    externalMeetingLink: z.string().url().optional(),
  })
  .refine(data => data.meetingType !== 'external' || !!data.externalMeetingLink, {
    message: 'externalMeetingLink is required when meetingType is external',
    path: ['externalMeetingLink'],
  });

const demoSessionsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['upcoming', 'active', 'completed', 'cancelled']).optional(),
});

const demoRegistrationsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const updateDemoSessionStatusSchema = z.object({
  status: z.enum(['upcoming', 'active', 'completed', 'cancelled']),
});

const updateDemoSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive().optional(),
  maxParticipants: z.number().int().positive().optional(),
  notes: z.string().optional(),
  sessionType: z.enum(['event', 'influencer', 'group']).optional(),
  externalMeetingLink: z.string().url().optional(),
});

router.post(
  '/demo-sessions',
  validate(createDemoSessionSchema),
  catchAsync(demoController.createSession)
);
router.get(
  '/demo-sessions',
  validateQuery(demoSessionsQuery),
  catchAsync(demoController.listSessions)
);
router.patch(
  '/demo-sessions/:sessionId',
  validate(updateDemoSessionSchema),
  catchAsync(demoController.updateSession)
);
router.patch(
  '/demo-sessions/:sessionId/status',
  validate(updateDemoSessionStatusSchema),
  catchAsync(demoController.updateStatus)
);
router.delete('/demo-sessions/:sessionId', catchAsync(demoController.deleteSession));
router.get(
  '/demo-sessions/:sessionId/registrations',
  validateQuery(demoRegistrationsQuery),
  catchAsync(demoController.listRegistrations)
);

// ─── TALENT ISSUES ────────────────────────────────────────────────────────────

const resolveIssueSchema = z.object({
  action: z.enum(['refund', 'warn', 'dismiss']),
  adminNote: z.string().max(2000).optional(),
  refundFullAmount: z.boolean().optional(),
});

// ─── SHOP REFUND REQUESTS ─────────────────────────────────────────────────────
// The seller rules first; an admin can overturn a rejection. An approval is
// terminal, because the money has already moved.

const overrideShopRefundSchema = z.object({
  action: z.enum(['approve', 'reject']),
  resolutionNote: z.string().max(2000).optional(),
});

router.get('/shop-refund-requests', adminListShopRefundRequests);
router.patch(
  '/shop-refund-requests/:requestId/override',
  validate(overrideShopRefundSchema),
  adminOverrideShopRefundRequest
);

router.get('/talent-issues', catchAsync(adminListIssues));
router.get('/talent-issues/:issueId', catchAsync(adminGetIssue));
router.patch(
  '/talent-issues/:issueId/resolve',
  validate(resolveIssueSchema),
  catchAsync(adminResolveIssue)
);

// ─── TALENT REVIEWS (ADMIN MODERATION) ───────────────────────────────────────
// GET  /admin/talent-reviews          — list all reviews reported by talents
// PATCH /admin/talent-reviews/:id/remove — hide a review + recompute rating

router.get('/talent-reviews', catchAsync(adminListReportedReviews));
router.patch('/talent-reviews/:reviewId/remove', catchAsync(adminRemoveTalentReview));
router.patch('/talent-reviews/:reviewId/dismiss', catchAsync(adminDismissReviewReport));

export default router;
