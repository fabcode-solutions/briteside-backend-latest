import path from 'path';
import { getBoss } from '../lib/pgboss.js';
import { db } from '../db/index.js';
import { importImages, imports } from '../db/schema/imports.js';
import { posts, userPostOrder } from '../db/schema/social.js';
import { eq, and, sql } from 'drizzle-orm';
import { ImportService, JOB_PROCESS_IMAGE } from '../services/imports/import.service.js';
import FileManagementService from '../services/fileManagement.service.js';
import {
  MediaModerationService,
  MEDIA_ENTITY,
} from '../services/moderation/mediaModeration.service.js';
import logger from '../config/logger.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mpeg', '.mpg']);

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'importWorker', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'importWorker', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'importWorker', ...meta }),
};

async function processJob(job) {
  if (!job.data) {
    log.error('Job has no data — likely a stale job from before queue was created', {
      jobId: job.id,
      raw: JSON.stringify(job),
    });
    return;
  }
  const { importId, imageId, userId, s3Key, caption, displayOrder, createdAt } = job.data;

  log.info('Job started', { jobId: job.id, importId, imageId });

  // Guard against job retries creating duplicate posts
  const existing = await db.query.importImages.findFirst({
    where: eq(importImages.id, imageId),
    columns: { status: true },
  });
  if (existing?.status === 'published') {
    log.info('Image already published, skipping duplicate job', { jobId: job.id, imageId });
    return;
  }

  await db.update(importImages).set({ status: 'processing' }).where(eq(importImages.id, imageId));

  // First job transitions import from pending → processing (idempotent)
  await db
    .update(imports)
    .set({ status: 'processing' })
    .where(and(eq(imports.id, importId), eq(imports.status, 'pending')));

  try {
    const mediaUrl = FileManagementService.buildPublicUrl(s3Key);
    const ext = path.extname(s3Key).toLowerCase();
    const mediaType = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';

    const [post] = await db
      .insert(posts)
      .values({
        userId,
        caption: caption ?? null,
        mediaUrls: [mediaUrl],
        mediaTypes: [mediaType],
        aspectRatios: [],
        visibility: 'public',
        status: 'published',
        source: 'import',
        // Set explicitly rather than left to insert-time default: jobs run
        // across a pool of concurrent workers, so completion order doesn't
        // match the order the user picked these images in. See submitImport
        // for how this is derived.
        ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
      })
      .returning({ id: posts.id });

    // Register display order using the same userPostOrder table as reorderPosts
    await db
      .insert(userPostOrder)
      .values({ userId, postId: post.id, displayOrder: displayOrder ?? 0 })
      .onConflictDoUpdate({
        target: [userPostOrder.userId, userPostOrder.postId],
        set: { displayOrder: sql`excluded.display_order` },
      });

    await db
      .update(importImages)
      .set({ status: 'published', createdPostId: post.id })
      .where(eq(importImages.id, imageId));

    // Async Stream moderation — verdict lands via webhook; rejected posts are
    // hidden by the content_moderation gating in feed queries.
    await MediaModerationService.enqueue({
      entityType: MEDIA_ENTITY.POST,
      entityId: post.id,
      userId,
      imageUrls: mediaType === 'video' ? [] : [mediaUrl],
      videoUrls: mediaType === 'video' ? [mediaUrl] : [],
    });

    await ImportService.recordImageResult(importId, { success: true });

    log.info('Job completed', { jobId: job.id, importId, imageId, postId: post.id });
  } catch (err) {
    log.error('Job failed', { jobId: job.id, importId, imageId, s3Key, error: err.message });

    await db
      .update(importImages)
      .set({ status: 'failed', failReason: err.message })
      .where(eq(importImages.id, imageId));

    await ImportService.recordImageResult(importId, { success: false });
  }
}

export async function initImportWorker() {
  const boss = getBoss();

  // pg-boss v10+ requires queue to exist before workers can subscribe
  await boss.createQueue(JOB_PROCESS_IMAGE);

  // pg-boss v12 passes an array of jobs to the handler — process each independently
  await boss.work(JOB_PROCESS_IMAGE, { teamSize: 10 }, async jobs => {
    await Promise.allSettled(jobs.map(job => processJob(job)));
  });

  log.info('Worker registered', { queue: JOB_PROCESS_IMAGE });
}
