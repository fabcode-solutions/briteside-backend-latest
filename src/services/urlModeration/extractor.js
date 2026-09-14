// Finds candidate URLs/domains in free text and turns each into a hostname.
// Deliberately simple and bounded — this runs on every post/comment/message,
// so it must never be the slow part of the request.

const URL_REGEX = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"']*)?/gi;

const MAX_INPUT_LENGTH = 20000; // guards against pathological input driving regex cost up
const MAX_MATCHES = 50;
const MAX_MATCH_LENGTH = 2048; // a single "URL" longer than this is not worth parsing

function toHostname(match) {
  const trimmed = match.length > MAX_MATCH_LENGTH ? match.slice(0, MAX_MATCH_LENGTH) : match;
  try {
    const parsed = new URL(trimmed.startsWith('http') || trimmed.startsWith('ftp') ? trimmed : `http://${trimmed}`);
    return parsed.hostname;
  } catch {
    return trimmed.split('/')[0].split('?')[0].split('#')[0].toLowerCase();
  }
}

/**
 * @param {string|object} content - a string, or an object (stringified so a
 *   URL is found regardless of which key it lives under).
 * @returns {{ url: string, hostname: string }[]}
 */
export function extractUrls(content) {
  if (content == null) return [];
  const text = typeof content === 'object' ? JSON.stringify(content) : String(content);
  if (!text) return [];

  const bounded = text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;
  const matches = bounded.match(URL_REGEX) || [];

  const results = [];
  for (const match of matches.slice(0, MAX_MATCHES)) {
    const hostname = toHostname(match).replace(/[.,;:!?]+$/, '');
    if (hostname) results.push({ url: match, hostname });
  }
  return results;
}
