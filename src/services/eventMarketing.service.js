import { db } from '../db/index.js';
import { eventMarketingSettings, events } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

function buildEventUrl(slug) {
  return `${FRONTEND_URL}/events/${slug}`;
}

function buildEmbedSnippet(slug) {
  const src = `${FRONTEND_URL}/embed/events/${slug}`;
  return `<iframe\n  src="${src}"\n  height="700px"\n  width="100%"\n  style="border: none"\n></iframe>`;
}

export class EventMarketingService {
  static async getSettings(eventId) {
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) throw new ApiError(404, 'Event not found');

    const settings = await db.query.eventMarketingSettings.findFirst({
      where: eq(eventMarketingSettings.eventId, eventId),
    });

    return {
      metaPixelId: settings?.metaPixelId || '',
      tiktokPixelId: settings?.tiktokPixelId || '',
      googleAdsId: settings?.googleAdsId || '',
      googleAnalyticsId: settings?.googleAnalyticsId || '',
      eventUrl: buildEventUrl(event.slug),
      embedSnippet: buildEmbedSnippet(event.slug),
    };
  }

  static async updateSettings(eventId, organizerId, data) {
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) throw new ApiError(404, 'Event not found');
    if (event.organizerId !== organizerId) throw new ApiError(403, 'Not your event');

    const allowedFields = ['metaPixelId', 'tiktokPixelId', 'googleAdsId', 'googleAnalyticsId'];
    const values = {};
    for (const field of allowedFields) {
      if (field in data) values[field] = data[field]?.trim() || null;
    }

    const existing = await db.query.eventMarketingSettings.findFirst({
      where: eq(eventMarketingSettings.eventId, eventId),
    });

    let updated;
    if (existing) {
      [updated] = await db
        .update(eventMarketingSettings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(eventMarketingSettings.eventId, eventId))
        .returning();
    } else {
      [updated] = await db
        .insert(eventMarketingSettings)
        .values({ eventId, ...values })
        .returning();
    }

    return {
      metaPixelId: updated.metaPixelId || '',
      tiktokPixelId: updated.tiktokPixelId || '',
      googleAdsId: updated.googleAdsId || '',
      googleAnalyticsId: updated.googleAnalyticsId || '',
      eventUrl: buildEventUrl(event.slug),
      embedSnippet: buildEmbedSnippet(event.slug),
    };
  }

  /**
   * Public, unauthenticated pixel config for firing tracking events from the
   * event page / checkout flow / embedded widget.
   */
  static async getPublicPixelConfig(eventId) {
    const settings = await db.query.eventMarketingSettings.findFirst({
      where: eq(eventMarketingSettings.eventId, eventId),
    });

    return {
      metaPixelId: settings?.metaPixelId || null,
      tiktokPixelId: settings?.tiktokPixelId || null,
      googleAdsId: settings?.googleAdsId || null,
      googleAnalyticsId: settings?.googleAnalyticsId || null,
    };
  }
}
