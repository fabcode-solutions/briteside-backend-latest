/**
 * Social Service - Main Entry Point
 *
 * This file re-exports all social services from their respective modules
 * and maintains backward compatibility with the original SocialService class.
 *
 * For new code, prefer importing from the specific service modules:
 * - ProfileService: Profile management
 * - FollowService: Follow system
 * - PostService: Posts management
 * - CommentService: Comments management
 * - StoryService: Stories management
 * - BlockService: User blocking
 * - FeedService: Feed management
 * - SearchService: User search
 * - InterestService: Interests management
 * - EventInvitationService: Event invitations
 * - PopularCoverService: Shared "popular covers" logo library
 */

// Re-export all services
export {
  ProfileService,
  FollowService,
  PostService,
  CommentService,
  StoryService,
  BlockService,
  FeedService,
  SearchService,
  InterestService,
  EventInvitationService,
  PinnedProfileService,
  PopularCoverService
} from './social/index.js';

// Import services for backward-compatible SocialService class
import { ProfileService } from './social/profile.service.js';
import { FollowService } from './social/follow.service.js';
import { PinnedProfileService } from './social/pinnedProfile.service.js';

import { PostService } from './social/post.service.js';
import { CommentService } from './social/comment.service.js';
import { StoryService } from './social/story.service.js';
import { BlockService } from './social/block.service.js';
import { FeedService } from './social/feed.service.js';
import { SearchService } from './social/search.service.js';
import { InterestService } from './social/interest.service.js';
import { EventInvitationService } from './social/eventInvitation.service.js';
import { PopularCoverService } from './social/popularCover.service.js';
import { eq, and, desc, or, is, sql } from 'drizzle-orm';
import {
  socialWallPosts,
  users,
  userFollowRequests,
  userFollows,
  socialProfiles,
} from '../db/schema/index.js';
import { db } from '../db/index.js';
import ApiError from '../utils/api-error.js';
import { createNotification } from './notification.service.js';
import { randomUUID } from 'crypto';
export class SocialService {
  // ============ POST TAGS ============

  static async addTagsToPost(postId, tagCategoryIds, source = 'manual') {
    return PostService.addTagsToPost(postId, tagCategoryIds, source);
  }

  // ============ PROFILE MANAGEMENT ============

  static async getOrCreateSocialProfile(userId) {
    return ProfileService.getOrCreateSocialProfile(userId);
  }

  static async updateSocialProfile(userId, data) {
    return ProfileService.updateSocialProfile(userId, data);
  }

  static async getUserOrganizers(userId) {
    return ProfileService.getUserOrganizers(userId);
  }

  static async linkOrganizer(userId, organizerId) {
    return ProfileService.linkOrganizer(userId, organizerId);
  }

  static async viewProfile(profileUserId, viewerId) {
    return ProfileService.viewProfile(profileUserId, viewerId);
  }

  static async getProfileAnalytics(profileUserId, userId, filters = {}) {
    return ProfileService.getProfileAnalytics(profileUserId, userId, filters);
  }

  // additional methods for statuses and wall posts

  static async postToWall(profileUserId, authorId, content, expiresAt) {
    return ProfileService.postToWall(profileUserId, authorId, content, expiresAt);
  }

  static async getWallPosts(profileUserId, viewerId, page = 1, limit = 20) {
    return ProfileService.getWallPosts(profileUserId, viewerId, page, limit);
  }

  static async approveOrRejectWallPost(profileUserId, postId, status) {
    return ProfileService.approveOrRejectWallPost(profileUserId, postId, status);
  }

  // allow authors to delete their own pending wall posts
  static async deleteWallPost(authorId, postId) {
    return ProfileService.deleteWallPost(authorId, postId);
  }

  static async getPendingWallPostsCount(profileUserId) {
    return ProfileService.getPendingWallPostsCount(profileUserId);
  }

  // ============ FOLLOW SYSTEM ============

  static async toggleFollowUser(followerId, followingId) {
    return FollowService.toggleFollowUser(followerId, followingId);
  }

  static async updateFollowCounts(followerId, followingId) {
    return FollowService.updateFollowCounts(followerId, followingId);
  }

  static async getFollowers(userId, page = 1, limit = 20, viewerId = null) {
    return FollowService.getFollowers(userId, page, limit, viewerId);
  }

  static async getFollowing(userId, page = 1, limit = 20, viewerId = null) {
    return FollowService.getFollowing(userId, page, limit, viewerId);
  }

  static async isFollowing(followerId, followingId) {
    return FollowService.isFollowing(followerId, followingId);
  }

  // ============ PINNED PROFILES ============

  static async togglePinProfile(userId, targetUserId) {
    return PinnedProfileService.togglePin(userId, targetUserId);
  }

  static async isProfilePinned(userId, targetUserId) {
    return PinnedProfileService.isPinned(userId, targetUserId);
  }

  static async getPinnedProfiles(userId, page = 1, limit = 20, search = '') {
    return PinnedProfileService.getPinnedProfiles(userId, page, limit, search);
  }

  // ============ POSTS MANAGEMENT ============

  static async createPost(userId, postData) {
    return PostService.createPost(userId, postData);
  }

  static async getScheduledPosts(userId) {
    return PostService.getScheduledPosts(userId);
  }

  static async getPosts(userId, viewerId, options = {}) {
    return PostService.getPosts(userId, viewerId, options);
  }

  static async getPost(postId, viewerId) {
    return PostService.getPost(postId, viewerId);
  }

  static async viewPost(postId, viewerId) {
    return PostService.viewPost(postId, viewerId);
  }

  static async getPostAnalytics(postId, userId, filters = {}) {
    return PostService.getPostAnalytics(postId, userId, filters);
  }

  static async updatePost(postId, userId, data) {
    return PostService.updatePost(postId, userId, data);
  }

  static async deletePost(postId, userId) {
    return PostService.deletePost(postId, userId);
  }

  static async toggleLikePost(postId, userId) {
    return PostService.toggleLikePost(postId, userId);
  }

  static async sharePost(postId, userId, caption) {
    return PostService.sharePost(postId, userId, caption);
  }

  static async toggleSavePost(postId, userId) {
    return PostService.toggleSavePost(postId, userId);
  }

  static async toggleHidePost(postId, userId) {
    return PostService.toggleHidePost(postId, userId);
  }

  static async toggleRepost(postId, userId) {
    return PostService.toggleRepost(postId, userId);
  }

  static async getRepostedPosts(userId, page = 1, limit = 20) {
    return PostService.getRepostedPosts(userId, page, limit);
  }

  static async getSharedPosts(userId, page = 1, limit = 20) {
    return PostService.getSharedPosts(userId, page, limit);
  }

  static async getCommentedPosts(userId, page = 1, limit = 20) {
    return PostService.getCommentedPosts(userId, page, limit);
  }

  static async getSavedPosts(userId, page = 1, limit = 20) {
    return PostService.getSavedPosts(userId, page, limit);
  }

  static async getHiddenPosts(userId, page = 1, limit = 20) {
    return PostService.getHiddenPosts(userId, page, limit);
  }

  static async getLikedPosts(userId, page = 1, limit = 20) {
    return PostService.getLikedPosts(userId, page, limit);
  }

  // ============ COMMENTS MANAGEMENT ============

  static async addComment(postId, userId, content, parentId = null, mentionedUserIds = []) {
    return CommentService.addComment(postId, userId, content, parentId, mentionedUserIds);
  }

  static async getComments(postId, userId, page = 1, limit = 20) {
    return CommentService.getComments(postId, userId, page, limit);
  }

  static async getCommentReplies(commentId, userId, page = 1, limit = 20) {
    return CommentService.getCommentReplies(commentId, userId, page, limit);
  }

  static async updateComment(commentId, userId, content, mentionedUserIds = []) {
    return CommentService.updateComment(commentId, userId, content, mentionedUserIds);
  }

  static async deleteComment(commentId, userId) {
    return CommentService.deleteComment(commentId, userId);
  }

  static async toggleLikeComment(commentId, userId) {
    return CommentService.toggleLikeComment(commentId, userId);
  }

  // ============ STORIES MANAGEMENT ============

  static async createStory(userId, storyData) {
    return StoryService.createStory(userId, storyData);
  }

  static async getStories(userId, viewerId, isTrending) {
    return StoryService.getStories(userId, viewerId, isTrending);
  }

  static async getMyStories(userId) {
    return StoryService.getMyStories(userId);
  }

  static async viewStory(storyId, userId) {
    return StoryService.viewStory(storyId, userId);
  }

  static async deleteStory(storyId, userId) {
    return StoryService.deleteStory(storyId, userId);
  }

  // ============ USER MANAGEMENT ============

  static async blockUser(blockerId, blockedId) {
    return BlockService.blockUser(blockerId, blockedId);
  }

  static async unblockUser(blockerId, blockedId) {
    return BlockService.unblockUser(blockerId, blockedId);
  }

  static async getBlockedUsers(userId, page = 1, limit = 20) {
    return BlockService.getBlockedUsers(userId, page, limit);
  }

  static async isBlocked(userId1, userId2) {
    return BlockService.isBlocked(userId1, userId2);
  }

  static async isBlockedBy(blockerId, blockedId) {
    return BlockService.isBlockedBy(blockerId, blockedId);
  }

  static async getAllBlockRelationshipUserIds(userId) {
    return BlockService.getAllBlockRelationshipUserIds(userId);
  }

  // ============ FEED MANAGEMENT ============

  static async getFeed(userId, options = {}, categoryId) {
    return FeedService.getFeed(userId, options, categoryId);
  }

  static async getExploreFeed(userId, options = {}, categoryId) {
    return FeedService.getExploreFeed(userId, options, categoryId);
  }

  static async getPersonalizedFeed(userId, options = {}, categoryId) {
    return FeedService.getPersonalizedFeed(userId, options, categoryId);
  }

  // ============ SEARCH ============

  static async searchUsers(query, currentUserId, page = 1, limit = 20, forMention = false) {
    return SearchService.searchUsers(query, currentUserId, page, limit, forMention);
  }

  // ============ INTERESTS MANAGEMENT ============

  static async getInterestCategories(userId, params) {
    return InterestService.getInterestCategories(userId, params);
  }

  static async getUserInterests(userId) {
    return InterestService.getUserInterests(userId);
  }

  static async updateUserInterests(userId, interests) {
    return InterestService.updateUserInterests(userId, interests);
  }

  static async searchInterests(query) {
    return InterestService.searchInterests(query);
  }

  static async addUserInterest(userId, data) {
    return InterestService.addUserInterest(userId, data);
  }

  static async removeUserInterest(userId, categoryId) {
    return InterestService.removeUserInterest(userId, categoryId);
  }

  // ============ POPULAR COVERS (shared logo library) ============

  static async listPopularCovers() {
    return PopularCoverService.list();
  }

  static async addPopularCover(userId, data) {
    return PopularCoverService.add(userId, data);
  }

  static async removePopularCover(userId, coverId) {
    return PopularCoverService.remove(userId, coverId);
  }

  // ============ LEGACY EVENT INVITATIONS ============

  static async inviteToEvent(eventId, inviterId, inviteeIds) {
    return EventInvitationService.inviteToEvent(eventId, inviterId, inviteeIds);
  }

  static async getUserInvitations(userId, status = null) {
    return EventInvitationService.getUserInvitations(userId, status);
  }

  static async respondToInvitation(invitationId, userId, status) {
    return EventInvitationService.respondToInvitation(invitationId, userId, status);
  }

  static async respondToFollowRequest(targetUserId, requestId, action) {
    // action: 'accept' | 'reject'
    const request = await db.query.userFollowRequests.findFirst({
      where: and(
        eq(userFollowRequests.id, requestId),
        eq(userFollowRequests.targetId, targetUserId),
        eq(userFollowRequests.status, 'pending')
      ),
    });

    if (!request) throw new ApiError(404, 'Follow request not found');

    if (action === 'accept') {
      // Create the actual follow
      await db.insert(userFollows).values({
        id: randomUUID(),
        followerId: request.requesterId,
        followingId: targetUserId,
        createdAt: new Date(),
      });

      // Increment counts
      await db
        .update(socialProfiles)
        .set({ followingCount: sql`${socialProfiles.followingCount} + 1` })
        .where(eq(socialProfiles.userId, request.requesterId));

      await db
        .update(socialProfiles)
        .set({ followersCount: sql`${socialProfiles.followersCount} + 1` })
        .where(eq(socialProfiles.userId, targetUserId));

      // Notify requester
      await createNotification({
        userId: request.requesterId,
        title: 'Follow Request Accepted',
        message: `Your follow request was accepted.`,
        type: 'follow_accepted',
        relatedId: targetUserId,
        redirectTo: `/notifications`,
        metadata: { targetUserId },
      });
    }

    // Delete the request regardless of accept/reject
    await db.delete(userFollowRequests).where(eq(userFollowRequests.id, requestId));

    return { action, requestId };
  }

  static async getFollowRequests(targetUserId) {
    const requests = await db
      .select({
        id: userFollowRequests.id,
        status: userFollowRequests.status,
        createdAt: userFollowRequests.createdAt,
        requesterId: userFollowRequests.requesterId,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        image: users.image,
      })
      .from(userFollowRequests)
      .leftJoin(users, eq(userFollowRequests.requesterId, users.id))
      .where(
        and(eq(userFollowRequests.targetId, targetUserId), eq(userFollowRequests.status, 'pending'))
      )
      .orderBy(desc(userFollowRequests.createdAt));

    return requests;
  }
}

// default export for compatibility with code that uses `import SocialService from` syntax
export default SocialService;