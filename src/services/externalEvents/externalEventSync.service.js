import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { and, asc, eq, gte, lte, lt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  events,
  eventSchedules,
  eventVenueProfiles,
  venues,
  categories,
  organizers,
  users,
} from '../../db/schema/index.js';
import env from '../../config/config.js';
import logger from '../../config/logger.js';
import { generateEventCode, generateOrganizerCode } from '../../utils/code-generator.js';
import { generateUniqueSlug } from '../../utils/event-helpers.js';
import { STATE_NAME_TO_ABBR } from '../../lib/tax/usStates.js';
import { fetchTicketmasterEvents } from './ticketmaster.client.js';
import { fetchVenuniteEvents } from './venunite.client.js';

const SYSTEM_USER_EMAIL = 'external-events@system.briteside.local';
const STATE_ABBR_TO_NAME = Object.fromEntries(
  Object.entries(STATE_NAME_TO_ABBR).map(([name, abbr]) => [abbr, name])
);

// Upstream genre/category words -> Briteside category names (seed-categories.js).
// First match wins, checked in this order.
const CATEGORY_KEYWORDS = [
  ['Music', ['music', 'concert', 'rock', 'pop', 'jazz', 'hip-hop', 'rap', 'country', 'r&b', 'blues', 'classical', 'folk', 'metal', 'dj', 'band', 'orchestra', 'symphony', 'opera', 'karaoke']],
  ['Sports', ['sport', 'basketball', 'hockey', 'baseball', 'football', 'soccer', 'wrestling', 'boxing', 'mma', 'racing', 'golf', 'tennis', 'motorsports', 'rodeo']],
  ['Food & Drink', ['food', 'drink', 'brewery', 'beer', 'wine', 'tasting', 'culinary', 'cocktail', 'farmers market', 'dinner']],
  ['Health & Wellness', ['wellness', 'fitness', 'yoga', 'health', 'meditation', 'run', '5k']],
  ['Education', ['library', 'education', 'lecture', 'class', 'workshop', 'seminar', 'storytime', 'learning']],
  ['Technology', ['tech', 'technology', 'coding', 'gaming', 'esports']],
  ['Business', ['business', 'networking', 'conference', 'expo', 'career']],
  ['Arts & Culture', ['art', 'theatre', 'theater', 'comedy', 'film', 'museum', 'dance', 'ballet', 'musical', 'broadway', 'family', 'festival', 'market', 'trivia', 'community', 'miscellaneous']],
];
const FALLBACK_CATEGORY = 'Arts & Culture';

// When two sources list the same performance, the earlier source here wins:
// a native Briteside listing over any import, and Ticketmaster (official
// ticket link) over VenuNite.
const SOURCE_PRIORITY = ['briteside', 'ticketmaster', 'venunite'];

// Same performance listed by two sources: same day-ish and similar title.
const DUPLICATE_WINDOW_MS = 3 * 60 * 60 * 1000;
const DUPLICATE_TITLE_THRESHOLD = 0.6;
const TITLE_STOPWORDS = new Set(['the', 'and', 'with', 'at', 'of', 'a', 'an', 'live', 'tour', 'presents', 'featuring', 'feat', 'ft', 'in', 'concert', 'tickets']);

let syncInProgress = false;

const titleTokens = title =>
  new Set(
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(t => t.length > 1 && !TITLE_STOPWORDS.has(t))
  );

// Overlap coefficient so "The Lumineers" matches "The Lumineers – Automatic World Tour".
function titleSimilarity(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

const toPrice = value => (Number.isFinite(value) ? value.toFixed(2) : null);

const SELLER_NAME = { ticketmaster: 'Ticketmaster', venunite: 'the organizer' };

const IMAGE_CHECK_TIMEOUT_MS = 8000;

/**
 * Absolute image URL, or null. Some listings carry another site's Next.js
 * image-proxy path ("/_next/image?url=…") — unwrap it to the real image.
 */
function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('/_next/image')) {
    const inner = new URLSearchParams(url.split('?')[1] || '').get('url');
    return inner && /^https?:\/\//i.test(inner) ? inner : null;
  }
  return /^https?:\/\//i.test(url) ? url : null;
}

async function isLoadableImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BritesideBot/1.0)' },
      signal: AbortSignal.timeout(IMAGE_CHECK_TIMEOUT_MS),
    });
    const type = res.headers.get('content-type') || '';
    await res.body?.cancel();
    return res.ok && type.startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * Per-run check that a cover actually loads — sources hand out images behind
 * hotlink protection (403), pages instead of images, and dead hosts.
 * Resolves to a usable URL or null; each URL is fetched once per run.
 */
function createImageChecker() {
  const cache = new Map();
  return url => {
    const resolved = resolveImageUrl(url);
    if (!resolved) return Promise.resolve(null);
    if (!cache.has(resolved)) {
      cache.set(resolved, isLoadableImage(resolved).then(ok => (ok ? resolved : null)));
    }
    return cache.get(resolved);
  };
}

// Most Ticketmaster listings carry no info text — give the About section
// something better than blank, e.g. "Comedy at Ridgefield Playhouse in
// Ridgefield, CT. Tickets are sold by Ticketmaster."
function describe(item) {
  if (item.description?.trim()) return item.description;
  const kind = item.categoryHints.find(h => !/^(miscellaneous|other)$/i.test(h));
  const place = [item.venue.city, item.venue.stateCode].filter(Boolean).join(', ');
  const what = `${kind ? `${kind} at` : 'Live at'} ${item.venue.name}${place ? ` in ${place}` : ''}.`;
  return `${what} Tickets are sold by ${SELLER_NAME[item.source] ?? 'the original seller'}.`;
}

function applyAffiliate(source, url) {
  const template = env.externalEvents.ticketmasterAffiliateUrlTemplate;
  if (source !== 'ticketmaster' || !template) return url;
  return template.replace('{url}', encodeURIComponent(url));
}

async function getOrCreateSystemOrganizer() {
  if (env.externalEvents.organizerId) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.id, env.externalEvents.organizerId),
    });
    if (!organizer) throw new Error('EXTERNAL_EVENTS_ORGANIZER_ID does not match an organizer');
    return organizer;
  }

  let user = await db.query.users.findFirst({ where: eq(users.email, SYSTEM_USER_EMAIL) });
  if (!user) {
    // Random password nobody knows — this account is never logged into.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    [user] = await db
      .insert(users)
      .values({
        email: SYSTEM_USER_EMAIL,
        username: 'briteside_discover',
        passwordHash,
        firstName: 'Briteside',
        lastName: 'Discover',
        phoneNumber: 'sys-external-events',
      })
      .returning();
  }

  let organizer = await db.query.organizers.findFirst({ where: eq(organizers.userId, user.id) });
  if (!organizer) {
    [organizer] = await db
      .insert(organizers)
      .values({
        organizerCode: generateOrganizerCode(),
        userId: user.id,
        businessName: 'Briteside Discover',
        businessDescription:
          'Events happening near you, listed for discovery. Tickets are sold by the original seller.',
      })
      .returning();
    logger.info('[externalEvents] Created system organizer', { organizerId: organizer.id });
  }
  return organizer;
}

async function loadCategoryResolver() {
  const rows = await db.query.categories.findMany({ where: eq(categories.isActive, true) });
  const byName = new Map(rows.map(c => [c.name.toLowerCase(), c.id]));
  const fallbackId = byName.get(FALLBACK_CATEGORY.toLowerCase()) || rows[0]?.id;
  if (!fallbackId) throw new Error('No active categories exist — run the category seed first');

  return hints => {
    const text = hints.join(' ').toLowerCase();
    const ids = [];
    for (const [name, keywords] of CATEGORY_KEYWORDS) {
      const id = byName.get(name.toLowerCase());
      if (id && !ids.includes(id) && keywords.some(k => text.includes(k))) ids.push(id);
      if (ids.length === 3) break;
    }
    return ids.length ? ids : [fallbackId];
  };
}

function createVenueResolver(systemUserId) {
  const cache = new Map();

  return async venue => {
    const stateAbbr = venue.stateCode?.toUpperCase();
    const stateName = STATE_ABBR_TO_NAME[stateAbbr] || venue.stateCode;
    const key = [venue.name, venue.city, stateAbbr].join('|').toLowerCase();
    if (cache.has(key)) return cache.get(key);

    // Reuse an existing venue (including ones organizers created via Google
    // Places, which store the full state name) before creating a new one.
    const existing = await db
      .select({ id: venues.id })
      .from(venues)
      .where(
        and(
          isNull(venues.deletedAt),
          // trim() so venues saved before names were trimmed still match
          sql`lower(trim(${venues.name})) = lower(${venue.name})`,
          venue.city ? sql`lower(${venues.city}) = lower(${venue.city})` : undefined,
          inArray(venues.state, [stateName, stateAbbr].filter(Boolean))
        )
      )
      .limit(1);

    let venueId = existing[0]?.id;
    if (!venueId) {
      const [created] = await db
        .insert(venues)
        .values({
          name: venue.name.slice(0, 255),
          address:
            venue.address ||
            [venue.city, stateAbbr].filter(Boolean).join(', ') ||
            venue.name,
          latitude: venue.latitude != null ? String(venue.latitude) : null,
          longitude: venue.longitude != null ? String(venue.longitude) : null,
          city: venue.city,
          state: stateName,
          country: 'United States',
          countryCode: venue.countryCode || 'US',
          postalCode: venue.postalCode,
          createdBy: systemUserId,
        })
        .returning({ id: venues.id });
      venueId = created.id;
    }

    cache.set(key, venueId);
    return venueId;
  };
}

/**
 * Whether a higher-priority source already has a published session for this
 * performance (same time ± window, same venue, similar title).
 */
async function isCrossSourceDuplicate(perf, venueId) {
  const higherSources = SOURCE_PRIORITY.slice(0, SOURCE_PRIORITY.indexOf(perf.source));
  if (!higherSources.length) return false;

  const candidates = await db
    .select({ title: events.title, venueId: events.venueId, venueName: venues.name })
    .from(eventSchedules)
    .innerJoin(events, eq(eventSchedules.eventId, events.id))
    .leftJoin(venues, eq(events.venueId, venues.id))
    .where(
      and(
        inArray(events.source, higherSources),
        eq(events.eventStatus, 'published'),
        isNull(eventSchedules.deletedAt),
        gte(eventSchedules.startTime, new Date(perf.startDate.getTime() - DUPLICATE_WINDOW_MS)),
        lte(eventSchedules.startTime, new Date(perf.startDate.getTime() + DUPLICATE_WINDOW_MS)),
        perf.venue.city ? sql`lower(${venues.city}) = lower(${perf.venue.city})` : undefined
      )
    );

  return candidates.some(
    c =>
      (c.venueId === venueId || titleSimilarity(c.venueName || '', perf.venue.name) >= 0.8) &&
      titleSimilarity(c.title, perf.title) >= DUPLICATE_TITLE_THRESHOLD
  );
}

// Ticketmaster lists every performance as its own event; Briteside shows one
// event per show at a venue, with each performance as a session.
function showKey(title, venueId) {
  const normalized = title.toLowerCase().replace(/\s+/g, ' ');
  const hash = crypto.createHash('sha1').update(`${normalized}|${venueId}`).digest('hex');
  return `show_${hash.slice(0, 32)}`;
}

/** Event-level fields for a show, from its performances (cancelled ones included). */
function buildShow(performances, now) {
  const sorted = [...performances].sort((a, b) => a.startDate - b.startDate);
  const live = sorted.filter(p => p.status !== 'cancelled');
  const shown = live.length ? live : sorted;
  // The event-level link and date follow the next performance still to come.
  const lead = shown.find(p => p.endDate >= now) ?? shown[0];
  const prices = shown.flatMap(p => [p.priceMin, p.priceMax]).filter(Number.isFinite);

  return {
    ...lead,
    description: sorted.find(p => p.description)?.description ?? null,
    imageUrl: lead.imageUrl ?? sorted.find(p => p.imageUrl)?.imageUrl ?? null,
    status: !live.length ? 'cancelled' : live.every(p => p.status === 'postponed') ? 'postponed' : 'active',
    startDate: lead.startDate,
    endDate: new Date(Math.max(...shown.map(p => p.endDate.getTime()))),
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    isFree: sorted.every(p => p.isFree),
    performances: live,
  };
}

const sessionRow = (perf, now) => ({
  title: perf.title.slice(0, 255),
  date: perf.startDate,
  startTime: perf.startDate,
  endTime: perf.endDate,
  duration: Math.floor((perf.endDate - perf.startDate) / 60000),
  externalId: perf.externalId,
  externalUrl: applyAffiliate(perf.source, perf.url),
  updatedAt: now,
});

/**
 * Makes the event's sessions match the show's live performances. Sessions
 * for performances no longer listed are only removed after a complete fetch.
 */
async function syncSessions(tx, eventId, show, now, removeMissing) {
  const current = await tx.query.eventSchedules.findMany({
    where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
  });
  const byExternalId = new Map(current.filter(s => s.externalId).map(s => [s.externalId, s]));
  const liveIds = new Set(show.performances.map(p => p.externalId));

  for (const perf of show.performances) {
    const existing = byExternalId.get(perf.externalId);
    if (existing) {
      await tx.update(eventSchedules).set(sessionRow(perf, now)).where(eq(eventSchedules.id, existing.id));
    } else {
      await tx.insert(eventSchedules).values({ eventId, ...sessionRow(perf, now), createdAt: now });
    }
  }

  // Untagged sessions predate per-performance sessions and are always replaced.
  const stale = current.filter(s =>
    s.externalId ? removeMissing && !liveIds.has(s.externalId) : true
  );
  if (stale.length) {
    await tx
      .update(eventSchedules)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(eventSchedules.id, stale.map(s => s.id)));
  }
}

/**
 * Finds the event for a show: by its show key, or else by adopting a row
 * imported before performances were grouped (keyed by a performance id).
 * Other pre-grouping rows for the same show are unlisted.
 */
async function findShowEvent(source, key, performanceIds) {
  const grouped = await db.query.events.findFirst({
    where: and(eq(events.source, source), eq(events.externalId, key)),
  });
  const legacy = performanceIds.length
    ? await db.query.events.findMany({
        where: and(eq(events.source, source), inArray(events.externalId, performanceIds)),
        orderBy: asc(events.createdAt),
      })
    : [];

  const target = grouped ?? legacy[0] ?? null;
  const merged = legacy.filter(e => e.id !== target?.id && e.eventStatus !== 'draft');
  if (merged.length) {
    await db
      .update(events)
      .set({ eventStatus: 'draft', externalStatus: 'merged', updatedAt: new Date() })
      .where(inArray(events.id, merged.map(e => e.id)));
  }
  return target;
}

async function updateShow(existing, show, key, venueId, ctx, isDuplicate) {
  const { now } = ctx;
  const update = {
    externalId: key,
    title: show.title.slice(0, 255),
    description: describe(show),
    venueId,
    startDate: show.startDate,
    endDate: show.endDate,
    isFree: show.isFree,
    externalUrl: applyAffiliate(show.source, show.url),
    externalStatus: show.status,
    externalPriceMin: toPrice(show.priceMin),
    externalPriceMax: toPrice(show.priceMax),
    externalLastSeenAt: now,
    updatedAt: now,
  };
  const cover = show.imageUrl || env.externalEvents.defaultImage;
  if (cover) update.coverImages = [cover];

  if (isDuplicate) {
    // A higher-priority source now lists every performance — hide this copy.
    update.externalStatus = 'duplicate';
    if (existing.eventStatus === 'published') update.eventStatus = 'draft';
  } else if (!cover) {
    // Cover stopped loading and there's no default to fall back to — hide
    // rather than show a broken image; revived once a cover loads again.
    update.externalStatus = 'no_image';
    if (existing.eventStatus === 'published') update.eventStatus = 'draft';
  } else if (show.status === 'cancelled') {
    update.eventStatus = 'cancelled';
    update.cancelledAt = existing.cancelledAt || now;
  } else if (['cancelled', 'removed', 'duplicate', 'no_image'].includes(existing.externalStatus)) {
    // Only revive events this sync hid — never ones an admin took down.
    update.eventStatus = 'published';
    update.cancelledAt = null;
  }

  await db.transaction(async tx => {
    await tx.update(events).set(update).where(eq(events.id, existing.id));
    if (!isDuplicate && show.performances.length) {
      await syncSessions(tx, existing.id, show, now, ctx.complete);
    }
    if (existing.venueId !== venueId) {
      await tx
        .update(eventVenueProfiles)
        .set({ venueId, updatedAt: now })
        .where(eq(eventVenueProfiles.eventId, existing.id));
    }
  });
}

async function insertShow(show, key, venueId, ctx) {
  const { now } = ctx;
  const coverImage = show.imageUrl || env.externalEvents.defaultImage;
  if (!coverImage || !show.performances.length) return 'skipped';

  const baseSlug =
    slugify(show.title, { lower: true, strict: true }).slice(0, 200) || `event-${show.source}-${key}`;
  const slug = await generateUniqueSlug(baseSlug);

  await db.transaction(async tx => {
    const [event] = await tx
      .insert(events)
      .values({
        eventCode: generateEventCode(),
        title: show.title.slice(0, 255),
        slug,
        description: describe(show),
        organizerId: ctx.organizerId,
        categoryIds: ctx.resolveCategories(show.categoryHints),
        venueId,
        eventType: 'public',
        eventStatus: 'published',
        eventMode: 'in_person',
        isFree: show.isFree,
        startDate: show.startDate,
        endDate: show.endDate,
        coverImages: [coverImage],
        // No Briteside tickets exist, so counts/remaining would always read 0.
        showAttendeeCount: false,
        showTicketsRemaining: false,
        isRefundable: false,
        source: show.source,
        externalId: key,
        externalUrl: applyAffiliate(show.source, show.url),
        externalStatus: show.status,
        externalPriceMin: toPrice(show.priceMin),
        externalPriceMax: toPrice(show.priceMax),
        externalLastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: events.id });

    await syncSessions(tx, event.id, show, now, true);
    await tx.insert(eventVenueProfiles).values({ eventId: event.id, venueId, createdAt: now, updatedAt: now });
  });
  return 'created';
}

async function upsertShow(performances, venueId, ctx) {
  const { source, title } = performances[0];
  const key = showKey(title, venueId);

  // Drop performances a higher-priority source already lists.
  const kept = [];
  for (const perf of performances) {
    if (perf.status === 'cancelled' || !(await isCrossSourceDuplicate(perf, venueId))) kept.push(perf);
  }
  const allDuplicates = performances.some(p => p.status !== 'cancelled') &&
    !kept.some(p => p.status !== 'cancelled');

  const existing = await findShowEvent(source, key, performances.map(p => p.externalId));
  const show = buildShow(allDuplicates ? performances : kept, ctx.now);
  show.imageUrl = await ctx.checkImage(show.imageUrl);

  if (existing) {
    await updateShow(existing, show, key, venueId, ctx, allDuplicates);
    return allDuplicates ? 'duplicate' : 'updated';
  }
  if (allDuplicates) return 'duplicate';
  // Nothing upcoming to show — don't create an event that is already cancelled.
  if (show.status === 'cancelled') return 'skipped';
  return insertShow(show, key, venueId, ctx);
}

/** Groups a state's performances into shows (same source, title and venue) and upserts each. */
async function syncPerformances(performances, ctx, stats) {
  const shows = new Map();
  for (const perf of performances) {
    // Some APIs list events outside the requested state (venue near the border).
    if (perf.venue.stateCode?.toUpperCase() !== ctx.stateCode) {
      stats.skipped++;
      continue;
    }
    try {
      const venueId = await ctx.resolveVenue(perf.venue);
      const key = showKey(perf.title, venueId);
      if (!shows.has(key)) shows.set(key, { venueId, performances: [] });
      shows.get(key).performances.push(perf);
    } catch (err) {
      stats.failed++;
      logger.error('[externalEvents] Venue resolve failed', { externalId: perf.externalId, error: err.message });
    }
  }

  stats.shows += shows.size;
  for (const { venueId, performances: group } of shows.values()) {
    try {
      stats[await upsertShow(group, venueId, ctx)]++;
    } catch (err) {
      stats.failed++;
      logger.error('[externalEvents] Upsert failed', {
        source: group[0].source,
        title: group[0].title,
        error: err.message,
      });
    }
  }
}

/**
 * Upcoming events of `source` in the synced states that weren't returned by
 * this run are gone upstream — unlist them (reversible on a later sync).
 */
async function unlistMissing(source, stateCodes, runStartedAt, windowEnd) {
  const stateValues = stateCodes.flatMap(code => [code, STATE_ABBR_TO_NAME[code]]).filter(Boolean);
  const venueIds = db.select({ id: venues.id }).from(venues).where(inArray(venues.state, stateValues));

  const unlisted = await db
    .update(events)
    .set({ eventStatus: 'draft', externalStatus: 'removed', updatedAt: new Date() })
    .where(
      and(
        eq(events.source, source),
        eq(events.eventStatus, 'published'),
        gte(events.startDate, runStartedAt),
        lte(events.startDate, windowEnd),
        lt(events.externalLastSeenAt, runStartedAt),
        inArray(events.venueId, venueIds)
      )
    )
    .returning({ id: events.id });
  return unlisted.length;
}

const SOURCES = [
  // Ticketmaster first: when both list the same show, the one with the
  // official ticket link wins and the VenuNite copy is skipped as a duplicate.
  { name: 'ticketmaster', apiKey: () => env.externalEvents.ticketmasterApiKey, fetch: fetchTicketmasterEvents },
  {
    name: 'venunite',
    apiKey: () => env.externalEvents.venuniteApiKey,
    daysAhead: () => env.externalEvents.venuniteDaysAhead,
    fetch: opts => fetchVenuniteEvents({ ...opts, pageSize: env.externalEvents.venunitePageSize }),
  },
];

/**
 * Pulls upcoming events for the configured states from every source that has
 * an API key and mirrors them into the events table. `maxPages` caps paging
 * for a test run (VenuNite only) — such a run never unlists anything.
 */
export async function syncExternalEvents({ sources, maxPages } = {}) {
  if (syncInProgress) {
    logger.warn('[externalEvents] Sync already running, skipping');
    return null;
  }
  syncInProgress = true;

  try {
    const runStartedAt = new Date();
    const stateCodes = env.externalEvents.states;
    const organizer = await getOrCreateSystemOrganizer();
    const resolveCategories = await loadCategoryResolver();
    const resolveVenue = createVenueResolver(organizer.userId);
    const checkImage = createImageChecker();
    const summary = {};

    for (const source of SOURCES) {
      const apiKey = source.apiKey();
      if (!apiKey || (sources && !sources.includes(source.name))) continue;

      // Unlisting below uses the same window, so a shorter source lookahead
      // never hides events beyond what that source was asked for.
      const daysAhead = source.daysAhead?.() ?? env.externalEvents.daysAhead;
      const windowEnd = new Date(runStartedAt.getTime() + daysAhead * 86400000);

      // fetched counts performances; the rest count shows (one event each).
      const stats = { fetched: 0, shows: 0, created: 0, updated: 0, duplicate: 0, skipped: 0, failed: 0, unlisted: 0 };
      let complete = true;

      for (const stateCode of stateCodes) {
        let result;
        try {
          result = await source.fetch({ apiKey, stateCode, from: runStartedAt, to: windowEnd, maxPages });
        } catch (err) {
          complete = false;
          logger.error('[externalEvents] Fetch failed', { source: source.name, stateCode, error: err.message });
          continue;
        }
        complete &&= result.complete;
        stats.fetched += result.events.length;

        const ctx = {
          stateCode,
          organizerId: organizer.id,
          resolveVenue,
          resolveCategories,
          checkImage,
          complete: result.complete,
          now: new Date(),
        };
        await syncPerformances(result.events, ctx, stats);
      }

      // A partial fetch can't tell "removed upstream" from "not fetched".
      if (complete) {
        stats.unlisted = await unlistMissing(source.name, stateCodes, runStartedAt, windowEnd);
      }

      summary[source.name] = stats;
      logger.info('[externalEvents] Source synced', { source: source.name, complete, ...stats });
    }

    return summary;
  } finally {
    syncInProgress = false;
  }
}
