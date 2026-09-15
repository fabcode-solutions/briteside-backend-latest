import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  createBioLink,
  getMyBioLinks,
  getUserBioLinks,
  updateBioLink,
  deleteBioLink,
  trackBioLinkClick,
} from '../controllers/bioLink.controller.js';
import {
  createCollection,
  getMyCollections,
  getUserCollections,
  getCollectionItems,
  updateCollection,
  deleteCollection,
  addCollectionItem,
  removeCollectionItem,
} from '../controllers/storyCollection.controller.js';
import {
  getSocialProfile,
  getProfileAnalytics,
  updateSocialProfile,
  checkProfileUsernameAvailability,
  getUserOrganizers,
  linkOrganizer,
  postOnWall,
  getWallPosts,
  getWallPendingCount,
  moderateWallPost,
  deleteWallPost,
  getFollowers,
  getFollowing,
  searchUsers,
  createPost,
  getScheduledPosts,
  getPosts,
  getPost,
  viewPost,
  getPostAnalytics,
  updatePost,
  deletePost,
  sharePost,
  getSharedPosts,
  getSavedPosts,
  getHiddenPosts,
  getLikedPosts,
  getCommentedPosts,
  pinPost,
  unpinPost,
  reorderPins,
  reorderPosts,
  addComment,
  getComments,
  getCommentReplies,
  updateComment,
  deleteComment,
  createStory,
  getStories,
  getStoryViewers,
  getMyStories,
  viewStory,
  deleteStory,
  toggleLikeStory,
  getStoryLikes,
  addStoryComment,
  getStoryComments,
  deleteStoryComment,
  toggleLikeStoryComment,
  shareStory,
  createStoryPoll,
  respondToStoryPoll,
  deleteStoryPoll,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getBlockStatus,
  getBlockRelationshipIds,
  getFeed,
  getExploreFeed,
  getPersonalizedFeed,
  getInterestCategories,
  getUserInterests,
  updateUserInterests,
  searchInterests,
  searchAppleMusicSongs,
  addUserInterest,
  removeUserInterest,
  inviteToEvent,
  getUserInvitations,
  respondToInvitation,
  toggleFollowUser,
  togglePinProfile,
  getPinnedProfiles,
  toggleLikePost,
  toggleSavePost,
  toggleHidePost,
  toggleRepost,
  getRepostedPosts,
  toggleLikeComment,
  getSuggestedUsers,
  getFollowRequests,
  respondToFollowRequest,
  removeCollaborator,
  respondToCollaboration,
  getPendingCollaborations,
  inviteCollaborators,
  getPostPendingInvites,
  updateStoryComment,
  clickPostTabLink,
  reorderPostTabItems,
  createPostTabLink,
  updatePostTabLink,
  deletePostTabLink,
  pinPostTabLink,
  unpinPostTabLink,
  getPopularCovers,
  addPopularCover,
  deletePopularCover,
} from '../controllers/social.controller.js';


const router = express.Router();

router.post('/bio-links/:linkId/click', trackBioLinkClick);
router.post('/post-tab-links/:linkId/click', clickPostTabLink);

router.use(authMiddleware);

// Profile routes
router.get('/profile/check-username', checkProfileUsernameAvailability);
router.get('/profile/:username/analytics', getProfileAnalytics);
router.get('/profile/:username', getSocialProfile);
router.put(
  '/profile',
  checkBlockedUrl('website', { optional: true }),
  checkBlockedUrl('bio', { optional: true, scanText: true }),
  checkBlockedUrl('buttonMeta', { optional: true, scanText: true }),
  updateSocialProfile
);
router.get('/organizers', getUserOrganizers);
router.post('/profile/link-organizer', linkOrganizer);

router.post(
  '/profile/:username/wall',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  postOnWall
);
router.get('/profile/:username/wall', getWallPosts);
router.get('/profile/:username/wall/pending-count', getWallPendingCount);
router.put('/wall/:postId/status', moderateWallPost);
router.delete('/wall/:postId', deleteWallPost);

router.post('/follow/:userId', toggleFollowUser);
router.get('/followers/:userId', getFollowers);
router.get('/following/:userId', getFollowing);

router.get('/pinned-profiles', getPinnedProfiles);
router.post('/pinned-profiles/:username', togglePinProfile);

router.get('/search', searchUsers);

// Posts routes
router.post('/posts', checkBlockedUrl('caption', { optional: true, scanText: true }), createPost);
router.get('/posts', getPosts);
router.get('/posts/scheduled', getScheduledPosts);
router.get('/collaborations/pending', getPendingCollaborations);
router.get('/posts/:postId/collaborators/pending', getPostPendingInvites);
router.post('/collaborations/:collaborationId/respond', respondToCollaboration);
router.delete('/posts/:postId/collaborators/:collaboratorId', removeCollaborator);
router.post('/posts/:postId/collaborators/invite', inviteCollaborators);
router.put('/posts/pins/reorder', reorderPins);
router.put('/posts/reorder', reorderPostTabItems);
router.post('/post-tab-links', checkBlockedUrl('url'), createPostTabLink);
router.put(
  '/post-tab-links/:linkId',
  checkBlockedUrl('url', { optional: true }),
  updatePostTabLink
);
router.delete('/post-tab-links/:linkId', deletePostTabLink);
router.post('/post-tab-links/:linkId/pin', pinPostTabLink);
router.delete('/post-tab-links/:linkId/pin', unpinPostTabLink);
router.get('/popular-covers', getPopularCovers);
router.post('/popular-covers', checkBlockedUrl('url'), addPopularCover);
router.delete('/popular-covers/:coverId', deletePopularCover);
router.get('/posts/:postId', getPost);
router.post('/posts/:postId/view', viewPost);
router.get('/posts/:postId/analytics', getPostAnalytics);
router.put(
  '/posts/:postId',
  checkBlockedUrl('caption', { optional: true, scanText: true }),
  updatePost
);
router.delete('/posts/:postId', deletePost);
router.post('/posts/:postId/pin', pinPost);
router.delete('/posts/:postId/pin', unpinPost);
router.post('/posts/:postId/like', toggleLikePost);
router.post('/posts/:postId/repost', toggleRepost);
router.get('/reposted-posts', getRepostedPosts);
router.post('/posts/:postId/share', sharePost);
router.get('/shared-posts', getSharedPosts);
router.post('/posts/:postId/save', toggleSavePost);
router.post('/posts/:postId/hide', toggleHidePost);
router.get('/saved-posts', getSavedPosts);
router.get('/hidden-posts', getHiddenPosts);
router.get('/liked-posts', getLikedPosts);
router.get('/commented-posts', getCommentedPosts);

router.post(
  '/posts/:postId/comments',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  addComment
);
router.get('/posts/:postId/comments', getComments);
router.get('/comments/:commentId/replies', getCommentReplies);
router.put(
  '/comments/:commentId',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  updateComment
);
router.delete('/comments/:commentId', deleteComment);
router.post('/comments/:commentId/like', toggleLikeComment);

// Stories routes
router.post(
  '/stories',
  checkBlockedUrl('caption', { optional: true }),
  // `meta` carries the story's text-overlay/sticker content for text-type stories
  checkBlockedUrl('meta', { optional: true, scanText: true }),
  createStory
);
router.get('/stories', getStories);
router.get('/my-stories', getMyStories);
router.post('/stories/:storyId/view', viewStory);
router.delete('/stories/:storyId', deleteStory);
router.post('/stories/:storyId/like', toggleLikeStory);
router.get('/stories/:storyId/likes', getStoryLikes);
router.post(
  '/stories/:storyId/comments',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  addStoryComment
);
router.get('/stories/:storyId/comments', getStoryComments);
router.put(
  '/stories/:storyId/comments/:commentId',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  updateStoryComment
);
router.delete('/stories/:storyId/comments/:commentId', deleteStoryComment);
router.post('/stories/comments/:commentId/like', toggleLikeStoryComment);
router.post('/stories/:storyId/share', shareStory);

router.post('/stories/:storyId/polls', createStoryPoll);
router.post('/stories/:storyId/polls/:pollId/respond', respondToStoryPoll);
router.delete('/stories/:storyId/polls/:pollId', deleteStoryPoll);
router.get('/stories/:storyId/viewers', getStoryViewers);

router.post('/block/:userId', blockUser);
router.delete('/block/:userId', unblockUser);
router.get('/block/status/:userId', getBlockStatus);
router.get('/blocked-users', getBlockedUsers);
router.get('/blocked-relationships', getBlockRelationshipIds);

router.get('/feed', getFeed);
router.get('/explore', getExploreFeed);
router.get('/personalized-feed', getPersonalizedFeed);

router.get('/interests/categories', getInterestCategories);
router.get('/interests/search', searchInterests);
router.get('/profile-song/search', searchAppleMusicSongs);
router.get('/interests', getUserInterests);
router.put('/interests', updateUserInterests);
router.post('/interests', addUserInterest);
router.delete('/interests/:categoryId', removeUserInterest);

router.post('/events/:eventId/invite', inviteToEvent);
router.get('/invitations', getUserInvitations);
router.put('/invitations/:invitationId/respond', respondToInvitation);
router.get('/suggested-users', getSuggestedUsers);

router.get('/follow-requests', getFollowRequests);
router.put('/follow-requests/:requestId/respond', respondToFollowRequest);

// Bio link routes
router.post('/bio-links', checkBlockedUrl('url'), createBioLink);
router.get('/bio-links', getMyBioLinks);
router.get('/users/:userId/bio-links', getUserBioLinks);
router.put('/bio-links/:linkId', checkBlockedUrl('url', { optional: true }), updateBioLink);
router.delete('/bio-links/:linkId', deleteBioLink);

router.post('/collections', createCollection);
router.get('/collections', getMyCollections);
router.get('/collections/:collectionId/items', getCollectionItems);
router.put('/collections/:collectionId', updateCollection);
router.delete('/collections/:collectionId', deleteCollection);
router.post('/collections/:collectionId/items', addCollectionItem);
router.delete('/collections/:collectionId/items/:itemId', removeCollectionItem);
router.get('/users/:userId/collections', getUserCollections);

export default router;
