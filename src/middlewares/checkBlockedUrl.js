// src/middlewares/checkBlockedUrl.js
import { extractUrls } from '../services/urlModeration/extractor.js';
import { matchHostname } from '../services/urlModeration/matcher.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';

const GENERIC_MESSAGE = "This content contains a link that isn't allowed on this platform.";

function getNested(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Full classification stays server-side only — the error middleware
// serializes an ApiError's `details` straight into the client response, so a
// blocked-link violation is logged directly instead of attached to the error.
function logViolation(req, field, url, hostname, result) {
  logger.warn('[urlModeration] blocked link submitted', {
    userId: req.user?.id,
    field,
    url,
    hostname,
    matchedDomain: result.matchedDomain,
    categories: result.categories,
  });
}

export function checkBlockedUrl(fieldName = 'url', { optional = false, scanText = false } = {}) {
  return function (req, res, next) {
    try {
      const value = getNested(req.body, fieldName);

      if (value === undefined || value === null || value === '') {
        if (optional) return next();
        throw new ApiError(400, `Missing required field: ${fieldName}`);
      }

      // Optional/free-text fields don't have to be URLs at all — only run the
      // blocklist check when the value actually contains one, otherwise let
      // non-URL content through untouched.
      if (optional && extractUrls(value).length === 0) {
        return next();
      }

      if (scanText) {
        // Accepts a string OR an object (e.g. buttonMeta) — objects get
        // stringified so we can find a URL regardless of its key name.
        for (const { url, hostname } of extractUrls(value)) {
          const result = matchHostname(hostname);
          if (result.blocked) {
            logViolation(req, fieldName, url, hostname, result);
            throw new ApiError(422, GENERIC_MESSAGE);
          }
        }
      } else {
        if (typeof value !== 'string') {
          throw new ApiError(400, `Invalid value for field: ${fieldName}`);
        }
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          throw new ApiError(400, `Invalid URL in field:  ${fieldName}`);
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new ApiError(400, 'Only http and https URLs are allowed');
        }
        const result = matchHostname(parsed.hostname);
        if (result.blocked) {
          logViolation(req, fieldName, value, parsed.hostname, result);
          throw new ApiError(422, GENERIC_MESSAGE);
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
