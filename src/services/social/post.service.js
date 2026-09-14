import { db } from '../../db/index.js';
import {
  users,
  posts,
  postLikes,
  postShares,
  postReposts,
  postUserComments,
  savedPosts,
  userHiddenPosts,
  socialProfiles,
  postTags,
  mentions,
  interestCategories,
  pinnedPosts,
  postCollaborators,
  userPostOrder,
  postShopProducts,
  shopProducts,
  postTabLinks,
} from '../../db/schema/index.js';
import { SocialAnalyticsService } from './socialAnalytics.service.js';
import {
  eq,
  and,
  desc,
  asc,
  sql,
  or,
  isNull,
  gt,
  inArray,
  notInArray,
  count,
  max,
  ne,
} from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';
import {
  MediaModerationService,
  MEDIA_ENTITY,
  postsModerationGate,
  postsModerationGateStrict,
  attachPostModerationStatuses,
  HELD_FROM_OTHERS,
} from '../moderation/mediaModeration.service.js';
import FileManagementService from '../fileManagement.service.js';
import { createNotification } from '../notification.service.js';
import { BlockService } from './block.service.js';
import { FollowService } from './follow.service.js';
import { StoryService } from './story.service.js';
import { sanitizeLinkButton } from '../../utils/link-button.js';

/** Products a single post may link to. Mirrored in the create-post drawer. */
const MAX_LINKED_PRODUCTS = 3;
const MAX_TAB_LINKS_FREE = 5;
const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Post management service for social posts
 */
export class PostService {
  // Sanitizes the optional CTA link button stored in post.settings.linkButton.
  // Plus-only feature — throws 403 if a non-Plus user tries to set one.
  static _sanitizeLinkButton(linkButton, isPlus) {
    return sanitizeLinkButton(linkButton, isPlus, 'post');
  }

  /**
   * Shared tail for post-listing endpoints: applies media moderation 
   * (approved/flagged/rejected gating + stamping) then, if the viewer has
   * profanityFilterEnabled on, substitutes masked captions for flagged posts.
   */
  static async _finalizePostList(mapped, viewerId) {
    const moderated = await MediaModerationService.applyPostModeration(mapped, viewerId);
    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedText(moderated, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled,
    });
  }

  /**
   * Add tags to a post (for personalized feed)
   * @param {string} postId - The post's ID
   * @param {string[]} tagCategoryIds - Array of interest category IDs (tags)
   * @param {string} [source='manual'] - Source of tags ('manual', 'ai', etc)
   */
  // Add this static helper inside PostService class
  static async notifyCoAuthors(postId, postOwnerId, notificationData) {
    const coAuthors = await db.query.postCollaborators.findMany({
      where: and(eq(postCollaborators.postId, postId), eq(postCollaborators.status, 'accepted')),
      columns: { collaboratorId: true },
    });

    for (const { collaboratorId } of coAuthors) {
      // Skip the action performer and the post owner (already notified separately)
      if (collaboratorId !== notificationData.excludeUserId && collaboratorId !== postOwnerId) {
        await createNotification({
          userId: collaboratorId,
          ...notificationData,
        });
      }
    }
  }
  static async addTagsToPost(postId, tagCategoryIds, source = 'manual') {
    if (!postId || !Array.isArray(tagCategoryIds)) return;
    // Remove existing tags for this post (if updating)
    await db.delete(postTags).where(eq(postTags.postId, postId));
    if (tagCategoryIds.length === 0) return;
    // Insert new tags
    const tagRows = tagCategoryIds.map(categoryId => ({
      postId,
      categoryId,
      confidence: 100, // default confidence
      source,
    }));
    await db.insert(postTags).values(tagRows).returning();
  }

  /**
   * Create a new post
   * @param {string} userId - The user's ID
   * @param {object} postData - Post data
   */
  /**
   * Validates the shop products a post links to and returns them in the
   * author's chosen order.
   *
   * Same Plus gate as the URL link button — a post carries one or the other,
   * never both. Products must belong to the author and still be live; linking
   * someone else's product, or a deleted one, is rejected rather than silently
   * dropped, so the author knows the link didn't save.
   */
  static async _resolveLinkedProducts(userId, linkedProductIds, { isPlus, hasLinkButton }) {
    if (!Array.isArray(linkedProductIds) || linkedProductIds.length === 0) return [];

    if (!isPlus) {
      throw new ApiError(
        403,
        'Linking shop products to a post is a BriteSide Plus feature. Upgrade to add one.'
      );
    }
    if (hasLinkButton) {
      throw new ApiError(400, 'A post can link either a URL or shop products, not both');
    }

    const uniqueIds = [...new Set(linkedProductIds)];
    if (uniqueIds.length > MAX_LINKED_PRODUCTS) {
      throw new ApiError(400, `You can link up to ${MAX_LINKED_PRODUCTS} products to a post`);
    }

    const owned = await db.query.shopProducts.findMany({
      where: and(
        inArray(shopProducts.id, uniqueIds),
        eq(shopProducts.userId, userId),
        isNull(shopProducts.deletedAt)
      ),
      columns: { id: true },
    });

    if (owned.length !== uniqueIds.length) {
      throw new ApiError(400, 'One or more of those products are not available in your shop');
    }

    // The order the author picked is the order they render in.
    return uniqueIds;
  }

  /** Replaces a post's linked products with the given ordered list. */
  static async _writeLinkedProducts(postId, productIds) {
    await db.delete(postShopProducts).where(eq(postShopProducts.postId, postId));
    if (productIds.length === 0) return;

    await db
      .insert(postShopProducts)
      .values(productIds.map((productId, index) => ({ postId, productId, position: index })));
  }

  /**
   * Linked products for a page of posts, keyed by postId.
   *
   * 
   * Soft-deleted products are filtered out here rather than at write time, so a
   * product deleted after posting simply stops appearing.
   */
  static async _linkedProductsByPost(postIds) {
    const byPost = new Map();
    if (!Array.isArray(postIds) || postIds.length === 0) return byPost;

    const rows = await db.query.postShopProducts.findMany({
      where: inArray(postShopProducts.postId, postIds),
      orderBy: asc(postShopProducts.position),
      with: {
        product: {
          columns: {
            id: true,
            userId: true,
            title: true,
            priceCents: true,
            coverUrl: true,
            coverType: true,
            buttonAction: true,
            deletedAt: true,
          },
        },
      },
    });

    for (const row of rows) {
      if (!row.product || row.product.deletedAt) continue;
      if (!byPost.has(row.postId)) byPost.set(row.postId, []);

      const { deletedAt: _deletedAt, ...product } = row.product;
      byPost.get(row.postId).push(product);
    }

    return byPost;
  }

  static async createPost(
    userId,
    {
      caption,
      mediaUrls,
      mediaTypes,
      aspectRatios,
      location,
      tags,
      visibility,
      settings,
      mentionedUserIds,
      scheduledAt,
      collaboratorIds,
      linkedProductIds,
      isPlus,
    }
  ) {
    const LINK_REGEX = /(https?:\/\/|www\.)\S+/i;
    if (caption && LINK_REGEX.test(caption)) {
      throw new ApiError(400, 'Links are not allowed in caption');
    }

    const YOUTUBE_HOST_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;
    if (Array.isArray(mediaTypes)) {
      mediaTypes.forEach((type, i) => {
        if (type === 'youtube' && !YOUTUBE_HOST_REGEX.test(mediaUrls?.[i] || '')) {
          throw new ApiError(400, 'Invalid YouTube URL');
        }
      });
    }

    const VALID_VISIBILITY = ['public', 'followers', 'private'];
    const resolvedVisibility = VALID_VISIBILITY.includes(visibility) ? visibility : 'public';
    const mergedSettings = {
      commentsDisabled: false,
      hideLikes: false,
      ...settings,
      linkButton: PostService._sanitizeLinkButton(settings?.linkButton, isPlus),
    };

    // Validated before the insert so an invalid product list fails the whole
    // create instead of leaving a post whose links silently went missing.
    const resolvedProductIds = await PostService._resolveLinkedProducts(userId, linkedProductIds, {
      isPlus,
      hasLinkButton: !!mergedSettings.linkButton,
    });

    let tagNames = [];
    if (Array.isArray(tags) && tags.length > 0) {
      const tagCategories = await db.query.interestCategories.findMany({
        where: inArray(interestCategories.id, tags),
      });
      tagNames = tagCategories.map(cat => cat.name);
    }

    const isScheduled = !!scheduledAt;
    const scheduledDate = isScheduled ? new Date(scheduledAt) : null;
    if (isScheduled && isNaN(scheduledDate.getTime())) {
      throw new ApiError(400, 'Invalid scheduledAt date');
    }
    if (isScheduled && scheduledDate <= new Date()) {
      throw new ApiError(400, 'scheduledAt must be in the future');
    }

    const captionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.POST,
      entityCreatorId: userId,
      texts: [caption],
    });

    const [post] = await db
      .insert(posts)
      .values({
        userId,
        caption,
        mediaUrls: mediaUrls || [],
        mediaTypes: mediaTypes || [],
        aspectRatios: aspectRatios || [],
        location,
        tags: tagNames,
        visibility: resolvedVisibility,
        settings: mergedSettings,
        status: isScheduled ? 'scheduled' : 'published',
        scheduledAt: scheduledDate,
      })
      .returning();

    const urls = post.mediaUrls || [];
    const types = post.mediaTypes || [];
    await MediaModerationService.adoptMediaVerdicts({
      entityType: MEDIA_ENTITY.POST,
      entityId: post.id,
      userId,
      imageUrls: urls.filter((_, i) => types[i] !== 'video' && types[i] !== 'youtube'),
      videoUrls: urls.filter((_, i) => types[i] === 'video'),
    });

    await TextModerationService.recordIfFlagged(captionModeration, {
      entityType: TEXT_ENTITY.POST,
      entityId: post.id,
      userId,
      fieldNames: ['caption'],
      texts: [caption],
    });

    if (resolvedProductIds.length > 0) {
      await PostService._writeLinkedProducts(post.id, resolvedProductIds);
    }

    if (Array.isArray(tags) && tags.length > 0) {
      await PostService.addTagsToPost(post.id, tags, 'manual');
    }
    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const mentionedUsers = await db.query.users.findMany({
        where: inArray(users.id, mentionedUserIds),
        columns: { id: true, username: true, allowTagging: true },
      });

      const allowedUserIds = mentionedUsers.filter(u => u.allowTagging !== false).map(u => u.id);

      if (allowedUserIds.length > 0) {
        const mentionRows = allowedUserIds.map(mentionedUserId => ({
          sourceType: 'post',
          sourceId: post.id,
          mentionedUserId,
          mentionedByUserId: userId,
        }));
        await db.insert(mentions).values(mentionRows);

        const poster = await db.query.users.findFirst({ where: eq(users.id, userId) });

        for (const mentionedUserId of allowedUserIds) {
          if (mentionedUserId !== userId) {
            try {
              await createNotification({
                userId: mentionedUserId,
                title: 'You were mentioned',
                message: `${poster?.username || 'Someone'} mentioned you in a post`,
                type: 'social_update',
                relatedId: post.id,
                redirectTo: `/feed/post/${post.id}`,
                metadata: {
                  postId: post.id,
                  mentionedByUserId: userId,
                  mentionedByUsername: poster?.username,
                },
              });
            } catch (err) {
              console.warn('Failed to create mention notification', err);
            }
          }
        }
      }
    }

    // Scheduled posts don't count until published
    if (!isScheduled) {
      await db
        .update(socialProfiles)
        .set({
          postsCount: sql`${socialProfiles.postsCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, userId));
    }
    // Invite collaborators (pending until they accept — post only counts
    // toward their profile/postsCount once accepted)
    if (Array.isArray(collaboratorIds) && collaboratorIds.length > 0) {
      const uniqueIds = [...new Set(collaboratorIds)].filter(id => id !== userId);

      if (uniqueIds.length > 5) {
        throw new ApiError(400, 'A post can have at most 5 collaborators');
      }

      if (uniqueIds.length > 0) {
        const candidateUsers = await db.query.users.findMany({
          where: inArray(users.id, uniqueIds),
          columns: { id: true },
        });
        const validIds = new Set(candidateUsers.map(u => u.id));

        const allowedCollaboratorIds = [];
        for (const id of uniqueIds) {
          if (!validIds.has(id)) continue;
          const isBlocked = await BlockService.isBlocked(userId, id);
          if (!isBlocked) allowedCollaboratorIds.push(id);
        }

        if (allowedCollaboratorIds.length > 0) {
          await db.insert(postCollaborators).values(
            allowedCollaboratorIds.map(collaboratorId => ({
              postId: post.id,
              collaboratorId,
              invitedById: userId,
            }))
          );

          const poster = await db.query.users.findFirst({ where: eq(users.id, userId) });

          for (const collaboratorId of allowedCollaboratorIds) {
            try {
              await createNotification({
                userId: collaboratorId,
                title: 'Collaboration invite',
                message: `${poster?.username || 'Someone'} invited you to collaborate on a post`,
                type: 'social_update',
                relatedId: post.id,
                redirectTo: `/feed/collaborations/pending`,
                metadata: {
                  postId: post.id,
                  invitedById: userId,
                  invitedByUsername: poster?.username,
                },
              });
            } catch (err) {
              console.warn('Failed to create collaboration invite notification', err);
            }
          }
        }
      }
    }

    return await PostService.getPost(post.id, userId);
  }

  /**
   * Get posts for a user
   * @param {string} userId - The post owner's ID
   * @param {string} viewerId - The viewer's ID
   * @param {object} options - Query options
   */

  /**
 * Merged, ordered {type,id} list for the arrange grid. Order comes from the
 * shared user_post_order table; anything without a row there falls back to
 * newest-first — same fallback the posts-only path used.
 *
 * Loaded and sorted in memory (one profile's posts + links) rather than a
 * single SQL UNION — this file already does the equivalent for pinned posts
 * above, so it's consistent with the existing scale assumptions here.
 */
  static async _orderedTabItems(userId, matchingPosts) {
    const [linkRows, orderRows] = await Promise.all([
      db.query.postTabLinks.findMany({
        where: eq(postTabLinks.userId, userId),
        columns: { id: true, createdAt: true, updatedAt: true },
      }),
      db.query.userPostOrder.findMany({
        where: eq(userPostOrder.userId, userId),
        columns: { itemType: true, postId: true, linkId: true, displayOrder: true },
      }),
    ]);

    const orderMap = new Map();
    for (const row of orderRows) {
      const key = row.itemType === 'post' ? `post:${row.postId}` : `link:${row.linkId}`;
      orderMap.set(key, row.displayOrder);
    }

    // Editing a post/link bumps its updatedAt (see updatePost/updatePostTabLink)
    // — treat that the same as a fresh post for ranking purposes, so an edit
    // brings an item back to the top instead of leaving it stuck wherever it
    // was created.
    const sortDate = item =>
      Math.max(new Date(item.createdAt).getTime(), new Date(item.updatedAt).getTime());
    // 1s buffer: createdAt/updatedAt both come from defaultNow() on insert and
    // can differ by a hair even with no real edit — only a later, explicit
    // update (see updatePost's setData.updatedAt = new Date()) should count.
    const wasEditedSinceCreated = item =>
      new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime() > 1000;

    const candidates = [
      ...matchingPosts.map(p => ({
        type: 'post',
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt ?? p.createdAt,
        order: orderMap.get(`post:${p.id}`),
      })),
      ...linkRows.map(l => ({
        type: 'link',
        id: l.id,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt ?? l.createdAt,
        order: orderMap.get(`link:${l.id}`),
      })),
    ];

    // "Arrange Grid" saves an explicit displayOrder for every item visible at
    // save time (see reorderPostTabItems) — it's a curation tool for those
    // specific items, not a freeze on the whole grid. So anything without a
    // row (posted after the last arrange, or never arranged at all) is newer
    // than that arrangement by definition and ranks above it, newest first.
    // An item that WAS arranged but has since been edited is treated the same
    // way — the edit makes it fresh again, so it shouldn't stay pinned to its
    // old manual spot. Only within each of those two groups does order/date
    // break ties.
    candidates.sort((a, b) => {
      const aHasOrder = a.order !== undefined && !wasEditedSinceCreated(a);
      const bHasOrder = b.order !== undefined && !wasEditedSinceCreated(b);
      if (aHasOrder !== bHasOrder) return aHasOrder ? 1 : -1;
      if (aHasOrder && a.order !== b.order) return a.order - b.order;
      return sortDate(b) - sortDate(a);
    });

    return candidates;
  }
  static async getPosts(userId, viewerId, options = {}) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      mediaType = null,
      hasMedia = null,
      cursor = null,
      excludeCoverPosts = false,
    } = options;

    // Cursor pagination is based on createdAt and is incompatible with
    // displayOrder (manual order has no relation to createdAt). Ignore the
    // cursor in displayOrder mode so posts aren't wrongly filtered out.
    const useCursor = !!cursor && sortBy !== 'displayOrder';
    const isFirstPage = !useCursor && page === 1;
    const offset = useCursor ? 0 : (page - 1) * limit;

    if (viewerId !== userId) {
      const isBlocked = await BlockService.isBlocked(viewerId, userId);
      if (isBlocked) {
        throw new ApiError(403, 'Cannot view posts from this user');
      }
    }

    // A profile shows posts the user authored AND posts where they're an
    // accepted collaborator
    let whereConditions = [
      or(
        eq(posts.userId, userId),
        sql`EXISTS (
          SELECT 1 FROM post_collaborators pc
          WHERE pc.post_id = ${posts.id}
            AND pc.collaborator_id = ${userId}
            AND pc.status = 'accepted'
        )`
      ),
      eq(posts.isArchived, false),
      eq(posts.isStatusPost, false),
      eq(posts.status, 'published'),
      or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date())),
      postsModerationGate(viewerId),
    ];

    // Visibility evaluated against the actual author (posts.userId), since
    // results may include collab posts authored by someone else
    if (viewerId !== userId) {
      whereConditions.push(sql`(
        ${posts.userId} = ${viewerId}
        OR ${posts.visibility} = 'public'
        OR (
          ${posts.visibility} = 'followers'
          AND EXISTS (
            SELECT 1 FROM user_follows uf
            WHERE uf.follower_id = ${viewerId} AND uf.following_id = ${posts.userId}
          )
        )
      )`);

      whereConditions.push(sql`NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = ${viewerId} AND ub.blocked_id = ${posts.userId})
           OR (ub.blocker_id = ${posts.userId} AND ub.blocked_id = ${viewerId})
      )`);

      // On someone else's profile, held posts (removed/pending/shadowed) must be
      // hidden even from their author — a rejected collaborated post must not
      // surface just because the viewer authored it.
      whereConditions.push(postsModerationGateStrict());
    }

    if (useCursor) {
      whereConditions.push(
        sortOrder === 'desc'
          ? sql`${posts.createdAt} < ${cursor}`
          : sql`${posts.createdAt} > ${cursor}`
      );
    }

    if (hasMedia === true) {
      whereConditions.push(sql`array_length(${posts.mediaUrls}, 1) > 0`);
    } else if (hasMedia === false) {
      whereConditions.push(
        sql`array_length(${posts.mediaUrls}, 1) = 0 OR ${posts.mediaUrls} IS NULL`
      );
    }

    if (mediaType) {
      whereConditions.push(sql`${posts.mediaTypes} @> ${JSON.stringify([mediaType])}`);
    }

    if (excludeCoverPosts) {
      whereConditions.push(eq(posts.isCoverPost, false));
    }

    let pinnedPostsData = [];
    let pinnedLinksData = [];
    const pinOrderMap = new Map(); // keyed by "post:<id>" or "link:<id>"
    const pinRows = await db.query.pinnedPosts.findMany({
      where: eq(pinnedPosts.userId, userId),
      columns: { itemType: true, postId: true, linkId: true, pinOrder: true },
      orderBy: asc(pinnedPosts.pinOrder),
    });
    const pinnedPostIds = pinRows.filter(r => r.itemType === 'post').map(r => r.postId);
    const pinnedLinkIds = pinRows.filter(r => r.itemType === 'link').map(r => r.linkId);
    pinRows.forEach(r => {
      const key = r.itemType === 'post' ? `post:${r.postId}` : `link:${r.linkId}`;
      pinOrderMap.set(key, r.pinOrder);
    });

    if (pinnedPostIds.length > 0) {
      whereConditions.push(notInArray(posts.id, pinnedPostIds));
    }

    const postRelations = {
      user: {
        columns: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          image: true,
          isEmailVerified: true,
          isBritesidePlus: true,
        },
        with: {
          socialProfile: { columns: { bio: true, isPublic: true, coverImages: true } },
        },
      },
      likes: { where: eq(postLikes.userId, viewerId), columns: { id: true } },
      saves: { where: eq(savedPosts.userId, viewerId), columns: { id: true } },
      reposts: { where: eq(postReposts.userId, viewerId), columns: { id: true } },
      tags: { with: { category: true } },
    };

    let userPosts;
    let hasMore;

    const [[{ total }]] = await Promise.all([
      db
        .select({ total: count() })
        .from(posts)
        .where(and(...whereConditions)),
    ]);

    let pageLinks = [];
    let mergedTotal = null;
    let pageItemOrder = [];

    if (sortBy === 'displayOrder') {
      // Unpaginated id+createdAt for every matching post — needed so the merge
      // step can interleave posts with links before slicing the page.
      const matchingPosts = await db
        .select({ id: posts.id, createdAt: posts.createdAt, updatedAt: posts.updatedAt })
        .from(posts)
        .where(and(...whereConditions));

      const ordered = await PostService._orderedTabItems(userId, matchingPosts);
      mergedTotal = ordered.length;
      hasMore = ordered.length > offset + limit;
      const pageItems = ordered.slice(offset, offset + limit);
      pageItemOrder = pageItems.map(i => ({ type: i.type, id: i.id }));
      const pagePostIds = pageItems.filter(i => i.type === 'post').map(i => i.id);
      const pageLinkIds = pageItems.filter(i => i.type === 'link').map(i => i.id);

      userPosts =
        pagePostIds.length > 0
          ? await db.query.posts.findMany({
            where: inArray(posts.id, pagePostIds),
            with: postRelations,
          })
          : [];
      const postOrderIdx = new Map(pagePostIds.map((id, i) => [id, i]));
      userPosts.sort((a, b) => postOrderIdx.get(a.id) - postOrderIdx.get(b.id));

      const linkRows =
        pageLinkIds.length > 0
          ? await db.query.postTabLinks.findMany({ where: inArray(postTabLinks.id, pageLinkIds) })
          : [];
      const linkOrderIdx = new Map(pageLinkIds.map((id, i) => [id, i]));
      linkRows.sort((a, b) => linkOrderIdx.get(a.id) - linkOrderIdx.get(b.id));
      pageLinks = linkRows.map(l => PostService._formatLink(l));
    } else {
      const orderBy = sortOrder === 'desc' ? desc(posts[sortBy]) : posts[sortBy];
      const rawPosts = await db.query.posts.findMany({
        where: and(...whereConditions),
        with: postRelations,
        orderBy,
        limit: limit + 1,
        offset,
      });
      hasMore = rawPosts.length > limit;
      userPosts = hasMore ? rawPosts.slice(0, limit) : rawPosts;
    }

    const postsData = userPosts;
    const nextCursor = hasMore ? postsData[postsData.length - 1]?.createdAt : null;

    if (isFirstPage && pinnedPostIds.length > 0) {
      const pinnedWhereConditions = [
        inArray(posts.id, pinnedPostIds),
        eq(posts.isArchived, false),
        eq(posts.isStatusPost, false),
        or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date())),
        postsModerationGate(viewerId),
      ];

      if (excludeCoverPosts) {
        pinnedWhereConditions.push(eq(posts.isCoverPost, false));
      }

      if (viewerId !== userId) {
        const isFollowing = await FollowService.isFollowing(viewerId, userId);
        pinnedWhereConditions.push(
          isFollowing ? sql`${posts.visibility} != 'private'` : sql`${posts.visibility} = 'public'`
        );
        // Same as the main query: hide held posts from visitors, author included.
        pinnedWhereConditions.push(postsModerationGateStrict());
      }

      pinnedWhereConditions.push(sql`(
    ${posts.userId} = ${userId}
    OR EXISTS (
      SELECT 1 FROM post_collaborators pc
      WHERE pc.post_id = ${posts.id}
        AND pc.collaborator_id = ${userId}
        AND pc.status = 'accepted'
    )
  )`);

      pinnedPostsData = await db.query.posts.findMany({
        where: and(...pinnedWhereConditions),
        with: {
          user: {
            columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            with: { socialProfile: { columns: { bio: true, isPublic: true, coverImages: true } } },
          },
          likes: { where: eq(postLikes.userId, viewerId), columns: { id: true } },
          saves: { where: eq(savedPosts.userId, viewerId), columns: { id: true } },
          reposts: { where: eq(postReposts.userId, viewerId), columns: { id: true } },
          tags: { with: { category: true } },
        },
      });

      const orderMap = new Map(pinnedPostIds.map((id, i) => [id, i]));
      pinnedPostsData.sort((a, b) => (orderMap.get(a.id) ?? 9) - (orderMap.get(b.id) ?? 9));
    }

    if (isFirstPage && pinnedLinkIds.length > 0) {
      const linkRows = await db.query.postTabLinks.findMany({
        where: inArray(postTabLinks.id, pinnedLinkIds),
      });
      pinnedLinksData = linkRows
        .map(l => PostService._formatLink(l))
        .sort(
          (a, b) =>
            (pinOrderMap.get(`link:${a.id}`) ?? 9) - (pinOrderMap.get(`link:${b.id}`) ?? 9)
        );
    }
    // Batch-fetch accepted collaborators for every post in this page
    const allPostIds = [...postsData.map(p => p.id), ...pinnedPostsData.map(p => p.id)];
    const collaboratorsByPost = new Map();
    if (allPostIds.length > 0) {
      const collabRows = await db.query.postCollaborators.findMany({
        where: and(
          inArray(postCollaborators.postId, allPostIds),
          eq(postCollaborators.status, 'accepted')
        ),
        with: {
          collaborator: {
            columns: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              image: true,
              isEmailVerified: true,
              isBritesidePlus: true,
            },
          },
        },
      });
      for (const row of collabRows) {
        if (!collaboratorsByPost.has(row.postId)) collaboratorsByPost.set(row.postId, []);
        collaboratorsByPost.get(row.postId).push(row.collaborator);
      }
    }

    const linkedProductsByPost = await PostService._linkedProductsByPost(allPostIds);

    const uniqueUserIds = [...new Set(postsData.map(post => post.userId))];
    const userStoryStatus = await Promise.all(
      uniqueUserIds.map(async userId => ({
        userId,
        hasStory: await StoryService.hasActiveStory(userId),
      }))
    );
    const storyStatusMap = new Map(
      userStoryStatus.map(({ userId, hasStory }) => [userId, hasStory])
    );

    const formatPost = (post, extra = {}) => ({
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      mediaUrls: post.mediaUrls || [],
      mediaTypes: post.mediaTypes || [],
      aspectRatios: post.aspectRatios || [],
      location: post.location,
      tags: post.tags?.map(t => t.category.name) || post.tags || [],
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      repostsCount: post.repostsCount,
      viewsCount: post.viewsCount || 0,
      isArchived: post.isArchived,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        firstName: post.user.firstName,
        lastName: post.user.lastName,
        image: post.user.image,
        bio: post.user.socialProfile?.bio,
        isPublic: post.user.socialProfile?.isPublic,
        coverImages: post.user.socialProfile?.coverImages || [],
        hasStory: storyStatusMap.get(post.userId) || false,
        isEmailVerified: post.user.isEmailVerified,
        isBritesidePlus: post.user.isBritesidePlus,
      },
      visibility: post.visibility,
      settings: post.settings,
      commentsDisabled: post.settings?.commentsDisabled || false,
      hideLikes: post.settings?.hideLikes || false,
      linkButton: post.settings?.linkButton || null,
      linkedProducts: linkedProductsByPost.get(post.id) || [],
      isLiked: post.likes.length > 0,
      isSaved: post.saves.length > 0,
      isReposted: post.reposts ? post.reposts.length > 0 : false,
      collaborators: collaboratorsByPost.get(post.id) || [],
      moderationStatus: post.moderationStatus ?? 'approved',
      ...extra,
    });

    await attachPostModerationStatuses(postsData);
    await attachPostModerationStatuses(pinnedPostsData);

    const formattedPosts = postsData.map(post => formatPost(post));
    const formattedPinnedPosts = pinnedPostsData.map(post =>
      formatPost(post, { isPinned: true, pinOrder: pinOrderMap.get(`post:${post.id}`) ?? null })
    );
    const formattedPinnedLinks = pinnedLinksData.map(link => ({
      ...link,
      isPinned: true,
      pinOrder: pinOrderMap.get(`link:${link.id}`) ?? null,
    }));
    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    await Promise.all(
      [formattedPosts, formattedPinnedPosts].map(list =>
        TextModerationService.maskFlaggedText(list, {
          entityType: TEXT_ENTITY.POST,
          fields: ['caption'],
          filterEnabled,
        })
      )
    );

    return {
      posts: formattedPosts,
      pinnedPosts: formattedPinnedPosts,
      pinnedLinks: formattedPinnedLinks,
      links: pageLinks, // populated only when sortBy === 'displayOrder'
      items:
        sortBy === 'displayOrder'
          ? pageItemOrder
            .map(i =>
              i.type === 'post'
                ? (() => {
                  const p = formattedPosts.find(fp => fp.id === i.id);
                  return p ? { ...p, itemType: 'post' } : null;
                })()
                : pageLinks.find(l => l.id === i.id) ?? null
            )
            .filter(Boolean)
          : undefined,
      pagination: {
        page,
        limit,
        hasMore,
        nextCursor,
        total: mergedTotal ?? total,
        pinnedCount: pinnedPostIds.length,
      },
    };
  }

  /**
   * Get scheduled posts for a user (only their own)
   * @param {string} userId
   */
  static async getScheduledPosts(userId) {
    const scheduledPosts = await db
      .select()
      .from(posts)
      .where(and(eq(posts.userId, userId), eq(posts.status, 'scheduled')))
      .orderBy(asc(posts.scheduledAt));

    return scheduledPosts;
  }

  /**
   * Get a single post by ID
   * @param {string} postId - The post's ID
   * @param {string} viewerId - The viewer's ID
   */
  static async getPost(postId, viewerId) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
          with: {
            socialProfile: { columns: { bio: true, isPublic: true, coverImages: true } },
          },
        },
        likes: { where: eq(postLikes.userId, viewerId), columns: { id: true } },
        saves: { where: eq(savedPosts.userId, viewerId), columns: { id: true } },
        reposts: { where: eq(postReposts.userId, viewerId), columns: { id: true } },
        tags: { with: { category: true } },
      },
    });

    if (!post) throw new ApiError(404, 'Post not found');

    await attachPostModerationStatuses([post]);

    // Held content (pending/rejected/shadowed/…) is invisible to non-owners,
    // even by direct id. Owner still sees their own (with the removed/blur UI).
    if (HELD_FROM_OTHERS.has(post.moderationStatus) && post.userId !== viewerId) {
      throw new ApiError(404, 'Post not found');
    }

    // fetch collaborators
    const collabRows = await db.query.postCollaborators.findMany({
      where: and(eq(postCollaborators.postId, postId), eq(postCollaborators.status, 'accepted')),
      with: {
        collaborator: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
        },
      },
    });

    const hasStory = await StoryService.hasActiveStory(post.userId);
    const linkedProducts = (await PostService._linkedProductsByPost([postId])).get(postId) || [];

    const response = {
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      mediaUrls: post.mediaUrls || [],
      mediaTypes: post.mediaTypes || [],
      aspectRatios: post.aspectRatios || [],
      location: post.location,
      tags: post.tags?.map(t => t.category?.name).filter(Boolean) || [],
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      repostsCount: post.repostsCount,
      viewsCount: post.viewsCount || 0,
      isArchived: post.isArchived,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        isBritesidePlus: post.user.isBritesidePlus,
        isPlus: post.user.isPlus,
        firstName: post.user.firstName,
        lastName: post.user.lastName,
        image: post.user.image,
        bio: post.user.socialProfile?.bio,
        isPublic: post.user.socialProfile?.isPublic,
        coverImages: post.user.socialProfile?.coverImages || [],
        hasStory,
      },
      visibility: post.visibility,
      settings: post.settings,
      commentsDisabled: post.settings?.commentsDisabled || false,
      hideLikes: post.settings?.hideLikes || false,
      linkButton: post.settings?.linkButton || null,
      linkedProducts,
      isLiked: post.likes.length > 0,
      isSaved: post.saves.length > 0,
      isReposted: post.reposts ? post.reposts.length > 0 : false,
      collaborators: collabRows.map(r => r.collaborator),
      moderationStatus: post.moderationStatus ?? 'approved',
    };

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedTextSingle(response, {
      entityType: TEXT_ENTITY.POST,
      fields: ['caption'],
      filterEnabled,
    });
  }

  /**
   * Update a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   * @param {object} data - Data to update
   */
  static async updatePost(
    postId,
    userId,
    {
      caption,
      location,
      visibility,
      settings,
      tags,
      aspectRatios,
      scheduledAt,
      linkedProductIds,
      isPlus,
    }
  ) {
    const LINK_REGEX = /(https?:\/\/|www\.)\S+/i;
    if (caption && LINK_REGEX.test(caption)) {
      throw new ApiError(400, 'Links are not allowed in caption');
    }
    const VALID_VISIBILITY = ['public', 'followers', 'private'];

    const captionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.POST,
      entityId: postId,
      entityCreatorId: userId,
      texts: [caption],
    });

    const setData = { caption, location, updatedAt: new Date() };
    if (visibility !== undefined && VALID_VISIBILITY.includes(visibility))
      setData.visibility = visibility;
    if (settings !== undefined) {
      setData.settings = {
        ...settings,
        linkButton: PostService._sanitizeLinkButton(settings?.linkButton, isPlus),
      };
    }
    if (aspectRatios !== undefined) setData.aspectRatios = aspectRatios;

    // Undefined leaves existing links alone; an empty array clears them, which
    // is how switching a post back to a URL link removes its products.
    let resolvedProductIds = null;
    if (linkedProductIds !== undefined) {
      resolvedProductIds = await PostService._resolveLinkedProducts(userId, linkedProductIds, {
        isPlus,
        hasLinkButton: !!setData.settings?.linkButton,
      });
    }

    if (scheduledAt !== undefined) {
      const newDate = new Date(scheduledAt);
      if (isNaN(newDate.getTime())) throw new ApiError(400, 'Invalid scheduledAt date');
      if (newDate <= new Date()) throw new ApiError(400, 'scheduledAt must be in the future');
      setData.scheduledAt = newDate;
    }

    // Convert tag IDs to tag names if tags are provided
    if (tags !== undefined) {
      let tagNames = [];
      if (Array.isArray(tags) && tags.length > 0) {
        const tagCategories = await db.query.interestCategories.findMany({
          where: inArray(interestCategories.id, tags),
        });
        tagNames = tagCategories.map(cat => cat.name);
      }
      setData.tags = tagNames;
    }

    const [updated] = await db
      .update(posts)
      .set(setData)
      .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
      .returning();

    if (!updated) {
      throw new ApiError(404, 'Post not found or unauthorized');
    }

    await TextModerationService.recordIfFlagged(captionModeration, {
      entityType: TEXT_ENTITY.POST,
      entityId: postId,
      userId,
      fieldNames: ['caption'],
      texts: [caption],
    });

    // Update postTags if tags were provided
    if (tags !== undefined) {
      await PostService.addTagsToPost(postId, tags, 'manual');
    }

    if (resolvedProductIds !== null) {
      await PostService._writeLinkedProducts(postId, resolvedProductIds);
    }

    return await PostService.getPost(postId, userId);
  }

  /**
   * Delete a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   */
  static async deletePost(postId, userId) {
    const postData = await db.query.posts.findFirst({
      where: and(eq(posts.id, postId), eq(posts.userId, userId)),
    });

    if (!postData) {
      throw new ApiError(404, 'Post not found or unauthorized');
    }

    // Capture accepted collaborators before the cascade-delete removes their
    // rows, so their postsCount can be fixed up afterward
    const acceptedCollaborators = await db.query.postCollaborators.findMany({
      where: and(eq(postCollaborators.postId, postId), eq(postCollaborators.status, 'accepted')),
      columns: { collaboratorId: true },
    });

    try {
      if (postData.mediaUrls && Array.isArray(postData.mediaUrls)) {
        for (const mediaUrl of postData.mediaUrls) {
          const file = await FileManagementService.findByUrlOrKey(mediaUrl);
          if (file) {
            await FileManagementService.decrementReference(file.id);
          }
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up post media:', cleanupError);
    }

    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
      .returning();

    if (deleted.length === 0) {
      throw new ApiError(404, 'Post not found or unauthorized');
    }

    // Only decrement postsCount for published posts (not status posts, not scheduled)
    if (!postData.isStatusPost && postData.status !== 'scheduled') {
      await db
        .update(socialProfiles)
        .set({
          postsCount: sql`GREATEST(${socialProfiles.postsCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, userId));
    }

    // The post also disappears from each accepted collaborator's profile
    for (const { collaboratorId } of acceptedCollaborators) {
      await db
        .update(socialProfiles)
        .set({
          postsCount: sql`GREATEST(${socialProfiles.postsCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, collaboratorId));
    }

    return { success: true };
  }

  // --------- view and analytics helpers ---------
  static async viewPost(postId, viewerId) {
    // ensure post exists and viewer isn't blocked
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) {
      throw new ApiError(404, 'Post not found');
    }
    const isBlocked = await BlockService.isBlocked(viewerId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot view this post');
    }
    return SocialAnalyticsService.viewPost(postId, viewerId);
  }

  static async getPostAnalytics(postId, userId, filters = {}) {
    return SocialAnalyticsService.getPostAnalytics(postId, userId, filters);
  }

  /**
   * Toggle like on a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   */
  static async toggleLikePost(postId, userId) {
    // Check if post exists
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    // Check block status
    const isBlocked = await BlockService.isBlocked(userId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot like this post');
    }

    // Check if already liked
    const existing = await db.query.postLikes.findFirst({
      where: and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)),
    });

    // ===============================
    // UNLIKE
    // ===============================
    if (existing) {
      await db
        .delete(postLikes)
        .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));

      await db
        .update(posts)
        .set({ likesCount: sql`${posts.likesCount} - 1` })
        .where(eq(posts.id, postId));

      return {
        liked: false,
      };
    }

    // ===============================
    // LIKE
    // ===============================
    const [like] = await db.insert(postLikes).values({ postId, userId }).returning();

    await db
      .update(posts)
      .set({ likesCount: sql`${posts.likesCount} + 1` })
      .where(eq(posts.id, postId));

    // After notifying the post owner, also notify accepted collaborators
    try {
      if (post.userId && post.userId !== userId) {
        const liker = await db.query.users.findFirst({ where: eq(users.id, userId) });

        // Notify post owner
        await createNotification({
          userId: post.userId,
          title: 'Post liked',
          message: `${liker?.username || 'Someone'} liked your post`,
          type: 'social_update',
          relatedId: postId,
          redirectTo: `/feed/post/${postId}`,
          metadata: { postId, likerId: userId, likerUsername: liker?.username },
        });

        // Notify co-authors
        const coAuthors = await db.query.postCollaborators.findMany({
          where: and(
            eq(postCollaborators.postId, postId),
            eq(postCollaborators.status, 'accepted')
          ),
          columns: { collaboratorId: true },
        });

        for (const { collaboratorId } of coAuthors) {
          if (collaboratorId !== userId) {
            await createNotification({
              userId: collaboratorId,
              title: 'Post liked',
              message: `${liker?.username || 'Someone'} liked a post `,
              type: 'social_update',
              relatedId: postId,
              redirectTo: `/feed/post/${postId}`,
              metadata: { postId, likerId: userId, likerUsername: liker?.username },
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to create like-post notification', err);
    }

    return {
      liked: true,
      like,
    };
  }

  /**
   * Share a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   * @param {string} caption - Optional share caption
   */
  static async sharePost(postId, userId, caption) {
    // Check if post exists and not blocked
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    const isBlocked = await BlockService.isBlocked(userId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot share this post');
    }

    const [share] = await db.insert(postShares).values({ postId, userId, caption }).returning();

    // Update shares count
    await db
      .update(posts)
      .set({ sharesCount: sql`${posts.sharesCount} + 1` })
      .where(eq(posts.id, postId));

    return share;
  }

  /**
   * Toggle save on a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   */
  static async toggleSavePost(postId, userId) {
    // Check if post exists
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    // Check block status
    const isBlocked = await BlockService.isBlocked(userId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot save this post');
    }

    // Check if already saved
    const existing = await db.query.savedPosts.findFirst({
      where: and(eq(savedPosts.postId, postId), eq(savedPosts.userId, userId)),
    });

    // ===============================
    // UNSAVE
    // ===============================
    if (existing) {
      await db
        .delete(savedPosts)
        .where(and(eq(savedPosts.postId, postId), eq(savedPosts.userId, userId)));

      return {
        saved: false,
      };
    }

    // ===============================
    // SAVE
    // ===============================
    const [save] = await db.insert(savedPosts).values({ postId, userId }).returning();

    return {
      saved: true,
      save,
    };
  }

  /**
   * Toggle hide on a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   */
  static async toggleHidePost(postId, userId) {
    // Check if post exists
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    // Check if already hidden
    const existing = await db.query.userHiddenPosts.findFirst({
      where: and(eq(userHiddenPosts.postId, postId), eq(userHiddenPosts.userId, userId)),
    });

    // UNHIDE
    if (existing) {
      await db
        .delete(userHiddenPosts)
        .where(and(eq(userHiddenPosts.postId, postId), eq(userHiddenPosts.userId, userId)));

      return {
        hidden: false,
      };
    }

    // HIDE
    const [hidden] = await db.insert(userHiddenPosts).values({ postId, userId }).returning();

    return {
      hidden: true,
      hidden,
    };
  }

  /**
   * Toggle repost on a post
   * @param {string} postId - The post's ID
   * @param {string} userId - The user's ID
   */
  static async toggleRepost(postId, userId) {
    // Check if post exists
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new ApiError(404, 'Post not found');

    // Check block status
    const isBlocked = await BlockService.isBlocked(userId, post.userId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot repost this post');
    }

    // Use transaction for safe toggle and counter update
    return await db.transaction(async tx => {
      // Try insert with on conflict do nothing
      const inserted = await tx
        .insert(postReposts)
        .values({ postId, userId })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        await tx
          .update(posts)
          .set({ repostsCount: sql`${posts.repostsCount} + 1` })
          .where(eq(posts.id, postId));

        // Notify post owner + co-authors
        try {
          if (post.userId !== userId) {
            const reposter = await db.query.users.findFirst({ where: eq(users.id, userId) });
            const payload = {
              title: 'Post reposted',
              type: 'social_update',
              relatedId: postId,
              redirectTo: `/feed/post/${postId}`,
              metadata: { postId, reposterId: userId, reposterUsername: reposter?.username },
            };

            await createNotification({
              userId: post.userId,
              ...payload,
              message: `${reposter?.username || 'Someone'} reposted your post`,
            });

            await PostService.notifyCoAuthors(postId, post.userId, {
              ...payload,
              message: `${reposter?.username || 'Someone'} reposted a post `,
              excludeUserId: userId,
            });
          }
        } catch (err) {
          console.warn('Failed to create repost notification', err);
        }

        return { reposted: true };
      }

      // If not inserted, try delete (unrepost)
      const deleted = await tx
        .delete(postReposts)
        .where(and(eq(postReposts.postId, postId), eq(postReposts.userId, userId)))
        .returning();

      if (deleted.length > 0) {
        await tx
          .update(posts)
          .set({ repostsCount: sql`GREATEST(${posts.repostsCount} - 1, 0)` })
          .where(eq(posts.id, postId));

        return { reposted: false };
      }

      // Fallback: check current state
      const exists = await tx.query.postReposts.findFirst({
        where: and(eq(postReposts.postId, postId), eq(postReposts.userId, userId)),
      });

      return { reposted: !!exists };
    });
  }

  /**
   * Get reposted posts for a user
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getRepostedPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const reposts = await db.query.postReposts.findMany({
      where: eq(postReposts.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(postLikes.userId, userId),
            },
            saves: {
              where: eq(savedPosts.userId, userId),
            },
            reposts: {
              where: eq(postReposts.userId, userId),
            },
          },
        },
      },
      orderBy: desc(postReposts.createdAt),
      limit,
      offset,
    });

    const mapped = reposts.map(r => ({
      ...r.post,
      aspectRatios: r.post.aspectRatios || [],
      isLiked: r.post.likes.length > 0,
      isSaved: r.post.saves.length > 0,
      isReposted: true,
      repostedAt: r.createdAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  /**
   * Get posts that a user has shared
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getSharedPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const shares = await db.query.postShares.findMany({
      where: eq(postShares.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(postLikes.userId, userId),
            },
            saves: {
              where: eq(savedPosts.userId, userId),
            },
            reposts: {
              where: eq(postReposts.userId, userId),
            },
          },
        },
      },
      orderBy: desc(postShares.createdAt),
      limit,
      offset,
    });

    const mapped = shares.map(s => ({
      ...s.post,
      aspectRatios: s.post.aspectRatios || [],
      isLiked: s.post.likes.length > 0,
      isSaved: s.post.saves.length > 0,
      isReposted: s.post.reposts ? s.post.reposts.length > 0 : false,
      isShared: true,
      shareId: s.id,
      caption: s.caption,
      sharedAt: s.createdAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  /**
   * Get posts that a user has commented on
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getCommentedPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const rows = await db.query.postUserComments.findMany({
      where: eq(postUserComments.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(postLikes.userId, userId),
            },
            saves: {
              where: eq(savedPosts.userId, userId),
            },
            reposts: {
              where: eq(postReposts.userId, userId),
            },
          },
        },
      },
      orderBy: desc(postUserComments.commentedAt),
      limit,
      offset,
    });

    const mapped = rows.map(r => ({
      ...r.post,
      aspectRatios: r.post.aspectRatios || [],
      isLiked: r.post.likes.length > 0,
      isSaved: r.post.saves.length > 0,
      isReposted: r.post.reposts ? r.post.reposts.length > 0 : false,
      hasCommented: true,
      commentId: r.commentId,
      commentedAt: r.commentedAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  /**
   * Get saved posts for a user
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getSavedPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const saved = await db.query.savedPosts.findMany({
      where: eq(savedPosts.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(postLikes.userId, userId),
            },
          },
        },
      },
      orderBy: desc(savedPosts.createdAt),
      limit,
      offset,
    });

    const mapped = saved.map(s => ({
      ...s.post,
      aspectRatios: s.post.aspectRatios || [],
      isLiked: s.post.likes.length > 0,
      isSaved: true,
      isReposted: s.post.reposts ? s.post.reposts.length > 0 : false,
      hasCommented: s.post.commented ? s.post.commented.length > 0 : false,
      commentId:
        s.post.commented && s.post.commented.length > 0 ? s.post.commented[0].commentId : null,
      savedAt: s.createdAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  /**
   * Get hidden posts for a user
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getHiddenPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const hidden = await db.query.userHiddenPosts.findMany({
      where: eq(userHiddenPosts.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            likes: {
              where: eq(postLikes.userId, userId),
            },
            saves: {
              where: eq(savedPosts.userId, userId),
            },
            reposts: {
              where: eq(postReposts.userId, userId),
            },
          },
        },
      },
      orderBy: desc(userHiddenPosts.createdAt),
      limit,
      offset,
    });

    const mapped = hidden.map(h => ({
      ...h.post,
      aspectRatios: h.post.aspectRatios || [],
      isHiddenByViewer: true,
      isLiked: h.post.likes.length > 0,
      isSaved: h.post.saves.length > 0,
      isReposted: h.post.reposts ? h.post.reposts.length > 0 : false,
      hiddenAt: h.createdAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  /**
   * Get liked posts for a user
   * @param {string} userId - The user's ID
   * @param {number} page - Page number
   * @param {number} limit - Results per page
   */
  static async getLikedPosts(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const liked = await db.query.postLikes.findMany({
      where: eq(postLikes.userId, userId),
      with: {
        post: {
          with: {
            user: {
              with: {
                socialProfile: true,
              },
            },
            saves: {
              where: eq(savedPosts.userId, userId),
            },
            reposts: {
              where: eq(postReposts.userId, userId),
            },
          },
        },
      },
      orderBy: desc(postLikes.createdAt),
      limit,
      offset,
    });

    const mapped = liked.map(l => ({
      ...l.post,
      aspectRatios: l.post.aspectRatios || [],
      isLiked: true,
      isSaved: l.post.saves.length > 0,
      isReposted: l.post.reposts ? l.post.reposts.length > 0 : false,
      hasCommented: l.post.commented ? l.post.commented.length > 0 : false,
      commentId:
        l.post.commented && l.post.commented.length > 0 ? l.post.commented[0].commentId : null,
      likedAt: l.createdAt,
    }));
    return PostService._finalizePostList(mapped, userId);
  }

  // --------- pin helpers ---------

  static async pinPost(userId, postId) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { id: true, userId: true },
    });
    if (!post) throw new ApiError(404, 'Post not found');

    const isOwner = post.userId === userId;

    if (!isOwner) {
      const collab = await db.query.postCollaborators.findFirst({
        where: and(
          eq(postCollaborators.postId, postId),
          eq(postCollaborators.collaboratorId, userId),
          eq(postCollaborators.status, 'accepted')
        ),
        columns: { id: true },
      });
      if (!collab) throw new ApiError(403, 'Post not found or unauthorized');
    }

    const existing = await db.query.pinnedPosts.findFirst({
      where: and(eq(pinnedPosts.userId, userId), eq(pinnedPosts.postId, postId)),
    });
    if (existing) return { pinned: true, pinOrder: existing.pinOrder };

    // Cap is shared across posts + links — see reasoning below.
    const [{ total }] = await db
      .select({ total: count() })
      .from(pinnedPosts)
      .where(eq(pinnedPosts.userId, userId));
    if (total >= 9) throw new ApiError(400, 'Maximum of 9 pinned items reached');

    const [{ maxOrder }] = await db
      .select({ maxOrder: max(pinnedPosts.pinOrder) })
      .from(pinnedPosts)
      .where(eq(pinnedPosts.userId, userId));
    const pinOrder = Math.min((maxOrder ?? 0) + 1, 9);

    const [pin] = await db
      .insert(pinnedPosts)
      .values({ userId, itemType: 'post', postId, pinOrder, updatedAt: new Date() })
      .returning();

    return { pinned: true, pinOrder: pin.pinOrder };
  }

  static async unpinPost(userId, postId) {
    // Verify the user has access to this post (owner or accepted collaborator)
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { id: true, userId: true },
    });
    if (!post) throw new ApiError(404, 'Post not found');

    const isOwner = post.userId === userId;
    if (!isOwner) {
      const collab = await db.query.postCollaborators.findFirst({
        where: and(
          eq(postCollaborators.postId, postId),
          eq(postCollaborators.collaboratorId, userId),
          eq(postCollaborators.status, 'accepted')
        ),
        columns: { id: true },
      });
      if (!collab) throw new ApiError(403, 'Post not found or unauthorized');
    }

    await db
      .delete(pinnedPosts)
      .where(and(eq(pinnedPosts.userId, userId), eq(pinnedPosts.postId, postId)));

    return { pinned: false };
  }
  static async pinLink(userId, linkId) {
    await PostService.assertLinkOwnership(userId, linkId);

    const existing = await db.query.pinnedPosts.findFirst({
      where: and(eq(pinnedPosts.userId, userId), eq(pinnedPosts.linkId, linkId)),
    });
    if (existing) return { pinned: true, pinOrder: existing.pinOrder };

    const [{ total }] = await db
      .select({ total: count() })
      .from(pinnedPosts)
      .where(eq(pinnedPosts.userId, userId));
    if (total >= 9) throw new ApiError(400, 'Maximum of 9 pinned items reached');

    const [{ maxOrder }] = await db
      .select({ maxOrder: max(pinnedPosts.pinOrder) })
      .from(pinnedPosts)
      .where(eq(pinnedPosts.userId, userId));
    const pinOrder = Math.min((maxOrder ?? 0) + 1, 9);

    const [pin] = await db
      .insert(pinnedPosts)
      .values({ userId, itemType: 'link', linkId, pinOrder, updatedAt: new Date() })
      .returning();

    return { pinned: true, pinOrder: pin.pinOrder };
  }

  static async unpinLink(userId, linkId) {
    await PostService.assertLinkOwnership(userId, linkId);
    await db
      .delete(pinnedPosts)
      .where(and(eq(pinnedPosts.userId, userId), eq(pinnedPosts.linkId, linkId)));
    return { pinned: false };
  }
  static async reorderPins(userId, pins) {
    if (!Array.isArray(pins) || pins.length === 0 || pins.length > 9) {
      throw new ApiError(400, 'pins must be an array of 1–9 items');
    }

    const malformed = pins.some(
      p => !['post', 'link'].includes(p?.itemType) || typeof p?.id !== 'string' || !Number.isInteger(p?.pinOrder)
    );
    if (malformed) {
      throw new ApiError(400, 'Each pin needs itemType (post|link), id, and an integer pinOrder');
    }

    const orders = pins.map(p => p.pinOrder);
    if (orders.some(o => o < 1 || o > 9)) {
      throw new ApiError(400, 'Each pinOrder must be an integer between 1 and 9');
    }
    if (new Set(orders).size !== orders.length) {
      throw new ApiError(400, 'Duplicate pinOrder values in input');
    }

    const postPins = pins.filter(p => p.itemType === 'post');
    const linkPins = pins.filter(p => p.itemType === 'link');

    // Verify post ownership/collaboration, same rule as pinPost
    if (postPins.length > 0) {
      const postIds = postPins.map(p => p.id);
      const ownedPosts = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(inArray(posts.id, postIds), eq(posts.userId, userId)));
      const ownedIds = new Set(ownedPosts.map(p => p.id));
      const nonOwnedIds = postIds.filter(id => !ownedIds.has(id));

      if (nonOwnedIds.length > 0) {
        const collabRows = await db.query.postCollaborators.findMany({
          where: and(
            inArray(postCollaborators.postId, nonOwnedIds),
            eq(postCollaborators.collaboratorId, userId),
            eq(postCollaborators.status, 'accepted')
          ),
          columns: { postId: true },
        });
        const collabIds = new Set(collabRows.map(r => r.postId));
        const unauthorized = nonOwnedIds.filter(id => !collabIds.has(id));
        if (unauthorized.length > 0) {
          throw new ApiError(403, 'One or more posts do not belong to you');
        }
      }
    }

    // Verify link ownership
    if (linkPins.length > 0) {
      const linkIds = linkPins.map(p => p.id);
      const ownedLinks = await db.query.postTabLinks.findMany({
        where: and(inArray(postTabLinks.id, linkIds), eq(postTabLinks.userId, userId)),
        columns: { id: true },
      });
      const ownedLinkIds = new Set(ownedLinks.map(l => l.id));
      const unauthorized = linkIds.filter(id => !ownedLinkIds.has(id));
      if (unauthorized.length > 0) {
        throw new ApiError(403, 'One or more links do not belong to you');
      }
    }

    const result = await db.transaction(async tx => {
      await tx.delete(pinnedPosts).where(eq(pinnedPosts.userId, userId));
      const rows = pins.map(p => ({
        userId,
        itemType: p.itemType,
        postId: p.itemType === 'post' ? p.id : null,
        linkId: p.itemType === 'link' ? p.id : null,
        pinOrder: p.pinOrder,
        updatedAt: new Date(),
      }));
      return tx.insert(pinnedPosts).values(rows).returning();
    });

    return result.sort((a, b) => a.pinOrder - b.pinOrder);
  }
  static async getPendingCollaborations(userId) {
    const rows = await db.query.postCollaborators.findMany({
      where: and(
        eq(postCollaborators.collaboratorId, userId),
        eq(postCollaborators.status, 'pending')
      ),
      with: {
        post: { columns: { id: true, caption: true, mediaUrls: true, mediaTypes: true } },
        invitedBy: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
        },
      },
      orderBy: desc(postCollaborators.createdAt),
    });
    return rows;
  }

  static async respondToCollaboration(userId, collaborationId, action) {
    if (!['accept', 'reject'].includes(action)) {
      throw new ApiError(400, "Action must be 'accept' or 'reject'");
    }

    const invite = await db.query.postCollaborators.findFirst({
      where: and(
        eq(postCollaborators.id, collaborationId),
        eq(postCollaborators.collaboratorId, userId),
        eq(postCollaborators.status, 'pending')
      ),
    });
    if (!invite) throw new ApiError(404, 'Collaboration invite not found');

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    const [updated] = await db
      .update(postCollaborators)
      .set({ status: newStatus, respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(postCollaborators.id, collaborationId))
      .returning();

    if (action === 'accept') {
      // Post now also counts on the collaborator's own profile
      await db
        .update(socialProfiles)
        .set({ postsCount: sql`${socialProfiles.postsCount} + 1`, updatedAt: new Date() })
        .where(eq(socialProfiles.userId, userId));

      // Remove the post from the collaborator's wall (if it exists there)
      try {
        await db
          .delete(posts)
          .where(and(eq(posts.userId, userId), eq(posts.wallPostId, invite.postId)));
      } catch (err) {
        console.warn('Failed to remove wall post for collaborator after accept', err);
      }

      // Remove the post from the owner's wall too (clean up any pending wall version)
      try {
        const post = await db.query.posts.findFirst({
          where: eq(posts.id, invite.postId),
          columns: { userId: true },
        });

        if (post) {
          await db
            .delete(posts)
            .where(and(eq(posts.userId, post.userId), eq(posts.wallPostId, invite.postId)));
        }
      } catch (err) {
        console.warn('Failed to remove wall post for owner after accept', err);
      }
    }

    try {
      const responder = await db.query.users.findFirst({ where: eq(users.id, userId) });
      await createNotification({
        userId: invite.invitedById,
        title: action === 'accept' ? 'Collaboration accepted' : 'Collaboration declined',
        message:
          action === 'accept'
            ? `${responder?.username || 'Someone'} accepted your collaboration invite`
            : `${responder?.username || 'Someone'} declined your collaboration invite`,
        type: 'social_update',
        relatedId: invite.postId,
        redirectTo: `/feed/post/${invite.postId}`,
        metadata: { postId: invite.postId, collaboratorId: userId, action },
      });
    } catch (err) {
      console.warn('Failed to create collaboration response notification', err);
    }

    return { status: updated.status };
  }

  /**
 * Reorders posts and post-tab links as one interleaved sequence — this is
 * what the drag-to-arrange grid saves. `items` is
 * [{ type: 'post'|'link', id }, ...] in the author's chosen order.
 */
  static async reorderPostTabItems(userId, items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'items must be a non-empty array');
    }
    const malformed = items.some(
      i => !['post', 'link'].includes(i?.type) || typeof i?.id !== 'string'
    );
    if (malformed) throw new ApiError(400, 'Each item needs a type of post or link, and an id');

    const postIds = items.filter(i => i.type === 'post').map(i => i.id);
    const linkIds = items.filter(i => i.type === 'link').map(i => i.id);

    const [ownedPosts, ownedLinks] = await Promise.all([
      postIds.length
        ? db
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              inArray(posts.id, postIds),
              sql`(
              ${posts.userId} = ${userId}
              OR EXISTS (
                SELECT 1 FROM post_collaborators pc
                WHERE pc.post_id = ${posts.id}
                  AND pc.collaborator_id = ${userId}
                  AND pc.status = 'accepted'
              )
            )`
            )
          )
        : Promise.resolve([]),
      linkIds.length
        ? db.query.postTabLinks.findMany({
          where: and(inArray(postTabLinks.id, linkIds), eq(postTabLinks.userId, userId)),
          columns: { id: true },
        })
        : Promise.resolve([]),
    ]);

    const ownedPostIds = new Set(ownedPosts.map(p => p.id));
    const ownedLinkIds = new Set(ownedLinks.map(l => l.id));
    const toWrite = items.filter(i =>
      i.type === 'post' ? ownedPostIds.has(i.id) : ownedLinkIds.has(i.id)
    );

    if (toWrite.length === 0) throw new ApiError(403, 'None of these items belong to this user');

    const rows = toWrite.map((item, index) => ({
      userId,
      itemType: item.type,
      postId: item.type === 'post' ? item.id : null,
      linkId: item.type === 'link' ? item.id : null,
      displayOrder: index,
    }));

    // Two upserts (one per item type) since the unique target differs.
    const postRows = rows.filter(r => r.itemType === 'post');
    const linkRows = rows.filter(r => r.itemType === 'link');

    await db.transaction(async tx => {
      if (postRows.length) {
        await tx
          .insert(userPostOrder)
          .values(postRows)
          .onConflictDoUpdate({
            target: [userPostOrder.userId, userPostOrder.postId],
            set: { displayOrder: sql`excluded.display_order` },
          });
      }
      if (linkRows.length) {
        await tx
          .insert(userPostOrder)
          .values(linkRows)
          .onConflictDoUpdate({
            target: [userPostOrder.userId, userPostOrder.linkId],
            set: { displayOrder: sql`excluded.display_order` },
          });
      }
    });

    return { reordered: toWrite.length };
  }

  static async removeCollaborator(requesterId, postId, collaboratorId) {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new ApiError(404, 'Post not found');

    const isOwner = post.userId === requesterId;
    const isSelf = collaboratorId === requesterId;
    if (!isOwner && !isSelf) {
      throw new ApiError(
        403,
        'Only the post owner or the collaborator can remove this collaboration'
      );
    }

    const existing = await db.query.postCollaborators.findFirst({
      where: and(
        eq(postCollaborators.postId, postId),
        eq(postCollaborators.collaboratorId, collaboratorId)
      ),
    });
    if (!existing) throw new ApiError(404, 'Collaboration not found');

    const wasAccepted = existing.status === 'accepted';

    await db
      .update(postCollaborators)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(eq(postCollaborators.id, existing.id));

    if (wasAccepted) {
      await db
        .update(socialProfiles)
        .set({
          postsCount: sql`GREATEST(${socialProfiles.postsCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, collaboratorId));
    }

    try {
      const actor = await db.query.users.findFirst({ where: eq(users.id, requesterId) });
      const recipientId = isSelf ? post.userId : collaboratorId;

      if (recipientId !== requesterId) {
        await createNotification({
          userId: recipientId,
          title: isSelf ? 'Collaborator left' : 'Removed from collaboration',
          message: isSelf
            ? `${actor?.username || 'Someone'} left a collaboration on your post`
            : `${actor?.username || 'Someone'} removed you as a collaborator on a post`,
          type: 'social_update',
          relatedId: postId,
          redirectTo: `/feed/post/${postId}`,
          metadata: { postId, collaboratorId, actedById: requesterId, wasAccepted },
        });
      }
    } catch (err) {
      console.warn('Failed to create collaborator-removed notification', err);
    }

    return { removed: true };
  }
  static async getPostPendingInvites(postId, requesterId) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { id: true, userId: true },
    });
    if (!post) throw new ApiError(404, 'Post not found');
    if (post.userId !== requesterId) {
      throw new ApiError(403, 'Only the post owner can view pending invites');
    }

    const rows = await db.query.postCollaborators.findMany({
      where: and(eq(postCollaborators.postId, postId), eq(postCollaborators.status, 'pending')),
      with: {
        collaborator: {
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            image: true,
            isEmailVerified: true,
            isBritesidePlus: true,
          },
        },
      },
    });

    return rows.map(r => r.collaborator);
  }

  static async inviteCollaborators(requesterId, postId, collaboratorIds) {
    if (!Array.isArray(collaboratorIds) || collaboratorIds.length === 0) {
      throw new ApiError(400, 'collaboratorIds must be a non-empty array');
    }

    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new ApiError(404, 'Post not found');
    if (post.userId !== requesterId) {
      throw new ApiError(403, 'Only the post owner can invite collaborators');
    }

    const existingRows = await db.query.postCollaborators.findMany({
      where: eq(postCollaborators.postId, postId),
    });
    const existingByUser = new Map(existingRows.map(r => [r.collaboratorId, r]));

    const activeCount = existingRows.filter(
      r => r.status === 'accepted' || r.status === 'pending'
    ).length;

    const uniqueIds = [...new Set(collaboratorIds)].filter(id => id !== requesterId);
    if (uniqueIds.length === 0) {
      throw new ApiError(400, 'No valid collaborators to invite');
    }

    // Only count IDs that aren't already accepted/pending toward the cap
    const newIds = uniqueIds.filter(id => {
      const existing = existingByUser.get(id);
      return !existing || (existing.status !== 'accepted' && existing.status !== 'pending');
    });
    const alreadyActiveIds = uniqueIds.filter(id => !newIds.includes(id));

    if (activeCount + newIds.length > 5) {
      throw new ApiError(400, 'A post can have at most 5 collaborators');
    }

    if (newIds.length === 0) {
      return {
        invited: [],
        alreadyActive: alreadyActiveIds,
        message: 'Selected users are already collaborators or have a pending invite',
      };
    }

    const candidateUsers = await db.query.users.findMany({
      where: inArray(users.id, newIds),
      columns: { id: true },
    });
    const validIds = new Set(candidateUsers.map(u => u.id));

    const allowedCollaboratorIds = [];
    for (const id of newIds) {
      if (!validIds.has(id)) continue;
      const isBlocked = await BlockService.isBlocked(requesterId, id);
      if (!isBlocked) allowedCollaboratorIds.push(id);
    }

    if (allowedCollaboratorIds.length === 0) {
      return {
        invited: [],
        alreadyActive: alreadyActiveIds,
        message: 'No eligible users to invite',
      };
    }

    // Split into fresh inserts vs. reviving a previously removed/rejected row
    const toInsert = [];
    const toRevive = [];
    for (const collaboratorId of allowedCollaboratorIds) {
      const existing = existingByUser.get(collaboratorId);
      if (existing) {
        toRevive.push(existing.id);
      } else {
        toInsert.push({ postId, collaboratorId, invitedById: requesterId });
      }
    }

    if (toInsert.length > 0) {
      await db.insert(postCollaborators).values(toInsert);
    }
    if (toRevive.length > 0) {
      await db
        .update(postCollaborators)
        .set({
          status: 'pending',
          invitedById: requesterId,
          respondedAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(postCollaborators.id, toRevive));
    }

    const poster = await db.query.users.findFirst({ where: eq(users.id, requesterId) });

    for (const collaboratorId of allowedCollaboratorIds) {
      try {
        await createNotification({
          userId: collaboratorId,
          title: 'Collaboration invite',
          message: `${poster?.username || 'Someone'} invited you to collaborate on a post`,
          type: 'social_update',
          relatedId: postId,
          redirectTo: `/feed/collaborations/pending`,
          metadata: { postId, invitedById: requesterId, invitedByUsername: poster?.username },
        });
      } catch (err) {
        console.warn('Failed to create collaboration invite notification', err);
      }
    }

    return {
      invited: allowedCollaboratorIds,
      alreadyActive: alreadyActiveIds,
    };
  }
  // --------- post-tab links (Website-link tiles in the Posts grid) ---------

  static _validateLink(data, { partial = false } = {}) {
    const required = key => !partial || data[key] !== undefined;

    if (required('title') && !data.title?.trim()) {
      throw new ApiError(400, 'Title is required');
    }
    if (data.title && data.title.length > 100) {
      throw new ApiError(400, 'Title must be 100 characters or fewer');
    }
    if (required('url') && !data.url?.trim()) {
      throw new ApiError(400, 'URL is required');
    }
    if (data.url && !URL_PATTERN.test(data.url.trim())) {
      throw new ApiError(400, 'URL must start with http:// or https://');
    }
  }

  static _buildLinkFields(data) {
    return {
      title: data.title?.trim(),
      url: data.url?.trim(),
      coverUrl: data.coverUrl || null,
      coverType: data.coverUrl ? data.coverType || 'image' : null,
    };
  }

  static async assertLinkOwnership(userId, linkId) {
    const link = await db.query.postTabLinks.findFirst({ where: eq(postTabLinks.id, linkId) });
    if (!link) throw new ApiError(404, 'Link not found');
    if (link.userId !== userId) throw new ApiError(403, 'This is not your link');
    return link;
  }

  static async countLinksForUser(userId) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(postTabLinks)
      .where(eq(postTabLinks.userId, userId));
    return Number(value);
  }

  /** Regular users cap out at MAX_TAB_LINKS_FREE; BriteSide Plus is unlimited. */
  static async assertCanAddLink(userId, isPlus) {
    if (isPlus) return;
    const existing = await this.countLinksForUser(userId);
    if (existing >= MAX_TAB_LINKS_FREE) {
      throw new ApiError(
        400,
        `Free accounts can add up to ${MAX_TAB_LINKS_FREE} links. Upgrade to BriteSide Plus for unlimited links.`
      );
    }
  }

  static async createPostTabLink(userId, data, isPlus) {
    this._validateLink(data);
    await this.assertCanAddLink(userId, isPlus);

    const link = await db.transaction(async tx => {
      const [created] = await tx
        .insert(postTabLinks)
        .values({ userId, ...this._buildLinkFields(data) })
        .returning();

      // New items go to the front of the shared order, same convention as
      // shop's displayOrder handling: MIN(existing) - 1.
      const [{ value: lowest }] = await tx
        .select({ value: sql`COALESCE(MIN(${userPostOrder.displayOrder}), 0)` })
        .from(userPostOrder)
        .where(eq(userPostOrder.userId, userId));

      await tx.insert(userPostOrder).values({
        userId,
        itemType: 'link',
        linkId: created.id,
        displayOrder: Number(lowest) - 1,
      });

      return created;
    });

    return link;
  }

  static async updatePostTabLink(userId, linkId, data) {
    const existing = await this.assertLinkOwnership(userId, linkId);
    const merged = { ...existing, ...data };
    this._validateLink(merged, { partial: true });

    const [updated] = await db
      .update(postTabLinks)
      .set({ ...this._buildLinkFields(merged), updatedAt: new Date() })
      .where(eq(postTabLinks.id, linkId))
      .returning();

    return updated;
  }

  static async deletePostTabLink(userId, linkId) {
    await this.assertLinkOwnership(userId, linkId);
    await db.delete(postTabLinks).where(eq(postTabLinks.id, linkId));
    return { deleted: true };
  }

  /** No ownership check — any visitor can click a link tile. */
  static async clickPostTabLink(linkId) {
    const [updated] = await db
      .update(postTabLinks)
      .set({ clicksCount: sql`${postTabLinks.clicksCount} + 1` })
      .where(eq(postTabLinks.id, linkId))
      .returning({ id: postTabLinks.id, url: postTabLinks.url });

    if (!updated) throw new ApiError(404, 'Link not found');
    return { url: updated.url };
  }

  static _formatLink(link) {
    return {
      id: link.id,
      itemType: 'link',
      userId: link.userId,
      title: link.title,
      url: link.url,
      coverUrl: link.coverUrl,
      coverType: link.coverType,
      clicksCount: link.clicksCount,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}
