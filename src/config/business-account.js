// Business account settings: which notifications a business gets, and its
// privacy options. Stored on `businesses` (notification_prefs + privacy columns).

/**
 * Business-side notification switches (missing in notification_prefs = on).
 * Only notifications that go to the business's bell are affected — the
 * customer-side copies of business_* types are personal and never filtered here.
 */
export const BUSINESS_NOTIFICATION_KEYS = [
  'newBookings', //       business_booking: a customer booked
  'bookingRequests', //   business_booking: a request waiting for accept / decline
  'bookingChanges', //    business_booking: cancelled, rescheduled, custom offer booked / declined
  'payments', //          balance paid, commission notices
  'messages', //          business_message: customer messages in the business inbox
  'reviews', //           business_review: new review
  'followers', //         business_follow: new follower
  'wallPosts', //         business_wall_post: a visitor post waiting for approval
  'pageActivity', //      likes / comments / mentions on the business's wall + gallery posts
];

export const DEFAULT_BUSINESS_NOTIFICATION_PREFS = Object.fromEntries(
  BUSINESS_NOTIFICATION_KEYS.map(k => [k, true])
);

/** Fill in missing keys (stored prefs only hold what was changed). */
export const resolveBusinessNotificationPrefs = (stored = {}) => ({
  ...DEFAULT_BUSINESS_NOTIFICATION_PREFS,
  ...Object.fromEntries(
    Object.entries(stored ?? {}).filter(
      ([k, v]) => BUSINESS_NOTIFICATION_KEYS.includes(k) && typeof v === 'boolean'
    )
  ),
});

// ── Privacy ──
export const BUSINESS_MESSAGES_FROM = ['everyone', 'followers', 'customers', 'nobody'];
export const BUSINESS_WALL_POSTS = ['everyone', 'approval', 'off'];

/** Privacy columns on `businesses` the settings endpoint reads / writes. */
export const BUSINESS_PRIVACY_FIELDS = [
  'messagesFrom',
  'wallPosts',
  'showReviews',
  'showFollowerCount',
  'showStaff',
  'hideAddressUntilBooked',
  'discoverable',
  'profanityFilter',
];

export const businessPrivacyOf = b => Object.fromEntries(BUSINESS_PRIVACY_FIELDS.map(k => [k, b[k]]));
