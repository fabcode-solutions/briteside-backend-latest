import { db } from '../db/index.js';
import { contentModeration } from '../db/schema/moderation.js';
import { media } from '../db/schema/fileTracking.js';
import { posts, stories } from '../db/schema/social.js';
import { and, eq, lt } from 'drizzle-orm';
import {
  MediaModerationService,
  MEDIA_ENTITY,
} from '../services/moderation/mediaModeration.service.js';
import logger from '../config/logger.js';

// A verdict normally lands within seconds-to-minutes. Rows still 'pending'
// after this window mean a dropped webhook or dead job. Recovery differs by
// level: a stuck FILE re-runs its Stream check; a stuck post/story just
// re-derives from its files (adopt) — the file check is the real recovery,
// re-deriving picks it up once it resolves. Never auto-approve.
const STUCK_PENDING_MS = 30 * 60 * 1000;
const BATCH_LIMIT = 100;

export async function reconcileStuckModeration() {
  const cutoff = new Date(Date.now() - STUCK_PENDING_MS);

  const stuck = await db.query.contentModeration.findMany({
    where: and(eq(contentModeration.status, 'pending'), lt(contentModeration.updatedAt, cutoff)),
    limit: BATCH_LIMIT,
  });
  if (stuck.length === 0) return;

  let requeued = 0;
  for (const row of stuck) {
    try {
      if (row.postId) {
        const post = await db.query.posts.findFirst({
          where: eq(posts.id, row.postId),
          columns: { id: true, userId: true, mediaUrls: true, mediaTypes: true },
        });
        if (!post) continue;
        const urls = post.mediaUrls || [];
        const types = post.mediaTypes || [];
        await MediaModerationService.adoptMediaVerdicts({
          entityType: MEDIA_ENTITY.POST,
          entityId: post.id,
          userId: post.userId,
          imageUrls: urls.filter((_, i) => types[i] !== 'video'),
          videoUrls: urls.filter((_, i) => types[i] === 'video'),
        });
      } else if (row.storyId) {
        const story = await db.query.stories.findFirst({
          where: eq(stories.id, row.storyId),
          columns: { id: true, userId: true, mediaUrl: true, mediaType: true },
        });
        if (!story) continue;
        await MediaModerationService.adoptMediaVerdicts({
          entityType: MEDIA_ENTITY.STORY,
          entityId: story.id,
          userId: story.userId,
          imageUrls: story.mediaType === 'video' ? [] : [story.mediaUrl],
          videoUrls: story.mediaType === 'video' ? [story.mediaUrl] : [],
        });
      } else if (row.mediaId) {
        const file = await db.query.media.findFirst({
          where: eq(media.id, row.mediaId),
          columns: { id: true, uploadedBy: true, url: true, mediaType: true },
        });
        if (!file) continue;
        const isVideo = file.mediaType === 'video';
        await MediaModerationService.enqueue({
          entityType: isVideo ? MEDIA_ENTITY.MEDIA_VIDEO : MEDIA_ENTITY.MEDIA_IMAGE,
          entityId: file.id,
          userId: file.uploadedBy,
          imageUrls: isVideo ? [] : [file.url],
          videoUrls: isVideo ? [file.url] : [],
        });
      } else {
        continue;
      }
      requeued += 1;
    } catch (err) {
      logger.error('[reconcileModeration] Failed to re-queue stuck row', {
        moderationId: row.id,
        error: err.message,
      });
    }
  }

  logger.info(`[reconcileModeration] Re-queued ${requeued}/${stuck.length} stuck pending checks`);
}
