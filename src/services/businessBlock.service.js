/**
 * Accounts a business blocked (business_blocks). A blocked person can't
 * message, post on the wall, comment, follow, book or review the business.
 */
import { and, eq } from 'drizzle-orm';
import httpStatus from 'http-status';
import { db } from '../db/index.js';
import { businessBlocks } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';

/** Whether `userId` is blocked by the business. */
export async function isBlockedByBusiness(businessId, userId) {
  if (!businessId || !userId) return false;
  const row = await db.query.businessBlocks.findFirst({
    where: and(eq(businessBlocks.businessId, businessId), eq(businessBlocks.blockedUserId, userId)),
    columns: { id: true },
  });
  return !!row;
}

/** Throws 403 when the business blocked `userId`. */
export async function assertNotBlockedByBusiness(businessId, userId, message = "You can't interact with this business") {
  if (await isBlockedByBusiness(businessId, userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, message);
  }
}
