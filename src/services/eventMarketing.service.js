import { db } from '../db/index.js';
import { eventMarketingSettings, events, users, usernameReservations } from '../db/schema/index.js';
import { eq, and, ne, ilike } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { isReservedUsername } from './usernameReservation.service.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';
const VANITY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

function buildEventUrl(slug) {
  return `${FRONTEND_URL}/events/${slug}`;
}

function buildEmbedSnippet(slug) {
  const src = `${FRONTEND_URL}/embed/events/${slug}`;
  return `<iframe\n  src="${src}"\n  height="700px"\n  width="100%"\n  style="border: none"\n></iframe>`;
}

function normalizeVanitySlug(rawSlug) {
  return (rawSlug || '').toLowerCase().trim();
}

/**
 * Vanity event URLs (briteside.app/<slug>) resolve through the same
 * top-level route as user-profile vanity URLs (briteside.app/<username>),
 * so they share one namespace: reserved words, existing usernames/pending
 * reservations, and other events' vanity slugs all have to be checked.
 */
async function checkVanitySlugAvailability(slug, { excludeEventId } = {}) {
  const normalized = normalizeVanitySlug(slug);

  if (!VANITY_SLUG_PATTERN.test(normalized)) {
    return {
      available: false,
      reason:
        'Must be 3-50 characters: lowercase letters, numbers, and hyphens, not starting or ending with a hyphen',
    };
  }

  if (isReservedUsername(normalized)) {
    return { available: false, reason: 'This URL is reserved' };
  }

  const existingUser = await db.query.users.findFirst({
    where: ilike(users.username, normalized),
    columns: { id: true },
  });
  if (existingUser) {
    return { available: false, reason: 'This URL is already taken' };
  }

  const existingReservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.username, normalized),
      ne(usernameReservations.status, 'rejected')
    ),
    columns: { id: true },
  });
  if (existingReservation) {
    return { available: false, reason: 'This URL is already taken' };
  }

  const existingVanitySlug = await db.query.eventMarketingSettings.findFirst({
    where: excludeEventId
      ? and(
          ilike(eventMarketingSettings.vanitySlug, normalized),
          ne(eventMarketingSettings.eventId, excludeEventId)
        )
      : ilike(eventMarketingSettings.vanitySlug, normalized),
    columns: { id: true },
  });
  if (existingVanitySlug) {
    return { available: false, reason: 'This URL is already taken by another event' };
  }

  return { available: true };
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
      vanitySlug: settings?.vanitySlug || '',
      vanitySlugExpiresAt: settings?.vanitySlugExpiresAt || null,
      eventStatus: event.eventStatus,
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
      vanitySlug: updated.vanitySlug || '',
      vanitySlugExpiresAt: updated.vanitySlugExpiresAt || null,
      eventStatus: event.eventStatus,
    };
  }

  static async checkVanitySlugAvailability(eventId, slug) {
    return checkVanitySlugAvailability(slug, { excludeEventId: eventId });
  }

  static async updateVanitySlug(eventId, organizerId, rawSlug) {
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) throw new ApiError(404, 'Event not found');
    if (event.organizerId !== organizerId) throw new ApiError(403, 'Not your event');
    if (event.eventStatus !== 'published') {
      throw new ApiError(400, 'Event must be published before setting a vanity URL');
    }

    const normalized = normalizeVanitySlug(rawSlug);
    const availability = await checkVanitySlugAvailability(normalized, { excludeEventId: eventId });
    if (!availability.available) {
      throw new ApiError(409, availability.reason);
    }

    const existing = await db.query.eventMarketingSettings.findFirst({
      where: eq(eventMarketingSettings.eventId, eventId),
    });

    const values = { vanitySlug: normalized, vanitySlugExpiresAt: event.endDate };

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
      vanitySlug: updated.vanitySlug || '',
      vanitySlugExpiresAt: updated.vanitySlugExpiresAt || null,
      eventStatus: event.eventStatus,
    };
  }

  /**
   * Resolves briteside.app/<vanitySlug> to the event's permanent slug, for
   * the frontend's top-level vanity route to redirect with. Unauthenticated.
   */
  static async resolveVanitySlug(rawSlug) {
    const normalized = normalizeVanitySlug(rawSlug);

    const settings = await db.query.eventMarketingSettings.findFirst({
      where: ilike(eventMarketingSettings.vanitySlug, normalized),
    });
    if (!settings) return null;
    if (settings.vanitySlugExpiresAt && new Date(settings.vanitySlugExpiresAt) < new Date()) {
      return null;
    }

    const event = await db.query.events.findFirst({ where: eq(events.id, settings.eventId) });
    if (!event || event.eventStatus !== 'published') return null;

    return { slug: event.slug };
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
