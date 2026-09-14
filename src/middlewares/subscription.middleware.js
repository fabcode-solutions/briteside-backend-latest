import httpStatus from 'http-status';
import { SubscriptionService } from '../services/subscription.service.js';
import ApiError from '../utils/api-error.js';

const FORBIDDEN_MSG = 'This feature requires an active BriteSide Plus subscription';

// Gate on a specific feature key (e.g. 'priority_messaging').
// Usage: router.get('/route', authMiddleware, requireFeature('priority_messaging'), handler)
export const requireFeature = featureKey => async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required'));
    }
    const sub = await SubscriptionService.getActiveSubscription(req.user.id);
    if (!sub) {
      return next(new ApiError(httpStatus.FORBIDDEN, FORBIDDEN_MSG));
    }
    const hasFeature = sub.plan?.features?.some(f => f.featureKey === featureKey) ?? false;
    if (!hasFeature) {
      return next(new ApiError(httpStatus.FORBIDDEN, FORBIDDEN_MSG));
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Gate on any active BriteSide Plus subscription (no feature-level check).
// Usage: router.get('/route', authMiddleware, requireActiveSubscription, handler)
export const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required'));
    }
    const sub = await SubscriptionService.getActiveSubscription(req.user.id);
    if (!sub) {
      return next(new ApiError(httpStatus.FORBIDDEN, FORBIDDEN_MSG));
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Attaches subscription + feature keys to req.user for controllers that render conditional content.
export const attachSubscriptionStatus = async (req, res, next) => {
  try {
    if (!req.user?.id) return next();
    const sub = await SubscriptionService.getActiveSubscription(req.user.id);
    req.user.subscription = sub ?? null;
    req.user.features = sub?.plan?.features?.map(f => f.featureKey) ?? [];
    next();
  } catch {
    req.user.subscription = null;
    req.user.features = [];
    next();
  }
};
