import { db } from '../db/index.js';
import {
  events,
  purchasedTickets,
  eventReviews,
  eventTickets,
  purchasedMerchandise,
  eventSchedules,
} from '../db/schema/index.js';
import { eq, and, desc, asc, count, avg, gte, lte, sql, ilike } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';

const withSchedule = scheduleId =>
  scheduleId ? eq(purchasedTickets.eventScheduleId, scheduleId) : undefined;

const compactAnd = (...conditions) => {
  const valid = conditions.filter(Boolean);
  return valid.length ? and(...valid) : undefined;
};

export class AnalyticsService {
  static async getEventSchedules(eventId) {
    try {
      const schedules = await db.query.eventSchedules.findMany({
        where: and(eq(eventSchedules.eventId, eventId), sql`${eventSchedules.deletedAt} IS NULL`),
        orderBy: asc(eventSchedules.startTime),
      });
      return schedules;
    } catch (error) {
      console.error('getEventSchedules error:', error);
      throw new ApiError(500, 'Failed to fetch event schedules');
    }
  }

 static async getOrganizerOverview(organizerId, filters = {}) {
  try {
    const { dateFrom, dateTo } = filters;
    const dateConditions = [];
    if (dateFrom) dateConditions.push(gte(events.startDate, new Date(dateFrom)));
    if (dateTo) dateConditions.push(lte(events.startDate, new Date(dateTo)));

    const orgCond = organizerId ? eq(events.organizerId, organizerId) : undefined;
    const baseConditions = [orgCond, ...dateConditions].filter(Boolean);
    const baseWhere = baseConditions.length ? and(...baseConditions) : undefined;

    const ticketsRes = await db
      .select({ ticketsRevenue: sql`COALESCE(SUM(CAST(${purchasedTickets.price} AS DECIMAL)), 0)` })
      .from(purchasedTickets)
      .leftJoin(events, eq(events.id, purchasedTickets.eventId))
      .where(baseWhere);

    const merchandiseRes = await db
      .select({ merchandiseRevenue: sql`COALESCE(SUM(CAST(${purchasedMerchandise.totalPrice} AS DECIMAL)), 0)` })
      .from(purchasedMerchandise)
      .leftJoin(events, eq(events.id, purchasedMerchandise.eventId))
      .where(baseWhere);

    const ticketsRevenue = ticketsRes?.[0]?.ticketsRevenue ?? 0;
    const merchandiseRevenue = merchandiseRes?.[0]?.merchandiseRevenue ?? 0;
    const totalRevenue = Number(ticketsRevenue) + Number(merchandiseRevenue);

    const ticketsQuery = await db
      .select({ totalTickets: count(purchasedTickets.id) })
      .from(events)
      .leftJoin(purchasedTickets, eq(events.id, purchasedTickets.eventId))
      .where(baseWhere);

    const now = new Date();
    const upcomingConditions = [
      orgCond,
      gte(events.startDate, now),
      eq(events.eventStatus, 'published'),
    ].filter(Boolean);
    const upcomingQuery = await db
      .select({ upcomingCount: count(events.id) })
      .from(events)
      .where(and(...upcomingConditions));

    const ratingQuery = await db
      .select({ avgRating: avg(eventReviews.overallRating), totalReviews: count(eventReviews.id) })
      .from(events)
      .leftJoin(eventReviews, eq(events.id, eventReviews.eventId))
      .where(baseWhere);

    const recentEvents = await db.query.events.findMany({
      where: orgCond,
      orderBy: desc(events.createdAt),
      limit: 5,
    });

    return {
      totalRevenue,
      ticketRevenue: parseFloat(ticketsRevenue || 0),
      merchandiseRevenue: parseFloat(merchandiseRevenue || 0),
      ticketsSold: ticketsQuery[0].totalTickets,
      upcomingEvents: upcomingQuery[0].upcomingCount,
      averageRating: parseFloat(ratingQuery[0].avgRating || 0),
      totalReviews: ratingQuery[0].totalReviews,
      recentEvents,
    };
  } catch (error) {
    console.error('Get organizer overview error:', error);
    throw new ApiError(500, 'Failed to get organizer overview');
  }
}

  // -------------------------------------------------------------------------
  // Single event analytics – now accepts optional scheduleId
  // -------------------------------------------------------------------------
  static async getEventAnalytics(
    eventId,
    organizerId,
    filters = {},
    { isAdmin = false, scheduleId } = {}
  ) {
    try {
      const whereCondition = isAdmin
        ? eq(events.id, eventId)
        : and(eq(events.id, eventId), eq(events.organizerId, organizerId));

      const event = await db.query.events.findFirst({
        where: whereCondition,
        with: { venue: true, tickets: true },
      });

      if (!event) throw new ApiError(404, 'Event not found or unauthorized');

      const [salesData, audienceData, ticketPerformance, engagementData] = await Promise.all([
        this.getEventSalesAnalytics(eventId, scheduleId),
        this.getEventAudienceAnalytics(eventId, scheduleId),
        this.getTicketPerformanceAnalytics(eventId, scheduleId),
        this.getEventEngagementAnalytics(eventId), // engagement (views/likes) isn't session-specific
      ]);

      // Include the selected schedule info if provided
      let selectedSchedule = null;
      if (scheduleId) {
        selectedSchedule = await db.query.eventSchedules.findFirst({
          where: eq(eventSchedules.id, scheduleId),
        });
      }

      return {
        event: {
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          eventStatus: event.eventStatus,
          category: event.category,
          venue: event.venue,
        },
        selectedSchedule,
        sales: salesData,
        audience: audienceData,
        ticketPerformance,
        engagement: engagementData,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get event analytics error:', error);
      throw new ApiError(500, 'Failed to get event analytics');
    }
  }

  // -------------------------------------------------------------------------
  // Sales analytics – session-aware
  // -------------------------------------------------------------------------
  static async getEventSalesAnalytics(eventId, scheduleId) {
    try {
      const scheduleCond = withSchedule(scheduleId);

      const baseWhere = compactAnd(eq(purchasedTickets.eventId, eventId), scheduleCond);

      const revenueQuery = await db
        .select({
          totalRevenue: sql`COALESCE(SUM(CAST(${purchasedTickets.price} AS DECIMAL)), 0)`,
          ticketCount: count(purchasedTickets.id),
        })
        .from(purchasedTickets)
        .where(baseWhere);

      // Merchandise is not session-specific — keep as-is or add scheduleId if your schema supports it
      const merchandiseQuery = await db
        .select({
          merchandiseRevenue: sql`COALESCE(SUM(CAST(${purchasedMerchandise.totalPrice} AS DECIMAL)), 0)`,
          merchandiseCount: count(purchasedMerchandise.id),
        })
        .from(purchasedMerchandise)
        .where(eq(purchasedMerchandise.eventId, eventId));

      const salesTrend = await db
        .select({
          date: sql`DATE(${purchasedTickets.purchasedAt})`,
          revenue: sql`COALESCE(SUM(CAST(${purchasedTickets.price} AS DECIMAL)), 0)`,
          tickets: count(purchasedTickets.id),
        })
        .from(purchasedTickets)
        .where(
          compactAnd(
            eq(purchasedTickets.eventId, eventId),
            gte(purchasedTickets.purchasedAt, sql`NOW() - INTERVAL '30 days'`),
            scheduleCond
          )
        )
        .groupBy(sql`DATE(${purchasedTickets.purchasedAt})`)
        .orderBy(sql`DATE(${purchasedTickets.purchasedAt})`);

      const revenue = revenueQuery[0];
      const merchandise = merchandiseQuery[0];

      return {
        totalRevenue:
          parseFloat(revenue.totalRevenue || 0) + parseFloat(merchandise.merchandiseRevenue || 0),
        ticketRevenue: parseFloat(revenue.totalRevenue || 0),
        merchandiseRevenue: parseFloat(merchandise.merchandiseRevenue || 0),
        ticketsSold: revenue.ticketCount,
        merchandiseSold: merchandise.merchandiseCount,
        salesTrend: salesTrend.map(item => ({
          date: item.date,
          revenue: parseFloat(item.revenue),
          tickets: item.tickets,
        })),
      };
    } catch (error) {
      console.error('Get event sales analytics error:', error);
      throw new ApiError(500, 'Failed to get event sales analytics');
    }
  }

  // -------------------------------------------------------------------------
  // Audience analytics – session-aware
  // -------------------------------------------------------------------------
  static async getEventAudienceAnalytics(eventId, scheduleId) {
    try {
      const scheduleCond = withSchedule(scheduleId);
      const baseWhere = compactAnd(eq(purchasedTickets.eventId, eventId), scheduleCond);

      const attendeeData = await db
        .select({ totalAttendees: count(sql`DISTINCT ${purchasedTickets.userId}`) })
        .from(purchasedTickets)
        .where(baseWhere);

      const avgTicketsData = await db
        .select({ userId: purchasedTickets.userId, ticketCount: count(purchasedTickets.id) })
        .from(purchasedTickets)
        .where(baseWhere)
        .groupBy(purchasedTickets.userId);

      const averageTicketsPerUser =
        avgTicketsData.length > 0
          ? avgTicketsData.reduce((sum, u) => sum + u.ticketCount, 0) / avgTicketsData.length
          : 0;

      const purchaseTimingQuery = await db
        .select({
          hour: sql`EXTRACT(HOUR FROM ${purchasedTickets.purchasedAt})`,
          purchases: count(purchasedTickets.id),
        })
        .from(purchasedTickets)
        .where(baseWhere)
        .groupBy(sql`EXTRACT(HOUR FROM ${purchasedTickets.purchasedAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${purchasedTickets.purchasedAt})`);

      const totalAttendeesForGeo = attendeeData[0]?.totalAttendees || 0;
      const geographicData =
        totalAttendeesForGeo > 0 ? [{ region: 'Unknown', attendees: totalAttendeesForGeo }] : [];

      return {
        totalAttendees: attendeeData[0]?.totalAttendees || 0,
        averageTicketsPerUser: parseFloat(averageTicketsPerUser.toFixed(2)),
        purchaseTimingDistribution: purchaseTimingQuery.map(item => ({
          hour: item.hour,
          purchases: item.purchases,
        })),
        geographicDistribution: geographicData,
      };
    } catch (error) {
      console.error('Get event audience analytics error:', error);
      throw new ApiError(500, 'Failed to get event audience analytics');
    }
  }

  // -------------------------------------------------------------------------
  // Ticket performance analytics – session-aware
  // -------------------------------------------------------------------------
  static async getTicketPerformanceAnalytics(eventId, scheduleId) {
    try {
      const scheduleCond = withSchedule(scheduleId);

      const ticketPerformance = await db
        .select({
          ticketId: eventTickets.id,
          ticketName: eventTickets.name,
          price: eventTickets.price,
          quantityAvailable: eventTickets.quantityAvailable,
          quantitySold: sql`CAST(COUNT(${purchasedTickets.id}) AS INTEGER)`,
          revenue: sql`COALESCE(SUM(CAST(${purchasedTickets.price} AS DECIMAL)), 0)`,
        })
        .from(eventTickets)
        .leftJoin(
          purchasedTickets,
          compactAnd(eq(eventTickets.id, purchasedTickets.ticketTierId), scheduleCond) ??
            eq(eventTickets.id, purchasedTickets.ticketTierId)
        )
        .where(eq(eventTickets.eventId, eventId))
        .groupBy(
          eventTickets.id,
          eventTickets.name,
          eventTickets.price,
          eventTickets.quantityAvailable
        );

      return ticketPerformance.map(ticket => ({
        ...ticket,
        revenue: parseFloat(ticket.revenue),
        sellThroughRate:
          ticket.quantityAvailable > 0 ? (ticket.quantitySold / ticket.quantityAvailable) * 100 : 0,
        remainingTickets: ticket.quantityAvailable - ticket.quantitySold,
      }));
    } catch (error) {
      console.error('Get ticket performance analytics error:', error);
      throw new ApiError(500, 'Failed to get ticket performance analytics');
    }
  }

  // -------------------------------------------------------------------------
  // Engagement – not session-scoped (views / likes are event-level)
  // -------------------------------------------------------------------------
  static async getEventEngagementAnalytics(eventId) {
    try {
      const reviewsQuery = await db
        .select({
          totalReviews: count(eventReviews.id),
          averageRating: avg(eventReviews.overallRating),
          averageVenueRating: avg(eventReviews.venueRating),
          averageOrganizationRating: avg(eventReviews.organizationRating),
          averageValueRating: avg(eventReviews.valueRating),
        })
        .from(eventReviews)
        .where(eq(eventReviews.eventId, eventId));

      const ratingDistribution = await db
        .select({ rating: eventReviews.overallRating, count: count(eventReviews.id) })
        .from(eventReviews)
        .where(eq(eventReviews.eventId, eventId))
        .groupBy(eventReviews.overallRating)
        .orderBy(eventReviews.overallRating);

      const eventData = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { totalViews: true, uniqueVisitors: true, likeCount: true },
      });

      const reviews = reviewsQuery[0];

      return {
        totalReviews: reviews.totalReviews,
        averageRating: parseFloat(reviews.averageRating || 0),
        ratingBreakdown: {
          venue: parseFloat(reviews.averageVenueRating || 0),
          organization: parseFloat(reviews.averageOrganizationRating || 0),
          value: parseFloat(reviews.averageValueRating || 0),
        },
        ratingDistribution: ratingDistribution.map(item => ({
          rating: item.rating,
          count: item.count,
        })),
        totalViews: eventData?.totalViews || 0,
        uniqueVisitors: eventData?.uniqueVisitors || 0,
        likeCount: eventData?.likeCount || 0,
        engagementRate:
          eventData?.uniqueVisitors > 0
            ? ((eventData.likeCount || 0) / eventData.uniqueVisitors) * 100
            : 0,
      };
    } catch (error) {
      console.error('Get event engagement analytics error:', error);
      throw new ApiError(500, 'Failed to get event engagement analytics');
    }
  }

  // -------------------------------------------------------------------------
  // Organizer events list – unchanged
  // -------------------------------------------------------------------------
  static async getOrganizerEvents(organizerId, filters = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        status,
        dateFrom,
        dateTo,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = filters;
      const offset = (page - 1) * limit;
      const conditions = [];

      if (organizerId) conditions.push(eq(events.organizerId, organizerId));
      if (search) conditions.push(ilike(events.title, `%${search}%`));
      if (status) conditions.push(eq(events.eventStatus, status));
      if (dateFrom) conditions.push(gte(events.startDate, new Date(dateFrom)));
      if (dateTo) conditions.push(lte(events.startDate, new Date(dateTo)));

      const orderBy = sortOrder === 'desc' ? desc(events[sortBy]) : asc(events[sortBy]);

      const [eventsResult, totalCount] = await Promise.all([
        db.query.events.findMany({
          where: and(...conditions),
          with: { venue: true },
          orderBy,
          limit,
          offset,
        }),
        db
          .select({ count: count() })
          .from(events)
          .where(and(...conditions)),
      ]);

      const eventsWithAnalytics = await Promise.all(
        eventsResult.map(async event => {
          const analytics = await this.getEventSalesAnalytics(event.id);
          return {
            ...event,
            analytics: { totalRevenue: analytics.totalRevenue, ticketsSold: analytics.ticketsSold },
          };
        })
      );

      return {
        events: eventsWithAnalytics,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
      };
    } catch (error) {
      console.error('Get organizer events error:', error);
      throw new ApiError(500, 'Failed to get organizer events');
    }
  }
}
