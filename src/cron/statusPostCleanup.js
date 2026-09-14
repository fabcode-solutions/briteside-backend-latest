import { db } from '../db/index.js';
import { posts, socialProfiles } from '../db/schema/index.js';
import { and, eq, lte, isNull } from 'drizzle-orm';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Soft-delete expired status posts and clear their profile's statusPostId reference.
 * Runs every hour. Only targets posts created by the status auto-post feature
 * (isStatusPost = true) whose expiresAt has passed and that aren't already deleted.
 */
export async function cleanupExpiredStatusPosts() {
  const now = new Date();

  // Find all expired, not-yet-deleted status posts
  const expired = await db
    .select({ id: posts.id, userId: posts.userId })
    .from(posts)
    .where(
      and(
        eq(posts.isStatusPost, true),
        lte(posts.expiresAt, now),
        isNull(posts.deletedAt)
      )
    );

  if (expired.length === 0) return;

  for (const { id, userId } of expired) {
    await db
      .update(socialProfiles)
      .set({ statusPostId: null })
      .where(and(eq(socialProfiles.userId, userId), eq(socialProfiles.statusPostId, id)));
    await db
      .update(posts)
      .set({
        deletedAt: now,
        isStatusPost: false, 
        updatedAt: now,
      })
      .where(eq(posts.id, id));
  }

  logger.info('[Cron] Soft-deleted expired status posts', { count: expired.length });
}