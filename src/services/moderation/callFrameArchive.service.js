import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { talentSessionFrames } from '../../db/schema/talentSessionFrames.js';
import ApiError from '../../utils/api-error.js';
import logger from '../../config/logger.js';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Credentials resolved from the instance role, matching shopDeliverable.service.js.
const s3Client = new S3Client({ region: AWS_REGION });

// Same private bucket shop deliverables use — no public ACL, only ever
// accessed via a short-lived signed URL minted on demand for admins.
function getBucket() {
  const bucket = process.env.AWS_S3_PRIVATE_BUCKET;
  if (!bucket) {
    throw new ApiError(
      500,
      'Call moderation archival is not configured. Set AWS_S3_PRIVATE_BUCKET to a bucket that denies public reads.'
    );
  }
  return bucket;
}

const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Durably archives one call-moderation frame: downloads it from Stream's
 * transient frameUrl and re-uploads it to our own private S3 bucket, then
 * records a talent_session_frames row.
 *
 * `reason` is 'moderation_flag' (frame verdict was flagged/rejected/shadowed)
 * or 'report_sample' (frame landed on a randomly chosen report-screenshot
 * target offset, regardless of its own verdict).
 */
export class CallFrameArchiveService {
  static async archiveFrame({
    sessionId,
    trackType,
    participantId,
    frameUrl,
    capturedAt,
    moderationAction = null,
    reason,
    reviewQueueItemId = null,
  }) {
    const response = await fetch(frameUrl);
    if (!response.ok) {
      throw new Error(`Failed to download frame (${response.status}): ${frameUrl}`);
    }
    const body = Buffer.from(await response.arrayBuffer());

    const bucket = getBucket();
    const capturedAtMs = Date.parse(capturedAt) || Date.now();
    const key = `call-moderation/${sessionId}/${trackType}-${participantId}-${capturedAtMs}.jpg`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: response.headers.get('content-type') || 'image/jpeg',
      })
    );

    const [row] = await db
      .insert(talentSessionFrames)
      .values({
        sessionId,
        trackType,
        participantId,
        s3Bucket: bucket,
        s3Key: key,
        moderationAction,
        reason,
        reviewQueueItemId,
        capturedAt: new Date(capturedAtMs),
      })
      .returning();

    logger.info(`Call moderation frame archived: ${key} (reason=${reason})`);
    return row;
  }

  /**
   * Short-lived download URL for an archived frame. Minted per request, never
   * stored, so a leaked/forwarded URL is worthless after ~15 minutes.
   */
  static async getFrameSignedUrl(frameId) {
    const frame = await db.query.talentSessionFrames.findFirst({
      where: eq(talentSessionFrames.id, frameId),
    });
    if (!frame) throw new ApiError(404, 'Frame not found');

    const command = new GetObjectCommand({ Bucket: frame.s3Bucket, Key: frame.s3Key });
    const url = await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_TTL_SECONDS });

    return { url, expiresIn: SIGNED_URL_TTL_SECONDS };
  }
}
