// Turns raw source text into a plain array of lowercase domain strings.
// Parsing is intentionally dumb and defensive — a malformed line is skipped,
// never thrown, so one bad line can't sink an entire source.

const HOSTS_IPS = new Set(['0.0.0.0', '127.0.0.1']);
// A label is a-z0-9 plus hyphen; the whole domain must have at least one dot
// (unless it's a bare single-word keyword list, handled separately).
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isPlausibleDomain(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 253 && DOMAIN_RE.test(value);
}

/** `0.0.0.0 example.com` / `127.0.0.1 example.com` hosts-file format. */
export function parseHosts(text) {
  const domains = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutComment = line.split('#')[0].trim();
    if (!withoutComment) continue;

    const parts = withoutComment.split(/\s+/);
    if (parts.length < 2 || !HOSTS_IPS.has(parts[0])) continue;

    for (let i = 1; i < parts.length; i++) {
      const domain = parts[i].toLowerCase();
      if (isPlausibleDomain(domain)) domains.push(domain);
    }
  }
  return domains;
}

/** One bare domain per line, `#` comments allowed. */
export function parsePlainList(text) {
  const domains = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    // Defensive: some feeds occasionally slip in a full URL instead of a bare domain.
    line = line.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
    if (isPlausibleDomain(line)) domains.push(line);
  }
  return domains;
}

/**
 * Bare brand-name keywords (no TLD), e.g. blocklist-url-data/porn.js.
 * Kept as their own list — the matcher treats these as exact hostname-label
 * matches, not full registrable domains.
 */
export function parseKeywordList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(v => String(v).trim().toLowerCase())
    .filter(v => v.length > 0 && v.length <= 63 && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(v));
}

export const PARSERS = {
  hosts: parseHosts,
  plainList: parsePlainList,
  keywordList: parseKeywordList,
};
