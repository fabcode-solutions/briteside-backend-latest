import { normalizeHostname, candidateSuffixes } from './normalizer.js';
import { categoryNamesFromBitmask } from './types.js';
import { getDomainMap, getKeywordMap } from './blocklistManager.js';

const ALLOWED_HOSTNAMES = new Set(); // exact-host allowlist, takes precedence over everything below

/**
 * Request-path lookup — normalize, then in-memory Map reads only. No I/O.
 * @returns {{ blocked: boolean, matchedDomain?: string, categories?: string[] }}
 */
export function matchHostname(rawHostname) {
  const normalized = normalizeHostname(rawHostname);
  if (!normalized || normalized.isIp) return { blocked: false };
  if (ALLOWED_HOSTNAMES.has(normalized.hostname)) return { blocked: false };

  const domainMap = getDomainMap();
  if (domainMap) {
    for (const candidate of candidateSuffixes(normalized)) {
      const bitmask = domainMap.get(candidate);
      if (bitmask) {
        return { blocked: true, matchedDomain: candidate, categories: categoryNamesFromBitmask(bitmask) };
      }
    }
  }

  const keywordMap = getKeywordMap();
  if (keywordMap && keywordMap.size > 0) {
    for (const label of normalized.hostname.split('.')) {
      const bitmask = keywordMap.get(label);
      if (bitmask) {
        return { blocked: true, matchedDomain: label, categories: categoryNamesFromBitmask(bitmask) };
      }
    }
  }

  return { blocked: false };
}

/** Test-only escape hatch — production allowlisting isn't in scope for this pass. */
export function __setAllowlistForTests(hostnames) {
  ALLOWED_HOSTNAMES.clear();
  for (const h of hostnames || []) ALLOWED_HOSTNAMES.add(h);
}
