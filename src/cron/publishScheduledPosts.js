import { db } from '../db/index.js';
import { posts, socialProfiles } from '../db/schema/index.js';
import { userPostOrder } from '../db/schema/social.js';
import { eq, lte, and, sql, asc } from 'drizzle-orm';
import { cronLogger as logger } from '../config/logger.js';
import { PostService } from '../services/social/post.service.js';

export const publishScheduledPosts = async () => {
  const due = await db
    .select({ id: posts.id, userId: posts.userId })
    .from(posts)
    .where(and(eq(posts.status, 'scheduled'), lte(posts.scheduledAt, new Date())));

  if (due.length === 0) return;

  const now = new Date();

  for (const post of due) {
    await db
      .update(posts)
      .set({
        status: 'published',
        createdAt: now, // bump date so post appears fresh in feed
        scheduledAt: null,
        updatedAt: now,
      })
      .where(eq(posts.id, post.id));

    await db
      .update(socialProfiles)
      .set({
        postsCount: sql`${socialProfiles.postsCount} + 1`,
        updatedAt: now,
      })
      .where(eq(socialProfiles.userId, post.userId));

    // Prepend to existing order so published post appears at top
    const existing = await db
      .select({ postId: userPostOrder.postId })
      .from(userPostOrder)
      .where(eq(userPostOrder.userId, post.userId))
      .orderBy(asc(userPostOrder.displayOrder));

    await PostService.reorderPosts(post.userId, [post.id, ...existing.map(r => r.postId)]);
  }

  logger.info(`[Cron] Published ${due.length} scheduled post(s)`);
};
