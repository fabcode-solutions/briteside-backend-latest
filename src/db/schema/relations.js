import { relations } from 'drizzle-orm';
import {
  users,
  accounts,
  roles,
  userRoles,
  categories,
  userPreferences,
  organizers,
  userInformation,
  organizerMembers,
  ticketScans,
  purchasedTickets,
  purchasedMerchandise,
  venues,
  events,
  eventSchedules,
  eventTickets,
  eventMerchandise,
  eventVirtualDetails,
  paymentMethods,
  orders,
  orderItems,
  refunds,
  groups,
  groupMembers,
  groupJoinRequests,
  groupQuestions,
  eventMedia,
  eventAttendees,
  eventInvitations,
  eventReviews,
  organizerReviews,
  eventAnalytics,
  groupEventPromotions,
  eventChatRooms,
  eventChatParticipants,
  eventChatMessages,
  eventMessageReadReceipts,
  eventMessageReactions,
  groupChatRooms,
  guestOrders,
  guestOrderItems,
  guestPurchasedTickets,
  groupChatMessages,
  groupMessageReactions,
  groupMessageReadReceipts,
  chatModerationActions,
  // Social direct chat
  socialConversations,
  socialMessages,
  socialWallPosts,
  userNotificationSettings,
  notifications,
  contentReports,
  adminTasks,
  taskSubtasks,
  auditLogs,
  adminReports,
  groupSubscriptionTiers,
  groupSubscriptions,
  eventGroupLinks,
  eventAccessControl,
  eventFaqs,
  eventSponsors,
  eventSpeakers,
  eventWaitlist,
  eventDiscountCodes,
  groupCategories,
  groupTags,
  groupRules,
  groupMemberRoles,
  groupAnnouncements,
  groupMedia,
  groupFeaturedContent,
  userFollows,
  pinnedProfiles,
  shopProducts,
  shopProductViews,
  shopOrders,
  shopRefundRequests,
  postShopProducts,
  groupShopProducts,
  socialProfiles,
  posts,
  postLikes,
  postComments,
  commentLikes,
  stories,
  storyViews,
  storyLikes,
  storyComments,
  storyCommentLikes,
  storyShares,
  postShares,
  postReposts,
  postUserComments,
  savedPosts,
  userHiddenPosts,
  userBlocks,
  pinnedPosts,
  interestCategories,
  userInterests,
  postTags,
  eventLikes,
  reviewHelpfulness,
  discussions,
  discussionReplies,
  discussionLikes,
  discussionReplyLikes,
  discussionSubscriptions,
  discussionCategories,
  mentions,
  userReports,
  tags,
  usernameReservations,
  groupDiscussionNotifications,
  postViews,
  profileViews,
  profileViewSessions,
  storyPolls,
  storyPollResponses,
  // BriteSide Plus
  stripeCustomers,
  subscriptionPlans,
  subscriptionFeatures,
  userSubscriptions,
  subscriptionAuditLogs,
  scanSessions,
  eventTeamMembers,
  eventTeams,
  eventTeamRoles,
  postCollaborators,
  shopCustomServiceOffers
} from './index.js';
import { storyCollections, storyCollectionItems } from './storyCollections.js';
import { groupAboutGallery } from './groups.js';
import { bioLinks } from './bioLinks.js';
import { talentProfiles } from './talentProfiles.js';
import { organizerPresets } from './organizerPresets.js';
import { talentAvailability } from './talentAvailability.js';
import { talentSessions } from './talentSessions.js';
import { talentDateOverrides } from './talentDateOverrides.js';
import { talentFavorites } from './talentFavorites.js';
import { talentReviews } from './talentReviews.js';
import { talentGiftCodes } from './talentGiftCodes.js';
import { priorityMessagePayments, priorityMessageItems } from './priorityMessagePayments.js';
import { userSpends } from './userSpends.js';
import { eventVenueProfiles } from './eventVenueProfiles.js';
import { organizerSocialLinks } from './index.js';
import { analyticsEvents } from './analyticsEvents.js';
import { analyticsIdentityLinks } from './analyticsIdentity.js';
import {
  postAnalyticsDaily,
  groupAnalyticsDaily,
  productAnalyticsDaily,
  serviceAnalyticsDaily,
} from './analyticsRollups.js';
import {
  livestreams,
  livestreamReactions,
  livestreamComments,
  livestreamViewers,
} from './livestreams.js';
import { suspensionAppeals } from './appeals.js';
import {
  groupCourses,
  groupCourseModules,
  groupCourseLessons,
  groupCourseLessonAttachments,
  groupCourseEnrollments,
  groupCourseLessonProgress,
} from './groupCourses.js';
import { groupResources } from './groupResources.js';
// User relations
export const usersRelations = relations(users, ({ many, one }) => ({
  roles: many(userRoles),
  preferences: many(userPreferences),
  organizer: one(organizers, {
    fields: [users.id],
    references: [organizers.userId],
  }),
  accounts: many(accounts),

  purchasedTickets: many(purchasedTickets),
  purchasedMerchandise: many(purchasedMerchandise),
  createdVenues: many(venues),
  paymentMethods: many(paymentMethods),
  orders: many(orders),
  createdGroups: many(groups),
  groupMemberships: many(groupMembers),
  groups: many(groups),
  joinRequests: many(groupJoinRequests),

  uploadedMedia: many(eventMedia),
  uploadedGroupMedia: many(groupMedia),
  createdGroupFeaturedContent: many(groupFeaturedContent),
  eventAttendances: many(eventAttendees),
  eventInvitations: many(eventInvitations),
  eventReviews: many(eventReviews),
  organizerReviews: many(organizerReviews),

  eventChatMessages: many(eventChatMessages),
  eventChatParticipants: many(eventChatParticipants),
  eventMessageReactions: many(eventMessageReactions),
  groupChatMessages: many(groupChatMessages),
  groupMessageReactions: many(groupMessageReactions),
  moderationActions: many(chatModerationActions),
  notifications: many(notifications),
  notificationSettings: one(userNotificationSettings),
  // contentReports: many(contentReports), // Removed
  adminTasks: many(adminTasks),
  auditLogs: many(auditLogs),

  // Social relations
  socialProfile: one(socialProfiles),
  socialWallPosts: many(socialWallPosts),
  followers: many(userFollows, { relationName: 'following' }),
  following: many(userFollows, { relationName: 'follower' }),
  sentInvitations: many(eventInvitations),
  receivedInvitations: many(eventInvitations),
  // social statuses & wall posts authored by the user
  wallPostsAuthored: many(socialWallPosts, { relationName: 'wallPostsAuthor' }),

  // Story collections
  storyCollections: many(storyCollections),

  // Bio links
  bioLinks: many(bioLinks),

  // Posts and social content
  posts: many(posts),
  postLikes: many(postLikes),
  postComments: many(postComments),
  commentLikes: many(commentLikes),
  stories: many(stories),
  storyViews: many(storyViews),
  postShares: many(postShares),
  postReposts: many(postReposts),
  postUserComments: many(postUserComments),
  savedPosts: many(savedPosts),
  blockedUsers: many(userBlocks, { relationName: 'blocker' }),
  blockedBy: many(userBlocks, { relationName: 'blocked' }),

  // Event interactions
  eventLikes: many(eventLikes),

  // Reviews
  reviewHelpfulness: many(reviewHelpfulness),

  // Interests
  interests: many(userInterests),

  // Reports
  reportsSubmitted: many(userReports, { relationName: 'reportsSubmitted' }),
  reportsReviewed: many(userReports, { relationName: 'reportsReviewed' }),
  reportsReceived: many(userReports, { relationName: 'reportsReceived' }),

  // Username reservations reviewed by admin
  reservationsReviewed: many(usernameReservations, { relationName: 'reviewedByUser' }),

  // User information
  userInformation: one(userInformation, {
    fields: [users.id],
    references: [userInformation.userId],
  }),

  // Suspension appeals
  suspensionAppeals: many(suspensionAppeals, { relationName: 'appealUser' }),

  // Social chat
  conversationsAsUserA: many(socialConversations, { relationName: 'conversationUserA' }),
  conversationsAsUserB: many(socialConversations, { relationName: 'conversationUserB' }),
}));

// Role relations
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

// User information relations
export const userInformationRelations = relations(userInformation, ({ one }) => ({
  user: one(users, {
    fields: [userInformation.userId],
    references: [users.id],
  }),
}));

// OAuth accounts relations
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

// Category relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  events: many(events),
  userPreferences: many(userPreferences),
  discussionCategories: many(discussionCategories),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [userPreferences.categoryId],
    references: [categories.id],
  }),
}));

// Organizer relations
export const organizersRelations = relations(organizers, ({ one, many }) => ({
  user: one(users, { fields: [organizers.userId], references: [users.id] }),
  events: many(events),
  members: many(organizerMembers),
  purchasedTickets: many(purchasedTickets),
  presets: many(organizerPresets),
  socialLinks: one(organizerSocialLinks, {
    fields: [organizers.id],
    references: [organizerSocialLinks.organizerId],
  }),
}));

export const organizerSocialLinksRelations = relations(organizerSocialLinks, ({ one }) => ({
  organizer: one(organizers, {
    fields: [organizerSocialLinks.organizerId],
    references: [organizers.id],
  }),
  talentProfile: one(talentProfiles, {
    fields: [organizerSocialLinks.talentProfileId],
    references: [talentProfiles.id],
  }),
}));

export const organizerPresetsRelations = relations(organizerPresets, ({ one }) => ({
  organizer: one(organizers, {
    fields: [organizerPresets.organizerId],
    references: [organizers.id],
  }),
}));

// Event team relations
export const eventTeamsRelations = relations(eventTeams, ({ one, many }) => ({
  event: one(events, { fields: [eventTeams.eventId], references: [events.id] }),
  members: many(eventTeamMembers),
}));

export const eventTeamRolesRelations = relations(eventTeamRoles, ({ many }) => ({
  members: many(eventTeamMembers),
}));

export const eventTeamMembersRelations = relations(eventTeamMembers, ({ one }) => ({
  team: one(eventTeams, { fields: [eventTeamMembers.teamId], references: [eventTeams.id] }),
  role: one(eventTeamRoles, { fields: [eventTeamMembers.roleId], references: [eventTeamRoles.id] }),
  user: one(users, { fields: [eventTeamMembers.userId], references: [users.id] }),
}));

// Organizer member relations
export const organizerMembersRelations = relations(organizerMembers, ({ one, many }) => ({
  organizer: one(organizers, {
    fields: [organizerMembers.organizerId],
    references: [organizers.id],
  }),
  ticketScans: many(ticketScans),
}));

// Ticket scan relations
export const ticketScansRelations = relations(ticketScans, ({ one }) => ({
  scannedBy: one(organizerMembers, {
    fields: [ticketScans.scannedBy],
    references: [organizerMembers.id],
  }),
  scannedByTeamMember: one(eventTeamMembers, {
    fields: [ticketScans.scannedByTeamMember],
    references: [eventTeamMembers.id],
  }),
}));

export const scanSessionsRelations = relations(scanSessions, ({ one }) => ({
  organizer: one(organizers, { fields: [scanSessions.organizerId], references: [organizers.id] }),
  member: one(organizerMembers, {
    fields: [scanSessions.memberId],
    references: [organizerMembers.id],
  }),
  teamMember: one(eventTeamMembers, {
    fields: [scanSessions.teamMemberId],
    references: [eventTeamMembers.id],
  }),
  event: one(events, { fields: [scanSessions.eventId], references: [events.id] }),
}));

// Purchased ticket relations
export const purchasedTicketsRelations = relations(purchasedTickets, ({ one }) => ({
  event: one(events, {
    fields: [purchasedTickets.eventId],
    references: [events.id],
  }),
  ticketTier: one(eventTickets, {
    fields: [purchasedTickets.ticketTierId],
    references: [eventTickets.id],
  }),
  eventSchedule: one(eventSchedules, {
    fields: [purchasedTickets.eventScheduleId],
    references: [eventSchedules.id],
  }),
  user: one(users, {
    fields: [purchasedTickets.userId],
    references: [users.id],
  }),
  organizer: one(organizers, {
    fields: [purchasedTickets.organizerId],
    references: [organizers.id],
  }),
  transferredTo: one(users, {
    fields: [purchasedTickets.transferredTo],
    references: [users.id],
  }),
}));

// Venue relations
export const venuesRelations = relations(venues, ({ one, many }) => ({
  createdBy: one(users, { fields: [venues.createdBy], references: [users.id] }),
  events: many(events),
  profiles: many(eventVenueProfiles),
}));

export const eventVenueProfilesRelations = relations(eventVenueProfiles, ({ one }) => ({
  event: one(events, { fields: [eventVenueProfiles.eventId], references: [events.id] }),
  venue: one(venues, { fields: [eventVenueProfiles.venueId], references: [venues.id] }),
}));

// Event relations
export const eventsRelations = relations(events, ({ one, many }) => ({
  organizer: one(organizers, {
    fields: [events.organizerId],
    references: [organizers.id],
  }),
  venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
  venueProfile: one(eventVenueProfiles, {
    fields: [events.id],
    references: [eventVenueProfiles.eventId],
  }),
  schedules: many(eventSchedules),
  tickets: many(eventTickets),
  merchandise: many(eventMerchandise),
  orders: many(orders),
  media: many(eventMedia),

  attendees: many(eventAttendees),
  invitations: many(eventInvitations),
  reviews: many(eventReviews),
  analytics: many(eventAnalytics),
  chatRoom: one(eventChatRooms),
  groupPromotions: many(groupEventPromotions),
  groupLinks: many(eventGroupLinks),
  accessControl: many(eventAccessControl),
  faqs: many(eventFaqs),
  sponsors: many(eventSponsors),
  speakers: many(eventSpeakers),
  waitlist: many(eventWaitlist),
  discountCodes: many(eventDiscountCodes),
  likes: many(eventLikes),
  virtualDetails: one(eventVirtualDetails),
  preset: one(organizerPresets, {
    fields: [events.presetId],
    references: [organizerPresets.id],
  }),
}));

// Event Virtual Details relations
export const eventVirtualDetailsRelations = relations(eventVirtualDetails, ({ one }) => ({
  event: one(events, {
    fields: [eventVirtualDetails.eventId],
    references: [events.id],
  }),
}));

export const eventSchedulesRelations = relations(eventSchedules, ({ one, many }) => ({
  event: one(events, {
    fields: [eventSchedules.eventId],
    references: [events.id],
  }),
  purchasedTickets: many(purchasedTickets),
}));

// Ticket relations
export const eventTicketsRelations = relations(eventTickets, ({ one }) => ({
  event: one(events, {
    fields: [eventTickets.eventId],
    references: [events.id],
  }),
}));

export const eventMerchandiseRelations = relations(eventMerchandise, ({ one, many }) => ({
  event: one(events, {
    fields: [eventMerchandise.eventId],
    references: [events.id],
  }),
  purchases: many(purchasedMerchandise),
}));

// Purchased merchandise relations
export const purchasedMerchandiseRelations = relations(purchasedMerchandise, ({ one }) => ({
  user: one(users, {
    fields: [purchasedMerchandise.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [purchasedMerchandise.eventId],
    references: [events.id],
  }),
  merchandise: one(eventMerchandise, {
    fields: [purchasedMerchandise.merchandiseId],
    references: [eventMerchandise.id],
  }),
}));

// Payment relations
export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  paymentMethod: one(paymentMethods, {
    fields: [orders.paymentMethodId],
    references: [paymentMethods.id],
  }),
  items: many(orderItems),
  refunds: many(refunds),
}));

export const guestOrdersRelations = relations(guestOrders, ({ one, many }) => ({
  event: one(events, { fields: [guestOrders.eventId], references: [events.id] }),
  items: many(guestOrderItems),
}));

export const guestOrderItemsRelations = relations(guestOrderItems, ({ one }) => ({
  order: one(guestOrders, { fields: [guestOrderItems.guestOrderId], references: [guestOrders.id] }),
  ticketTier: one(eventTickets, {
    fields: [guestOrderItems.ticketTierId],
    references: [eventTickets.id],
  }),
}));

export const guestPurchasedTicketsRelations = relations(guestPurchasedTickets, ({ one }) => ({
  event: one(events, { fields: [guestPurchasedTickets.eventId], references: [events.id] }),
  order: one(guestOrders, {
    fields: [guestPurchasedTickets.guestOrderId],
    references: [guestOrders.id],
  }),
  ticketTier: one(eventTickets, {
    fields: [guestPurchasedTickets.ticketTierId],
    references: [eventTickets.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  purchasedTicket: one(purchasedTickets, {
    fields: [orderItems.purchasedTicketId],
    references: [purchasedTickets.id],
  }),
  purchasedMerchandise: one(purchasedMerchandise, {
    fields: [orderItems.purchasedMerchandiseId],
    references: [purchasedMerchandise.id],
  }),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
}));

// Group relations
export const groupsRelations = relations(groups, ({ one, many }) => ({
  category: one(groupCategories, {
    fields: [groups.categoryId],
    references: [groupCategories.id],
  }),
  createdBy: one(users, { fields: [groups.createdBy], references: [users.id] }),
  members: many(groupMembers),
  joinRequests: many(groupJoinRequests),
  questions: many(groupQuestions),

  chatRoom: one(groupChatRooms),
  subscriptionTiers: many(groupSubscriptionTiers),
  subscriptions: many(groupSubscriptions),
  eventPromotions: many(groupEventPromotions),
  tags: many(groupTags),
  rules: many(groupRules),
  memberRoles: many(groupMemberRoles),
  announcements: many(groupAnnouncements),
  media: many(groupMedia),
  featuredContent: many(groupFeaturedContent),
   aboutGallery: many(groupAboutGallery),  
  discussionNotifications: many(groupDiscussionNotifications),
  courses: many(groupCourses),
  resources: many(groupResources),
  shopProducts: many(groupShopProducts),
}));

export const groupAboutGalleryRelations = relations(groupAboutGallery, ({ one }) => ({
  group: one(groups, {
    fields: [groupAboutGallery.groupId],
    references: [groups.id],
  }),
  uploader: one(users, {
    fields: [groupAboutGallery.uploaderId],
    references: [users.id],
  }),
}));
export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export const groupJoinRequestsRelations = relations(groupJoinRequests, ({ one }) => ({
  group: one(groups, {
    fields: [groupJoinRequests.groupId],
    references: [groups.id],
  }),
  user: one(users, {
    fields: [groupJoinRequests.userId],
    references: [users.id],
  }),
  respondedBy: one(users, {
    fields: [groupJoinRequests.respondedBy],
    references: [users.id],
  }),
}));

// Group media relations
export const groupMediaRelations = relations(groupMedia, ({ one }) => ({
  group: one(groups, {
    fields: [groupMedia.groupId],
    references: [groups.id],
  }),
  uploader: one(users, {
    fields: [groupMedia.uploaderId],
    references: [users.id],
  }),
}));

// Group featured content relations
export const groupFeaturedContentRelations = relations(groupFeaturedContent, ({ one }) => ({
  group: one(groups, {
    fields: [groupFeaturedContent.groupId],
    references: [groups.id],
  }),
  createdBy: one(users, {
    fields: [groupFeaturedContent.createdBy],
    references: [users.id],
  }),
}));

// Group discussion notification relations
export const groupDiscussionNotificationsRelations = relations(
  groupDiscussionNotifications,
  ({ one }) => ({
    group: one(groups, {
      fields: [groupDiscussionNotifications.groupId],
      references: [groups.id],
    }),
    user: one(users, {
      fields: [groupDiscussionNotifications.userId],
      references: [users.id],
    }),
  })
);

// Media relations
export const eventMediaRelations = relations(eventMedia, ({ one }) => ({
  event: one(events, { fields: [eventMedia.eventId], references: [events.id] }),
  uploader: one(users, {
    fields: [eventMedia.uploaderId],
    references: [users.id],
  }),
}));

// Additional relations for new tables
export const eventAttendeesRelations = relations(eventAttendees, ({ one }) => ({
  event: one(events, {
    fields: [eventAttendees.eventId],
    references: [events.id],
  }),
  user: one(users, { fields: [eventAttendees.userId], references: [users.id] }),
  order: one(orders, {
    fields: [eventAttendees.orderId],
    references: [orders.id],
  }),
  ticketTier: one(eventTickets, {
    fields: [eventAttendees.ticketTierId],
    references: [eventTickets.id],
  }),
  checkedInByMember: one(organizerMembers, {
    fields: [eventAttendees.checkedInByMember],
    references: [organizerMembers.id],
  }),
  checkedInByTeamMember: one(eventTeamMembers, {
    fields: [eventAttendees.checkedInByTeamMember],
    references: [eventTeamMembers.id],
  }),
}));

export const eventInvitationsRelations = relations(eventInvitations, ({ one }) => ({
  event: one(events, {
    fields: [eventInvitations.eventId],
    references: [events.id],
  }),
  inviter: one(users, {
    fields: [eventInvitations.inviterId],
    references: [users.id],
  }),
  invitee: one(users, {
    fields: [eventInvitations.inviteeId],
    references: [users.id],
  }),
}));

export const eventReviewsRelations = relations(eventReviews, ({ one, many }) => ({
  event: one(events, {
    fields: [eventReviews.eventId],
    references: [events.id],
  }),
  user: one(users, { fields: [eventReviews.userId], references: [users.id] }),
  ticket: one(purchasedTickets, {
    fields: [eventReviews.ticketId],
    references: [purchasedTickets.id],
  }),
  moderatedBy: one(users, {
    fields: [eventReviews.moderatedBy],
    references: [users.id],
  }),
  helpfulness: many(reviewHelpfulness),
}));

export const organizerReviewsRelations = relations(organizerReviews, ({ one }) => ({
  organizer: one(organizers, {
    fields: [organizerReviews.organizerId],
    references: [organizers.id],
  }),
  user: one(users, {
    fields: [organizerReviews.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [organizerReviews.eventId],
    references: [events.id],
  }),
}));

export const reviewHelpfulnessRelations = relations(reviewHelpfulness, ({ one }) => ({
  review: one(eventReviews, {
    fields: [reviewHelpfulness.reviewId],
    references: [eventReviews.id],
  }),
  user: one(users, {
    fields: [reviewHelpfulness.userId],
    references: [users.id],
  }),
}));

export const eventAnalyticsRelations = relations(eventAnalytics, ({ one }) => ({
  event: one(events, {
    fields: [eventAnalytics.eventId],
    references: [events.id],
  }),
}));

export const groupEventPromotionsRelations = relations(groupEventPromotions, ({ one }) => ({
  group: one(groups, {
    fields: [groupEventPromotions.groupId],
    references: [groups.id],
  }),
  event: one(events, {
    fields: [groupEventPromotions.eventId],
    references: [events.id],
  }),
  promotedBy: one(users, {
    fields: [groupEventPromotions.promotedBy],
    references: [users.id],
  }),
}));

export const eventChatRoomsRelations = relations(eventChatRooms, ({ one, many }) => ({
  event: one(events, {
    fields: [eventChatRooms.eventId],
    references: [events.id],
  }),
  participants: many(eventChatParticipants),
  messages: many(eventChatMessages),
  readReceipts: many(eventMessageReadReceipts),
}));

export const eventChatParticipantsRelations = relations(eventChatParticipants, ({ one }) => ({
  chatRoom: one(eventChatRooms, {
    fields: [eventChatParticipants.eventChatRoomId],
    references: [eventChatRooms.id],
  }),
  user: one(users, {
    fields: [eventChatParticipants.userId],
    references: [users.id],
  }),
  mutedBy: one(users, {
    fields: [eventChatParticipants.mutedBy],
    references: [users.id],
  }),
}));

export const eventChatMessagesRelations = relations(eventChatMessages, ({ one, many }) => ({
  chatRoom: one(eventChatRooms, {
    fields: [eventChatMessages.eventChatRoomId],
    references: [eventChatRooms.id],
  }),
  sender: one(users, {
    fields: [eventChatMessages.senderId],
    references: [users.id],
  }),
  replyTo: one(eventChatMessages, {
    fields: [eventChatMessages.replyToId],
    references: [eventChatMessages.id],
  }),
  replies: many(eventChatMessages),
  reactions: many(eventMessageReactions),
  deletedBy: one(users, {
    fields: [eventChatMessages.deletedBy],
    references: [users.id],
  }),
  pinnedBy: one(users, {
    fields: [eventChatMessages.pinnedBy],
    references: [users.id],
  }),
}));

export const eventMessageReadReceiptsRelations = relations(eventMessageReadReceipts, ({ one }) => ({
  chatRoom: one(eventChatRooms, {
    fields: [eventMessageReadReceipts.eventChatRoomId],
    references: [eventChatRooms.id],
  }),
  user: one(users, {
    fields: [eventMessageReadReceipts.userId],
    references: [users.id],
  }),
  lastReadMessage: one(eventChatMessages, {
    fields: [eventMessageReadReceipts.lastReadMessageId],
    references: [eventChatMessages.id],
  }),
}));

export const eventMessageReactionsRelations = relations(eventMessageReactions, ({ one }) => ({
  message: one(eventChatMessages, {
    fields: [eventMessageReactions.messageId],
    references: [eventChatMessages.id],
  }),
  user: one(users, {
    fields: [eventMessageReactions.userId],
    references: [users.id],
  }),
}));

export const groupChatRoomsRelations = relations(groupChatRooms, ({ one, many }) => ({
  group: one(groups, {
    fields: [groupChatRooms.groupId],
    references: [groups.id],
  }),
  messages: many(groupChatMessages),
  readReceipts: many(groupMessageReadReceipts), // ← add
}));

export const groupChatMessagesRelations = relations(groupChatMessages, ({ one, many }) => ({
  chatRoom: one(groupChatRooms, {
    fields: [groupChatMessages.groupChatRoomId],
    references: [groupChatRooms.id],
  }),
  sender: one(users, {
    fields: [groupChatMessages.senderId],
    references: [users.id],
  }),
  replyTo: one(groupChatMessages, {
    fields: [groupChatMessages.replyToId],
    references: [groupChatMessages.id],
  }),
  replies: many(groupChatMessages),
  reactions: many(groupMessageReactions), // ← add
  deletedBy: one(users, {
    fields: [groupChatMessages.deletedBy],
    references: [users.id],
  }),
}));
export const groupMessageReactionsRelations = relations(groupMessageReactions, ({ one }) => ({
  message: one(groupChatMessages, {
    fields: [groupMessageReactions.messageId],
    references: [groupChatMessages.id],
  }),
  user: one(users, {
    fields: [groupMessageReactions.userId],
    references: [users.id],
  }),
}));
export const groupMessageReadReceiptsRelations = relations(groupMessageReadReceipts, ({ one }) => ({
  chatRoom: one(groupChatRooms, {
    fields: [groupMessageReadReceipts.groupChatRoomId],
    references: [groupChatRooms.id],
  }),
  user: one(users, {
    fields: [groupMessageReadReceipts.userId],
    references: [users.id],
  }),
  lastReadMessage: one(groupChatMessages, {
    fields: [groupMessageReadReceipts.lastReadMessageId],
    references: [groupChatMessages.id],
  }),
}));

// Social direct chat relations
export const socialConversationsRelations = relations(socialConversations, ({ one, many }) => ({
  messages: many(socialMessages),
  userA: one(users, {
    fields: [socialConversations.userAId],
    references: [users.id],
    relationName: 'conversationUserA',
  }),
  userB: one(users, {
    fields: [socialConversations.userBId],
    references: [users.id],
    relationName: 'conversationUserB',
  }),
}));

export const socialMessagesRelations = relations(socialMessages, ({ one, many }) => ({
  conversation: one(socialConversations, {
    fields: [socialMessages.conversationId],
    references: [socialConversations.id],
  }),
  sender: one(users, {
    fields: [socialMessages.senderId],
    references: [users.id],
  }),
  replyTo: one(socialMessages, {
    fields: [socialMessages.replyToId],
    references: [socialMessages.id],
  }),
  replies: many(socialMessages),
  story: one(stories, {
    fields: [socialMessages.storyId],
    references: [stories.id],
  }),
}));

export const chatModerationActionsRelations = relations(chatModerationActions, ({ one }) => ({
  moderator: one(users, {
    fields: [chatModerationActions.moderatorId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [chatModerationActions.targetUserId],
    references: [users.id],
  }),
}));

export const userNotificationSettingsRelations = relations(userNotificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationSettings.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const adminTasksRelations = relations(adminTasks, ({ one, many }) => ({
  assignedTo: one(users, {
    fields: [adminTasks.assignedTo],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [adminTasks.createdBy],
    references: [users.id],
  }),
  subtasks: many(taskSubtasks),
}));

export const taskSubtasksRelations = relations(taskSubtasks, ({ one }) => ({
  task: one(adminTasks, {
    fields: [taskSubtasks.taskId],
    references: [adminTasks.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const adminReportsRelations = relations(adminReports, ({ one }) => ({
  generatedBy: one(users, {
    fields: [adminReports.generatedBy],
    references: [users.id],
  }),
}));

// New feature relations
export const groupSubscriptionTiersRelations = relations(
  groupSubscriptionTiers,
  ({ one, many }) => ({
    group: one(groups, {
      fields: [groupSubscriptionTiers.groupId],
      references: [groups.id],
    }),
    subscriptions: many(groupSubscriptions),
  })
);

export const groupSubscriptionsRelations = relations(groupSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [groupSubscriptions.userId],
    references: [users.id],
  }),
  group: one(groups, {
    fields: [groupSubscriptions.groupId],
    references: [groups.id],
  }),
  tier: one(groupSubscriptionTiers, {
    fields: [groupSubscriptions.tierId],
    references: [groupSubscriptionTiers.id],
  }),
}));

export const eventGroupLinksRelations = relations(eventGroupLinks, ({ one }) => ({
  event: one(events, {
    fields: [eventGroupLinks.eventId],
    references: [events.id],
  }),
  group: one(groups, {
    fields: [eventGroupLinks.groupId],
    references: [groups.id],
  }),
  createdBy: one(users, {
    fields: [eventGroupLinks.createdBy],
    references: [users.id],
  }),
}));

export const eventAccessControlRelations = relations(eventAccessControl, ({ one }) => ({
  event: one(events, {
    fields: [eventAccessControl.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [eventAccessControl.userId],
    references: [users.id],
  }),
  grantedBy: one(users, {
    fields: [eventAccessControl.grantedBy],
    references: [users.id],
  }),
}));

export const eventFaqsRelations = relations(eventFaqs, ({ one }) => ({
  event: one(events, { fields: [eventFaqs.eventId], references: [events.id] }),
}));

export const eventSponsorsRelations = relations(eventSponsors, ({ one }) => ({
  event: one(events, {
    fields: [eventSponsors.eventId],
    references: [events.id],
  }),
}));

export const eventSpeakersRelations = relations(eventSpeakers, ({ one }) => ({
  event: one(events, {
    fields: [eventSpeakers.eventId],
    references: [events.id],
  }),
}));

export const eventWaitlistRelations = relations(eventWaitlist, ({ one }) => ({
  event: one(events, {
    fields: [eventWaitlist.eventId],
    references: [events.id],
  }),
  user: one(users, { fields: [eventWaitlist.userId], references: [users.id] }),
  ticketTier: one(eventTickets, {
    fields: [eventWaitlist.ticketTierId],
    references: [eventTickets.id],
  }),
}));

export const eventDiscountCodesRelations = relations(eventDiscountCodes, ({ one }) => ({
  event: one(events, {
    fields: [eventDiscountCodes.eventId],
    references: [events.id],
  }),
}));

export const groupCategoriesRelations = relations(groupCategories, ({ many }) => ({
  groups: many(groups),
}));

export const groupTagsRelations = relations(groupTags, ({ one }) => ({
  group: one(groups, { fields: [groupTags.groupId], references: [groups.id] }),
}));

export const groupRulesRelations = relations(groupRules, ({ one }) => ({
  group: one(groups, { fields: [groupRules.groupId], references: [groups.id] }),
}));

export const groupMemberRolesRelations = relations(groupMemberRoles, ({ one }) => ({
  group: one(groups, {
    fields: [groupMemberRoles.groupId],
    references: [groups.id],
  }),
}));

export const groupAnnouncementsRelations = relations(groupAnnouncements, ({ one }) => ({
  group: one(groups, {
    fields: [groupAnnouncements.groupId],
    references: [groups.id],
  }),
  author: one(users, {
    fields: [groupAnnouncements.authorId],
    references: [users.id],
  }),
}));

// Social relations
export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  follower: one(users, {
    fields: [userFollows.followerId],
    references: [users.id],
    relationName: 'follower',
  }),
  following: one(users, {
    fields: [userFollows.followingId],
    references: [users.id],
    relationName: 'following',
  }),
}));

// Shop relations
export const shopProductsRelations = relations(shopProducts, ({ one, many }) => ({
  seller: one(users, {
    fields: [shopProducts.userId],
    references: [users.id],
    relationName: 'shopProductSeller',
  }),
  views: many(shopProductViews),
  postLinks: many(postShopProducts),
  groupLinks: many(groupShopProducts),
}));

// Products linked from a post. Read through postShopProducts rather than from
// posts, so a page of posts resolves its products in one batched query.
export const postShopProductsRelations = relations(postShopProducts, ({ one }) => ({
  post: one(posts, {
    fields: [postShopProducts.postId],
    references: [posts.id],
  }),
  product: one(shopProducts, {
    fields: [postShopProducts.productId],
    references: [shopProducts.id],
  }),
}));

// Products an organizer surfaced on a group. Read through groupShopProducts so
// the group detail query resolves them in one batched pass, like posts do.
export const groupShopProductsRelations = relations(groupShopProducts, ({ one }) => ({
  group: one(groups, {
    fields: [groupShopProducts.groupId],
    references: [groups.id],
  }),
  product: one(shopProducts, {
    fields: [groupShopProducts.productId],
    references: [shopProducts.id],
  }),
}));

export const shopOrdersRelations = relations(shopOrders, ({ one }) => ({
  product: one(shopProducts, {
    fields: [shopOrders.productId],
    references: [shopProducts.id],
  }),
  buyer: one(users, {
    fields: [shopOrders.buyerId],
    references: [users.id],
    relationName: 'shopOrderBuyer',
  }),
  seller: one(users, {
    fields: [shopOrders.sellerId],
    references: [users.id],
    relationName: 'shopOrderSeller',
  }),
}));

export const shopRefundRequestsRelations = relations(shopRefundRequests, ({ one }) => ({
  order: one(shopOrders, {
    fields: [shopRefundRequests.orderId],
    references: [shopOrders.id],
  }),
  buyer: one(users, {
    fields: [shopRefundRequests.buyerId],
    references: [users.id],
    relationName: 'shopRefundBuyer',
  }),
  seller: one(users, {
    fields: [shopRefundRequests.sellerId],
    references: [users.id],
    relationName: 'shopRefundSeller',
  }),
}));

export const shopProductViewsRelations = relations(shopProductViews, ({ one }) => ({
  product: one(shopProducts, {
    fields: [shopProductViews.productId],
    references: [shopProducts.id],
  }),
  viewer: one(users, {
    fields: [shopProductViews.userId],
    references: [users.id],
    relationName: 'shopProductViewer',
  }),
}));

export const pinnedProfilesRelations = relations(pinnedProfiles, ({ one }) => ({
  user: one(users, {
    fields: [pinnedProfiles.userId],
    references: [users.id],
    relationName: 'pinnedByUser',
  }),
  pinnedUser: one(users, {
    fields: [pinnedProfiles.pinnedUserId],
    references: [users.id],
    relationName: 'pinnedUser',
  }),
}));

export const socialProfilesRelations = relations(socialProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [socialProfiles.userId],
    references: [users.id],
  }),
  organizer: one(organizers, {
    fields: [socialProfiles.organizerId],
    references: [organizers.id],
  }),
  wallPosts: many(socialWallPosts),
  views: many(profileViews),
}));

export const socialWallPostsRelations = relations(socialWallPosts, ({ one }) => ({
  author: one(users, {
    fields: [socialWallPosts.authorId],
    references: [users.id],
    relationName: 'wallPostsAuthor',
  }),
  post: one(posts, {
    fields: [socialWallPosts.postId],
    references: [posts.id],
  }),
  profile: one(socialProfiles, {
    fields: [socialWallPosts.profileId],
    references: [socialProfiles.id],
  }),
}));

// Posts relations
export const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, {
    fields: [posts.userId],
    references: [users.id],
  }),
  wallPost: one(socialWallPosts, {
    fields: [posts.wallPostId],
    references: [socialWallPosts.id],
  }),
  likes: many(postLikes),
  comments: many(postComments),
  shares: many(postShares),
  reposts: many(postReposts),
  commented: many(postUserComments),
  saves: many(savedPosts),
  tags: many(postTags),
  hidden: many(userHiddenPosts),
  views: many(postViews),
  pins: many(pinnedPosts),
  collaborators: many(postCollaborators),
}));

export const postCollaboratorsRelations = relations(postCollaborators, ({ one }) => ({
  post: one(posts, { fields: [postCollaborators.postId], references: [posts.id] }),
  collaborator: one(users, { fields: [postCollaborators.collaboratorId], references: [users.id] }),
  invitedBy: one(users, { fields: [postCollaborators.invitedById], references: [users.id] }),
}));

export const postLikesRelations = relations(postLikes, ({ one }) => ({
  post: one(posts, {
    fields: [postLikes.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postLikes.userId],
    references: [users.id],
  }),
}));

export const postCommentsRelations = relations(postComments, ({ one, many }) => ({
  post: one(posts, {
    fields: [postComments.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postComments.userId],
    references: [users.id],
  }),
  parent: one(postComments, {
    fields: [postComments.parentId],
    references: [postComments.id],
    relationName: 'parent',
  }),
  replies: many(postComments, { relationName: 'parent' }),
  likes: many(commentLikes),
}));

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
  comment: one(postComments, {
    fields: [commentLikes.commentId],
    references: [postComments.id],
  }),
  user: one(users, {
    fields: [commentLikes.userId],
    references: [users.id],
  }),
}));

// Stories relations
export const storiesRelations = relations(stories, ({ one, many }) => ({
  user: one(users, {
    fields: [stories.userId],
    references: [users.id],
  }),
  views: many(storyViews),
  likes: many(storyLikes),
  comments: many(storyComments),
  shares: many(storyShares),
  polls: many(storyPolls),
}));

export const storyViewsRelations = relations(storyViews, ({ one }) => ({
  story: one(stories, {
    fields: [storyViews.storyId],
    references: [stories.id],
  }),
  user: one(users, {
    fields: [storyViews.userId],
    references: [users.id],
  }),
}));

export const storyLikesRelations = relations(storyLikes, ({ one }) => ({
  story: one(stories, {
    fields: [storyLikes.storyId],
    references: [stories.id],
  }),
  user: one(users, {
    fields: [storyLikes.userId],
    references: [users.id],
  }),
}));

export const storyCommentsRelations = relations(storyComments, ({ one, many }) => ({
  story: one(stories, {
    fields: [storyComments.storyId],
    references: [stories.id],
  }),
  user: one(users, {
    fields: [storyComments.userId],
    references: [users.id],
  }),
  parent: one(storyComments, {
    fields: [storyComments.parentId],
    references: [storyComments.id],
    relationName: 'storyCommentReplies',
  }),
  replies: many(storyComments, { relationName: 'storyCommentReplies' }),
  likes: many(storyCommentLikes),
}));

export const storyCommentLikesRelations = relations(storyCommentLikes, ({ one }) => ({
  comment: one(storyComments, {
    fields: [storyCommentLikes.commentId],
    references: [storyComments.id],
  }),
  user: one(users, {
    fields: [storyCommentLikes.userId],
    references: [users.id],
  }),
}));

export const storySharesRelations = relations(storyShares, ({ one }) => ({
  story: one(stories, {
    fields: [storyShares.storyId],
    references: [stories.id],
  }),
  user: one(users, {
    fields: [storyShares.userId],
    references: [users.id],
  }),
}));
// Story poll relations
export const storyPollsRelations = relations(storyPolls, ({ one, many }) => ({
  story: one(stories, {
    fields: [storyPolls.storyId],
    references: [stories.id],
  }),
  creator: one(users, {
    fields: [storyPolls.userId],
    references: [users.id],
  }),
  responses: many(storyPollResponses),
}));

export const storyPollResponsesRelations = relations(storyPollResponses, ({ one }) => ({
  poll: one(storyPolls, {
    fields: [storyPollResponses.pollId],
    references: [storyPolls.id],
  }),
  user: one(users, {
    fields: [storyPollResponses.userId],
    references: [users.id],
  }),
}));

// Post view relations
export const postViewsRelations = relations(postViews, ({ one }) => ({
  post: one(posts, {
    fields: [postViews.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postViews.userId],
    references: [users.id],
  }),
}));

// Profile view relations
export const profileViewsRelations = relations(profileViews, ({ one }) => ({
  profile: one(socialProfiles, {
    fields: [profileViews.profileId],
    references: [socialProfiles.id],
  }),
  user: one(users, {
    fields: [profileViews.userId],
    references: [users.id],
  }),
}));

// Profile view session relations
export const profileViewSessionsRelations = relations(profileViewSessions, ({ one }) => ({
  profile: one(socialProfiles, {
    fields: [profileViewSessions.profileId],
    references: [socialProfiles.id],
  }),
  user: one(users, {
    fields: [profileViewSessions.userId],
    references: [users.id],
  }),
}));

// Post shares relations
export const postSharesRelations = relations(postShares, ({ one }) => ({
  post: one(posts, {
    fields: [postShares.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postShares.userId],
    references: [users.id],
  }),
}));

// Post user comments relations (mapping between post and a user's latest comment)
export const postUserCommentsRelations = relations(postUserComments, ({ one }) => ({
  post: one(posts, {
    fields: [postUserComments.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postUserComments.userId],
    references: [users.id],
  }),
}));

// Post reposts relations
export const postRepostsRelations = relations(postReposts, ({ one }) => ({
  post: one(posts, {
    fields: [postReposts.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [postReposts.userId],
    references: [users.id],
  }),
}));

// Saved posts relations
export const savedPostsRelations = relations(savedPosts, ({ one }) => ({
  post: one(posts, {
    fields: [savedPosts.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [savedPosts.userId],
    references: [users.id],
  }),
}));

// User hidden posts relations (needed for relational queries like .with.{post})
export const userHiddenPostsRelations = relations(userHiddenPosts, ({ one }) => ({
  post: one(posts, {
    fields: [userHiddenPosts.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [userHiddenPosts.userId],
    references: [users.id],
  }),
}));

// User blocks relations
export const userBlocksRelations = relations(userBlocks, ({ one }) => ({
  blocker: one(users, {
    fields: [userBlocks.blockerId],
    references: [users.id],
    relationName: 'blocker',
  }),
  blocked: one(users, {
    fields: [userBlocks.blockedId],
    references: [users.id],
    relationName: 'blocked',
  }),
}));

// Event interactions relations
export const eventLikesRelations = relations(eventLikes, ({ one }) => ({
  event: one(events, {
    fields: [eventLikes.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [eventLikes.userId],
    references: [users.id],
  }),
}));

export const discussionsRelations = relations(discussions, ({ one, many }) => ({
  user: one(users, {
    fields: [discussions.userId],
    references: [users.id],
  }),
  group: one(groups, {
    fields: [discussions.groupId],
    references: [groups.id],
  }),
  likes: many(discussionLikes),
  replies: many(discussionReplies),
  subscriptions: many(discussionSubscriptions),
  discussionCategories: many(discussionCategories),
}));

export const discussionLikesRelations = relations(discussionLikes, ({ one }) => ({
  discussion: one(discussions, {
    fields: [discussionLikes.discussionId],
    references: [discussions.id],
  }),
  user: one(users, {
    fields: [discussionLikes.userId],
    references: [users.id],
  }),
}));

export const discussionRepliesRelations = relations(discussionReplies, ({ one, many }) => ({
  discussion: one(discussions, {
    fields: [discussionReplies.discussionId],
    references: [discussions.id],
  }),
  author: one(users, {
    fields: [discussionReplies.userId],
    references: [users.id],
  }),
  parent: one(discussionReplies, {
    fields: [discussionReplies.parentReplyId],
    references: [discussionReplies.id],
    relationName: 'parentReply',
  }),
  childReplies: many(discussionReplies, { relationName: 'parentReply' }),
  likes: many(discussionReplyLikes),
}));

export const discussionReplyLikesRelations = relations(discussionReplyLikes, ({ one }) => ({
  reply: one(discussionReplies, {
    fields: [discussionReplyLikes.replyId],
    references: [discussionReplies.id],
  }),
  user: one(users, {
    fields: [discussionReplyLikes.userId],
    references: [users.id],
  }),
}));

export const discussionSubscriptionsRelations = relations(discussionSubscriptions, ({ one }) => ({
  discussion: one(discussions, {
    fields: [discussionSubscriptions.discussionId],
    references: [discussions.id],
  }),
  user: one(users, {
    fields: [discussionSubscriptions.userId],
    references: [users.id],
  }),
}));

export const discussionCategoriesRelations = relations(discussionCategories, ({ one }) => ({
  discussion: one(discussions, {
    fields: [discussionCategories.discussionId],
    references: [discussions.id],
  }),
  category: one(categories, {
    fields: [discussionCategories.categoryId],
    references: [categories.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  groupTags: many(groupTags),
}));

export const mentionsRelations = relations(mentions, ({ one }) => ({
  mentionedUser: one(users, {
    fields: [mentions.mentionedUserId],
    references: [users.id],
    relationName: 'mentionedUser',
  }),
  mentionedBy: one(users, {
    fields: [mentions.mentionedByUserId],
    references: [users.id],
    relationName: 'mentionedBy',
  }),
}));

// Interest relations
export const interestCategoriesRelations = relations(interestCategories, ({ many }) => ({
  userInterests: many(userInterests),
  postTags: many(postTags),
}));

export const userInterestsRelations = relations(userInterests, ({ one }) => ({
  user: one(users, {
    fields: [userInterests.userId],
    references: [users.id],
  }),
  category: one(interestCategories, {
    fields: [userInterests.categoryId],
    references: [interestCategories.id],
  }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, {
    fields: [postTags.postId],
    references: [posts.id],
  }),
  category: one(interestCategories, {
    fields: [postTags.categoryId],
    references: [interestCategories.id],
  }),
}));

// Username Reservation relations
export const usernameReservationsRelations = relations(usernameReservations, ({ one }) => ({
  reviewedByUser: one(users, {
    fields: [usernameReservations.reviewedBy],
    references: [users.id],
    relationName: 'reviewedByUser',
  }),
}));

export const talentSessionsRelations = relations(talentSessions, ({ one }) => ({
  talentProfile: one(talentProfiles, {
    fields: [talentSessions.talentProfileId],
    references: [talentProfiles.id],
  }),
  booker: one(users, {
    fields: [talentSessions.bookerId],
    references: [users.id],
  }),
}));

export const talentAvailabilityRelations = relations(talentAvailability, ({ one }) => ({
  talentProfile: one(talentProfiles, {
    fields: [talentAvailability.talentProfileId],
    references: [talentProfiles.id],
  }),
}));

export const talentDateOverridesRelations = relations(talentDateOverrides, ({ one }) => ({
  talentProfile: one(talentProfiles, {
    fields: [talentDateOverrides.talentProfileId],
    references: [talentProfiles.id],
  }),
}));

export const talentFavoritesRelations = relations(talentFavorites, ({ one }) => ({
  user: one(users, {
    fields: [talentFavorites.userId],
    references: [users.id],
  }),
  talentProfile: one(talentProfiles, {
    fields: [talentFavorites.talentProfileId],
    references: [talentProfiles.id],
  }),
}));

export const talentProfilesRelations = relations(talentProfiles, ({ one, many }) => ({
  user: one(users, { fields: [talentProfiles.userId], references: [users.id] }),
  sessions: many(talentSessions),
  availability: many(talentAvailability),
  dateOverrides: many(talentDateOverrides),
  favorites: many(talentFavorites),
  socialLinks: one(organizerSocialLinks, {
    fields: [talentProfiles.id],
    references: [organizerSocialLinks.talentProfileId],
  }),
}));

// Group course relations
export const groupCoursesRelations = relations(groupCourses, ({ one, many }) => ({
  group: one(groups, { fields: [groupCourses.groupId], references: [groups.id] }),
  createdBy: one(users, { fields: [groupCourses.createdBy], references: [users.id] }),
  modules: many(groupCourseModules),
  lessons: many(groupCourseLessons),
  enrollments: many(groupCourseEnrollments),
}));

export const groupCourseModulesRelations = relations(groupCourseModules, ({ one, many }) => ({
  course: one(groupCourses, {
    fields: [groupCourseModules.courseId],
    references: [groupCourses.id],
  }),
  lessons: many(groupCourseLessons),
}));

export const groupCourseLessonsRelations = relations(groupCourseLessons, ({ one, many }) => ({
  course: one(groupCourses, {
    fields: [groupCourseLessons.courseId],
    references: [groupCourses.id],
  }),
  module: one(groupCourseModules, {
    fields: [groupCourseLessons.moduleId],
    references: [groupCourseModules.id],
  }),
  attachments: many(groupCourseLessonAttachments),
  progress: many(groupCourseLessonProgress),
}));

export const groupCourseLessonAttachmentsRelations = relations(
  groupCourseLessonAttachments,
  ({ one }) => ({
    lesson: one(groupCourseLessons, {
      fields: [groupCourseLessonAttachments.lessonId],
      references: [groupCourseLessons.id],
    }),
  })
);

export const groupCourseEnrollmentsRelations = relations(
  groupCourseEnrollments,
  ({ one, many }) => ({
    course: one(groupCourses, {
      fields: [groupCourseEnrollments.courseId],
      references: [groupCourses.id],
    }),
    user: one(users, { fields: [groupCourseEnrollments.userId], references: [users.id] }),
    lessonProgress: many(groupCourseLessonProgress),
  })
);

export const groupCourseLessonProgressRelations = relations(
  groupCourseLessonProgress,
  ({ one }) => ({
    enrollment: one(groupCourseEnrollments, {
      fields: [groupCourseLessonProgress.enrollmentId],
      references: [groupCourseEnrollments.id],
    }),
    lesson: one(groupCourseLessons, {
      fields: [groupCourseLessonProgress.lessonId],
      references: [groupCourseLessons.id],
    }),
    user: one(users, { fields: [groupCourseLessonProgress.userId], references: [users.id] }),
  })
);

export const groupResourcesRelations = relations(groupResources, ({ one }) => ({
  group: one(groups, { fields: [groupResources.groupId], references: [groups.id] }),
  createdBy: one(users, { fields: [groupResources.createdBy], references: [users.id] }),
}));

export const talentReviewsRelations = relations(talentReviews, ({ one }) => ({
  talentProfile: one(talentProfiles, {
    fields: [talentReviews.talentProfileId],
    references: [talentProfiles.id],
  }),
  reviewer: one(users, {
    fields: [talentReviews.reviewerId],
    references: [users.id],
  }),
  session: one(talentSessions, {
    fields: [talentReviews.sessionId],
    references: [talentSessions.id],
  }),
  priorityMessage: one(priorityMessagePayments, {
    fields: [talentReviews.priorityMessageId],
    references: [priorityMessagePayments.id],
  }),

   customOffer: one(shopCustomServiceOffers, {
    fields: [talentReviews.shopCustomOfferId],
    references: [shopCustomServiceOffers.id],
  }),
}));

export const talentGiftCodesRelations = relations(talentGiftCodes, ({ one }) => ({
  gifter: one(users, {
    fields: [talentGiftCodes.gifterId],
    references: [users.id],
  }),
  talentProfile: one(talentProfiles, {
    fields: [talentGiftCodes.talentProfileId],
    references: [talentProfiles.id],
  }),
  redeemedSession: one(talentSessions, {
    fields: [talentGiftCodes.redeemedSessionId],
    references: [talentSessions.id],
  }),
}));

export const priorityMessagePaymentsRelations = relations(
  priorityMessagePayments,
  ({ one, many }) => ({
    sender: one(users, {
      fields: [priorityMessagePayments.senderId],
      references: [users.id],
    }),
    talentProfile: one(talentProfiles, {
      fields: [priorityMessagePayments.talentProfileId],
      references: [talentProfiles.id],
    }),
    talentUser: one(users, {
      fields: [priorityMessagePayments.talentUserId],
      references: [users.id],
    }),
    conversation: one(socialConversations, {
      fields: [priorityMessagePayments.conversationId],
      references: [socialConversations.id],
    }),
    items: many(priorityMessageItems),
  })
);
export const priorityMessageItemsRelations = relations(priorityMessageItems, ({ one }) => ({
  payment: one(priorityMessagePayments, {
    fields: [priorityMessageItems.paymentId],
    references: [priorityMessagePayments.id],
  }),
  message: one(socialMessages, {
    fields: [priorityMessageItems.messageId],
    references: [socialMessages.id],
  }),
  replyMessage: one(socialMessages, {
    fields: [priorityMessageItems.replyMessageId],
    references: [socialMessages.id],
  }),
}));

// Users → livestreams they host
export const usersLivestreamRelations = relations(users, ({ many }) => ({
  livestreams: many(livestreams),
}));

// Livestream → host user, reactions, comments, viewers
export const livestreamsRelations = relations(livestreams, ({ one, many }) => ({
  user: one(users, { fields: [livestreams.userId], references: [users.id] }),
  reactions: many(livestreamReactions),
  comments: many(livestreamComments),
  viewers: many(livestreamViewers),
}));

export const livestreamReactionsRelations = relations(livestreamReactions, ({ one }) => ({
  livestream: one(livestreams, {
    fields: [livestreamReactions.livestreamId],
    references: [livestreams.id],
  }),
  user: one(users, { fields: [livestreamReactions.userId], references: [users.id] }),
}));

export const livestreamCommentsRelations = relations(livestreamComments, ({ one }) => ({
  livestream: one(livestreams, {
    fields: [livestreamComments.livestreamId],
    references: [livestreams.id],
  }),
  user: one(users, { fields: [livestreamComments.userId], references: [users.id] }),
}));

export const livestreamViewersRelations = relations(livestreamViewers, ({ one }) => ({
  livestream: one(livestreams, {
    fields: [livestreamViewers.livestreamId],
    references: [livestreams.id],
  }),
  user: one(users, { fields: [livestreamViewers.userId], references: [users.id] }),
}));

// ─── BRITESIDE PLUS RELATIONS ────────────────────────────────────────────────

export const stripeCustomersRelations = relations(stripeCustomers, ({ one }) => ({
  user: one(users, {
    fields: [stripeCustomers.userId],
    references: [users.id],
  }),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
  features: many(subscriptionFeatures),
  subscriptions: many(userSubscriptions),
  auditLogs: many(subscriptionAuditLogs),
}));

export const subscriptionFeaturesRelations = relations(subscriptionFeatures, ({ one }) => ({
  plan: one(subscriptionPlans, {
    fields: [subscriptionFeatures.planId],
    references: [subscriptionPlans.id],
  }),
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({ one, many }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [userSubscriptions.planId],
    references: [subscriptionPlans.id],
  }),
  grantedByUser: one(users, {
    fields: [userSubscriptions.grantedBy],
    references: [users.id],
    relationName: 'grantedSubscriptions',
  }),
  auditLogs: many(subscriptionAuditLogs),
}));

export const subscriptionAuditLogsRelations = relations(subscriptionAuditLogs, ({ one }) => ({
  userSubscription: one(userSubscriptions, {
    fields: [subscriptionAuditLogs.userSubscriptionId],
    references: [userSubscriptions.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [subscriptionAuditLogs.planId],
    references: [subscriptionPlans.id],
  }),
  actor: one(users, {
    fields: [subscriptionAuditLogs.actorId],
    references: [users.id],
  }),
}));

export const groupQuestionsRelations = relations(groupQuestions, ({ one }) => ({
  group: one(groups, {
    fields: [groupQuestions.groupId],
    references: [groups.id],
  }),
}));

export const userSpendsRelations = relations(userSpends, ({ one }) => ({
  user: one(users, { fields: [userSpends.userId], references: [users.id] }),
  event: one(events, { fields: [userSpends.eventId], references: [events.id] }),
  group: one(groups, { fields: [userSpends.groupId], references: [groups.id] }),
  talentUser: one(users, {
    fields: [userSpends.talentUserId],
    references: [users.id],
    relationName: 'userSpendTalentUser',
  }),
}));

// Story collection relations
export const storyCollectionsRelations = relations(storyCollections, ({ one, many }) => ({
  user: one(users, { fields: [storyCollections.userId], references: [users.id] }),
  items: many(storyCollectionItems),
}));

export const storyCollectionItemsRelations = relations(storyCollectionItems, ({ one }) => ({
  collection: one(storyCollections, {
    fields: [storyCollectionItems.collectionId],
    references: [storyCollections.id],
  }),
  story: one(stories, { fields: [storyCollectionItems.storyId], references: [stories.id] }),
  post: one(posts, { fields: [storyCollectionItems.postId], references: [posts.id] }),
}));

// Bio link relations
export const bioLinksRelations = relations(bioLinks, ({ one }) => ({
  user: one(users, { fields: [bioLinks.userId], references: [users.id] }),
}));

// Pinned posts relations
export const pinnedPostsRelations = relations(pinnedPosts, ({ one }) => ({
  post: one(posts, {
    fields: [pinnedPosts.postId],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [pinnedPosts.userId],
    references: [users.id],
  }),
}));

// Analytics event log relations (entityId is polymorphic — no FK/relation)
export const analyticsEventsRelations = relations(analyticsEvents, ({ one }) => ({
  user: one(users, { fields: [analyticsEvents.userId], references: [users.id] }),
}));

export const analyticsIdentityLinksRelations = relations(analyticsIdentityLinks, ({ one }) => ({
  user: one(users, { fields: [analyticsIdentityLinks.userId], references: [users.id] }),
}));

export const postAnalyticsDailyRelations = relations(postAnalyticsDaily, ({ one }) => ({
  post: one(posts, { fields: [postAnalyticsDaily.postId], references: [posts.id] }),
}));

export const groupAnalyticsDailyRelations = relations(groupAnalyticsDaily, ({ one }) => ({
  group: one(groups, { fields: [groupAnalyticsDaily.groupId], references: [groups.id] }),
}));

export const productAnalyticsDailyRelations = relations(productAnalyticsDaily, ({ one }) => ({
  product: one(shopProducts, {
    fields: [productAnalyticsDaily.productId],
    references: [shopProducts.id],
  }),
}));

export const serviceAnalyticsDailyRelations = relations(serviceAnalyticsDaily, ({ one }) => ({
  talentProfile: one(talentProfiles, {
    fields: [serviceAnalyticsDaily.talentProfileId],
    references: [talentProfiles.id],
  }),
}));
