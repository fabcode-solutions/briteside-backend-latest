const APP_BASE = 'briteside:/';
const NATIVE_PLATFORMS = new Set(['android', 'ios']);

export const isNativePlatform = (platform) => NATIVE_PLATFORMS.has(platform);

/**
 * Returns Stripe success_url / cancel_url for a given platform.
 *
 * Android / iOS: replaces webBase with briteside:/ — keeps the same path & query params,
 * so the app's in-app browser session (expo-web-browser openAuthSessionAsync) closes and
 * returns control to the app instead of loading the website.
 * Web: uses webBase + path as-is.
 *
 * @param {'android'|'ios'|undefined} platform
 * @param {string} webBase - e.g. process.env.FRONTEND_URL
 * @param {string} successPath - e.g. '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=success'
 * @param {string} cancelPath  - e.g. '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled'
 */
export const getRedirectUrls = (platform, webBase, successPath, cancelPath) => {
  const base = isNativePlatform(platform) ? APP_BASE : webBase;
  return {
    successUrl: `${base}${successPath}`,
    cancelUrl: `${base}${cancelPath}`,
  };
};
