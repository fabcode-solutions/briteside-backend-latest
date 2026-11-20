import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import httpStatus from 'http-status';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from '../utils/businessQuestionnaire.js';

export { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES };

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export const ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const PREFIX = 'business-booking-attachments';
const VIEW_URL_TTL_SECONDS = 5 * 60;

/**
 * Does the file start with the bytes its type claims? Stops a renamed
 * executable / HTML file being stored as "photo.png".
 */
export function matchesSignature(buffer, mimetype) {
  if (!buffer || buffer.length < 12) return false;
  const hex = n => buffer.subarray(0, n).toString('hex');
  const ascii = (from, to) => buffer.subarray(from, to).toString('latin1');
  switch (mimetype) {
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    case 'image/jpeg':
      return hex(3) === 'ffd8ff';
    case 'image/png':
      return hex(8) === '89504e470d0a1a0a';
    case 'image/gif':
      return ascii(0, 4) === 'GIF8';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic':
    case 'image/heif':
      return ascii(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/** Safe display/storage name: no path, no control or quote characters. */
export const safeFileName = name =>
  (path.basename(String(name ?? '')).replace(/[^\w.\-() ]/g, '_').trim() || 'file').slice(0, 120);

/** Every key a user uploads for a business starts with this. */
export const attachmentPrefix = (businessId, userId) => `${PREFIX}/${businessId}/${userId}/`;

/**
 * Files customers attach to a booking (photos of a reference style, a referral
 * letter, …). Stored in the PRIVATE bucket — never a public URL. The business
 * (and the customer) get 5-minute signed links, minted per request after the
 * caller has checked access.
 */
export class BusinessAttachmentService {
  static get bucket() {
    const bucket = process.env.AWS_S3_PRIVATE_BUCKET;
    if (!bucket) {
      // Never fall back to the public bucket — these can be personal/medical files
      logger.error('AWS_S3_PRIVATE_BUCKET is not set — booking attachments are disabled');
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        "File uploads aren't available right now. You can still book without attaching files."
      );
    }
    return bucket;
  }

  /** Store one file. Returns { key, name, size, type } for checkout. */
  static async upload(business, userId, file) {
    if (!file) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a file to attach');
    if (!ATTACHMENT_TYPES.has(file.mimetype)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Only photos (JPG, PNG, WebP, GIF, HEIC) and PDFs can be attached');
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Files can be up to 10 MB each');
    }
    if (!matchesSignature(file.buffer, file.mimetype)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This file doesn't look like a valid photo or PDF. Try exporting it again."
      );
    }

    const name = safeFileName(file.originalname);
    const key = `${attachmentPrefix(business.id, userId)}${randomUUID()}/${name}`;
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: { 'original-name': name, 'uploaded-by': String(userId), 'business-id': business.id },
        })
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Booking attachment upload failed', { businessId: business.id, err: err.message });
      throw new ApiError(httpStatus.BAD_GATEWAY, "We couldn't upload that file. Please try again.");
    }
    return { key, name, size: file.size, type: file.mimetype };
  }

  /**
   * Check the files a customer sends with checkout: their own uploads for this
   * business, still in storage, within the limits. Returns the snapshot stored
   * on the booking. Sizes/types come from storage, not from the client.
   */
  static async resolveForBooking(business, userId, list, { allowed }) {
    if (!list?.length) return [];
    if (!allowed) {
      throw new ApiError(httpStatus.BAD_REQUEST, "This service doesn't accept attachments. Remove them to continue.");
    }
    if (!userId) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to attach files to your booking');
    }
    const unique = [...new Map(list.map(a => [a.key, a])).values()];
    if (unique.length > ATTACHMENT_MAX_FILES) {
      throw new ApiError(httpStatus.BAD_REQUEST, `You can attach up to ${ATTACHMENT_MAX_FILES} files`);
    }
    const prefix = attachmentPrefix(business.id, userId);
    return Promise.all(
      unique.map(async a => {
        if (typeof a.key !== 'string' || !a.key.startsWith(prefix) || a.key.includes('..')) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'One of your attachments is invalid. Remove it and attach it again.');
        }
        let head;
        try {
          head = await s3Client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: a.key }));
        } catch (err) {
          if (err instanceof ApiError) throw err;
          if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'One of your attachments was not found. Attach it again.', true, '', {
              code: 'ATTACHMENT_MISSING',
            });
          }
          logger.error('Booking attachment check failed', { key: a.key, err: err.message });
          throw new ApiError(httpStatus.BAD_GATEWAY, "We couldn't check your attachments. Please try again.");
        }
        const size = Number(head.ContentLength ?? 0);
        const type = head.ContentType;
        if (!size || size > ATTACHMENT_MAX_BYTES || !ATTACHMENT_TYPES.has(type)) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'One of your attachments is invalid. Remove it and attach it again.');
        }
        return { key: a.key, name: safeFileName(a.name || path.basename(a.key)), size, type };
      })
    );
  }

  /** Short-lived link to view one attachment (caller has checked access). */
  static async viewUrl(attachment) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: attachment.key,
      ResponseContentType: attachment.type,
      // inline → photos / PDFs open in the browser tab
      ResponseContentDisposition: `inline; filename="${safeFileName(attachment.name)}"`,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: VIEW_URL_TTL_SECONDS });
    return { url, expiresIn: VIEW_URL_TTL_SECONDS };
  }
}
