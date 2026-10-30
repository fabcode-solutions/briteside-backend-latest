import logger from '../../config/logger.js';

const BASE_URL = 'https://venunite.com/v1/events';
// Paid plans allow 100 rows per request; the REST trial only 25.
const DEFAULT_PAGE_SIZE = 100;
// Geographic queries cost 5 quota units; Basic allows 60 units/minute per key,
// i.e. 12 state queries a minute.
const REQUEST_GAP_MS = 5500;
const MAX_PAGES = 200;
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(apiKey, params, attempt = 1) {
  const res = await fetch(`${BASE_URL}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  if (res.status === 429 && attempt <= 3) {
    const retryAfter = Number(res.headers.get('retry-after')) || 60;
    await sleep(retryAfter * 1000);
    return request(apiKey, params, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`VenuNite ${res.status}: ${body.slice(0, 300)}`);
  }

  await sleep(REQUEST_GAP_MS);
  return res.json();
}

// cost is free-form text such as "$45", "$20 - $40", "Free" or "From $15".
function parseCost(cost) {
  if (!cost) return { priceMin: null, priceMax: null };
  const amounts = String(cost)
    .replace(/,/g, '')
    .match(/\d+(\.\d+)?/g)
    ?.map(Number)
    .filter(Number.isFinite);
  if (!amounts?.length) return { priceMin: null, priceMax: null };
  return { priceMin: Math.min(...amounts), priceMax: Math.max(...amounts) };
}

const categoryName = c => (typeof c === 'string' ? c : c?.name || c?.label || c?.slug);

/** Converts a VenuNite event into the shared shape used by the sync service. */
export function normalizeVenuniteEvent(raw) {
  const venue = raw.venue;
  const url = raw.ticketUrl || raw.eventUrl || raw.website;
  const startDate = raw.startDate ? new Date(raw.startDate) : null;
  if (!raw.id || !raw.title || !url || !venue?.name || !startDate || isNaN(startDate)) {
    return null;
  }

  let endDate = raw.endDate ? new Date(raw.endDate) : null;
  if (!endDate || isNaN(endDate) || endDate <= startDate) {
    endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MS);
  }

  const { priceMin, priceMax } = parseCost(raw.cost);

  return {
    source: 'venunite',
    externalId: String(raw.id),
    title: raw.title.trim(),
    description: raw.description || raw.summary || null,
    url,
    startDate,
    endDate,
    status: 'active',
    imageUrl: raw.imageUrl || null,
    priceMin: raw.isFree ? 0 : priceMin,
    priceMax: raw.isFree ? 0 : priceMax,
    isFree: !!raw.isFree,
    categoryHints: (raw.categories || []).map(categoryName).filter(Boolean),
    venue: {
      name: venue.name.trim(),
      address: venue.address || null,
      city: venue.city || null,
      stateCode: venue.state || null,
      postalCode: venue.postalCode || venue.zip || null,
      countryCode: 'US',
      latitude: Number.isFinite(Number(venue.latitude)) ? Number(venue.latitude) : null,
      longitude: Number.isFinite(Number(venue.longitude)) ? Number(venue.longitude) : null,
    },
  };
}

/**
 * Every upcoming VenuNite event in one US state, normalized. `complete` is
 * false when paging was cut short (page cap, or `maxPages` for a test run),
 * so callers know absence from the result doesn't mean an event was removed
 * upstream.
 */
export async function fetchVenuniteEvents({
  apiKey,
  stateCode,
  from,
  to,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = MAX_PAGES,
}) {
  const byId = new Map();
  let cursor;

  for (let page = 0; page < maxPages; page++) {
    const params = {
      state: stateCode,
      starts_after: from.toISOString(),
      starts_before: to.toISOString(),
      limit: String(pageSize),
    };
    if (cursor) params.cursor = cursor;

    const data = await request(apiKey, params);
    for (const item of data.data || []) {
      const normalized = normalizeVenuniteEvent(item);
      if (normalized) byId.set(normalized.externalId, normalized);
    }

    // A short or empty page can still have more behind it — only hasMore ends paging.
    if (!data.page?.hasMore || !data.page?.nextCursor) {
      return { events: [...byId.values()], complete: true };
    }
    cursor = data.page.nextCursor;
  }

  logger.warn('[venunite] Stopped paging at the page cap', { stateCode, maxPages, fetched: byId.size });
  return { events: [...byId.values()], complete: false };
}
