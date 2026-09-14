import { db } from '../db/index.js';
import { trackingLinks, trackingLinkClicks, purchasedTickets, events } from '../db/schema/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';

export class TrackingLinkService {
  static async create(organizerId, eventId, { name, destinationUrl }) {
    const slug = (name || 'link')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const rand = Math.random().toString(36).slice(2, 8);
    const code = `${slug}-${rand}`;

    try {
      const [link] = await db
        .insert(trackingLinks)
        .values({
          eventId,
          organizerId,
          name,
          code,
          destinationUrl,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return link;
    } catch (err) {
      console.error('Create tracking link error:', err);
      throw new ApiError(500, 'Failed to create tracking link');
    }
  }

  static async listByEvent(eventId, organizerId) {
    if (organizerId) {
      const ev = await db.query.events.findFirst({
        where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
      });
      if (!ev) throw new ApiError(404, 'Event not found or unauthorized');
    }

    return db.query.trackingLinks.findMany({
      where: eq(trackingLinks.eventId, eventId),
      orderBy: desc(trackingLinks.createdAt),
    });
  }

  static async findById(id) {
    return db.query.trackingLinks.findFirst({ where: eq(trackingLinks.id, id) });
  }

  static async findByCode(code) {
    return db.query.trackingLinks.findFirst({ where: eq(trackingLinks.code, code) });
  }

  /**
   * Record a click.
   * Deduplication strategy: one click per (trackingLinkId + userId) for logged-in users,
   * one click per (trackingLinkId + ipAddress) for anonymous visitors — within a 24-hour window.
   * This prevents a page refresh from double-counting while still counting genuinely new visits.
   */
  static async recordClick(
    trackingLinkId,
    { userId = null, ipAddress = null, userAgent = null, referer = null, eventId = null } = {}
  ) {
    try {
      const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

      let isDuplicate = false;

      if (userId) {
        const existing = await db.query.trackingLinkClicks.findFirst({
          where: and(
            eq(trackingLinkClicks.trackingLinkId, trackingLinkId),
            eq(trackingLinkClicks.userId, userId),
            sql`${trackingLinkClicks.createdAt} > ${windowStart}`
          ),
        });
        isDuplicate = !!existing;
      } else if (ipAddress) {
        const existing = await db.query.trackingLinkClicks.findFirst({
          where: and(
            eq(trackingLinkClicks.trackingLinkId, trackingLinkId),
            eq(trackingLinkClicks.ipAddress, ipAddress),
            sql`${trackingLinkClicks.createdAt} > ${windowStart}`
          ),
        });
        isDuplicate = !!existing;
      }

      console.log(
        '[recordClick] trackingLinkId:',
        trackingLinkId,
        '| eventId:',
        eventId,
        '| userId:',
        userId,
        '| ip:',
        ipAddress,
        '| isDuplicate:',
        isDuplicate
      );

      if (!isDuplicate) {
        const [inserted] = await db
          .insert(trackingLinkClicks)
          .values({
            trackingLinkId,
            eventId,
            userId,
            ipAddress,
            userAgent,
            referer,
            createdAt: new Date(),
          })
          .returning();
        console.log('[recordClick] inserted row id:', inserted?.id);
      } else {
        console.log('[recordClick] skipped — duplicate within 24h window');
      }
    } catch (err) {
      console.error('Record click error:', err);
    }
  }

  /**
   * Get metrics for a single tracking link.
   * - clicks: deduplicated (same logic as recordClick — each stored row is already deduped)
   * - ticketsSold: count of purchased_tickets rows attributed to this link
   * - revenue: sum of ticket prices attributed to this link
   * - conversionRate: ticketsSold / clicks * 100
   */
  static async getMetrics(eventId, linkId) {
    try {
      // ── Diagnostic: verify the linkId exists in tracking_links ──────────
      const linkRow = await db.query.trackingLinks.findFirst({
        where: eq(trackingLinks.id, linkId),
      });
      console.log('[TrackingMetrics] linkId:', linkId, '| found link:', linkRow?.id ?? 'NOT FOUND');

      // ── Diagnostic: count ALL click rows for this link (no filters) ──────
      const rawClicksRes = await db
        .select({ total: sql`COUNT(*)::int` })
        .from(trackingLinkClicks)
        .where(eq(trackingLinkClicks.trackingLinkId, linkId));
      console.log('[TrackingMetrics] raw click rows for linkId:', rawClicksRes?.[0]?.total ?? 0);

      // ── Diagnostic: sample the first few click rows to confirm schema ────
      const sampleClicks = await db.query.trackingLinkClicks.findMany({
        where: eq(trackingLinkClicks.trackingLinkId, linkId),
        limit: 3,
      });
      console.log('[TrackingMetrics] sample clicks:', JSON.stringify(sampleClicks));

      // Total stored click rows (already deduped at insert time)
      const clicksRes = await db
        .select({ clicks: sql`COUNT(*)::int` })
        .from(trackingLinkClicks)
        .where(eq(trackingLinkClicks.trackingLinkId, linkId));

      const clicks = clicksRes?.[0]?.clicks ?? 0;

      // ── Diagnostic: check purchased_tickets for this linkId ───────────────
      const rawTicketsRes = await db
        .select({ total: sql`COUNT(*)::int` })
        .from(purchasedTickets)
        .where(eq(purchasedTickets.trackingLinkId, linkId));
      console.log('[TrackingMetrics] raw ticket rows for linkId:', rawTicketsRes?.[0]?.total ?? 0);

      // ── Diagnostic: sample tickets to check trackingLinkId field ─────────
      const sampleTickets = await db.query.purchasedTickets.findMany({
        where: eq(purchasedTickets.trackingLinkId, linkId),
        limit: 3,
      });
      console.log(
        '[TrackingMetrics] sample tickets:',
        JSON.stringify(
          sampleTickets.map(t => ({
            id: t.id,
            trackingLinkId: t.trackingLinkId,
            price: t.price,
            status: t.status,
          }))
        )
      );

      // Tickets sold and revenue attributed to this link
      const ticketsRes = await db
        .select({
          ticketsSold: sql`COUNT(*)::int`,
          revenue: sql`COALESCE(SUM(CAST(${purchasedTickets.price} AS DECIMAL)), 0)::float`,
        })
        .from(purchasedTickets)
        .where(
          and(
            eq(purchasedTickets.trackingLinkId, linkId),
            eq(purchasedTickets.eventId, eventId),
            sql`${purchasedTickets.status} != 'refunded'`
          )
        );

      const ticketsSold = ticketsRes?.[0]?.ticketsSold ?? 0;
      const revenue = parseFloat(ticketsRes?.[0]?.revenue ?? 0);
      const conversionRate = clicks > 0 ? parseFloat(((ticketsSold / clicks) * 100).toFixed(2)) : 0;

      console.log('[TrackingMetrics] final →', { clicks, ticketsSold, revenue, conversionRate });

      return { clicks, ticketsSold, revenue, conversionRate };
    } catch (err) {
      console.error('Get tracking metrics error:', err);
      throw new ApiError(500, 'Failed to get tracking metrics');
    }
  }

  /**
   * Delete a tracking link (soft-deletes by setting deletedAt, or hard-delete).
   * Clicks and ticket attributions are preserved for historical accuracy.
   */
  static async deleteLink(id, organizerId) {
    const link = await db.query.trackingLinks.findFirst({
      where: eq(trackingLinks.id, id),
    });

    if (!link) throw new ApiError(404, 'Tracking link not found');
    if (link.organizerId !== organizerId) throw new ApiError(403, 'Unauthorized');

    await db
      .update(trackingLinks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(trackingLinks.id, id));
  }
}

export default TrackingLinkService;
