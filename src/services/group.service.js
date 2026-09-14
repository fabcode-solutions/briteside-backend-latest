import { db } from '../db/index.js';
import {
  groups,
  groupMembers,
  groupJoinRequests,
  groupCategories,
  groupEventPromotions,
  groupMedia,
  groupFeaturedContent,
  groupAboutGallery,  
  events,
  users,
  tags,
  groupTags,
  groupDiscussionNotifications,
  groupShopProducts,
  shopProducts,
} from '../db/schema/index.js';

// Constants for media limits
const MAX_GROUP_MEDIA = 5;
const MAX_FEATURED_CONTENT = 10;
const MAX_ABOUT_GALLERY_ITEMS = 5;

import {
  discussions,
  discussionLikes,
  discussionReplies,
  discussionReplyLikes,
} from '../db/schema/groups.js';
import { eq, and, desc, asc, like, count, sql, gte, isNull, inArray, ilike } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { sanitizeLinkButton } from '../utils/link-button.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import { MediaModerationService, MEDIA_ENTITY } from './moderation/mediaModeration.service.js';
import FileManagementService from './fileManagement.service.js';
import {
  getCurrentUserMembership,
  getGroupMemberCount,
  getUserInformation,
  getGroupAdmin,
  logError,
  logInfo,
  logWarning,
  getNextTwoEventsByGroupId,
  getActorDisplayName,
} from '../utils/helper.js';
import {
  verifyGroupMembership,
  checkGroupMembership,
  requireGroupAdmin,
  requireGroupAdminOrModerator,
  checkPendingJoinRequest,
} from '../utils/group-helpers.js';
import { createUniqueSlugForGroup, shouldRegenerateSlug } from '../utils/group-helpers.js';
import { mailService } from './index.js';
import { createNotification } from './notification.service.js';
import { sendGroupInvitationEmail, sendPaidGroupSubscriptionEmail } from '../templates/index.js';
import { GroupSubscriptionService } from './groupSubscription.service.js';
import { GroupQuestionService } from './groupQuestion.service.js';

export class GroupService {
  /**
   * Helper to delete all discussions and their related data for a group
   */
  static async deleteAllGroupDiscussions(groupId) {
    const discussionsList = await db
      .select({ id: discussions.id, mediaUrls: discussions.mediaUrls })
      .from(discussions)
      .where(eq(discussions.groupId, groupId));
    const discussionIds = discussionsList.map(d => d.id);
    if (discussionIds.length === 0) return;

    try {
      for (const discussion of discussionsList) {
        if (Array.isArray(discussion.mediaUrls)) {
          for (const url of discussion.mediaUrls) {
            const file = await FileManagementService.findByUrlOrKey(url);
            if (file) {
              await FileManagementService.decrementReference(file.id);
            }
          }
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up discussion media:', cleanupError);
    }

    await db.delete(discussionLikes).where(inArray(discussionLikes.discussionId, discussionIds));

    const replies = await db
      .select({ id: discussionReplies.id })
      .from(discussionReplies)
      .where(inArray(discussionReplies.discussionId, discussionIds));
    const replyIds = replies.map(r => r.id);
    if (replyIds.length > 0) {
      await db.delete(discussionReplyLikes).where(inArray(discussionReplyLikes.replyId, replyIds));
      await db
        .delete(discussionReplies)
        .where(inArray(discussionReplies.discussionId, discussionIds));
    }

    await db.delete(discussions).where(inArray(discussions.id, discussionIds));
  }

  static async incrementGroupMemberCount(groupId) {
    await db
      .update(groups)
      .set({ memberCount: sql`${groups.memberCount} + 1` })
      .where(eq(groups.id, groupId));
  }

  static async decrementGroupMemberCount(groupId) {
    await db
      .update(groups)
      .set({ memberCount: sql`${groups.memberCount} - 1` })
      .where(eq(groups.id, groupId));
  }

  /**
   * @desc Creates a new group and automatically adds the creator as an 'admin' member.
   * The creator is also auto-subscribed to group discussion notifications.
   */
  static async enforceGroupPrivacyRules(groupFields, groupId = null) {
    const isPaid = groupFields.isPaid;

    if (isPaid === true) {
      groupFields.isPublic = false;
      groupFields.requiresApproval = false;
      return groupFields;
    }

    if (groupId) {
      const activeQuestions = await GroupQuestionService.getQuestions(groupId);
      if (activeQuestions.length > 0) {
        groupFields.isPublic = false;
        groupFields.requiresApproval = true;
      }
    }

    return groupFields;
  }

  /**
   * Validates the shop products an organizer surfaces on their group and returns
   * them in the order picked. Plus-only, like the group's link button — but a
   * group may carry both at once, unlike a post which allows only one.
   *
   * Products must belong to the organizer and still be live; a foreign or
   * deleted id is rejected rather than silently dropped, so the organizer knows
   * the selection didn't save.
   */
  static async _resolveGroupShopProducts(userId, shopProductIds, isPlus) {
    if (!Array.isArray(shopProductIds) || shopProductIds.length === 0) return [];

    if (!isPlus) {
      throw new ApiError(
        403,
        'Showing shop products in your group is a BriteSide Plus feature. Upgrade to add some.'
      );
    }

    const uniqueIds = [...new Set(shopProductIds)];

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

    // The order the organizer picked is the order they render in.
    return uniqueIds;
  }

  /** Replaces a group's shop products with the given ordered list. */
  static async _writeGroupShopProducts(groupId, productIds) {
    await db.delete(groupShopProducts).where(eq(groupShopProducts.groupId, groupId));
    if (productIds.length === 0) return;
    await db
      .insert(groupShopProducts)
      .values(productIds.map((productId, position) => ({ groupId, productId, position })));
  }

  static async createGroup(userId, groupData, isPlus = false) {
    const {
      media = [],
       aboutGallery = [],   
      featuredContent = [],
      inviteeIds = [],
      shopProductIds = [],
      ...groupFields
    } = groupData;

    if (!groupFields.coverImageUrl) {
      throw new ApiError(400, 'Cover image is required for creating a group.');
    }
    if (media.length > MAX_GROUP_MEDIA) {
      throw new ApiError(400, `Maximum ${MAX_GROUP_MEDIA} media items allowed.`);
    }
    if (featuredContent.length > MAX_FEATURED_CONTENT) {
      throw new ApiError(400, `Maximum ${MAX_FEATURED_CONTENT} featured content items allowed.`);
    }

    // Both Plus-gated. Validated before the insert so a rejection can't leave an
    // orphan group behind.
    const linkButton = sanitizeLinkButton(groupFields.linkButton, isPlus, 'group');
    const resolvedProductIds = await this._resolveGroupShopProducts(userId, shopProductIds, isPlus);

    const slug = await createUniqueSlugForGroup(groupFields.name);

    await this.enforceGroupPrivacyRules(groupFields);

    const groupModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.GROUP,
      entityCreatorId: userId,
      texts: [groupFields.name, groupFields.description],
    });

    const [group] = await db
      .insert(groups)
      .values({
        ...groupFields,
        linkButton,
        slug,
        isPublic: groupFields.isPublic ?? true,
        requiresApproval: groupFields.requiresApproval ?? false,
        createdBy: userId,
      })
      .returning();

    await TextModerationService.recordIfFlagged(groupModeration, {
      entityType: TEXT_ENTITY.GROUP,
      entityId: group.id,
      userId,
      fieldNames: ['name', 'description'],
      texts: [groupFields.name, groupFields.description],
    });

    // Cover image gates joins/publish — inherit its file's verdict
    if (group.coverImageUrl) {
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.GROUP,
        entityId: group.id,
        userId,
        ...MediaModerationService.splitUrls([group.coverImageUrl]),
      });
    }

    await db.insert(groupMembers).values({
      groupId: group.id,
      userId: userId,
      role: 'admin',
      status: 'joined',
      joinedAt: new Date(),
    });

    await this.incrementGroupMemberCount(group.id);

    // Auto-subscribe the creator to group discussion notifications
    try {
      await GroupDiscussionNotificationService.subscribe(group.id, userId);
    } catch (subscribeError) {
      console.error('Error auto-subscribing group creator to notifications:', subscribeError);
    }

    if (media.length > 0) {
      await this.createGroupMedia(group.id, userId, media);
    }
     if (aboutGallery.length > 0) {                                  // ← new
      await this.createGroupAboutGallery(group.id, userId, aboutGallery);
    }
    if (featuredContent.length > 0) {
      await this.createGroupFeaturedContent(group.id, userId, featuredContent);
    }
    if (resolvedProductIds.length > 0) {
      await this._writeGroupShopProducts(group.id, resolvedProductIds);
    }
    if (inviteeIds && inviteeIds.length > 0) {
      await sendGroupInvitations({
        groupId: group.id,
        groupSlug: group.slug,
        groupName: group.name,
        inviterId: userId,
        inviteeIds,
      });
    }

    // Auto-seed a default subscription tier when a paid group is created
    if (group.isPaid && group.subscriptionPrice) {
      try {
        const { GroupSubscriptionService } = await import('./groupSubscription.service.js');
        await GroupSubscriptionService.createTier(group.id, userId, {
          name: 'Membership',
          price: group.subscriptionPrice,
          billingInterval: 'monthly',
        });
      } catch (tierErr) {
        console.error('Failed to auto-seed default subscription tier:', tierErr);
      }
    }

    return this.getGroupById(group.id, userId);
  }

  static async createGroupMedia(groupId, uploaderId, mediaItems) {
    if (!mediaItems || mediaItems.length === 0) return [];
    const mediaData = mediaItems.map(item => ({
      groupId,
      uploaderId,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType || 'image',
      caption: item.caption || null,
    }));
    return db.insert(groupMedia).values(mediaData).returning();
  }

  static async createGroupAboutGallery(groupId, uploaderId, items) {
    if (!items || items.length === 0) return [];
    const rows = items.map((item, index) => ({
      groupId,
      uploaderId,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType || 'image',
      caption: item.caption || null,
      position: index,
    }));
    return db.insert(groupAboutGallery).values(rows).returning();
  }

  static async deleteAllGroupAboutGallery(groupId, existingItems = []) {
    for (const item of existingItems) {
      try {
        const file = await FileManagementService.findByUrlOrKey(item.mediaUrl);
        if (file) await FileManagementService.decrementReference(file.id);
      } catch (error) {
        console.error(`Error cleaning up about gallery file ${item.id}:`, error);
      }
    }
    await db.delete(groupAboutGallery).where(eq(groupAboutGallery.groupId, groupId));
  }

  static async createGroupFeaturedContent(groupId, createdBy, contentItems) {
    if (!contentItems || contentItems.length === 0) return [];
    const contentData = contentItems.map(item => ({
      groupId,
      createdBy,
      title: item.title,
      description: item.description || null,
      mediaUrl: item.mediaUrl || null,
      mediaType: item.mediaType || null,
      url: item.url || null,
      isPinned: item.isPinned || false,
    }));
    return db.insert(groupFeaturedContent).values(contentData).returning();
  }

  static async getGroups(filters, userId) {
    const {
      page = 1,
      limit = 10,
      isPublic,
      search,
      slug,
      categoryId,
      country,
      state,
      city,
      isFree,
      priceRange,
    } = filters || {};
    const offset = (page - 1) * limit;

    let conditions = [];

    if (isPublic !== undefined) {
      const isPublicBool = isPublic === 'true' || isPublic === true;
      conditions.push(eq(groups.isPublic, isPublicBool));
    }
    if (slug) conditions.push(eq(groups.slug, slug));
    if (categoryId) conditions.push(eq(groups.categoryId, categoryId));
    if (country) conditions.push(ilike(groups.country, country));
    if (state) conditions.push(ilike(groups.state, state));
    if (city) conditions.push(ilike(groups.city, city));
    if (isFree !== undefined) {
      const isFreeBool = String(isFree).toLowerCase() === 'true';
      conditions.push(eq(groups.isPaid, !isFreeBool));
    }
    if (priceRange) {
      const [minPrice, maxPrice] = priceRange.split('-').map(Number);
      if (!isNaN(minPrice) && !isNaN(maxPrice)) {
        conditions.push(sql`${groups.subscriptionPrice} BETWEEN ${minPrice} AND ${maxPrice}`);
      }
    }
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        sql`${groups.name} ILIKE ${searchTerm} OR ${groups.description} ILIKE ${searchTerm}`
      );
    }
    conditions.push(sql`${groups.deletedAt} IS NULL`);

    const groupsWithNextEvent = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        coverImageUrl: groups.coverImageUrl,
        slug: groups.slug,
        city: groups.city,
        state: groups.state,
        isPublic: groups.isPublic,
        isPaid: groups.isPaid,
        subscriptionPrice: groups.subscriptionPrice,
        requiresApproval: groups.requiresApproval,
        maxMembers: groups.maxMembers,
        memberCount: groups.memberCount,
        categoryId: groups.categoryId,
        createdBy: groups.createdBy,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
        deletedAt: groups.deletedAt,
        categoryName: groupCategories.name,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
        nextEvent: sql`(
          SELECT json_build_object(
            'id', e.id,
            'title', e.title,
            'startDate', e.start_date,
            'endDate', e.end_date,
            'coverImageUrl', e.cover_images
          )
          FROM ${groupEventPromotions} gep
          JOIN ${events} e ON e.id = gep.event_id
          WHERE gep.group_id = ${groups.id}
            AND e.start_date >= NOW()
            AND e.event_status = 'published'
          ORDER BY e.start_date ASC
          LIMIT 1
        )`.as('next_event'),
      })
      .from(groups)
      .leftJoin(groupCategories, eq(groups.categoryId, groupCategories.id))
      .leftJoin(users, eq(groups.createdBy, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(groups.createdAt))
      .limit(limit)
      .offset(offset);

    const totalCount = await db
      .select({ count: count() })
      .from(groups)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    let groupsResult = groupsWithNextEvent.map(group => ({
      id: group.id,
      name: group.name,
      description: group.description,
      slug: group.slug,
      coverImageUrl: group.coverImageUrl,
      isPublic: group.isPublic,
      isPaid: group.isPaid,
      subscriptionPrice: group.subscriptionPrice,
      requiresApproval: group.requiresApproval,
      maxMembers: group.maxMembers,
      memberCount: group.memberCount,
      categoryId: group.categoryId,
      createdBy: group.createdBy,
      city: group.city,
      state: group.state,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      deletedAt: group.deletedAt,
      category: group.categoryName ? { id: group.categoryId, name: group.categoryName } : null,
      nextEvent: group.nextEvent || null,
    }));

    if (userId && groupsResult.length > 0) {
      const groupIds = groupsResult.map(group => group.id);
      const [memberships, joinRequests] = await Promise.all([
        db
          .select()
          .from(groupMembers)
          .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, userId))),
        db
          .select()
          .from(groupJoinRequests)
          .where(
            and(
              inArray(groupJoinRequests.groupId, groupIds),
              eq(groupJoinRequests.userId, userId),
              eq(groupJoinRequests.status, 'pending')
            )
          ),
      ]);

      const joinRequestMap = new Map(joinRequests.map(jr => [jr.groupId, jr]));

      groupsResult = groupsResult.map(group => {
        const membership = memberships.find(m => m.groupId === group.id);
        const joinRequest = joinRequestMap.get(group.id);
        return {
          ...group,
          userMembership: membership
            ? getCurrentUserMembership(memberships, group.id)
            : joinRequest
              ? { status: 'pending' }
              : null,
        };
      });
    }

    for (const group of groupsResult) {
      group.groupTags = await GroupTagService.getGroupTags(group.id);
    }

    // Annotate listing cards so the frontend can blur flagged / placeholder removed covers
    await MediaModerationService.attachGroupModerationStatuses(groupsResult);

    const groupsFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(groupsResult, {
      entityType: TEXT_ENTITY.GROUP,
      fields: ['name', 'description'],
      filterEnabled: groupsFilterEnabled,
    });

    return {
      groups: groupsResult,
      pagination: {
        page,
        limit,
        total: totalCount[0]?.count || 0,
        pages: Math.ceil((totalCount[0]?.count || 0) / limit),
      },
    };
  }

  static async getGroupById(groupId, currentUserId = null) {
    return this.getGroup({ id: groupId }, currentUserId);
  }

  static async getGroupBySlug(slug, currentUserId = null) {
    return this.getGroup({ slug }, currentUserId);
  }

  static async getGroupsInfo(slug, currentUserId = null) {
    return this.getGroup({ slug }, currentUserId);
  }

  static async getGroup({ id, slug }, currentUserId = null) {
    const whereClause = slug
      ? and(eq(groups.slug, slug), isNull(groups.deletedAt))
      : eq(groups.id, id);

    const group = await db.query.groups.findFirst({
      where: whereClause,
      with: {
        createdBy: {
          columns: {
            id: true,
            image: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
          },
          with: { organizer: true },
        },
        category: true,
        media: {
          with: {
            uploader: {
              columns: { id: true, firstName: true, lastName: true, image: true },
            },
          },
          orderBy: (media, { desc }) => [desc(media.createdAt)],
        },
         aboutGallery: {                                              // ← new
          with: {
            uploader: { columns: { id: true, firstName: true, lastName: true, image: true } },
          },
          orderBy: (item, { asc }) => [asc(item.position)],
        },
        featuredContent: {
          with: {
            createdBy: {
              columns: { id: true, firstName: true, lastName: true, image: true },
            },
          },
          orderBy: (content, { desc }) => [desc(content.isPinned), desc(content.createdAt)],
        },
        shopProducts: {
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
          orderBy: (link, { asc }) => [asc(link.position)],
        },
      },
    });

    if (!group) return null;

    // Hide media whose backing file was rejected/removed by moderation
    // (kept items get moderationStatus for frontend blur)
    if (group.media?.length) {
      group.media = await MediaModerationService.stripRejectedMedia(group.media, m => m.mediaUrl);
    }
     if (group.aboutGallery?.length) {                                // ← new
      group.aboutGallery = await MediaModerationService.stripRejectedMedia(
        group.aboutGallery,
        m => m.mediaUrl
      );
    }
    if (group.featuredContent?.length) {
      group.featuredContent = await MediaModerationService.stripRejectedMedia(
        group.featuredContent,
        c => c.mediaUrl
      );
    }
    // Group-level status (cover) — drives joins-paused messaging + owner banner
    group.moderationStatus = await MediaModerationService.statusOf(MEDIA_ENTITY.GROUP, group.id);

    let currentUserMembership = null;
    console.log('Current User ID:', currentUserId);
    let isSubscribed = null;
    if (currentUserId) {
      const membership = await checkGroupMembership(group.id, currentUserId);
      isSubscribed = await GroupDiscussionNotificationService.isSubscribed(group.id, currentUserId);
      if (membership) {
        currentUserMembership = {
          role: membership.role,
          status: membership.status,
          isJoined: membership.status === 'joined',
          joinedAt: membership.joinedAt,
        };
      } else {
        const pendingRequest = await checkPendingJoinRequest(group.id, currentUserId);
        if (pendingRequest) {
          currentUserMembership = { status: 'pending' };
        }
      }
    }
    console.log(currentUserMembership, 'currentUserMembership', 'membership');
    const groupTagsList = await GroupTagService.getGroupTags(group.id);

    const groupFilterEnabled = await TextModerationService.getFilterEnabled(currentUserId);
    await TextModerationService.maskFlaggedTextSingle(group, {
      entityType: TEXT_ENTITY.GROUP,
      fields: ['name', 'description'],
      filterEnabled: groupFilterEnabled,
    });

    return {
      ...group,
      currentUserMembership,
      isSubscribed,
      memberCount: await getGroupMemberCount(group.id),
      upcomingEvents: await getNextTwoEventsByGroupId(group.id),
      groupTags: groupTagsList,
      // Soft-deleted products drop out on read, same as a post's linked products.
      shopProducts: (group.shopProducts ?? [])
        .filter(link => link.product && !link.product.deletedAt)
        .map(({ product: { deletedAt: _deletedAt, ...product } }) => product),
    };
  }

  static async updateGroup(groupId, userId, groupData, isPlus = false) {
    await requireGroupAdmin(groupId, userId, 'Unauthorized to update this group.');

    const { media,aboutGallery, featuredContent, shopProductIds, ...groupFields } = groupData;

    const oldGroup = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      with: { media: true,aboutGallery: true, featuredContent: true, shopProducts: true },
    });

    if (!oldGroup) throw new ApiError(404, 'Group not found.');

    if (media !== undefined && media.length > MAX_GROUP_MEDIA) {
      throw new ApiError(400, `Maximum ${MAX_GROUP_MEDIA} media items allowed.`);
    }
    if (featuredContent !== undefined && featuredContent.length > MAX_FEATURED_CONTENT) {
      throw new ApiError(400, `Maximum ${MAX_FEATURED_CONTENT} featured content items allowed.`);
    }

    // Both Plus-gated, but only on change. The settings form round-trips the
    // current values, so gating on presence would 403 an organizer whose Plus
    // lapsed out of editing their group at all — including out of removing the
    // link. `undefined` leaves the value alone; null / [] clears it, matching how
    // media and featuredContent already behave here.
    if (groupFields.linkButton !== undefined) {
      const same =
        JSON.stringify(groupFields.linkButton ?? null) ===
        JSON.stringify(oldGroup.linkButton ?? null);
      groupFields.linkButton = same
        ? oldGroup.linkButton
        : sanitizeLinkButton(groupFields.linkButton, isPlus, 'group');
    }

    const oldProductIds = (oldGroup.shopProducts ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(link => link.productId);
    let resolvedProductIds;
    if (shopProductIds !== undefined) {
      const next = shopProductIds ?? [];
      const same =
        next.length === oldProductIds.length && next.every((id, i) => id === oldProductIds[i]);
      resolvedProductIds = same
        ? undefined // nothing to rewrite, and no gate to apply
        : await this._resolveGroupShopProducts(userId, next, isPlus);
    }

    if (
      groupFields.coverImageUrl !== undefined &&
      groupFields.coverImageUrl !== oldGroup.coverImageUrl
    ) {
      try {
        if (oldGroup.coverImageUrl) {
          const file = await FileManagementService.findByUrlOrKey(oldGroup.coverImageUrl);
          if (file) await FileManagementService.decrementReference(file.id);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up old group cover image:', cleanupError);
      }
    }

    if (media !== undefined) {
      await this.deleteAllGroupMedia(groupId, oldGroup.media);
      if (media.length > 0) await this.createGroupMedia(groupId, userId, media);
    }

    if (aboutGallery !== undefined) {                                // ← new
      await this.deleteAllGroupAboutGallery(groupId, oldGroup.aboutGallery);
      if (aboutGallery.length > 0)
        await this.createGroupAboutGallery(groupId, userId, aboutGallery);
    }

    if (featuredContent !== undefined) {
      await this.deleteAllGroupFeaturedContent(groupId, oldGroup.featuredContent);
      if (featuredContent.length > 0)
        await this.createGroupFeaturedContent(groupId, userId, featuredContent);
    }

    if (resolvedProductIds !== undefined) {
      await this._writeGroupShopProducts(groupId, resolvedProductIds);
    }

    let newSlug = oldGroup.slug;
    if (groupFields.name && shouldRegenerateSlug(oldGroup.name, groupFields.name)) {
      newSlug = await createUniqueSlugForGroup(groupFields.name, groupId);
    }

    await this.enforceGroupPrivacyRules(groupFields, groupId);

    const groupTextEntries = [
      ['name', groupFields.name],
      ['description', groupFields.description],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    let groupModeration = { action: 'keep' };
    if (groupTextEntries.length > 0) {
      groupModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.GROUP,
        entityId: groupId,
        entityCreatorId: userId,
        texts: groupTextEntries.map(([, value]) => value),
      });
    }

    const [updatedGroup] = await db
      .update(groups)
      .set({ ...groupFields, slug: newSlug, updatedAt: new Date() })
      .where(eq(groups.id, groupId))
      .returning();

    if (!updatedGroup) throw new ApiError(404, 'Group not found.');

    await TextModerationService.recordIfFlagged(groupModeration, {
      entityType: TEXT_ENTITY.GROUP,
      entityId: groupId,
      userId,
      fieldNames: groupTextEntries.map(([name]) => name),
      texts: groupTextEntries.map(([, value]) => value),
    });

    // Recompute cover moderation — replacing a rejected cover unblocks joins
    if (updatedGroup.coverImageUrl) {
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.GROUP,
        entityId: groupId,
        userId,
        ...MediaModerationService.splitUrls([updatedGroup.coverImageUrl]),
      });
    }

    // Sync the default subscription tier when subscriptionPrice changes on a paid private group
    const priceChanged =
      groupFields.subscriptionPrice !== undefined &&
      parseFloat(groupFields.subscriptionPrice) !== parseFloat(oldGroup.subscriptionPrice ?? 0);
    const justBecamePaid = groupFields.isPaid === true && !oldGroup.isPaid;
    const nowPaid = updatedGroup.isPaid;

    if (nowPaid && (priceChanged || justBecamePaid) && updatedGroup.subscriptionPrice) {
      try {
        const { GroupSubscriptionService } = await import('./groupSubscription.service.js');
        const existingTiers = await GroupSubscriptionService.getTiers(groupId);
        if (existingTiers.length > 0) {
          await GroupSubscriptionService.updateTier(existingTiers[0].id, oldGroup.createdBy, {
            price: updatedGroup.subscriptionPrice,
          });
        } else {
          await GroupSubscriptionService.createTier(groupId, oldGroup.createdBy, {
            name: 'Membership',
            price: updatedGroup.subscriptionPrice,
            billingInterval: 'monthly',
          });
        }
      } catch (tierErr) {
        console.error('Failed to sync default subscription tier:', tierErr);
      }
    }

    try {
      const updaterUser = await getUserInformation(userId);
      const groupAdmin = await getGroupAdmin(groupId);

      if (groupAdmin && groupAdmin.email && groupAdmin.userId !== userId) {
        const updaterName = `${updaterUser.firstName} ${updaterUser.lastName}`;
        const groupName = updatedGroup.name;
        const changes = [];

        if (groupFields.name && groupFields.name !== oldGroup.name)
          changes.push(`• Group Name: "${oldGroup.name}" → "${groupFields.name}"`);
        if (groupFields.description && groupFields.description !== oldGroup.description)
          changes.push(`• Description: Updated`);
        if (groupFields.coverImageUrl && groupFields.coverImageUrl !== oldGroup.coverImageUrl)
          changes.push(`• Cover Image: Updated`);
        if (groupFields.isPublic !== undefined && groupFields.isPublic !== oldGroup.isPublic)
          changes.push(
            `• Privacy: ${oldGroup.isPublic ? 'Public' : 'Private'} → ${groupFields.isPublic ? 'Public' : 'Private'}`
          );
        if (groupFields.isPaid !== undefined && groupFields.isPaid !== oldGroup.isPaid)
          changes.push(
            `• Paid Status: ${oldGroup.isPaid ? 'Paid' : 'Free'} → ${groupFields.isPaid ? 'Paid' : 'Free'}`
          );
        if (media !== undefined)
          changes.push(
            `• Media: Updated (${oldGroup.media?.length || 0} → ${media.length} item(s))`
          );
        if (featuredContent !== undefined)
          changes.push(
            `• Featured Content: Updated (${oldGroup.featuredContent?.length || 0} → ${featuredContent.length} item(s))`
          );

        if (changes.length > 0) {
          const subject = `Group Settings Updated - ${groupName}`;
          let message = `Hello ${groupAdmin.firstName},\n\n`;
          message += `${updaterName} has updated the settings for the group "${groupName}".\n\n`;
          message += `Changes Made:\n${changes.join('\n')}\n\n`;
          message += `This is an automated notification to keep you informed of group changes.`;
          await mailService.sendGeneralEmail({ to: groupAdmin.email, subject, message });
        }
      }
    } catch (emailError) {
      console.error('Error sending group update notification email:', emailError);
    }

    return this.getGroupById(updatedGroup.id, userId);
  }

  static async deleteAllGroupMedia(groupId, existingMedia = []) {
    for (const media of existingMedia) {
      try {
        const file = await FileManagementService.findByUrlOrKey(media.mediaUrl);
        if (file) await FileManagementService.decrementReference(file.id);
      } catch (error) {
        console.error(`Error cleaning up media file ${media.id}:`, error);
      }
    }
    await db.delete(groupMedia).where(eq(groupMedia.groupId, groupId));
  }

  static async deleteAllGroupFeaturedContent(groupId, existingContent = []) {
    for (const content of existingContent) {
      if (content.mediaUrl) {
        try {
          const file = await FileManagementService.findByUrlOrKey(content.mediaUrl);
          if (file) await FileManagementService.decrementReference(file.id);
        } catch (error) {
          console.error(`Error cleaning up featured content file ${content.id}:`, error);
        }
      }
    }
    await db.delete(groupFeaturedContent).where(eq(groupFeaturedContent.groupId, groupId));
  }

  static async deleteGroup(groupId, userId) {
    await requireGroupAdmin(groupId, userId, 'Unauthorized to delete this group.');

    const groupData = await db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), sql`${groups.deletedAt} IS NULL`),
      with: { media: true,aboutGallery: true, featuredContent: true },
    });

    if (!groupData) throw new ApiError(404, 'Group not found or already deleted.');

    try {
      if (groupData.coverImageUrl) {
        const file = await FileManagementService.findByUrlOrKey(groupData.coverImageUrl);
        if (file) await FileManagementService.decrementReference(file.id);
      }
      if (groupData.media?.length > 0) {
        for (const media of groupData.media) {
          const file = await FileManagementService.findByUrlOrKey(media.mediaUrl);
          if (file) await FileManagementService.decrementReference(file.id);
        }
      }

       if (groupData.aboutGallery?.length > 0) {                              // ← new
      for (const item of groupData.aboutGallery) {
        const file = await FileManagementService.findByUrlOrKey(item.mediaUrl);
        if (file) await FileManagementService.decrementReference(file.id);
      }
    }
      if (groupData.featuredContent?.length > 0) {
        for (const content of groupData.featuredContent) {
          if (content.mediaUrl) {
            const file = await FileManagementService.findByUrlOrKey(content.mediaUrl);
            if (file) await FileManagementService.decrementReference(file.id);
          }
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up group media files:', cleanupError);
    }

    await this.deleteAllGroupDiscussions(groupId);

    const [deletedGroup] = await db
      .update(groups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(groups.id, groupId), sql`${groups.deletedAt} IS NULL`))
      .returning({ id: groups.id });

    if (!deletedGroup) throw new ApiError(404, 'Group not found or already deleted.');

    await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  }

  static async publishGroup(groupId, userId) {
    await verifyGroupMembership(groupId, userId, {
      role: ['creator', 'admin'],
      errorMessage: 'Unauthorized to publish this group.',
    });

    if ((await MediaModerationService.statusOf(MEDIA_ENTITY.GROUP, groupId)) === 'rejected') {
      throw new ApiError(
        422,
        'This group cannot be published — an image was removed for violating our community guidelines. Replace it and try again.',
        true,
        '',
        { code: 'GROUP_CONTENT_PAUSED' }
      );
    }

    const [updatedGroup] = await db
      .update(groups)
      .set({ isPublic: true, updatedAt: new Date() })
      .where(eq(groups.id, groupId))
      .returning();

    if (!updatedGroup) throw new ApiError(404, 'Group not found.');
    return updatedGroup;
  }

  static async getGroupAnalytics(groupId, userId) {
    await verifyGroupMembership(groupId, userId, {
      errorMessage: 'Unauthorized to view analytics for this group.',
    });

    const memberCount = await db
      .select({ count: count() })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')));

    const pendingRequests = await db
      .select({ count: count() })
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, 'pending')));

    return {
      groupId,
      memberCount: memberCount[0].count,
      pendingJoinRequests: pendingRequests[0].count,
    };
  }

  static async getMyGroups(userId) {
    const myGroups = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        coverImageUrl: groups.coverImageUrl,
        city: groups.city,
        slug: groups.slug,
        state: groups.state,
        isPublic: groups.isPublic,
        isPaid: groups.isPaid,
        subscriptionPrice: groups.subscriptionPrice,
        requiresApproval: groups.requiresApproval,
        maxMembers: groups.maxMembers,
        memberCount: groups.memberCount,
        categoryId: groups.categoryId,
        createdBy: groups.createdBy,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
        deletedAt: groups.deletedAt,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, 'joined')))
      .orderBy(desc(groups.createdAt));

    const groupIds = myGroups.map(group => group.id);
    const memberships =
      groupIds.length > 0
        ? await db
            .select()
            .from(groupMembers)
            .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, userId)))
        : [];

    const myGroupsWithMembership = myGroups.map(group => ({
      ...group,
      userMembership: getCurrentUserMembership(memberships, group.id),
    }));

    for (const group of myGroupsWithMembership) {
      group.groupTags = await GroupTagService.getGroupTags(group.id);
    }

    await MediaModerationService.attachGroupModerationStatuses(myGroupsWithMembership);

    const myGroupsFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedText(myGroupsWithMembership, {
      entityType: TEXT_ENTITY.GROUP,
      fields: ['name', 'description'],
      filterEnabled: myGroupsFilterEnabled,
    });

    return myGroupsWithMembership;
  }

  static async getPendingJoinRequests(userId, groupId) {
    const group = await this.getGroupById(groupId);
    if (!group) throw new ApiError(404, 'Group not found');

    const pendingRequests = await db
      .select({
        id: groupJoinRequests.id,
        status: groupJoinRequests.status,
        createdAt: groupJoinRequests.createdAt,
        userId: groupJoinRequests.userId,
        groupId: groupJoinRequests.groupId,
        firstName: users.firstName,
        answers: groupJoinRequests.answers,
        lastName: users.lastName,
        email: users.email,
        image: users.image,
        username: users.username,
      })
      .from(groupJoinRequests)
      .leftJoin(users, eq(users.id, groupJoinRequests.userId))
      .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, 'pending')))
      .orderBy(desc(groupJoinRequests.createdAt));

    return {
      success: true,
      data: { groupId, total: pendingRequests.length, requests: pendingRequests },
    };
  }

  static async updateJoinRequestStatus(userId, requestId, status) {
    const [joinRequest] = await db
      .update(groupJoinRequests)
      .set({ status, updated_at: new Date(), is_completed: true })
      .where(eq(groupJoinRequests.id, requestId))
      .returning();

    if (!joinRequest) throw new ApiError(404, 'Join request not found');

    const group = await this.getGroupById(joinRequest.groupId);

    if (status === 'approved') {
      try {
        const newMember = await GroupMemberService.addMember({
          groupId: joinRequest.groupId,
          addedBy: userId,
          userId: joinRequest.userId,
          role: 'member',
        });

        // Auto-subscribe newly approved member to group discussion notifications
        try {
          await GroupDiscussionNotificationService.subscribe(
            joinRequest.groupId,
            joinRequest.userId
          );
        } catch (subscribeError) {
          console.error('Error auto-subscribing approved member to notifications:', subscribeError);
        }

        const userData = await getUserInformation(joinRequest.userId);

        if (group.isPaid) {
          await sendPaidGroupSubscriptionEmail(userData.email, {
            user_name: `${userData.firstName} ${userData.lastName}`,
            group_name: group.name,
            organizer_name: 'The Organizer',
            membership_price: group.subscriptionPrice
              ? `$${parseFloat(group.subscriptionPrice).toFixed(2)}`
              : '$0.00',
            next_billing_date: 'N/A',
          }).catch(err => console.error('Paid group welcome email failed:', err.message));
        } else {
          await mailService.sendGeneralEmail({
            to: userData.email,
            subject: `Welcome to ${group.name}!`,
            message: `Congratulations! Your request to join the group "${group.name}" has been approved. You are now a member of the group and can participate in all group activities and discussions.`,
          });
        }

        await createNotification({
          userId: joinRequest.userId,
          title: 'Group Join Request Approved',
          message: `Your request to join "${group.name}" was approved!`,
          type: 'group_activity',
          relatedId: joinRequest.groupId,
          redirectTo: `/groups/${group.slug}`,
          metadata: { ...joinRequest, actorUserId: userId },
        });

        await db.delete(groupJoinRequests).where(eq(groupJoinRequests.id, requestId));

        return { joinRequest, newMember };
      } catch (error) {
        console.error('Error adding member after approval:', error);
        throw new ApiError(500, 'Could not add member after approval.');
      }
    } else if (status === 'rejected') {
      await createNotification({
        userId: joinRequest.userId,
        title: 'Group Join Request Rejected',
        message: `Your request to join "${group.name}" was rejected.`,
        type: 'group_activity',
        relatedId: joinRequest.groupId,
        redirectTo: `/groups/${group.slug}`,
        metadata: { ...joinRequest, actorUserId: userId },
      });
    }

    await db.delete(groupJoinRequests).where(eq(groupJoinRequests.id, requestId));
    return joinRequest;
  }

  /**
   * @desc Allows a user to join a group (or submits a request if the group requires approval).
   * On direct join, the user is automatically subscribed to group discussion notifications.
   */
  static async joinGroup(userId, groupId, answers = []) {
    const group = await this.getGroupById(groupId);
    if (!group) throw new ApiError(404, 'Group not found');

    // Joins paused while the group has removed cover content
    if ((await MediaModerationService.statusOf(MEDIA_ENTITY.GROUP, groupId)) === 'rejected') {
      throw new ApiError(
        403,
        'Joining this group is paused due to a content violation.',
        true,
        '',
        { code: 'GROUP_CONTENT_PAUSED' }
      );
    }

    const existingEntry = await checkGroupMembership(groupId, userId);
    if (existingEntry?.status === 'joined') {
      throw new ApiError(400, 'You are already a member of this group.');
    }

    // For paid groups — skip creating any join request here.
    // The join request (with answers snapshot) is created only when checkout completes.
    if (group.isPaid) {
      // Snapshot answers so we can pass them to checkout metadata if needed,
      // but do NOT insert a DB row.
      await GroupQuestionService.validateAndSnapshot(groupId, answers).catch(() => {});

      return {
        status: 'awaiting_payment',
        redirectTo: `/groups/${group.slug}/subscription`,
      };
    }

    // ── Free group flow unchanged below ──
    const answersSnapshot = await GroupQuestionService.validateAndSnapshot(groupId, answers);

    const existingRequest = await checkPendingJoinRequest(groupId, userId);
    if (existingRequest) {
      throw new ApiError(400, 'Your request to join this group is already pending.');
    }

    if (group.isPublic && !group.requiresApproval) {
      const [newMember] = await db
        .insert(groupMembers)
        .values({ groupId, userId, role: 'member', status: 'joined', joinedAt: new Date() })
        .returning();

      await GroupService.incrementGroupMemberCount(groupId);

      try {
        await GroupDiscussionNotificationService.subscribe(groupId, userId);
      } catch (e) {
        console.error('Error auto-subscribing:', e);
      }

      try {
        const userData = await getUserInformation(userId);
        await mailService.sendGeneralEmail({
          to: userData.email,
          subject: `Welcome to ${group.name}!`,
          message: `Hello ${userData.firstName},\n\nYou have successfully joined "${group.name}".`,
        });
      } catch (e) {
        console.error('Welcome email error:', e);
      }

      return { status: 'joined', member: newMember };
    } else {
      const [joinRequest] = await db
        .insert(groupJoinRequests)
        .values({
          groupId,
          userId,
          status: 'pending',
          answers: answersSnapshot,
          createdAt: new Date(),
        })
        .returning();

      const adminsAndMods = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, groupId), inArray(groupMembers.role, ['admin', 'moderator']))
        );

      const requesterName = await getActorDisplayName(userId);
      for (const member of adminsAndMods) {
        await createNotification({
          userId: member.userId,
          title: 'New Group Join Request',
          message: `${requesterName} wants to join "${group.name}".`,
          type: 'group_activity',
          relatedId: groupId,
          redirectTo: `/groups/${group.slug}/settings`,
          metadata: { ...joinRequest, actorUserId: userId },
        });
      }

      return { status: 'pending', request: joinRequest };
    }
  }

  /**
   * @desc Allows a user to leave a group.
   * The user is automatically unsubscribed from group discussion notifications on leave.
   */
  static async leaveGroup(userId, groupId) {
    const group = await this.getGroupById(groupId);
    if (!group) throw new ApiError(404, 'Group not found');

    const membership = await verifyGroupMembership(groupId, userId, {
      errorMessage: 'You are not a member of this group',
      errorCode: 400,
    });

    if (membership.role === 'admin') {
      throw new ApiError(
        400,
        'Group admin cannot leave the group. Transfer ownership or delete the group instead.'
      );
    }

    if (group.isPaid) {
      const activeSubscription = await GroupSubscriptionService.getMyGroupSubscription(
        userId,
        groupId
      );
      if (activeSubscription) {
        await GroupSubscriptionService.cancelGroupSubscription(userId, groupId);
      }
    }

    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

    await GroupService.decrementGroupMemberCount(groupId);

    // Unsubscribe from group discussion notifications on leave
    try {
      await GroupDiscussionNotificationService.unsubscribe(groupId, userId);
    } catch (unsubscribeError) {
      // Subscription may not exist — not an error worth surfacing
      console.error(
        'Error unsubscribing user from group notifications on leave:',
        unsubscribeError
      );
    }

    return true;
  }

  static async getGroupsLocation({ country, state, userId, search }) {
    const whereConditions = [];
    if (country) whereConditions.push(eq(groups.country, country));
    if (state) whereConditions.push(eq(groups.state, state));
    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push(
        sql`${groups.city} ILIKE ${searchTerm} OR ${groups.address} ILIKE ${searchTerm}`
      );
    }

    const groupLocations = await db.query.groups.findMany({
      columns: {
        country: true,
        state: true,
        countryCode: true,
        city: true,
        latitude: true,
        longitude: true,
        address: true,
      },
      where: and(...whereConditions),
    });
    return groupLocations;
  }
}

export class GroupCategoryService {
  static async createGroupCategory(data) {
    const [category] = await db
      .insert(groupCategories)
      .values({ ...data, createdAt: new Date() })
      .returning();
    return category;
  }

  static async getGroupCategories() {
    return db.select().from(groupCategories).orderBy(desc(groupCategories.createdAt));
  }

  static async deleteGroupCategory(categoryId) {
    const [deleted] = await db
      .delete(groupCategories)
      .where(eq(groupCategories.id, categoryId))
      .returning();
    if (!deleted) throw new ApiError(404, 'Group category not found');
    return deleted;
  }

  static async updateGroupCategory(categoryId, data) {
    const [updated] = await db
      .update(groupCategories)
      .set(data)
      .where(eq(groupCategories.id, categoryId))
      .returning();
    if (!updated) throw new ApiError(404, 'Group category not found');
    return updated;
  }
}

export class GroupEventPromotionService {
  static async createPromotions({ groupIds, eventId, userId, message }) {
    const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw new ApiError(404, 'Event not found');

    const groupsArray = Array.isArray(groupIds) ? groupIds : [groupIds];

    const groupChecks = await Promise.all(
      groupsArray.map(async groupId => {
        try {
          const [group] = await db
            .select()
            .from(groups)
            .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
            .limit(1);

          console.log('Checking promotion for group');
          if (!group) return { groupId, error: 'Group not found or inactive' };

          const [existingPromotion] = await db
            .select()
            .from(groupEventPromotions)
            .where(
              and(
                eq(groupEventPromotions.groupId, groupId),
                eq(groupEventPromotions.eventId, eventId)
              )
            )
            .limit(1);

          if (existingPromotion) return { groupId, error: 'Event already promoted in this group' };

          return { groupId, valid: true };
        } catch (error) {
          console.error(`Error checking group ${groupId}:`, error);
          return { groupId, error: 'Internal error checking group' };
        }
      })
    );

    console.log('Group Checks:', groupChecks);
    const validGroups = [];
    const errors = [];
    groupChecks.forEach(check => {
      if (check.valid) validGroups.push(check.groupId);
      else errors.push(`Group ${check.groupId}: ${check.error}`);
    });

    if (validGroups.length === 0) {
      throw new ApiError(400, 'No valid groups to promote event to. ' + errors.join('; '));
    }

    const promotions = await db
      .insert(groupEventPromotions)
      .values(
        validGroups.map(groupId => ({
          groupId,
          eventId,
          promotedBy: userId,
          message: message || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )
      .returning();

    for (const groupId of validGroups) {
      await notifyGroupEventPromotion(groupId, eventId);
    }

    return {
      message: `Event promoted successfully in ${validGroups.length} group${validGroups.length > 1 ? 's' : ''}`,
      promotions,
      warnings: errors.length > 0 ? errors : undefined,
    };
  }

  static async getGroupPromotions(groupId, { page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;

    const group = await db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), sql`${groups.deletedAt} IS NULL`),
    });
    if (!group) throw new ApiError(404, 'Group not found or inactive');

    const [promotions, total] = await Promise.all([
      db
        .select({
          id: groupEventPromotions.id,
          message: groupEventPromotions.message,
          createdAt: groupEventPromotions.createdAt,
          eventId: events.id,
          eventTitle: events.title,
          eventStartDate: events.startDate,
          eventEndDate: events.endDate,
          eventCoverImageUrl: events.coverImageUrl,
          promoterId: users.id,
          promoterName: users.name,
        })
        .from(groupEventPromotions)
        .leftJoin(events, eq(events.id, groupEventPromotions.eventId))
        .leftJoin(users, eq(users.id, groupEventPromotions.promotedBy))
        .where(eq(groupEventPromotions.groupId, groupId))
        .orderBy(desc(groupEventPromotions.createdAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ count: count() })
        .from(groupEventPromotions)
        .where(eq(groupEventPromotions.groupId, groupId)),
    ]);

    const formattedPromotions = promotions.map(p => ({
      id: p.id,
      message: p.message,
      createdAt: p.createdAt,
      event: {
        id: p.eventId,
        title: p.eventTitle,
        startDate: p.eventStartDate,
        endDate: p.eventEndDate,
        coverImageUrl: p.eventCoverImageUrl,
      },
      promoter: { id: p.promoterId, name: p.promoterName },
    }));

    return {
      data: formattedPromotions,
      pagination: {
        page,
        limit,
        total: Number(total[0]?.count ?? 0),
        pages: Math.ceil(Number(total[0]?.count ?? 0) / limit),
      },
    };
  }

  static async deletePromotion(promotionId, userId) {
    const promotion = await db.query.groupEventPromotions.findFirst({
      where: eq(groupEventPromotions.id, promotionId),
    });
    if (!promotion) throw new ApiError(404, 'Promotion not found');

    const userRole = await checkGroupMembership(promotion.groupId, userId, {
      role: ['admin', 'creator'],
    });
    if (!userRole && promotion.promotedBy !== userId) {
      throw new ApiError(403, 'Unauthorized to delete this promotion');
    }

    await db.delete(groupEventPromotions).where(eq(groupEventPromotions.id, promotionId));
    return { success: true };
  }
}

export class GroupMemberService {
  static async addMember({ groupId, addedBy, userId, role = 'member' }) {
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
    if (!group) throw new ApiError(404, 'Group not found');

    const [existing] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    if (existing) throw new ApiError(400, 'User is already a member of this group');

    const adder = await checkGroupMembership(groupId, addedBy, { role: ['admin', 'owner'] });
    const isSelfJoin = addedBy === userId;
    const isAuthorized = group.createdBy === addedBy || adder !== null;

    if (!isAuthorized && !isSelfJoin) {
      throw new ApiError(403, 'Not authorized to add members to this group');
    }

    const [member] = await db
      .insert(groupMembers)
      .values({ groupId, userId, role, joinedAt: new Date(), status: 'joined' })
      .returning();

    await GroupService.incrementGroupMemberCount(groupId);
    return member;
  }

  static async getMembers(groupId, requesterId, { page = 1, limit = 20, search = '' }) {
    const [requester] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, requesterId)));

    const offset = (page - 1) * limit;

    return db
      .select({
        id: groupMembers.id,
        role: groupMembers.role,
        status: groupMembers.status,
        joinedAt: groupMembers.joinedAt,
        userId: groupMembers.userId,
        userName: users.username,
        userEmail: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        image: users.image,
        bio: users.bio,
        phoneNumber: users.phoneNumber,
      })
      .from(groupMembers)
      .leftJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(desc(groupMembers.joinedAt))
      .limit(limit)
      .offset(offset);
  }

  static async updateMemberRole({ groupId, targetUserId, performedBy, role, status }) {
    const actor = await verifyGroupMembership(groupId, performedBy, {
      role: ['admin', 'owner'],
      errorMessage: 'You are not authorized to update member roles',
    });

    const [updated] = await db
      .update(groupMembers)
      .set({ ...(role && { role }), ...(status && { status }) })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
      .returning();

    if (!updated) throw new ApiError(404, 'Member not found');

    if (role === 'admin' && actor.role === 'admin') {
      await db
        .update(groupMembers)
        .set({ role: 'moderator' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, performedBy)));
    }

    try {
      const [group, targetUser, performerUser] = await Promise.all([
        db.select().from(groups).where(eq(groups.id, groupId)).limit(1),
        getUserInformation(targetUserId),
        getUserInformation(performedBy),
      ]);

      if (group[0]) {
        const performerName = `${performerUser.firstName} ${performerUser.lastName}`;
        const targetName = `${targetUser.firstName} ${targetUser.lastName}`;
        const groupName = group[0].name;
        const groupAdmin = await getGroupAdmin(groupId);

        if (groupAdmin && groupAdmin.email && groupAdmin.userId !== performedBy) {
          let message = `Hello ${groupAdmin.firstName},\n\n`;
          message += `${performerName} has updated member permissions in the group "${groupName}".\n\n`;
          message += `Updated Member: ${targetName}\n`;
          if (role) message += `New Role: ${role.charAt(0).toUpperCase() + role.slice(1)}\n`;
          if (status)
            message += `New Status: ${status.charAt(0).toUpperCase() + status.slice(1)}\n`;
          message += `\nThis is an automated notification to keep you informed of group changes.`;

          await mailService.sendGeneralEmail({
            to: groupAdmin.email,
            subject: `Group Member Role Updated - ${groupName}`,
            message,
          });
        }

        if (targetUser.email && performedBy !== targetUserId) {
          let message = `Hello ${targetUser.firstName},\n\n`;
          message += `Your role in the group \"${groupName}\" has been updated by ${performerName}.\n\n`;
          if (role) message += `Your New Role: ${role.charAt(0).toUpperCase() + role.slice(1)}\n`;
          if (status)
            message += `Your Status: ${status.charAt(0).toUpperCase() + status.slice(1)}\n`;
          message += `\nThank you for being a part of our community!`;

          await mailService.sendGeneralEmail({
            to: targetUser.email,
            subject: `Your Role in ${groupName} Has Been Updated`,
            message,
          });

          await createNotification({
            userId: targetUserId,
            title: 'Group Role Updated',
            message: `Your role in "${groupName}" has been updated.`,
            type: 'group_activity',
            relatedId: groupId,
            redirectTo: `/groups/${group[0].slug}`,
            metadata: { newRole: role, newStatus: status, groupId, actorUserId: performedBy },
          });
        }
      }
    } catch (emailError) {
      console.error('Error sending role update notification email:', emailError);
    }

    return updated;
  }

  /**
   * @desc Remove a member from a group.
   * The removed member is automatically unsubscribed from group discussion notifications.
   */
  static async removeMember({ groupId, targetUserId, performedBy }) {
    if (performedBy !== targetUserId) {
      await verifyGroupMembership(groupId, performedBy, {
        role: ['admin', 'owner'],
        errorMessage: 'You are not authorized to remove this member',
      });
    }

    const [targetUser, group, performerUser] = await Promise.all([
      getUserInformation(targetUserId),
      db.select().from(groups).where(eq(groups.id, groupId)).limit(1),
      performedBy !== targetUserId ? getUserInformation(performedBy) : null,
    ]);
    if (group.isPaid) {
      const activeSubscription = await GroupSubscriptionService.getMyGroupSubscription(
        targetUserId,
        groupId
      );
      if (activeSubscription) {
        await GroupSubscriptionService.cancelGroupSubscription(targetUserId, groupId);
      }
    }
    const [deleted] = await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
      .returning();

    if (!deleted) throw new ApiError(404, 'Member not found in group');

    await GroupService.decrementGroupMemberCount(groupId);

    // Unsubscribe removed member from group discussion notifications
    try {
      await GroupDiscussionNotificationService.unsubscribe(groupId, targetUserId);
    } catch (unsubscribeError) {
      // Subscription may not exist — not an error worth surfacing
      console.error(
        'Error unsubscribing removed member from group notifications:',
        unsubscribeError
      );
    }

    try {
      if (targetUser.email && group[0]) {
        const groupName = group[0].name;
        const isRemovalBySelf = performedBy === targetUserId;
        let subject, message;

        if (isRemovalBySelf) {
          subject = `You have left ${groupName}`;
          message = `Hello ${targetUser.firstName},\n\nYou have successfully left the group "${groupName}".\n\nYou're always welcome to rejoin the group in the future!\n\nThank you for being a part of our community.`;
        } else {
          const removerName = performerUser
            ? `${performerUser.firstName} ${performerUser.lastName}`
            : 'an administrator';
          subject = `You have been removed from ${groupName}`;
          message = `Hello ${targetUser.firstName},\n\nYou have been removed from the group "${groupName}" by ${removerName}.\n\nIf you believe this was a mistake or would like more information, please contact the group administrator.\n\nThank you for your participation.`;
        }

        await mailService.sendGeneralEmail({ to: targetUser.email, subject, message });
      }
    } catch (emailError) {
      console.error('Error sending member removal notification email:', emailError);
    }

    if (group[0] && performedBy !== targetUserId) {
      await createNotification({
        userId: targetUserId,
        title: 'Removed from Group',
        message: `You have been removed from the group "${group[0].name}".`,
        type: 'group_activity',
        relatedId: groupId,
        redirectTo: `/groups/${group[0].slug}`,
        metadata: { groupId, actorUserId: performedBy },
      });
    }

    return deleted;
  }
}

export class GroupTagService {
  static async addTagsToGroup(groupId, userId, tagNames) {
    if (!tagNames || tagNames.length === 0) return [];

    return await db.transaction(async tx => {
      const uniqueNames = [...new Set(tagNames.map(n => n.trim().toLowerCase()))];

      await tx
        .insert(tags)
        .values(uniqueNames.map(name => ({ name })))
        .onConflictDoNothing();

      const existingTags = await tx.select().from(tags).where(inArray(tags.name, uniqueNames));

      const tagLinks = existingTags.map(tag => ({ groupId, tagId: tag.id }));
      await tx.insert(groupTags).values(tagLinks).onConflictDoNothing();

      return existingTags;
    });
  }

  static async getGroupTags(groupId) {
    return db
      .select({ id: tags.id, name: tags.name })
      .from(groupTags)
      .innerJoin(tags, eq(groupTags.tagId, tags.id))
      .where(eq(groupTags.groupId, groupId));
  }

  static async removeTagFromGroup(groupId, tagId, userId) {
    return db
      .delete(groupTags)
      .where(and(eq(groupTags.groupId, groupId), eq(groupTags.tagId, tagId)));
  }

  static async getGroupsByTags({ tags: searchTags, page, limit }) {
    const offset = (page - 1) * limit;

    const groupIdsQuery = db
      .select({ groupId: groupTags.groupId })
      .from(groupTags)
      .innerJoin(tags, eq(groupTags.tagId, tags.id))
      .where(
        inArray(
          tags.name,
          searchTags.map(t => t.toLowerCase())
        )
      )
      .groupBy(groupTags.groupId);

    const data = await db
      .select()
      .from(groups)
      .where(inArray(groups.id, groupIdsQuery))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(groups.createdAt));

    const totalCount = await db
      .select({ count: sql`count(*)` })
      .from(groups)
      .where(inArray(groups.id, groupIdsQuery));

    await MediaModerationService.attachGroupModerationStatuses(data);

    return {
      data,
      meta: { total: Number(totalCount[0].count), page, limit },
    };
  }
}

export class GroupDiscussionNotificationService {
  /**
   * @desc Subscribe a user to receive notifications for new discussions in a group.
   * Called automatically when a user joins or is approved to join a group.
   */
  static async subscribe(groupId, userId) {
    await verifyGroupMembership(groupId, userId, {
      errorMessage: 'You must be a member of the group to subscribe to notifications',
    });

    const existing = await db.query.groupDiscussionNotifications.findFirst({
      where: and(
        eq(groupDiscussionNotifications.groupId, groupId),
        eq(groupDiscussionNotifications.userId, userId)
      ),
    });

    if (existing) return { alreadySubscribed: true, subscription: existing };

    const [subscription] = await db
      .insert(groupDiscussionNotifications)
      .values({ groupId, userId, createdAt: new Date() })
      .returning();

    return { alreadySubscribed: false, subscription };
  }

  /**
   * @desc Unsubscribe a user from group discussion notifications.
   * Called automatically when a user leaves or is removed from a group.
   */
  static async unsubscribe(groupId, userId) {
    const [deleted] = await db
      .delete(groupDiscussionNotifications)
      .where(
        and(
          eq(groupDiscussionNotifications.groupId, groupId),
          eq(groupDiscussionNotifications.userId, userId)
        )
      )
      .returning();

    if (!deleted) throw new ApiError(404, 'Subscription not found');
    return deleted;
  }

  static async isSubscribed(groupId, userId) {
    const subscription = await db.query.groupDiscussionNotifications.findFirst({
      where: and(
        eq(groupDiscussionNotifications.groupId, groupId),
        eq(groupDiscussionNotifications.userId, userId)
      ),
    });
    return !!subscription;
  }

  static async getSubscribers(groupId) {
    return db
      .select({
        id: groupDiscussionNotifications.id,
        userId: groupDiscussionNotifications.userId,
        createdAt: groupDiscussionNotifications.createdAt,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          image: users.image,
        },
      })
      .from(groupDiscussionNotifications)
      .innerJoin(users, eq(groupDiscussionNotifications.userId, users.id))
      .where(eq(groupDiscussionNotifications.groupId, groupId));
  }

  static async notifyNewDiscussion(groupId, discussionId, creatorUserId) {
    const subscribers = await db
      .select({ userId: groupDiscussionNotifications.userId })
      .from(groupDiscussionNotifications)
      .where(
        and(
          eq(groupDiscussionNotifications.groupId, groupId),
          sql`${groupDiscussionNotifications.userId} != ${creatorUserId}`
        )
      );

    if (subscribers.length === 0) return;

    const [group, creator] = await Promise.all([
      db.query.groups.findFirst({
        where: eq(groups.id, groupId),
        columns: { id: true, name: true, slug: true },
      }),
      db.query.users.findFirst({
        where: eq(users.id, creatorUserId),
        columns: { id: true, firstName: true, lastName: true },
      }),
    ]);

    if (!group || !creator) return;

    const creatorName = `${creator.firstName} ${creator.lastName}`;

    for (const subscriber of subscribers) {
      await createNotification({
        userId: subscriber.userId,
        title: 'New Discussion Post',
        message: `${creatorName} posted a new discussion in "${group.name}"`,
        type: 'group_activity',
        relatedId: groupId,
        redirectTo: `/groups/${group.slug}`,
        metadata: { groupId, discussionId, actorUserId: creatorUserId },
      });
    }
  }
}

// Helper to notify all group members about an event promotion
async function notifyGroupEventPromotion(groupId, eventId) {
  const [members, event, group] = await Promise.all([
    db.query.groupMembers.findMany({
      where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')),
    }),
    db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, slug: true },
    }),
    db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      columns: { createdBy: true },
    }),
  ]);

  if (!event) return;

  for (const member of members) {
    await createNotification({
      userId: member.userId,
      title: 'Event Promoted in Group',
      message: `A new event has been promoted in your group.`,
      type: 'group_activity',
      relatedId: eventId,
      redirectTo: `/events/${event.slug}`,
      metadata: {
        groupId,
        eventId,
        ...(group?.createdBy && { actorUserId: group.createdBy }),
      },
    });
  }
}

async function sendGroupInvitations({ groupId, groupSlug, groupName, inviterId, inviteeIds }) {
  const inviter = await getUserInformation(inviterId);
  const inviterName = `${inviter.firstName} ${inviter.lastName}`;
  const results = { sent: [], alreadyMember: [], errors: [] };

  for (const inviteeId of inviteeIds) {
    try {
      if (inviteeId === inviterId) continue;

      const existingMember = await checkGroupMembership(groupId, inviteeId);
      if (existingMember) {
        results.alreadyMember.push(inviteeId);
        continue;
      }

      await createNotification({
        userId: inviteeId,
        title: 'Group Invitation',
        message: `${inviterName} invited you to join "${groupName}"`,
        type: 'group_activity',
        relatedId: groupId,
        redirectTo: `/groups/${groupSlug}`,
        metadata: { groupId, groupSlug, inviterId },
      });

      results.sent.push(inviteeId);

      try {
        const invitee = await getUserInformation(inviteeId);
        await sendGroupInvitationEmail(invitee.email, {
          user_name: `${invitee.firstName} ${invitee.lastName}`,
          inviter_name: inviterName,
          group_name: groupName,
          group_description: '',
          member_count: 0,
          group_location: '',
          group_category: '',
          invite_date: new Date().toLocaleDateString(),
        });
      } catch (emailErr) {
        console.error(`Invitation email failed for user ${inviteeId}:`, emailErr.message);
      }
    } catch (error) {
      console.error(`Error inviting user ${inviteeId}:`, error);
      results.errors.push({ userId: inviteeId, error: error.message });
    }
  }

  return results;
}

export class GroupInvitationService {
  static async inviteUsersToGroup({ groupId, inviterId, inviteeIds }) {
    const inviterMembership = await checkGroupMembership(groupId, inviterId);
    if (!inviterMembership) {
      throw new ApiError(403, 'Only group members can invite others to join.');
    }

    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      columns: { id: true, name: true, slug: true },
    });
    if (!group) throw new ApiError(404, 'Group not found');

    const results = await sendGroupInvitations({
      groupId: group.id,
      groupSlug: group.slug,
      groupName: group.name,
      inviterId,
      inviteeIds,
    });

    return {
      success: true,
      message: `${results.sent.length} invitation(s) sent successfully`,
      results,
    };
  }
}
