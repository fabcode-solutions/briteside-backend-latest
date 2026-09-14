import { db } from '../../db/index.js';
import { imports, importImages } from '../../db/schema/imports.js';
import { userPostOrderCounter } from '../../db/schema/social.js';
import { eq, and, sql, inArray, ne } from 'drizzle-orm';
import { getBoss } from '../../lib/pgboss.js';
import { PresignService } from './presign.service.js';
import FileManagementService from '../fileManagement.service.js';
import ApiError from '../../utils/api-error.js';
import { randomUUID } from 'crypto';

const MAX_IMAGES = 60;
export const JOB_PROCESS_IMAGE = 'process-import-image';
// draft/pending/processing = not yet completed/failed
const UNFINISHED_STATUSES = ['draft', 'pending', 'processing'];

export class ImportService {
  /**
   * Returns whether the user can start an import and their active import if one exists.
   * Frontend uses { canImport } to show/hide the onboarding button.
   */
  static async getImportStatus(userId) {
    const [activeDraft, [{ totalUploaded }]] = await Promise.all([
      db.query.imports.findFirst({
        where: and(eq(imports.userId, userId), inArray(imports.status, UNFINISHED_STATUSES)),
        columns: {
          id: true,
          status: true,
          totalImages: true,
          processedImages: true,
          failedImages: true,
        },
      }),
      db
        .select({ totalUploaded: sql`coalesce(sum(total_images), 0)::int` })
        .from(imports)
        .where(eq(imports.userId, userId)),
    ]);

    const uploaded = Number(totalUploaded);
    return {
      canImport: uploaded < MAX_IMAGES,
      activeImport: activeDraft ?? null,
      totalUploaded: uploaded,
      remaining: MAX_IMAGES - uploaded,
    };
  }

  /**
   * Step 1: Create a draft import session. Blocked after first submission.
   */
  static async createImport(userId) {
    const existingDraft = await db.query.imports.findFirst({
      where: and(eq(imports.userId, userId), eq(imports.status, 'draft')),
      columns: { id: true, status: true },
    });

    // Resume existing draft rather than creating a duplicate
    if (existingDraft) return existingDraft;

    // Block if user already reached the global limit
    const [{ totalUploaded }] = await db
      .select({ totalUploaded: sql`coalesce(sum(total_images), 0)::int` })
      .from(imports)
      .where(eq(imports.userId, userId));

    if (Number(totalUploaded) >= MAX_IMAGES) {
      throw new ApiError(409, `Upload limit reached. Maximum ${MAX_IMAGES} images allowed.`);
    }

    const [imp] = await db.insert(imports).values({ userId }).returning();
    return imp;
  }

  /**
   * Step 2: Generate pre-signed S3 URLs and persist image records.
   * images: [{ filename, contentType, caption, displayOrder }]
   */
  static async presignImages(importId, userId, images) {
    if (images.length === 0) {
      throw new ApiError(400, 'At least one image is required');
    }

    // Dedup: check if this user already has any of these hashes (non-failed)
    const incomingHashes = images.map(i => i.sha256).filter(Boolean);
    let dupeMap = {};
    if (incomingHashes.length > 0) {
      const existing = await db
        .select({
          id: importImages.id,
          fileHash: importImages.fileHash,
          s3Key: importImages.s3Key,
          status: importImages.status,
          createdPostId: importImages.createdPostId,
        })
        .from(importImages)
        .where(
          and(
            eq(importImages.userId, userId),
            ne(importImages.status, 'failed'),
            inArray(importImages.fileHash, incomingHashes)
          )
        );
      dupeMap = Object.fromEntries(existing.map(e => [e.fileHash, e]));
    }

    const dupeResults = [];
    const newImages = [];

    for (const img of images) {
      const match = img.sha256 && dupeMap[img.sha256];
      if (match) {
        dupeResults.push({
          imageId: match.id,
          isDuplicate: true,
          uploadUrl: null,
          existingUrl: FileManagementService.buildPublicUrl(match.s3Key),
          status: match.status,
          createdPostId: match.createdPostId ?? null,
        });
      } else {
        newImages.push(img);
      }
    }

    if (newImages.length === 0) {
      await db
        .update(imports)
        .set({ duplicateImages: sql`duplicate_images + ${dupeResults.length}` })
        .where(eq(imports.id, importId));
      return dupeResults;
    }

    // Check cumulative total only against new images
    const [{ totalUploaded }] = await db
      .select({ totalUploaded: sql`coalesce(sum(total_images), 0)::int` })
      .from(imports)
      .where(eq(imports.userId, userId));

    const remaining = MAX_IMAGES - Number(totalUploaded);
    if (newImages.length > remaining) {
      throw new ApiError(
        400,
        `Can only upload ${remaining} more image${remaining === 1 ? '' : 's'}. ${MAX_IMAGES} total limit.`
      );
    }

    // Assign stable UUIDs before S3 key generation so keys are deterministic
    const withIds = newImages.map((img, i) => ({
      ...img,
      imageId: randomUUID(),
      displayOrder: img.displayOrder ?? i,
    }));

    const presigned = await PresignService.generateUploadUrls({
      userId,
      importId,
      images: withIds,
    });

    const rows = presigned.map(p => {
      const img = withIds.find(w => w.imageId === p.imageId);
      return {
        id: p.imageId,
        importId,
        userId,
        s3Key: p.s3Key,
        fileHash: img.sha256 ?? null,
        originalFilename: p.originalFilename,
        caption: img.caption ?? null,
        displayOrder: img.displayOrder,
      };
    });

    await db.transaction(async tx => {
      await tx.insert(importImages).values(rows);
      await tx
        .update(imports)
        .set({
          totalImages: sql`total_images + ${rows.length}`,
          duplicateImages: sql`duplicate_images + ${dupeResults.length}`,
        })
        .where(eq(imports.id, importId));
    });

    const newResults = presigned.map(p => ({
      imageId: p.imageId,
      isDuplicate: false,
      uploadUrl: p.uploadUrl,
    }));

    return [...dupeResults, ...newResults];
  }

  /**
   * Step 3: Submit import — enqueue one pg-boss job per image.
   */
  static async submitImport(importId, userId) {
    const imp = await db.query.imports.findFirst({
      where: and(eq(imports.id, importId), eq(imports.userId, userId)),
    });

    if (!imp) throw new ApiError(404, 'Import not found');
    if (imp.status !== 'draft') throw new ApiError(409, 'Import already submitted');
    if (imp.totalImages === 0) throw new ApiError(400, 'No images to process');

    const images = await db
      .select({
        id: importImages.id,
        s3Key: importImages.s3Key,
        caption: importImages.caption,
        displayOrder: importImages.displayOrder,
      })
      .from(importImages)
      .where(eq(importImages.importId, importId))
      .orderBy(importImages.displayOrder);

    if (images.length === 0) throw new ApiError(400, 'No images found for this import');

    // Profile sorts by (displayOrder ASC), lower number = shown first. A new
    // batch must outrank EVERYTHING already on the profile — old posts (no
    // row = sort last) and any earlier bulk-import batch alike — so each
    // batch's range must land below the lowest number reserved so far, not
    // above the highest (that would sink it under older imports instead of
    // rising above them). The counter therefore counts down: each submit
    // reserves the span of negative numbers just below the last reservation.
    // Reserve the full span up to the highest per-image displayOrder (not just
    // the row count — gaps from dedup mean they can differ) so the last
    // image's final order never spills into the next batch's reserved range.
    // Reserved atomically (INSERT..ON CONFLICT locks the row) so two
    // overlapping submitImport calls for the same user can never get
    // overlapping ranges, even though workers process batches concurrently.
    // Pre-existing displayOrder values (manual reorder, or older imports from
    // before this counter existed) are always >= 0, so counting down from a
    // fresh 0 default lands below them with no backfill needed.
    const span = images[images.length - 1].displayOrder + 1;
    const [{ base }] = await db
      .insert(userPostOrderCounter)
      .values({ userId, nextOrder: -span })
      .onConflictDoUpdate({
        target: userPostOrderCounter.userId,
        set: { nextOrder: sql`${userPostOrderCounter.nextOrder} - ${span}` },
      })
      .returning({ base: userPostOrderCounter.nextOrder });

    await db.update(imports).set({ status: 'pending' }).where(eq(imports.id, importId));

    const boss = getBoss();
    // Ensure queue exists (idempotent — safe to call every time)
    await boss.createQueue(JOB_PROCESS_IMAGE);

    // `img.displayOrder` is the image's index in the order the user picked
    // it (0 = picked first). Within the reserved [base, base + span) range,
    // `base` is the most negative value (sorts first/newest) — mapping
    // picked-first straight to `base + img.displayOrder` would put the
    // FIRST picked image at the TOP and the LAST picked image at the
    // BOTTOM of the batch, i.e. backwards from "most recently added shows
    // up as most recent". Flipping the offset makes the last-picked image
    // land on `base` (topmost/newest) and the first-picked land closest to
    // whatever was already on the profile before this batch.
    //
    // `createdAt` is computed here too (rather than left to the worker's
    // insert-time default) for the same reason: jobs run on a pool of 10
    // concurrent workers, so completion order doesn't match pick order —
    // without an explicit timestamp, any view sorting by createdAt (e.g.
    // the Activities feed) would show the batch in a near-random order even
    // though the Posts tab's displayOrder is now correct. Spacing them 1s
    // apart keeps them clustered right at submission time while still
    // sorting correctly relative to each other and to everything older.
    const submittedAt = Date.now();
    await Promise.all(
      images.map(img =>
        boss.send(JOB_PROCESS_IMAGE, {
          importId,
          imageId: img.id,
          userId,
          s3Key: img.s3Key,
          caption: img.caption,
          displayOrder: base + (span - 1 - img.displayOrder),
          createdAt: new Date(submittedAt - (span - 1 - img.displayOrder) * 1000).toISOString(),
        })
      )
    );

    return { importId, queued: images.length };
  }

  /**
   * Get import progress for frontend polling.
   */
  static async getImport(importId, userId) {
    const imp = await db.query.imports.findFirst({
      where: and(eq(imports.id, importId), eq(imports.userId, userId)),
    });
    if (!imp) throw new ApiError(404, 'Import not found');
    return {
      ...imp,
      summary: {
        total: imp.totalImages + imp.duplicateImages,
        posted: imp.processedImages,
        duplicates: imp.duplicateImages,
        failed: imp.failedImages,
      },
    };
  }

  /**
   * Get all images for an import.
   */
  static async getImportImages(importId, userId) {
    const imp = await db.query.imports.findFirst({
      where: and(eq(imports.id, importId), eq(imports.userId, userId)),
      columns: { id: true },
    });
    if (!imp) throw new ApiError(404, 'Import not found');

    return db
      .select()
      .from(importImages)
      .where(eq(importImages.importId, importId))
      .orderBy(importImages.displayOrder);
  }

  /**
   * Delete a draft import. Blocked once submitted.
   */
  static async deleteImport(importId, userId) {
    const imp = await db.query.imports.findFirst({
      where: and(eq(imports.id, importId), eq(imports.userId, userId)),
      columns: { status: true },
    });
    if (!imp) throw new ApiError(404, 'Import not found');
    if (imp.status !== 'draft') {
      throw new ApiError(409, 'Cannot delete import that has already been submitted');
    }

    await db.delete(imports).where(eq(imports.id, importId));
    return { deleted: true };
  }

  /**
   * Called by worker after each image is processed.
   * Atomic SQL increments avoid race conditions across concurrent workers.
   */
  static async recordImageResult(importId, { success }) {
    if (success) {
      await db
        .update(imports)
        .set({ processedImages: sql`processed_images + 1` })
        .where(eq(imports.id, importId));
    } else {
      await db
        .update(imports)
        .set({ failedImages: sql`failed_images + 1` })
        .where(eq(imports.id, importId));
    }

    const [imp] = await db
      .select({
        totalImages: imports.totalImages,
        processedImages: imports.processedImages,
        failedImages: imports.failedImages,
      })
      .from(imports)
      .where(eq(imports.id, importId))
      .limit(1);

    if (!imp) return;

    const done = imp.processedImages + imp.failedImages >= imp.totalImages;
    if (!done) return;

    const finalStatus = imp.failedImages === imp.totalImages ? 'failed' : 'completed';

    await db
      .update(imports)
      .set({ status: finalStatus, completedAt: new Date() })
      .where(and(eq(imports.id, importId), eq(imports.status, 'processing')));
  }
}
