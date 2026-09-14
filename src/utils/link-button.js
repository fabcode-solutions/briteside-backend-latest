import ApiError from './api-error.js';
import { matchHostname } from '../services/urlModeration/matcher.js';
import logger from '../config/logger.js';
import { isBlocked } from '../lib/blocklist.js';

const BLOCKED_LINK_PROTOCOLS = /^(javascript|data|vbscript|file):/i;
const MAX_LABEL_LENGTH = 30;
const MAX_URL_LENGTH = 2000;

/**
 * Validates a { label, url } CTA button. BriteSide Plus only — anyone else gets
 * a 403. Shared by posts and groups so both surfaces enforce identical rules.
 *
 * @param {{label?: string, url?: string}|null|undefined} linkButton
 * @param {boolean} isPlus
 * @param {string} surface - named in the 403 copy, e.g. 'post' or 'group'
 * @returns {{label: string, url: string}|null}
 */
export const sanitizeLinkButton = (linkButton, isPlus, surface) => {
  if (!linkButton) return null;
  if (!isPlus) {
    throw new ApiError(
      403,
      `Adding a link to your ${surface} is a BriteSide Plus feature. Upgrade to add one.`
    );
  }

  const label = String(linkButton.label ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  const rawUrl = String(linkButton.url ?? '').trim();
  if (!label || !rawUrl) {
    throw new ApiError(400, 'Link button requires both a label and a URL');
  }
  if (BLOCKED_LINK_PROTOCOLS.test(rawUrl)) {
    throw new ApiError(400, 'Invalid URL protocol');
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new ApiError(400, 'URL too long');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, 'Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, 'URL must use http or https');
  }

  const blockResult = matchHostname(parsed.hostname);
  if (blockResult.blocked) {
    logger.warn('[urlModeration] blocked link submitted', {
      field: 'linkButton.url',
      hostname: parsed.hostname,
      matchedDomain: blockResult.matchedDomain,
      categories: blockResult.categories,
    });
    throw new ApiError(422, "This link can't be used on this platform.");
  }

  if (isBlocked(parsed.href)) {
    logger.warn('[blocklist] blocked link submitted', {
      field: 'linkButton.url',
      url: parsed.href,
    });
    throw new ApiError(422, "This link can't be used on this platform.");
  }

  return { label, url: parsed.href };
};
