import logger from '../../config/logger.js';

/**
 * Reads an event's description from its listing page (the host's own site,
 * Eventbrite, a library calendar, …) for sources whose feed has none.
 *
 * Order of preference:
 *   1. schema.org JSON-LD `Event.description` (most event sites publish it)
 *   2. <meta property="og:description">
 *   3. <meta name="description">
 * Only text is kept — HTML is stripped and entities decoded. Returns null
 * when nothing useful is found or the page can't be fetched.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_DESCRIPTION_CHARS = 5000;
const MIN_DESCRIPTION_CHARS = 40;
const USER_AGENT =
  'Mozilla/5.0 (compatible; BritesideBot/1.0; +https://www.briteside.app) event description fetcher';

// Sites whose terms forbid scraping, or that only ever return bot walls.
const SKIP_HOSTS = /(^|\.)(ticketmaster\.[a-z.]+|livenation\.[a-z.]+|venunite\.com)$/i;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  frac12: '½',
  euro: '€',
  pound: '£',
  cent: '¢',
  times: '×',
  szlig: 'ß',
};

// Accented letters: &eacute; &Ntilde; &uuml; &aring; &ccedil; …
const ACCENT_BASES = {
  acute: 'aeiouyAEIOUY',
  grave: 'aeiouAEIOU',
  circ: 'aeiouAEIOU',
  uml: 'aeiouyAEIOU',
  tilde: 'anoANO',
  ring: 'aA',
  cedil: 'cC',
};
const COMBINING = { acute: '́', grave: '̀', circ: '̂', uml: '̈', tilde: '̃', ring: '̊', cedil: '̧' };

function decodeNamed(code) {
  if (NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()]) {
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()];
  }
  const m = code.match(/^([a-zA-Z])(acute|grave|circ|uml|tilde|ring|cedil)$/);
  if (m && ACCENT_BASES[m[2]].includes(m[1])) return (m[1] + COMBINING[m[2]]).normalize('NFC');
  return null;
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return decodeNamed(code) ?? match;
  });
}

// "…", "...", "[…]" or "[...]" at the end = an excerpt, not the full text.
const TRUNCATION_MARKER = /\s*(\[\s*(…|\.\.\.)\s*\]|…|\.\.\.)\s*$/;

/** True when `text` is a cut-off excerpt (feeds and preview tags often are). */
export const isTruncated = text => !!text && TRUNCATION_MARKER.test(text.trim());

// Under this, a description is likely a one-line summary (e.g. Eventbrite's)
// and the listing page is worth checking for the full text.
const SHORT_DESCRIPTION_CHARS = 200;

/** True when the listing page may have a fuller version of `text`. */
export const mayBeIncomplete = text =>
  !text?.trim() || isTruncated(text) || text.trim().length < SHORT_DESCRIPTION_CHARS;

/**
 * Tidies description text from any source: literal "\n" escape sequences
 * some feeds leave in, runs of blank lines, and a "[…]" excerpt marker
 * (shown as a plain "…").
 */
// Link/button labels that leak into page text ("VIEW SHOWTIMES(opens in new tab)").
const LINK_LABEL_LINE = /\((opens|open) in (a )?new (tab|window)\)\s*$/i;
// Short call-to-action buttons: "VIEW PLANETARIUM SHOWS & SHOWTIMES", "Buy tickets →".
const CTA_VERB = /^(view|buy|get|register|learn more|read more|click|book|rsvp|purchase|reserve|sign up|see|shop|donate)\b/i;
const isCtaLine = line =>
  line.length <= 60 &&
  CTA_VERB.test(line) &&
  (line === line.toUpperCase() || /[→»›>]\s*$/.test(line));

export function cleanDescription(text) {
  if (!text) return null;
  const lines = text
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .split('\n');
  // Drop button/link-label lines, and paragraphs that repeat an earlier one.
  const seen = new Set();
  const kept = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (LINK_LABEL_LINE.test(trimmed) || isCtaLine(trimmed)) return false;
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
    if (key.length > 15 && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cleaned = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\[\s*(…|\.\.\.)\s*\]\s*$/, '…')
    .trim();
  return cleaned || null;
}

/** HTML (or plain text with entities) → readable plain text with paragraph breaks. */
export function htmlToText(value) {
  if (!value) return '';
  // Some sites double-encode HTML inside JSON-LD (&lt;p&gt;…).
  let html = /&lt;\/?[a-z]/i.test(value) ? decodeEntities(value) : value;
  html = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    // Text meant only for screen readers ("(opens in new tab)", icon labels).
    .replace(
      /<(span|div|em|strong)\b[^>]*class="[^"]*\b(screen-reader-text|sr-only|visually-hidden|visuallyhidden)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
      ''
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(li|tr)>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|section|article)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    // Inline tags sit inside words/sentences — drop them without adding space.
    .replace(/<\/?(a|span|em|strong|b|i|u|small|sup|sub|abbr|mark|font)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(html)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metaContent(html, attr, name) {
  // Attribute order varies: <meta property="x" content="y"> or content first.
  const patterns = [
    new RegExp(`<meta[^>]*${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${name}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

const isEventType = type =>
  (Array.isArray(type) ? type : [type]).some(t => typeof t === 'string' && /Event$/i.test(t));

/** Every JSON-LD node on the page, flattening @graph and arrays. */
function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const stack = [parsed];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) stack.push(...node);
        else if (node && typeof node === 'object') {
          nodes.push(node);
          if (node['@graph']) stack.push(node['@graph']);
        }
      }
    } catch {
      // Malformed JSON-LD is common — ignore that block.
    }
  }
  return nodes;
}

/** Same check the sync uses to tell its own generated text from a real one. */
const looksGeneric = (text, title) => {
  const t = text.toLowerCase();
  return (
    t.length < MIN_DESCRIPTION_CHARS ||
    (title && t === title.toLowerCase()) ||
    /^(buy|get) tickets\b/.test(t) ||
    // Ticketing sites' auto-generated summary ("Eventbrite - X presents Y - Friday, …").
    /^eventbrite - .+ presents /.test(t) ||
    /\b(cookies?|javascript)\b.*\b(enable|required)\b/.test(t)
  );
};

// Elements event platforms put the full description in (The Events Calendar,
// its Beaver Builder module, LibCal, Drupal, WordPress, schema.org microdata).
const CONTENT_CONTAINERS = [
  /<(div|section)\b[^>]*class="[^"]*\btribe-events-single-event-description\b[^"]*"[^>]*>/i,
  /<(div|section)\b[^>]*class="[^"]*\bfl-module-fl-the-events-calendar-description\b[^"]*"[^>]*>/i,
  /<(div|section)\b[^>]*id="s-lc-event-desc"[^>]*>/i,
  /<(div|section)\b[^>]*itemprop="description"[^>]*>/i,
  /<(div|section)\b[^>]*class="[^"]*\b(event-description|event__description|eventDescription)\b[^"]*"[^>]*>/i,
  /<(div|section)\b[^>]*class="[^"]*\bfield--name-body\b[^"]*"[^>]*>/i,
  /<(div|section|article)\b[^>]*class="[^"]*\bentry-content\b[^"]*"[^>]*>/i,
];

/** Inner HTML of the element opened at `start` (balanced on its tag name). */
function elementInnerHtml(html, start, openTag, tag) {
  const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = start + openTag.length;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start + openTag.length, m.index);
  }
  return null;
}

/** Text of the page's main description block, when a known one exists. */
function contentBlockText(html) {
  for (const re of CONTENT_CONTAINERS) {
    const m = re.exec(html);
    if (!m) continue;
    const inner = elementInnerHtml(html, m.index, m[0], m[1]);
    const text = inner && htmlToText(inner);
    if (text && text.length >= MIN_DESCRIPTION_CHARS) return text;
  }
  return null;
}

/** The JSON array starting at `start` (a "["), or null. String-aware bracket matching. */
function jsonArrayAt(html, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length && i < start + MAX_HTML_BYTES; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Eventbrite: the full "About this event" text lives in the page's embedded
 * data (structuredContent → modules[type=text]); its preview tags only carry
 * the one-line summary.
 */
function eventbriteFullText(html) {
  const at = html.indexOf('"structuredContent"');
  if (at === -1) return null;
  const modulesAt = html.indexOf('"modules":[', at);
  if (modulesAt === -1 || modulesAt - at > 2000) return null;
  const modules = jsonArrayAt(html, modulesAt + '"modules":'.length);
  if (!Array.isArray(modules)) return null;
  const text = modules
    .filter(m => m?.type === 'text' && typeof m.text === 'string')
    .map(m => htmlToText(m.text))
    .filter(Boolean)
    .join('\n\n');
  return text.length >= MIN_DESCRIPTION_CHARS ? text : null;
}

/** A comparable prefix, ignoring spacing and punctuation differences. */
const fingerprint = text => text.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 60);

const capLength = text =>
  text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS).replace(/\s+\S*$/, '')}…`
    : text;

/**
 * Pulls the best description out of a page's HTML. Preview tags (JSON-LD,
 * og:description, meta description) are often cut-off excerpts; the page's
 * description block holds the full text, so it wins when it starts with the
 * same words (or nothing else is available). Exported for tests.
 */
export function extractDescription(html, title) {
  const raw = [];
  for (const node of jsonLdNodes(html)) {
    if (isEventType(node['@type']) && typeof node.description === 'string') raw.push(node.description);
  }
  raw.push(
    metaContent(html, 'property', 'og:description'),
    metaContent(html, 'name', 'description'),
    metaContent(html, 'name', 'twitter:description')
  );
  const previews = raw
    .map(r => cleanDescription(htmlToText(r ?? '')))
    .filter(text => text && !looksGeneric(text, title));

  // Platform-specific full text (it needn't start like the summary does).
  const platformText = cleanDescription(eventbriteFullText(html));
  if (platformText && platformText.length > Math.max(0, ...previews.map(p => p.length))) {
    return capLength(platformText);
  }

  const block = cleanDescription(contentBlockText(html));
  if (block && !looksGeneric(block, title)) {
    const matchesPreview =
      !previews.length || previews.some(p => fingerprint(block).startsWith(fingerprint(p).slice(0, 30)));
    const longer = !previews.length || block.length >= Math.max(...previews.map(p => p.length));
    if (matchesPreview && longer) return capLength(block);
  }

  // Otherwise the first complete preview in preference order (JSON-LD, then
  // og:, then meta); if every one is cut off, the longest of them.
  const best =
    previews.find(p => !isTruncated(p)) ?? [...previews].sort((a, b) => b.length - a.length)[0];
  return best ? capLength(best) : null;
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

/** Fetches `url` and returns its event description, or null. Never throws. */
export async function fetchPageDescription(url, title) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (SKIP_HOSTS.test(host)) return null;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('html')) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return extractDescription(await readCapped(res), title);
  } catch (err) {
    logger.debug?.(`[external-events] description fetch failed for ${host}: ${err.message}`);
    return null;
  }
}

// A page's result (found or not) is reused for a day instead of fetched again —
// descriptions rarely change and the sync runs every 6 hours. Lives for the
// process lifetime (the cron runs inside the API server).
const REUSE_FOR_MS = 24 * 60 * 60 * 1000;
const recentResults = new Map();

/**
 * Per-run fetcher: each URL is fetched once, at most `concurrency` at a time,
 * and no more than `limit` pages per run (later calls resolve to null — those
 * events get their description on a following run). `fetched` / `found`
 * count what happened.
 */
export function createDescriptionFetcher({ concurrency = 6, limit = 400 } = {}) {
  const cache = new Map();
  const queue = [];
  let active = 0;
  const counts = { fetched: 0, found: 0 };

  const runNext = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { url, title, resolve } = queue.shift();
    fetchPageDescription(url, title)
      .then(description => {
        if (description) counts.found++;
        recentResults.set(url, { at: Date.now(), description });
        resolve(description);
      })
      .finally(() => {
        active--;
        runNext();
      });
  };

  const fetchDescription = (url, title) => {
    if (!url || limit <= 0) return Promise.resolve(null);
    if (cache.has(url)) return cache.get(url);
    const recent = recentResults.get(url);
    if (recent && Date.now() - recent.at < REUSE_FOR_MS) return Promise.resolve(recent.description);
    if (counts.fetched >= limit) return Promise.resolve(null);
    counts.fetched++;
    const promise = new Promise(resolve => {
      queue.push({ url, title, resolve });
      runNext();
    });
    cache.set(url, promise);
    return promise;
  };
  fetchDescription.counts = counts;
  return fetchDescription;
}
