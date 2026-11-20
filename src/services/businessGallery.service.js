/**
 * Likes and comments on a business's gallery photos ("Posts" on its page) —
 * the same experience as a feed post / business wall post:
 *   • likes on the photo; comments with one level of replies, comment likes,
 *     @mentions, edit (author) and delete (author or the business's moderators).
 *   • Comments come back in the business-wall shape so the shared
 *     InlineComments / CommentItem UI renders them unchanged.
 *   • Notifications: the business owner (likes / comments on their photo),
 *     the parent commenter (replies), tagged people, comment authors (likes).
 */
import httpStatus from 'http-status';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businessGalleryCommentLikes,
  businessGalleryComments,
  businessGalleryLikes,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { createNotification } from './notification.service.js';
import {
  AUTHOR_COLUMNS,
  authorName,
  canModerate,
  loadPublicBusiness,
  resolveMentions,
  serializeAuthor,
} from './businessWall.service.js';
import { GALLERY_COMMENTS_PER_HOUR, findGalleryPost, galleryPostKey } from '../utils/businessGallery.js';

/** Replies embedded under each top-level comment in a list (the rest via /replies). */
const REPLY_PREVIEW = 3;
const COMMENT_WITH = { author: { columns: AUTHOR_COLUMNS } };
const excerpt = text => (text.length > 140 ? `${text.slice(0, 137)}…` : text);

function loadPost(business, postKey) {
  const post = findGalleryPost(business.gallery, postKey);
  if (!post) throw new ApiError(httpStatus.NOT_FOUND, 'This post was removed by the business');
  return post;
}

async function loadComment(business, postKey, commentId) {
  const comment = await db.query.businessGalleryComments.findFirst({
    where: and(
      eq(businessGalleryComments.id, commentId),
      eq(businessGalleryComments.businessId, business.id),
      eq(businessGalleryComments.postKey, postKey)
    ),
  });
  if (!comment) throw new ApiError(httpStatus.NOT_FOUND, 'This comment was deleted');
  return comment;
}

/** Same shape as a business wall comment (postId = the photo's key). */
const serializeComment = (c, { viewer, moderator, extra = {} }) => ({
  id: c.id,
  postId: c.postKey,
  parentId: c.parentId ?? null,
  text: c.text,
  mentions: Array.isArray(c.mentions) ? c.mentions : [],
  createdAt: c.createdAt,
  updatedAt: c.updatedAt ?? c.createdAt,
  author: serializeAuthor(c.author, c.authorId),
  likesCount: extra.likesCount ?? 0,
  isLiked: extra.isLiked ?? false,
  repliesCount: extra.repliesCount ?? 0,
  replies: extra.replies ?? [],
  canDelete: moderator || (!!viewer && c.authorId === viewer.id),
  canEdit: !!viewer && c.authorId === viewer.id,
});

/** Like counts, the viewer's likes and reply counts, keyed by comment id. */
async function loadCommentExtras(commentIds, viewer) {
  const map = new Map(commentIds.map(id => [id, { likesCount: 0, isLiked: false, repliesCount: 0 }]));
  if (!commentIds.length) return map;
  const [likes, mine, replies] = await Promise.all([
    db
      .select({ id: businessGalleryCommentLikes.commentId, n: sql`count(*)`.mapWith(Number) })
      .from(businessGalleryCommentLikes)
      .where(inArray(businessGalleryCommentLikes.commentId, commentIds))
      .groupBy(businessGalleryCommentLikes.commentId),
    viewer
      ? db
          .select({ id: businessGalleryCommentLikes.commentId })
          .from(businessGalleryCommentLikes)
          .where(
            and(
              inArray(businessGalleryCommentLikes.commentId, commentIds),
              eq(businessGalleryCommentLikes.userId, viewer.id)
            )
          )
      : [],
    db
      .select({ id: businessGalleryComments.parentId, n: sql`count(*)`.mapWith(Number) })
      .from(businessGalleryComments)
      .where(inArray(businessGalleryComments.parentId, commentIds))
      .groupBy(businessGalleryComments.parentId),
  ]);
  for (const r of likes) map.get(r.id).likesCount = r.n;
  for (const r of mine) map.get(r.id).isLiked = true;
  for (const r of replies) map.get(r.id).repliesCount = r.n;
  return map;
}

async function serializeComments(rows, viewer, moderator) {
  const extras = await loadCommentExtras(
    rows.map(c => c.id),
    viewer
  );
  return rows.map(c => serializeComment(c, { viewer, moderator, extra: extras.get(c.id) }));
}

const notify = (payload, what) =>
  createNotification(payload).catch(err => logger.error(`[businessGallery] ${what} notification failed: ${err.message}`));

const countLikes = async (businessId, postKey) => {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessGalleryLikes)
    .where(and(eq(businessGalleryLikes.businessId, businessId), eq(businessGalleryLikes.postKey, postKey)));
  return n;
};

const countCommentLikes = async commentId => {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessGalleryCommentLikes)
    .where(eq(businessGalleryCommentLikes.commentId, commentId));
  return n;
};

const pagination = (page, limit, total, shown) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasMore: (page - 1) * limit + shown < total,
});

/** Notification common fields — tapping one opens the photo on the business page. */
const notifyBase = (business, postKey) => ({
  type: 'business_gallery_post',
  redirectTo: `/business/${business.slug}?post=${postKey}`,
  relatedId: business.id,
});

export class BusinessGalleryService {
  /** Every photo in the gallery with its key, like / comment counts and whether `viewer` liked it. */
  static async engagement(idOrSlug, viewer) {
    const business = await loadPublicBusiness(idOrSlug);
    const posts = (business.gallery ?? []).map(url => ({ key: galleryPostKey(url), url }));
    const keys = posts.map(p => p.key);
    if (!keys.length) return { posts: [] };

    const byBusiness = (table, extra = []) =>
      and(eq(table.businessId, business.id), inArray(table.postKey, keys), ...extra);
    const [likes, comments, mine] = await Promise.all([
      db
        .select({ key: businessGalleryLikes.postKey, n: sql`count(*)`.mapWith(Number) })
        .from(businessGalleryLikes)
        .where(byBusiness(businessGalleryLikes))
        .groupBy(businessGalleryLikes.postKey),
      // Replies count too — same as the feed's comment count
      db
        .select({ key: businessGalleryComments.postKey, n: sql`count(*)`.mapWith(Number) })
        .from(businessGalleryComments)
        .where(byBusiness(businessGalleryComments))
        .groupBy(businessGalleryComments.postKey),
      viewer
        ? db
            .select({ key: businessGalleryLikes.postKey })
            .from(businessGalleryLikes)
            .where(byBusiness(businessGalleryLikes, [eq(businessGalleryLikes.userId, viewer.id)]))
        : [],
    ]);
    const likeMap = new Map(likes.map(r => [r.key, r.n]));
    const commentMap = new Map(comments.map(r => [r.key, r.n]));
    const mineSet = new Set(mine.map(r => r.key));
    return {
      posts: posts.map(p => ({
        ...p,
        likeCount: likeMap.get(p.key) ?? 0,
        commentCount: commentMap.get(p.key) ?? 0,
        likedByMe: mineSet.has(p.key),
      })),
    };
  }

  // ─── Photo likes ──────────────────────────────────────────────────────────
  /** Idempotent. */
  static async like(user, idOrSlug, postKey) {
    const business = await loadPublicBusiness(idOrSlug);
    loadPost(business, postKey);
    const inserted = await db
      .insert(businessGalleryLikes)
      .values({ businessId: business.id, postKey, userId: user.id })
      .onConflictDoNothing()
      .returning({ postKey: businessGalleryLikes.postKey });
    if (inserted.length && business.ownerId && business.ownerId !== user.id) {
      notify(
        {
          ...notifyBase(business, postKey),
          userId: business.ownerId,
          title: `${authorName(user)} liked your post`,
          message: business.name,
          metadata: { businessId: business.id, postKey, action: 'like' },
        },
        'like'
      );
    }
    return { liked: true, likeCount: await countLikes(business.id, postKey) };
  }

  /** Idempotent. Allowed even if the photo was removed (so people can take a like back). */
  static async unlike(user, idOrSlug, postKey) {
    const business = await loadPublicBusiness(idOrSlug);
    await db
      .delete(businessGalleryLikes)
      .where(
        and(
          eq(businessGalleryLikes.businessId, business.id),
          eq(businessGalleryLikes.postKey, postKey),
          eq(businessGalleryLikes.userId, user.id)
        )
      );
    return { liked: false, likeCount: await countLikes(business.id, postKey) };
  }

  // ─── Comments ─────────────────────────────────────────────────────────────
  /**
   * Top-level comments, oldest first, each with up to REPLY_PREVIEW replies and
   * its full repliesCount — the rest via listReplies. (Same as the business wall.)
   */
  static async listComments(idOrSlug, postKey, viewer, { page = 1, limit = 20 } = {}) {
    const business = await loadPublicBusiness(idOrSlug);
    loadPost(business, postKey);
    const moderator = await canModerate(business, viewer);
    const c = businessGalleryComments;
    const where = and(eq(c.businessId, business.id), eq(c.postKey, postKey), isNull(c.parentId));
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db.query.businessGalleryComments.findMany({
        where,
        with: COMMENT_WITH,
        orderBy: [c.createdAt, c.id],
        limit,
        offset,
      }),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(c).where(where),
    ]);

    let previewRows = [];
    if (rows.length) {
      const ranked = db
        .select({
          id: c.id,
          rn: sql`row_number() over (partition by ${c.parentId} order by ${c.createdAt}, ${c.id})`.as('rn'),
        })
        .from(c)
        .where(
          inArray(
            c.parentId,
            rows.map(r => r.id)
          )
        )
        .as('ranked');
      const ids = (await db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rn} <= ${REPLY_PREVIEW}`)).map(
        r => r.id
      );
      if (ids.length) {
        previewRows = await db.query.businessGalleryComments.findMany({
          where: inArray(c.id, ids),
          with: COMMENT_WITH,
          orderBy: [c.createdAt, c.id],
        });
      }
    }

    const [topLevel, replies] = await Promise.all([
      serializeComments(rows, viewer, moderator),
      serializeComments(previewRows, viewer, moderator),
    ]);
    for (const comment of topLevel) comment.replies = replies.filter(r => r.parentId === comment.id);
    return { comments: topLevel, pagination: pagination(page, limit, total, rows.length) };
  }

  /** Replies to one top-level comment, oldest first. */
  static async listReplies(idOrSlug, postKey, commentId, viewer, { page = 1, limit = 20 } = {}) {
    const business = await loadPublicBusiness(idOrSlug);
    const comment = await loadComment(business, postKey, commentId);
    const moderator = await canModerate(business, viewer);
    const where = eq(businessGalleryComments.parentId, comment.id);
    const offset = (page - 1) * limit;
    const [rows, [{ total }]] = await Promise.all([
      db.query.businessGalleryComments.findMany({
        where,
        with: COMMENT_WITH,
        orderBy: [businessGalleryComments.createdAt, businessGalleryComments.id],
        limit,
        offset,
      }),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessGalleryComments).where(where),
    ]);
    return {
      replies: await serializeComments(rows, viewer, moderator),
      pagination: pagination(page, limit, total, rows.length),
    };
  }

  /** Comment, or reply when `parentId` is given (a reply to a reply attaches to its top-level comment). */
  static async createComment(user, idOrSlug, postKey, { text, parentId = null, mentionedUserIds = [] }) {
    const business = await loadPublicBusiness(idOrSlug);
    loadPost(business, postKey);

    let parent = null;
    if (parentId) parent = await loadComment(business, postKey, parentId);
    const rootId = parent ? (parent.parentId ?? parent.id) : null;

    const [{ recent }] = await db
      .select({ recent: sql`count(*)`.mapWith(Number) })
      .from(businessGalleryComments)
      .where(
        and(
          eq(businessGalleryComments.businessId, business.id),
          eq(businessGalleryComments.authorId, user.id),
          gte(businessGalleryComments.createdAt, new Date(Date.now() - 3_600_000))
        )
      );
    if (recent >= GALLERY_COMMENTS_PER_HOUR) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, "You're commenting too often. Please try again in a while.");
    }

    const mentions = await resolveMentions(text, mentionedUserIds);
    const [row] = await db
      .insert(businessGalleryComments)
      .values({ businessId: business.id, postKey, authorId: user.id, parentId: rootId, text, mentions })
      .returning();

    // One notification per person: reply > comment on your photo > mention
    const base = { ...notifyBase(business, postKey), message: excerpt(text) };
    const meta = { businessId: business.id, postKey, commentId: row.id };
    const notified = new Set([user.id]);
    const who = authorName(user);
    if (parent && !notified.has(parent.authorId)) {
      notified.add(parent.authorId);
      notify(
        { ...base, userId: parent.authorId, title: `${who} replied to your comment on ${business.name}`, metadata: { ...meta, action: 'reply' } },
        'reply'
      );
    }
    if (business.ownerId && !notified.has(business.ownerId)) {
      notified.add(business.ownerId);
      notify(
        { ...base, userId: business.ownerId, title: `${who} commented on your post`, metadata: { ...meta, action: 'comment' } },
        'comment'
      );
    }
    for (const m of mentions) {
      if (notified.has(m.userId)) continue;
      notified.add(m.userId);
      notify(
        { ...base, userId: m.userId, title: `${who} mentioned you in a comment on ${business.name}`, metadata: { ...meta, action: 'mention' } },
        'mention'
      );
    }

    const comment = await db.query.businessGalleryComments.findFirst({
      where: eq(businessGalleryComments.id, row.id),
      with: COMMENT_WITH,
    });
    return serializeComment(comment, { viewer: user, moderator: false });
  }

  /** The commenter edits their own comment (mentions re-resolved; only newly tagged people are notified). */
  static async updateComment(user, idOrSlug, postKey, commentId, { text, mentionedUserIds = [] }) {
    const business = await loadPublicBusiness(idOrSlug);
    const comment = await loadComment(business, postKey, commentId);
    if (comment.authorId !== user.id) throw new ApiError(httpStatus.FORBIDDEN, 'You can only edit your own comments');

    const mentions = await resolveMentions(text, mentionedUserIds);
    await db
      .update(businessGalleryComments)
      .set({ text, mentions, updatedAt: new Date() })
      .where(eq(businessGalleryComments.id, comment.id));

    const before = new Set((Array.isArray(comment.mentions) ? comment.mentions : []).map(m => m.userId));
    for (const m of mentions) {
      if (before.has(m.userId) || m.userId === user.id) continue;
      notify(
        {
          ...notifyBase(business, postKey),
          message: excerpt(text),
          userId: m.userId,
          title: `${authorName(user)} mentioned you in a comment on ${business.name}`,
          metadata: { businessId: business.id, postKey, commentId: comment.id, action: 'mention' },
        },
        'mention'
      );
    }

    const updated = await db.query.businessGalleryComments.findFirst({
      where: eq(businessGalleryComments.id, comment.id),
      with: COMMENT_WITH,
    });
    const [serialized] = await serializeComments([updated], user, await canModerate(business, user));
    return serialized;
  }

  /** The commenter or a moderator; replies go with it. Returns how many were removed. */
  static async removeComment(user, idOrSlug, postKey, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const comment = await loadComment(business, postKey, commentId);
    if (comment.authorId !== user.id && !(await canModerate(business, user))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only delete your own comments');
    }
    const [{ replies }] = await db
      .select({ replies: sql`count(*)`.mapWith(Number) })
      .from(businessGalleryComments)
      .where(eq(businessGalleryComments.parentId, comment.id));
    await db.delete(businessGalleryComments).where(eq(businessGalleryComments.id, comment.id));
    return { removed: 1 + replies };
  }

  // ─── Comment likes ────────────────────────────────────────────────────────
  static async likeComment(user, idOrSlug, postKey, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const comment = await loadComment(business, postKey, commentId);
    const inserted = await db
      .insert(businessGalleryCommentLikes)
      .values({ commentId: comment.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ commentId: businessGalleryCommentLikes.commentId });
    if (inserted.length && comment.authorId !== user.id) {
      notify(
        {
          ...notifyBase(business, postKey),
          message: excerpt(comment.text),
          userId: comment.authorId,
          title: `${authorName(user)} liked your comment on ${business.name}`,
          metadata: { businessId: business.id, postKey, commentId: comment.id, action: 'comment_like' },
        },
        'comment like'
      );
    }
    return { liked: true, likesCount: await countCommentLikes(comment.id) };
  }

  static async unlikeComment(user, idOrSlug, postKey, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const comment = await loadComment(business, postKey, commentId);
    await db
      .delete(businessGalleryCommentLikes)
      .where(and(eq(businessGalleryCommentLikes.commentId, comment.id), eq(businessGalleryCommentLikes.userId, user.id)));
    return { liked: false, likesCount: await countCommentLikes(comment.id) };
  }
}
