/**
 * Following a business page. Anyone can see the follower count; signed-in
 * members can follow / unfollow. The owner gets a notification on a new follow.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businessFollowers } from '../db/schema/index.js';
import logger from '../config/logger.js';
import { createNotification } from './notification.service.js';
import { authorName, loadPublicBusiness } from './businessWall.service.js';

const countFollowers = async businessId => {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessFollowers)
    .where(eq(businessFollowers.businessId, businessId));
  return n;
};

const isFollowing = async (businessId, userId) => {
  if (!userId) return false;
  const row = await db.query.businessFollowers.findFirst({
    columns: { userId: true },
    where: and(eq(businessFollowers.businessId, businessId), eq(businessFollowers.userId, userId)),
  });
  return !!row;
};

export class BusinessFollowService {
  /** { following, followerCount } — `following` is false when signed out. */
  static async status(idOrSlug, viewer) {
    const business = await loadPublicBusiness(idOrSlug);
    const [following, followerCount] = await Promise.all([
      isFollowing(business.id, viewer?.id),
      countFollowers(business.id),
    ]);
    return { following, followerCount };
  }

  /** Idempotent. Notifies the owner only on a new follow (not their own). */
  static async follow(user, idOrSlug) {
    const business = await loadPublicBusiness(idOrSlug);
    const inserted = await db
      .insert(businessFollowers)
      .values({ businessId: business.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ userId: businessFollowers.userId });

    if (inserted.length && business.ownerId && business.ownerId !== user.id) {
      createNotification({
        userId: business.ownerId,
        title: 'New follower',
        message: `${authorName(user)} started following ${business.name}.`,
        type: 'business_follow',
        relatedId: business.id,
        redirectTo: `/business/${business.slug}`,
        metadata: { businessId: business.id, followerId: user.id, actorUserId: user.id },
      }).catch(err => logger.error(`[businessFollow] notification failed: ${err.message}`));
    }

    return { following: true, followerCount: await countFollowers(business.id) };
  }

  /** Idempotent. */
  static async unfollow(user, idOrSlug) {
    const business = await loadPublicBusiness(idOrSlug);
    await db
      .delete(businessFollowers)
      .where(and(eq(businessFollowers.businessId, business.id), eq(businessFollowers.userId, user.id)));
    return { following: false, followerCount: await countFollowers(business.id) };
  }
}
