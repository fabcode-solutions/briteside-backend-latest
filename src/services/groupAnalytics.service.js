import { db } from '../db/index.js';
import {
  groups,
  groupMembers,
  discussions,
  discussionLikes,
  discussionReplies,
  discussionReplyLikes,
  discussionCategories,
  categories,
  groupCategories,
} from '../db/schema/index.js';
import { groupSubscriptions, groupSubscriptionTiers } from '../db/schema/subscriptions.js';
import { eq, and, desc, count, avg, gte, lte, sql, between, isNull, inArray } from 'drizzle-orm';
import dayjs from 'dayjs';
import ApiError from '../utils/api-error.js';
import { GroupService } from './group.service.js';
import { parseDate, parseDateToISO, getDaysAgo, getDateRange } from '../utils/helper.js';
import {
  verifyGroupMembership,
  getGroupDiscussionIds,
  getGroupDiscussions,
  requireGroupAdminOrModerator,
} from '../utils/group-helpers.js';

export class GroupAnalyticsService {
  /**
   * Get comprehensive group analytics overview
   */
  static async getGroupOverview(groupId, userId, filters = {}, { isAdmin = false } = {}) {
    try {
      // Verify user is a member/admin of the group
      if (!isAdmin) {
        await verifyGroupMembership(groupId, userId, {
          errorMessage: 'Unauthorized to view analytics for this group.',
        });
      }

      const { dateFrom, dateTo } = filters;

      // Get basic group info
      const group = await db.query.groups.findFirst({
        where: eq(groups.id, groupId),
        with: {
          category: true,
        },
      });

      if (!group) {
        throw new ApiError(404, 'Group not found');
      }

      // Fetch all analytics in parallel
      const [
        memberStats,
        memberTrends,
        discussionStats,
        engagementMetrics,
        categoryAnalytics,
        topContributors,
      ] = await Promise.all([
        this.getMemberStatistics(groupId, dateFrom, dateTo),
        this.getMemberTrends(groupId, dateFrom, dateTo),
        this.getDiscussionStatistics(groupId, dateFrom, dateTo),
        this.getEngagementMetrics(groupId, dateFrom, dateTo),
        this.getCategoryBasedAnalytics(groupId, dateFrom, dateTo),
        this.getTopContributors(groupId, dateFrom, dateTo),
      ]);

      return {
        group: {
          id: group.id,
          name: group.name,
          category: group.category,
          isPublic: group.isPublic,
          createdAt: group.createdAt,
        },
        memberStats,
        memberTrends,
        discussionStats,
        engagementMetrics,
        categoryAnalytics,
        topContributors,
        dateRange: {
          from: dateFrom || null,
          to: dateTo || null,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get group overview analytics error:', error);
      throw new ApiError(500, 'Failed to get group analytics overview');
    }
  }

  static async getRevenueAnalytics(groupId, userId, { startDate, endDate } = {}) {
    await requireGroupAdminOrModerator(groupId, userId, 'Unauthorized to view revenue analytics.');

    const group = await db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), isNull(groups.deletedAt)),
      columns: { id: true, isPaid: true, name: true, memberCount: true },
    });

    if (!group) throw new ApiError(404, 'Group not found.');
    if (!group.isPaid)
      throw new ApiError(403, 'Revenue analytics are only available for paid groups.');

    // ── Fetch active subscription tiers for this group ────────────
    const subscriptionTiers = await db.query.groupSubscriptionTiers.findMany({
      where: and(
        eq(groupSubscriptionTiers.groupId, groupId),
        eq(groupSubscriptionTiers.isActive, true)
      ),
      orderBy: groupSubscriptionTiers.price,
    });

    // ── Active subscribers with per-tier pricing ─────────────────
    const activeSubscriptions = await db
      .select({
        id: groupSubscriptions.id,
        userId: groupSubscriptions.userId,
        tierId: groupSubscriptions.tierId,
        status: groupSubscriptions.status,
        currentPeriodEnd: groupSubscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: groupSubscriptions.cancelAtPeriodEnd,
        platformFeePercent: groupSubscriptions.platformFeePercent,
        tierPrice: groupSubscriptionTiers.price,
        tierName: groupSubscriptionTiers.name,
        tierBillingInterval: groupSubscriptionTiers.billingInterval,
        createdAt: groupSubscriptions.createdAt,
      })
      .from(groupSubscriptions)
      .innerJoin(groupSubscriptionTiers, eq(groupSubscriptions.tierId, groupSubscriptionTiers.id))
      .where(
        and(
          eq(groupSubscriptions.groupId, groupId),
          inArray(groupSubscriptions.status, ['active', 'trialing'])
        )
      );

    const payingMembersCount = activeSubscriptions.length;

    // MRR: normalise annual plans to monthly
    const monthlyRecurringRevenue = activeSubscriptions.reduce((sum, sub) => {
      const price = parseFloat(sub.tierPrice ?? 0);
      return sum + (sub.tierBillingInterval === 'yearly' ? price / 12 : price);
    }, 0);

    // Platform fee total (local computation — no Stripe Connect)
    const platformFeeTotal = activeSubscriptions.reduce((sum, sub) => {
      const price = parseFloat(sub.tierPrice ?? 0);
      const feePercent = parseFloat(sub.platformFeePercent ?? 0);
      const monthly = sub.tierBillingInterval === 'yearly' ? price / 12 : price;
      return sum + monthly * (feePercent / 100);
    }, 0);

    // ── Tier breakdown ────────────────────────────────────────────
    const tierMap = {};
    for (const sub of activeSubscriptions) {
      if (!tierMap[sub.tierId]) {
        tierMap[sub.tierId] = {
          tierId: sub.tierId,
          tierName: sub.tierName,
          price: parseFloat(sub.tierPrice ?? 0),
          billingInterval: sub.tierBillingInterval,
          subscriberCount: 0,
          mrr: 0,
        };
      }
      const price = parseFloat(sub.tierPrice ?? 0);
      tierMap[sub.tierId].subscriberCount++;
      tierMap[sub.tierId].mrr += sub.tierBillingInterval === 'yearly' ? price / 12 : price;
    }
    const tierBreakdown = Object.values(tierMap);

    // ── Period-scoped metrics ─────────────────────────────────────
    const periodConditions = [eq(groupSubscriptions.groupId, groupId)];
    if (startDate)
      periodConditions.push(sql`${groupSubscriptions.createdAt} >= ${new Date(startDate)}`);
    if (endDate)
      periodConditions.push(sql`${groupSubscriptions.createdAt} <= ${new Date(endDate)}`);

    const periodSubscriptions = await db
      .select({
        status: groupSubscriptions.status,
        tierPrice: groupSubscriptionTiers.price,
        tierBillingInterval: groupSubscriptionTiers.billingInterval,
      })
      .from(groupSubscriptions)
      .innerJoin(groupSubscriptionTiers, eq(groupSubscriptions.tierId, groupSubscriptionTiers.id))
      .where(and(...periodConditions));

    const newSubscribersInPeriod = periodSubscriptions.filter(s => s.status !== 'cancelled').length;
    const cancellationsInPeriod = periodSubscriptions.filter(s => s.status === 'cancelled').length;
    const totalRevenue = periodSubscriptions.reduce(
      (sum, sub) => sum + parseFloat(sub.tierPrice ?? 0),
      0
    );
    const churnBase = payingMembersCount + cancellationsInPeriod;
    const churnRate =
      churnBase > 0 ? parseFloat(((cancellationsInPeriod / churnBase) * 100).toFixed(2)) : 0;

    // ── Daily revenue breakdown ───────────────────────────────────
    const dailyRows = await db
      .select({
        date: sql`DATE(${groupSubscriptions.createdAt})`.as('date'),
        newSubscribers: count(),
      })
      .from(groupSubscriptions)
      .where(and(...periodConditions))
      .groupBy(sql`DATE(${groupSubscriptions.createdAt})`)
      .orderBy(sql`DATE(${groupSubscriptions.createdAt}) ASC`);

    const revenueByPeriod = dailyRows.map(row => ({
      date: row.date,
      newSubscribers: Number(row.newSubscribers),
    }));

    // ── Previous period comparison ────────────────────────────────
    let previousPeriodRevenue = 0;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - diffMs);

      const prevSubs = await db
        .select({ tierPrice: groupSubscriptionTiers.price })
        .from(groupSubscriptions)
        .innerJoin(groupSubscriptionTiers, eq(groupSubscriptions.tierId, groupSubscriptionTiers.id))
        .where(
          and(
            eq(groupSubscriptions.groupId, groupId),
            sql`${groupSubscriptions.createdAt} >= ${prevStart}`,
            sql`${groupSubscriptions.createdAt} <= ${prevEnd}`
          )
        );

      previousPeriodRevenue = prevSubs.reduce((sum, s) => sum + parseFloat(s.tierPrice ?? 0), 0);
    }

    return {
      subscriptionTiers,
      totalRevenue,
      previousPeriodRevenue,
      monthlyRecurringRevenue,
      payingMembersCount,
      totalMembersCount: Number(group.memberCount ?? payingMembersCount),
      averageRevenuePerMember:
        payingMembersCount > 0 ? monthlyRecurringRevenue / payingMembersCount : 0,
      platformFeeTotal,
      tierBreakdown,
      newSubscribersInPeriod,
      cancellationsInPeriod,
      churnRate,
      revenueByPeriod,
    };
  }



static async getOrganizerOverview(userId, filters = {}) {
  try {
    const { dateFrom, dateTo } = filters;

    const organizerGroups = await db.query.groups.findMany({
      where: and(eq(groups.createdBy, userId), isNull(groups.deletedAt)),
      columns: {
        id: true,
        name: true,
        slug: true,
        coverImageUrl: true,
        isPublic: true,
        isPaid: true,
        memberCount: true,
        createdAt: true,
      },
    });

    if (organizerGroups.length === 0) {
      return {
        totalGroups: 0,
        paidGroupsCount: 0,
        totals: {
          totalMembers: 0,
          newMembersInRange: 0,
          pendingRequests: 0,
          totalDiscussions: 0,
          discussionsInRange: 0,
          totalReplies: 0,
          repliesInRange: 0,
          totalPosts: 0,
          postsInRange: 0,
          totalLikes: 0,
          payingMembersCount: 0,
          monthlyRecurringRevenue: 0,
          totalRevenue: 0,
          platformFeeTotal: 0,
        },
        groups: [],
        dateRange: { from: dateFrom || null, to: dateTo || null },
      };
    }

    // Fetch stats per group in parallel. Revenue is only fetched for
    // paid groups, and permission failures (e.g. an edge case where the
    // creator isn't also an admin groupMember) are swallowed to null so
    // one group's hiccup doesn't break the whole overview.
    const perGroupStats = await Promise.all(
      organizerGroups.map(async group => {
        const [memberStats, discussionStats, engagementMetrics, revenue] = await Promise.all([
          this.getMemberStatistics(group.id, dateFrom, dateTo),
          this.getDiscussionStatistics(group.id, dateFrom, dateTo),
          this.getEngagementMetrics(group.id, dateFrom, dateTo),
          group.isPaid
            ? this.getRevenueAnalytics(group.id, userId, {
                startDate: dateFrom,
                endDate: dateTo,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        return {
          group: {
            id: group.id,
            name: group.name,
            slug: group.slug,
            coverImageUrl: group.coverImageUrl,
            isPublic: group.isPublic,
            isPaid: group.isPaid,
            memberCount: group.memberCount,
            createdAt: group.createdAt,
          },
          memberStats,
          discussionStats,
          engagementMetrics,
          revenue,
        };
      })
    );

    // Aggregate grand totals across every group
    const totals = perGroupStats.reduce(
      (acc, { memberStats, discussionStats, engagementMetrics, revenue }) => {
        acc.totalMembers += memberStats.totalMembers;
        acc.newMembersInRange += memberStats.newMembersInRange;
        acc.pendingRequests += memberStats.pendingRequests;
        acc.totalDiscussions += discussionStats.totalDiscussions;
        acc.discussionsInRange += discussionStats.discussionsInRange;
        acc.totalReplies += discussionStats.totalReplies;
        acc.repliesInRange += discussionStats.repliesInRange;
        acc.totalPosts += discussionStats.totalPosts;
        acc.postsInRange += discussionStats.postsInRange;
        acc.totalLikes += engagementMetrics.totalLikes;
        if (revenue) {
          acc.payingMembersCount += revenue.payingMembersCount;
          acc.monthlyRecurringRevenue += revenue.monthlyRecurringRevenue;
          acc.totalRevenue += revenue.totalRevenue;
          acc.platformFeeTotal += revenue.platformFeeTotal;
        }
        return acc;
      },
      {
        totalMembers: 0,
        newMembersInRange: 0,
        pendingRequests: 0,
        totalDiscussions: 0,
        discussionsInRange: 0,
        totalReplies: 0,
        repliesInRange: 0,
        totalPosts: 0,
        postsInRange: 0,
        totalLikes: 0,
        payingMembersCount: 0,
        monthlyRecurringRevenue: 0,
        totalRevenue: 0,
        platformFeeTotal: 0,
      }
    );

    return {
      totalGroups: organizerGroups.length,
      paidGroupsCount: organizerGroups.filter(g => g.isPaid).length,
      totals,
      groups: perGroupStats,
      dateRange: { from: dateFrom || null, to: dateTo || null },
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Get organizer analytics overview error:', error);
    throw new ApiError(500, 'Failed to get organizer analytics overview');
  }
}

  /**
   * Get member statistics
   */
  static async getMemberStatistics(groupId, dateFrom, dateTo) {
    try {
      let dateConditions = [];

      if (dateFrom) {
        dateConditions.push(gte(groupMembers.joinedAt, parseDate(dateFrom)));
      }
      if (dateTo) {
        dateConditions.push(lte(groupMembers.joinedAt, parseDate(dateTo)));
      }

      // Total members
      const totalMembersQuery = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')));

      // New members in date range
      const newMembersQuery = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.status, 'joined'),
            ...dateConditions
          )
        );

      // Member role distribution
      const roleDistribution = await db
        .select({
          role: groupMembers.role,
          count: count(),
        })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')))
        .groupBy(groupMembers.role);

      // Get members who joined in last 7 days (for growth rate calculation)
      const sevenDaysAgo = getDaysAgo(7);

      const recentMembersQuery = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.status, 'joined'),
            gte(groupMembers.joinedAt, sevenDaysAgo)
          )
        );

      // Pending join requests
      const pendingRequests = await GroupService.getPendingJoinRequests(null, groupId);

      const totalMembers = totalMembersQuery[0]?.count || 0;
      const recentMembers = recentMembersQuery[0]?.count || 0;

      return {
        totalMembers,
        newMembersInRange: newMembersQuery[0]?.count || 0,
        pendingRequests: pendingRequests.data?.total || 0,
        membersJoinedLast7Days: recentMembers,
        weeklyGrowthRate:
          totalMembers > 0 ? parseFloat(((recentMembers / totalMembers) * 100).toFixed(2)) : 0,
        roleDistribution: roleDistribution.map(r => ({
          role: r.role,
          count: r.count,
        })),
      };
    } catch (error) {
      console.error('Get member statistics error:', error);
      throw new ApiError(500, 'Failed to get member statistics');
    }
  }

  /**
   * Get member trends over time
   */
  static async getMemberTrends(groupId, dateFrom, dateTo) {
    try {
      // Default to last 30 days if no date range provided
      const { startDate, endDate } = getDateRange(dateFrom, dateTo);

      // Daily member join trend
      const dailyJoins = await db
        .select({
          date: sql`DATE(${groupMembers.joinedAt})`,
          newMembers: count(),
        })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.status, 'joined'),
            between(groupMembers.joinedAt, startDate, endDate)
          )
        )
        .groupBy(sql`DATE(${groupMembers.joinedAt})`)
        .orderBy(sql`DATE(${groupMembers.joinedAt})`);

      // Calculate cumulative member count
      let cumulativeCount = 0;
      const trendsWithCumulative = dailyJoins.map(day => {
        cumulativeCount += day.newMembers;
        return {
          date: day.date,
          newMembers: day.newMembers,
          cumulativeTotal: cumulativeCount,
        };
      });

      return {
        dailyTrends: trendsWithCumulative,
        totalNewMembersInPeriod: trendsWithCumulative.reduce((sum, d) => sum + d.newMembers, 0),
      };
    } catch (error) {
      console.error('Get member trends error:', error);
      throw new ApiError(500, 'Failed to get member trends');
    }
  }

  /**
   * Get discussion statistics
   */
  static async getDiscussionStatistics(groupId, dateFrom, dateTo) {
    try {
      let dateConditions = [];

      if (dateFrom) {
        dateConditions.push(gte(discussions.createdAt, parseDateToISO(dateFrom)));
      }
      if (dateTo) {
        dateConditions.push(lte(discussions.createdAt, parseDateToISO(dateTo)));
      }

      // Total discussions
      const totalDiscussionsQuery = await db
        .select({ count: count() })
        .from(discussions)
        .where(eq(discussions.groupId, groupId));

      // Discussions in date range
      const discussionsInRangeQuery = await db
        .select({ count: count() })
        .from(discussions)
        .where(and(eq(discussions.groupId, groupId), ...dateConditions));

      // Get all discussion IDs for this group
      const discussionIds = await getGroupDiscussionIds(groupId);

      let totalReplies = 0;
      let repliesInRange = 0;

      if (discussionIds.length > 0) {
        // Total replies
        const totalRepliesQuery = await db
          .select({ count: count() })
          .from(discussionReplies)
          .where(
            sql`${discussionReplies.discussionId} IN (${sql.join(
              discussionIds.map(id => sql`${id}`),
              sql`, `
            )})`
          );

        totalReplies = totalRepliesQuery[0]?.count || 0;

        // Replies in date range
        let replyDateConditions = [];
        if (dateFrom) {
          replyDateConditions.push(gte(discussionReplies.createdAt, parseDateToISO(dateFrom)));
        }
        if (dateTo) {
          replyDateConditions.push(lte(discussionReplies.createdAt, parseDateToISO(dateTo)));
        }

        if (replyDateConditions.length > 0) {
          const repliesInRangeQuery = await db
            .select({ count: count() })
            .from(discussionReplies)
            .where(
              and(
                sql`${discussionReplies.discussionId} IN (${sql.join(
                  discussionIds.map(id => sql`${id}`),
                  sql`, `
                )})`,
                ...replyDateConditions
              )
            );
          repliesInRange = repliesInRangeQuery[0]?.count || 0;
        } else {
          repliesInRange = totalReplies;
        }
      }

      // Daily discussion trend
      const { startDate, endDate } = getDateRange(dateFrom, dateTo);

      const dailyDiscussions = await db
        .select({
          date: sql`DATE(${discussions.createdAt}::timestamp)`,
          count: count(),
        })
        .from(discussions)
        .where(
          and(
            eq(discussions.groupId, groupId),
            between(sql`${discussions.createdAt}::timestamp`, startDate, endDate)
          )
        )
        .groupBy(sql`DATE(${discussions.createdAt}::timestamp)`)
        .orderBy(sql`DATE(${discussions.createdAt}::timestamp)`);

      // Average replies per discussion
      const avgReplies =
        discussionIds.length > 0 ? parseFloat((totalReplies / discussionIds.length).toFixed(2)) : 0;

      return {
        totalDiscussions: totalDiscussionsQuery[0]?.count || 0,
        discussionsInRange: discussionsInRangeQuery[0]?.count || 0,
        totalReplies,
        repliesInRange,
        averageRepliesPerDiscussion: avgReplies,
        totalPosts: (totalDiscussionsQuery[0]?.count || 0) + totalReplies,
        postsInRange: (discussionsInRangeQuery[0]?.count || 0) + repliesInRange,
        dailyTrends: dailyDiscussions.map(d => ({
          date: d.date,
          discussions: d.count,
        })),
      };
    } catch (error) {
      console.error('Get discussion statistics error:', error);
      throw new ApiError(500, 'Failed to get discussion statistics');
    }
  }

  /**
   * Get engagement metrics (likes, interactions)
   */
  static async getEngagementMetrics(groupId, dateFrom, dateTo) {
    try {
      // Get all discussions for this group
      const discussionIds = await getGroupDiscussionIds(groupId);

      if (discussionIds.length === 0) {
        return {
          totalLikes: 0,
          discussionLikes: 0,
          replyLikes: 0,
          averageLikesPerDiscussion: 0,
          averageLikesPerReply: 0,
          engagementRate: 0,
          mostLikedDiscussions: [],
        };
      }

      // Total discussion likes
      const discussionLikesQuery = await db
        .select({ count: count() })
        .from(discussionLikes)
        .where(
          sql`${discussionLikes.discussionId} IN (${sql.join(
            discussionIds.map(id => sql`${id}`),
            sql`, `
          )})`
        );

      // Get all replies for discussions
      const replies = await db
        .select({ id: discussionReplies.id })
        .from(discussionReplies)
        .where(
          sql`${discussionReplies.discussionId} IN (${sql.join(
            discussionIds.map(id => sql`${id}`),
            sql`, `
          )})`
        );

      const replyIds = replies.map(r => r.id);

      // Total reply likes
      let replyLikesCount = 0;
      if (replyIds.length > 0) {
        const replyLikesQuery = await db
          .select({ count: count() })
          .from(discussionReplyLikes)
          .where(
            sql`${discussionReplyLikes.replyId} IN (${sql.join(
              replyIds.map(id => sql`${id}`),
              sql`, `
            )})`
          );
        replyLikesCount = replyLikesQuery[0]?.count || 0;
      }

      const discussionLikesCount = discussionLikesQuery[0]?.count || 0;
      const totalLikes = discussionLikesCount + replyLikesCount;

      // Most liked discussions
      const mostLiked = await db
        .select({
          discussionId: discussions.id,
          title: discussions.title,
          likeCount: sql`(SELECT COUNT(*) FROM discussion_likes WHERE discussion_id = ${discussions.id})`,
          replyCount: sql`(SELECT COUNT(*) FROM discussion_replies WHERE discussion_id = ${discussions.id})`,
        })
        .from(discussions)
        .where(eq(discussions.groupId, groupId))
        .orderBy(
          desc(sql`(SELECT COUNT(*) FROM discussion_likes WHERE discussion_id = ${discussions.id})`)
        )
        .limit(10);

      // Get total members for engagement rate calculation
      const totalMembersQuery = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')));

      const totalMembers = totalMembersQuery[0]?.count || 1;

      // Get unique users who have engaged (posted or liked)
      const uniqueEngagedUsers = await db
        .select({ count: sql`COUNT(DISTINCT user_id)` })
        .from(discussions)
        .where(eq(discussions.groupId, groupId));

      const engagedUsersCount = Number(uniqueEngagedUsers[0]?.count || 0);
      const engagementRate = parseFloat(((engagedUsersCount / totalMembers) * 100).toFixed(2));

      return {
        totalLikes,
        discussionLikes: discussionLikesCount,
        replyLikes: replyLikesCount,
        averageLikesPerDiscussion:
          discussionIds.length > 0
            ? parseFloat((discussionLikesCount / discussionIds.length).toFixed(2))
            : 0,
        averageLikesPerReply:
          replyIds.length > 0 ? parseFloat((replyLikesCount / replyIds.length).toFixed(2)) : 0,
        engagementRate,
        totalEngagedUsers: engagedUsersCount,
        mostLikedDiscussions: mostLiked.map(d => ({
          id: d.discussionId,
          title: d.title,
          likes: Number(d.likeCount),
          replies: Number(d.replyCount),
        })),
      };
    } catch (error) {
      console.error('Get engagement metrics error:', error);
      throw new ApiError(500, 'Failed to get engagement metrics');
    }
  }

  /**
   * Get category-based discussion analytics
   */
  static async getCategoryBasedAnalytics(groupId, dateFrom, dateTo) {
    try {
      // Get discussions by category
      const categoryStats = await db
        .select({
          categoryId: discussionCategories.categoryId,
          categoryName: categories.name,
          discussionCount: count(discussionCategories.discussionId),
        })
        .from(discussionCategories)
        .innerJoin(discussions, eq(discussions.id, discussionCategories.discussionId))
        .innerJoin(categories, eq(categories.id, discussionCategories.categoryId))
        .where(eq(discussions.groupId, groupId))
        .groupBy(discussionCategories.categoryId, categories.name)
        .orderBy(desc(count(discussionCategories.discussionId)));

      // Total discussions for percentage calculation
      const totalDiscussionsQuery = await db
        .select({ count: count() })
        .from(discussions)
        .where(eq(discussions.groupId, groupId));

      const totalDiscussions = totalDiscussionsQuery[0]?.count || 0;

      // Uncategorized discussions
      const categorizedDiscussionIds = await db
        .select({ discussionId: discussionCategories.discussionId })
        .from(discussionCategories)
        .innerJoin(discussions, eq(discussions.id, discussionCategories.discussionId))
        .where(eq(discussions.groupId, groupId));

      const categorizedCount = new Set(categorizedDiscussionIds.map(d => d.discussionId)).size;
      const uncategorizedCount = totalDiscussions - categorizedCount;

      return {
        categoryBreakdown: categoryStats.map(cat => ({
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          discussionCount: cat.discussionCount,
          percentage:
            totalDiscussions > 0
              ? parseFloat(((cat.discussionCount / totalDiscussions) * 100).toFixed(2))
              : 0,
        })),
        uncategorizedDiscussions: uncategorizedCount,
        totalCategorizedDiscussions: categorizedCount,
      };
    } catch (error) {
      console.error('Get category-based analytics error:', error);
      throw new ApiError(500, 'Failed to get category-based analytics');
    }
  }

  /**
   * Get top contributors in the group
   */
  static async getTopContributors(groupId, dateFrom, dateTo, limit = 10) {
    try {
      // Get top users by discussion count
      const topByDiscussions = await db
        .select({
          userId: discussions.userId,
          discussionCount: count(),
        })
        .from(discussions)
        .where(eq(discussions.groupId, groupId))
        .groupBy(discussions.userId)
        .orderBy(desc(count()))
        .limit(limit);

      // Get user details and additional metrics
      const contributorsWithDetails = await Promise.all(
        topByDiscussions.map(async contributor => {
          // Get user details
          const user = await db.query.users.findFirst({
            where: eq(sql`id`, contributor.userId),
            columns: {
              id: true,
              name: true,
              image: true,
            },
          });

          // Get user's reply count in this group
          const userDiscussions = await db
            .select({ id: discussions.id })
            .from(discussions)
            .where(eq(discussions.groupId, groupId));

          const discussionIds = userDiscussions.map(d => d.id);

          let replyCount = 0;
          let likesReceived = 0;

          if (discussionIds.length > 0) {
            const replyCountQuery = await db
              .select({ count: count() })
              .from(discussionReplies)
              .where(
                and(
                  sql`${discussionReplies.discussionId} IN (${sql.join(
                    discussionIds.map(id => sql`${id}`),
                    sql`, `
                  )})`,
                  eq(discussionReplies.userId, contributor.userId)
                )
              );
            replyCount = replyCountQuery[0]?.count || 0;

            // Get likes received on user's discussions
            const userDiscussionIds = await db
              .select({ id: discussions.id })
              .from(discussions)
              .where(
                and(eq(discussions.groupId, groupId), eq(discussions.userId, contributor.userId))
              );

            if (userDiscussionIds.length > 0) {
              const likesQuery = await db
                .select({ count: count() })
                .from(discussionLikes)
                .where(
                  sql`${discussionLikes.discussionId} IN (${sql.join(
                    userDiscussionIds.map(d => sql`${d.id}`),
                    sql`, `
                  )})`
                );
              likesReceived = likesQuery[0]?.count || 0;
            }
          }

          return {
            user: user
              ? {
                  id: user.id,
                  name: user.name,
                  image: user.image,
                }
              : null,
            discussionCount: contributor.discussionCount,
            replyCount,
            totalPosts: contributor.discussionCount + replyCount,
            likesReceived,
          };
        })
      );

      // Sort by total posts
      contributorsWithDetails.sort((a, b) => b.totalPosts - a.totalPosts);

      return contributorsWithDetails.filter(c => c.user !== null);
    } catch (error) {
      console.error('Get top contributors error:', error);
      throw new ApiError(500, 'Failed to get top contributors');
    }
  }

  /**
   * Get group growth comparison between two periods
   */
  static async getGrowthComparison(
    groupId,
    userId,
    currentPeriod,
    previousPeriod,
    { isAdmin = false } = {}
  ) {
    try {
      // Verify user is a member/admin
      if (!isAdmin) {
        await verifyGroupMembership(groupId, userId, {
          errorMessage: 'Unauthorized to view analytics for this group.',
        });
      }

      // Get stats for current period
      const [currentMembers, currentDiscussions] = await Promise.all([
        this.getMemberStatistics(groupId, currentPeriod.from, currentPeriod.to),
        this.getDiscussionStatistics(groupId, currentPeriod.from, currentPeriod.to),
      ]);

      // Get stats for previous period
      const [previousMembers, previousDiscussions] = await Promise.all([
        this.getMemberStatistics(groupId, previousPeriod.from, previousPeriod.to),
        this.getDiscussionStatistics(groupId, previousPeriod.from, previousPeriod.to),
      ]);

      // Calculate growth percentages
      const calculateGrowth = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return parseFloat((((current - previous) / previous) * 100).toFixed(2));
      };

      return {
        members: {
          current: currentMembers.newMembersInRange,
          previous: previousMembers.newMembersInRange,
          growth: calculateGrowth(
            currentMembers.newMembersInRange,
            previousMembers.newMembersInRange
          ),
        },
        discussions: {
          current: currentDiscussions.discussionsInRange,
          previous: previousDiscussions.discussionsInRange,
          growth: calculateGrowth(
            currentDiscussions.discussionsInRange,
            previousDiscussions.discussionsInRange
          ),
        },
        posts: {
          current: currentDiscussions.postsInRange,
          previous: previousDiscussions.postsInRange,
          growth: calculateGrowth(
            currentDiscussions.postsInRange,
            previousDiscussions.postsInRange
          ),
        },
        currentPeriod,
        previousPeriod,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get growth comparison error:', error);
      throw new ApiError(500, 'Failed to get growth comparison');
    }
  }

  /**
   * Get user interaction summary for a specific user in the group
   */
  static async getUserInteractionSummary(
    groupId,
    targetUserId,
    requestingUserId,
    { isAdmin = false } = {}
  ) {
    try {
      // Verify requesting user is a member/admin
      if (!isAdmin) {
        await verifyGroupMembership(groupId, requestingUserId, {
          errorMessage: 'Unauthorized to view analytics for this group.',
        });
      }

      // Get user's discussions in this group
      const userDiscussions = await db
        .select({ count: count() })
        .from(discussions)
        .where(and(eq(discussions.groupId, groupId), eq(discussions.userId, targetUserId)));

      // Get all discussions in the group for reply calculations
      const discussionIds = await getGroupDiscussionIds(groupId);

      let userReplies = 0;
      let likesGiven = 0;
      let likesReceived = 0;

      if (discussionIds.length > 0) {
        // Get user's replies count
        const repliesQuery = await db
          .select({ count: count() })
          .from(discussionReplies)
          .where(
            and(
              sql`${discussionReplies.discussionId} IN (${sql.join(
                discussionIds.map(id => sql`${id}`),
                sql`, `
              )})`,
              eq(discussionReplies.userId, targetUserId)
            )
          );
        userReplies = repliesQuery[0]?.count || 0;

        // Get likes given by user
        const likesGivenQuery = await db
          .select({ count: count() })
          .from(discussionLikes)
          .where(
            and(
              sql`${discussionLikes.discussionId} IN (${sql.join(
                discussionIds.map(id => sql`${id}`),
                sql`, `
              )})`,
              eq(discussionLikes.userId, targetUserId)
            )
          );
        likesGiven = likesGivenQuery[0]?.count || 0;

        // Get likes received on user's discussions
        const userDiscussionIds = await db
          .select({ id: discussions.id })
          .from(discussions)
          .where(and(eq(discussions.groupId, groupId), eq(discussions.userId, targetUserId)));

        if (userDiscussionIds.length > 0) {
          const likesReceivedQuery = await db
            .select({ count: count() })
            .from(discussionLikes)
            .where(
              sql`${discussionLikes.discussionId} IN (${sql.join(
                userDiscussionIds.map(d => sql`${d.id}`),
                sql`, `
              )})`
            );
          likesReceived = likesReceivedQuery[0]?.count || 0;
        }
      }

      // Get user membership info
      const userMembership = await db.query.groupMembers.findFirst({
        where: and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, targetUserId),
          eq(groupMembers.status, 'joined')
        ),
      });

      return {
        userId: targetUserId,
        memberSince: userMembership?.joinedAt || null,
        role: userMembership?.role || null,
        discussions: userDiscussions[0]?.count || 0,
        replies: userReplies,
        totalPosts: (userDiscussions[0]?.count || 0) + userReplies,
        likesGiven,
        likesReceived,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get user interaction summary error:', error);
      throw new ApiError(500, 'Failed to get user interaction summary');
    }
  }
}
