import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const createLimiter = opts => rateLimit(opts);

const defaultMsg = (msg = 'Too many requests. Try again later.') => ({
  success: false,
  error: { code: 429, message: msg },
});

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV !== 'production' ? 1000 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg(),
});

const mobileLimiter = createLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: process.env.NODE_ENV !== 'production' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg(),
});

const registerLimiter = createLimiter({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: process.env.NODE_ENV !== 'production' ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg(),
});

const otpLimiter = createLimiter({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: process.env.NODE_ENV !== 'production' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg(),
});

const verifyOtpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV !== 'production' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg(),
});

const defaultLimiter = createLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: process.env.NODE_ENV !== 'production' ? 1200 : 500,
  message: defaultMsg('Too many requests from this IP, please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = createLimiter({
  windowMs: 2 * 60 * 60 * 1000, // 2 hours
  max: process.env.NODE_ENV !== 'production' ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('Too many password reset requests, please try again later.'),
});

const userReportsLimiter = createLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: process.env.NODE_ENV !== 'production' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('You have reached the maximum number of user reports allowed in 24 hours.'),
});

// Limit contact form submissions to reduce spam/abuse (per IP)
const contactLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV !== 'production' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('Too many contact form submissions from this IP, please try again later.'),
});

// Bulk invite is expensive (SES API calls + CSV processing) — 3 per day per IP
const bulkInviteLimiter = createLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: process.env.NODE_ENV !== 'production' ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('Bulk invite limit reached. You can send up to 3 bulk invites per day.'),
});

const importPresignLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV !== 'production' ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('Too many presign requests. You can generate upload URLs 3 times per hour.'),
});

// Analytics ingestion — keyed by IP + anonymousId so one visitor's burst
// (viral traffic, offline-queue flush) doesn't throttle everyone behind
// the same IP/NAT. Falls back to IP alone when anonymousId isn't sent.
const analyticsTrackLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV !== 'production' ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const anonymousId = req.body?.anonymousId;
    const ip = ipKeyGenerator(req.ip);
    return anonymousId ? `${ip}:${anonymousId}` : ip;
  },
  message: defaultMsg('Too many analytics events. Try again shortly.'),
});

// "Refresh live data" button — runs the rollup cron on demand. Cheap (only
// processes events since the last cursor) but still global work, so cap it
// per-user to stop anyone spamming the button into a manual DoS.
const analyticsRollupTriggerLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV !== 'production' ? 1000 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMsg('Refreshed recently — try again in a moment.'),
});

export {
  createLimiter,
  userReportsLimiter,
  contactLimiter,
  passwordResetLimiter,
  loginLimiter,
  mobileLimiter,
  registerLimiter,
  otpLimiter,
  verifyOtpLimiter,
  defaultLimiter,
  bulkInviteLimiter,
  importPresignLimiter,
  analyticsTrackLimiter,
  analyticsRollupTriggerLimiter,
};
