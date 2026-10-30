import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../../config/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 200;
// Discovery API only serves items up to index 1000 (size * page < 1000), so a
// window holding more than this is split in half until each part fits.
const MAX_REACHABLE = 1000;
const MIN_WINDOW_MS = 6 * 60 * 60 * 1000;
// 5 requests/second quota — stay comfortably under it.
const REQUEST_GAP_MS = 250;
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Ticketmaster rejects milliseconds in startDateTime/endDateTime.
const toTmDate = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function request(params, attempt = 1) {
  const url = `${BASE_URL}?${new URLSearchParams(params)}`;
  const res = await fetch(url);

  if (res.status === 429 && attempt <= 3) {
    await sleep(2000 * attempt);
    return request(params, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ticketmaster ${res.status}: ${body.slice(0, 300)}`);
  }

  await sleep(REQUEST_GAP_MS);
  return res.json();
}

function pickImage(images = []) {
  const candidates = images.filter(img => img.url && !img.fallback);
  const pool = candidates.length ? candidates : images.filter(img => img.url);
  const wide = pool.filter(img => img.ratio === '16_9');
  return (wide.length ? wide : pool).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
}

function resolveStart(dates) {
  const start = dates?.start;
  if (!start || start.dateTBD || start.dateTBA) return null;
  if (start.dateTime) return new Date(start.dateTime);
  if (!start.localDate) return null;
  // Date known but time TBA — anchor to the evening in the venue's timezone.
  const localTime = start.noSpecificTime || !start.localTime ? '19:00:00' : start.localTime;
  const tz = dates.timezone || 'America/New_York';
  return dayjs.tz(`${start.localDate}T${localTime}`, tz).toDate();
}

function mapStatus(code) {
  if (code === 'cancelled') return 'cancelled';
  if (code === 'postponed') return 'postponed';
  return 'active';
}

/** Converts a Discovery API event into the shared shape used by the sync service. */
export function normalizeTicketmasterEvent(raw) {
  const venue = raw._embedded?.venues?.[0];
  const startDate = resolveStart(raw.dates);
  if (!raw.id || !raw.name || !raw.url || !venue?.name || !startDate) return null;

  const endDate = raw.dates?.end?.dateTime
    ? new Date(raw.dates.end.dateTime)
    : new Date(startDate.getTime() + DEFAULT_DURATION_MS);

  const prices = (raw.priceRanges || []).flatMap(p => [p.min, p.max]).filter(Number.isFinite);
  const classification = raw.classifications?.find(c => c.primary) || raw.classifications?.[0];

  return {
    source: 'ticketmaster',
    externalId: raw.id,
    title: raw.name.trim(),
    description: [raw.info, raw.pleaseNote].filter(Boolean).join('\n\n') || null,
    url: raw.url,
    startDate,
    endDate: endDate > startDate ? endDate : new Date(startDate.getTime() + DEFAULT_DURATION_MS),
    status: mapStatus(raw.dates?.status?.code),
    imageUrl: pickImage(raw.images),
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    isFree: false,
    categoryHints: [
      classification?.segment?.name,
      classification?.genre?.name,
      classification?.subGenre?.name,
    ].filter(name => name && name !== 'Undefined'),
    venue: {
      name: venue.name.trim(),
      address: venue.address?.line1 || null,
      city: venue.city?.name || null,
      stateCode: venue.state?.stateCode || null,
      postalCode: venue.postalCode || null,
      countryCode: venue.country?.countryCode || 'US',
      latitude: venue.location?.latitude ? Number(venue.location.latitude) : null,
      longitude: venue.location?.longitude ? Number(venue.location.longitude) : null,
    },
  };
}

async function fetchWindow(apiKey, stateCode, from, to, out) {
  const baseParams = {
    apikey: apiKey,
    countryCode: 'US',
    stateCode,
    startDateTime: toTmDate(from),
    endDateTime: toTmDate(to),
    sort: 'date,asc',
    size: String(PAGE_SIZE),
  };

  const first = await request({ ...baseParams, page: '0' });
  const total = first.page?.totalElements || 0;

  if (total > MAX_REACHABLE && to - from > MIN_WINDOW_MS) {
    const mid = new Date(from.getTime() + Math.floor((to - from) / 2));
    await fetchWindow(apiKey, stateCode, from, mid, out);
    await fetchWindow(apiKey, stateCode, mid, to, out);
    return;
  }
  if (total > MAX_REACHABLE) {
    logger.warn('[ticketmaster] Window still exceeds 1000 events, some will be missed', {
      stateCode,
      from,
      total,
    });
    out.complete = false;
  }

  out.push(...(first._embedded?.events || []));
  const totalPages = Math.min(first.page?.totalPages || 1, Math.ceil(MAX_REACHABLE / PAGE_SIZE));
  for (let page = 1; page < totalPages; page++) {
    const data = await request({ ...baseParams, page: String(page) });
    out.push(...(data._embedded?.events || []));
  }
}

/**
 * Every upcoming Ticketmaster event in one US state, normalized. Duplicate ids
 * (an event on the boundary of two split windows) are collapsed. `complete`
 * is false when some window couldn't be fully paged.
 */
export async function fetchTicketmasterEvents({ apiKey, stateCode, from, to }) {
  const raw = [];
  raw.complete = true;
  await fetchWindow(apiKey, stateCode, from, to, raw);

  const byId = new Map();
  for (const item of raw) {
    const normalized = normalizeTicketmasterEvent(item);
    if (normalized) byId.set(normalized.externalId, normalized);
  }
  return { events: [...byId.values()], complete: raw.complete };
}
