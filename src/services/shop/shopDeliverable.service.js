import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import ApiError from '../../utils/api-error.js';
import logger from '../../config/logger.js';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Credentials are resolved from the instance role, matching upload.service.js.
const s3Client = new S3Client({ region: AWS_REGION });

const MAX_DELIVERABLE_SIZE = 500 * 1024 * 1024; // 500MB
const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.jar', '.msi', '.dll'];

// Long enough to start a large download, short enough that a leaked or
// forwarded URL is worthless soon after.
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Paid product files.
 *
 * Deliberately NOT routed through UploadService: that path sets
 * `ACL: 'public-read'` and returns a CDN URL, which would put every paid file
 * on the open internet. Here the object gets no public ACL and only its S3 key
 * is ever returned, so there is no URL to leak or forward. Buyers receive a
 * short-lived signed URL from the download endpoint (phase 2), which re-checks
 * their order on every request.
 */
export class ShopDeliverableService {
  static get bucket() {
    const bucket = process.env.AWS_S3_PRIVATE_BUCKET;
    if (!bucket) {
      // Falling back to the public bucket would silently expose paid files, so
      // this fails loudly instead.
      throw new ApiError(
        500,
        'Shop file storage is not configured. Set AWS_S3_PRIVATE_BUCKET to a bucket that denies public reads.'
      );
    }
    return bucket;
  }

  static validate(file) {
    if (!file) throw new ApiError(400, 'No file provided');

    if (file.size > MAX_DELIVERABLE_SIZE) {
      throw new ApiError(
        400,
        `File exceeds the maximum size of ${MAX_DELIVERABLE_SIZE / 1024 / 1024}MB`
      );
    }

    if (!file.originalname?.trim()) throw new ApiError(400, 'File must have a name');

    const extension = path.extname(file.originalname).toLowerCase();
    if (DANGEROUS_EXTENSIONS.includes(extension)) {
      throw new ApiError(400, `Files of type ${extension} cannot be sold`);
    }
  }

  /**
   * Store a seller's product file privately.
   * @returns {Promise<{key: string, fileName: string, size: number}>}
   */
  static async upload(sellerId, file) {
    this.validate(file);

    // Strip anything that could escape the prefix or confuse a Content-Disposition.
    const safeName = path.basename(file.originalname).replace(/[^\w.\-() ]/g, '_');
    const key = `shop-deliverables/${sellerId}/${randomUUID()}/${safeName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
        Metadata: {
          'original-name': safeName,
          'seller-id': String(sellerId),
          'uploaded-at': new Date().toISOString(),
        },
      })
    );

    logger.info(`Shop deliverable stored privately: ${key}`);

    return {
      key: key,
      fileKey: key,
      fileName: safeName,
      size: file.size,
    };

  }

  /**
   * A short-lived download URL for a stored deliverable.
   *
   * Minted per request, never stored, so entitlement is re-checked by the
   * caller every time rather than living in a URL someone could keep or share.
   *
   * @returns {Promise<{url: string, expiresIn: number}>}
   */
  static async getSignedDownloadUrl(key, fileName) {
    if (!key) throw new ApiError(404, 'This product has no file attached');

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Makes the browser save it under the seller's original filename
      // instead of the uuid-prefixed object key.
      ResponseContentDisposition: `attachment; filename="${fileName || path.basename(key)}"`,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });

    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }
}
