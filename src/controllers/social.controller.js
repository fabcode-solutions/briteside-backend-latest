import { SocialService } from '../services/social.service.js';
import * as userService from '../services/user.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { FeedService } from '../services/social/feed.service.js';
import { PostService } from '../services/social/post.service.js';
import { StoryPollService } from '../services/social/storyPoll.service.js';
import { StoryService } from '../services/social/story.service.js';
import { StoryCollectionService } from '../services/social/storyCollection.service.js';
import { BioLinkService } from '../services/social/bioLink.service.js';
import { ShopProductService } from '../services/shop/shopProduct.service.js';
import { SuggestedUsersService } from '../services/social/suggestedUsers.service.js';
import { MediaModerationService } from '../services/moderation/mediaModeration.service.js';
import {
  TextModerationService,
  TEXT_ENTITY,
} from '../services/moderation/textModeration.service.js';
import { checkUsernameAvailability } from '../services/usernameReservation.service.js';
import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { userFollowRequests } from '../db/schema/index.js';
import { isUserOnline } from '../socket/index.js';

// Same rule enforced at registration (auth.route.js) — kept identical for consistency
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const validateUsernameFormat = username => {
  if (username.length < 3 || username.length > 30) {
    return 'Username must be between 3 and 30 characters';
  }
  if (!USERNAME_REGEX.test(username)) {
    return 'Username can only contain letters, numbers, and underscores';
  }
  return null;
};

// ============ PROFILE MANAGEMENT ============

export const checkProfileUsernameAvailability = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { username } = req.query;

  if (!username || typeof username !== 'string') {
    throw new ApiError(400, 'Username is required');
  }

  const trimmed = username.trim();
  const formatError = validateUsernameFormat(trimmed);

  if (formatError) {
    return res.json({ success: true, data: { available: false, reason: formatError } });
  }

  const result = await checkUsernameAvailability(trimmed, { excludeUserId: userId });

  res.json({ success: true, data: result });
});

export const getSocialProfile = catchAsync(async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.user.id;

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');
  const userId = user.id;

  const profile = await SocialService.getOrCreateSocialProfile(userId);

  let isFollowing = false;
  let isBlocked = false;
  let isRequested = false;
  let followStatus = null;
  let isPinnedByMe = false;

  if (currentUserId !== userId) {
    const [following, blocked, targetFollowsMe, pinned] = await Promise.all([
      SocialService.isFollowing(currentUserId, userId),
      SocialService.isBlocked(currentUserId, userId),
      SocialService.isFollowing(userId, currentUserId),
      SocialService.isProfilePinned(currentUserId, userId),
    ]);
    isFollowing = following;
    isBlocked = blocked;
    isPinnedByMe = pinned;

    if (isFollowing) {
      followStatus = 'following';
    } else if (targetFollowsMe) {
      followStatus = 'follow_back';
    } else {
      followStatus = 'follow';
    }

    if (!isFollowing) {
      const pending = await db.query.userFollowRequests.findFirst({
        where: and(
          eq(userFollowRequests.requesterId, currentUserId),
          eq(userFollowRequests.targetId, userId),
          eq(userFollowRequests.status, 'pending')
        ),
      });
      isRequested = !!pending;
    }

    try {
      await SocialService.viewProfile(userId, currentUserId);
    } catch (err) {
      console.error('Failed to record profile view', err);
    }
  }

  const [fullUser, hasStory, userInterests, bioLinksResult, shopProductCount] =
    await Promise.all([
      userService.getUserById(userId),
      StoryService.hasActiveStory(userId),
      SocialService.getUserInterests(userId),
      BioLinkService.getUserLinks(userId, { page: 1, limit: 20 }),
      ShopProductService.countForUser(userId),
    ]);

  // Cover image moderation status (for blur on flagged / placeholder on removed)
  const coverUrls = Array.isArray(profile.coverMedia) ? profile.coverMedia.filter(Boolean) : [];
  const coverModerationStatus = coverUrls.length
    ? MediaModerationService.aggregateStatus(
        await MediaModerationService.mediaRowsForUrls(coverUrls)
      )
    : 'approved';

  const profileFilterEnabled = await TextModerationService.getFilterEnabled(currentUserId);
  await TextModerationService.maskFlaggedTextSingle(profile, {
    entityType: TEXT_ENTITY.PROFILE,
    fields: ['bio', 'status', 'website', 'location'],
    filterEnabled: profileFilterEnabled,
  });

  // Blocked either direction — Instagram-style: withhold everything about
  // the account beyond the username needed to render the page at all. No
  // bio/photo/counts/posts leak through to someone who can't view them.
  if (isBlocked) {
    return res.json({
      success: true,
      data: {
        profile: {
          id: profile.id,
          userId: profile.userId,
          username: profile.username,
          isBlocked: true,
          isFollowing: false,
          isRequested: false,
          followStatus: null,
          isPinnedByMe: false,
          isPublic: false,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          user: { id: user.id, username: user.username },
        },
      },
    });
  }

  res.json({
    success: true,
    data: {
      profile: {
        ...profile,
        coverModerationStatus,
        isFollowing,
        isBlocked,
        isRequested,
        followStatus,
        isPinnedByMe,
        hasStory,
        shopProductCount,
        dob: fullUser?.dob ?? null,
        profanityFilterEnabled: fullUser?.profanityFilterEnabled ?? false,
        showOnlineStatus: fullUser?.showOnlineStatus ?? true,
        showLastSeen: fullUser?.showLastSeen ?? true,
        lastSeen: fullUser?.lastSeen ?? null,
        allowSearchByEmail: fullUser?.allowSearchByEmail ?? false,
        allowSearchByPhone: fullUser?.allowSearchByPhone ?? false,
        allowMessagesFrom: fullUser?.allowMessagesFrom ?? 'everyone',
        allowCallsFrom: fullUser?.allowCallsFrom ?? 'everyone',
        allowTagging: fullUser?.allowTagging ?? true,
        interests: userInterests.map(i => ({ name: i.category.name, icon: i.category.icon })),
        bioLinks: bioLinksResult.links,
        bioLinksHasMore: bioLinksResult.hasMore,
      },
    },
  });
});

export const updateSocialProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const {
    bio,
    expiresAt,
    website,
    location,
    city,
    state,
    country,
    isPublic,
    coverMedia,
    status,
    gender,
    dob,
    username,
    profanityFilterEnabled,
    showOnlineStatus,
    showLastSeen,
    allowSearchByEmail,
    allowSearchByPhone,
    allowTagging,
    allowMessagesFrom,
    allowCallsFrom,
    hideFollowingCount,
    countryFlag1,
    countryFlag2,
    buttonMeta,
     defaultLandingTab,
    firstName,
    lastName,
  } = req.body;

  if (buttonMeta !== undefined && !req.user.isBritesidePlus) {
    throw new ApiError(403, 'Cover button is a BriteSide Plus feature. Upgrade to add one.');
  }

   const VALID_LANDING_TABS = ['posts', 'shop', 'wall'];
  if (defaultLandingTab !== undefined && !VALID_LANDING_TABS.includes(defaultLandingTab)) {
    throw new ApiError(400, `defaultLandingTab must be one of: ${VALID_LANDING_TABS.join(', ')}`);
  }

  if (dob !== undefined) {
    await userService.updateUserById(userId, { dob });
  }

  if (username !== undefined) {
    const trimmedUsername = username.trim();
    const formatError = validateUsernameFormat(trimmedUsername);

    if (formatError) {
      throw new ApiError(400, formatError);
    }

    const availability = await checkUsernameAvailability(trimmedUsername, {
      excludeUserId: userId,
    });

    if (!availability.available) {
      throw new ApiError(409, availability.reason || 'This username is already taken');
    }

    await userService.updateUserById(userId, { username: trimmedUsername });
  }

  if (firstName !== undefined) {
    const trimmedFirstName = firstName.trim();
    if (!trimmedFirstName) throw new ApiError(400, 'First name cannot be empty');
    if (trimmedFirstName.length > 100) {
      throw new ApiError(400, 'First name must be 100 characters or fewer');
    }
    await userService.updateUserById(userId, { firstName: trimmedFirstName });
  }

  if (lastName !== undefined) {
    const trimmedLastName = lastName.trim();
    if (!trimmedLastName) throw new ApiError(400, 'Last name cannot be empty');
    if (trimmedLastName.length > 100) {
      throw new ApiError(400, 'Last name must be 100 characters or fewer');
    }
    await userService.updateUserById(userId, { lastName: trimmedLastName });
  }

  if (profanityFilterEnabled !== undefined) {
    await userService.updateUserById(userId, { profanityFilterEnabled });
  }

  if (showOnlineStatus !== undefined) {
    await userService.updateUserById(userId, { showOnlineStatus });

    const io = req.app.get('io');
    if (io) {
      if (!showOnlineStatus) {
        io.of('/chat').emit('user:offline', { userId, lastSeen: new Date().toISOString() });
      } else if (isUserOnline(userId)) {
        io.of('/chat').emit('user:online', { userId });
      }
    }
  }

  if (showLastSeen !== undefined) {
    await userService.updateUserById(userId, { showLastSeen });
  }

  if (allowSearchByEmail !== undefined) {
    await userService.updateUserById(userId, { allowSearchByEmail });
  }

  if (allowSearchByPhone !== undefined) {
    await userService.updateUserById(userId, { allowSearchByPhone });
  }

  if (allowTagging !== undefined) {
    console.log('[allowTagging] value:', allowTagging, typeof allowTagging);
    await userService.updateUserById(userId, { allowTagging });
  }

  if (allowMessagesFrom !== undefined) {
    await userService.updateUserById(userId, { allowMessagesFrom });
  }

  if (allowCallsFrom !== undefined) {
    await userService.updateUserById(userId, { allowCallsFrom });
  }
  const currentProfile = await SocialService.getOrCreateSocialProfile(userId);

  const updated = await SocialService.updateSocialProfile(userId, {
    bio,
    website,
    location,
    city,
    state,
    country,
    isPublic,
    coverMedia,
    status,
    gender,
    previousIsPublic: currentProfile.isPublic,
    hideFollowingCount,
    countryFlag1,
    countryFlag2,
    buttonMeta,
    expiresAt,
     defaultLandingTab,
  });

  const updatedUser = await userService.getUserById(userId);

  res.json({
    success: true,
    data: {
      profile: {
        ...updated,
        username: updatedUser?.username,
        // Same gap as getSocialProfile — dob is on the users table and was
        // never surfaced here, so the edit form couldn't confirm the save.
        dob: updatedUser?.dob ?? null,
        firstName: updatedUser?.firstName,
        lastName: updatedUser?.lastName,
        profanityFilterEnabled: updatedUser?.profanityFilterEnabled ?? false,
        showOnlineStatus: updatedUser?.showOnlineStatus ?? true,
        lastSeen: updatedUser?.lastSeen ?? null,
        showLastSeen: updatedUser?.showLastSeen ?? true,
        allowSearchByEmail: updatedUser?.allowSearchByEmail ?? false,
        allowSearchByPhone: updatedUser?.allowSearchByPhone ?? false,
        allowTagging: updatedUser?.allowTagging ?? true,
        allowMessagesFrom: updatedUser?.allowMessagesFrom ?? 'everyone',
        allowCallsFrom: updatedUser?.allowCallsFrom ?? 'everyone',
      },
    },
  });
});

export const getUserOrganizers = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const organizers = await SocialService.getUserOrganizers(userId);

  res.json({
    success: true,
    data: { organizers },
  });
});

export const linkOrganizer = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { organizerId } = req.body;

  const updated = await SocialService.linkOrganizer(userId, organizerId);

  res.json({
    success: true,
    data: { profile: updated },
  });
});

export const postOnWall = catchAsync(async (req, res) => {
  const { username } = req.params;
  const authorId = req.user.id;
  console.log('[postOnWall] req.body:', req.body);

  const { content, expiresAt } = req.body;

  if (!content || typeof content !== 'string') {
    throw new ApiError(400, 'Wall post content is required');
  }

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');

  const post = await SocialService.postToWall(user.id, authorId, content, expiresAt);
  res.status(201).json({ success: true, data: { post } });
});

export const getWallPosts = catchAsync(async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');

  const { wallPosts, statusPost, pendingWallPostsCount } = await SocialService.getWallPosts(
    user.id,
    viewerId,
    parseInt(page),
    parseInt(limit)
  );

  res.json({
    success: true,
    data: { posts: wallPosts, statusPost, pendingWallPostsCount },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: wallPosts.length === parseInt(limit),
    },
  });
});

export const getWallPendingCount = catchAsync(async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user.id;

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.id !== viewerId) throw new ApiError(403, 'Forbidden');

  const pendingWallPostsCount = await SocialService.getPendingWallPostsCount(user.id);
  res.json({ success: true, data: { pendingWallPostsCount } });
});

export const moderateWallPost = catchAsync(async (req, res) => {
  const profileUserId = req.user.id;
  const { postId } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    throw new ApiError(400, "Status must be 'approved' or 'rejected'");
  }

  const updated = await SocialService.approveOrRejectWallPost(profileUserId, postId, status);

  res.json({ success: true, data: { post: updated } });
});

export const deleteWallPost = catchAsync(async (req, res) => {
  const authorId = req.user.id;
  const { postId } = req.params;

  await SocialService.deleteWallPost(authorId, postId);

  res.json({
    success: true,
    message: 'Wall post deleted successfully',
  });
});

// ============ FOLLOW SYSTEM ============

export const toggleFollowUser = catchAsync(async (req, res) => {
  const followerId = req.user.id;
  const { userId } = req.params;

  const result = await SocialService.toggleFollowUser(followerId, userId);

  res.json({
    success: true,
    message: result.following
      ? 'User followed successfully'
      : result.requested
        ? 'Follow request sent'
        : 'User unfollowed successfully',
    data: result,
  });
});

export const getFollowers = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const viewerId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const user = await userService.findByUsername(userId);
  if (!user) throw new ApiError(404, 'User not found');

  const followers = await SocialService.getFollowers(
    user.id,
    parseInt(page),
    parseInt(limit),
    viewerId
  );

  res.json({
    success: true,
    data: { followers },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: followers.length === parseInt(limit),
    },
  });
});

export const getFollowing = catchAsync(async (req, res) => {
  const { userId } = req.params; // this is a username from route
  const viewerId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const user = await userService.findByUsername(userId);
  if (!user) throw new ApiError(404, 'User not found');

  const following = await SocialService.getFollowing(
    user.id,
    parseInt(page),
    parseInt(limit),
    viewerId // ← correctly passed
  );

  res.json({
    success: true,
    data: { following },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: following.length === parseInt(limit),
    },
  });
});

export const togglePinProfile = catchAsync(async (req, res) => {
  const currentUserId = req.user.id;
  const { username } = req.params;

  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.id === currentUserId) throw new ApiError(400, "Can't pin your own profile");

  const result = await SocialService.togglePinProfile(currentUserId, user.id);

  res.json({
    success: true,
    message: result.pinned ? 'Profile pinned' : 'Profile unpinned',
    data: result,
  });
});

export const getPinnedProfiles = catchAsync(async (req, res) => {
  const currentUserId = req.user.id;
  const { page = 1, limit = 20, search = '' } = req.query;

  const result = await SocialService.getPinnedProfiles(
    currentUserId,
    parseInt(page),
    parseInt(limit),
    search.trim()
  );

  res.json({
    success: true,
    data: {
      profiles: result.items,
      total: result.total,
    },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: result.hasMore,
    },
  });
});

export const searchUsers = catchAsync(async (req, res) => {
  console.log('[searchUsers] query:', req.query);
  const { q: query, forMention } = req.query;
  const { page = 1, limit = 20 } = req.query;
  const currentUserId = req.user.id;

  if (!query || query.trim().length < 2) {
    throw new ApiError(400, 'Search query must be at least 2 characters');
  }

  const users = await SocialService.searchUsers(
    query.trim(),
    currentUserId,
    parseInt(page),
    parseInt(limit),
    forMention === 'true'
  );

  console.log(
    '[searchUsers] forMention:',
    forMention,
    '| result count:',
    users.length,
    '| users:',
    users.map(u => u.username)
  ); // ← add

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: users.length === parseInt(limit),
      },
    },
  });
});

// ============ POSTS MANAGEMENT ============

export const createPost = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const {
    caption,
    mediaUrls,
    mediaTypes,
    aspectRatios,
    location,
    tags,
    visibility,
    settings,
    mentionedUserIds,
    collaboratorIds,
    collectionId,
    scheduledAt,
  } = req.body;

  // Make media optional: default to empty arrays when not provided
  const mediaUrlsArr = Array.isArray(mediaUrls) ? mediaUrls : [];
  const mediaTypesArr = Array.isArray(mediaTypes) ? mediaTypes : [];
  const aspectRatiosArr = Array.isArray(aspectRatios) ? aspectRatios : [];

  if (mediaUrlsArr.length !== mediaTypesArr.length) {
    throw new ApiError(400, 'Media URLs and types must match in length');
  }

  if (aspectRatiosArr.length > 0 && aspectRatiosArr.length !== mediaUrlsArr.length) {
    throw new ApiError(400, 'Aspect ratios must match media URLs length when provided');
  }

  const post = await SocialService.createPost(userId, {
    caption,
    mediaUrls: mediaUrlsArr,
    mediaTypes: mediaTypesArr,
    aspectRatios: aspectRatiosArr,
    location,
    tags,
    visibility,
    settings,
    mentionedUserIds: Array.isArray(mentionedUserIds) ? mentionedUserIds : [],
    scheduledAt,
    collaboratorIds: Array.isArray(collaboratorIds) ? collaboratorIds : [],
    linkedProductIds: Array.isArray(req.body.linkedProductIds) ? req.body.linkedProductIds : [],
    isPlus: req.user.isBritesidePlus,
  });

  if (collectionId) {
    await StoryCollectionService.addItemSilent(collectionId, userId, {
      itemType: 'post',
      postId: post.id,
    });
  }

  res.status(201).json({
    success: true,
    message: scheduledAt ? 'Post scheduled successfully' : 'Post created successfully',
    data: { post },
  });
});
export const getScheduledPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const scheduledPosts = await SocialService.getScheduledPosts(userId);
  res.status(200).json({
    success: true,
    data: { posts: scheduledPosts },
  });
});
export const getPendingCollaborations = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const invites = await PostService.getPendingCollaborations(userId);
  res.json({ success: true, data: { invites } });
});

export const respondToCollaboration = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { collaborationId } = req.params;
  const { action } = req.body;

  if (!['accept', 'reject'].includes(action)) {
    throw new ApiError(400, "Action must be 'accept' or 'reject'");
  }

  const result = await PostService.respondToCollaboration(userId, collaborationId, action);
  res.json({ success: true, data: result });
});

export const removeCollaborator = catchAsync(async (req, res) => {
  const requesterId = req.user.id;
  const { postId, collaboratorId } = req.params;

  const result = await PostService.removeCollaborator(requesterId, postId, collaboratorId);
  res.json({ success: true, data: result });
});

export const getPosts = catchAsync(async (req, res) => {
  const { userId, username } = req.query;
  const viewerId = req.user.id;
  const {
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    mediaType,
    hasMedia,
    cursor,
    excludeCoverPosts,
  } = req.query;
  const user = await userService.findByUsername(username);
  let targetUserId = userId || viewerId;
  if (!targetUserId && username) {
    const user = await userService.findByUsername(username);
    if (!user) throw new ApiError(404, 'User not found');
    targetUserId = user.id;
  } else if (username && !userId) {
    const user = await userService.findByUsername(username);
    if (!user) throw new ApiError(404, 'User not found');
    targetUserId = user.id;
  }

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder,
    mediaType,
    hasMedia: hasMedia ? hasMedia === 'true' : null,
    cursor,
    excludeCoverPosts: excludeCoverPosts === 'true',
  };

  const result = await SocialService.getPosts(targetUserId, viewerId, options);

  res.json({
    success: true,
    data: result,
  });
});

export const getPost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const viewerId = req.user.id;

  const post = await SocialService.getPost(postId, viewerId);

  res.json({
    success: true,
    data: { post },
  });
});

export const getProfileAnalytics = catchAsync(async (req, res) => {
  const { username } = req.params;
  const { dateFrom, dateTo } = req.query;
  const requesterId = req.user.id;
  const user = await userService.findByUsername(username);
  if (!user) throw new ApiError(404, 'User not found');
  const stats = await SocialService.getProfileAnalytics(user.id, requesterId, {
    dateFrom,
    dateTo,
  });
  res.json({ success: true, data: { analytics: stats } });
});

export const updatePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { caption, location, visibility, settings, tags, aspectRatios, scheduledAt } = req.body;

  const post = await SocialService.updatePost(postId, userId, {
    caption,
    location,
    visibility,
    settings,
    tags,
    aspectRatios,
    scheduledAt,
    // Left undefined when absent, so an edit that never mentions products
    // leaves the post's existing links untouched.
    linkedProductIds: req.body.linkedProductIds,
    isPlus: req.user.isBritesidePlus,
  });
  res.json({
    success: true,
    message: 'Post updated successfully',
    data: { post },
  });
});

export const deletePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  await SocialService.deletePost(postId, userId);

  res.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

export const viewPost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  await SocialService.viewPost(postId, userId);
  res.json({ success: true });
});

export const getPostAnalytics = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const { dateFrom, dateTo } = req.query;
  const userId = req.user.id;
  const stats = await SocialService.getPostAnalytics(postId, userId, { dateFrom, dateTo });
  res.json({ success: true, data: { analytics: stats } });
});

export const toggleLikePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  const result = await SocialService.toggleLikePost(postId, userId);

  res.json({
    success: true,
    message: result.liked ? 'Post liked successfully' : 'Post unliked successfully',
    data: result,
  });
});

export const sharePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { caption } = req.body;

  const share = await SocialService.sharePost(postId, userId, caption);

  res.json({
    success: true,
    message: 'Post shared successfully',
    data: { share },
  });
});

export const toggleSavePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  const result = await SocialService.toggleSavePost(postId, userId);

  res.json({
    success: true,
    message: result.saved ? 'Post saved successfully' : 'Post unsaved successfully',
    data: result,
  });
});

export const toggleRepost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  const result = await SocialService.toggleRepost(postId, userId);

  res.json({
    success: true,
    message: result.reposted ? 'Post reposted successfully' : 'Post unreposted successfully',
    data: result,
  });
});

export const pinPost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const result = await PostService.pinPost(userId, postId);
  res.json({ success: true, data: result });
});

export const unpinPost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const result = await PostService.unpinPost(userId, postId);
  res.json({ success: true, data: result });
});

export const reorderPins = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { pins } = req.body;
  if (!Array.isArray(pins)) throw new ApiError(400, 'pins must be an array');
  const result = await PostService.reorderPins(userId, pins);
  res.json({ success: true, data: result });
});

export const reorderPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { postIds } = req.body;
  if (!Array.isArray(postIds)) throw new ApiError(400, 'postIds must be an array');
  const result = await PostService.reorderPosts(userId, postIds);
  res.json({ success: true, data: result });
});

export const getRepostedPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await SocialService.getRepostedPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

/**
 * Get posts shared by the authenticated user
 * Query params: page, limit
 */
export const getSharedPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await SocialService.getSharedPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

export const getSavedPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await SocialService.getSavedPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

export const toggleHidePost = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  const result = await SocialService.toggleHidePost(postId, userId);

  res.json({
    success: true,
    message: result.hidden ? 'Post hidden successfully' : 'Post unhidden successfully',
    data: result,
  });
});

export const getHiddenPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await PostService.getHiddenPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

export const getLikedPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await SocialService.getLikedPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

export const getCommentedPosts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const posts = await SocialService.getCommentedPosts(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit),
      },
    },
  });
});

// ============ COMMENTS MANAGEMENT ============

export const addComment = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { content, parentId, mentionedUserIds } = req.body;

  if (!content || content.trim().length === 0) {
    throw new ApiError(400, 'Comment content is required');
  }

  const comment = await SocialService.addComment(
    postId,
    userId,
    content.trim(),
    parentId,
    Array.isArray(mentionedUserIds) ? mentionedUserIds : []
  );

  res.status(201).json({
    success: true,
    message: 'Comment added successfully',
    data: { comment },
  });
});

export const getComments = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const comments = await SocialService.getComments(postId, userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      comments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: comments.length === parseInt(limit),
      },
    },
  });
});

export const getCommentReplies = catchAsync(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const result = await SocialService.getCommentReplies(
    commentId,
    userId,
    parseInt(page),
    parseInt(limit)
  );

  res.json({ success: true, data: result });
});

export const updateComment = catchAsync(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;
  const { content, mentionedUserIds } = req.body;

  if (!content || content.trim().length === 0) {
    throw new ApiError(400, 'Comment content is required');
  }

  const comment = await SocialService.updateComment(
    commentId,
    userId,
    content.trim(),
    mentionedUserIds
  );

  res.json({
    success: true,
    message: 'Comment updated successfully',
    data: { comment },
  });
});

export const deleteComment = catchAsync(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  await SocialService.deleteComment(commentId, userId);

  res.json({
    success: true,
    message: 'Comment deleted successfully',
  });
});

export const toggleLikeComment = catchAsync(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  const result = await SocialService.toggleLikeComment(commentId, userId);

  res.json({
    success: true,
    message: result.liked ? 'Comment liked successfully' : 'Comment unliked successfully',
    data: result,
  });
});

// ============ STORIES MANAGEMENT ============

export const createStory = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const {
    mediaUrl,
    mediaType,
    caption,
    meta,
    visibility,
    commentsDisabled,
    hideViewCount,
    collectionId,
    mentionedUserIds,
  } = req.body;

  if (!mediaUrl) {
    throw new ApiError(400, 'Media URL is required');
  }

  if (!['image', 'video'].includes(mediaType)) {
    throw new ApiError(400, "Media type must be 'image' or 'video'");
  }

  const story = await StoryService.createStory(userId, {
    mediaUrl,
    mediaType,
    caption,
    meta,
    visibility,
    commentsDisabled: commentsDisabled ?? meta?.commentsDisabled ?? false,
    hideViewCount: hideViewCount ?? meta?.hideViewCount ?? false,
    mentionedUserIds: Array.isArray(mentionedUserIds) ? mentionedUserIds : [],
  });

  if (collectionId) {
    await StoryCollectionService.addItemSilent(collectionId, userId, {
      itemType: 'story',
      storyId: story.id,
    });
  }

  res.status(201).json({
    success: true,
    message: 'Story created successfully',
    data: { story },
  });
});

export const getStories = catchAsync(async (req, res) => {
  const userId = req.query.userId;
  const viewerId = req.user.id;
  const isTrending = req.query.trending;

  const stories = await SocialService.getStories(userId || viewerId, viewerId, isTrending === '1');

  res.json({
    success: true,
    data: { stories },
  });
});

export const getMyStories = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const stories = await StoryService.getMyStories(userId);

  res.json({
    success: true,
    data: { stories },
  });
});

export const viewStory = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;

  const result = await StoryService.viewStory(storyId, userId);
  res.json({
    success: true,
    message: 'Story viewed successfully',
    viewsCount: result.viewsCount,
  });
});

export const deleteStory = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;

  await StoryService.deleteStory(storyId, userId);

  res.json({
    success: true,
    message: 'Story deleted successfully',
  });
});

export const toggleLikeStory = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;

  const result = await StoryService.toggleLikeStory(storyId, userId);

  res.json({
    success: true,
    message: result.liked ? 'Story liked' : 'Story unliked',
    data: result,
  });
});

export const getStoryLikes = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const viewerId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const result = await StoryService.getStoryLikes(storyId, viewerId, Number(page), Number(limit));

  res.json({ success: true, data: result });
});

export const addStoryComment = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;
  const { content, parentId, mentionedUserIds } = req.body;

  if (!content || !content.trim()) {
    throw new ApiError(400, 'Comment content is required');
  }

  const comment = await StoryService.addStoryComment(
    storyId,
    userId,
    content.trim(),
    parentId,
    Array.isArray(mentionedUserIds) ? mentionedUserIds : []
  );

  res.status(201).json({
    success: true,
    message: 'Comment added successfully',
    data: { comment },
  });
});

export const updateStoryComment = catchAsync(async (req, res) => {
  const { storyId, commentId } = req.params;
  const userId = req.user.id;
  const { content, mentionedUserIds } = req.body;

  if (!content || !content.trim()) {
    throw new ApiError(400, 'Comment content is required');
  }

  const comment = await StoryService.updateStoryComment(
    storyId,
    commentId,
    userId,
    content.trim(),
    Array.isArray(mentionedUserIds) ? mentionedUserIds : []
  );

  res.json({
    success: true,
    message: 'Comment updated successfully',
    data: { comment },
  });
});
export const getStoryComments = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const viewerId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const result = await StoryService.getStoryComments(
    storyId,
    viewerId,
    Number(page),
    Number(limit)
  );

  res.json({ success: true, data: result });
});

export const deleteStoryComment = catchAsync(async (req, res) => {
  const { storyId, commentId } = req.params;
  const userId = req.user.id;

  await StoryService.deleteStoryComment(storyId, commentId, userId);

  res.json({ success: true, message: 'Comment deleted successfully' });
});

export const toggleLikeStoryComment = catchAsync(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  const result = await StoryService.toggleLikeStoryComment(commentId, userId);

  res.json({
    success: true,
    message: result.liked ? 'Comment liked' : 'Comment unliked',
    data: result,
  });
});

export const shareStory = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;
  const { caption } = req.body;

  const share = await StoryService.shareStory(storyId, userId, caption);

  res.json({
    success: true,
    message: 'Story shared successfully',
    data: { share },
  });
});

// ============ STORY POLLS ============

export const createStoryPoll = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const userId = req.user.id;
  const { type, question, meta } = req.body;

  const poll = await StoryPollService.createPoll(storyId, userId, { type, question, meta });

  res.status(201).json({
    success: true,
    message: 'Poll created successfully',
    data: { poll },
  });
});

export const respondToStoryPoll = catchAsync(async (req, res) => {
  const { pollId } = req.params;
  const userId = req.user.id;
  const { response } = req.body;

  const result = await StoryPollService.respond(pollId, userId, { response });

  res.status(201).json({
    success: true,
    message: 'Response submitted',
    data: { response: result },
  });
});

export const deleteStoryPoll = catchAsync(async (req, res) => {
  const { pollId } = req.params;
  const userId = req.user.id;

  await StoryPollService.deletePoll(pollId, userId);

  res.json({
    success: true,
    message: 'Poll deleted successfully',
  });
});

// ============ USER MANAGEMENT ============

export const blockUser = catchAsync(async (req, res) => {
  const blockerId = req.user.id;
  const { userId } = req.params;

  const block = await SocialService.blockUser(blockerId, userId);

  res.json({
    success: true,
    message: 'User blocked successfully',
    data: { block },
  });
});

export const unblockUser = catchAsync(async (req, res) => {
  const blockerId = req.user.id;
  const { userId } = req.params;

  await SocialService.unblockUser(blockerId, userId);

  res.json({
    success: true,
    message: 'User unblocked successfully',
  });
});

export const getBlockedUsers = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const users = await SocialService.getBlockedUsers(userId, parseInt(page), parseInt(limit));

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: users.length === parseInt(limit),
      },
    },
  });
});

export const getBlockStatus = catchAsync(async (req, res) => {
  const currentUserId = req.user.id;
  const { userId } = req.params;

  const [blockedByMe, blockedByThem] = await Promise.all([
    SocialService.isBlockedBy(currentUserId, userId),
    SocialService.isBlockedBy(userId, currentUserId),
  ]);

  res.json({
    success: true,
    data: { blockedByMe, blockedByThem },
  });
});

// Bulk block-relationship IDs (both directions) — for filtering a list
// client-side (conversation list, search results) without one status call
// per row.
export const getBlockRelationshipIds = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const userIds = await SocialService.getAllBlockRelationshipUserIds(userId);
  res.json({ success: true, data: { userIds } });
});

// ============ FEED MANAGEMENT ============

export const getFeed = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, cursor, mediaType, hasMedia, categoryId } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    cursor,
    mediaType,
    hasMedia: hasMedia ? hasMedia === 'true' : null,
  };

  const result = await SocialService.getFeed(userId, options, categoryId);

  res.json({
    success: true,
    data: result,
  });
});

export const getExploreFeed = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 20,
    cursor,
    mediaType,
    hasMedia,
    categoryId,
    sortBy = 'trending',
  } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    cursor,
    mediaType,
    hasMedia: hasMedia ? hasMedia === 'true' : null,
    sortBy,
  };

  const result = await SocialService.getExploreFeed(userId, options, categoryId);

  res.json({
    success: true,
    data: result,
  });
});

// ============ INTERESTS MANAGEMENT ============

export const getInterestCategories = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const result = await SocialService.getInterestCategories(userId, { page, limit });

  res.json({
    success: true,
    data: result,
  });
});

export const getUserInterests = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const interests = await SocialService.getUserInterests(userId);

  res.json({
    success: true,
    data: { interests },
  });
});

export const updateUserInterests = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { interests } = req.body;

  if (!Array.isArray(interests)) {
    throw new ApiError(400, 'Interests must be an array');
  }

  // Validate interests
  for (const interest of interests) {
    if (!interest.categoryId || typeof interest.intensity !== 'number') {
      throw new ApiError(400, 'Each interest must have categoryId and intensity');
    }
    if (interest.intensity < 0 || interest.intensity > 100) {
      throw new ApiError(400, 'Interest intensity must be between 0 and 100');
    }
  }

  const updatedInterests = await SocialService.updateUserInterests(userId, interests);

  res.json({
    success: true,
    message: 'Interests updated successfully',
    data: { interests: updatedInterests },
  });
});

export const searchInterests = catchAsync(async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.json({ success: true, data: { categories: [] } });
  }

  const categories = await SocialService.searchInterests(q);

  res.json({ success: true, data: { categories } });
});

export const addUserInterest = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { categoryId, name, intensity = 50, icon, color, description } = req.body;

  if (!categoryId && !name) {
    throw new ApiError(400, 'categoryId or name is required');
  }
  if (typeof intensity !== 'number' || intensity < 1 || intensity > 100) {
    throw new ApiError(400, 'Intensity must be a number between 1 and 100');
  }

  const interest = await SocialService.addUserInterest(userId, {
    categoryId,
    name,
    intensity,
    icon,
    color,
    description,
  });

  res.json({ success: true, data: { interest } });
});

export const removeUserInterest = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { categoryId } = req.params;

  await SocialService.removeUserInterest(userId, categoryId);

  res.json({ success: true, message: 'Interest removed' });
});

export const getPersonalizedFeed = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, cursor, categoryId } = req.query;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    cursor,
  };

  const result = await FeedService.getPersonalizedFeed(userId, options, categoryId);

  res.json({
    success: true,
    data: result,
  });
});

// ============ LEGACY EVENT INVITATIONS ============

export const inviteToEvent = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const inviterId = req.user.id;
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ApiError(400, 'User IDs array is required');
  }

  const invitations = await SocialService.inviteToEvent(eventId, inviterId, userIds);

  res.json({
    success: true,
    message: `${invitations.length} invitations sent`,
    data: { invitations },
  });
});

export const getUserInvitations = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;

  const invitations = await SocialService.getUserInvitations(userId, status);

  res.json({
    success: true,
    data: { invitations },
  });
});

export const respondToInvitation = catchAsync(async (req, res) => {
  const { invitationId } = req.params;
  const userId = req.user.id;
  const { status } = req.body;

  if (!['accepted', 'declined'].includes(status)) {
    throw new ApiError(400, "Status must be 'accepted' or 'declined'");
  }

  const updated = await SocialService.respondToInvitation(invitationId, userId, status);

  res.json({
    success: true,
    message: `Invitation ${status}`,
    data: { invitation: updated },
  });
});

export const getPostPendingInvites = catchAsync(async (req, res) => {
  const { postId } = req.params;
  const requesterId = req.user.id;

  const invites = await PostService.getPostPendingInvites(postId, requesterId);

  res.json({ success: true, data: { invites } });
});
// ============ SUGGESTED USERS ============

/**
 * GET /api/social/suggested-users
 * Query: page (default 1), limit (default 10)
 *
 * Returns a ranked list of users the authenticated user might want to follow,
 * scored by mutual connections, shared interests, and post interaction overlap.
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     users: [
 *       {
 *         id, firstName, lastName, username, image,
 *         bio, followersCount, isVerified, isPublic,
 *         mutualFollowersCount, score, reason
 *       }
 *     ],
 *     pagination: { page, limit, total, hasMore }
 *   }
 * }
 */
export const getSuggestedUsers = catchAsync(async (req, res) => {
  const currentUserId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);

  const result = await SuggestedUsersService.getSuggestions(currentUserId, { page, limit });

  res.json({
    success: true,
    data: {
      users: result.users,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.page * result.limit < result.total,
      },
    },
  });
});

export const getStoryViewers = catchAsync(async (req, res) => {
  const { storyId } = req.params;
  const result = await StoryService.getStoryViewers(
    storyId,
    req.user.id,
    Number(req.query.page ?? 1),
    Number(req.query.limit ?? 20)
  );
  res.json({ success: true, data: result });
});
// social.controller.js
export const getFollowRequests = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const requests = await SocialService.getFollowRequests(userId);
  res.json({ success: true, data: { requests } });
});

export const respondToFollowRequest = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { requestId } = req.params;
  const { action } = req.body; // 'accept' | 'reject'

  if (!['accept', 'reject'].includes(action)) {
    throw new ApiError(400, "Action must be 'accept' or 'reject'");
  }

  const result = await SocialService.respondToFollowRequest(userId, requestId, action);
  res.json({ success: true, data: result });
});
export const inviteCollaborators = catchAsync(async (req, res) => {
  const requesterId = req.user.id;
  const { postId } = req.params;
  const { collaboratorIds } = req.body;

  if (!Array.isArray(collaboratorIds) || collaboratorIds.length === 0) {
    throw new ApiError(400, 'collaboratorIds must be a non-empty array');
  }

  const result = await PostService.inviteCollaborators(requesterId, postId, collaboratorIds);

  res.json({ success: true, data: result });
});
export const createPostTabLink = catchAsync(async (req, res) => {
  const link = await PostService.createPostTabLink(req.user.id, req.body, req.user.isBritesidePlus);
  res.status(201).json({ success: true, message: 'Link added', data: { link } });
});

export const updatePostTabLink = catchAsync(async (req, res) => {
  const link = await PostService.updatePostTabLink(req.user.id, req.params.linkId, req.body);
  res.json({ success: true, message: 'Link updated', data: { link } });
});

export const deletePostTabLink = catchAsync(async (req, res) => {
  const result = await PostService.deletePostTabLink(req.user.id, req.params.linkId);
  res.json({ success: true, message: 'Link deleted', data: result });
});

export const clickPostTabLink = catchAsync(async (req, res) => {
  const result = await PostService.clickPostTabLink(req.params.linkId);
  res.json({ success: true, data: result });
});

export const reorderPostTabItems = catchAsync(async (req, res) => {
  const result = await PostService.reorderPostTabItems(req.user.id, req.body.items);
  res.json({ success: true, message: 'Order saved', data: result });
});

export const pinPostTabLink = catchAsync(async (req, res) => {
  const result = await PostService.pinLink(req.user.id, req.params.linkId);
  res.json({ success: true, data: result });
});

export const unpinPostTabLink = catchAsync(async (req, res) => {
  const result = await PostService.unpinLink(req.user.id, req.params.linkId);
  res.json({ success: true, data: result });
});

// ============ POPULAR COVERS (shared logo library) ============

export const getPopularCovers = catchAsync(async (req, res) => {
  const covers = await SocialService.listPopularCovers();
  res.json({ success: true, data: { covers } });
});

export const addPopularCover = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { name, url, coverType } = req.body;

  const cover = await SocialService.addPopularCover(userId, { name, url, coverType });

  res.status(201).json({
    success: true,
    message: 'Logo added to popular covers',
    data: { cover },
  });
});

export const deletePopularCover = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { coverId } = req.params;

  await SocialService.removePopularCover(userId, coverId);

  res.json({ success: true, message: 'Logo removed successfully' });
});