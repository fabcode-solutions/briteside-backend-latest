import passport from 'passport';
import httpStatus from 'http-status';

import ApiError from '../utils/api-error.js';
import { isUserEffectivelySuspended } from '../utils/suspension.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { eq } from 'drizzle-orm';

// Enforced web-only (see X-Client-Platform check below) — the Expo mobile app
// has no DOB-collection UI yet, so enforcing this backend-wide would lock out
// existing mobile/OAuth users with no way to self-resolve. Paths a
// not-yet-verified web user must still be able to hit: the session check
// (so the frontend can even learn it needs to show the gate), logout (escape
// hatch), and the profile update endpoint that lets them submit their DOB.
const AGE_VERIFICATION_EXEMPT_PATHS = ['/api/auth/session', '/api/auth/logout', '/api/users/profile'];

function isAgeVerificationExempt(req, user) {
  const isWebClient = req.headers['x-client-platform'] === 'web';
  if (!isWebClient || user.isVerifiedAdult) return true;
  if (user.roles?.includes('admin')) return true;
  const path = req.originalUrl.split('?')[0];
  return AGE_VERIFICATION_EXEMPT_PATHS.some(p => path.startsWith(p));
}

export function authMiddleware(req, res, next) {
  const authenticateOption = { session: false };

  passport.authenticate('jwt', authenticateOption, (err, user, info) => {
    if (err || info || !user) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, err || info || 'no user found'));
    }

    // Block suspended users (respect time-based suspension)
    if (user.isSuspended) {
      if (isUserEffectivelySuspended(user)) {
        const message = user.suspendedUntil
          ? `Account suspended until ${new Date(user.suspendedUntil).toISOString()}`
          : 'Account permanently suspended';
        return next(new ApiError(httpStatus.FORBIDDEN, message));
      }
      // Suspension expired — auto-clear in DB fire-and-forget
      db.update(users)
        .set({ isSuspended: false, suspendedUntil: null, suspensionReason: null })
        .where(eq(users.id, user.id))
        .catch(() => {});
      user.isSuspended = false;
      user.suspendedUntil = null;
      user.suspensionReason = null;
    }

    // Web-only age-verification gate (see AGE_VERIFICATION_EXEMPT_PATHS above).
    if (!isAgeVerificationExempt(req, user)) {
      return next(
        new ApiError(httpStatus.FORBIDDEN, 'Age verification required', true, '', {
          code: 'AGE_VERIFICATION_REQUIRED',
        })
      );
    }

    // Surface impersonation on req, then strip it off req.user so it's never
    // accidentally echoed back through an endpoint that returns req.user.
    const { impersonatedBy, ...userWithoutImpersonation } = user;
    req.impersonatedBy = impersonatedBy || null;
    req.user = userWithoutImpersonation;
    next();
  })(req, res, next);
}

export function requireAdmin(req, res, next) {
  if (!req.user?.roles?.includes('admin')) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Admin access required'));
  }
  next();
}
export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authenticateOption = { session: false };

    passport.authenticate('jwt', authenticateOption, (err, user) => {
      if (user) {
        if (user.isSuspended) {
          if (isUserEffectivelySuspended(user)) {
            return next();
          }
          db.update(users)
            .set({ isSuspended: false, suspendedUntil: null, suspensionReason: null })
            .where(eq(users.id, user.id))
            .catch(() => {});
          user.isSuspended = false;
          user.suspendedUntil = null;
          user.suspensionReason = null;
        }

        const { impersonatedBy, ...userWithoutImpersonation } = user;
        req.impersonatedBy = impersonatedBy || null;
        req.user = userWithoutImpersonation;
      }
      return next();
    })(req, res, next);
  } catch (e) {
    return next();
  }
};

/**
 * Authenticate without blocking suspended users.
 * Used only for the appeals endpoint.
 */
export function authMiddlewareAllowSuspended(req, res, next) {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err || info || !user) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, err || info || 'no user found'));
    }
    req.user = user;
    next();
  })(req, res, next);
}