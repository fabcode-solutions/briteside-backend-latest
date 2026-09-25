import { S3Client, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getBoss } from '../../lib/pgboss.js';
import { streamClient } from '../../utils/streamClient.js';
import { db } from '../../db/index.js';
import { contentModeration } from '../../db/schema/moderation.js';
import { media, eventMedia } from '../../db/schema/index.js';
import { posts, stories, socialProfiles } from '../../db/schema/social.js';
import { events } from '../../db/schema/events.js';
import { groups, groupMedia, groupFeaturedContent, discussions } from '../../db/schema/groups.js';
import { organizers } from '../../db/schema/organizers.js';
import { users } from '../../db/schema/users.js';
import { priorityMessageAttachments } from '../../db/schema/priorityMessageAttachments.js';
import { eq, and, ne, sql, inArray, desc, count } from 'drizzle-orm';
import { createNotification } from '../notification.service.js';
import { sendGeneralEmail } from '../mail.service.js';
import { PriorityMessageService } from '../priorityMessage.service.js';
import { writeAuditLog } from '../admin.service.js';
import ApiError from '../../utils/api-error.js';
import httpStatus from 'http-status';
import logger from '../../config/logger.js';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export const MEDIA_CONFIG_KEY = 'gokiro_media';
export const JOB_MODERATE_MEDIA = 'moderate-media';

// Entity types — image/video split for dashboard filtering
export const MEDIA_ENTITY = {
  MEDIA_IMAGE: 'gokiro:media:image',
  MEDIA_VIDEO: 'gokiro:media:video',
  POST: 'gokiro:post:media',
  STORY: 'gokiro:story:media',
  // Events/groups aggregate their REQUIRED media only (cover images) —
  // a rejected cover pauses sales/joins; optional gallery media is
  // stripped + notified but never blocks (see propagateMediaVerdict).
  EVENT: 'gokiro:event:media',
  GROUP: 'gokiro:group:media',
  DISCUSSION: 'gokiro:discussion:media',
};

// Which content_moderation FK column each entity type targets
const ENTITY_FK = {
  [MEDIA_ENTITY.MEDIA_IMAGE]: 'mediaId',
  [MEDIA_ENTITY.MEDIA_VIDEO]: 'mediaId',
  [MEDIA_ENTITY.POST]: 'postId',
  [MEDIA_ENTITY.STORY]: 'storyId',
  [MEDIA_ENTITY.EVENT]: 'eventId',
  [MEDIA_ENTITY.GROUP]: 'groupId',
  [MEDIA_ENTITY.DISCUSSION]: 'discussionId',
};

const ACTION_TO_STATUS = {
  keep: 'approved',
  flag: 'flagged',
  remove: 'rejected',
  shadow: 'shadowed',
  shadow_block: 'shadowed',
};

// Stream video moderation supports mp4/mov containers only (§4.3 of the plan).
const SUPPORTED_VIDEO_URL = /\.(mp4|mov)(\?.*)?$/i;

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'media-moderation', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'media-moderation', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'media-moderation', ...meta }),
};

/**
 * Feed gating fragments. Owner always sees their own content. For everyone
 * else, all media (image + video) is HELD until approved — hidden while
 * pending/skipped/error and removed on rejected/shadowed. Only 'approved'
 * (clean) and 'flagged' (shown blurred, under review) reach other users.
 * No moderation row = legacy content, visible.
 */
// Statuses hidden from everyone but the owner (single source of truth).
export const HELD_FROM_OTHERS = new Set(['pending', 'rejected', 'shadowed', 'skipped', 'error']);
const HELD_STATUSES = sql`('pending', 'rejected', 'shadowed', 'skipped', 'error')`;

export const postsModerationGate = viewerId => sql`NOT EXISTS (
  SELECT 1 FROM content_moderation cm
  WHERE cm.post_id = ${posts.id}
    AND ${posts.userId} != ${viewerId}
    AND cm.status IN ${HELD_STATUSES}
)`;

// Strict variant: hides held posts from EVERYONE, including the author. Used on
// another user's profile, where an author must not surface their own removed
// (or pending/shadowed) post just because they authored it.
export const postsModerationGateStrict = () => sql`NOT EXISTS (
  SELECT 1 FROM content_moderation cm
  WHERE cm.post_id = ${posts.id}
    AND cm.status IN ${HELD_STATUSES}
)`;

export const storiesModerationGate = viewerId => sql`NOT EXISTS (
  SELECT 1 FROM content_moderation cm
  WHERE cm.story_id = ${stories.id}
    AND ${stories.userId} != ${viewerId}
    AND cm.status IN ${HELD_STATUSES}
)`;

// Strict variant: excludes held stories for everyone, author included. Used for
// the "has an active story" ring — a held (removed/pending) story must not light
// the ring, or clicking it opens an empty viewer.
export const storiesModerationGateStrict = () => sql`NOT EXISTS (
  SELECT 1 FROM content_moderation cm
  WHERE cm.story_id = ${stories.id}
    AND cm.status IN ${HELD_STATUSES}
)`;

export const discussionsModerationGate = viewerId => sql`NOT EXISTS (
  SELECT 1 FROM content_moderation cm
  WHERE cm.discussion_id = ${discussions.id}
    AND ${discussions.userId} != ${viewerId}
    AND cm.status IN ${HELD_STATUSES}
)`;

/**
 * Attach `moderationStatus` to a list of posts or stories (one batched
 * indexed query). Missing row = legacy content = 'approved'. Mutates and
 * returns the same array — used to enrich API responses so the frontend
 * can blur flagged media / show the owner a "removed" state.
 */
async function attachStatuses(items, fkColumn) {
  const ids = items.map(i => i?.id).filter(Boolean);
  if (ids.length === 0) return items;
  const rows = await db
    .select({ targetId: contentModeration[fkColumn], status: contentModeration.status })
    .from(contentModeration)
    .where(inArray(contentModeration[fkColumn], ids));
  const statusMap = new Map(rows.map(r => [r.targetId, r.status]));
  for (const item of items) {
    if (item) item.moderationStatus = statusMap.get(item.id) ?? 'approved';
  }
  return items;
}

export const attachPostModerationStatuses = items => attachStatuses(items, 'postId');
export const attachStoryModerationStatuses = items => attachStatuses(items, 'storyId');
export const attachDiscussionModerationStatuses = items => attachStatuses(items, 'discussionId');

export class MediaModerationService {
  /**
   * Create/refresh the pending moderation row and queue the Stream check.
   * Never throws — a failure here must not break the upload/post flow
   * (reconciliation cron re-queues stuck rows).
   */
  static async enqueue({ entityType, entityId, userId, imageUrls = [], videoUrls = [] }) {
    if (imageUrls.length === 0 && videoUrls.length === 0) return;
    const fk = ENTITY_FK[entityType];
    if (!fk) {
      log.warn('Unknown moderation entity type — not enqueued', { entityType, entityId });
      return;
    }
    try {
      // Pending row exists before the job runs — gating joins see it immediately
      await this.upsertStatus(entityType, entityId, 'pending', { userId });

      const boss = getBoss();
      await boss.createQueue(JOB_MODERATE_MEDIA);
      await boss.send(
        JOB_MODERATE_MEDIA,
        { entityType, entityId, userId, imageUrls, videoUrls },
        { retryLimit: 3, retryDelay: 30, retryBackoff: true }
      );
    } catch (error) {
      log.error('Failed to enqueue media moderation job', {
        entityType,
        entityId,
        error: error.message,
      });
    }
  }

  // ── Shared lookups (single source of truth — reused by every path) ─────────

  /** Media rows (with current verdict) backing a set of public URLs. */
  static async mediaRowsForUrls(urls) {
    const cleaned = [...new Set((urls || []).filter(Boolean))];
    if (cleaned.length === 0) return [];
    return db
      .select({
        id: media.id,
        url: media.url,
        s3Key: media.s3Key,
        s3Bucket: media.s3Bucket,
        status: contentModeration.status,
      })
      .from(media)
      .leftJoin(contentModeration, eq(contentModeration.mediaId, media.id))
      .where(inArray(media.url, cleaned));
  }

  /** Worst-wins aggregate of a set of media verdicts (pure). */
  static aggregateStatus(rows) {
    const statuses = rows.map(r => r.status ?? 'approved');
    for (const worst of ['rejected', 'shadowed', 'pending', 'skipped', 'flagged']) {
      if (statuses.includes(worst)) return worst;
    }
    return 'approved';
  }

  /**
   * Filter + stamp a list of post objects for a viewer (one query):
   * drops posts held from non-owners (pending/rejected/shadowed/skipped/error),
   * keeps the owner's own, and sets `moderationStatus` on survivors so the
   * frontend can blur flagged ones. For relational listings (saved/liked/
   * reposted/…) where the SQL gate can't be a top-level WHERE.
   */
  static async applyPostModeration(postObjects, viewerId) {
    const list = (postObjects || []).filter(Boolean);
    const ids = list.map(p => p.id).filter(Boolean);
    if (ids.length === 0) return list;
    const rows = await db
      .select({ postId: contentModeration.postId, status: contentModeration.status })
      .from(contentModeration)
      .where(inArray(contentModeration.postId, ids));
    const statusById = new Map(rows.map(r => [r.postId, r.status]));
    const out = [];
    for (const p of list) {
      const st = statusById.get(p.id) ?? 'approved';
      if (HELD_FROM_OTHERS.has(st) && p.userId !== viewerId) continue; // held → drop
      p.moderationStatus = st;
      out.push(p);
    }
    return out;
  }

  /** Set of URLs whose backing media file is rejected/shadowed — for stripping galleries. */
  static async rejectedUrlSet(urls) {
    const rows = await this.mediaRowsForUrls(urls);
    return new Set(
      rows.filter(r => r.status === 'rejected' || r.status === 'shadowed').map(r => r.url)
    );
  }

  /**
   * Drop gallery items whose backing media file is rejected/shadowed, and
   * annotate the kept items with `moderationStatus` so the frontend can
   * blur flagged ones. The rejected URL is already dead via S3 quarantine —
   * this hides the broken entry instead of rendering a 403 thumbnail.
   */
  static async stripRejectedMedia(items, getUrl = i => i) {
    const list = (items || []).filter(Boolean);
    if (list.length === 0) return list;
    const rows = await this.mediaRowsForUrls(list.map(getUrl));
    const statusByUrl = new Map(rows.map(r => [r.url, r.status ?? 'approved']));
    const out = [];
    for (const item of list) {
      const status = statusByUrl.get(getUrl(item)) ?? 'approved';
      if (status === 'rejected' || status === 'shadowed') continue;
      if (item && typeof item === 'object') item.moderationStatus = status;
      out.push(item);
    }
    return out;
  }

  /** Public URLs backing an entity (media file, post, or story). */
  static async entityUrls(entityType, entityId) {
    if (entityType === MEDIA_ENTITY.MEDIA_IMAGE || entityType === MEDIA_ENTITY.MEDIA_VIDEO) {
      const file = await db.query.media.findFirst({
        where: eq(media.id, entityId),
        columns: { url: true },
      });
      return file ? [file.url] : [];
    }
    if (entityType === MEDIA_ENTITY.POST) {
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, entityId),
        columns: { mediaUrls: true },
      });
      return post?.mediaUrls || [];
    }
    if (entityType === MEDIA_ENTITY.STORY) {
      const story = await db.query.stories.findFirst({
        where: eq(stories.id, entityId),
        columns: { mediaUrl: true },
      });
      return story?.mediaUrl ? [story.mediaUrl] : [];
    }
    if (entityType === MEDIA_ENTITY.DISCUSSION) {
      const discussion = await db.query.discussions.findFirst({
        where: eq(discussions.id, entityId),
        columns: { mediaUrls: true },
      });
      return discussion?.mediaUrls || [];
    }
    if (entityType === MEDIA_ENTITY.EVENT) {
      // Required set only — cover images gate sales/publish
      const event = await db.query.events.findFirst({
        where: eq(events.id, entityId),
        columns: { coverImages: true },
      });
      return event?.coverImages || [];
    }
    if (entityType === MEDIA_ENTITY.GROUP) {
      const group = await db.query.groups.findFirst({
        where: eq(groups.id, entityId),
        columns: { coverImageUrl: true },
      });
      return group?.coverImageUrl ? [group.coverImageUrl] : [];
    }
    return [];
  }

  /**
   * Batch status lookup keyed by mediaId directly (not entity id) — for
   * consumers that reference a shared uploaded file, like priority message
   * attachments, where the file's own MEDIA_IMAGE/MEDIA_VIDEO verdict (set
   * at upload time) is the status to display, with no separate entity row.
   */
  static async statusesByMediaIds(mediaIds) {
    const ids = [...new Set((mediaIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ mediaId: contentModeration.mediaId, status: contentModeration.status })
      .from(contentModeration)
      .where(inArray(contentModeration.mediaId, ids));
    return new Map(rows.map(r => [r.mediaId, r.status]));
  }

  /** Current moderation status of an entity ('approved' when no row exists). */
  static async statusOf(entityType, entityId) {
    const fk = ENTITY_FK[entityType];
    if (!fk || !entityId) return 'approved';
    const row = await db.query.contentModeration.findFirst({
      where: eq(contentModeration[fk], entityId),
      columns: { status: true },
    });
    return row?.status ?? 'approved';
  }

  /**
   * Batch-annotate a list of events/groups with `moderationStatus` (from the
   * per-entity content_moderation row) so listing cards can blur/hide covers.
   */
  static attachEventModerationStatuses(items) {
    return attachStatuses(items, 'eventId');
  }

  static attachGroupModerationStatuses(items) {
    return attachStatuses(items, 'groupId');
  }

  /** Split a mixed URL list into image/video buckets by extension. */
  static splitUrls(urls) {
    const cleaned = (urls || []).filter(Boolean);
    const videoUrls = cleaned.filter(u => MediaModerationService.isVideoUrl(u));
    const imageUrls = cleaned.filter(u => !videoUrls.includes(u));
    return { imageUrls, videoUrls };
  }

  /** Whether a single URL points at a video file, by extension. */
  static isVideoUrl(url) {
    if (!url) return false;
    return SUPPORTED_VIDEO_URL.test(url) || /\.(webm|avi|mpe?g)(\?.*)?$/i.test(url);
  }

  /**
   * In-app notification + email to a content owner. Best-effort — comms
   * failures never break moderation flow.
   */
  static async notifyOwner({ userId, title, message, redirectTo, email = true }) {
    if (!userId) return;
    try {
      await createNotification({ userId, type: 'system', title, message, redirectTo });
    } catch (error) {
      log.error('Moderation notification failed', { userId, error: error.message });
    }
    // Flagged content gets an in-app notification only — no email (email is
    // reserved for removals, which pause sales/joins and need a stronger reach).
    if (!email) return;
    try {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true },
      });
      if (owner?.email) await sendGeneralEmail({ to: owner.email, subject: title, message });
    } catch (error) {
      log.error('Moderation email failed', { userId, error: error.message });
    }
  }

  /**
   * Tell an event/group owner about a bad verdict on their required cover media.
   * Single source of the copy so both the webhook path (propagateMediaVerdict)
   * and the create/update path (adoptMediaVerdicts — for REUSED media whose
   * verdict already landed and won't fire the webhook again) stay in sync.
   * rejected → notification + email (sales/joins paused); flagged → notification.
   */
  static async notifyEntityOwner(entityType, entityId, status) {
    if (status !== 'rejected' && status !== 'flagged') return;
    const removed = status === 'rejected';
    if (entityType === MEDIA_ENTITY.EVENT) {
      const [row] = await db
        .select({ title: events.title, ownerUserId: organizers.userId })
        .from(events)
        .leftJoin(organizers, eq(organizers.id, events.organizerId))
        .where(eq(events.id, entityId));
      if (!row) return;
      await this.notifyOwner({
        userId: row.ownerUserId,
        email: removed,
        title: removed ? 'Event image removed — ticket sales paused' : 'A cover image was flagged',
        message: removed
          ? `A cover image on your event "${row.title}" was removed for violating our community guidelines. Ticket sales and publishing are paused until you replace it.`
          : `A cover image on your event "${row.title}" was flagged for possibly going against our community guidelines and now shows a sensitive-content warning. If you think this is a mistake, contact support to have it reviewed.`,
      });
    } else if (entityType === MEDIA_ENTITY.GROUP) {
      const [row] = await db
        .select({ name: groups.name, ownerUserId: groups.createdBy })
        .from(groups)
        .where(eq(groups.id, entityId));
      if (!row) return;
      await this.notifyOwner({
        userId: row.ownerUserId,
        email: removed,
        title: removed ? 'Group image removed — new joins paused' : 'A cover image was flagged',
        message: removed
          ? `The cover image of your group "${row.name}" was removed for violating our community guidelines. New members cannot join until you replace it.`
          : `The cover image of your group "${row.name}" was flagged for possibly going against our community guidelines and now shows a sensitive-content warning. If you think this is a mistake, contact support to have it reviewed.`,
      });
    }
  }

  /**
   * Content-creation path (post/story). Files were already moderated at
   * upload — inherit their aggregate verdict, no second Stream call. Files
   * that never hit /upload (presign imports, legacy URLs) have no media row,
   * so fall back to a real check.
   */
  static async adoptMediaVerdicts({
    entityType,
    entityId,
    userId,
    imageUrls = [],
    videoUrls = [],
  }) {
    const urls = [...imageUrls, ...videoUrls].filter(Boolean);
    if (urls.length === 0) return;
    try {
      const rows = await this.mediaRowsForUrls(urls);
      if (rows.length === 0) {
        await this.enqueue({ entityType, entityId, userId, imageUrls, videoUrls });
        return;
      }
      const status = this.aggregateStatus(rows);
      // Reused media whose verdict already landed won't fire the webhook again,
      // so notify the owner here on a transition INTO a bad status (e.g. an
      // event created with a previously-rejected video). Event/group only —
      // posts/stories don't notify owners, so skip the extra status read.
      const notifiesOwner = entityType === MEDIA_ENTITY.EVENT || entityType === MEDIA_ENTITY.GROUP;
      const prev = notifiesOwner ? await this.statusOf(entityType, entityId) : null;
      await this.upsertStatus(entityType, entityId, status, { userId });
      if (
        notifiesOwner &&
        ((status === 'rejected' && prev !== 'rejected') ||
          (status === 'flagged' && prev !== 'flagged'))
      ) {
        await this.notifyEntityOwner(entityType, entityId, status);
      }
    } catch (error) {
      log.error('Failed to adopt media verdicts', { entityType, entityId, error: error.message });
    }
  }

  /**
   * A file's verdict changed → recompute the aggregate status of every
   * post/story referencing it, so feed gating (which reads content rows)
   * stays in sync. The file's own ACL flip already killed/restored the S3
   * object everywhere; this only syncs derived statuses.
   */
  static async propagateMediaVerdict(url, fileStatus) {
    if (!url) return;
    try {
      const affectedPosts = await db
        .select({ id: posts.id, userId: posts.userId, mediaUrls: posts.mediaUrls })
        .from(posts)
        .where(sql`${posts.mediaUrls}::text LIKE ${'%' + url + '%'}`);
      for (const post of affectedPosts) {
        const rows = await this.mediaRowsForUrls(post.mediaUrls || []);
        await this.upsertStatus(MEDIA_ENTITY.POST, post.id, this.aggregateStatus(rows), {
          userId: post.userId,
        });
      }

      const affectedStories = await db
        .select({ id: stories.id, userId: stories.userId })
        .from(stories)
        .where(eq(stories.mediaUrl, url));
      for (const story of affectedStories) {
        const rows = await this.mediaRowsForUrls([url]);
        await this.upsertStatus(MEDIA_ENTITY.STORY, story.id, this.aggregateStatus(rows), {
          userId: story.userId,
        });
      }

      const affectedDiscussions = await db
        .select({
          id: discussions.id,
          userId: discussions.userId,
          mediaUrls: discussions.mediaUrls,
        })
        .from(discussions)
        .where(sql`${discussions.mediaUrls}::text LIKE ${'%' + url + '%'}`);
      for (const discussion of affectedDiscussions) {
        const rows = await this.mediaRowsForUrls(discussion.mediaUrls || []);
        await this.upsertStatus(
          MEDIA_ENTITY.DISCUSSION,
          discussion.id,
          this.aggregateStatus(rows),
          {
            userId: discussion.userId,
          }
        );
      }

      // ── Events: a cover image verdict gates ticket sales / publish ─────────
      const affectedEvents = await db
        .select({
          id: events.id,
          title: events.title,
          coverImages: events.coverImages,
          ownerUserId: organizers.userId,
        })
        .from(events)
        .leftJoin(organizers, eq(organizers.id, events.organizerId))
        .where(sql`${events.coverImages}::text LIKE ${'%' + url + '%'}`);
      for (const event of affectedEvents) {
        const prev = await this.statusOf(MEDIA_ENTITY.EVENT, event.id);
        const rows = await this.mediaRowsForUrls(event.coverImages || []);
        const next = this.aggregateStatus(rows);
        await this.upsertStatus(MEDIA_ENTITY.EVENT, event.id, next, {
          userId: event.ownerUserId,
        });
        if (prev === 'rejected' && next !== 'rejected') {
          await this.notifyOwner({
            userId: event.ownerUserId,
            title: 'Your event is active again',
            message: `The content issue on your event "${event.title}" is resolved. Ticket sales are available again.`,
          });
        } else if (
          (next === 'rejected' && prev !== 'rejected') ||
          (next === 'flagged' && prev !== 'flagged')
        ) {
          await this.notifyEntityOwner(MEDIA_ENTITY.EVENT, event.id, next);
        }
      }

      // ── Groups: cover image verdict gates joins / publish ──────────────────
      const affectedGroups = await db
        .select({ id: groups.id, name: groups.name, ownerUserId: groups.createdBy })
        .from(groups)
        .where(eq(groups.coverImageUrl, url));
      for (const group of affectedGroups) {
        const prev = await this.statusOf(MEDIA_ENTITY.GROUP, group.id);
        const rows = await this.mediaRowsForUrls([url]);
        const next = this.aggregateStatus(rows);
        await this.upsertStatus(MEDIA_ENTITY.GROUP, group.id, next, {
          userId: group.ownerUserId,
        });
        if (prev === 'rejected' && next !== 'rejected') {
          await this.notifyOwner({
            userId: group.ownerUserId,
            title: 'Your group is active again',
            message: `The content issue on your group "${group.name}" is resolved. New members can join again.`,
          });
        } else if (
          (next === 'rejected' && prev !== 'rejected') ||
          (next === 'flagged' && prev !== 'flagged')
        ) {
          await this.notifyEntityOwner(MEDIA_ENTITY.GROUP, group.id, next);
        }
      }

      // ── Optional media (event gallery / group media / featured content):
      // never blocks — the file is already quarantined (rejected) or blurred
      // (flagged). Removed → notification + email; flagged → notification only.
      if (fileStatus === 'rejected' || fileStatus === 'flagged') {
        const removed = fileStatus === 'rejected';
        const galleryHits = await db
          .select({ eventTitle: events.title, ownerUserId: organizers.userId })
          .from(eventMedia)
          .innerJoin(events, eq(events.id, eventMedia.eventId))
          .leftJoin(organizers, eq(organizers.id, events.organizerId))
          .where(eq(eventMedia.mediaUrl, url));
        for (const hit of galleryHits) {
          await this.notifyOwner({
            userId: hit.ownerUserId,
            email: removed,
            title: removed ? 'Event image removed' : 'An event image was flagged',
            message: removed
              ? `An image in the gallery of your event "${hit.eventTitle}" was removed for violating our community guidelines. Please review your content.`
              : `An image in the gallery of your event "${hit.eventTitle}" was flagged for possibly going against our community guidelines and is shown with a sensitive-content warning. If you think this is a mistake, contact support.`,
          });
        }

        const groupMediaHits = await db
          .select({ groupName: groups.name, ownerUserId: groups.createdBy })
          .from(groupMedia)
          .innerJoin(groups, eq(groups.id, groupMedia.groupId))
          .where(eq(groupMedia.mediaUrl, url));
        const featuredHits = await db
          .select({ groupName: groups.name, ownerUserId: groups.createdBy })
          .from(groupFeaturedContent)
          .innerJoin(groups, eq(groups.id, groupFeaturedContent.groupId))
          .where(eq(groupFeaturedContent.mediaUrl, url));
        for (const hit of [...groupMediaHits, ...featuredHits]) {
          await this.notifyOwner({
            userId: hit.ownerUserId,
            email: removed,
            title: removed ? 'Group image removed' : 'A group image was flagged',
            message: removed
              ? `An image in your group "${hit.groupName}" was removed for violating our community guidelines. Please review your content.`
              : `An image in your group "${hit.groupName}" was flagged for possibly going against our community guidelines and is shown with a sensitive-content warning. If you think this is a mistake, contact support.`,
          });
        }

        // Social profile cover image — no per-item row; notify the owner.
        const profileHits = await db
          .select({ ownerUserId: socialProfiles.userId })
          .from(socialProfiles)
          .where(sql`${socialProfiles.coverMedia}::text LIKE ${'%' + url + '%'}`);
        for (const hit of profileHits) {
          await this.notifyOwner({
            userId: hit.ownerUserId,
            email: removed,
            title: removed ? 'Profile cover removed' : 'Your profile cover was flagged',
            message: removed
              ? `Your profile cover image was removed for violating our community guidelines. Please replace it.`
              : `Your profile cover image was flagged for possibly going against our community guidelines and now shows a sensitive-content warning. If you think this is a mistake, contact support.`,
          });
        }

        // Priority message attachments: flagged → blur only, no action needed
        // here (the priority message service reads this file's status live).
        // Rejected → refund that attachment and notify both sender and talent.
        if (removed) {
          const attachmentHits = await db
            .select({ id: priorityMessageAttachments.id })
            .from(priorityMessageAttachments)
            .where(
              and(
                eq(priorityMessageAttachments.url, url),
                ne(priorityMessageAttachments.status, 'refunded')
              )
            );
          for (const hit of attachmentHits) {
            await PriorityMessageService.refundRejectedAttachment(hit.id);
          }
        }
      }
    } catch (error) {
      log.error('Failed to propagate media verdict', { url, error: error.message });
    }
  }

  /** Flip the S3 ACL of the media objects backing these URLs. */
  static async setObjectsAcl(urls, acl) {
    try {
      const rows = await this.mediaRowsForUrls(urls);
      for (const row of rows) {
        try {
          await s3.send(
            new PutObjectAclCommand({ Bucket: row.s3Bucket, Key: row.s3Key, ACL: acl })
          );
        } catch (err) {
          log.error('Failed to flip S3 ACL', { key: row.s3Key, acl, error: err.message });
        }
      }
      if (rows.length > 0)
        log.info('S3 ACL updated for moderated media', { acl, objects: rows.length });
    } catch (err) {
      log.error('Quarantine step failed', { acl, error: err.message });
    }
  }

  /**
   * Worker entry: submit URLs to Stream. Image/video engines are async —
   * the immediate response is usually pending; the real verdict arrives
   * via the moderation_check.completed webhook.
   */
  static async runCheck({ entityType, entityId, userId, imageUrls = [], videoUrls = [] }) {
    const supportedVideos = videoUrls.filter(u => SUPPORTED_VIDEO_URL.test(u));
    const unsupportedCount = videoUrls.length - supportedVideos.length;

    if (unsupportedCount > 0) {
      log.warn('Unsupported video format(s) — not analyzable by Stream', {
        entityType,
        entityId,
        unsupportedCount,
      });
    }

    // Nothing Stream can analyze → never silent-approve; mark for manual review.
    if (imageUrls.length === 0 && supportedVideos.length === 0) {
      await this.upsertStatus(entityType, entityId, 'skipped', {
        userId,
        labels: ['unsupported-video-format'],
      });
      return;
    }

    const moderationPayload = {};
    if (imageUrls.length > 0) moderationPayload.images = imageUrls;
    if (supportedVideos.length > 0) moderationPayload.videos = supportedVideos;

    const res = await streamClient.moderation.check({
      entity_type: entityType,
      entity_id: String(entityId),
      entity_creator_id: String(userId),
      moderation_payload: moderationPayload,
      config_key: MEDIA_CONFIG_KEY,
    });

    // Async engines report pending/partial — verdict comes via webhook.
    if (res?.status === 'complete' && res?.recommended_action) {
      await this.applyVerdict({
        entityType,
        entityId,
        action: res.recommended_action,
        reviewId: res.item?.id,
      });
    }
  }

  /**
   * Insert-or-update the moderation row for an entity (one row per entity,
   * enforced by the unique index on each FK column).
   */
  static async upsertStatus(entityType, entityId, status, { userId, reviewId, labels } = {}) {
    const fk = ENTITY_FK[entityType];
    if (!fk) {
      log.warn('Unknown moderation entity type', { entityType, entityId });
      return false;
    }

    const changes = {
      status,
      entityType,
      updatedAt: new Date(),
      ...(status !== 'pending' ? { moderatedAt: new Date() } : {}),
      ...(reviewId ? { reviewId } : {}),
      ...(labels ? { labels } : {}),
    };

    await db
      .insert(contentModeration)
      .values({
        [fk]: entityId,
        userId: userId ?? null,
        ...changes,
      })
      .onConflictDoUpdate({
        target: contentModeration[fk],
        set: changes,
      });
    return true;
  }

  /**
   * Apply a Stream verdict. Idempotent — webhooks redeliver.
   */
  static async applyVerdict({ entityType, entityId, action, reviewId, labels = [] }) {
    const fk = ENTITY_FK[entityType];
    if (!fk) {
      log.warn('Verdict for unknown entity type — ignoring', { entityType, entityId, action });
      return;
    }

    const status = ACTION_TO_STATUS[action];
    if (!status) {
      log.warn('Unknown recommended_action — ignoring', { entityType, entityId, action });
      return;
    }

    const existing = await db.query.contentModeration.findFirst({
      where: eq(contentModeration[fk], entityId),
      columns: { id: true, status: true },
    });
    // Redelivered webhook for an already-applied verdict, with nothing new
    // to add → no-op. `moderation_check.completed` fires first with no
    // labels, then `review_queue_item.new/updated` fires with the real
    // labels but often the SAME status — without the labels.length check
    // that second call used to no-op here and the labels were lost forever.
    if (existing?.status === status && labels.length === 0) return;

    await this.upsertStatus(entityType, entityId, status, { reviewId, labels });

    const urls = await this.entityUrls(entityType, entityId);

    // Quarantine: rejected → S3 object private (URL 403s everywhere at once).
    // Moderator overturn (approved after rejected) → restore public-read.
    // Shadowed stays public — the owner must keep seeing their own content.
    if (status === 'rejected') {
      await this.setObjectsAcl(urls, 'private');
    } else if (status === 'approved' && existing?.status === 'rejected') {
      await this.setObjectsAcl(urls, 'public-read');
    }

    // A file verdict cascades to every post/story/event/group that embeds it.
    if (entityType === MEDIA_ENTITY.MEDIA_IMAGE || entityType === MEDIA_ENTITY.MEDIA_VIDEO) {
      for (const url of urls) await this.propagateMediaVerdict(url, status);
    }

    log.info('Moderation verdict applied', { entityType, entityId, action, status });
  }

  /**
   * Admin dashboard: paginated content_moderation rows, newest first,
   * enriched with the entity's display URLs (via entityUrls) and creator info.
   */
  static async queryModerationQueue({ status, entityType, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    if (status) conditions.push(eq(contentModeration.status, status));
    if (entityType) conditions.push(eq(contentModeration.entityType, entityType));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: contentModeration.id,
          entityType: contentModeration.entityType,
          mediaId: contentModeration.mediaId,
          postId: contentModeration.postId,
          storyId: contentModeration.storyId,
          eventId: contentModeration.eventId,
          groupId: contentModeration.groupId,
          discussionId: contentModeration.discussionId,
          status: contentModeration.status,
          labels: contentModeration.labels,
          reviewId: contentModeration.reviewId,
          moderatedAt: contentModeration.moderatedAt,
          createdAt: contentModeration.createdAt,
          userId: contentModeration.userId,
          username: users.username,
          userName: users.name,
        })
        .from(contentModeration)
        .leftJoin(users, eq(users.id, contentModeration.userId))
        .where(where)
        .orderBy(desc(contentModeration.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(contentModeration).where(where),
    ]);

    const items = await Promise.all(
      rows.map(async row => {
        const fk = ENTITY_FK[row.entityType];
        const entityId = fk ? row[fk] : null;
        const urls = entityId ? await this.entityUrls(row.entityType, entityId) : [];
        return {
          id: row.id,
          entityType: row.entityType,
          entityId,
          status: row.status,
          labels: row.labels ?? [],
          reviewId: row.reviewId,
          moderatedAt: row.moderatedAt,
          createdAt: row.createdAt,
          urls,
          user: row.userId ? { id: row.userId, username: row.username, name: row.userName } : null,
        };
      })
    );

    return { items, total: totalRows[0]?.total ?? 0, page, limit };
  }

  /**
   * Admin manual override: reuses the same applyVerdict pipeline a Stream
   * webhook would trigger (S3 ACL flip + cascade to posts/stories/events/
   * groups), so an admin decision has identical effects to an automated one.
   */
  static async reviewEntity({ id, action, adminId, reason }) {
    const row = await db.query.contentModeration.findFirst({
      where: eq(contentModeration.id, id),
    });
    if (!row) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Moderation item not found');
    }

    const fk = ENTITY_FK[row.entityType];
    if (!fk || !row[fk]) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unresolvable entity for type: ${row.entityType}`);
    }

    const previousStatus = row.status;
    await this.applyVerdict({
      entityType: row.entityType,
      entityId: row[fk],
      action,
      reviewId: row.reviewId,
      labels: row.labels ?? [],
    });

    await writeAuditLog(adminId, 'MODERATION_MANUAL_REVIEW', 'content_moderation', id, {
      previousValues: { status: previousStatus },
      newValues: { status: ACTION_TO_STATUS[action] ?? action, action, reason: reason ?? null },
    });

    return db.query.contentModeration.findFirst({ where: eq(contentModeration.id, id) });
  }
}

export default MediaModerationService;
