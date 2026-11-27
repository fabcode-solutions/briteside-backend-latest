/**
 * Wall on standard business pages — works like the profile wall:
 *   • A member's message is a request ('pending'): only the author and the
 *     business's moderators see it until it's approved.
 *   • Moderators (anyone allowed to edit the business profile) approve it to
 *     make it public, or reject it (deleted). Their own posts are public at once.
 *   • The author can delete their post any time; moderators can remove any post.
 */
import httpStatus from 'http-status';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businesses,
  businessWallPosts,
  businessWallPostLikes,
  businessWallPostComments,
  businessWallCommentLikes,
  users,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import { businessByIdOrSlug } from '../utils/handles.js';
import logger from '../config/logger.js';
import { BUSINESS_PERMISSIONS } from '../config/business-permissions.js';
import { resolveBusinessAccess } from '../middlewares/businessAccess.middleware.js';
import { isBusinessPublic } from './business.service.js';
import { createNotification } from './notification.service.js';
import { assertNotBlockedByBusiness } from './businessBlock.service.js';
import { maskProfanity } from './moderation/textMasking.service.js';

/** Visitor text with profanity masked when the business turned its filter on. */
export const filterText = (business, text) =>
  business?.profanityFilter ? maskProfanity(text).masked : text;

/** Anti-spam: posts one person may leave on one wall per hour. */
export const WALL_POSTS_PER_HOUR = 5;
/** Anti-spam: comments one person may leave on one business's wall per hour. */
export const WALL_COMMENTS_PER_HOUR = 30;
/** Moderation queue size returned with the wall (oldest requests first). */
const PENDING_LIMIT = 50;

export const AUTHOR_COLUMNS = { id: true, username: true, firstName: true, lastName: true, image: true };

export const authorName = u => {
  if (!u) return 'Briteside member';
  const name = [u.firstName, u.lastName].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  return name || u.username || 'Briteside member';
};

export const serializeAuthor = (author, fallbackId) => ({
  id: author?.id ?? fallbackId,
  username: author?.username ?? null,
  name: authorName(author),
  image: author?.image ?? null,
});

const NO_ENGAGEMENT = { likeCount: 0, commentCount: 0, likedByMe: false };

const serializePost = (p, canDelete, engagement = NO_ENGAGEMENT) => ({
  id: p.id,
  text: p.text,
  status: p.status,
  createdAt: p.createdAt,
  approvedAt: p.approvedAt ?? null,
  author: serializeAuthor(p.author, p.authorId),
  canDelete,
  likeCount: engagement.likeCount,
  commentCount: engagement.commentCount,
  likedByMe: engagement.likedByMe,
});

/** Replies embedded under each top-level comment in a list (the rest via /replies). */
const REPLY_PREVIEW = 3;

/**
 * `extra` comes from loadCommentExtras: likesCount, isLiked, repliesCount, replies.
 * canDelete — the commenter or a moderator; canEdit — the commenter only.
 */
const serializeComment = (c, { viewer, moderator, extra = {} }) => ({
  id: c.id,
  postId: c.postId,
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

const excerpt = text => (text.length > 140 ? `${text.slice(0, 137)}…` : text);

/** Like / comment counts (and whether `viewer` liked) for each post id. */
async function loadEngagement(postIds, viewer) {
  const map = new Map(postIds.map(id => [id, { ...NO_ENGAGEMENT }]));
  if (!postIds.length) return map;

  const [likes, comments, mine] = await Promise.all([
    db
      .select({ postId: businessWallPostLikes.postId, n: sql`count(*)`.mapWith(Number) })
      .from(businessWallPostLikes)
      .where(inArray(businessWallPostLikes.postId, postIds))
      .groupBy(businessWallPostLikes.postId),
    db
      .select({ postId: businessWallPostComments.postId, n: sql`count(*)`.mapWith(Number) })
      .from(businessWallPostComments)
      .where(inArray(businessWallPostComments.postId, postIds))
      .groupBy(businessWallPostComments.postId),
    viewer
      ? db
          .select({ postId: businessWallPostLikes.postId })
          .from(businessWallPostLikes)
          .where(
            and(
              inArray(businessWallPostLikes.postId, postIds),
              eq(businessWallPostLikes.userId, viewer.id)
            )
          )
      : [],
  ]);
  for (const r of likes) map.get(r.postId).likeCount = r.n;
  for (const r of comments) map.get(r.postId).commentCount = r.n;
  for (const r of mine) map.get(r.postId).likedByMe = true;
  return map;
}

/** An approved post on this business's wall — the only kind that can be liked or commented on. */
async function loadApprovedPost(business, postId) {
  const post = await db.query.businessWallPosts.findFirst({
    where: and(
      eq(businessWallPosts.id, postId),
      eq(businessWallPosts.businessId, business.id),
      eq(businessWallPosts.status, 'approved')
    ),
  });
  if (!post) throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');
  return post;
}

const COMMENT_WITH = { author: { columns: AUTHOR_COLUMNS } };

/** Like counts, the viewer's likes and (for top-level comments) reply counts, keyed by comment id. */
async function loadCommentExtras(commentIds, viewer) {
  const map = new Map(
    commentIds.map(id => [id, { likesCount: 0, isLiked: false, repliesCount: 0 }])
  );
  if (!commentIds.length) return map;
  const [likes, mine, replies] = await Promise.all([
    db
      .select({ id: businessWallCommentLikes.commentId, n: sql`count(*)`.mapWith(Number) })
      .from(businessWallCommentLikes)
      .where(inArray(businessWallCommentLikes.commentId, commentIds))
      .groupBy(businessWallCommentLikes.commentId),
    viewer
      ? db
          .select({ id: businessWallCommentLikes.commentId })
          .from(businessWallCommentLikes)
          .where(
            and(
              inArray(businessWallCommentLikes.commentId, commentIds),
              eq(businessWallCommentLikes.userId, viewer.id)
            )
          )
      : [],
    db
      .select({ id: businessWallPostComments.parentId, n: sql`count(*)`.mapWith(Number) })
      .from(businessWallPostComments)
      .where(inArray(businessWallPostComments.parentId, commentIds))
      .groupBy(businessWallPostComments.parentId),
  ]);
  for (const r of likes) map.get(r.id).likesCount = r.n;
  for (const r of mine) map.get(r.id).isLiked = true;
  for (const r of replies) map.get(r.id).repliesCount = r.n;
  return map;
}

/** Serialize comment rows with their like / reply data for `viewer`. */
async function serializeComments(rows, viewer, moderator) {
  const extras = await loadCommentExtras(
    rows.map(c => c.id),
    viewer
  );
  return rows.map(c => serializeComment(c, { viewer, moderator, extra: extras.get(c.id) }));
}

/** A comment on this business's approved post `postId`, or 404. */
async function loadComment(business, postId, commentId) {
  const [row] = await db
    .select({ comment: businessWallPostComments, post: businessWallPosts })
    .from(businessWallPostComments)
    .innerJoin(businessWallPosts, eq(businessWallPosts.id, businessWallPostComments.postId))
    .where(
      and(
        eq(businessWallPostComments.id, commentId),
        eq(businessWallPostComments.postId, postId),
        eq(businessWallPosts.businessId, business.id),
        eq(businessWallPosts.status, 'approved')
      )
    );
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  return row;
}

/**
 * Users tagged in a comment: the given ids that exist AND whose @username
 * actually appears in the text (so a stale id can't tag someone silently).
 */
export async function resolveMentions(text, mentionedUserIds = []) {
  const ids = [...new Set(mentionedUserIds)].slice(0, 20);
  if (!ids.length) return [];
  const rows = await db
    .select({ userId: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, ids));
  const lower = text.toLowerCase();
  return rows.filter(u => u.username && lower.includes(`@${u.username.toLowerCase()}`));
}

const notify = (payload, what) =>
  createNotification(payload).catch(err =>
    logger.error(`[businessWall] ${what} notification failed: ${err.message}`)
  );

const countLikes = async postId => {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessWallPostLikes)
    .where(eq(businessWallPostLikes.postId, postId));
  return n;
};

export async function loadPublicBusiness(idOrSlug) {
  const business = await db.query.businesses.findFirst({
    // id, slug or an old @username (renamed businesses' links keep working)
    where: and(businessByIdOrSlug(idOrSlug), isNull(businesses.deletedAt)),
    with: { owner: { columns: { id: true, isBritesidePlus: true } } },
  });
  if (!business || !isBusinessPublic(business, business.owner)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  return business;
}

/** Whether `user` may approve / remove posts on this business's wall. */
export async function canModerate(business, user) {
  if (!user) return false;
  const access = await resolveBusinessAccess(business, user);
  return !!access?.permissions.includes(BUSINESS_PERMISSIONS.PROFILE_EDIT);
}

const withAuthor = id =>
  db.query.businessWallPosts.findFirst({
    where: eq(businessWallPosts.id, id),
    with: { author: { columns: AUTHOR_COLUMNS } },
  });

export class BusinessWallService {
  /**
   * Approved posts (paginated, newest first) for everyone, plus `pending`:
   * the whole request queue for moderators, the viewer's own requests otherwise.
   */
  static async list(idOrSlug, viewer, { page = 1, limit = 20 } = {}) {
    const business = await loadPublicBusiness(idOrSlug);
    const moderator = await canModerate(business, viewer);
    const approvedWhere = and(
      eq(businessWallPosts.businessId, business.id),
      eq(businessWallPosts.status, 'approved')
    );
    const offset = (page - 1) * limit;

    const pendingWhere = viewer
      ? and(
          eq(businessWallPosts.businessId, business.id),
          eq(businessWallPosts.status, 'pending'),
          moderator ? undefined : eq(businessWallPosts.authorId, viewer.id)
        )
      : null;

    const [rows, [{ total }], pending] = await Promise.all([
      db.query.businessWallPosts.findMany({
        where: approvedWhere,
        with: { author: { columns: AUTHOR_COLUMNS } },
        orderBy: [desc(businessWallPosts.approvedAt), desc(businessWallPosts.createdAt)],
        limit,
        offset,
      }),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessWallPosts).where(approvedWhere),
      // Only on the first page — it's the queue above the wall, not part of the feed
      pendingWhere && page === 1
        ? db.query.businessWallPosts.findMany({
            where: pendingWhere,
            with: { author: { columns: AUTHOR_COLUMNS } },
            orderBy: [businessWallPosts.createdAt],
            limit: PENDING_LIMIT,
          })
        : [],
    ]);

    const deletable = p => moderator || (!!viewer && p.authorId === viewer.id);
    const engagement = await loadEngagement(
      rows.map(p => p.id),
      viewer
    );
    return {
      posts: rows.map(p => serializePost(p, deletable(p), engagement.get(p.id))),
      pending: pending.map(p => serializePost(p, true)),
      canModerate: moderator,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
      },
    };
  }

  static async create(user, idOrSlug, text) {
    const business = await loadPublicBusiness(idOrSlug);
    if (business.pageType !== 'standard') {
      throw new ApiError(httpStatus.CONFLICT, 'This business page does not have a wall');
    }

    const [{ recent }] = await db
      .select({ recent: sql`count(*)`.mapWith(Number) })
      .from(businessWallPosts)
      .where(
        and(
          eq(businessWallPosts.businessId, business.id),
          eq(businessWallPosts.authorId, user.id),
          gte(businessWallPosts.createdAt, new Date(Date.now() - 3_600_000))
        )
      );
    if (recent >= WALL_POSTS_PER_HOUR) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'You are posting too often. Try again later.');
    }

    // The business's own team posts straight to the wall. Visitors follow the
    // business's privacy setting: 'everyone' publishes, 'approval' asks first, 'off' refuses.
    const isTeam = await canModerate(business, user);
    if (!isTeam) {
      if (business.wallPosts === 'off') {
        throw new ApiError(httpStatus.FORBIDDEN, "This business isn't accepting wall posts");
      }
      await assertNotBlockedByBusiness(business.id, user.id, "You can't post on this business's wall");
    }
    const autoApprove = isTeam || business.wallPosts === 'everyone';
    const [row] = await db
      .insert(businessWallPosts)
      .values({
        businessId: business.id,
        authorId: user.id,
        text: !isTeam ? filterText(business, text) : text,
        status: autoApprove ? 'approved' : 'pending',
        approvedAt: autoApprove ? new Date() : null,
      })
      .returning();

    if (!autoApprove) {
      createNotification({
        userId: business.ownerId,
        title: `New wall post request on ${business.name}`,
        message: excerpt(row.text),
        type: 'business_wall_post',
        redirectTo: `/business/${business.slug}`,
        relatedId: row.id,
        metadata: { businessId: business.id, postId: row.id, status: 'pending', kind: 'pendingApproval' },
      }).catch(err => logger.error(`[businessWall] request notification failed: ${err.message}`));
    } else if (!isTeam) {
      // Published straight away (wall open to everyone) — let the business know
      createNotification({
        userId: business.ownerId,
        title: `${authorName(user)} posted on ${business.name}'s wall`,
        message: excerpt(row.text),
        type: 'business_wall_post',
        redirectTo: `/business/${business.slug}`,
        relatedId: row.id,
        metadata: { businessId: business.id, postId: row.id, status: 'approved', kind: 'newPost' },
      }).catch(err => logger.error(`[businessWall] post notification failed: ${err.message}`));
    }

    return serializePost(await withAuthor(row.id), true);
  }

  /** Moderators: 'approved' publishes the request; 'rejected' deletes it. */
  static async moderate(user, idOrSlug, postId, status) {
    const business = await loadPublicBusiness(idOrSlug);
    if (!(await canModerate(business, user))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Only the business can approve wall posts');
    }
    const post = await db.query.businessWallPosts.findFirst({
      where: and(eq(businessWallPosts.id, postId), eq(businessWallPosts.businessId, business.id)),
    });
    if (!post) throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');

    if (status === 'rejected') {
      await db.delete(businessWallPosts).where(eq(businessWallPosts.id, post.id));
      return null;
    }
    if (post.status === 'approved') {
      const engagement = await loadEngagement([post.id], user);
      return serializePost(await withAuthor(post.id), true, engagement.get(post.id));
    }

    // Guard against a concurrent reject/delete: only a still-pending row is approved
    const [updated] = await db
      .update(businessWallPosts)
      .set({ status: 'approved', approvedAt: new Date() })
      .where(and(eq(businessWallPosts.id, post.id), eq(businessWallPosts.status, 'pending')))
      .returning({ id: businessWallPosts.id });
    if (!updated) throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');

    if (post.authorId !== user.id) {
      createNotification({
        userId: post.authorId,
        title: `${business.name} approved your wall post`,
        message: excerpt(post.text),
        type: 'business_wall_post',
        redirectTo: `/business/${business.slug}`,
        relatedId: post.id,
        metadata: { businessId: business.id, postId: post.id, status: 'approved' },
      }).catch(err => logger.error(`[businessWall] approval notification failed: ${err.message}`));
    }
    return serializePost(await withAuthor(post.id), true);
  }

  static async remove(user, idOrSlug, postId) {
    const business = await loadPublicBusiness(idOrSlug);
    const post = await db.query.businessWallPosts.findFirst({
      where: and(eq(businessWallPosts.id, postId), eq(businessWallPosts.businessId, business.id)),
      columns: { id: true, authorId: true },
    });
    if (!post) throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');
    if (post.authorId !== user.id && !(await canModerate(business, user))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only remove your own posts');
    }
    await db.delete(businessWallPosts).where(eq(businessWallPosts.id, post.id));
  }

  // ─── Likes ────────────────────────────────────────────────────────────────
  /** Idempotent: liking twice is a no-op. Notifies the post's author on a new like. */
  static async like(user, idOrSlug, postId) {
    const business = await loadPublicBusiness(idOrSlug);
    const post = await loadApprovedPost(business, postId);

    const inserted = await db
      .insert(businessWallPostLikes)
      .values({ postId: post.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ postId: businessWallPostLikes.postId });

    if (inserted.length && post.authorId !== user.id) {
      createNotification({
        userId: post.authorId,
        title: `${authorName(user)} liked your post on ${business.name}`,
        message: excerpt(post.text),
        type: 'business_wall_post',
        redirectTo: `/business/${business.slug}`,
        relatedId: post.id,
        metadata: { businessId: business.id, postId: post.id, action: 'like' },
      }).catch(err => logger.error(`[businessWall] like notification failed: ${err.message}`));
    }
    return { liked: true, likeCount: await countLikes(post.id) };
  }

  /** Idempotent: unliking a post you haven't liked is a no-op. */
  static async unlike(user, idOrSlug, postId) {
    const business = await loadPublicBusiness(idOrSlug);
    const post = await loadApprovedPost(business, postId);
    await db
      .delete(businessWallPostLikes)
      .where(and(eq(businessWallPostLikes.postId, post.id), eq(businessWallPostLikes.userId, user.id)));
    return { liked: false, likeCount: await countLikes(post.id) };
  }

  // ─── Comments ─────────────────────────────────────────────────────────────
  /**
   * Top-level comments, oldest first, each with up to REPLY_PREVIEW replies
   * (oldest first) and its full repliesCount — load the rest via listReplies.
   */
  static async listComments(idOrSlug, postId, viewer, { page = 1, limit = 20 } = {}) {
    const business = await loadPublicBusiness(idOrSlug);
    const post = await loadApprovedPost(business, postId);
    const moderator = await canModerate(business, viewer);
    const where = and(
      eq(businessWallPostComments.postId, post.id),
      isNull(businessWallPostComments.parentId)
    );
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db.query.businessWallPostComments.findMany({
        where,
        with: COMMENT_WITH,
        orderBy: [businessWallPostComments.createdAt, businessWallPostComments.id],
        limit,
        offset,
      }),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessWallPostComments).where(where),
    ]);

    // First REPLY_PREVIEW replies of each comment on this page
    let previewRows = [];
    if (rows.length) {
      const c = businessWallPostComments;
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
      const ids = (
        await db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rn} <= ${REPLY_PREVIEW}`)
      ).map(r => r.id);
      if (ids.length) {
        previewRows = await db.query.businessWallPostComments.findMany({
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
    for (const comment of topLevel) {
      comment.replies = replies.filter(r => r.parentId === comment.id);
    }

    return {
      comments: topLevel,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
      },
    };
  }

  /** Replies to one top-level comment, oldest first. */
  static async listReplies(idOrSlug, postId, commentId, viewer, { page = 1, limit = 20 } = {}) {
    const business = await loadPublicBusiness(idOrSlug);
    const { comment } = await loadComment(business, postId, commentId);
    const moderator = await canModerate(business, viewer);
    const where = eq(businessWallPostComments.parentId, comment.id);
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db.query.businessWallPostComments.findMany({
        where,
        with: COMMENT_WITH,
        orderBy: [businessWallPostComments.createdAt, businessWallPostComments.id],
        limit,
        offset,
      }),
      db.select({ total: sql`count(*)`.mapWith(Number) }).from(businessWallPostComments).where(where),
    ]);

    return {
      replies: await serializeComments(rows, viewer, moderator),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
      },
    };
  }

  /**
   * Comment on a post, or reply when `parentId` is given. Replying to a reply
   * attaches to its top-level comment (one level of nesting, like the feed).
   */
  static async createComment(user, idOrSlug, postId, { text, parentId = null, mentionedUserIds = [] }) {
    const business = await loadPublicBusiness(idOrSlug);
    const post = await loadApprovedPost(business, postId);
    // Visitors: not blocked by the business, and its profanity filter applies
    if (!(await canModerate(business, user))) {
      await assertNotBlockedByBusiness(business.id, user.id, "You can't comment on this business's wall");
      text = filterText(business, text);
    }

    let parent = null;
    if (parentId) {
      ({ comment: parent } = await loadComment(business, post.id, parentId));
    }
    const rootId = parent ? (parent.parentId ?? parent.id) : null;

    const [{ recent }] = await db
      .select({ recent: sql`count(*)`.mapWith(Number) })
      .from(businessWallPostComments)
      .innerJoin(businessWallPosts, eq(businessWallPosts.id, businessWallPostComments.postId))
      .where(
        and(
          eq(businessWallPosts.businessId, business.id),
          eq(businessWallPostComments.authorId, user.id),
          gte(businessWallPostComments.createdAt, new Date(Date.now() - 3_600_000))
        )
      );
    if (recent >= WALL_COMMENTS_PER_HOUR) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'You are commenting too often. Try again later.');
    }

    const mentions = await resolveMentions(text, mentionedUserIds);
    const [row] = await db
      .insert(businessWallPostComments)
      .values({ postId: post.id, authorId: user.id, parentId: rootId, text, mentions })
      .returning();

    // One notification per person: reply > comment on your post > mention
    const base = {
      type: 'business_wall_post',
      redirectTo: `/business/${business.slug}`,
      relatedId: post.id,
      message: excerpt(text),
    };
    const meta = { businessId: business.id, postId: post.id, commentId: row.id };
    const notified = new Set([user.id]);
    const who = authorName(user);
    if (parent && !notified.has(parent.authorId)) {
      notified.add(parent.authorId);
      notify(
        {
          ...base,
          userId: parent.authorId,
          title: `${who} replied to your comment on ${business.name}`,
          metadata: { ...meta, action: 'reply' },
        },
        'reply'
      );
    }
    if (!notified.has(post.authorId)) {
      notified.add(post.authorId);
      notify(
        {
          ...base,
          userId: post.authorId,
          title: `${who} commented on your post on ${business.name}`,
          metadata: { ...meta, action: 'comment' },
        },
        'comment'
      );
    }
    for (const m of mentions) {
      if (notified.has(m.userId)) continue;
      notified.add(m.userId);
      notify(
        {
          ...base,
          userId: m.userId,
          title: `${who} mentioned you in a comment on ${business.name}`,
          metadata: { ...meta, action: 'mention' },
        },
        'mention'
      );
    }

    const comment = await db.query.businessWallPostComments.findFirst({
      where: eq(businessWallPostComments.id, row.id),
      with: COMMENT_WITH,
    });
    return serializeComment(comment, { viewer: user, moderator: false });
  }

  /** The commenter edits their own comment's text (mentions are re-resolved). */
  static async updateComment(user, idOrSlug, postId, commentId, { text, mentionedUserIds = [] }) {
    const business = await loadPublicBusiness(idOrSlug);
    const { comment } = await loadComment(business, postId, commentId);
    if (comment.authorId !== user.id) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only edit your own comments');
    }
    if (!(await canModerate(business, user))) text = filterText(business, text);

    const mentions = await resolveMentions(text, mentionedUserIds);
    await db
      .update(businessWallPostComments)
      .set({ text, mentions, updatedAt: new Date() })
      .where(eq(businessWallPostComments.id, comment.id));

    // Only people newly tagged by this edit hear about it
    const before = new Set((Array.isArray(comment.mentions) ? comment.mentions : []).map(m => m.userId));
    for (const m of mentions) {
      if (before.has(m.userId) || m.userId === user.id) continue;
      notify(
        {
          type: 'business_wall_post',
          redirectTo: `/business/${business.slug}`,
          relatedId: postId,
          message: excerpt(text),
          userId: m.userId,
          title: `${authorName(user)} mentioned you in a comment on ${business.name}`,
          metadata: { businessId: business.id, postId, commentId: comment.id, action: 'mention' },
        },
        'mention'
      );
    }

    const updated = await db.query.businessWallPostComments.findFirst({
      where: eq(businessWallPostComments.id, comment.id),
      with: COMMENT_WITH,
    });
    const moderator = await canModerate(business, user);
    const [serialized] = await serializeComments([updated], user, moderator);
    return serialized;
  }

  /** The commenter or a moderator can remove a comment (its replies go with it). */
  static async removeComment(user, idOrSlug, postId, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const { comment } = await loadComment(business, postId, commentId);
    if (comment.authorId !== user.id && !(await canModerate(business, user))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only remove your own comments');
    }
    const [{ replies }] = await db
      .select({ replies: sql`count(*)`.mapWith(Number) })
      .from(businessWallPostComments)
      .where(eq(businessWallPostComments.parentId, comment.id));
    await db.delete(businessWallPostComments).where(eq(businessWallPostComments.id, comment.id));
    // Lets the client keep the post's comment count right
    return { removed: 1 + replies };
  }

  // ─── Comment likes ────────────────────────────────────────────────────────
  static async likeComment(user, idOrSlug, postId, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const { comment } = await loadComment(business, postId, commentId);
    const inserted = await db
      .insert(businessWallCommentLikes)
      .values({ commentId: comment.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ commentId: businessWallCommentLikes.commentId });

    if (inserted.length && comment.authorId !== user.id) {
      notify(
        {
          type: 'business_wall_post',
          redirectTo: `/business/${business.slug}`,
          relatedId: postId,
          message: excerpt(comment.text),
          userId: comment.authorId,
          title: `${authorName(user)} liked your comment on ${business.name}`,
          metadata: { businessId: business.id, postId, commentId: comment.id, action: 'comment_like' },
        },
        'comment like'
      );
    }
    return { liked: true, likesCount: await countCommentLikes(comment.id) };
  }

  static async unlikeComment(user, idOrSlug, postId, commentId) {
    const business = await loadPublicBusiness(idOrSlug);
    const { comment } = await loadComment(business, postId, commentId);
    await db
      .delete(businessWallCommentLikes)
      .where(
        and(eq(businessWallCommentLikes.commentId, comment.id), eq(businessWallCommentLikes.userId, user.id))
      );
    return { liked: false, likesCount: await countCommentLikes(comment.id) };
  }
}

async function countCommentLikes(commentId) {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessWallCommentLikes)
    .where(eq(businessWallCommentLikes.commentId, commentId));
  return n;
}
