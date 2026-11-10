import logger from '../../config/logger.js';
import { parseCost, pickVenuniteHostUrl } from './venunite.client.js';

// VenuNite's free MCP server, for EVALUATION ONLY. Their terms allow free MCP
// for "personal discovery ... and product evaluation"; production imports and
// bulk access need a paid plan, which uses the REST client (venunite.client.js).
// Free Builder key: 20 events per search, 30 calls/minute, 500 calls/day.
const MCP_URL = 'https://mcp.venunite.com/v1/mcp/';
const PAGE_SIZE = 20;
const REQUEST_GAP_MS = 2100;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

// MCP searches by point + radius, and a statewide place_name search times out.
// Add a state here to evaluate it.
const STATE_CENTERS = {
  CT: { lat: 41.6032, lng: -72.7266, radiusMiles: 60 },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSession(apiKey) {
  let sessionId;
  let nextId = 1;

  async function send(method, params, { notification = false, attempt = 1 } = {}) {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        ...(notification ? {} : { id: nextId++ }),
      }),
    });
    sessionId = res.headers.get('mcp-session-id') || sessionId;

    if ((res.status === 429 || res.status >= 500) && attempt <= 2) {
      await sleep((Number(res.headers.get('retry-after')) || 5) * 1000);
      return send(method, params, { notification, attempt: attempt + 1 });
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`VenuNite MCP ${res.status}: ${text.slice(0, 300)}`);
    if (notification || !text) return null;

    // Streamable HTTP may answer as a one-message SSE stream.
    const json = res.headers.get('content-type')?.includes('text/event-stream')
      ? text
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('')
      : text;
    const message = JSON.parse(json);
    if (message.error) throw new Error(`VenuNite MCP ${method}: ${message.error.message}`);
    return message.result;
  }

  return {
    async initialize() {
      await send('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'briteside', version: '1.0' },
      });
      await send('notifications/initialized', {}, { notification: true });
    },
    async searchEvents(args) {
      const result = await send('tools/call', { name: 'search_events', arguments: args });
      if (result?.isError) {
        throw new Error(`VenuNite MCP search_events: ${result.content?.[0]?.text?.slice(0, 300)}`);
      }
      await sleep(REQUEST_GAP_MS);
      return result?.structuredContent?.results || [];
    },
  };
}

/** Converts an MCP search_events result into the shared shape used by the sync service. */
export function normalizeVenuniteMcpEvent(raw) {
  const venue = raw.venue;
  // Their terms require keeping the published source/ticket link. Prefer the
  // host's page; event_url (VenuNite's own page) is only a last resort.
  const url = pickVenuniteHostUrl([raw.url, raw.source_url, raw.event_url]);
  const startDate = raw.start ? new Date(raw.start) : null;
  if (!raw.event_id || !raw.title || !url || !venue?.name || !startDate || isNaN(startDate)) {
    return null;
  }

  let endDate = raw.end ? new Date(raw.end) : null;
  if (!endDate || isNaN(endDate) || endDate <= startDate) {
    endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MS);
  }

  const { priceMin, priceMax } = Number.isFinite(raw.cost_numeric)
    ? { priceMin: raw.cost_numeric, priceMax: raw.cost_numeric }
    : parseCost(raw.cost_text);

  return {
    source: 'venunite',
    externalId: String(raw.event_id),
    title: raw.title.trim(),
    description: raw.description || null,
    url,
    startDate,
    endDate,
    status: 'active',
    imageUrl: raw.image_url || null,
    priceMin: raw.is_free ? 0 : priceMin,
    priceMax: raw.is_free ? 0 : priceMax,
    isFree: !!raw.is_free,
    categoryHints: raw.category ? [raw.category.replace(/-/g, ' ')] : [],
    venue: {
      name: venue.name.trim(),
      address: null,
      city: venue.city || null,
      stateCode: venue.state || null,
      postalCode: null,
      countryCode: 'US',
      latitude: null,
      longitude: null,
    },
  };
}

/**
 * Upcoming VenuNite events around one state's centre, via the free MCP
 * server. Search returns at most 20 events and "date" sort isn't strictly
 * chronological across a long range, so it searches one day at a time and
 * pages within a full day from its latest event. `maxPages` caps the total
 * number of searches. Always `complete: false` — an evaluation run must never
 * unlist events it didn't happen to fetch.
 */
export async function fetchVenuniteMcpEvents({
  apiKey,
  stateCode,
  from,
  to,
  maxPages = DEFAULT_MAX_PAGES,
}) {
  const center = STATE_CENTERS[stateCode];
  if (!center) throw new Error(`No VenuNite MCP search centre for ${stateCode} — add it to STATE_CENTERS`);

  const session = createSession(apiKey);
  await session.initialize();

  const byId = new Map();
  let pages = 0;

  for (let dayStart = from; dayStart < to && pages < maxPages; ) {
    const dayEnd = new Date(Math.min(dayStart.getTime() + 86400000, to.getTime()));
    let cursor = dayStart;

    while (cursor < dayEnd && pages < maxPages) {
      pages++;
      const results = await session.searchEvents({
        center_lat: center.lat,
        center_lng: center.lng,
        radius_miles: center.radiusMiles,
        date_start: cursor.toISOString(),
        date_end: dayEnd.toISOString(),
        date_match: 'starts_within',
        sort: 'date',
        limit: PAGE_SIZE,
        max_events_per_venue: PAGE_SIZE,
      });

      let latest = cursor;
      for (const item of results) {
        const normalized = normalizeVenuniteMcpEvent(item);
        if (!normalized) continue;
        byId.set(normalized.externalId, normalized);
        if (normalized.startDate > latest) latest = normalized.startDate;
      }

      if (results.length < PAGE_SIZE) break;
      // A full page all starting at the cursor would repeat forever — step past it.
      cursor = latest > cursor ? latest : new Date(cursor.getTime() + 60 * 1000);
    }
    dayStart = dayEnd;
  }

  logger.info('[venunite-mcp] Fetched', { stateCode, events: byId.size });
  return { events: [...byId.values()], complete: false };
}
