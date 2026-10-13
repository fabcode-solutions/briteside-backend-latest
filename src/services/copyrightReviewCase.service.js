import { eq, desc, count, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { acrCopyrightReviewCases } from '../db/schema/acrCopyrightReviewCases.js';
import { acrCopyrightScans } from '../db/schema/acrCopyrightScans.js';
import { media } from '../db/schema/fileTracking.js';
import { users } from '../db/schema/users.js';
import { posts } from '../db/schema/social.js';
import { writeAuditLog } from './admin.service.js';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import logger from '../config/logger.js';

export const REVIEW_ACTIONS = ['reviewed', 'dismissed', 'confirmed_infringement'];
const VALID_REVIEW_ACTIONS = new Set(REVIEW_ACTIONS);

const log = {
  error: (msg, meta = {}) => logger.error(msg, { module: 'copyright-review-case', ...meta }),
};

/**
 * Maps one ACRCloud metadata.music[] entry to the row this service inserts.
 * Pure function (no DB/IO) so field-mapping can be unit-tested directly
 * against the many shapes ACRCloud's response can take (missing artists,
 * missing label, non-numeric score, etc).
 */
export function buildCaseValues({ mediaId, scanId, userId, match }) {
  return {
    mediaId,
    scanId,
    userId: userId ?? null,
    songTitle: match.title ?? null,
    artist: match.artists?.[0]?.name ?? null,
    label: match.label ?? null,
    score: typeof match.score === 'number' ? match.score : null,
    acrid: match.acrid ?? null,
    matchDetails: match,
  };
}

export class CopyrightReviewCaseService {
  /**
   * Create a pending admin review case for a media file's top ACRCloud
   * match. Never throws — called from the scan worker right after recording
   * the scan result, must not break that. One case per media file, ever:
   * onConflictDoNothing on media_id means a rescan/retry that matches again
   * never duplicates a case or clobbers an admin's existing decision (this
   * also relies on the unique index on media_id — see the migration and
   * `test/copyrightReviewCase.service.test.js`'s migration-assertion test).
   */
  static async createIfNotExists({ mediaId, scanId, userId, match }) {
    if (!mediaId || !scanId || !match) return;
    try {
      await db
        .insert(acrCopyrightReviewCases)
        .values(buildCaseValues({ mediaId, scanId, userId, match }))
        .onConflictDoNothing({ target: acrCopyrightReviewCases.mediaId });
    } catch (error) {
      log.error('Failed to create copyright review case', {
        mediaId,
        scanId,
        error: error.message,
      });
    }
  }

  /** Paginated admin queue, newest first, optionally filtered by status. */
  static async list({ status, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const where = status ? eq(acrCopyrightReviewCases.status, status) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: acrCopyrightReviewCases.id,
          mediaId: acrCopyrightReviewCases.mediaId,
          scanId: acrCopyrightReviewCases.scanId,
          songTitle: acrCopyrightReviewCases.songTitle,
          artist: acrCopyrightReviewCases.artist,
          label: acrCopyrightReviewCases.label,
          score: acrCopyrightReviewCases.score,
          status: acrCopyrightReviewCases.status,
          createdAt: acrCopyrightReviewCases.createdAt,
          reviewedAt: acrCopyrightReviewCases.reviewedAt,
          mediaUrl: media.url,
          uploaderId: users.id,
          uploaderUsername: users.username,
        })
        .from(acrCopyrightReviewCases)
        .leftJoin(media, eq(media.id, acrCopyrightReviewCases.mediaId))
        .leftJoin(users, eq(users.id, acrCopyrightReviewCases.userId))
        .where(where)
        .orderBy(desc(acrCopyrightReviewCases.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(acrCopyrightReviewCases).where(where),
    ]);

    return { items: rows, total: totalRows[0]?.total ?? 0, page, limit };
  }

  /**
   * Full case detail: the case row, the media URL (for the admin to preview
   * the video), every match ACRCloud returned for that scan (not just the
   * top one promoted to columns), and any posts currently referencing this
   * media. Post IDs are resolved on read, not persisted — one media file can
   * back multiple posts, and a video can be scanned before any post
   * referencing it exists yet.
   */
  static async getById(id) {
    const row = await db.query.acrCopyrightReviewCases.findFirst({
      where: eq(acrCopyrightReviewCases.id, id),
    });
    if (!row) return null;

    const mediaRow = await db.query.media.findFirst({ where: eq(media.id, row.mediaId) });
    const scanRow = await db.query.acrCopyrightScans.findFirst({
      where: eq(acrCopyrightScans.id, row.scanId),
    });

    let postIds = [];
    if (mediaRow?.url) {
      const postRows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(sql`${posts.mediaUrls}::text LIKE ${'%' + mediaRow.url + '%'}`);
      postIds = postRows.map(p => p.id);
    }

    return {
      ...row,
      mediaUrl: mediaRow?.url ?? null,
      postIds,
      allMatches: scanRow?.matches ?? [],
    };
  }

  /**
   * Admin decision on a case. Mirrors MediaModerationService.reviewEntity's
   * shape (capture previous status, audit log, return the updated row) —
   * this never touches content_moderation, S3 ACLs, or the video itself; it
   * only records the admin's decision for record-keeping.
   */
  static async review({ id, action, adminId, notes }) {
    if (!VALID_REVIEW_ACTIONS.has(action)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid action. Must be one of: ${REVIEW_ACTIONS.join(', ')}`
      );
    }

    const row = await db.query.acrCopyrightReviewCases.findFirst({
      where: eq(acrCopyrightReviewCases.id, id),
    });
    if (!row) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Copyright review case not found');
    }

    const previousStatus = row.status;
    await db
      .update(acrCopyrightReviewCases)
      .set({
        status: action,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(acrCopyrightReviewCases.id, id));

    await writeAuditLog(adminId, 'COPYRIGHT_CASE_REVIEW', 'acr_copyright_review_cases', id, {
      previousValues: { status: previousStatus },
      newValues: { status: action, notes: notes ?? null },
    });

    return db.query.acrCopyrightReviewCases.findFirst({
      where: eq(acrCopyrightReviewCases.id, id),
    });
  }
}

export default CopyrightReviewCaseService;
