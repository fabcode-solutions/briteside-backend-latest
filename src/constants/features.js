// Single source of truth for all BriteSide Plus feature keys.
// Add a key here → available for admin to assign to any plan via API.
// Routes reference FEATURES.X so a rename is one-line here, not scattered.

export const FEATURES = {
  TALENT_PROFILE: 'talent_profile',
  VIDEO_BOOKING: 'video_booking',
  PRIORITY_MESSAGING: 'priority_messaging',
  VERIFIED_BADGE: 'verified_badge',
};

// Returned by GET /admin/subscriptions/features/registry so admin UI
// knows what keys exist and can assign them to plans.
export const FEATURE_REGISTRY = [
  {
    key: FEATURES.TALENT_PROFILE,
    label: 'Talent Profile & Availability',
    description: 'Create and manage talent profile, availability schedule, and onboarding.',
  },
  {
    key: FEATURES.VIDEO_BOOKING,
    label: 'Video Booking Sessions',
    description: 'Offer video sessions, receive booking requests, confirm or decline.',
  },
  {
    key: FEATURES.PRIORITY_MESSAGING,
    label: 'Priority Messaging',
    description: 'Receive paid priority messages from customers in your inbox.',
  },
  {
    key: FEATURES.VERIFIED_BADGE,
    label: 'Verified Badge',
    description: 'Display a verified badge on your public talent profile.',
  },
];
