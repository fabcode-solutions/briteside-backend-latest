import { db } from '../db/index.js';
import { imports, importImages } from '../db/schema/imports.js';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { eq, and, lt, inArray } from 'drizzle-orm';
import logger from '../config/logger.js';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET = process.env.AWS_S3_BUCKET;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
// createImport blocks new imports while a prior one is pending/processing (avoids
// displayOrder races). If a worker crashes mid-batch, that status would otherwise
// never resolve and permanently lock the user out — force it to 'failed' so they
// can retry. 60 images / teamSize 10 should always finish in minutes, not 30.
const STUCK_PROCESSING_THRESHOLD_MS = 30 * 60 * 1000;

async function failStuckImports() {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);

  const stuck = await db
    .update(imports)
    .set({ status: 'failed', completedAt: new Date() })
    .where(and(inArray(imports.status, ['pending', 'processing']), lt(imports.createdAt, cutoff)))
    .returning({ id: imports.id });

  if (stuck.length > 0) {
    logger.info(
      `[cleanupStaleImports] Force-failed ${stuck.length} stuck pending/processing imports`
    );
  }
}

export async function cleanupStaleImports() {
  try {
    await failStuckImports();

    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const staleImports = await db
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.status, 'draft'), lt(imports.createdAt, cutoff)));

    if (staleImports.length === 0) return;

    const importIds = staleImports.map(i => i.id);

    // Collect S3 keys before deleting DB records
    const orphanedImages = await db
      .select({ s3Key: importImages.s3Key })
      .from(importImages)
      .where(inArray(importImages.importId, importIds));

    // Delete S3 objects in batches of 1000 (AWS DeleteObjects limit)
    if (orphanedImages.length > 0) {
      const keys = orphanedImages.map(img => ({ Key: img.s3Key }));
      for (let i = 0; i < keys.length; i += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: keys.slice(i, i + 1000), Quiet: true },
          })
        );
      }
    }

    // FK cascade handles import_images deletion
    await db.delete(imports).where(inArray(imports.id, importIds));

    logger.info(
      `[cleanupStaleImports] Deleted ${staleImports.length} stale drafts, ${orphanedImages.length} S3 objects`
    );
  } catch (err) {
    logger.error('[cleanupStaleImports] Error:', err);
  }
}
