import httpStatus from 'http-status';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses, businessTeamMembers } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import { ALL_BUSINESS_PERMISSIONS, permissionsForRole } from '../config/business-permissions.js';

/**
 * Resolve the caller's access to req.params.businessId and require `permission`.
 * Must run after authMiddleware. Sets:
 *   req.business        — the business row
 *   req.businessAccess  — { role: 'owner'|'admin'|'manager'|'staff'|'platform_admin', permissions, staffId }
 *
 * Note: the owner's BriteSide Plus status is NOT checked here — a lapsed owner keeps
 * dashboard access; lapsing only hides the business publicly and blocks new bookings.
 */
export const requireBusinessPermission = permission => async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required'));
    }

    const business = await db.query.businesses.findFirst({
      where: and(eq(businesses.id, req.params.businessId), isNull(businesses.deletedAt)),
    });
    if (!business) {
      return next(new ApiError(httpStatus.NOT_FOUND, 'Business not found'));
    }

    let access;
    if (business.ownerId === req.user.id) {
      access = { role: 'owner', permissions: ALL_BUSINESS_PERMISSIONS, staffId: null };
    } else if (req.user.roles?.includes('admin')) {
      access = { role: 'platform_admin', permissions: ALL_BUSINESS_PERMISSIONS, staffId: null };
    } else {
      const member = await db.query.businessTeamMembers.findFirst({
        where: and(
          eq(businessTeamMembers.businessId, business.id),
          eq(businessTeamMembers.userId, req.user.id),
          eq(businessTeamMembers.status, 'active')
        ),
      });
      if (member) {
        access = {
          role: member.role,
          permissions: permissionsForRole(member.role),
          staffId: member.staffId,
        };
      }
    }

    // Hide existence from outsiders
    if (!access) {
      return next(new ApiError(httpStatus.NOT_FOUND, 'Business not found'));
    }
    if (permission && !access.permissions.includes(permission)) {
      return next(
        new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to do this for this business')
      );
    }

    req.business = business;
    req.businessAccess = access;
    next();
  } catch (err) {
    next(err);
  }
};
