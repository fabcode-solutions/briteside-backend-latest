import { db } from '../../db/index.js';
import {
  posts,
  postViews,
  postLikes,
  postShares,
  postReposts,
  savedPosts,
  postUserComments,
  userFollows,
  socialProfiles,
  profileViews,
  profileViewSessions,
  users,
  userInformation,
  postAnalyticsDaily,
} from '../../db/schema/index.js';
import { eq, and, count, sql, gte, lte, desc } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import dayjs from 'dayjs';
import { getDateRange, computePercentageBreakdown } from '../../utils/helper.js';

/**
 * Analytics helpers for social entities (posts & profiles)
 */
export class SocialAnalyticsService {
  // ---------- helpers ----------
  static async _ensurePostOwner(postId, userId) {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new ApiError(404, 'Post not found');
    if (post.userId !== userId) throw new ApiError(403, 'Not authorized');
    return post;
  }

  static async _ensureProfileOwner(profileUserId, userId) {
    if (profileUserId !== userId) {
      // we could also load profile to verify user exists but owner check is enough
      throw new ApiError(403, 'Not authorized');
    }
  }

  // ---------- view recording ----------
  static async viewPost(postId, viewerId) {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    // block check omitted here; callers should perform if needed
    const existing = await db.query.postViews.findFirst({
      where: and(eq(postViews.postId, postId), eq(postViews.userId, viewerId)),
    });

    if (!existing) {
      await db.insert(postViews).values({ postId, userId: viewerId });
      await db
        .update(posts)
        .set({ viewsCount: sql`${posts.viewsCount} + 1` })
        .where(eq(posts.id, postId));
    }
    return { success: true };
  }

  static async viewProfile(profileUserId, viewerId) {
    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, profileUserId),
    });
    if (!profile) {
      throw new ApiError(404, 'Profile not found');
    }

    await db.insert(profileViewSessions).values({ profileId: profile.id, userId: viewerId });

    const existing = await db.query.profileViews.findFirst({
      where: and(eq(profileViews.profileId, profile.id), eq(profileViews.userId, viewerId)),
    });
    if (!existing) {
      await db.insert(profileViews).values({ profileId: profile.id, userId: viewerId });
    }

    await db
      .update(socialProfiles)
      .set({ profileViewsCount: sql`${socialProfiles.profileViewsCount} + 1` })
      .where(eq(socialProfiles.id, profile.id));

    return { success: true };
  }

  // ---------- analytics ----------
  static async getPostAnalytics(postId, requesterId, filters = {}, { isAdmin = false } = {}) {
    let post;
    if (isAdmin) {
      post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
      if (!post) throw new ApiError(404, 'Post not found');
    } else {
      post = await this._ensurePostOwner(postId, requesterId);
    }
    const { dateFrom, dateTo } = filters;
    const { startDate, endDate } = getDateRange(dateFrom, dateTo);
    const viewDateFilters = [eq(postViews.postId, postId)];
    const commentDateFilters = [eq(postUserComments.postId, postId)];

    if (startDate) {
      viewDateFilters.push(gte(postViews.viewedAt, startDate));
      commentDateFilters.push(gte(postUserComments.commentedAt, startDate));
    }
    if (endDate) {
      viewDateFilters.push(lte(postViews.viewedAt, endDate));
      commentDateFilters.push(lte(postUserComments.commentedAt, endDate));
    }

    // totals from post row
    // compute saves separately since posts table doesn't store it
    const savesQuery = await db
      .select({ cnt: count() })
      .from(savedPosts)
      .where(eq(savedPosts.postId, postId));
    const savesCount = parseInt(savesQuery[0].cnt, 10);

    const totals = {
      views: post.viewsCount || 0,
      likes: post.likesCount || 0,
      comments: post.commentsCount || 0,
      shares: post.sharesCount || 0,
      reposts: post.repostsCount || 0,
      saves: savesCount,
    };

    // unique views (should equal rows in postViews)
    const uniqueQuery = await db
      .select({ cnt: count() })
      .from(postViews)
      .where(and(...viewDateFilters));
    const uniqueViews = parseInt(uniqueQuery[0].cnt, 10);

    // non-follower unique views
    const nonFollowerQuery = await db
      .select({ cnt: count() })
      .from(postViews)
      .leftJoin(
        userFollows,
        and(eq(userFollows.followingId, post.userId), eq(userFollows.followerId, postViews.userId))
      )
      .where(and(...viewDateFilters, sql`${userFollows.id} IS NULL`));
    const nonFollowerUnique = parseInt(nonFollowerQuery[0].cnt, 10);

    // viewers list
    const viewers = await db.query.postViews.findMany({
      where: and(...viewDateFilters),
      with: {
        user: {
          columns: { id: true, username: true },
          with: {
            userInformation: {
              columns: { state: true, country: true },
            },
          },
        },
      },
    });

    const viewerList = await Promise.all(
      viewers.map(async v => {
        const isFollowerRow = await db.query.userFollows.findFirst({
          where: and(
            eq(userFollows.followerId, v.userId),
            eq(userFollows.followingId, post.userId)
          ),
        });
        return {
          userId: v.userId,
          username: v.user.username,
          viewedAt: v.viewedAt,
          isFollower: !!isFollowerRow,
          state: v.user.userInformation?.state || null,
          country: v.user.userInformation?.country || null,
        };
      })
    );

    // location aggregation by state/country
    const locationAgg = await db
      .select({ state: userInformation.state, country: userInformation.country, cnt: count() })
      .from(postViews)
      .leftJoin(userInformation, eq(userInformation.userId, postViews.userId))
      .where(and(...viewDateFilters))
      .groupBy(userInformation.state, userInformation.country);

    // peak comment hour
    const commentHour = await db
      .select({
        hour: sql`DATE_PART('hour', "post_user_comments"."commented_at")`.as('hour'),
        cnt: count().as('cnt'),
      })
      .from(postUserComments)
      .where(and(...commentDateFilters))
      .groupBy(sql`DATE_PART('hour', "post_user_comments"."commented_at")`)
      .orderBy(desc(count()))
      .limit(1);

    const peakHour = commentHour.length ? parseInt(commentHour[0].hour, 10) : null;

    // build human-readable range string like "2 AM - 3 AM"
    let peakHourRange = null;
    if (peakHour !== null) {
      const start = dayjs().hour(peakHour).minute(0);
      const end = dayjs()
        .hour((peakHour + 1) % 24)
        .minute(0);
      peakHourRange = `${start.format('h A')} - ${end.format('h A')}`;
    }

    // Feed/discovery-surface funnel from the unified analytics event log (see
    // docs/BRITESIDE_ANALYTICS.md). Distinct from `totals.views` above, which
    // is the detail-page open count (postViews) — additive, never touches it.
    const [funnelTotals] = await db
      .select({
        impressions: sql`COALESCE(SUM(${postAnalyticsDaily.impressions}), 0)::int`,
        views: sql`COALESCE(SUM(${postAnalyticsDaily.views}), 0)::int`,
        clicks: sql`COALESCE(SUM(${postAnalyticsDaily.clicks}), 0)::int`,
      })
      .from(postAnalyticsDaily)
      .where(
        and(
          eq(postAnalyticsDaily.postId, postId),
          gte(postAnalyticsDaily.date, startDate.toISOString().slice(0, 10)),
          lte(postAnalyticsDaily.date, endDate.toISOString().slice(0, 10))
        )
      );

    const impressions = Number(funnelTotals?.impressions ?? 0);
    const clicks = Number(funnelTotals?.clicks ?? 0);

    return {
      totals,
      uniqueViews,
      nonFollowerUnique,
      viewers: viewerList,
      location: locationAgg,
      peakCommentHour: peakHour,
      peakCommentHourRange: peakHourRange,
      funnel: {
        impressions,
        views: Number(funnelTotals?.views ?? 0),
        clicks,
        clickThroughRate: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
      },
    };
  }

  static async getProfileAnalytics(
    profileUserId,
    requesterId,
    filters = {},
    { isAdmin = false } = {}
  ) {
    if (!isAdmin) {
      await this._ensureProfileOwner(profileUserId, requesterId);
    }

    const { dateFrom, dateTo } = filters;
    const { startDate, endDate } = getDateRange(dateFrom, dateTo);
    const viewDateFilters = [];

    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, profileUserId),
    });
    if (!profile) {
      return {
        totals: { views: 0, followers: 0, following: 0 },
        totalViews: 0,
        uniqueViews: 0,
        newFollowersLastMonth: 0,
        viewers: [],
        location: [],
        genderBreakdown: {},
        ageBreakdown: {},
      };
    }

    viewDateFilters.push(eq(profileViewSessions.profileId, profile.id));
    if (startDate) viewDateFilters.push(gte(profileViewSessions.viewedAt, startDate));
    if (endDate) viewDateFilters.push(lte(profileViewSessions.viewedAt, endDate));

    const totals = {
      views: profile.profileViewsCount || 0,
      followers: profile.followersCount || 0,
      following: profile.followingCount || 0,
    };

    const totalViewsQuery = await db
      .select({ cnt: count() })
      .from(profileViewSessions)
      .where(and(...viewDateFilters));
    const totalViews = parseInt(totalViewsQuery[0].cnt, 10);

    const nonFollowerQuery = await db
      .select({ cnt: count() })
      .from(profileViewSessions)
      .leftJoin(
        userFollows,
        and(
          eq(userFollows.followingId, profileUserId),
          eq(userFollows.followerId, profileViewSessions.userId)
        )
      )
      .where(and(...viewDateFilters, sql`${userFollows.id} IS NULL`));
    const uniqueViews = parseInt(nonFollowerQuery[0].cnt, 10);

    // new followers last month
    const oneMonthAgo = dayjs().subtract(1, 'month').toDate();
    const newFollowersQuery = await db
      .select({ cnt: count() })
      .from(userFollows)
      .where(
        and(eq(userFollows.followingId, profileUserId), gte(userFollows.createdAt, oneMonthAgo))
      );
    const newFollowersLastMonth = parseInt(newFollowersQuery[0].cnt, 10);

    // viewer list — one entry per unique user, latest visit in date range
    const viewers = await db
      .select({
        userId: profileViewSessions.userId,
        username: users.username,
        latestViewedAt: sql`MAX(${profileViewSessions.viewedAt})`.as('latest_viewed_at'),
        state: userInformation.state,
        country: userInformation.country,
      })
      .from(profileViewSessions)
      .leftJoin(users, eq(users.id, profileViewSessions.userId))
      .leftJoin(userInformation, eq(userInformation.userId, profileViewSessions.userId))
      .where(and(...viewDateFilters))
      .groupBy(
        profileViewSessions.userId,
        users.username,
        userInformation.state,
        userInformation.country
      );

    const viewerList = await Promise.all(
      viewers.map(async v => {
        const isFollowerRow = await db.query.userFollows.findFirst({
          where: and(
            eq(userFollows.followerId, v.userId),
            eq(userFollows.followingId, profileUserId)
          ),
        });
        return {
          userId: v.userId,
          username: v.username,
          viewedAt: v.latestViewedAt,
          isFollower: !!isFollowerRow,
          state: v.state || null,
          country: v.country || null,
        };
      })
    );

    // Age range SQL expression (reused for both SELECT and GROUP BY)
    const ageRangeSql = sql`CASE
      WHEN ${socialProfiles.age} BETWEEN 18 AND 24 THEN '18-24'
      WHEN ${socialProfiles.age} BETWEEN 25 AND 34 THEN '25-34'
      WHEN ${socialProfiles.age} BETWEEN 35 AND 44 THEN '35-44'
      WHEN ${socialProfiles.age} BETWEEN 45 AND 54 THEN '45-54'
      WHEN ${socialProfiles.age} >= 55 THEN '55+'
      ELSE 'unknown'
    END`;

    const [locationAgg, genderRows, ageRangeRows] = await Promise.all([
      // location aggregation by state/country
      db
        .select({ state: userInformation.state, country: userInformation.country, cnt: count() })
        .from(profileViewSessions)
        .leftJoin(userInformation, eq(userInformation.userId, profileViewSessions.userId))
        .where(and(...viewDateFilters))
        .groupBy(userInformation.state, userInformation.country),

      // views by gender (from viewer's social profile)
      db
        .select({ gender: socialProfiles.gender, cnt: count() })
        .from(profileViewSessions)
        .leftJoin(socialProfiles, eq(socialProfiles.userId, profileViewSessions.userId))
        .where(and(...viewDateFilters))
        .groupBy(socialProfiles.gender),

      // views by age range (from viewer's social profile)
      db
        .select({ ageRange: ageRangeSql.as('age_range'), cnt: count() })
        .from(profileViewSessions)
        .leftJoin(socialProfiles, eq(socialProfiles.userId, profileViewSessions.userId))
        .where(and(...viewDateFilters, sql`${socialProfiles.age} IS NOT NULL`))
        .groupBy(ageRangeSql),
    ]);

    const genderBreakdown = computePercentageBreakdown(
      genderRows.map(r => ({ label: r.gender || 'unknown', count: parseInt(r.cnt, 10) }))
    );

    const ageBreakdown = computePercentageBreakdown(
      ageRangeRows.map(r => ({ label: r.ageRange, count: parseInt(r.cnt, 10) }))
    );

    return {
      totals,
      totalViews,
      uniqueViews,
      newFollowersLastMonth,
      viewers: viewerList,
      location: locationAgg,
      genderBreakdown,
      ageBreakdown,
    };
  }
}
