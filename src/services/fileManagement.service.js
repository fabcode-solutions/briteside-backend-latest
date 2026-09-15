import crypto from 'crypto';
import path from 'path';
import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { eq, and, sql, lt } from 'drizzle-orm';
import { media, mediaOwners } from '../db/schema/index.js';
import logger from '../config/logger.js';
import { db } from '../db/index.js';

const s3Client = new S3Client({
  region: 'us-east-1',
  // credentials: {
  //   accessKeyId: process.env.AWS_ACCESS_KEY,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // },
});

const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

class FileManagementService {
  /**
   * Build public URL for an S3 key. Uses CDN domain when CDN_BASE_URL is set,
   * falls back to the raw S3 URL otherwise.
   * @param {string} s3Key - S3 object key
   * @returns {string} - Public URL
   */
  static buildPublicUrl(s3Key) {
    const base =
      process.env.CDN_BASE_URL || `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`;
    return `${base.replace(/\/+$/, '')}/${s3Key}`;
  }

  /**
   * Determine media type from mimetype
   * @param {string} mimetype - File mimetype
   * @returns {string} - Media type: image, video, audio, or document
   */
  static getMediaType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
  }

  /**
   * Calculate SHA-256 hash of file buffer
   * @param {Buffer} buffer - File buffer
   * @returns {string} - Hex encoded hash
   */
  static calculateFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Find file by hash in database
   * @param {string} fileHash - SHA-256 hash of file
   * @returns {Object|null} - Media record or null
   */
  static async findByHash(fileHash) {
    try {
      const file = await db.query.media.findFirst({
        where: and(eq(media.fileHash, fileHash), sql`${media.deletedAt} IS NULL`),
      });
      return file || null;
    } catch (error) {
      logger.error('Error finding file by hash:', error);
      throw error;
    }
  }

  /**
   * Create new media record or increment reference count.
   *
   * Uses a single atomic INSERT ... ON CONFLICT (file_hash) DO UPDATE instead
   * of a separate find-then-insert — two uploads of byte-identical content
   * (e.g. picking the same photo for two different image slots in one form)
   * can otherwise both pass the "does it exist?" check before either commits,
   * then both try to INSERT and the second one dies on the unique constraint
   * on file_hash. The same race applied to a hash that only exists as a
   * soft-deleted row: findByHash correctly treats it as "not found" for reuse
   * purposes, but a plain INSERT still collides with it (the unique
   * constraint isn't scoped to `deleted_at IS NULL`). ON CONFLICT sidesteps
   * both cases by letting Postgres resolve the race, and also revives a
   * soft-deleted row being reused.
   * @param {Object} fileData - File metadata
   * @returns {Object} - Media record
   */
  static async createOrIncrementReference(fileData) {
    try {
      const mediaType = this.getMediaType(fileData.mimetype);
      const extension = fileData.extension || path.extname(fileData.originalName || fileData.s3Key);

      const [file] = await db
        .insert(media)
        .values({
          fileHash: fileData.fileHash,
          s3Key: fileData.s3Key,
          s3Bucket: fileData.s3Bucket || AWS_S3_BUCKET,
          url: fileData.url,
          mediaType,
          mimetype: fileData.mimetype,
          extension,
          size: fileData.size,
          folder: fileData.folder,
          originalName: fileData.originalName,
          properties: fileData.properties || {},
          uploadedBy: fileData.uploadedBy,
          referenceCount: 1,
        })
        .onConflictDoUpdate({
          target: media.fileHash,
          set: {
            referenceCount: sql`${media.referenceCount} + 1`,
            lastAccessedAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        })
        .returning();

      // uploadedBy stays as the original uploader; grant the current uploader
      // access via mediaOwners so a shared S3 object can have multiple owners.
      if (fileData.uploadedBy) {
        await db
          .insert(mediaOwners)
          .values({ mediaId: file.id, userId: fileData.uploadedBy })
          .onConflictDoNothing();
      }

      logger.info(
        `Media tracked: ${fileData.fileHash}, type: ${mediaType}, reference count: ${file.referenceCount}`
      );
      return file;
    } catch (error) {
      logger.error('Error creating/updating media record:', error);
      throw error;
    }
  }

  /**
   * Delete file from S3
   * @param {string} s3Key - S3 object key
   * @param {string} bucket - S3 bucket name (optional)
   */
  static async deleteFromS3(s3Key, bucket = AWS_S3_BUCKET) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      });

      await s3Client.send(command);
      logger.info(`File deleted from S3: ${s3Key}`);
    } catch (error) {
      logger.error(`Error deleting file from S3: ${s3Key}`, error);
      throw error;
    }
  }

  /**
   * Delete multiple files from S3 in batch
   * @param {Array<string>} s3Keys - Array of S3 object keys
   * @param {string} bucket - S3 bucket name (optional)
   */
  static async deleteMultipleFromS3(s3Keys, bucket = AWS_S3_BUCKET) {
    if (!s3Keys || s3Keys.length === 0) return;

    try {
      // S3 DeleteObjects API supports up to 1000 objects per request
      const chunks = [];
      for (let i = 0; i < s3Keys.length; i += 1000) {
        chunks.push(s3Keys.slice(i, i + 1000));
      }

      for (const chunk of chunks) {
        const command = new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map(key => ({ Key: key })),
            Quiet: true,
          },
        });

        await s3Client.send(command);
        logger.info(`Batch deleted ${chunk.length} files from S3`);
      }
    } catch (error) {
      logger.error('Error batch deleting files from S3:', error);
      throw error;
    }
  }

  /**
   * Decrement file reference count and delete if reaches zero
   * @param {string} fileId - Media ID
   * @param {boolean} forceDelete - Force delete even if reference count > 0
   */
  static async decrementReference(fileId, forceDelete = false) {
    try {
      const file = await db.query.media.findFirst({
        where: eq(media.id, fileId),
      });

      if (!file) {
        logger.warn(`Media not found for decrement: ${fileId}`);
        return;
      }

      const newReferenceCount = file.referenceCount - 1;

      if (newReferenceCount <= 0 || forceDelete) {
        // Soft delete - mark for deletion with 30-day grace period
        await db
          .update(media)
          .set({
            referenceCount: 0,
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(media.id, fileId));

        logger.info(`Media marked for deletion: ${file.s3Key}, hash: ${file.fileHash}`);
      } else {
        // Just decrement reference count
        await db
          .update(media)
          .set({
            referenceCount: newReferenceCount,
            updatedAt: new Date(),
          })
          .where(eq(media.id, fileId));

        logger.info(`Media reference decremented: ${file.s3Key}, new count: ${newReferenceCount}`);
      }
    } catch (error) {
      logger.error('Error decrementing media reference:', error);
      throw error;
    }
  }

  /**
   * Extract S3 key from URL
   * @param {string} url - Full S3 URL
   * @returns {string|null} - S3 key or null
   */
  static extractS3KeyFromUrl(url) {
    if (!url) return null;

    try {
      // Handle various S3 URL formats
      // https://bucket.s3.region.amazonaws.com/key
      // https://s3.region.amazonaws.com/bucket/key
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Remove leading slash
      return pathname.startsWith('/') ? pathname.substring(1) : pathname;
    } catch (error) {
      logger.warn(`Failed to extract S3 key from URL: ${url}`, error);
      return null;
    }
  }

  /**
   * Find file by S3 key or URL
   * @param {string} urlOrKey - S3 URL or key
   * @returns {Object|null} - Media record or null
   */
  static async findByUrlOrKey(urlOrKey) {
    try {
      const s3Key = urlOrKey.startsWith('http') ? this.extractS3KeyFromUrl(urlOrKey) : urlOrKey;

      if (!s3Key) return null;

      const file = await db.query.media.findFirst({
        where: eq(media.s3Key, s3Key),
      });

      return file || null;
    } catch (error) {
      logger.error('Error finding media by URL/key:', error);
      return null;
    }
  }

  /**
   * Clean up files marked for deletion (older than grace period)
   * @param {number} gracePeriodDays - Days to wait before permanent deletion
   * @returns {Object} - Cleanup statistics
   */
  static async cleanupDeletedFiles(gracePeriodDays = 30) {
    try {
      const gracePeriodDate = new Date();
      gracePeriodDate.setDate(gracePeriodDate.getDate() - gracePeriodDays);

      // Find files marked for deletion older than grace period
      const filesToDelete = await db
        .select()
        .from(media)
        .where(
          and(
            sql`${media.deletedAt} IS NOT NULL`,
            lt(media.deletedAt, gracePeriodDate),
            eq(media.referenceCount, 0)
          )
        );

      if (filesToDelete.length === 0) {
        logger.info('No media files to clean up');
        return { deleted: 0, failed: 0 };
      }

      let deleted = 0;
      let failed = 0;

      // Delete from S3 in batches
      const s3Keys = filesToDelete.map(file => file.s3Key);
      try {
        await this.deleteMultipleFromS3(s3Keys);
      } catch (error) {
        logger.error('Batch S3 deletion failed, falling back to individual deletions', error);
      }

      // Remove from database
      for (const file of filesToDelete) {
        try {
          // Try individual S3 deletion if batch failed
          try {
            await this.deleteFromS3(file.s3Key, file.s3Bucket);
          } catch (s3Error) {
            logger.warn(
              `S3 deletion failed for ${file.s3Key}, continuing with DB cleanup`,
              s3Error
            );
          }

          // Delete media record
          await db.delete(media).where(eq(media.id, file.id));

          deleted++;
        } catch (error) {
          logger.error(`Failed to clean up media ${file.id}:`, error);
          failed++;
        }
      }

      logger.info(`Cleanup completed: ${deleted} deleted, ${failed} failed`);
      return { deleted, failed, total: filesToDelete.length };
    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }

  /**
   * Clean up orphaned entity file references
   * Removes references where entity no longer exists
   */
  static async cleanupOrphanedReferences() {
    try {
      // This would require checking each entity type's table
      // For now, we rely on cascade deletes from entity deletion
      logger.info('Orphaned reference cleanup completed');
      return { success: true };
    } catch (error) {
      logger.error('Error cleaning up orphaned references:', error);
      throw error;
    }
  }

  /**
   * Get media usage statistics
   * @param {string} fileId - Media ID
   * @returns {Object} - Usage statistics
   */
  static async getFileUsage(fileId) {
    try {
      const file = await db.query.media.findFirst({
        where: eq(media.id, fileId),
      });

      if (!file) return null;

      return {
        file,
        referenceCount: file.referenceCount,
        isMarkedForDeletion: !!file.deletedAt,
        mediaType: file.mediaType,
        extension: file.extension,
        properties: file.properties,
      };
    } catch (error) {
      logger.error('Error getting media usage:', error);
      throw error;
    }
  }
}

export default FileManagementService;
