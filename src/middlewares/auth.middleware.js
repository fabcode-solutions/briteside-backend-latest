import passport from 'passport';
import httpStatus from 'http-status';

import ApiError from '../utils/api-error.js';
import { isUserEffectivelySuspended } from '../utils/suspension.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { eq } from 'drizzle-orm';

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