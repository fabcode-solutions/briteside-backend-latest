const ANDROID_BASE = 'briteside:/';

/**
 * Returns Stripe success_url / cancel_url for a given platform.
 *
 * Android: replaces webBase with briteside:/ — keeps the same path & query params.
 * Web: uses webBase + path as-is.
 *
 * @param {'android'|undefined} platform
 * @param {string} webBase - e.g. process.env.FRONTEND_URL
 * @param {string} successPath - e.g. '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=success'
 * @param {string} cancelPath  - e.g. '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled'
 */
export const getRedirectUrls = (platform, webBase, successPath, cancelPath) => {
  const base = platform === 'android' ? ANDROID_BASE : webBase;
  return {
    successUrl: `${base}${successPath}`,
    cancelUrl: `${base}${cancelPath}`,
  };
};
