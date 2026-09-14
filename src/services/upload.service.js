import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { and, eq, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import FileManagementService from './fileManagement.service.js';
import logger from '../config/logger.js';
import { MediaModerationService, MEDIA_ENTITY } from './moderation/mediaModeration.service.js';
import { db } from '../db/index.js';
import { media } from '../db/schema/index.js';
import { contentModeration } from '../db/schema/moderation.js';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const s3Client = new S3Client({
  region: AWS_REGION,
  // credentials: {
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // },
});

// Configuration constants
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.jar'];

export class UploadService {
  /**
   * Validates file before upload
   * @param {Object} file - Multer file object
   * @throws {ApiError} If file is invalid
   */
  static validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      throw new ApiError(
        400,
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    if (!file.originalname?.trim()) {
      throw new ApiError(400, 'File must have a valid name');
    }

    // Check for dangerous file types
    const fileName = file.originalname.toLowerCase();
    if (DANGEROUS_EXTENSIONS.some(ext => fileName.endsWith(ext))) {
      throw new ApiError(400, 'File type not allowed for security reasons');
    }
  }

  /**
   * Sanitizes filename for safe storage
   * @param {string} filename - Original filename
   * @returns {string} Sanitized filename
   */
  static sanitizeFilename(filename) {
    const extension = path.extname(filename);
    const baseName = path.basename(filename, extension);

    const safeName = baseName
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();

    return safeName + extension.toLowerCase();
  }

  static async uploadFile(file, folder = 'general', entityId = null, userId = null) {
    try {
      // Validate file
      this.validateFile(file);

      // Calculate file hash for deduplication
      const fileHash = FileManagementService.calculateFileHash(file.buffer);

      // Check if file already exists
      const existingFile = await FileManagementService.findByHash(fileHash);

      if (existingFile) {
        logger.info(`File already exists (hash: ${fileHash}), returning existing URL`);

        // Increment reference count
        const updatedFile = await FileManagementService.createOrIncrementReference({
          fileHash,
          s3Key: existingFile.s3Key,
          s3Bucket: existingFile.s3Bucket,
          url: existingFile.url,
          mimetype: existingFile.mimetype,
          size: existingFile.size,
          folder: existingFile.folder,
          originalName: file.originalname,
          extension: existingFile.extension,
          properties: existingFile.properties,
          uploadedBy: userId,
        });

        return {
          filename: path.basename(existingFile.s3Key),
          originalName: file.originalname,
          size: existingFile.size,
          mimetype: existingFile.mimetype,
          mediaType: existingFile.mediaType,
          extension: existingFile.extension,
          properties: existingFile.properties,
          url: existingFile.url,
          s3Key: existingFile.s3Key,
          fileTrackingId: updatedFile.id,
          isDuplicate: true,
        };
      }

      // Sanitize folder path
      const sanitizedFolder = folder
        .replace(/[^a-zA-Z0-9/_-]/g, '_')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/|\/$/g, '');

      // Generate unique filename with sanitization
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const extension = path.extname(file.originalname);
      const sanitizedBaseName = this.sanitizeFilename(path.basename(file.originalname, extension));
      const filename = `${sanitizedBaseName}_${timestamp}_${randomString}${extension}`;

      // Create S3 key with structured folder hierarchy
      // Structure: folder/[entityId]/userId/filename
      // Examples:
      // - events/event-123/user-456/image.jpg
      // - social/user-456/photo.jpg
      // - groups/group-789/user-456/document.pdf
      // - tickets/ticket-123/qr-code.png (special case for system-generated)
      let s3Key;

      if (entityId && userId) {
        // Context-based upload: folder/entityId/userId/filename
        s3Key = `${sanitizedFolder}/${entityId}/${userId}/${filename}`;
      } else if (entityId && !userId) {
        // System upload (e.g., QR codes): folder/entityId/filename
        s3Key = `${sanitizedFolder}/${entityId}/${filename}`;
      } else if (!entityId && userId) {
        // User upload without entity: folder/userId/filename
        s3Key = `${sanitizedFolder}/${userId}/${filename}`;
      } else {
        // General upload (fallback): folder/filename
        s3Key = `${sanitizedFolder}/${filename}`;
      }

      // Upload to S3 with metadata
      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
        ACL: 'public-read',
        Metadata: {
          'original-name': file.originalname,
          'upload-timestamp': new Date().toISOString(),
          'file-size': file.size.toString(),
          'uploaded-by': userId?.toString() || 'anonymous',
          'file-hash': fileHash,
        },
      };

      await s3Client.send(new PutObjectCommand(uploadParams));

      // Generate public URL (CDN when CDN_BASE_URL is set)
      const publicUrl = FileManagementService.buildPublicUrl(s3Key);

      // Track file in database
      const trackedFile = await FileManagementService.createOrIncrementReference({
        fileHash,
        s3Key,
        s3Bucket: process.env.AWS_S3_BUCKET,
        url: publicUrl,
        mimetype: file.mimetype,
        size: file.size,
        folder: sanitizedFolder,
        originalName: file.originalname,
        extension,
        properties: {}, // Can be extended to include image dimensions, video duration, etc.
        uploadedBy: userId,
      });

      logger.info(`New file uploaded: ${s3Key}, hash: ${fileHash}`);

      // Async moderation — new user files only. Duplicates keep their existing
      // verdict; system-generated files (QR codes, receipts — no userId) skip it.
      if (userId && (trackedFile.mediaType === 'image' || trackedFile.mediaType === 'video')) {
        const isVideo = trackedFile.mediaType === 'video';
        await MediaModerationService.enqueue({
          entityType: isVideo ? MEDIA_ENTITY.MEDIA_VIDEO : MEDIA_ENTITY.MEDIA_IMAGE,
          entityId: trackedFile.id,
          userId,
          imageUrls: isVideo ? [] : [publicUrl],
          videoUrls: isVideo ? [publicUrl] : [],
        });
      }

      return {
        filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        mediaType: trackedFile.mediaType,
        extension: trackedFile.extension,
        properties: trackedFile.properties,
        url: publicUrl,
        s3Key,
        fileTrackingId: trackedFile.id,
        isDuplicate: false,
      };
    } catch (error) {
      logger.error('S3 upload error:', error);

      // Re-throw validation errors as-is
      if (error instanceof ApiError) {
        throw error;
      }

      // Wrap other errors with more context
      throw new ApiError(500, `File upload failed: ${error.message}`);
    }
  }

  /**
   * Deletes a file from S3 (only if user owns it)
   * @param {string} fileId - UUID of the file in media table
   * @param {string} userId - UUID of the user requesting deletion
   * @param {Object} options - { permanent: boolean } - when true, permanently remove from S3 + DB (only allowed when safe)
   * @returns {Promise<{success: boolean, message?: string}>}
   * @throws {ApiError} If file not found, unauthorized, or deletion fails
   */
  static async deleteFile(fileId, userId, { permanent = false } = {}) {
    try {
      // Find file and verify ownership
      const file = await db.query.media.findFirst({
        where: and(
          eq(media.id, fileId),
          eq(media.uploadedBy, userId),
          sql`${media.deletedAt} IS NULL` // Not already deleted
        ),
      });

      if (!file) {
        throw new ApiError(404, 'File not found or unauthorized');
      }

      if (permanent) {
        // Safety: prevent breaking other references
        if (file.referenceCount > 1) {
          throw new ApiError(
            400,
            'File has multiple references and cannot be permanently deleted. Remove other references first.'
          );
        }

        // Try deleting from S3 (best-effort) then remove DB record
        try {
          await FileManagementService.deleteFromS3(file.s3Key, file.s3Bucket);
        } catch (s3Err) {
          logger.warn(`S3 deletion failed for ${file.s3Key}, continuing with DB cleanup`, s3Err);
        }

        await db.delete(media).where(eq(media.id, file.id));

        logger.info('File permanently deleted by user', {
          userId,
          fileId,
          s3Key: file.s3Key,
        });

        return { success: true, message: 'File permanently deleted' };
      }

      // Non-permanent: decrement reference count (soft delete if ref count reaches 0)
      const willBeDeleted = file.referenceCount <= 1;
      await FileManagementService.decrementReference(file.id);

      logger.info(
        `File ${willBeDeleted ? 'marked for deletion' : 'reference decremented'} by user`,
        {
          userId,
          fileId,
          s3Key: file.s3Key,
          referenceCount: Math.max(0, file.referenceCount - 1),
        }
      );

      return {
        success: true,
        message: willBeDeleted
          ? 'File marked for deletion successfully'
          : 'File reference removed successfully',
      };
    } catch (error) {
      logger.error('File deletion error:', error);

      // Re-throw ApiErrors as-is
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, `File deletion failed: ${error.message}`);
    }
  }

  /**
   * Gets all files uploaded by a user
   * @param {string} userId - UUID of the user
   * @param {Object} options - Query options
   * @param {string} options.mediaType - Filter by media type (image, video, audio, document)
   * @param {string} options.folder - Filter by folder (events, social, groups, etc.)
   * @param {number} options.limit - Number of results per page
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<{files: Array, total: number}>}
   */
  static async getUserFiles(userId, options = {}) {
    try {
      const { mediaType, folder, limit = 50, offset = 0 } = options;

      // Build where conditions
      const conditions = [
        eq(media.uploadedBy, userId),
        sql`${media.deletedAt} IS NULL`, // Exclude soft-deleted files
      ];

      if (mediaType) {
        conditions.push(eq(media.mediaType, mediaType));
      }

      if (folder) {
        conditions.push(eq(media.folder, folder));
      }

      // Hide removed (rejected/shadowed) media from the picker — they're
      // quarantined (dead URL) and can't be reused. Flagged/pending/approved
      // stay (flagged is shown blurred + a warning on the client).
      const excludeRemoved = sql`(${contentModeration.status} IS NULL OR ${contentModeration.status} NOT IN ('rejected', 'shadowed'))`;

      // Get total count
      const [countResult] = await db
        .select({ count: sql`count(*)::int` })
        .from(media)
        .leftJoin(contentModeration, eq(contentModeration.mediaId, media.id))
        .where(and(...conditions, excludeRemoved));

      const total = countResult?.count || 0;

      // Get files with pagination
      const files = await db
        .select({
          id: media.id,
          url: media.url,
          s3Key: media.s3Key,
          mediaType: media.mediaType,
          mimetype: media.mimetype,
          extension: media.extension,
          size: media.size,
          folder: media.folder,
          originalName: media.originalName,
          properties: media.properties,
          referenceCount: media.referenceCount,
          createdAt: media.createdAt,
          lastAccessedAt: media.lastAccessedAt,
          moderationStatus: contentModeration.status,
        })
        .from(media)
        .leftJoin(contentModeration, eq(contentModeration.mediaId, media.id))
        .where(and(...conditions, excludeRemoved))
        .orderBy(sql`${media.createdAt} DESC`)
        .limit(limit)
        .offset(offset);

      logger.info(`Retrieved ${files.length} files for user ${userId}`, {
        total,
        mediaType,
        folder,
        limit,
        offset,
      });

      return {
        files,
        total,
        limit,
        offset,
        hasMore: offset + files.length < total,
      };
    } catch (error) {
      logger.error('Error fetching user files:', error);
      throw new ApiError(500, `Failed to fetch files: ${error.message}`);
    }
  }
}
