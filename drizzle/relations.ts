import { relations } from "drizzle-orm/relations";
import { events, purchasedMerchandise, eventMerchandise, organizers, users, userNotificationSettings, orders, orderItems, groups, groupJoinRequests, notifications, refunds, userInformation, streamCalls, mentions, discussionReplies, discussionReplyLikes, tokens, socialConversations, userReports, discussions, posts, media, postReposts, postComments, postUserComments, groupTags, tags, categories, discussionCategories, discussionSubscriptions, organizerMembers, ticketScans, eventTeamMembers, scanSessions, sessions, roles, userRoles, userPreferences, eventAttendees, eventTickets, paymentMethods, socialMessages, stories, purchasedTickets, eventSchedules, trackingLinks, groupMembers, eventMedia, eventInvitations, eventReviews, organizerReviews, reviewHelpfulness, venues, eventAnalytics, groupEventPromotions, commentLikes, postLikes, postShares, interestCategories, postTags, savedPosts, storyViews, userBlocks, userFollows, userInterests, chatModerationActions, eventChatRooms, eventChatMessages, eventChatParticipants, eventMessageReactions, eventMessageReadReceipts, groupChatRooms, groupChatMessages, groupMessageReadReceipts, adminReports, adminTasks, auditLogs, contentReports, taskSubtasks, eventAccessControl, eventGroupLinks, eventDiscountCodes, eventFaqs, eventSpeakers, eventSponsors, eventWaitlist, eventLikes, groupAnnouncements, socialWallPosts, groupSubscriptionTiers, groupMemberRoles, groupRules, userHiddenPosts, usernameReservations, groupCategories, socialProfiles, groupFeaturedContent, groupMedia, groupDiscussionNotifications, profileViews, eventVirtualDetails, postViews, storyLikes, talentProfiles, talentFavorites, storyPolls, storyPollResponses, talentAvailability, talentDateOverrides, talentGiftCodes, talentSessions, priorityMessagePayments, livestreams, livestreamComments, livestreamReactions, livestreamViewers, stripeCustomers, userSubscriptions, subscriptionPlans, subscriptionAuditLogs, subscriptionFeatures, trackingLinkClicks, eventTeams, eventTeamRoles, userFollowRequests, eventVenueProfiles, guestOrders, guestOrderItems, guestPurchasedTickets, groupSubscriptions, groupQuestions, eventBlasts, userSpends, organizerPresets, organizerPayouts, userPayoutMethods, stripeConnectAccounts, talentPayouts, groupPayouts, groupCourses, groupCourseLessons, groupCourseModules, groupCourseEnrollments, suspensionAppeals, groupCourseLessonProgress, demoSessions, demoRegistrations, talentIssues, talentReviews, shopCustomServiceOffers, organizerSocialLinks, storyCollections, storyCollectionItems, bioLinks, eventTicketScheduleInventory, followerInviteLog, storyComments, profileViewSessions, postCollaborators, imports, importImages, priorityMessageItems, priorityMessageAttachments, userPostOrderCounter, contentModeration, textModeration, pinnedProfiles, postShopProducts, shopProducts, shopProductViews, groupShopProducts, shopRefundRequests, shopOrders, groupAboutGallery, groupMessageReactions, groupCourseLessonAttachments, shopCourseModules, shopCustomOfferDeliverables, reserveAdjustments, shopCustomOfferActivity, shopCustomOfferDateExtensionRequests, shopCustomOfferDisputes, shopCustomOfferRevisionRequests, shopCustomOfferTips, postTabLinks, userPostOrder, pinnedPosts, popularLinkCovers, shopCourseLessons, shopCourseLessonAttachments, shopCourseLessonProgress, groupResources, eventMarketingSettings, analyticsEvents202609, analyticsEvents202610, analyticsEvents202611, analyticsEvents202612, analyticsIdentityLinks, postAnalyticsDaily, groupAnalyticsDaily, productAnalyticsDaily, serviceAnalyticsDaily, discussionLikes, mediaOwners, accounts } from "./schema";

export const purchasedMerchandiseRelations = relations(purchasedMerchandise, ({one}) => ({
	event: one(events, {
		fields: [purchasedMerchandise.eventId],
		references: [events.id]
	}),
	eventMerchandise: one(eventMerchandise, {
		fields: [purchasedMerchandise.merchandiseId],
		references: [eventMerchandise.id]
	}),
	organizer: one(organizers, {
		fields: [purchasedMerchandise.organizerId],
		references: [organizers.id]
	}),
	user: one(users, {
		fields: [purchasedMerchandise.userId],
		references: [users.id]
	}),
}));

export const eventsRelations = relations(events, ({one, many}) => ({
	purchasedMerchandises: many(purchasedMerchandise),
	userReports: many(userReports),
	eventMerchandises: many(eventMerchandise),
	eventAttendees: many(eventAttendees),
	purchasedTickets: many(purchasedTickets),
	eventMedias: many(eventMedia),
	eventInvitations: many(eventInvitations),
	eventReviews: many(eventReviews),
	organizerReviews: many(organizerReviews),
	eventSchedules: many(eventSchedules),
	eventTickets: many(eventTickets),
	eventAnalytics: many(eventAnalytics),
	groupEventPromotions: many(groupEventPromotions),
	eventChatRooms: many(eventChatRooms),
	eventAccessControls: many(eventAccessControl),
	eventGroupLinks: many(eventGroupLinks),
	eventDiscountCodes: many(eventDiscountCodes),
	eventFaqs: many(eventFaqs),
	eventSpeakers: many(eventSpeakers),
	eventSponsors: many(eventSponsors),
	eventWaitlists: many(eventWaitlist),
	eventLikes: many(eventLikes),
	eventVirtualDetails: many(eventVirtualDetails),
	trackingLinks: many(trackingLinks),
	trackingLinkClicks: many(trackingLinkClicks),
	scanSessions: many(scanSessions),
	eventTeams: many(eventTeams),
	eventVenueProfiles: many(eventVenueProfiles),
	guestOrders: many(guestOrders),
	guestPurchasedTickets: many(guestPurchasedTickets),
	eventBlasts: many(eventBlasts),
	userSpends: many(userSpends),
	orders: many(orders),
	eventTicketScheduleInventories: many(eventTicketScheduleInventory),
	followerInviteLogs: many(followerInviteLog),
	contentModerations: many(contentModeration),
	reserveAdjustments: many(reserveAdjustments),
	organizer: one(organizers, {
		fields: [events.organizerId],
		references: [organizers.id]
	}),
	organizerPreset: one(organizerPresets, {
		fields: [events.presetId],
		references: [organizerPresets.id]
	}),
	venue: one(venues, {
		fields: [events.venueId],
		references: [venues.id]
	}),
	eventMarketingSettings: many(eventMarketingSettings),
}));

export const eventMerchandiseRelations = relations(eventMerchandise, ({one, many}) => ({
	purchasedMerchandises: many(purchasedMerchandise),
	event: one(events, {
		fields: [eventMerchandise.eventId],
		references: [events.id]
	}),
}));

export const organizersRelations = relations(organizers, ({one, many}) => ({
	purchasedMerchandises: many(purchasedMerchandise),
	organizerMembers: many(organizerMembers),
	purchasedTickets: many(purchasedTickets),
	organizerReviews: many(organizerReviews),
	user: one(users, {
		fields: [organizers.userId],
		references: [users.id]
	}),
	socialProfiles: many(socialProfiles),
	trackingLinks: many(trackingLinks),
	scanSessions: many(scanSessions),
	organizerPresets: many(organizerPresets),
	organizerPayouts: many(organizerPayouts),
	organizerSocialLinks: many(organizerSocialLinks),
	followerInviteLogs: many(followerInviteLog),
	reserveAdjustments: many(reserveAdjustments),
	events: many(events),
}));

export const usersRelations = relations(users, ({many}) => ({
	purchasedMerchandises: many(purchasedMerchandise),
	userNotificationSettings: many(userNotificationSettings),
	groupJoinRequests_respondedBy: many(groupJoinRequests, {
		relationName: "groupJoinRequests_respondedBy_users_id"
	}),
	groupJoinRequests_userId: many(groupJoinRequests, {
		relationName: "groupJoinRequests_userId_users_id"
	}),
	notifications: many(notifications),
	userInformations: many(userInformation),
	streamCalls: many(streamCalls),
	mentions_mentionedByUserId: many(mentions, {
		relationName: "mentions_mentionedByUserId_users_id"
	}),
	mentions_mentionedUserId: many(mentions, {
		relationName: "mentions_mentionedUserId_users_id"
	}),
	discussionReplyLikes: many(discussionReplyLikes),
	tokens: many(tokens),
	userReports_reporterId: many(userReports, {
		relationName: "userReports_reporterId_users_id"
	}),
	userReports_reviewedBy: many(userReports, {
		relationName: "userReports_reviewedBy_users_id"
	}),
	userReports_targetUserId: many(userReports, {
		relationName: "userReports_targetUserId_users_id"
	}),
	media: many(media),
	postReposts: many(postReposts),
	postUserComments: many(postUserComments),
	discussionSubscriptions: many(discussionSubscriptions),
	sessions: many(sessions),
	userRoles: many(userRoles),
	userPreferences: many(userPreferences),
	eventAttendees_checkedInBy: many(eventAttendees, {
		relationName: "eventAttendees_checkedInBy_users_id"
	}),
	eventAttendees_userId: many(eventAttendees, {
		relationName: "eventAttendees_userId_users_id"
	}),
	paymentMethods: many(paymentMethods),
	discussions: many(discussions),
	socialMessages_createdBy: many(socialMessages, {
		relationName: "socialMessages_createdBy_users_id"
	}),
	socialMessages_senderId: many(socialMessages, {
		relationName: "socialMessages_senderId_users_id"
	}),
	socialMessages_updatedBy: many(socialMessages, {
		relationName: "socialMessages_updatedBy_users_id"
	}),
	purchasedTickets_transferredTo: many(purchasedTickets, {
		relationName: "purchasedTickets_transferredTo_users_id"
	}),
	purchasedTickets_userId: many(purchasedTickets, {
		relationName: "purchasedTickets_userId_users_id"
	}),
	groupMembers: many(groupMembers),
	eventMedias: many(eventMedia),
	eventInvitations_inviteeId: many(eventInvitations, {
		relationName: "eventInvitations_inviteeId_users_id"
	}),
	eventInvitations_inviterId: many(eventInvitations, {
		relationName: "eventInvitations_inviterId_users_id"
	}),
	eventReviews_moderatedBy: many(eventReviews, {
		relationName: "eventReviews_moderatedBy_users_id"
	}),
	eventReviews_userId: many(eventReviews, {
		relationName: "eventReviews_userId_users_id"
	}),
	organizerReviews: many(organizerReviews),
	reviewHelpfulnesses: many(reviewHelpfulness),
	organizers: many(organizers),
	venues: many(venues),
	discussionReplies: many(discussionReplies),
	groupEventPromotions: many(groupEventPromotions),
	postComments: many(postComments),
	commentLikes: many(commentLikes),
	postLikes: many(postLikes),
	postShares: many(postShares),
	savedPosts: many(savedPosts),
	socialConversations_createdBy: many(socialConversations, {
		relationName: "socialConversations_createdBy_users_id"
	}),
	socialConversations_organizerUserId: many(socialConversations, {
		relationName: "socialConversations_organizerUserId_users_id"
	}),
	socialConversations_updatedBy: many(socialConversations, {
		relationName: "socialConversations_updatedBy_users_id"
	}),
	socialConversations_userAId: many(socialConversations, {
		relationName: "socialConversations_userAId_users_id"
	}),
	socialConversations_userBId: many(socialConversations, {
		relationName: "socialConversations_userBId_users_id"
	}),
	storyViews: many(storyViews),
	userBlocks_blockedId: many(userBlocks, {
		relationName: "userBlocks_blockedId_users_id"
	}),
	userBlocks_blockerId: many(userBlocks, {
		relationName: "userBlocks_blockerId_users_id"
	}),
	userFollows_followerId: many(userFollows, {
		relationName: "userFollows_followerId_users_id"
	}),
	userFollows_followingId: many(userFollows, {
		relationName: "userFollows_followingId_users_id"
	}),
	userInterests: many(userInterests),
	chatModerationActions_moderatorId: many(chatModerationActions, {
		relationName: "chatModerationActions_moderatorId_users_id"
	}),
	chatModerationActions_targetUserId: many(chatModerationActions, {
		relationName: "chatModerationActions_targetUserId_users_id"
	}),
	eventChatMessages_deletedBy: many(eventChatMessages, {
		relationName: "eventChatMessages_deletedBy_users_id"
	}),
	eventChatMessages_pinnedBy: many(eventChatMessages, {
		relationName: "eventChatMessages_pinnedBy_users_id"
	}),
	eventChatMessages_senderId: many(eventChatMessages, {
		relationName: "eventChatMessages_senderId_users_id"
	}),
	eventChatParticipants_mutedBy: many(eventChatParticipants, {
		relationName: "eventChatParticipants_mutedBy_users_id"
	}),
	eventChatParticipants_userId: many(eventChatParticipants, {
		relationName: "eventChatParticipants_userId_users_id"
	}),
	eventMessageReactions: many(eventMessageReactions),
	eventMessageReadReceipts: many(eventMessageReadReceipts),
	groupChatMessages_deletedBy: many(groupChatMessages, {
		relationName: "groupChatMessages_deletedBy_users_id"
	}),
	groupChatMessages_senderId: many(groupChatMessages, {
		relationName: "groupChatMessages_senderId_users_id"
	}),
	groupMessageReadReceipts: many(groupMessageReadReceipts),
	adminReports: many(adminReports),
	adminTasks_assignedTo: many(adminTasks, {
		relationName: "adminTasks_assignedTo_users_id"
	}),
	adminTasks_createdBy: many(adminTasks, {
		relationName: "adminTasks_createdBy_users_id"
	}),
	auditLogs: many(auditLogs),
	contentReports_reporterId: many(contentReports, {
		relationName: "contentReports_reporterId_users_id"
	}),
	contentReports_reviewedBy: many(contentReports, {
		relationName: "contentReports_reviewedBy_users_id"
	}),
	eventAccessControls_grantedBy: many(eventAccessControl, {
		relationName: "eventAccessControl_grantedBy_users_id"
	}),
	eventAccessControls_userId: many(eventAccessControl, {
		relationName: "eventAccessControl_userId_users_id"
	}),
	eventGroupLinks: many(eventGroupLinks),
	eventWaitlists: many(eventWaitlist),
	eventLikes: many(eventLikes),
	groupAnnouncements: many(groupAnnouncements),
	posts: many(posts),
	userHiddenPosts: many(userHiddenPosts),
	usernameReservations: many(usernameReservations),
	groups: many(groups),
	socialWallPosts_authorId: many(socialWallPosts, {
		relationName: "socialWallPosts_authorId_users_id"
	}),
	socialWallPosts_createdBy: many(socialWallPosts, {
		relationName: "socialWallPosts_createdBy_users_id"
	}),
	socialWallPosts_deletedBy: many(socialWallPosts, {
		relationName: "socialWallPosts_deletedBy_users_id"
	}),
	socialWallPosts_updatedBy: many(socialWallPosts, {
		relationName: "socialWallPosts_updatedBy_users_id"
	}),
	groupFeaturedContents: many(groupFeaturedContent),
	groupMedias: many(groupMedia),
	groupDiscussionNotifications: many(groupDiscussionNotifications),
	profileViews: many(profileViews),
	postViews: many(postViews),
	socialProfiles: many(socialProfiles),
	stories: many(stories),
	talentFavorites: many(talentFavorites),
	storyPolls: many(storyPolls),
	storyPollResponses: many(storyPollResponses),
	talentGiftCodes: many(talentGiftCodes),
	priorityMessagePayments_senderId: many(priorityMessagePayments, {
		relationName: "priorityMessagePayments_senderId_users_id"
	}),
	priorityMessagePayments_talentUserId: many(priorityMessagePayments, {
		relationName: "priorityMessagePayments_talentUserId_users_id"
	}),
	talentSessions_bookerId: many(talentSessions, {
		relationName: "talentSessions_bookerId_users_id"
	}),
	talentSessions_cancelledBy: many(talentSessions, {
		relationName: "talentSessions_cancelledBy_users_id"
	}),
	livestreams: many(livestreams),
	livestreamComments: many(livestreamComments),
	livestreamReactions: many(livestreamReactions),
	livestreamViewers: many(livestreamViewers),
	stripeCustomers: many(stripeCustomers),
	userSubscriptions_grantedBy: many(userSubscriptions, {
		relationName: "userSubscriptions_grantedBy_users_id"
	}),
	userSubscriptions_userId: many(userSubscriptions, {
		relationName: "userSubscriptions_userId_users_id"
	}),
	subscriptionAuditLogs: many(subscriptionAuditLogs),
	eventTeams: many(eventTeams),
	eventTeamMembers: many(eventTeamMembers),
	userFollowRequests_requesterId: many(userFollowRequests, {
		relationName: "userFollowRequests_requesterId_users_id"
	}),
	userFollowRequests_targetId: many(userFollowRequests, {
		relationName: "userFollowRequests_targetId_users_id"
	}),
	groupSubscriptions: many(groupSubscriptions),
	eventBlasts: many(eventBlasts),
	userSpends_talentUserId: many(userSpends, {
		relationName: "userSpends_talentUserId_users_id"
	}),
	userSpends_userId: many(userSpends, {
		relationName: "userSpends_userId_users_id"
	}),
	organizerPayouts: many(organizerPayouts),
	userPayoutMethods: many(userPayoutMethods),
	stripeConnectAccounts: many(stripeConnectAccounts),
	talentPayouts: many(talentPayouts),
	groupPayouts: many(groupPayouts),
	groupCourses_createdBy: many(groupCourses, {
		relationName: "groupCourses_createdBy_users_id"
	}),
	groupCourses_ownerId: many(groupCourses, {
		relationName: "groupCourses_ownerId_users_id"
	}),
	groupCourseEnrollments: many(groupCourseEnrollments),
	suspensionAppeals_adminId: many(suspensionAppeals, {
		relationName: "suspensionAppeals_adminId_users_id"
	}),
	suspensionAppeals_userId: many(suspensionAppeals, {
		relationName: "suspensionAppeals_userId_users_id"
	}),
	orders: many(orders),
	groupCourseLessonProgresses: many(groupCourseLessonProgress),
	talentIssues_adminId: many(talentIssues, {
		relationName: "talentIssues_adminId_users_id"
	}),
	talentIssues_reporterId: many(talentIssues, {
		relationName: "talentIssues_reporterId_users_id"
	}),
	talentIssues_talentUserId: many(talentIssues, {
		relationName: "talentIssues_talentUserId_users_id"
	}),
	talentReviews: many(talentReviews),
	storyCollections: many(storyCollections),
	bioLinks: many(bioLinks),
	storyComments: many(storyComments),
	profileViewSessions: many(profileViewSessions),
	postCollaborators_collaboratorId: many(postCollaborators, {
		relationName: "postCollaborators_collaboratorId_users_id"
	}),
	postCollaborators_invitedById: many(postCollaborators, {
		relationName: "postCollaborators_invitedById_users_id"
	}),
	imports: many(imports),
	importImages: many(importImages),
	priorityMessageAttachments: many(priorityMessageAttachments),
	userPostOrderCounters: many(userPostOrderCounter),
	contentModerations: many(contentModeration),
	textModerations_reviewedBy: many(textModeration, {
		relationName: "textModeration_reviewedBy_users_id"
	}),
	textModerations_userId: many(textModeration, {
		relationName: "textModeration_userId_users_id"
	}),
	pinnedProfiles_pinnedUserId: many(pinnedProfiles, {
		relationName: "pinnedProfiles_pinnedUserId_users_id"
	}),
	pinnedProfiles_userId: many(pinnedProfiles, {
		relationName: "pinnedProfiles_userId_users_id"
	}),
	shopProductViews: many(shopProductViews),
	shopRefundRequests_buyerId: many(shopRefundRequests, {
		relationName: "shopRefundRequests_buyerId_users_id"
	}),
	shopRefundRequests_resolvedByUserId: many(shopRefundRequests, {
		relationName: "shopRefundRequests_resolvedByUserId_users_id"
	}),
	shopRefundRequests_sellerId: many(shopRefundRequests, {
		relationName: "shopRefundRequests_sellerId_users_id"
	}),
	shopOrders_buyerId: many(shopOrders, {
		relationName: "shopOrders_buyerId_users_id"
	}),
	shopOrders_sellerId: many(shopOrders, {
		relationName: "shopOrders_sellerId_users_id"
	}),
	groupAboutGalleries: many(groupAboutGallery),
	shopCustomServiceOffers_buyerId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_buyerId_users_id"
	}),
	shopCustomServiceOffers_buyerId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_buyerId_users_id"
	}),
	shopCustomServiceOffers_sellerId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_sellerId_users_id"
	}),
	shopCustomServiceOffers_sellerId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_sellerId_users_id"
	}),
	groupMessageReactions: many(groupMessageReactions),
	talentProfiles: many(talentProfiles),
	shopProducts: many(shopProducts),
	shopCustomOfferDeliverables: many(shopCustomOfferDeliverables),
	shopCustomOfferActivities: many(shopCustomOfferActivity),
	shopCustomOfferDateExtensionRequests: many(shopCustomOfferDateExtensionRequests),
	shopCustomOfferDisputes_raisedByUserId: many(shopCustomOfferDisputes, {
		relationName: "shopCustomOfferDisputes_raisedByUserId_users_id"
	}),
	shopCustomOfferDisputes_resolvedByUserId: many(shopCustomOfferDisputes, {
		relationName: "shopCustomOfferDisputes_resolvedByUserId_users_id"
	}),
	shopCustomOfferRevisionRequests: many(shopCustomOfferRevisionRequests),
	shopCustomOfferTips_buyerId: many(shopCustomOfferTips, {
		relationName: "shopCustomOfferTips_buyerId_users_id"
	}),
	shopCustomOfferTips_sellerId: many(shopCustomOfferTips, {
		relationName: "shopCustomOfferTips_sellerId_users_id"
	}),
	postTabLinks: many(postTabLinks),
	userPostOrders: many(userPostOrder),
	pinnedPosts: many(pinnedPosts),
	popularLinkCovers: many(popularLinkCovers),
	shopCourseLessonProgresses: many(shopCourseLessonProgress),
	groupResources: many(groupResources),
	analyticsEvents202609s: many(analyticsEvents202609),
	analyticsEvents202610s: many(analyticsEvents202610),
	analyticsEvents202611s: many(analyticsEvents202611),
	analyticsEvents202612s: many(analyticsEvents202612),
	analyticsIdentityLinks: many(analyticsIdentityLinks),
	discussionLikes: many(discussionLikes),
	mediaOwners: many(mediaOwners),
	accounts: many(accounts),
}));

export const userNotificationSettingsRelations = relations(userNotificationSettings, ({one}) => ({
	user: one(users, {
		fields: [userNotificationSettings.userId],
		references: [users.id]
	}),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	orderItems: many(orderItems),
	refunds: many(refunds),
	eventAttendees: many(eventAttendees),
	event: one(events, {
		fields: [orders.eventId],
		references: [events.id]
	}),
	paymentMethod: one(paymentMethods, {
		fields: [orders.paymentMethodId],
		references: [paymentMethods.id]
	}),
	user: one(users, {
		fields: [orders.userId],
		references: [users.id]
	}),
	reserveAdjustments: many(reserveAdjustments),
}));

export const groupJoinRequestsRelations = relations(groupJoinRequests, ({one}) => ({
	group: one(groups, {
		fields: [groupJoinRequests.groupId],
		references: [groups.id]
	}),
	user_respondedBy: one(users, {
		fields: [groupJoinRequests.respondedBy],
		references: [users.id],
		relationName: "groupJoinRequests_respondedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [groupJoinRequests.userId],
		references: [users.id],
		relationName: "groupJoinRequests_userId_users_id"
	}),
}));

export const groupsRelations = relations(groups, ({one, many}) => ({
	groupJoinRequests: many(groupJoinRequests),
	userReports: many(userReports),
	groupTags: many(groupTags),
	discussions: many(discussions),
	groupMembers: many(groupMembers),
	groupEventPromotions: many(groupEventPromotions),
	groupChatRooms: many(groupChatRooms),
	eventGroupLinks: many(eventGroupLinks),
	groupAnnouncements: many(groupAnnouncements),
	groupSubscriptionTiers: many(groupSubscriptionTiers),
	groupMemberRoles: many(groupMemberRoles),
	groupRules: many(groupRules),
	groupCategory: one(groupCategories, {
		fields: [groups.categoryId],
		references: [groupCategories.id]
	}),
	user: one(users, {
		fields: [groups.createdBy],
		references: [users.id]
	}),
	groupFeaturedContents: many(groupFeaturedContent),
	groupMedias: many(groupMedia),
	groupDiscussionNotifications: many(groupDiscussionNotifications),
	groupSubscriptions: many(groupSubscriptions),
	groupQuestions: many(groupQuestions),
	userSpends: many(userSpends),
	groupCourses: many(groupCourses),
	contentModerations: many(contentModeration),
	groupShopProducts: many(groupShopProducts),
	groupAboutGalleries: many(groupAboutGallery),
	groupResources: many(groupResources),
	groupAnalyticsDailies: many(groupAnalyticsDaily),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const refundsRelations = relations(refunds, ({one}) => ({
	order: one(orders, {
		fields: [refunds.orderId],
		references: [orders.id]
	}),
}));

export const userInformationRelations = relations(userInformation, ({one}) => ({
	user: one(users, {
		fields: [userInformation.userId],
		references: [users.id]
	}),
}));

export const streamCallsRelations = relations(streamCalls, ({one}) => ({
	user: one(users, {
		fields: [streamCalls.createdByUserId],
		references: [users.id]
	}),
}));

export const mentionsRelations = relations(mentions, ({one}) => ({
	user_mentionedByUserId: one(users, {
		fields: [mentions.mentionedByUserId],
		references: [users.id],
		relationName: "mentions_mentionedByUserId_users_id"
	}),
	user_mentionedUserId: one(users, {
		fields: [mentions.mentionedUserId],
		references: [users.id],
		relationName: "mentions_mentionedUserId_users_id"
	}),
}));

export const discussionReplyLikesRelations = relations(discussionReplyLikes, ({one}) => ({
	discussionReply: one(discussionReplies, {
		fields: [discussionReplyLikes.replyId],
		references: [discussionReplies.id]
	}),
	user: one(users, {
		fields: [discussionReplyLikes.userId],
		references: [users.id]
	}),
}));

export const discussionRepliesRelations = relations(discussionReplies, ({one, many}) => ({
	discussionReplyLikes: many(discussionReplyLikes),
	discussion: one(discussions, {
		fields: [discussionReplies.discussionId],
		references: [discussions.id]
	}),
	discussionReply: one(discussionReplies, {
		fields: [discussionReplies.parentReplyId],
		references: [discussionReplies.id],
		relationName: "discussionReplies_parentReplyId_discussionReplies_id"
	}),
	discussionReplies: many(discussionReplies, {
		relationName: "discussionReplies_parentReplyId_discussionReplies_id"
	}),
	user: one(users, {
		fields: [discussionReplies.userId],
		references: [users.id]
	}),
}));

export const tokensRelations = relations(tokens, ({one}) => ({
	user: one(users, {
		fields: [tokens.userId],
		references: [users.id]
	}),
}));

export const userReportsRelations = relations(userReports, ({one}) => ({
	socialConversation: one(socialConversations, {
		fields: [userReports.conversationId],
		references: [socialConversations.id]
	}),
	discussion: one(discussions, {
		fields: [userReports.discussionId],
		references: [discussions.id]
	}),
	event: one(events, {
		fields: [userReports.eventId],
		references: [events.id]
	}),
	group: one(groups, {
		fields: [userReports.groupId],
		references: [groups.id]
	}),
	post: one(posts, {
		fields: [userReports.postId],
		references: [posts.id]
	}),
	user_reporterId: one(users, {
		fields: [userReports.reporterId],
		references: [users.id],
		relationName: "userReports_reporterId_users_id"
	}),
	user_reviewedBy: one(users, {
		fields: [userReports.reviewedBy],
		references: [users.id],
		relationName: "userReports_reviewedBy_users_id"
	}),
	user_targetUserId: one(users, {
		fields: [userReports.targetUserId],
		references: [users.id],
		relationName: "userReports_targetUserId_users_id"
	}),
}));

export const socialConversationsRelations = relations(socialConversations, ({one, many}) => ({
	userReports: many(userReports),
	socialMessages: many(socialMessages),
	user_createdBy: one(users, {
		fields: [socialConversations.createdBy],
		references: [users.id],
		relationName: "socialConversations_createdBy_users_id"
	}),
	user_organizerUserId: one(users, {
		fields: [socialConversations.organizerUserId],
		references: [users.id],
		relationName: "socialConversations_organizerUserId_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [socialConversations.updatedBy],
		references: [users.id],
		relationName: "socialConversations_updatedBy_users_id"
	}),
	user_userAId: one(users, {
		fields: [socialConversations.userAId],
		references: [users.id],
		relationName: "socialConversations_userAId_users_id"
	}),
	user_userBId: one(users, {
		fields: [socialConversations.userBId],
		references: [users.id],
		relationName: "socialConversations_userBId_users_id"
	}),
}));

export const discussionsRelations = relations(discussions, ({one, many}) => ({
	userReports: many(userReports),
	discussionCategories: many(discussionCategories),
	discussionSubscriptions: many(discussionSubscriptions),
	group: one(groups, {
		fields: [discussions.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [discussions.userId],
		references: [users.id]
	}),
	discussionReplies: many(discussionReplies),
	contentModerations: many(contentModeration),
	discussionLikes: many(discussionLikes),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	userReports: many(userReports),
	postReposts: many(postReposts),
	postUserComments: many(postUserComments),
	socialMessages: many(socialMessages),
	postComments: many(postComments),
	postLikes: many(postLikes),
	postShares: many(postShares),
	postTags: many(postTags),
	savedPosts: many(savedPosts),
	user: one(users, {
		fields: [posts.userId],
		references: [users.id]
	}),
	socialWallPost: one(socialWallPosts, {
		fields: [posts.wallPostId],
		references: [socialWallPosts.id],
		relationName: "posts_wallPostId_socialWallPosts_id"
	}),
	userHiddenPosts: many(userHiddenPosts),
	socialWallPosts: many(socialWallPosts, {
		relationName: "socialWallPosts_postId_posts_id"
	}),
	postViews: many(postViews),
	socialProfiles_coverPostId: many(socialProfiles, {
		relationName: "socialProfiles_coverPostId_posts_id"
	}),
	socialProfiles_statusPostId: many(socialProfiles, {
		relationName: "socialProfiles_statusPostId_posts_id"
	}),
	storyCollectionItems: many(storyCollectionItems),
	postCollaborators: many(postCollaborators),
	importImages: many(importImages),
	contentModerations: many(contentModeration),
	postShopProducts: many(postShopProducts),
	userPostOrders: many(userPostOrder),
	pinnedPosts: many(pinnedPosts),
	postAnalyticsDailies: many(postAnalyticsDaily),
}));

export const mediaRelations = relations(media, ({one, many}) => ({
	user: one(users, {
		fields: [media.uploadedBy],
		references: [users.id]
	}),
	priorityMessageAttachments: many(priorityMessageAttachments),
	contentModerations: many(contentModeration),
	mediaOwners: many(mediaOwners),
}));

export const postRepostsRelations = relations(postReposts, ({one}) => ({
	post: one(posts, {
		fields: [postReposts.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postReposts.userId],
		references: [users.id]
	}),
}));

export const postUserCommentsRelations = relations(postUserComments, ({one}) => ({
	postComment: one(postComments, {
		fields: [postUserComments.commentId],
		references: [postComments.id]
	}),
	post: one(posts, {
		fields: [postUserComments.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postUserComments.userId],
		references: [users.id]
	}),
}));

export const postCommentsRelations = relations(postComments, ({one, many}) => ({
	postUserComments: many(postUserComments),
	postComment: one(postComments, {
		fields: [postComments.parentId],
		references: [postComments.id],
		relationName: "postComments_parentId_postComments_id"
	}),
	postComments: many(postComments, {
		relationName: "postComments_parentId_postComments_id"
	}),
	post: one(posts, {
		fields: [postComments.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postComments.userId],
		references: [users.id]
	}),
	commentLikes: many(commentLikes),
}));

export const groupTagsRelations = relations(groupTags, ({one}) => ({
	group: one(groups, {
		fields: [groupTags.groupId],
		references: [groups.id]
	}),
	tag: one(tags, {
		fields: [groupTags.tagId],
		references: [tags.id]
	}),
}));

export const tagsRelations = relations(tags, ({many}) => ({
	groupTags: many(groupTags),
}));

export const discussionCategoriesRelations = relations(discussionCategories, ({one}) => ({
	category: one(categories, {
		fields: [discussionCategories.categoryId],
		references: [categories.id]
	}),
	discussion: one(discussions, {
		fields: [discussionCategories.discussionId],
		references: [discussions.id]
	}),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	discussionCategories: many(discussionCategories),
	userPreferences: many(userPreferences),
}));

export const discussionSubscriptionsRelations = relations(discussionSubscriptions, ({one}) => ({
	discussion: one(discussions, {
		fields: [discussionSubscriptions.discussionId],
		references: [discussions.id]
	}),
	user: one(users, {
		fields: [discussionSubscriptions.userId],
		references: [users.id]
	}),
}));

export const ticketScansRelations = relations(ticketScans, ({one}) => ({
	organizerMember: one(organizerMembers, {
		fields: [ticketScans.scannedBy],
		references: [organizerMembers.id]
	}),
	eventTeamMember: one(eventTeamMembers, {
		fields: [ticketScans.scannedByTeamMember],
		references: [eventTeamMembers.id]
	}),
	scanSession: one(scanSessions, {
		fields: [ticketScans.sessionId],
		references: [scanSessions.id]
	}),
}));

export const organizerMembersRelations = relations(organizerMembers, ({one, many}) => ({
	ticketScans: many(ticketScans),
	organizer: one(organizers, {
		fields: [organizerMembers.organizerId],
		references: [organizers.id]
	}),
	eventAttendees: many(eventAttendees),
	purchasedTickets: many(purchasedTickets),
	scanSessions: many(scanSessions),
}));

export const eventTeamMembersRelations = relations(eventTeamMembers, ({one, many}) => ({
	ticketScans: many(ticketScans),
	scanSessions: many(scanSessions),
	eventTeamRole: one(eventTeamRoles, {
		fields: [eventTeamMembers.roleId],
		references: [eventTeamRoles.id]
	}),
	eventTeam: one(eventTeams, {
		fields: [eventTeamMembers.teamId],
		references: [eventTeams.id]
	}),
	user: one(users, {
		fields: [eventTeamMembers.userId],
		references: [users.id]
	}),
	eventBlasts: many(eventBlasts),
}));

export const scanSessionsRelations = relations(scanSessions, ({one, many}) => ({
	ticketScans: many(ticketScans),
	event: one(events, {
		fields: [scanSessions.eventId],
		references: [events.id]
	}),
	organizerMember: one(organizerMembers, {
		fields: [scanSessions.memberId],
		references: [organizerMembers.id]
	}),
	organizer: one(organizers, {
		fields: [scanSessions.organizerId],
		references: [organizers.id]
	}),
	eventTeamMember: one(eventTeamMembers, {
		fields: [scanSessions.teamMemberId],
		references: [eventTeamMembers.id]
	}),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	role: one(roles, {
		fields: [userRoles.roleId],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [userRoles.userId],
		references: [users.id]
	}),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	userRoles: many(userRoles),
}));

export const userPreferencesRelations = relations(userPreferences, ({one}) => ({
	category: one(categories, {
		fields: [userPreferences.categoryId],
		references: [categories.id]
	}),
	user: one(users, {
		fields: [userPreferences.userId],
		references: [users.id]
	}),
}));

export const eventAttendeesRelations = relations(eventAttendees, ({one}) => ({
	organizerMember: one(organizerMembers, {
		fields: [eventAttendees.checkedInByMember],
		references: [organizerMembers.id]
	}),
	user_checkedInBy: one(users, {
		fields: [eventAttendees.checkedInBy],
		references: [users.id],
		relationName: "eventAttendees_checkedInBy_users_id"
	}),
	event: one(events, {
		fields: [eventAttendees.eventId],
		references: [events.id]
	}),
	order: one(orders, {
		fields: [eventAttendees.orderId],
		references: [orders.id]
	}),
	eventTicket: one(eventTickets, {
		fields: [eventAttendees.ticketTierId],
		references: [eventTickets.id]
	}),
	user_userId: one(users, {
		fields: [eventAttendees.userId],
		references: [users.id],
		relationName: "eventAttendees_userId_users_id"
	}),
}));

export const eventTicketsRelations = relations(eventTickets, ({one, many}) => ({
	eventAttendees: many(eventAttendees),
	purchasedTickets: many(purchasedTickets),
	event: one(events, {
		fields: [eventTickets.eventId],
		references: [events.id]
	}),
	eventWaitlists: many(eventWaitlist),
	guestOrderItems: many(guestOrderItems),
	guestPurchasedTickets: many(guestPurchasedTickets),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({one, many}) => ({
	user: one(users, {
		fields: [paymentMethods.userId],
		references: [users.id]
	}),
	orders: many(orders),
}));

export const socialMessagesRelations = relations(socialMessages, ({one, many}) => ({
	socialConversation: one(socialConversations, {
		fields: [socialMessages.conversationId],
		references: [socialConversations.id]
	}),
	user_createdBy: one(users, {
		fields: [socialMessages.createdBy],
		references: [users.id],
		relationName: "socialMessages_createdBy_users_id"
	}),
	post: one(posts, {
		fields: [socialMessages.postId],
		references: [posts.id]
	}),
	socialMessage: one(socialMessages, {
		fields: [socialMessages.replyToId],
		references: [socialMessages.id],
		relationName: "socialMessages_replyToId_socialMessages_id"
	}),
	socialMessages: many(socialMessages, {
		relationName: "socialMessages_replyToId_socialMessages_id"
	}),
	user_senderId: one(users, {
		fields: [socialMessages.senderId],
		references: [users.id],
		relationName: "socialMessages_senderId_users_id"
	}),
	story: one(stories, {
		fields: [socialMessages.storyId],
		references: [stories.id]
	}),
	user_updatedBy: one(users, {
		fields: [socialMessages.updatedBy],
		references: [users.id],
		relationName: "socialMessages_updatedBy_users_id"
	}),
	priorityMessageItems_messageId: many(priorityMessageItems, {
		relationName: "priorityMessageItems_messageId_socialMessages_id"
	}),
	priorityMessageItems_replyMessageId: many(priorityMessageItems, {
		relationName: "priorityMessageItems_replyMessageId_socialMessages_id"
	}),
}));

export const storiesRelations = relations(stories, ({one, many}) => ({
	socialMessages: many(socialMessages),
	storyViews: many(storyViews),
	storyLikes: many(storyLikes),
	user: one(users, {
		fields: [stories.userId],
		references: [users.id]
	}),
	storyPolls: many(storyPolls),
	storyCollectionItems: many(storyCollectionItems),
	storyComments: many(storyComments),
	contentModerations: many(contentModeration),
}));

export const purchasedTicketsRelations = relations(purchasedTickets, ({one, many}) => ({
	event: one(events, {
		fields: [purchasedTickets.eventId],
		references: [events.id]
	}),
	eventSchedule: one(eventSchedules, {
		fields: [purchasedTickets.eventScheduleId],
		references: [eventSchedules.id]
	}),
	organizer: one(organizers, {
		fields: [purchasedTickets.organizerId],
		references: [organizers.id]
	}),
	eventTicket: one(eventTickets, {
		fields: [purchasedTickets.ticketTierId],
		references: [eventTickets.id]
	}),
	trackingLink: one(trackingLinks, {
		fields: [purchasedTickets.trackingLinkId],
		references: [trackingLinks.id]
	}),
	user_transferredTo: one(users, {
		fields: [purchasedTickets.transferredTo],
		references: [users.id],
		relationName: "purchasedTickets_transferredTo_users_id"
	}),
	organizerMember: one(organizerMembers, {
		fields: [purchasedTickets.usedBy],
		references: [organizerMembers.id]
	}),
	user_userId: one(users, {
		fields: [purchasedTickets.userId],
		references: [users.id],
		relationName: "purchasedTickets_userId_users_id"
	}),
	eventReviews: many(eventReviews),
}));

export const eventSchedulesRelations = relations(eventSchedules, ({one, many}) => ({
	purchasedTickets: many(purchasedTickets),
	event: one(events, {
		fields: [eventSchedules.eventId],
		references: [events.id]
	}),
}));

export const trackingLinksRelations = relations(trackingLinks, ({one, many}) => ({
	purchasedTickets: many(purchasedTickets),
	event: one(events, {
		fields: [trackingLinks.eventId],
		references: [events.id]
	}),
	organizer: one(organizers, {
		fields: [trackingLinks.organizerId],
		references: [organizers.id]
	}),
	trackingLinkClicks: many(trackingLinkClicks),
}));

export const groupMembersRelations = relations(groupMembers, ({one}) => ({
	group: one(groups, {
		fields: [groupMembers.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupMembers.userId],
		references: [users.id]
	}),
}));

export const eventMediaRelations = relations(eventMedia, ({one}) => ({
	event: one(events, {
		fields: [eventMedia.eventId],
		references: [events.id]
	}),
	user: one(users, {
		fields: [eventMedia.uploaderId],
		references: [users.id]
	}),
}));

export const eventInvitationsRelations = relations(eventInvitations, ({one}) => ({
	event: one(events, {
		fields: [eventInvitations.eventId],
		references: [events.id]
	}),
	user_inviteeId: one(users, {
		fields: [eventInvitations.inviteeId],
		references: [users.id],
		relationName: "eventInvitations_inviteeId_users_id"
	}),
	user_inviterId: one(users, {
		fields: [eventInvitations.inviterId],
		references: [users.id],
		relationName: "eventInvitations_inviterId_users_id"
	}),
}));

export const eventReviewsRelations = relations(eventReviews, ({one, many}) => ({
	event: one(events, {
		fields: [eventReviews.eventId],
		references: [events.id]
	}),
	user_moderatedBy: one(users, {
		fields: [eventReviews.moderatedBy],
		references: [users.id],
		relationName: "eventReviews_moderatedBy_users_id"
	}),
	purchasedTicket: one(purchasedTickets, {
		fields: [eventReviews.ticketId],
		references: [purchasedTickets.id]
	}),
	user_userId: one(users, {
		fields: [eventReviews.userId],
		references: [users.id],
		relationName: "eventReviews_userId_users_id"
	}),
	reviewHelpfulnesses: many(reviewHelpfulness),
}));

export const organizerReviewsRelations = relations(organizerReviews, ({one}) => ({
	event: one(events, {
		fields: [organizerReviews.eventId],
		references: [events.id]
	}),
	organizer: one(organizers, {
		fields: [organizerReviews.organizerId],
		references: [organizers.id]
	}),
	user: one(users, {
		fields: [organizerReviews.userId],
		references: [users.id]
	}),
}));

export const reviewHelpfulnessRelations = relations(reviewHelpfulness, ({one}) => ({
	eventReview: one(eventReviews, {
		fields: [reviewHelpfulness.reviewId],
		references: [eventReviews.id]
	}),
	user: one(users, {
		fields: [reviewHelpfulness.userId],
		references: [users.id]
	}),
}));

export const venuesRelations = relations(venues, ({one, many}) => ({
	user: one(users, {
		fields: [venues.createdBy],
		references: [users.id]
	}),
	eventVenueProfiles: many(eventVenueProfiles),
	events: many(events),
}));

export const eventAnalyticsRelations = relations(eventAnalytics, ({one}) => ({
	event: one(events, {
		fields: [eventAnalytics.eventId],
		references: [events.id]
	}),
}));

export const groupEventPromotionsRelations = relations(groupEventPromotions, ({one}) => ({
	event: one(events, {
		fields: [groupEventPromotions.eventId],
		references: [events.id]
	}),
	group: one(groups, {
		fields: [groupEventPromotions.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupEventPromotions.promotedBy],
		references: [users.id]
	}),
}));

export const commentLikesRelations = relations(commentLikes, ({one}) => ({
	postComment: one(postComments, {
		fields: [commentLikes.commentId],
		references: [postComments.id]
	}),
	user: one(users, {
		fields: [commentLikes.userId],
		references: [users.id]
	}),
}));

export const postLikesRelations = relations(postLikes, ({one}) => ({
	post: one(posts, {
		fields: [postLikes.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postLikes.userId],
		references: [users.id]
	}),
}));

export const postSharesRelations = relations(postShares, ({one}) => ({
	post: one(posts, {
		fields: [postShares.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postShares.userId],
		references: [users.id]
	}),
}));

export const postTagsRelations = relations(postTags, ({one}) => ({
	interestCategory: one(interestCategories, {
		fields: [postTags.categoryId],
		references: [interestCategories.id]
	}),
	post: one(posts, {
		fields: [postTags.postId],
		references: [posts.id]
	}),
}));

export const interestCategoriesRelations = relations(interestCategories, ({many}) => ({
	postTags: many(postTags),
	userInterests: many(userInterests),
}));

export const savedPostsRelations = relations(savedPosts, ({one}) => ({
	post: one(posts, {
		fields: [savedPosts.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [savedPosts.userId],
		references: [users.id]
	}),
}));

export const storyViewsRelations = relations(storyViews, ({one}) => ({
	story: one(stories, {
		fields: [storyViews.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [storyViews.userId],
		references: [users.id]
	}),
}));

export const userBlocksRelations = relations(userBlocks, ({one}) => ({
	user_blockedId: one(users, {
		fields: [userBlocks.blockedId],
		references: [users.id],
		relationName: "userBlocks_blockedId_users_id"
	}),
	user_blockerId: one(users, {
		fields: [userBlocks.blockerId],
		references: [users.id],
		relationName: "userBlocks_blockerId_users_id"
	}),
}));

export const userFollowsRelations = relations(userFollows, ({one}) => ({
	user_followerId: one(users, {
		fields: [userFollows.followerId],
		references: [users.id],
		relationName: "userFollows_followerId_users_id"
	}),
	user_followingId: one(users, {
		fields: [userFollows.followingId],
		references: [users.id],
		relationName: "userFollows_followingId_users_id"
	}),
}));

export const userInterestsRelations = relations(userInterests, ({one}) => ({
	interestCategory: one(interestCategories, {
		fields: [userInterests.categoryId],
		references: [interestCategories.id]
	}),
	user: one(users, {
		fields: [userInterests.userId],
		references: [users.id]
	}),
}));

export const chatModerationActionsRelations = relations(chatModerationActions, ({one}) => ({
	user_moderatorId: one(users, {
		fields: [chatModerationActions.moderatorId],
		references: [users.id],
		relationName: "chatModerationActions_moderatorId_users_id"
	}),
	user_targetUserId: one(users, {
		fields: [chatModerationActions.targetUserId],
		references: [users.id],
		relationName: "chatModerationActions_targetUserId_users_id"
	}),
}));

export const eventChatRoomsRelations = relations(eventChatRooms, ({one, many}) => ({
	event: one(events, {
		fields: [eventChatRooms.eventId],
		references: [events.id]
	}),
	eventChatMessages: many(eventChatMessages),
}));

export const eventChatMessagesRelations = relations(eventChatMessages, ({one, many}) => ({
	user_deletedBy: one(users, {
		fields: [eventChatMessages.deletedBy],
		references: [users.id],
		relationName: "eventChatMessages_deletedBy_users_id"
	}),
	eventChatRoom: one(eventChatRooms, {
		fields: [eventChatMessages.eventChatRoomId],
		references: [eventChatRooms.id]
	}),
	user_pinnedBy: one(users, {
		fields: [eventChatMessages.pinnedBy],
		references: [users.id],
		relationName: "eventChatMessages_pinnedBy_users_id"
	}),
	eventChatMessage: one(eventChatMessages, {
		fields: [eventChatMessages.replyToId],
		references: [eventChatMessages.id],
		relationName: "eventChatMessages_replyToId_eventChatMessages_id"
	}),
	eventChatMessages: many(eventChatMessages, {
		relationName: "eventChatMessages_replyToId_eventChatMessages_id"
	}),
	user_senderId: one(users, {
		fields: [eventChatMessages.senderId],
		references: [users.id],
		relationName: "eventChatMessages_senderId_users_id"
	}),
	eventMessageReactions: many(eventMessageReactions),
}));

export const eventChatParticipantsRelations = relations(eventChatParticipants, ({one}) => ({
	user_mutedBy: one(users, {
		fields: [eventChatParticipants.mutedBy],
		references: [users.id],
		relationName: "eventChatParticipants_mutedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [eventChatParticipants.userId],
		references: [users.id],
		relationName: "eventChatParticipants_userId_users_id"
	}),
}));

export const eventMessageReactionsRelations = relations(eventMessageReactions, ({one}) => ({
	eventChatMessage: one(eventChatMessages, {
		fields: [eventMessageReactions.messageId],
		references: [eventChatMessages.id]
	}),
	user: one(users, {
		fields: [eventMessageReactions.userId],
		references: [users.id]
	}),
}));

export const eventMessageReadReceiptsRelations = relations(eventMessageReadReceipts, ({one}) => ({
	user: one(users, {
		fields: [eventMessageReadReceipts.userId],
		references: [users.id]
	}),
}));

export const groupChatRoomsRelations = relations(groupChatRooms, ({one, many}) => ({
	group: one(groups, {
		fields: [groupChatRooms.groupId],
		references: [groups.id]
	}),
	groupChatMessages: many(groupChatMessages),
}));

export const groupChatMessagesRelations = relations(groupChatMessages, ({one, many}) => ({
	user_deletedBy: one(users, {
		fields: [groupChatMessages.deletedBy],
		references: [users.id],
		relationName: "groupChatMessages_deletedBy_users_id"
	}),
	groupChatRoom: one(groupChatRooms, {
		fields: [groupChatMessages.groupChatRoomId],
		references: [groupChatRooms.id]
	}),
	groupChatMessage: one(groupChatMessages, {
		fields: [groupChatMessages.replyToId],
		references: [groupChatMessages.id],
		relationName: "groupChatMessages_replyToId_groupChatMessages_id"
	}),
	groupChatMessages: many(groupChatMessages, {
		relationName: "groupChatMessages_replyToId_groupChatMessages_id"
	}),
	user_senderId: one(users, {
		fields: [groupChatMessages.senderId],
		references: [users.id],
		relationName: "groupChatMessages_senderId_users_id"
	}),
	groupMessageReactions: many(groupMessageReactions),
}));

export const groupMessageReadReceiptsRelations = relations(groupMessageReadReceipts, ({one}) => ({
	user: one(users, {
		fields: [groupMessageReadReceipts.userId],
		references: [users.id]
	}),
}));

export const adminReportsRelations = relations(adminReports, ({one}) => ({
	user: one(users, {
		fields: [adminReports.generatedBy],
		references: [users.id]
	}),
}));

export const adminTasksRelations = relations(adminTasks, ({one, many}) => ({
	user_assignedTo: one(users, {
		fields: [adminTasks.assignedTo],
		references: [users.id],
		relationName: "adminTasks_assignedTo_users_id"
	}),
	user_createdBy: one(users, {
		fields: [adminTasks.createdBy],
		references: [users.id],
		relationName: "adminTasks_createdBy_users_id"
	}),
	taskSubtasks: many(taskSubtasks),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.userId],
		references: [users.id]
	}),
}));

export const contentReportsRelations = relations(contentReports, ({one}) => ({
	user_reporterId: one(users, {
		fields: [contentReports.reporterId],
		references: [users.id],
		relationName: "contentReports_reporterId_users_id"
	}),
	user_reviewedBy: one(users, {
		fields: [contentReports.reviewedBy],
		references: [users.id],
		relationName: "contentReports_reviewedBy_users_id"
	}),
}));

export const taskSubtasksRelations = relations(taskSubtasks, ({one}) => ({
	adminTask: one(adminTasks, {
		fields: [taskSubtasks.taskId],
		references: [adminTasks.id]
	}),
}));

export const eventAccessControlRelations = relations(eventAccessControl, ({one}) => ({
	event: one(events, {
		fields: [eventAccessControl.eventId],
		references: [events.id]
	}),
	user_grantedBy: one(users, {
		fields: [eventAccessControl.grantedBy],
		references: [users.id],
		relationName: "eventAccessControl_grantedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [eventAccessControl.userId],
		references: [users.id],
		relationName: "eventAccessControl_userId_users_id"
	}),
}));

export const eventGroupLinksRelations = relations(eventGroupLinks, ({one}) => ({
	user: one(users, {
		fields: [eventGroupLinks.createdBy],
		references: [users.id]
	}),
	event: one(events, {
		fields: [eventGroupLinks.eventId],
		references: [events.id]
	}),
	group: one(groups, {
		fields: [eventGroupLinks.groupId],
		references: [groups.id]
	}),
}));

export const eventDiscountCodesRelations = relations(eventDiscountCodes, ({one}) => ({
	event: one(events, {
		fields: [eventDiscountCodes.eventId],
		references: [events.id]
	}),
}));

export const eventFaqsRelations = relations(eventFaqs, ({one}) => ({
	event: one(events, {
		fields: [eventFaqs.eventId],
		references: [events.id]
	}),
}));

export const eventSpeakersRelations = relations(eventSpeakers, ({one}) => ({
	event: one(events, {
		fields: [eventSpeakers.eventId],
		references: [events.id]
	}),
}));

export const eventSponsorsRelations = relations(eventSponsors, ({one}) => ({
	event: one(events, {
		fields: [eventSponsors.eventId],
		references: [events.id]
	}),
}));

export const eventWaitlistRelations = relations(eventWaitlist, ({one}) => ({
	event: one(events, {
		fields: [eventWaitlist.eventId],
		references: [events.id]
	}),
	eventTicket: one(eventTickets, {
		fields: [eventWaitlist.ticketTierId],
		references: [eventTickets.id]
	}),
	user: one(users, {
		fields: [eventWaitlist.userId],
		references: [users.id]
	}),
}));

export const eventLikesRelations = relations(eventLikes, ({one}) => ({
	event: one(events, {
		fields: [eventLikes.eventId],
		references: [events.id]
	}),
	user: one(users, {
		fields: [eventLikes.userId],
		references: [users.id]
	}),
}));

export const groupAnnouncementsRelations = relations(groupAnnouncements, ({one}) => ({
	user: one(users, {
		fields: [groupAnnouncements.authorId],
		references: [users.id]
	}),
	group: one(groups, {
		fields: [groupAnnouncements.groupId],
		references: [groups.id]
	}),
}));

export const socialWallPostsRelations = relations(socialWallPosts, ({one, many}) => ({
	posts: many(posts, {
		relationName: "posts_wallPostId_socialWallPosts_id"
	}),
	user_authorId: one(users, {
		fields: [socialWallPosts.authorId],
		references: [users.id],
		relationName: "socialWallPosts_authorId_users_id"
	}),
	user_createdBy: one(users, {
		fields: [socialWallPosts.createdBy],
		references: [users.id],
		relationName: "socialWallPosts_createdBy_users_id"
	}),
	user_deletedBy: one(users, {
		fields: [socialWallPosts.deletedBy],
		references: [users.id],
		relationName: "socialWallPosts_deletedBy_users_id"
	}),
	post: one(posts, {
		fields: [socialWallPosts.postId],
		references: [posts.id],
		relationName: "socialWallPosts_postId_posts_id"
	}),
	socialProfile: one(socialProfiles, {
		fields: [socialWallPosts.profileId],
		references: [socialProfiles.id]
	}),
	user_updatedBy: one(users, {
		fields: [socialWallPosts.updatedBy],
		references: [users.id],
		relationName: "socialWallPosts_updatedBy_users_id"
	}),
}));

export const groupSubscriptionTiersRelations = relations(groupSubscriptionTiers, ({one, many}) => ({
	group: one(groups, {
		fields: [groupSubscriptionTiers.groupId],
		references: [groups.id]
	}),
	groupSubscriptions: many(groupSubscriptions),
}));

export const groupMemberRolesRelations = relations(groupMemberRoles, ({one}) => ({
	group: one(groups, {
		fields: [groupMemberRoles.groupId],
		references: [groups.id]
	}),
}));

export const groupRulesRelations = relations(groupRules, ({one}) => ({
	group: one(groups, {
		fields: [groupRules.groupId],
		references: [groups.id]
	}),
}));

export const userHiddenPostsRelations = relations(userHiddenPosts, ({one}) => ({
	post: one(posts, {
		fields: [userHiddenPosts.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [userHiddenPosts.userId],
		references: [users.id]
	}),
}));

export const usernameReservationsRelations = relations(usernameReservations, ({one}) => ({
	user: one(users, {
		fields: [usernameReservations.reviewedBy],
		references: [users.id]
	}),
}));

export const groupCategoriesRelations = relations(groupCategories, ({many}) => ({
	groups: many(groups),
}));

export const socialProfilesRelations = relations(socialProfiles, ({one, many}) => ({
	socialWallPosts: many(socialWallPosts),
	profileViews: many(profileViews),
	post_coverPostId: one(posts, {
		fields: [socialProfiles.coverPostId],
		references: [posts.id],
		relationName: "socialProfiles_coverPostId_posts_id"
	}),
	organizer: one(organizers, {
		fields: [socialProfiles.organizerId],
		references: [organizers.id]
	}),
	post_statusPostId: one(posts, {
		fields: [socialProfiles.statusPostId],
		references: [posts.id],
		relationName: "socialProfiles_statusPostId_posts_id"
	}),
	user: one(users, {
		fields: [socialProfiles.userId],
		references: [users.id]
	}),
	profileViewSessions: many(profileViewSessions),
}));

export const groupFeaturedContentRelations = relations(groupFeaturedContent, ({one}) => ({
	user: one(users, {
		fields: [groupFeaturedContent.createdBy],
		references: [users.id]
	}),
	group: one(groups, {
		fields: [groupFeaturedContent.groupId],
		references: [groups.id]
	}),
}));

export const groupMediaRelations = relations(groupMedia, ({one}) => ({
	group: one(groups, {
		fields: [groupMedia.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupMedia.uploaderId],
		references: [users.id]
	}),
}));

export const groupDiscussionNotificationsRelations = relations(groupDiscussionNotifications, ({one}) => ({
	group: one(groups, {
		fields: [groupDiscussionNotifications.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupDiscussionNotifications.userId],
		references: [users.id]
	}),
}));

export const profileViewsRelations = relations(profileViews, ({one}) => ({
	socialProfile: one(socialProfiles, {
		fields: [profileViews.profileId],
		references: [socialProfiles.id]
	}),
	user: one(users, {
		fields: [profileViews.userId],
		references: [users.id]
	}),
}));

export const eventVirtualDetailsRelations = relations(eventVirtualDetails, ({one}) => ({
	event: one(events, {
		fields: [eventVirtualDetails.eventId],
		references: [events.id]
	}),
}));

export const postViewsRelations = relations(postViews, ({one}) => ({
	post: one(posts, {
		fields: [postViews.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postViews.userId],
		references: [users.id]
	}),
}));

export const storyLikesRelations = relations(storyLikes, ({one}) => ({
	story: one(stories, {
		fields: [storyLikes.storyId],
		references: [stories.id]
	}),
}));

export const talentFavoritesRelations = relations(talentFavorites, ({one}) => ({
	talentProfile: one(talentProfiles, {
		fields: [talentFavorites.talentProfileId],
		references: [talentProfiles.id]
	}),
	user: one(users, {
		fields: [talentFavorites.userId],
		references: [users.id]
	}),
}));

export const talentProfilesRelations = relations(talentProfiles, ({one, many}) => ({
	talentFavorites: many(talentFavorites),
	talentAvailabilities: many(talentAvailability),
	talentDateOverrides: many(talentDateOverrides),
	talentGiftCodes: many(talentGiftCodes),
	talentSessions: many(talentSessions),
	talentPayouts: many(talentPayouts),
	talentIssues: many(talentIssues),
	talentReviews: many(talentReviews),
	organizerSocialLinks: many(organizerSocialLinks),
	user: one(users, {
		fields: [talentProfiles.userId],
		references: [users.id]
	}),
	serviceAnalyticsDailies: many(serviceAnalyticsDaily),
}));

export const storyPollsRelations = relations(storyPolls, ({one, many}) => ({
	story: one(stories, {
		fields: [storyPolls.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [storyPolls.userId],
		references: [users.id]
	}),
	storyPollResponses: many(storyPollResponses),
}));

export const storyPollResponsesRelations = relations(storyPollResponses, ({one}) => ({
	storyPoll: one(storyPolls, {
		fields: [storyPollResponses.pollId],
		references: [storyPolls.id]
	}),
	user: one(users, {
		fields: [storyPollResponses.userId],
		references: [users.id]
	}),
}));

export const talentAvailabilityRelations = relations(talentAvailability, ({one}) => ({
	talentProfile: one(talentProfiles, {
		fields: [talentAvailability.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const talentDateOverridesRelations = relations(talentDateOverrides, ({one}) => ({
	talentProfile: one(talentProfiles, {
		fields: [talentDateOverrides.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const talentGiftCodesRelations = relations(talentGiftCodes, ({one}) => ({
	user: one(users, {
		fields: [talentGiftCodes.gifterId],
		references: [users.id]
	}),
	talentSession: one(talentSessions, {
		fields: [talentGiftCodes.redeemedSessionId],
		references: [talentSessions.id]
	}),
	talentProfile: one(talentProfiles, {
		fields: [talentGiftCodes.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const talentSessionsRelations = relations(talentSessions, ({one, many}) => ({
	talentGiftCodes: many(talentGiftCodes),
	user_bookerId: one(users, {
		fields: [talentSessions.bookerId],
		references: [users.id],
		relationName: "talentSessions_bookerId_users_id"
	}),
	user_cancelledBy: one(users, {
		fields: [talentSessions.cancelledBy],
		references: [users.id],
		relationName: "talentSessions_cancelledBy_users_id"
	}),
	talentProfile: one(talentProfiles, {
		fields: [talentSessions.talentProfileId],
		references: [talentProfiles.id]
	}),
	talentReviews: many(talentReviews),
}));

export const priorityMessagePaymentsRelations = relations(priorityMessagePayments, ({one}) => ({
	user_senderId: one(users, {
		fields: [priorityMessagePayments.senderId],
		references: [users.id],
		relationName: "priorityMessagePayments_senderId_users_id"
	}),
	user_talentUserId: one(users, {
		fields: [priorityMessagePayments.talentUserId],
		references: [users.id],
		relationName: "priorityMessagePayments_talentUserId_users_id"
	}),
}));

export const livestreamsRelations = relations(livestreams, ({one, many}) => ({
	user: one(users, {
		fields: [livestreams.userId],
		references: [users.id]
	}),
	livestreamComments: many(livestreamComments),
	livestreamReactions: many(livestreamReactions),
	livestreamViewers: many(livestreamViewers),
}));

export const livestreamCommentsRelations = relations(livestreamComments, ({one}) => ({
	livestream: one(livestreams, {
		fields: [livestreamComments.livestreamId],
		references: [livestreams.id]
	}),
	user: one(users, {
		fields: [livestreamComments.userId],
		references: [users.id]
	}),
}));

export const livestreamReactionsRelations = relations(livestreamReactions, ({one}) => ({
	livestream: one(livestreams, {
		fields: [livestreamReactions.livestreamId],
		references: [livestreams.id]
	}),
	user: one(users, {
		fields: [livestreamReactions.userId],
		references: [users.id]
	}),
}));

export const livestreamViewersRelations = relations(livestreamViewers, ({one}) => ({
	livestream: one(livestreams, {
		fields: [livestreamViewers.livestreamId],
		references: [livestreams.id]
	}),
	user: one(users, {
		fields: [livestreamViewers.userId],
		references: [users.id]
	}),
}));

export const stripeCustomersRelations = relations(stripeCustomers, ({one}) => ({
	user: one(users, {
		fields: [stripeCustomers.userId],
		references: [users.id]
	}),
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({one}) => ({
	user_grantedBy: one(users, {
		fields: [userSubscriptions.grantedBy],
		references: [users.id],
		relationName: "userSubscriptions_grantedBy_users_id"
	}),
	subscriptionPlan: one(subscriptionPlans, {
		fields: [userSubscriptions.planId],
		references: [subscriptionPlans.id]
	}),
	user_userId: one(users, {
		fields: [userSubscriptions.userId],
		references: [users.id],
		relationName: "userSubscriptions_userId_users_id"
	}),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({many}) => ({
	userSubscriptions: many(userSubscriptions),
	subscriptionAuditLogs: many(subscriptionAuditLogs),
	subscriptionFeatures: many(subscriptionFeatures),
}));

export const subscriptionAuditLogsRelations = relations(subscriptionAuditLogs, ({one}) => ({
	user: one(users, {
		fields: [subscriptionAuditLogs.actorId],
		references: [users.id]
	}),
	subscriptionPlan: one(subscriptionPlans, {
		fields: [subscriptionAuditLogs.planId],
		references: [subscriptionPlans.id]
	}),
}));

export const subscriptionFeaturesRelations = relations(subscriptionFeatures, ({one}) => ({
	subscriptionPlan: one(subscriptionPlans, {
		fields: [subscriptionFeatures.planId],
		references: [subscriptionPlans.id]
	}),
}));

export const trackingLinkClicksRelations = relations(trackingLinkClicks, ({one}) => ({
	event: one(events, {
		fields: [trackingLinkClicks.eventId],
		references: [events.id]
	}),
	trackingLink: one(trackingLinks, {
		fields: [trackingLinkClicks.trackingLinkId],
		references: [trackingLinks.id]
	}),
}));

export const eventTeamsRelations = relations(eventTeams, ({one, many}) => ({
	user: one(users, {
		fields: [eventTeams.createdBy],
		references: [users.id]
	}),
	event: one(events, {
		fields: [eventTeams.eventId],
		references: [events.id]
	}),
	eventTeamMembers: many(eventTeamMembers),
}));

export const eventTeamRolesRelations = relations(eventTeamRoles, ({many}) => ({
	eventTeamMembers: many(eventTeamMembers),
}));

export const userFollowRequestsRelations = relations(userFollowRequests, ({one}) => ({
	user_requesterId: one(users, {
		fields: [userFollowRequests.requesterId],
		references: [users.id],
		relationName: "userFollowRequests_requesterId_users_id"
	}),
	user_targetId: one(users, {
		fields: [userFollowRequests.targetId],
		references: [users.id],
		relationName: "userFollowRequests_targetId_users_id"
	}),
}));

export const eventVenueProfilesRelations = relations(eventVenueProfiles, ({one}) => ({
	event: one(events, {
		fields: [eventVenueProfiles.eventId],
		references: [events.id]
	}),
	venue: one(venues, {
		fields: [eventVenueProfiles.venueId],
		references: [venues.id]
	}),
}));

export const guestOrdersRelations = relations(guestOrders, ({one, many}) => ({
	event: one(events, {
		fields: [guestOrders.eventId],
		references: [events.id]
	}),
	guestOrderItems: many(guestOrderItems),
	guestPurchasedTickets: many(guestPurchasedTickets),
}));

export const guestOrderItemsRelations = relations(guestOrderItems, ({one}) => ({
	guestOrder: one(guestOrders, {
		fields: [guestOrderItems.guestOrderId],
		references: [guestOrders.id]
	}),
	eventTicket: one(eventTickets, {
		fields: [guestOrderItems.ticketTierId],
		references: [eventTickets.id]
	}),
}));

export const guestPurchasedTicketsRelations = relations(guestPurchasedTickets, ({one}) => ({
	event: one(events, {
		fields: [guestPurchasedTickets.eventId],
		references: [events.id]
	}),
	guestOrder: one(guestOrders, {
		fields: [guestPurchasedTickets.guestOrderId],
		references: [guestOrders.id]
	}),
	eventTicket: one(eventTickets, {
		fields: [guestPurchasedTickets.ticketTierId],
		references: [eventTickets.id]
	}),
}));

export const groupSubscriptionsRelations = relations(groupSubscriptions, ({one}) => ({
	group: one(groups, {
		fields: [groupSubscriptions.groupId],
		references: [groups.id]
	}),
	groupSubscriptionTier: one(groupSubscriptionTiers, {
		fields: [groupSubscriptions.tierId],
		references: [groupSubscriptionTiers.id]
	}),
	user: one(users, {
		fields: [groupSubscriptions.userId],
		references: [users.id]
	}),
}));

export const groupQuestionsRelations = relations(groupQuestions, ({one}) => ({
	group: one(groups, {
		fields: [groupQuestions.groupId],
		references: [groups.id]
	}),
}));

export const eventBlastsRelations = relations(eventBlasts, ({one}) => ({
	event: one(events, {
		fields: [eventBlasts.eventId],
		references: [events.id]
	}),
	eventTeamMember: one(eventTeamMembers, {
		fields: [eventBlasts.sentByTeamMember],
		references: [eventTeamMembers.id]
	}),
	user: one(users, {
		fields: [eventBlasts.sentBy],
		references: [users.id]
	}),
}));

export const userSpendsRelations = relations(userSpends, ({one}) => ({
	event: one(events, {
		fields: [userSpends.eventId],
		references: [events.id]
	}),
	group: one(groups, {
		fields: [userSpends.groupId],
		references: [groups.id]
	}),
	user_talentUserId: one(users, {
		fields: [userSpends.talentUserId],
		references: [users.id],
		relationName: "userSpends_talentUserId_users_id"
	}),
	user_userId: one(users, {
		fields: [userSpends.userId],
		references: [users.id],
		relationName: "userSpends_userId_users_id"
	}),
}));

export const organizerPresetsRelations = relations(organizerPresets, ({one, many}) => ({
	organizer: one(organizers, {
		fields: [organizerPresets.organizerId],
		references: [organizers.id]
	}),
	events: many(events),
}));

export const organizerPayoutsRelations = relations(organizerPayouts, ({one}) => ({
	organizer: one(organizers, {
		fields: [organizerPayouts.organizerId],
		references: [organizers.id]
	}),
	userPayoutMethod: one(userPayoutMethods, {
		fields: [organizerPayouts.payoutMethodId],
		references: [userPayoutMethods.id]
	}),
	user: one(users, {
		fields: [organizerPayouts.userId],
		references: [users.id]
	}),
}));

export const userPayoutMethodsRelations = relations(userPayoutMethods, ({one, many}) => ({
	organizerPayouts: many(organizerPayouts),
	user: one(users, {
		fields: [userPayoutMethods.userId],
		references: [users.id]
	}),
	talentPayouts: many(talentPayouts),
	groupPayouts: many(groupPayouts),
}));

export const stripeConnectAccountsRelations = relations(stripeConnectAccounts, ({one}) => ({
	user: one(users, {
		fields: [stripeConnectAccounts.userId],
		references: [users.id]
	}),
}));

export const talentPayoutsRelations = relations(talentPayouts, ({one}) => ({
	userPayoutMethod: one(userPayoutMethods, {
		fields: [talentPayouts.payoutMethodId],
		references: [userPayoutMethods.id]
	}),
	talentProfile: one(talentProfiles, {
		fields: [talentPayouts.talentProfileId],
		references: [talentProfiles.id]
	}),
	user: one(users, {
		fields: [talentPayouts.userId],
		references: [users.id]
	}),
}));

export const groupPayoutsRelations = relations(groupPayouts, ({one}) => ({
	userPayoutMethod: one(userPayoutMethods, {
		fields: [groupPayouts.payoutMethodId],
		references: [userPayoutMethods.id]
	}),
	user: one(users, {
		fields: [groupPayouts.userId],
		references: [users.id]
	}),
}));

export const groupCoursesRelations = relations(groupCourses, ({one, many}) => ({
	user_createdBy: one(users, {
		fields: [groupCourses.createdBy],
		references: [users.id],
		relationName: "groupCourses_createdBy_users_id"
	}),
	group: one(groups, {
		fields: [groupCourses.groupId],
		references: [groups.id]
	}),
	user_ownerId: one(users, {
		fields: [groupCourses.ownerId],
		references: [users.id],
		relationName: "groupCourses_ownerId_users_id"
	}),
	groupCourseLessons: many(groupCourseLessons),
	groupCourseEnrollments: many(groupCourseEnrollments),
	groupCourseModules: many(groupCourseModules),
}));

export const groupCourseLessonsRelations = relations(groupCourseLessons, ({one, many}) => ({
	groupCourse: one(groupCourses, {
		fields: [groupCourseLessons.courseId],
		references: [groupCourses.id]
	}),
	groupCourseModule: one(groupCourseModules, {
		fields: [groupCourseLessons.moduleId],
		references: [groupCourseModules.id]
	}),
	groupCourseLessonProgresses: many(groupCourseLessonProgress),
	groupCourseLessonAttachments: many(groupCourseLessonAttachments),
}));

export const groupCourseModulesRelations = relations(groupCourseModules, ({one, many}) => ({
	groupCourseLessons: many(groupCourseLessons),
	groupCourse: one(groupCourses, {
		fields: [groupCourseModules.courseId],
		references: [groupCourses.id]
	}),
}));

export const groupCourseEnrollmentsRelations = relations(groupCourseEnrollments, ({one, many}) => ({
	groupCourse: one(groupCourses, {
		fields: [groupCourseEnrollments.courseId],
		references: [groupCourses.id]
	}),
	user: one(users, {
		fields: [groupCourseEnrollments.userId],
		references: [users.id]
	}),
	groupCourseLessonProgresses: many(groupCourseLessonProgress),
}));

export const suspensionAppealsRelations = relations(suspensionAppeals, ({one}) => ({
	user_adminId: one(users, {
		fields: [suspensionAppeals.adminId],
		references: [users.id],
		relationName: "suspensionAppeals_adminId_users_id"
	}),
	user_userId: one(users, {
		fields: [suspensionAppeals.userId],
		references: [users.id],
		relationName: "suspensionAppeals_userId_users_id"
	}),
}));

export const groupCourseLessonProgressRelations = relations(groupCourseLessonProgress, ({one}) => ({
	groupCourseEnrollment: one(groupCourseEnrollments, {
		fields: [groupCourseLessonProgress.enrollmentId],
		references: [groupCourseEnrollments.id]
	}),
	groupCourseLesson: one(groupCourseLessons, {
		fields: [groupCourseLessonProgress.lessonId],
		references: [groupCourseLessons.id]
	}),
	user: one(users, {
		fields: [groupCourseLessonProgress.userId],
		references: [users.id]
	}),
}));

export const demoRegistrationsRelations = relations(demoRegistrations, ({one}) => ({
	demoSession: one(demoSessions, {
		fields: [demoRegistrations.demoSessionId],
		references: [demoSessions.id]
	}),
}));

export const demoSessionsRelations = relations(demoSessions, ({many}) => ({
	demoRegistrations: many(demoRegistrations),
}));

export const talentIssuesRelations = relations(talentIssues, ({one}) => ({
	user_adminId: one(users, {
		fields: [talentIssues.adminId],
		references: [users.id],
		relationName: "talentIssues_adminId_users_id"
	}),
	user_reporterId: one(users, {
		fields: [talentIssues.reporterId],
		references: [users.id],
		relationName: "talentIssues_reporterId_users_id"
	}),
	talentProfile: one(talentProfiles, {
		fields: [talentIssues.talentProfileId],
		references: [talentProfiles.id]
	}),
	user_talentUserId: one(users, {
		fields: [talentIssues.talentUserId],
		references: [users.id],
		relationName: "talentIssues_talentUserId_users_id"
	}),
}));

export const talentReviewsRelations = relations(talentReviews, ({one}) => ({
	user: one(users, {
		fields: [talentReviews.reviewerId],
		references: [users.id]
	}),
	talentSession: one(talentSessions, {
		fields: [talentReviews.sessionId],
		references: [talentSessions.id]
	}),
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [talentReviews.shopCustomOfferId],
		references: [shopCustomServiceOffers.id]
	}),
	talentProfile: one(talentProfiles, {
		fields: [talentReviews.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const shopCustomServiceOffersRelations = relations(shopCustomServiceOffers, ({one, many}) => ({
	talentReviews: many(talentReviews),
	shopProduct_basedOnProductId: one(shopProducts, {
		fields: [shopCustomServiceOffers.basedOnProductId],
		references: [shopProducts.id],
		relationName: "shopCustomServiceOffers_basedOnProductId_shopProducts_id"
	}),
	shopProduct_basedOnProductId: one(shopProducts, {
		fields: [shopCustomServiceOffers.basedOnProductId],
		references: [shopProducts.id],
		relationName: "shopCustomServiceOffers_basedOnProductId_shopProducts_id"
	}),
	user_buyerId: one(users, {
		fields: [shopCustomServiceOffers.buyerId],
		references: [users.id],
		relationName: "shopCustomServiceOffers_buyerId_users_id"
	}),
	user_buyerId: one(users, {
		fields: [shopCustomServiceOffers.buyerId],
		references: [users.id],
		relationName: "shopCustomServiceOffers_buyerId_users_id"
	}),
	user_sellerId: one(users, {
		fields: [shopCustomServiceOffers.sellerId],
		references: [users.id],
		relationName: "shopCustomServiceOffers_sellerId_users_id"
	}),
	user_sellerId: one(users, {
		fields: [shopCustomServiceOffers.sellerId],
		references: [users.id],
		relationName: "shopCustomServiceOffers_sellerId_users_id"
	}),
	shopCustomOfferDeliverables: many(shopCustomOfferDeliverables),
	shopCustomOfferActivities: many(shopCustomOfferActivity),
	shopCustomOfferDateExtensionRequests: many(shopCustomOfferDateExtensionRequests),
	shopCustomOfferDisputes: many(shopCustomOfferDisputes),
	shopCustomOfferRevisionRequests: many(shopCustomOfferRevisionRequests),
	shopCustomOfferTips: many(shopCustomOfferTips),
}));

export const organizerSocialLinksRelations = relations(organizerSocialLinks, ({one}) => ({
	organizer: one(organizers, {
		fields: [organizerSocialLinks.organizerId],
		references: [organizers.id]
	}),
	talentProfile: one(talentProfiles, {
		fields: [organizerSocialLinks.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const storyCollectionsRelations = relations(storyCollections, ({one, many}) => ({
	user: one(users, {
		fields: [storyCollections.userId],
		references: [users.id]
	}),
	storyCollectionItems: many(storyCollectionItems),
}));

export const storyCollectionItemsRelations = relations(storyCollectionItems, ({one}) => ({
	storyCollection: one(storyCollections, {
		fields: [storyCollectionItems.collectionId],
		references: [storyCollections.id]
	}),
	post: one(posts, {
		fields: [storyCollectionItems.postId],
		references: [posts.id]
	}),
	story: one(stories, {
		fields: [storyCollectionItems.storyId],
		references: [stories.id]
	}),
}));

export const bioLinksRelations = relations(bioLinks, ({one}) => ({
	user: one(users, {
		fields: [bioLinks.userId],
		references: [users.id]
	}),
}));

export const eventTicketScheduleInventoryRelations = relations(eventTicketScheduleInventory, ({one}) => ({
	event: one(events, {
		fields: [eventTicketScheduleInventory.eventId],
		references: [events.id]
	}),
}));

export const followerInviteLogRelations = relations(followerInviteLog, ({one}) => ({
	event: one(events, {
		fields: [followerInviteLog.eventId],
		references: [events.id]
	}),
	organizer: one(organizers, {
		fields: [followerInviteLog.organizerId],
		references: [organizers.id]
	}),
}));

export const storyCommentsRelations = relations(storyComments, ({one, many}) => ({
	storyComment: one(storyComments, {
		fields: [storyComments.parentId],
		references: [storyComments.id],
		relationName: "storyComments_parentId_storyComments_id"
	}),
	storyComments: many(storyComments, {
		relationName: "storyComments_parentId_storyComments_id"
	}),
	story: one(stories, {
		fields: [storyComments.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [storyComments.userId],
		references: [users.id]
	}),
}));

export const profileViewSessionsRelations = relations(profileViewSessions, ({one}) => ({
	socialProfile: one(socialProfiles, {
		fields: [profileViewSessions.profileId],
		references: [socialProfiles.id]
	}),
	user: one(users, {
		fields: [profileViewSessions.userId],
		references: [users.id]
	}),
}));

export const postCollaboratorsRelations = relations(postCollaborators, ({one}) => ({
	user_collaboratorId: one(users, {
		fields: [postCollaborators.collaboratorId],
		references: [users.id],
		relationName: "postCollaborators_collaboratorId_users_id"
	}),
	user_invitedById: one(users, {
		fields: [postCollaborators.invitedById],
		references: [users.id],
		relationName: "postCollaborators_invitedById_users_id"
	}),
	post: one(posts, {
		fields: [postCollaborators.postId],
		references: [posts.id]
	}),
}));

export const importsRelations = relations(imports, ({one, many}) => ({
	user: one(users, {
		fields: [imports.userId],
		references: [users.id]
	}),
	importImages: many(importImages),
}));

export const importImagesRelations = relations(importImages, ({one}) => ({
	post: one(posts, {
		fields: [importImages.createdPostId],
		references: [posts.id]
	}),
	import: one(imports, {
		fields: [importImages.importId],
		references: [imports.id]
	}),
	user: one(users, {
		fields: [importImages.userId],
		references: [users.id]
	}),
}));

export const priorityMessageItemsRelations = relations(priorityMessageItems, ({one}) => ({
	socialMessage_messageId: one(socialMessages, {
		fields: [priorityMessageItems.messageId],
		references: [socialMessages.id],
		relationName: "priorityMessageItems_messageId_socialMessages_id"
	}),
	socialMessage_replyMessageId: one(socialMessages, {
		fields: [priorityMessageItems.replyMessageId],
		references: [socialMessages.id],
		relationName: "priorityMessageItems_replyMessageId_socialMessages_id"
	}),
}));

export const priorityMessageAttachmentsRelations = relations(priorityMessageAttachments, ({one}) => ({
	media: one(media, {
		fields: [priorityMessageAttachments.mediaId],
		references: [media.id]
	}),
	user: one(users, {
		fields: [priorityMessageAttachments.uploadedBy],
		references: [users.id]
	}),
}));

export const userPostOrderCounterRelations = relations(userPostOrderCounter, ({one}) => ({
	user: one(users, {
		fields: [userPostOrderCounter.userId],
		references: [users.id]
	}),
}));

export const contentModerationRelations = relations(contentModeration, ({one}) => ({
	discussion: one(discussions, {
		fields: [contentModeration.discussionId],
		references: [discussions.id]
	}),
	event: one(events, {
		fields: [contentModeration.eventId],
		references: [events.id]
	}),
	group: one(groups, {
		fields: [contentModeration.groupId],
		references: [groups.id]
	}),
	media: one(media, {
		fields: [contentModeration.mediaId],
		references: [media.id]
	}),
	post: one(posts, {
		fields: [contentModeration.postId],
		references: [posts.id]
	}),
	story: one(stories, {
		fields: [contentModeration.storyId],
		references: [stories.id]
	}),
	user: one(users, {
		fields: [contentModeration.userId],
		references: [users.id]
	}),
}));

export const textModerationRelations = relations(textModeration, ({one}) => ({
	user_reviewedBy: one(users, {
		fields: [textModeration.reviewedBy],
		references: [users.id],
		relationName: "textModeration_reviewedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [textModeration.userId],
		references: [users.id],
		relationName: "textModeration_userId_users_id"
	}),
}));

export const pinnedProfilesRelations = relations(pinnedProfiles, ({one}) => ({
	user_pinnedUserId: one(users, {
		fields: [pinnedProfiles.pinnedUserId],
		references: [users.id],
		relationName: "pinnedProfiles_pinnedUserId_users_id"
	}),
	user_userId: one(users, {
		fields: [pinnedProfiles.userId],
		references: [users.id],
		relationName: "pinnedProfiles_userId_users_id"
	}),
}));

export const postShopProductsRelations = relations(postShopProducts, ({one}) => ({
	post: one(posts, {
		fields: [postShopProducts.postId],
		references: [posts.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [postShopProducts.productId],
		references: [shopProducts.id]
	}),
}));

export const shopProductsRelations = relations(shopProducts, ({one, many}) => ({
	postShopProducts: many(postShopProducts),
	shopProductViews: many(shopProductViews),
	groupShopProducts: many(groupShopProducts),
	shopOrders: many(shopOrders),
	shopCustomServiceOffers_basedOnProductId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_basedOnProductId_shopProducts_id"
	}),
	shopCustomServiceOffers_basedOnProductId: many(shopCustomServiceOffers, {
		relationName: "shopCustomServiceOffers_basedOnProductId_shopProducts_id"
	}),
	shopCourseModules: many(shopCourseModules),
	user: one(users, {
		fields: [shopProducts.userId],
		references: [users.id]
	}),
	shopCourseLessons: many(shopCourseLessons),
	shopCourseLessonProgresses: many(shopCourseLessonProgress),
	productAnalyticsDailies: many(productAnalyticsDaily),
}));

export const shopProductViewsRelations = relations(shopProductViews, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [shopProductViews.productId],
		references: [shopProducts.id]
	}),
	user: one(users, {
		fields: [shopProductViews.userId],
		references: [users.id]
	}),
}));

export const groupShopProductsRelations = relations(groupShopProducts, ({one}) => ({
	group: one(groups, {
		fields: [groupShopProducts.groupId],
		references: [groups.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [groupShopProducts.productId],
		references: [shopProducts.id]
	}),
}));

export const shopRefundRequestsRelations = relations(shopRefundRequests, ({one}) => ({
	user_buyerId: one(users, {
		fields: [shopRefundRequests.buyerId],
		references: [users.id],
		relationName: "shopRefundRequests_buyerId_users_id"
	}),
	shopOrder: one(shopOrders, {
		fields: [shopRefundRequests.orderId],
		references: [shopOrders.id]
	}),
	user_resolvedByUserId: one(users, {
		fields: [shopRefundRequests.resolvedByUserId],
		references: [users.id],
		relationName: "shopRefundRequests_resolvedByUserId_users_id"
	}),
	user_sellerId: one(users, {
		fields: [shopRefundRequests.sellerId],
		references: [users.id],
		relationName: "shopRefundRequests_sellerId_users_id"
	}),
}));

export const shopOrdersRelations = relations(shopOrders, ({one, many}) => ({
	shopRefundRequests: many(shopRefundRequests),
	user_buyerId: one(users, {
		fields: [shopOrders.buyerId],
		references: [users.id],
		relationName: "shopOrders_buyerId_users_id"
	}),
	shopProduct: one(shopProducts, {
		fields: [shopOrders.productId],
		references: [shopProducts.id]
	}),
	user_sellerId: one(users, {
		fields: [shopOrders.sellerId],
		references: [users.id],
		relationName: "shopOrders_sellerId_users_id"
	}),
}));

export const groupAboutGalleryRelations = relations(groupAboutGallery, ({one}) => ({
	group: one(groups, {
		fields: [groupAboutGallery.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupAboutGallery.uploaderId],
		references: [users.id]
	}),
}));

export const groupMessageReactionsRelations = relations(groupMessageReactions, ({one}) => ({
	groupChatMessage: one(groupChatMessages, {
		fields: [groupMessageReactions.messageId],
		references: [groupChatMessages.id]
	}),
	user: one(users, {
		fields: [groupMessageReactions.userId],
		references: [users.id]
	}),
}));

export const groupCourseLessonAttachmentsRelations = relations(groupCourseLessonAttachments, ({one}) => ({
	groupCourseLesson: one(groupCourseLessons, {
		fields: [groupCourseLessonAttachments.lessonId],
		references: [groupCourseLessons.id]
	}),
}));

export const shopCourseModulesRelations = relations(shopCourseModules, ({one, many}) => ({
	shopProduct: one(shopProducts, {
		fields: [shopCourseModules.productId],
		references: [shopProducts.id]
	}),
	shopCourseLessons: many(shopCourseLessons),
}));

export const shopCustomOfferDeliverablesRelations = relations(shopCustomOfferDeliverables, ({one}) => ({
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferDeliverables.offerId],
		references: [shopCustomServiceOffers.id]
	}),
	user: one(users, {
		fields: [shopCustomOfferDeliverables.uploadedByUserId],
		references: [users.id]
	}),
}));

export const reserveAdjustmentsRelations = relations(reserveAdjustments, ({one}) => ({
	event: one(events, {
		fields: [reserveAdjustments.eventId],
		references: [events.id]
	}),
	order: one(orders, {
		fields: [reserveAdjustments.orderId],
		references: [orders.id]
	}),
	organizer: one(organizers, {
		fields: [reserveAdjustments.organizerId],
		references: [organizers.id]
	}),
}));

export const shopCustomOfferActivityRelations = relations(shopCustomOfferActivity, ({one}) => ({
	user: one(users, {
		fields: [shopCustomOfferActivity.actorUserId],
		references: [users.id]
	}),
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferActivity.offerId],
		references: [shopCustomServiceOffers.id]
	}),
}));

export const shopCustomOfferDateExtensionRequestsRelations = relations(shopCustomOfferDateExtensionRequests, ({one}) => ({
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferDateExtensionRequests.offerId],
		references: [shopCustomServiceOffers.id]
	}),
	user: one(users, {
		fields: [shopCustomOfferDateExtensionRequests.requestedByUserId],
		references: [users.id]
	}),
}));

export const shopCustomOfferDisputesRelations = relations(shopCustomOfferDisputes, ({one}) => ({
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferDisputes.offerId],
		references: [shopCustomServiceOffers.id]
	}),
	user_raisedByUserId: one(users, {
		fields: [shopCustomOfferDisputes.raisedByUserId],
		references: [users.id],
		relationName: "shopCustomOfferDisputes_raisedByUserId_users_id"
	}),
	user_resolvedByUserId: one(users, {
		fields: [shopCustomOfferDisputes.resolvedByUserId],
		references: [users.id],
		relationName: "shopCustomOfferDisputes_resolvedByUserId_users_id"
	}),
}));

export const shopCustomOfferRevisionRequestsRelations = relations(shopCustomOfferRevisionRequests, ({one}) => ({
	user: one(users, {
		fields: [shopCustomOfferRevisionRequests.buyerId],
		references: [users.id]
	}),
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferRevisionRequests.offerId],
		references: [shopCustomServiceOffers.id]
	}),
}));

export const shopCustomOfferTipsRelations = relations(shopCustomOfferTips, ({one}) => ({
	user_buyerId: one(users, {
		fields: [shopCustomOfferTips.buyerId],
		references: [users.id],
		relationName: "shopCustomOfferTips_buyerId_users_id"
	}),
	shopCustomServiceOffer: one(shopCustomServiceOffers, {
		fields: [shopCustomOfferTips.offerId],
		references: [shopCustomServiceOffers.id]
	}),
	user_sellerId: one(users, {
		fields: [shopCustomOfferTips.sellerId],
		references: [users.id],
		relationName: "shopCustomOfferTips_sellerId_users_id"
	}),
}));

export const postTabLinksRelations = relations(postTabLinks, ({one, many}) => ({
	user: one(users, {
		fields: [postTabLinks.userId],
		references: [users.id]
	}),
	userPostOrders: many(userPostOrder),
	pinnedPosts: many(pinnedPosts),
}));

export const userPostOrderRelations = relations(userPostOrder, ({one}) => ({
	postTabLink: one(postTabLinks, {
		fields: [userPostOrder.linkId],
		references: [postTabLinks.id]
	}),
	post: one(posts, {
		fields: [userPostOrder.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [userPostOrder.userId],
		references: [users.id]
	}),
}));

export const pinnedPostsRelations = relations(pinnedPosts, ({one}) => ({
	postTabLink: one(postTabLinks, {
		fields: [pinnedPosts.linkId],
		references: [postTabLinks.id]
	}),
	post: one(posts, {
		fields: [pinnedPosts.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [pinnedPosts.userId],
		references: [users.id]
	}),
}));

export const popularLinkCoversRelations = relations(popularLinkCovers, ({one}) => ({
	user: one(users, {
		fields: [popularLinkCovers.createdByUserId],
		references: [users.id]
	}),
}));

export const shopCourseLessonsRelations = relations(shopCourseLessons, ({one, many}) => ({
	shopCourseModule: one(shopCourseModules, {
		fields: [shopCourseLessons.moduleId],
		references: [shopCourseModules.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [shopCourseLessons.productId],
		references: [shopProducts.id]
	}),
	shopCourseLessonAttachments: many(shopCourseLessonAttachments),
	shopCourseLessonProgresses: many(shopCourseLessonProgress),
}));

export const shopCourseLessonAttachmentsRelations = relations(shopCourseLessonAttachments, ({one}) => ({
	shopCourseLesson: one(shopCourseLessons, {
		fields: [shopCourseLessonAttachments.lessonId],
		references: [shopCourseLessons.id]
	}),
}));

export const shopCourseLessonProgressRelations = relations(shopCourseLessonProgress, ({one}) => ({
	shopCourseLesson: one(shopCourseLessons, {
		fields: [shopCourseLessonProgress.lessonId],
		references: [shopCourseLessons.id]
	}),
	shopProduct: one(shopProducts, {
		fields: [shopCourseLessonProgress.productId],
		references: [shopProducts.id]
	}),
	user: one(users, {
		fields: [shopCourseLessonProgress.userId],
		references: [users.id]
	}),
}));

export const groupResourcesRelations = relations(groupResources, ({one}) => ({
	user: one(users, {
		fields: [groupResources.createdBy],
		references: [users.id]
	}),
	group: one(groups, {
		fields: [groupResources.groupId],
		references: [groups.id]
	}),
}));

export const eventMarketingSettingsRelations = relations(eventMarketingSettings, ({one}) => ({
	event: one(events, {
		fields: [eventMarketingSettings.eventId],
		references: [events.id]
	}),
}));

export const analyticsEvents202609Relations = relations(analyticsEvents202609, ({one}) => ({
	user: one(users, {
		fields: [analyticsEvents202609.userId],
		references: [users.id]
	}),
}));

export const analyticsEvents202610Relations = relations(analyticsEvents202610, ({one}) => ({
	user: one(users, {
		fields: [analyticsEvents202610.userId],
		references: [users.id]
	}),
}));

export const analyticsEvents202611Relations = relations(analyticsEvents202611, ({one}) => ({
	user: one(users, {
		fields: [analyticsEvents202611.userId],
		references: [users.id]
	}),
}));

export const analyticsEvents202612Relations = relations(analyticsEvents202612, ({one}) => ({
	user: one(users, {
		fields: [analyticsEvents202612.userId],
		references: [users.id]
	}),
}));

export const analyticsIdentityLinksRelations = relations(analyticsIdentityLinks, ({one}) => ({
	user: one(users, {
		fields: [analyticsIdentityLinks.userId],
		references: [users.id]
	}),
}));

export const postAnalyticsDailyRelations = relations(postAnalyticsDaily, ({one}) => ({
	post: one(posts, {
		fields: [postAnalyticsDaily.postId],
		references: [posts.id]
	}),
}));

export const groupAnalyticsDailyRelations = relations(groupAnalyticsDaily, ({one}) => ({
	group: one(groups, {
		fields: [groupAnalyticsDaily.groupId],
		references: [groups.id]
	}),
}));

export const productAnalyticsDailyRelations = relations(productAnalyticsDaily, ({one}) => ({
	shopProduct: one(shopProducts, {
		fields: [productAnalyticsDaily.productId],
		references: [shopProducts.id]
	}),
}));

export const serviceAnalyticsDailyRelations = relations(serviceAnalyticsDaily, ({one}) => ({
	talentProfile: one(talentProfiles, {
		fields: [serviceAnalyticsDaily.talentProfileId],
		references: [talentProfiles.id]
	}),
}));

export const discussionLikesRelations = relations(discussionLikes, ({one}) => ({
	discussion: one(discussions, {
		fields: [discussionLikes.discussionId],
		references: [discussions.id]
	}),
	user: one(users, {
		fields: [discussionLikes.userId],
		references: [users.id]
	}),
}));

export const mediaOwnersRelations = relations(mediaOwners, ({one}) => ({
	media: one(media, {
		fields: [mediaOwners.mediaId],
		references: [media.id]
	}),
	user: one(users, {
		fields: [mediaOwners.userId],
		references: [users.id]
	}),
}));

export const accountsRelations = relations(accounts, ({one}) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id]
	}),
}));