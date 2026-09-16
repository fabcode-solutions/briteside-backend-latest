import { db } from '../../db/index.js';
import ApiError from '../../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';
import { MediaModerationService, MEDIA_ENTITY } from '../moderation/mediaModeration.service.js';
import {
  users,
  userFollows,
  socialProfiles,
  organizers,
  socialWallPosts,
  userFollowRequests,
  posts,
} from '../../db/schema/index.js';
import { eq, count, desc, and, or, sql, isNull, gt, inArray } from 'drizzle-orm';
import { SocialAnalyticsService } from './socialAnalytics.service.js';
import { BlockService } from './block.service.js';
import { randomUUID } from 'crypto';
import { createNotification } from '../notification.service.js';

/**
 * Profile management service for social profiles
 */
function extractMentions(text) {
  const matches = text.match(/@([a-zA-Z0-9_]+)/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

/**
 * Best-effort city/state/country split of a geocoded "location" string, for
 * profiles saved before the map picker started returning structured details
 * (see LocationPicker's onDetailsChange) — those rows have a location string
 * but null city/state/country. Assumes the common
 * "..., City, State ZIP, Country" shape Google/Mapbox reverse-geocoding uses.
 */
function deriveLocationParts(location) {
  if (typeof location !== 'string' || !location.trim()) {
    return { city: null, state: null, country: null };
  }
  const parts = location
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: null, state: null, country: null };

  const country = parts[parts.length - 1] ?? null;
  const state =
    parts.length >= 2 ? parts[parts.length - 2].replace(/\s*\d[\d\s-]*$/, '').trim() || null : null;
  const city = parts.length >= 3 ? parts[parts.length - 3] : parts.length === 2 ? parts[0] : null;

  return { city, state, country };
}
export class ProfileService {
static async getOrCreateSocialProfile(userId) {
  const safeUserColumns = {
    id: true,
    username: true,
    firstName: true,
    lastName: true,
    name: true,
    image: true,
    bio: true,
    isBritesidePlus: true,
  };

  let profile = await db.query.socialProfiles.findFirst({
    where: eq(socialProfiles.userId, userId),
    with: {
      user: { columns: safeUserColumns },
      organizer: true,
    },
  });

 if (!profile) {
  const existingOrganizer = await db.query.organizers.findFirst({
    where: eq(organizers.userId, userId),
    columns: { id: true },
  });

  const [newProfile] = await db
    .insert(socialProfiles)
    .values({ userId, organizerId: existingOrganizer?.id ?? null })
    .returning();

  profile = await db.query.socialProfiles.findFirst({
    where: eq(socialProfiles.id, newProfile.id),
    with: {
      user: { columns: safeUserColumns },
      organizer: true,
    },
  });
}

    // Lazy backfill for profiles saved before city/state/country existed —
    // derive them once from the existing location string and persist so
    // every read after this one is already correct (and so a later edit's
    // unchanged-value diffing in updateSocialProfile compares against them).
    if (profile.location && !profile.city && !profile.state && !profile.country) {
      const derived = deriveLocationParts(profile.location);
      if (derived.city || derived.state || derived.country) {
        await db
          .update(socialProfiles)
          .set({ ...derived, updatedAt: new Date() })
          .where(eq(socialProfiles.userId, userId));
        Object.assign(profile, derived);
      }
    }

    // Self-heal profiles left over from before `location` was normalized to
    // "City, State, Country" — e.g. one saved via a stale client, or before
    // this rule existed — so a read alone fixes it without waiting for the
    // user to touch their location again.
    {
      const normalizedLocation = [profile.city, profile.state, profile.country]
        .filter(Boolean)
        .join(', ');
      if (normalizedLocation && profile.location !== normalizedLocation) {
        await db
          .update(socialProfiles)
          .set({ location: normalizedLocation, updatedAt: new Date() })
          .where(eq(socialProfiles.userId, userId));
        profile.location = normalizedLocation;
      }
    }

    const [followersCount, followingCount, postsCountResult] = await Promise.all([
      db.select({ count: count() }).from(userFollows).where(eq(userFollows.followingId, userId)),
      db.select({ count: count() }).from(userFollows).where(eq(userFollows.followerId, userId)),
      db
        .select({ count: count() })
        .from(posts)
        .where(
          and(
            eq(posts.userId, userId),
            eq(posts.isStatusPost, false),
            eq(posts.isArchived, false),
            isNull(posts.deletedAt),
            or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date()))
          )
        ),
    ]);

    const actualFollowersCount = followersCount[0].count;
    const actualFollowingCount = followingCount[0].count;
    const actualPostsCount = postsCountResult[0].count;

    if (
      profile.followersCount !== actualFollowersCount ||
      profile.followingCount !== actualFollowingCount ||
      profile.postsCount !== actualPostsCount
    ) {
      await db
        .update(socialProfiles)
        .set({
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount,
          postsCount: actualPostsCount,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, userId));

      profile.followersCount = actualFollowersCount;
      profile.followingCount = actualFollowingCount;
      profile.postsCount = actualPostsCount;
    }

    return profile;
  }

  static viewerVisibilityCondition(viewerId) {
    return sql`(
      EXISTS (
        SELECT 1 FROM social_profiles sp
        WHERE sp.user_id = ${posts.userId} AND sp.is_public = TRUE
      )
      OR ${posts.userId} IN (
        SELECT following_id FROM user_follows WHERE follower_id = ${viewerId}
      )
      OR ${posts.userId} = ${viewerId}
    )`;
  }

  static async viewProfile(profileUserId, viewerId) {
    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, profileUserId),
    });
    if (!profile) {
      throw new ApiError(404, 'Profile not found');
    }
    const isBlocked = await BlockService.isBlocked(viewerId, profileUserId);
    if (isBlocked) {
      throw new ApiError(403, 'Cannot view this profile');
    }
    return SocialAnalyticsService.viewProfile(profileUserId, viewerId);
  }

  static async getProfileAnalytics(profileUserId, userId, filters = {}) {
    return SocialAnalyticsService.getProfileAnalytics(profileUserId, userId, filters);
  }

  static async _handleCoverPost(userId, coverMedia) {
    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, userId),
      columns: { id: true, coverPostId: true },
    });

    const mediaArray = Array.isArray(coverMedia) ? coverMedia : [];

    // If same media, skip — no post create/delete needed
    if (profile?.coverPostId && mediaArray.length > 0) {
      const [existing] = await db
        .select({ mediaUrls: posts.mediaUrls })
        .from(posts)
        .where(eq(posts.id, profile.coverPostId));

      const existingUrls = existing?.mediaUrls ?? [];
      const same =
        existingUrls.length === mediaArray.length &&
        mediaArray.every((url, i) => existingUrls[i] === url);
      if (same) return;
    }

    // Soft-delete existing cover post
    if (profile?.coverPostId) {
      await db
        .update(posts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(posts.id, profile.coverPostId));
    }

    if (mediaArray.length === 0) {
      // Cover removed — clear the pointer
      await db
        .update(socialProfiles)
        .set({ coverPostId: null, updatedAt: new Date() })
        .where(eq(socialProfiles.userId, userId));
      return;
    }

    // Infer media types: treat anything with video extensions as video, else image
    const videoExts = ['.mp4', '.mov', '.webm', '.avi'];
    const mediaTypes = mediaArray.map(url =>
      videoExts.some(ext => url.toLowerCase().endsWith(ext)) ? 'video' : 'image'
    );

    const [coverPost] = await db
      .insert(posts)
      .values({
        userId,
        isCoverPost: true,
        mediaUrls: mediaArray,
        mediaTypes,
        aspectRatios: [],
        visibility: 'public',
        caption: null,
      })
      .returning();

    await db
      .update(socialProfiles)
      .set({ coverPostId: coverPost.id, updatedAt: new Date() })
      .where(eq(socialProfiles.userId, userId));

    await MediaModerationService.adoptMediaVerdicts({
      entityType: MEDIA_ENTITY.POST,
      entityId: coverPost.id,
      userId,
      imageUrls: mediaArray.filter((_, i) => mediaTypes[i] !== 'video'),
      videoUrls: mediaArray.filter((_, i) => mediaTypes[i] === 'video'),
    });
  }

  static async updateSocialProfile(userId, data) {
    const { previousIsPublic, expiresAt, ...rest } = data;
    let updatePayload = { ...rest, updatedAt: new Date() };

    // `location` is deliberately excluded — it's a geocoded address string
    // resolved from the map picker, never free-typed by the user, so running
    // it through community-guidelines moderation only risks false positives
    // (e.g. a Plus Code in the address) with no real abuse to catch.
    const TEXT_FIELDS = ['bio', 'status', 'website'];
    // The edit form resubmits every field on every save, not just the one the
    // user actually changed — so only re-moderate a field when its value
    // differs from what's already stored, otherwise saved-and-already-approved
    // text (e.g. bio) would block an edit to an unrelated field (e.g. location).
    const needsCurrentProfile = TEXT_FIELDS.some(f => f in rest);
    const currentProfile = needsCurrentProfile
      ? await this.getOrCreateSocialProfile(userId)
      : null;

    const textFieldEntries = TEXT_FIELDS.map(field => [field, rest[field]]).filter(
      ([field, value]) =>
        typeof value === 'string' && value.trim() && value !== (currentProfile?.[field] ?? '')
    );

    let profileModeration = { action: 'keep' };
    if (textFieldEntries.length > 0) {
      profileModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.PROFILE,
        entityCreatorId: userId,
        texts: textFieldEntries.map(([, value]) => value),
      });
    }

    if ('status' in rest) {
      const trimmedStatus = rest.status ? rest.status.trim() : '';

      if (trimmedStatus) {
        const currentStatus = currentProfile.status ? currentProfile.status.trim() : '';

        if (trimmedStatus !== currentStatus) {
          const newWallPost = await this.postToWall(userId, userId, trimmedStatus, expiresAt);
          await this.changeWallPostStatus(userId, newWallPost.id, 'approved');
        }
      }
    }

    if ('coverMedia' in rest) {
      await this._handleCoverPost(userId, rest.coverMedia);
    }

    const [updated] = await db
      .update(socialProfiles)
      .set(updatePayload)
      .where(eq(socialProfiles.userId, userId))
      .returning();

    await TextModerationService.recordIfFlagged(profileModeration, {
      entityType: TEXT_ENTITY.PROFILE,
      entityId: updated.id,
      userId,
      fieldNames: textFieldEntries.map(([name]) => name),
      texts: textFieldEntries.map(([, value]) => value),
    });

    // Private → Public transition: auto-accept all pending follow requests
    if (previousIsPublic === false && rest.isPublic === true) {
      const pendingRequests = await db
        .select()
        .from(userFollowRequests)
        .where(
          and(eq(userFollowRequests.targetId, userId), eq(userFollowRequests.status, 'pending'))
        );

      if (pendingRequests.length > 0) {
        for (const request of pendingRequests) {
          await db.insert(userFollows).values({
            id: randomUUID(),
            followerId: request.requesterId,
            followingId: userId,
            createdAt: new Date(),
          });

          await createNotification({
            userId: request.requesterId,
            title: 'Follow Request Accepted',
            message: 'Your follow request was accepted.',
            type: 'follow_accepted',
            relatedId: userId,
            redirectTo: `/notifications`,
            metadata: { targetUserId: userId },
          });
        }

        await db
          .delete(userFollowRequests)
          .where(
            and(eq(userFollowRequests.targetId, userId), eq(userFollowRequests.status, 'pending'))
          );

        await db
          .update(socialProfiles)
          .set({
            followersCount: sql`${socialProfiles.followersCount} + ${pendingRequests.length}`,
          })
          .where(eq(socialProfiles.userId, userId));

        for (const request of pendingRequests) {
          await db
            .update(socialProfiles)
            .set({ followingCount: sql`${socialProfiles.followingCount} + 1` })
            .where(eq(socialProfiles.userId, request.requesterId));
        }
      }
    }

    return updated;
  }

  static async getUserOrganizers(userId) {
    return await db.query.organizers.findMany({
      where: eq(organizers.userId, userId),
      orderBy: desc(organizers.createdAt),
    });
  }

  static async linkOrganizer(userId, organizerId) {
    const [updated] = await db
      .update(socialProfiles)
      .set({ organizerId, updatedAt: new Date() })
      .where(eq(socialProfiles.userId, userId))
      .returning();

    return updated;
  }

  static async postToWall(profileUserId, authorId, content, expiresAt) {
    const profile = await this.getOrCreateSocialProfile(profileUserId);

    const contentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.POST,
      entityCreatorId: authorId,
      texts: [content],
    });

    const [wallPost] = await db
      .insert(socialWallPosts)
      .values({ profileId: profile.id, authorId, content, expiresAt })
      .returning();

    const [feedPost] = await db
      .insert(posts)
      .values({
        userId: authorId,
        caption: content,
        isStatusPost: true,
        visibility: 'public',
        mediaUrls: [],
        mediaTypes: [],
        aspectRatios: [],
        wallPostId: wallPost.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    const [updated] = await db
      .update(socialWallPosts)
      .set({ postId: feedPost.id, updatedAt: new Date() })
      .where(eq(socialWallPosts.id, wallPost.id))
      .returning();

    // A wall post is stored twice (social_wall_posts for the wall view,
    // posts for the normal feed) — record the flag against both ids so
    // whichever surface reads it finds the masked version.
    await Promise.all([
      TextModerationService.recordIfFlagged(contentModeration, {
        entityType: TEXT_ENTITY.POST,
        entityId: wallPost.id,
        userId: authorId,
        fieldNames: ['content'],
        texts: [content],
      }),
      TextModerationService.recordIfFlagged(contentModeration, {
        entityType: TEXT_ENTITY.POST,
        entityId: feedPost.id,
        userId: authorId,
        fieldNames: ['caption'],
        texts: [content],
      }),
    ]);

    const mentionedUsernames = extractMentions(content);

    const author = await db
      .select({
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, authorId))
      .then(rows => rows[0]);

    const authorName = author?.username
      ? `@${author.username}`
      : [author?.firstName, author?.lastName].filter(Boolean).join(' ') || 'Someone';

    if (mentionedUsernames.length > 0) {
      const mentionedUsers = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(and(inArray(users.username, mentionedUsernames), isNull(users.deletedAt)));

      await Promise.all(
        mentionedUsers
          .filter(u => u.id !== authorId)
          .map(u =>
            createNotification({
              userId: u.id,
              title: 'You were mentioned',
              message: `${authorName} mentioned you in a status update.`,
              type: 'mention',
              relatedId: feedPost.id,
              redirectTo: `/posts/${feedPost.id}`,
              metadata: { authorId, postId: feedPost.id, authorUsername: author?.username },
              authorImage: author?.image,
              authorName: authorName,
            })
          )
      );
    }

    if (authorId !== profileUserId) {
      await createNotification({
        userId: profileUserId,
        title: 'New wall post',
        message: `${authorName} posted on your wall.`,
        type: 'wall_post',
        relatedId: wallPost.id,
        redirectTo: `/profile/${profile.user?.username}?tab=wall`,
        metadata: { authorId, wallPostId: wallPost.id, authorUsername: author?.username },
        authorImage: author?.image,
        authorName: authorName,
      });
    }

    return updated;
  }

  /**
   * Get wall posts for a profile; unapproved are only visible to owner.
   * Also includes the profile owner's active status post (isStatusPost=true) at the top.
   * The status wall post is excluded from the wall list to avoid duplication.
   */
  static async getWallPosts(profileUserId, viewerId, page = 1, limit = 20) {
    const profile = await this.getOrCreateSocialProfile(profileUserId);
    const offset = (page - 1) * limit;

    let whereClause;

    if (viewerId === profileUserId) {
      whereClause = eq(socialWallPosts.profileId, profile.id);
    } else {
      whereClause = and(
        eq(socialWallPosts.profileId, profile.id),
        or(eq(socialWallPosts.status, 'approved'), eq(socialWallPosts.authorId, viewerId))
      );
    }

    const wallPostRows = await db.query.socialWallPosts.findMany({
      where: whereClause,
      orderBy: desc(socialWallPosts.createdAt),
      limit,
      offset,
      with: {
        author: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            image: true,
          },
        },
        post: {
          columns: {
            id: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            repostsCount: true,
            viewsCount: true,
          },
        },
      },
    });

    // Fetch the status post first so we can exclude its linked wall post
    let statusPost = null;
    if (page === 1 && profile.statusPostId) {
      statusPost = await db.query.posts.findFirst({
        where: and(
          eq(posts.id, profile.statusPostId),
          or(isNull(posts.expiresAt), gt(posts.expiresAt, new Date()))
        ),
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              image: true,
            },
          },
        },
      });
    }

    const shaped = wallPostRows
      // Exclude only the wall post linked to the active status post. Guard on
      // statusPostId so null postId rows aren't dropped when there is no status post.
      .filter(wp => !(profile.statusPostId && wp.postId === profile.statusPostId))
      .map(wp => ({
        id: wp.id,
        profileId: wp.profileId,
        authorId: wp.authorId,
        content: wp.content,
        status: wp.status,
        createdAt: wp.createdAt,
        updatedAt: wp.updatedAt,
        author: wp.author,
        postId: wp.post?.id ?? null,
        likesCount: wp.post?.likesCount ?? 0,
        commentsCount: wp.post?.commentsCount ?? 0,
        sharesCount: wp.post?.sharesCount ?? 0,
        repostsCount: wp.post?.repostsCount ?? 0,
        viewsCount: wp.post?.viewsCount ?? 0,
      }));

    let pendingWallPostsCount = 0;
    if (viewerId === profileUserId) {
      const [{ count: pendingCount }] = await db
        .select({ count: count() })
        .from(socialWallPosts)
        .where(
          and(eq(socialWallPosts.profileId, profile.id), eq(socialWallPosts.status, 'pending'))
        );
      pendingWallPostsCount = Number(pendingCount);
    }

    const wallFilterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    await TextModerationService.maskFlaggedText(shaped, {
      entityType: TEXT_ENTITY.POST,
      fields: ['content'],
      filterEnabled: wallFilterEnabled,
    });
    const maskedStatusPost = statusPost
      ? await TextModerationService.maskFlaggedTextSingle(statusPost, {
          entityType: TEXT_ENTITY.POST,
          fields: ['caption'],
          filterEnabled: wallFilterEnabled,
        })
      : statusPost;

    return { wallPosts: shaped, statusPost: maskedStatusPost, pendingWallPostsCount };
  }

  static async changeWallPostStatus(profileUserId, postId, status) {
    if (!['approved', 'rejected'].includes(status)) throw new ApiError(400, 'Invalid status');

    const profile = await this.getOrCreateSocialProfile(profileUserId);
    const [existing] = await db.query.socialWallPosts.findMany({
      where: eq(socialWallPosts.id, postId),
    });

    if (!existing || existing.profileId !== profile.id)
      throw new ApiError(404, 'Wall post not found');

    const [updated] = await db
      .update(socialWallPosts)
      .set({ status, updatedAt: new Date() })
      .where(eq(socialWallPosts.id, postId))
      .returning();

    if (status === 'rejected' && profile.statusPostId) {
      const linkedPost = await db.query.posts.findFirst({
        where: and(
          eq(posts.id, profile.statusPostId),
          eq(posts.isStatusPost, true),
          isNull(posts.deletedAt)
        ),
        columns: { id: true, caption: true },
      });

      if (linkedPost && linkedPost.caption === existing.content) {
        await db
          .update(posts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(posts.id, linkedPost.id));

        await db
          .update(socialProfiles)
          .set({ statusPostId: null, updatedAt: new Date() })
          .where(eq(socialProfiles.id, profile.id));
      }
    }

    if (existing.authorId !== profileUserId) {
      const owner = profile.user;
      const ownerName = owner?.username
        ? `@${owner.username}`
        : [owner?.firstName, owner?.lastName].filter(Boolean).join(' ') || 'Someone';

      await createNotification({
        userId: existing.authorId,
        title: status === 'approved' ? 'Wall post approved' : 'Wall post rejected',
        message:
          status === 'approved'
            ? `${ownerName} approved your wall post.`
            : `${ownerName} rejected your wall post.`,
        type: status === 'approved' ? 'wall_post_approved' : 'wall_post_rejected',
        relatedId: postId,
        redirectTo: `/profile/${owner?.username}?tab=wall`,
        metadata: { profileUserId, wallPostId: postId },
        authorImage: owner?.image,
        authorName: ownerName,
      });
    }

    return updated;
  }

  static async approveOrRejectWallPost(profileUserId, postId, status) {
    return this.changeWallPostStatus(profileUserId, postId, status);
  }

  static async deleteWallPost(authorId, postId) {
    const [existing] = await db.query.socialWallPosts.findMany({
      where: eq(socialWallPosts.id, postId),
    });

    if (!existing) throw new ApiError(404, 'Wall post not found');
    if (existing.authorId !== authorId)
      throw new ApiError(403, 'Cannot delete a wall post you did not author');
    if (existing.status !== 'pending')
      throw new ApiError(400, 'Only pending wall posts can be deleted');

    const profile = await db.query.socialProfiles.findFirst({
      where: eq(socialProfiles.userId, authorId),
      columns: { id: true, statusPostId: true },
    });

    await db.delete(socialWallPosts).where(eq(socialWallPosts.id, postId));

    if (profile?.statusPostId) {
      const linkedPost = await db.query.posts.findFirst({
        where: and(
          eq(posts.id, profile.statusPostId),
          eq(posts.userId, authorId),
          eq(posts.isStatusPost, true),
          isNull(posts.deletedAt)
        ),
        columns: { id: true, caption: true },
      });

      if (linkedPost && linkedPost.caption === existing.content) {
        await db
          .update(posts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(posts.id, linkedPost.id));

        await db
          .update(socialProfiles)
          .set({ statusPostId: null, updatedAt: new Date() })
          .where(eq(socialProfiles.userId, authorId));
      }
    }
  }

  static async getPendingWallPostsCount(profileUserId) {
    const profile = await this.getOrCreateSocialProfile(profileUserId);
    const [{ count: pendingCount }] = await db
      .select({ count: count() })
      .from(socialWallPosts)
      .where(and(eq(socialWallPosts.profileId, profile.id), eq(socialWallPosts.status, 'pending')));
    return Number(pendingCount);
  }
}
