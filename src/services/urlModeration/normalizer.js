import { parse as tldtsParse } from 'tldts';

/**
 * Normalizes a raw hostname (already extracted from a URL) into the form the
 * matcher can use. new URL() upstream already handles IDN to punycode, so
 * this only needs to fix casing/trailing dots and resolve the registrable
 * domain (eTLD+1) via a real public-suffix-list library instead of a manual
 * label walk (correctly handles multi-part TLDs like co.uk).
 *
 * @returns {{ hostname: string, registrableDomain: string|null, isIp: boolean }|null}
 */
export function normalizeHostname(rawHostname) {
  if (!rawHostname || typeof rawHostname !== 'string') return null;

  const hostname = stripControlChars(rawHostname.toLowerCase()).replace(/\.$/, '');

  if (!hostname || hostname.length > 253) return null;

  const parsed = tldtsParse(hostname, { allowPrivateDomains: true });
  if (parsed.isIp) return { hostname, registrableDomain: null, isIp: true };

  return {
    hostname,
    registrableDomain: parsed.domain || null,
    isIp: false,
  };
}

// Strips control characters, null bytes and whitespace a malicious/malformed
// host string could carry (CRLF injection, stray unicode formatting chars).
function stripControlChars(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || code === 0x7f;
    const isWhitespace = code === 0x20;
    if (!isControl && !isWhitespace) out += value[i];
  }
  return out;
}

/**
 * Suffix chain to check against the blocklist Map, from the full hostname
 * down to (and including) the registrable domain, never below it, so a
 * blocklist entry can never accidentally match on a bare public suffix.
 */
export function candidateSuffixes({ hostname, registrableDomain }) {
  if (!registrableDomain) return hostname ? [hostname] : [];

  const candidates = [];
  let current = hostname;
  while (current && current.length >= registrableDomain.length) {
    candidates.push(current);
    if (current === registrableDomain) break;
    const dotIndex = current.indexOf('.');
    if (dotIndex === -1) break;
    current = current.slice(dotIndex + 1);
  }
  return candidates;
}
