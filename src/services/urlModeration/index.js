import { extractUrls } from './extractor.js';
import { matchHostname } from './matcher.js';

/**
 * Public entry point for the request path.
 * @param {string|object} content
 * @returns {{ allowed: boolean, violations: { url: string, domain: string, categories: string[] }[] }}
 */
export function checkContentForBlockedUrls(content) {
  const violations = [];
  for (const { url, hostname } of extractUrls(content)) {
    const result = matchHostname(hostname);
    if (result.blocked) {
      violations.push({ url, domain: hostname, categories: result.categories, matchedDomain: result.matchedDomain });
    }
  }
  return { allowed: violations.length === 0, violations };
}

export { matchHostname } from './matcher.js';
export { getStats as getBlocklistStats } from './blocklistManager.js';
