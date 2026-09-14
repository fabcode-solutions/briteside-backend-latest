import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';
import ApiError from '../../utils/api-error.js';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const BUCKET = process.env.AWS_S3_BUCKET;
const PRESIGN_TTL_SECONDS = 15 * 60;
// Videos: mp4/mov only — the formats Stream moderation can analyze
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

function sanitizeFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const base = path
    .basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase()
    .slice(0, 100);
  return base + ext;
}

export class PresignService {
  /**
   * Generate pre-signed S3 PUT URLs for a batch of images.
   */
  static async generateUploadUrls({ userId, importId, images }) {
    // Validate all content types before doing any async work
    for (const img of images) {
      if (!ALLOWED_CONTENT_TYPES.has(img.contentType)) {
        throw new ApiError(
          400,
          `Content type not allowed: ${img.contentType}. Allowed: jpeg, png, webp, mp4, mov, webm, avi, mpeg.`
        );
      }
    }

    return Promise.all(
      images.map(async ({ imageId, filename, contentType }) => {
        const safeName = sanitizeFilename(filename);
        // Scoped key prevents cross-user or cross-import access
        const s3Key = `imports/${userId}/${importId}/${imageId}/${safeName}`;

        const command = new PutObjectCommand({
          Bucket: BUCKET,
          Key: s3Key,
          ContentType: contentType,
          ACL: 'public-read',
          Metadata: { userId, importId, imageId },
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
        return { imageId, s3Key, uploadUrl, originalFilename: safeName };
      })
    );
  }

  /**
   * Verify an image was actually uploaded to S3.
   */
  static async verifyUploaded(s3Key) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }
}
