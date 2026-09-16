import { pgTable, index, foreignKey, unique, uuid, varchar, integer, numeric, timestamp, boolean, check, jsonb, text, uniqueIndex, date, type AnyPgColumn, json, smallint, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const collaboratorStatus = pgEnum("collaborator_status", ['pending', 'accepted', 'rejected', 'removed'])
export const courseEnrollmentStatus = pgEnum("course_enrollment_status", ['active', 'completed', 'refunded'])
export const courseStatus = pgEnum("course_status", ['draft', 'published', 'archived'])
export const followerCountRange = pgEnum("follower_count_range", ['10k-50k', '50k-100k', '100k-500k', '500k-1M', '1M-5M', '5M-10M', '10M+'])
export const gender = pgEnum("gender", ['male', 'female', 'other', 'prefer_not_to_say'])
export const groupJoinRequestStatus = pgEnum("group_join_request_status", ['pending', 'approved', 'rejected'])
export const groupMemberStatus = pgEnum("group_member_status", ['joined', 'pending', 'rejected', 'blocked'])
export const groupRole = pgEnum("group_role", ['admin', 'moderator', 'member'])
export const hostedEnum = pgEnum("hosted_enum", ['organizer', 'group'])
export const imageStatus = pgEnum("image_status", ['pending', 'processing', 'published', 'rejected', 'failed'])
export const importStatus = pgEnum("import_status", ['draft', 'pending', 'processing', 'completed', 'failed'])
export const mediaType = pgEnum("media_type", ['image', 'video', 'audio', 'document'])
export const platformNameEnum = pgEnum("platform_name_enum", ['briteside', 'zoom', 'google_meet', 'microsoft_teams', 'webex', 'skype', 'discord', 'twitch', 'youtube_live', 'facebook_live', 'other'])
export const postTabItemType = pgEnum("post_tab_item_type", ['post', 'link'])
export const reportStatus = pgEnum("report_status", ['pending', 'reviewed', 'resolved', 'dismissed'])
export const reportType = pgEnum("report_type", ['user', 'post', 'group', 'event', 'comment', 'social_chat', 'discussion'])
export const shopCustomOfferDeliveryState = pgEnum("shop_custom_offer_delivery_state", ['awaiting_delivery', 'delivered', 'revision_requested'])
export const shopCustomOfferStatus = pgEnum("shop_custom_offer_status", ['pending', 'accepted', 'declined', 'expired', 'withdrawn', 'completed', 'cancelled'])
export const shopListingType = pgEnum("shop_listing_type", ['product', 'course', 'service', 'link'])
export const shopPaymentMode = pgEnum("shop_payment_mode", ['full', 'deposit', 'milestones'])
export const shopServiceBookingStatus = pgEnum("shop_service_booking_status", ['pending', 'accepted', 'declined', 'completed', 'cancelled'])
export const socialPlatform = pgEnum("social_platform", ['Instagram', 'Tiktok', 'YouTube', 'Twitter', 'Facebook', 'LinkedIn', 'Snapchat', 'Twitch', 'Other'])
export const spendType = pgEnum("spend_type", ['ticket_purchase', 'platform_subscription', 'group_subscription', 'talent_session', 'priority_message', 'shop'])
export const storyPollType = pgEnum("story_poll_type", ['poll', 'quiz', 'slider', 'question'])
export const tokensType = pgEnum("tokens_type", ['refresh', 'reset', 'verifyEmail'])
export const usernameReservationStatus = pgEnum("username_reservation_status", ['pending', 'approved', 'rejected'])
export const videoSourceType = pgEnum("video_source_type", ['youtube', 'vimeo', 'upload'])
export const virtualPlatformEnum = pgEnum("virtual_platform_enum", ['briteside', 'zoom', 'google_meet', 'microsoft_teams', 'webex', 'skype', 'discord', 'twitch', 'youtube_live', 'facebook_live', 'other'])
export const wallPostStatus = pgEnum("wall_post_status", ['pending', 'approved', 'rejected'])


export const purchasedMerchandise = pgTable("purchased_merchandise", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	merchandiseCode: varchar("merchandise_code", { length: 50 }).notNull(),
	eventId: uuid("event_id").notNull(),
	merchandiseId: uuid("merchandise_id").notNull(),
	userId: uuid("user_id").notNull(),
	organizerId: uuid("organizer_id").notNull(),
	holderName: varchar("holder_name", { length: 255 }).notNull(),
	holderEmail: varchar("holder_email", { length: 255 }).notNull(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).notNull(),
	totalPrice: numeric("total_price", { precision: 10, scale:  2 }).notNull(),
	status: varchar({ length: 20 }).default('active').notNull(),
	purchasedAt: timestamp("purchased_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	refundAmount: numeric("refund_amount", { precision: 10, scale:  2 }),
}, (table) => [
	index("idx_purchased_merchandise_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_merchandise_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_merchandise_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_purchased_merchandise_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "purchased_merchandise_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.merchandiseId],
			foreignColumns: [eventMerchandise.id],
			name: "purchased_merchandise_merchandise_id_event_merchandise_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "purchased_merchandise_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "purchased_merchandise_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("purchased_merchandise_merchandise_code_unique").on(table.merchandiseCode),
]);

export const userNotificationSettings = pgTable("user_notification_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	eventUpdates: boolean("event_updates").default(true),
	purchaseConfirmation: boolean("purchase_confirmation").default(true),
	eventReminders: boolean("event_reminders").default(true),
	chatMessages: boolean("chat_messages").default(true),
	groupActivities: boolean("group_activities").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	socialUpdates: boolean("social_updates").default(true),
	birthdayNotifications: boolean("birthday_notifications").default(true),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_notification_settings_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_notification_settings_user_id_unique").on(table.userId),
]);

export const orderItems = pgTable("order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	itemType: varchar("item_type", { length: 20 }).notNull(),
	itemId: uuid("item_id").notNull(),
	quantity: integer().default(1).notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	purchasedTicketId: uuid("purchased_ticket_id"),
	purchasedMerchandiseId: uuid("purchased_merchandise_id"),
	purchasedItemIds: jsonb("purchased_item_ids").default([]),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_items_order_id_orders_id_fk"
		}).onDelete("cascade"),
	check("price_check", sql`price >= (0)::numeric`),
	check("quantity_check", sql`quantity > 0`),
]);

export const groupJoinRequests = pgTable("group_join_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	userId: uuid("user_id").notNull(),
	status: groupJoinRequestStatus().default('pending').notNull(),
	message: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	respondedBy: uuid("responded_by"),
	isCompleted: boolean("is_completed").default(false),
	answers: jsonb().default([]).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_join_requests_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.respondedBy],
			foreignColumns: [users.id],
			name: "group_join_requests_responded_by_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_join_requests_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("group_join_requests_group_id_user_id_unique").on(table.groupId, table.userId),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	message: text().notNull(),
	type: varchar({ length: 50 }).notNull(),
	relatedId: uuid("related_id"),
	isRead: boolean("is_read").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	redirectTo: varchar("redirect_to", { length: 255 }),
	metadata: jsonb().default({}),
}, (table) => [
	index("idx_notifications_read").using("btree", table.isRead.asc().nullsLast().op("bool_ops")).where(sql`(is_read = false)`),
	index("idx_notifications_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const refunds = pgTable("refunds", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	reason: text(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
	refundType: varchar("refund_type", { length: 20 }).default('full'),
	refundedItems: jsonb("refunded_items"),
	stripeMeta: jsonb("stripe_meta"),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "refunds_order_id_orders_id_fk"
		}).onDelete("cascade"),
]);

export const userInformation = pgTable("user_information", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "user_information_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userId: uuid("user_id").notNull(),
	googlePlaceId: varchar("google_place_id", { length: 255 }),
	address: text().notNull(),
	latitude: numeric(),
	longitude: numeric(),
	city: varchar({ length: 100 }),
	state: varchar({ length: 100 }),
	country: varchar({ length: 100 }),
	postalCode: varchar("postal_code", { length: 20 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_information_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_user_information_lat_lng").using("btree", table.latitude.asc().nullsLast().op("numeric_ops"), table.longitude.asc().nullsLast().op("numeric_ops")),
	index("idx_user_information_place_id").using("btree", table.googlePlaceId.asc().nullsLast().op("text_ops")),
	index("idx_user_information_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_information_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_information_google_place_id_unique").on(table.googlePlaceId),
	unique("user_information_user_id_unique").on(table.userId),
]);

export const streamCalls = pgTable("stream_calls", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	cid: varchar({ length: 255 }).notNull(),
	type: varchar({ length: 50 }).default('default').notNull(),
	createdByUserId: uuid("created_by_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	backstage: boolean().default(false).notNull(),
	members: jsonb().default([]),
	ongoing: boolean().default(false).notNull(),
	custom: jsonb().default({}),
}, (table) => [
	index("idx_stream_calls_cid").using("btree", table.cid.asc().nullsLast().op("text_ops")),
	index("idx_stream_calls_created_by").using("btree", table.createdByUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_stream_calls_ongoing").using("btree", table.ongoing.asc().nullsLast().op("bool_ops")),
	index("idx_stream_calls_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "stream_calls_created_by_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("stream_calls_cid_unique").on(table.cid),
]);

export const mentions = pgTable("mentions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sourceType: varchar("source_type", { length: 30 }).notNull(),
	sourceId: uuid("source_id").notNull(),
	mentionedUserId: uuid("mentioned_user_id").notNull(),
	mentionedByUserId: uuid("mentioned_by_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_mentions_mentioned_by").using("btree", table.mentionedByUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_mentions_mentioned_user").using("btree", table.mentionedUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_mentions_source").using("btree", table.sourceType.asc().nullsLast().op("text_ops"), table.sourceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.mentionedByUserId],
			foreignColumns: [users.id],
			name: "mentions_mentioned_by_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mentionedUserId],
			foreignColumns: [users.id],
			name: "mentions_mentioned_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const discussionReplyLikes = pgTable("discussion_reply_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	replyId: uuid("reply_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_discussion_reply_likes_reply").using("btree", table.replyId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_discussion_reply_likes_unique").using("btree", table.replyId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_discussion_reply_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.replyId],
			foreignColumns: [discussionReplies.id],
			name: "discussion_reply_likes_reply_id_discussion_replies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "discussion_reply_likes_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const tokens = pgTable("tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	token: text().notNull(),
	userId: uuid("user_id").notNull(),
	tokensType: tokensType("tokens_type").notNull(),
	expires: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tokens_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userReports = pgTable("user_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reporterId: uuid("reporter_id").notNull(),
	type: reportType().notNull(),
	targetUserId: uuid("target_user_id"),
	postId: uuid("post_id"),
	groupId: uuid("group_id"),
	eventId: uuid("event_id"),
	reason: varchar({ length: 255 }).notNull(),
	description: text(),
	metadata: jsonb().default({}),
	evidenceImages: text("evidence_images").array().default([""]),
	status: reportStatus().default('pending'),
	actionTaken: varchar("action_taken", { length: 255 }),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	conversationId: uuid("conversation_id"),
	discussionId: uuid("discussion_id"),
}, (table) => [
	index("idx_reports_discussion").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops")),
	index("idx_reports_reporter").using("btree", table.reporterId.asc().nullsLast().op("uuid_ops")),
	index("idx_reports_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_reports_target_user").using("btree", table.targetUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [socialConversations.id],
			name: "user_reports_conversation_id_social_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "user_reports_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "user_reports_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "user_reports_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "user_reports_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [users.id],
			name: "user_reports_reporter_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "user_reports_reviewed_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [users.id],
			name: "user_reports_target_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const media = pgTable("media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fileHash: varchar("file_hash", { length: 64 }).notNull(),
	s3Key: text("s3_key").notNull(),
	s3Bucket: varchar("s3_bucket", { length: 255 }).notNull(),
	url: text().notNull(),
	mediaType: mediaType("media_type").notNull(),
	mimetype: varchar({ length: 100 }).notNull(),
	extension: varchar({ length: 20 }).notNull(),
	size: integer().notNull(),
	folder: varchar({ length: 100 }).notNull(),
	originalName: varchar("original_name", { length: 255 }),
	properties: jsonb().default({}),
	uploadedBy: uuid("uploaded_by"),
	referenceCount: integer("reference_count").default(0).notNull(),
	lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("media_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("media_hash_idx").using("btree", table.fileHash.asc().nullsLast().op("text_ops")),
	index("media_reference_count_idx").using("btree", table.referenceCount.asc().nullsLast().op("int4_ops")),
	index("media_s3_key_idx").using("btree", table.s3Key.asc().nullsLast().op("text_ops")),
	index("media_type_idx").using("btree", table.mediaType.asc().nullsLast().op("enum_ops")),
	index("media_uploaded_by_idx").using("btree", table.uploadedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "media_uploaded_by_users_id_fk"
		}).onDelete("set null"),
	unique("media_file_hash_unique").on(table.fileHash),
	unique("media_s3_key_unique").on(table.s3Key),
]);

export const tags = pgTable("tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("uq_tags_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
]);

export const postReposts = pgTable("post_reposts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_reposts_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_post_reposts_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_reposts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_reposts_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_reposts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postUserComments = pgTable("post_user_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	commentId: uuid("comment_id"),
	commentedAt: timestamp("commented_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_user_comments_commented_at").using("btree", table.commentedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_post_user_comments_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_post_user_comments_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_user_comments_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.commentId],
			foreignColumns: [postComments.id],
			name: "post_user_comments_comment_id_post_comments_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_user_comments_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_user_comments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const systemSettings = pgTable("system_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	settingKey: varchar("setting_key", { length: 100 }).notNull(),
	settingValue: jsonb("setting_value").notNull(),
	description: text(),
	isPublic: boolean("is_public").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("system_settings_setting_key_unique").on(table.settingKey),
]);

export const groupTags = pgTable("group_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	tagId: uuid("tag_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_tags_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_tags_tag").using("btree", table.tagId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_group_tag").using("btree", table.groupId.asc().nullsLast().op("uuid_ops"), table.tagId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_tags_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [tags.id],
			name: "group_tags_tag_id_tags_id_fk"
		}).onDelete("cascade"),
]);

export const discussionCategories = pgTable("discussion_categories", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "discussion_categories_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	discussionId: uuid("discussion_id").notNull(),
	categoryId: uuid("category_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_discussion_categories_category").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_discussion_categories_discussion").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_discussion_category").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops"), table.categoryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "discussion_categories_category_id_categories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "discussion_categories_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
]);

export const discussionSubscriptions = pgTable("discussion_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	discussionId: uuid("discussion_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_discussion_subscriptions_discussion").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_discussion_subscriptions_unique").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_discussion_subscriptions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "discussion_subscriptions_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "discussion_subscriptions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const ticketScans = pgTable("ticket_scans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: uuid("ticket_id").notNull(),
	eventId: uuid("event_id").notNull(),
	organizerId: uuid("organizer_id").notNull(),
	scannedBy: uuid("scanned_by"),
	ticketCode: varchar("ticket_code", { length: 50 }).notNull(),
	eventCode: varchar("event_code", { length: 50 }).notNull(),
	organizerCode: varchar("organizer_code", { length: 50 }).notNull(),
	scanType: varchar("scan_type", { length: 20 }).default('entry').notNull(),
	scanLocation: text("scan_location"),
	isValid: boolean("is_valid").default(true).notNull(),
	scanData: text("scan_data"),
	scannedAt: timestamp("scanned_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	sessionId: uuid("session_id"),
	deviceInfo: jsonb("device_info").default({}),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	scannedByTeamMember: uuid("scanned_by_team_member"),
}, (table) => [
	index("idx_ticket_scans_codes").using("btree", table.ticketCode.asc().nullsLast().op("text_ops"), table.eventCode.asc().nullsLast().op("text_ops")),
	index("idx_ticket_scans_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_scans_member").using("btree", table.scannedBy.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_scans_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_scans_team_member").using("btree", table.scannedByTeamMember.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_scans_ticket").using("btree", table.ticketId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.scannedBy],
			foreignColumns: [organizerMembers.id],
			name: "ticket_scans_scanned_by_organizer_members_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.scannedByTeamMember],
			foreignColumns: [eventTeamMembers.id],
			name: "ticket_scans_scanned_by_team_member_event_team_members_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [scanSessions.id],
			name: "ticket_scans_session_id_scan_sessions_id_fk"
		}),
]);

export const sessions = pgTable("sessions", {
	sessionToken: text("session_token").primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	expires: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	roleId: uuid("role_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "user_roles_role_id_roles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const roles = pgTable("roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	description: text(),
	permissions: jsonb().default([]),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("roles_name_unique").on(table.name),
]);

export const userPreferences = pgTable("user_preferences", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	categoryId: uuid("category_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "user_preferences_category_id_categories_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_preferences_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const organizerMembers = pgTable("organizer_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id").notNull(),
	memberCode: varchar("member_code", { length: 50 }).notNull(),
	memberName: varchar("member_name", { length: 100 }).notNull(),
	memberPassword: varchar("member_password", { length: 255 }).notNull(),
	role: varchar({ length: 50 }).default('scanner').notNull(),
	permissions: text().array().default(["scan_tickets"]),
	isActive: boolean("is_active").default(true).notNull(),
	totalScans: integer("total_scans").default(0).notNull(),
	lastScanAt: timestamp("last_scan_at", { withTimezone: true, mode: 'string' }),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_organizer_members_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_organizer_members_code").using("btree", table.memberCode.asc().nullsLast().op("text_ops")),
	index("idx_organizer_members_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "organizer_members_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	unique("organizer_members_member_code_unique").on(table.memberCode),
]);

export const eventMerchandise = pgTable("event_merchandise", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	imageUrl: text("image_url"),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	quantityAvailable: integer("quantity_available").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_merchandise_event_id_events_id_fk"
		}).onDelete("cascade"),
	check("price_check", sql`price >= (0)::numeric`),
	check("quantity_check", sql`quantity_available >= 0`),
]);

export const eventAttendees = pgTable("event_attendees", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	orderId: uuid("order_id"),
	ticketTierId: uuid("ticket_tier_id"),
	status: varchar({ length: 20 }).default('registered').notNull(),
	checkInMethod: varchar("check_in_method", { length: 20 }),
	checkedInBy: uuid("checked_in_by"),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	checkedInByMember: uuid("checked_in_by_member"),
	checkInDeviceInfo: jsonb("check_in_device_info").default({}),
	checkedInByTeamMember: uuid("checked_in_by_team_member"),
}, (table) => [
	index("idx_event_attendees_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_attendees_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.checkedInByMember],
			foreignColumns: [organizerMembers.id],
			name: "event_attendees_checked_in_by_member_organizer_members_id_fk"
		}),
	foreignKey({
			columns: [table.checkedInBy],
			foreignColumns: [users.id],
			name: "event_attendees_checked_in_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_attendees_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "event_attendees_order_id_orders_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ticketTierId],
			foreignColumns: [eventTickets.id],
			name: "event_attendees_ticket_tier_id_event_tickets_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_attendees_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("event_attendees_event_id_user_id_unique").on(table.eventId, table.userId),
]);

export const paymentMethods = pgTable("payment_methods", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	methodType: varchar("method_type", { length: 50 }).notNull(),
	provider: varchar({ length: 50 }).notNull(),
	details: jsonb().notNull(),
	isDefault: boolean("is_default").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "payment_methods_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const discussions = pgTable("discussions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text().notNull(),
	userId: uuid("user_id").notNull(),
	groupId: uuid("group_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	mediaUrls: text("media_urls").array(),
	metadata: jsonb(),
	sharesCount: integer("shares_count").default(0).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "discussions_group_id_groups_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "discussions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const socialMessages = pgTable("social_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	senderId: uuid("sender_id").notNull(),
	messageType: varchar("message_type", { length: 20 }).default('text').notNull(),
	content: text(),
	replyToId: uuid("reply_to_id"),
	metadata: jsonb().default({}),
	isSeen: boolean("is_seen").default(false).notNull(),
	seenAt: timestamp("seen_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by").notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	storyId: uuid("story_id"),
	postId: uuid("post_id"),
	isPriority: boolean("is_priority").default(false).notNull(),
}, (table) => [
	index("idx_social_messages_conv_created").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("idx_social_messages_conversation").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops")),
	index("idx_social_messages_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_social_messages_is_priority").using("btree", table.isPriority.asc().nullsLast().op("bool_ops")),
	index("idx_social_messages_is_seen").using("btree", table.isSeen.asc().nullsLast().op("bool_ops")),
	index("idx_social_messages_reply").using("btree", table.replyToId.asc().nullsLast().op("uuid_ops")),
	index("idx_social_messages_sender").using("btree", table.senderId.asc().nullsLast().op("uuid_ops")),
	index("idx_social_messages_type").using("btree", table.messageType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [socialConversations.id],
			name: "social_messages_conversation_id_social_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "social_messages_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "social_messages_post_id_posts_id_fk"
		}),
	foreignKey({
			columns: [table.replyToId],
			foreignColumns: [table.id],
			name: "social_messages_reply_to_id_social_messages_id_fk"
		}),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "social_messages_sender_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "social_messages_story_id_stories_id_fk"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "social_messages_updated_by_users_id_fk"
		}).onDelete("cascade"),
]);

export const purchasedTickets = pgTable("purchased_tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketCode: varchar("ticket_code", { length: 50 }).notNull(),
	eventId: uuid("event_id").notNull(),
	ticketTierId: uuid("ticket_tier_id").notNull(),
	userId: uuid("user_id").notNull(),
	organizerId: uuid("organizer_id").notNull(),
	holderName: varchar("holder_name", { length: 255 }).notNull(),
	holderEmail: varchar("holder_email", { length: 255 }),
	holderPhone: varchar("holder_phone", { length: 20 }),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	qrCode: text("qr_code").notNull(),
	qrCodeUrl: text("qr_code_url"),
	status: varchar({ length: 20 }).default('active').notNull(),
	isUsed: boolean("is_used").default(false).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	usedBy: uuid("used_by"),
	scanCount: integer("scan_count").default(0).notNull(),
	lastScannedAt: timestamp("last_scanned_at", { withTimezone: true, mode: 'string' }),
	firstScannedAt: timestamp("first_scanned_at", { withTimezone: true, mode: 'string' }),
	scanHistory: jsonb("scan_history").default([]),
	transferredTo: uuid("transferred_to"),
	transferredAt: timestamp("transferred_at", { withTimezone: true, mode: 'string' }),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	refundAmount: numeric("refund_amount", { precision: 10, scale:  2 }),
	purchasedAt: timestamp("purchased_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	qrImageS3Key: text("qr_image_s3_key"),
	eventScheduleId: uuid("event_schedule_id"),
	trackingLinkId: uuid("tracking_link_id"),
	snsSubscriptionArn: varchar("sns_subscription_arn", { length: 512 }),
}, (table) => [
	index("idx_purchased_tickets_code").using("btree", table.ticketCode.asc().nullsLast().op("text_ops")),
	index("idx_purchased_tickets_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_tickets_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_tickets_phone").using("btree", table.holderPhone.asc().nullsLast().op("text_ops")),
	index("idx_purchased_tickets_scanned_at").using("btree", table.lastScannedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_purchased_tickets_schedule").using("btree", table.eventScheduleId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_tickets_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_purchased_tickets_tier").using("btree", table.ticketTierId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_tickets_tracking_link").using("btree", table.trackingLinkId.asc().nullsLast().op("uuid_ops")),
	index("idx_purchased_tickets_used").using("btree", table.isUsed.asc().nullsLast().op("bool_ops")),
	index("idx_purchased_tickets_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "purchased_tickets_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.eventScheduleId],
			foreignColumns: [eventSchedules.id],
			name: "purchased_tickets_event_schedule_id_event_schedules_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "purchased_tickets_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ticketTierId],
			foreignColumns: [eventTickets.id],
			name: "purchased_tickets_ticket_tier_id_event_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.trackingLinkId],
			foreignColumns: [trackingLinks.id],
			name: "purchased_tickets_tracking_link_id_tracking_links_id_fk"
		}),
	foreignKey({
			columns: [table.transferredTo],
			foreignColumns: [users.id],
			name: "purchased_tickets_transferred_to_users_id_fk"
		}),
	foreignKey({
			columns: [table.usedBy],
			foreignColumns: [organizerMembers.id],
			name: "purchased_tickets_used_by_organizer_members_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "purchased_tickets_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("purchased_tickets_ticket_code_unique").on(table.ticketCode),
]);

export const groupMembers = pgTable("group_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: groupRole().default('member').notNull(),
	status: groupMemberStatus().default('joined').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_members_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_members_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_group_members_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_members_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_members_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("group_members_group_id_user_id_unique").on(table.groupId, table.userId),
]);

export const eventMedia = pgTable("event_media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	uploaderId: uuid("uploader_id").notNull(),
	mediaUrl: text("media_url").notNull(),
	mediaType: varchar("media_type", { length: 50 }).notNull(),
	caption: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_media_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaderId],
			foreignColumns: [users.id],
			name: "event_media_uploader_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventInvitations = pgTable("event_invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	inviterId: uuid("inviter_id").notNull(),
	inviteeId: uuid("invitee_id").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	invitedAt: timestamp("invited_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_invitations_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_invitations_invitee").using("btree", table.inviteeId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_invitations_inviter").using("btree", table.inviterId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_invitations_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_invitations_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.inviteeId],
			foreignColumns: [users.id],
			name: "event_invitations_invitee_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.inviterId],
			foreignColumns: [users.id],
			name: "event_invitations_inviter_id_users_id_fk"
		}).onDelete("cascade"),
	unique("event_invitations_event_id_invitee_id_unique").on(table.eventId, table.inviteeId),
]);

export const eventReviews = pgTable("event_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	ticketId: uuid("ticket_id"),
	overallRating: integer("overall_rating").notNull(),
	venueRating: integer("venue_rating"),
	organizationRating: integer("organization_rating"),
	valueRating: integer("value_rating"),
	title: varchar({ length: 200 }),
	comment: text(),
	isVerifiedAttendee: boolean("is_verified_attendee").default(false).notNull(),
	isAnonymous: boolean("is_anonymous").default(false).notNull(),
	helpfulCount: integer("helpful_count").default(0).notNull(),
	isModerated: boolean("is_moderated").default(false).notNull(),
	moderatedAt: timestamp("moderated_at", { withTimezone: true, mode: 'string' }),
	moderatedBy: uuid("moderated_by"),
	moderationReason: text("moderation_reason"),
	tags: jsonb().default([]),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_reviews_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_reviews_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_reviews_event_rating").using("btree", table.eventId.asc().nullsLast().op("int4_ops"), table.overallRating.asc().nullsLast().op("uuid_ops")),
	index("idx_event_reviews_event_verified").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.isVerifiedAttendee.asc().nullsLast().op("uuid_ops")),
	index("idx_event_reviews_helpful").using("btree", table.helpfulCount.asc().nullsLast().op("int4_ops")),
	index("idx_event_reviews_rating").using("btree", table.overallRating.asc().nullsLast().op("int4_ops")),
	index("idx_event_reviews_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_reviews_verified").using("btree", table.isVerifiedAttendee.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_reviews_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moderatedBy],
			foreignColumns: [users.id],
			name: "event_reviews_moderated_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [purchasedTickets.id],
			name: "event_reviews_ticket_id_purchased_tickets_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_reviews_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_event_user_review").on(table.eventId, table.userId),
	check("organization_rating_check", sql`(organization_rating IS NULL) OR ((organization_rating >= 1) AND (organization_rating <= 5))`),
	check("overall_rating_check", sql`(overall_rating >= 1) AND (overall_rating <= 5)`),
	check("value_rating_check", sql`(value_rating IS NULL) OR ((value_rating >= 1) AND (value_rating <= 5))`),
	check("venue_rating_check", sql`(venue_rating IS NULL) OR ((venue_rating >= 1) AND (venue_rating <= 5))`),
]);

export const organizerReviews = pgTable("organizer_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id").notNull(),
	userId: uuid("user_id").notNull(),
	eventId: uuid("event_id"),
	overallRating: integer("overall_rating").notNull(),
	communicationRating: integer("communication_rating"),
	professionalismRating: integer("professionalism_rating"),
	title: varchar({ length: 200 }),
	comment: text(),
	isVerifiedAttendee: boolean("is_verified_attendee").default(false).notNull(),
	isAnonymous: boolean("is_anonymous").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_organizer_reviews_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_organizer_reviews_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_organizer_reviews_rating").using("btree", table.overallRating.asc().nullsLast().op("int4_ops")),
	index("idx_organizer_reviews_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "organizer_reviews_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "organizer_reviews_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "organizer_reviews_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_organizer_user_review").on(table.organizerId, table.userId),
	check("communication_rating_check", sql`(communication_rating IS NULL) OR ((communication_rating >= 1) AND (communication_rating <= 5))`),
	check("overall_rating_check", sql`(overall_rating >= 1) AND (overall_rating <= 5)`),
	check("professionalism_rating_check", sql`(professionalism_rating IS NULL) OR ((professionalism_rating >= 1) AND (professionalism_rating <= 5))`),
]);

export const reviewHelpfulness = pgTable("review_helpfulness", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reviewId: uuid("review_id").notNull(),
	userId: uuid("user_id").notNull(),
	isHelpful: boolean("is_helpful").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_review_helpfulness_review").using("btree", table.reviewId.asc().nullsLast().op("uuid_ops")),
	index("idx_review_helpfulness_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewId],
			foreignColumns: [eventReviews.id],
			name: "review_helpfulness_review_id_event_reviews_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "review_helpfulness_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_review_user_helpful").on(table.reviewId, table.userId),
]);

export const organizers = pgTable("organizers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerCode: varchar("organizer_code", { length: 50 }).notNull(),
	userId: uuid("user_id").notNull(),
	businessName: varchar("business_name", { length: 255 }),
	businessDescription: text("business_description"),
	businessType: varchar("business_type", { length: 50 }),
	logoUrl: text("logo_url"),
	websiteUrl: text("website_url"),
	contactEmail: varchar("contact_email", { length: 255 }),
	contactPhone: varchar("contact_phone", { length: 50 }),
	businessAddress: text("business_address"),
	taxId: varchar("tax_id", { length: 100 }),
	stripeAccountId: varchar("stripe_account_id", { length: 255 }),
	bankAccountInfo: jsonb("bank_account_info"),
	isVerified: boolean("is_verified").default(false),
	rating: numeric({ precision: 3, scale:  2 }).default('0'),
	totalEvents: integer("total_events").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	coverImageUrl: text("cover_image_url").array(),
	specialities: text().array(),
	about: varchar({ length: 500 }),
	country: varchar({ length: 2 }).default('US'),
	showTicketsSold: boolean("show_tickets_sold").default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "organizers_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("organizers_organizer_code_unique").on(table.organizerCode),
	unique("organizers_user_id_unique").on(table.userId),
]);

export const groupCategories = pgTable("group_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	iconUrl: text("icon_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	emoji: varchar({ length: 10 }),
});

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	iconUrl: text("icon_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	emoji: varchar({ length: 10 }),
});

export const venues = pgTable("venues", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	googlePlaceId: varchar("google_place_id", { length: 255 }),
	address: text().notNull(),
	latitude: numeric({ precision: 10, scale:  8 }),
	longitude: numeric({ precision: 11, scale:  8 }),
	city: varchar({ length: 100 }),
	state: varchar({ length: 100 }),
	country: varchar({ length: 100 }),
	postalCode: varchar("postal_code", { length: 20 }),
	websiteUrl: text("website_url"),
	isVerified: boolean("is_verified").default(false),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	countryCode: varchar("country_code", { length: 10 }),
}, (table) => [
	index("idx_venues_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("idx_venues_google_place").using("btree", table.googlePlaceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "venues_created_by_users_id_fk"
		}).onDelete("cascade"),
	unique("venues_google_place_id_unique").on(table.googlePlaceId),
]);

export const eventSchedules = pgTable("event_schedules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	startTime: timestamp("start_time", { withTimezone: true, mode: 'string' }).notNull(),
	endTime: timestamp("end_time", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	date: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	duration: integer().notNull(),
	ticketsSold: integer("tickets_sold").default(0).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_event_schedules_date").using("btree", table.date.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_schedules_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_schedules_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_schedules_start_time").using("btree", table.startTime.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_schedules_event_id_events_id_fk"
		}).onDelete("cascade"),
	check("end_time_check", sql`end_time > start_time`),
	check("tickets_sold_check", sql`tickets_sold >= 0`),
]);

export const eventTickets = pgTable("event_tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketCode: varchar("ticket_code", { length: 50 }).notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	price: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	quantityAvailable: integer("quantity_available").default(0).notNull(),
	quantitySold: integer("quantity_sold").default(0).notNull(),
	salesStart: timestamp("sales_start", { withTimezone: true, mode: 'string' }).notNull(),
	salesEnd: timestamp("sales_end", { withTimezone: true, mode: 'string' }).notNull(),
	minTicketsPerOrder: integer("min_tickets_per_order").default(1),
	maxTicketsPerOrder: integer("max_tickets_per_order"),
	qrCodeSecret: varchar("qr_code_secret", { length: 255 }),
	qrCodeUrl: text("qr_code_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	doorSalePrice: numeric("door_sale_price", { precision: 10, scale:  2 }),
	groupDealSize: integer("group_deal_size"),
	saleDiscountPercent: numeric("sale_discount_percent", { precision: 5, scale:  2 }),
	saleStartDate: timestamp("sale_start_date", { withTimezone: true, mode: 'string' }),
	saleEndDate: timestamp("sale_end_date", { withTimezone: true, mode: 'string' }),
	isSaleActive: boolean("is_sale_active").default(false).notNull(),
}, (table) => [
	index("idx_event_tickets_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_tickets_sales").using("btree", table.salesStart.asc().nullsLast().op("timestamptz_ops"), table.salesEnd.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_tickets_event_id_events_id_fk"
		}).onDelete("cascade"),
	unique("event_tickets_ticket_code_unique").on(table.ticketCode),
	check("group_deal_size_check", sql`(group_deal_size IS NULL) OR (group_deal_size >= 2)`),
	check("max_tickets_check", sql`(max_tickets_per_order IS NULL) OR (max_tickets_per_order >= min_tickets_per_order)`),
	check("min_tickets_check", sql`min_tickets_per_order >= 1`),
	check("price_check", sql`price >= (0)::numeric`),
	check("quantity_check", sql`quantity_available >= 0`),
	check("sale_discount_check", sql`(sale_discount_percent IS NULL) OR ((sale_discount_percent > (0)::numeric) AND (sale_discount_percent <= (60)::numeric))`),
	check("sales_end_check", sql`sales_end > sales_start`),
]);

export const discussionReplies = pgTable("discussion_replies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	content: text().notNull(),
	discussionId: uuid("discussion_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	parentReplyId: uuid("parent_reply_id"),
	likesCount: integer("likes_count").default(0).notNull(),
	repliesCount: integer("replies_count").default(0).notNull(),
}, (table) => [
	index("idx_discussion_replies_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_discussion_replies_discussion").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops")),
	index("idx_discussion_replies_parent").using("btree", table.parentReplyId.asc().nullsLast().op("uuid_ops")),
	index("idx_discussion_replies_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "discussion_replies_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentReplyId],
			foreignColumns: [table.id],
			name: "discussion_replies_parent_reply_id_discussion_replies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "discussion_replies_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventAnalytics = pgTable("event_analytics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	date: date().notNull(),
	pageViews: integer("page_views").default(0),
	uniqueVisitors: integer("unique_visitors").default(0),
	ticketsSold: integer("tickets_sold").default(0),
	revenue: numeric({ precision: 10, scale:  2 }).default('0'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_analytics_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const groupEventPromotions = pgTable("group_event_promotions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	eventId: uuid("event_id").notNull(),
	promotedBy: uuid("promoted_by").notNull(),
	message: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "group_event_promotions_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_event_promotions_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.promotedBy],
			foreignColumns: [users.id],
			name: "group_event_promotions_promoted_by_users_id_fk"
		}).onDelete("cascade"),
]);

export const postComments = pgTable("post_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	parentId: uuid("parent_id"),
	content: text().notNull(),
	likesCount: integer("likes_count").default(0).notNull(),
	repliesCount: integer("replies_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_comments_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_post_comments_parent").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_comments_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_comments_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "post_comments_parent_id_post_comments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_comments_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_comments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const commentLikes = pgTable("comment_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	commentId: uuid("comment_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_comment_likes_comment").using("btree", table.commentId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_comment_likes_unique").using("btree", table.commentId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_comment_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.commentId],
			foreignColumns: [postComments.id],
			name: "comment_likes_comment_id_post_comments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "comment_likes_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postLikes = pgTable("post_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_likes_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_post_likes_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_likes_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_likes_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postShares = pgTable("post_shares", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	caption: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_shares_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_post_shares_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_shares_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_shares_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_shares_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postTags = pgTable("post_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	categoryId: uuid("category_id").notNull(),
	confidence: integer().default(100).notNull(),
	source: varchar({ length: 20 }).default('manual').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_tags_category").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_tags_confidence").using("btree", table.confidence.asc().nullsLast().op("int4_ops")),
	index("idx_post_tags_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_tags_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_post_tags_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.categoryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [interestCategories.id],
			name: "post_tags_category_id_interest_categories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_tags_post_id_posts_id_fk"
		}).onDelete("cascade"),
]);

export const savedPosts = pgTable("saved_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_saved_posts_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_saved_posts_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_saved_posts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "saved_posts_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "saved_posts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const socialConversations = pgTable("social_conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userAId: uuid("user_a_id").notNull(),
	userBId: uuid("user_b_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by").notNull(),
	updatedBy: uuid("updated_by"),
	organizerUserId: uuid("organizer_user_id"),
	conversationType: varchar("conversation_type", { length: 20 }).default('social').notNull(),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_social_conversations_last_message_at").using("btree", table.lastMessageAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_social_conversations_type").using("btree", table.conversationType.asc().nullsLast().op("text_ops")),
	index("idx_social_conversations_user_a").using("btree", table.userAId.asc().nullsLast().op("uuid_ops")),
	index("idx_social_conversations_user_b").using("btree", table.userBId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "social_conversations_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerUserId],
			foreignColumns: [users.id],
			name: "social_conversations_organizer_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "social_conversations_updated_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userAId],
			foreignColumns: [users.id],
			name: "social_conversations_user_a_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userBId],
			foreignColumns: [users.id],
			name: "social_conversations_user_b_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyViews = pgTable("story_views", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storyId: uuid("story_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_story_views_story").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_story_views_unique").using("btree", table.storyId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_views_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_views_story_id_stories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_views_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userBlocks = pgTable("user_blocks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	blockerId: uuid("blocker_id").notNull(),
	blockedId: uuid("blocked_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_blocks_blocked").using("btree", table.blockedId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_blocks_blocker").using("btree", table.blockerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_user_blocks_unique").using("btree", table.blockerId.asc().nullsLast().op("uuid_ops"), table.blockedId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.blockedId],
			foreignColumns: [users.id],
			name: "user_blocks_blocked_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.blockerId],
			foreignColumns: [users.id],
			name: "user_blocks_blocker_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userFollows = pgTable("user_follows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	followerId: uuid("follower_id").notNull(),
	followingId: uuid("following_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_follows_follower").using("btree", table.followerId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_follows_following").using("btree", table.followingId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_user_follows_unique").using("btree", table.followerId.asc().nullsLast().op("uuid_ops"), table.followingId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.followerId],
			foreignColumns: [users.id],
			name: "user_follows_follower_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.followingId],
			foreignColumns: [users.id],
			name: "user_follows_following_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userInterests = pgTable("user_interests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	categoryId: uuid("category_id").notNull(),
	intensity: integer().default(50).notNull(),
	isVisible: boolean("is_visible").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_interests_category").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_interests_intensity").using("btree", table.intensity.asc().nullsLast().op("int4_ops")),
	uniqueIndex("idx_user_interests_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_interests_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_interests_visible").using("btree", table.isVisible.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [interestCategories.id],
			name: "user_interests_category_id_interest_categories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_interests_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const chatModerationActions = pgTable("chat_moderation_actions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	chatRoomId: uuid("chat_room_id").notNull(),
	chatRoomType: varchar("chat_room_type", { length: 10 }).notNull(),
	moderatorId: uuid("moderator_id").notNull(),
	targetUserId: uuid("target_user_id"),
	targetMessageId: uuid("target_message_id"),
	actionType: varchar("action_type", { length: 20 }).notNull(),
	reason: text(),
	duration: integer(),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_moderation_actions_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_moderation_actions_moderator").using("btree", table.moderatorId.asc().nullsLast().op("uuid_ops")),
	index("idx_moderation_actions_room").using("btree", table.chatRoomId.asc().nullsLast().op("uuid_ops"), table.chatRoomType.asc().nullsLast().op("text_ops")),
	index("idx_moderation_actions_target_user").using("btree", table.targetUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.moderatorId],
			foreignColumns: [users.id],
			name: "chat_moderation_actions_moderator_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [users.id],
			name: "chat_moderation_actions_target_user_id_users_id_fk"
		}),
]);

export const eventChatRooms = pgTable("event_chat_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 255 }).default('Event Chat'),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	maxParticipants: integer("max_participants").default(1000),
	messageRetentionDays: integer("message_retention_days").default(30),
	settings: jsonb().default({"allowLinks":true,"allowMedia":true,"moderationEnabled":false}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_chat_rooms_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_event_chat_rooms_event_id").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_chat_rooms_event_id_events_id_fk"
		}).onDelete("cascade"),
	unique("event_chat_rooms_event_id_unique").on(table.eventId),
]);

export const eventChatMessages = pgTable("event_chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventChatRoomId: uuid("event_chat_room_id").notNull(),
	senderId: uuid("sender_id").notNull(),
	content: text().notNull(),
	messageType: varchar("message_type", { length: 20 }).default('text').notNull(),
	replyToId: uuid("reply_to_id"),
	metadata: jsonb().default({}),
	isEdited: boolean("is_edited").default(false).notNull(),
	editedAt: timestamp("edited_at", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	deletedBy: uuid("deleted_by"),
	isPinned: boolean("is_pinned").default(false).notNull(),
	pinnedBy: uuid("pinned_by"),
	pinnedAt: timestamp("pinned_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_chat_messages_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_chat_messages_deleted").using("btree", table.isDeleted.asc().nullsLast().op("bool_ops")),
	index("idx_event_chat_messages_pinned").using("btree", table.isPinned.asc().nullsLast().op("bool_ops")),
	index("idx_event_chat_messages_reply").using("btree", table.replyToId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_chat_messages_room").using("btree", table.eventChatRoomId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_chat_messages_room_created").using("btree", table.eventChatRoomId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("idx_event_chat_messages_sender").using("btree", table.senderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.deletedBy],
			foreignColumns: [users.id],
			name: "event_chat_messages_deleted_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.eventChatRoomId],
			foreignColumns: [eventChatRooms.id],
			name: "event_chat_messages_event_chat_room_id_event_chat_rooms_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.pinnedBy],
			foreignColumns: [users.id],
			name: "event_chat_messages_pinned_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.replyToId],
			foreignColumns: [table.id],
			name: "event_chat_messages_reply_to_id_event_chat_messages_id_fk"
		}),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "event_chat_messages_sender_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventChatParticipants = pgTable("event_chat_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventChatRoomId: uuid("event_chat_room_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: varchar({ length: 20 }).default('participant').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: 'string' }),
	isMuted: boolean("is_muted").default(false).notNull(),
	mutedUntil: timestamp("muted_until", { withTimezone: true, mode: 'string' }),
	mutedBy: uuid("muted_by"),
}, (table) => [
	index("idx_event_chat_participants_active").using("btree", table.lastActiveAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_chat_participants_role").using("btree", table.role.asc().nullsLast().op("text_ops")),
	index("idx_event_chat_participants_room").using("btree", table.eventChatRoomId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_chat_participants_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.mutedBy],
			foreignColumns: [users.id],
			name: "event_chat_participants_muted_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_chat_participants_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_event_chat_participant").on(table.eventChatRoomId, table.userId),
]);

export const eventMessageReactions = pgTable("event_message_reactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	messageId: uuid("message_id").notNull(),
	userId: uuid("user_id").notNull(),
	emoji: varchar({ length: 10 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_message_reactions_emoji").using("btree", table.emoji.asc().nullsLast().op("text_ops")),
	index("idx_message_reactions_message").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
	index("idx_message_reactions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [eventChatMessages.id],
			name: "event_message_reactions_message_id_event_chat_messages_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_message_reactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventMessageReadReceipts = pgTable("event_message_read_receipts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventChatRoomId: uuid("event_chat_room_id").notNull(),
	userId: uuid("user_id").notNull(),
	lastReadMessageId: uuid("last_read_message_id"),
	lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	unreadCount: integer("unread_count").default(0).notNull(),
}, (table) => [
	index("idx_event_read_receipts_room").using("btree", table.eventChatRoomId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_read_receipts_unread").using("btree", table.unreadCount.asc().nullsLast().op("int4_ops")),
	index("idx_event_read_receipts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_message_read_receipts_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_event_read_receipt").on(table.eventChatRoomId, table.userId),
]);

export const groupChatRooms = pgTable("group_chat_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	name: varchar({ length: 255 }).default('Group Chat'),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	settings: jsonb().default({"allowLinks":true,"allowMedia":true}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_group_chat_rooms_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_group_chat_rooms_group_id").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_chat_rooms_group_id_groups_id_fk"
		}).onDelete("cascade"),
	unique("group_chat_rooms_group_id_unique").on(table.groupId),
]);

export const groupChatMessages = pgTable("group_chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupChatRoomId: uuid("group_chat_room_id").notNull(),
	senderId: uuid("sender_id").notNull(),
	content: text().notNull(),
	messageType: varchar("message_type", { length: 20 }).default('text').notNull(),
	replyToId: uuid("reply_to_id"),
	metadata: jsonb().default({}),
	isEdited: boolean("is_edited").default(false).notNull(),
	editedAt: timestamp("edited_at", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	deletedBy: uuid("deleted_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_group_chat_messages_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_group_chat_messages_deleted").using("btree", table.isDeleted.asc().nullsLast().op("bool_ops")),
	index("idx_group_chat_messages_reply").using("btree", table.replyToId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_chat_messages_room").using("btree", table.groupChatRoomId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_chat_messages_sender").using("btree", table.senderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.deletedBy],
			foreignColumns: [users.id],
			name: "group_chat_messages_deleted_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.groupChatRoomId],
			foreignColumns: [groupChatRooms.id],
			name: "group_chat_messages_group_chat_room_id_group_chat_rooms_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.replyToId],
			foreignColumns: [table.id],
			name: "group_chat_messages_reply_to_id_group_chat_messages_id_fk"
		}),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "group_chat_messages_sender_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupMessageReadReceipts = pgTable("group_message_read_receipts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupChatRoomId: uuid("group_chat_room_id").notNull(),
	userId: uuid("user_id").notNull(),
	lastReadMessageId: uuid("last_read_message_id"),
	lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	unreadCount: integer("unread_count").default(0).notNull(),
}, (table) => [
	index("idx_group_read_receipts_room").using("btree", table.groupChatRoomId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_read_receipts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_message_read_receipts_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_group_read_receipt").on(table.groupChatRoomId, table.userId),
]);

export const adminReports = pgTable("admin_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportType: varchar("report_type", { length: 50 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	parameters: jsonb(),
	data: jsonb(),
	generatedBy: uuid("generated_by"),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.generatedBy],
			foreignColumns: [users.id],
			name: "admin_reports_generated_by_users_id_fk"
		}).onDelete("set null"),
]);

export const adminTasks = pgTable("admin_tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	assignedTo: uuid("assigned_to"),
	priority: varchar({ length: 20 }).default('medium'),
	status: varchar({ length: 20 }).default('todo'),
	dueDate: timestamp("due_date", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_admin_tasks_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "admin_tasks_assigned_to_users_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "admin_tasks_created_by_users_id_fk"
		}),
]);

export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	action: varchar({ length: 50 }).notNull(),
	resourceType: varchar("resource_type", { length: 50 }).notNull(),
	resourceId: uuid("resource_id"),
	userId: uuid("user_id"),
	userIp: varchar("user_ip", { length: 45 }),
	userAgent: text("user_agent"),
	previousValues: jsonb("previous_values"),
	newValues: jsonb("new_values"),
	changes: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_audit_logs_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_audit_logs_resource").using("btree", table.resourceType.asc().nullsLast().op("text_ops"), table.resourceId.asc().nullsLast().op("text_ops")),
	index("idx_audit_logs_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "audit_logs_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const contentReports = pgTable("content_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reporterId: uuid("reporter_id").notNull(),
	contentType: varchar("content_type", { length: 50 }).notNull(),
	contentId: uuid("content_id").notNull(),
	reason: varchar({ length: 255 }).notNull(),
	description: text(),
	status: varchar({ length: 20 }).default('pending'),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	actionTaken: varchar("action_taken", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_content_reports_status").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`((status)::text = 'pending'::text)`),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [users.id],
			name: "content_reports_reporter_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "content_reports_reviewed_by_users_id_fk"
		}),
]);

export const taskSubtasks = pgTable("task_subtasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	taskId: uuid("task_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	isCompleted: boolean("is_completed").default(false),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [adminTasks.id],
			name: "task_subtasks_task_id_admin_tasks_id_fk"
		}).onDelete("cascade"),
]);

export const eventAccessControl = pgTable("event_access_control", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	grantedBy: uuid("granted_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_access_control_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "event_access_control_granted_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_access_control_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("event_access_control_event_id_user_id_unique").on(table.eventId, table.userId),
]);

export const eventGroupLinks = pgTable("event_group_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	groupId: uuid("group_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_group_links_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_group_links_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "event_group_links_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_group_links_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "event_group_links_group_id_groups_id_fk"
		}).onDelete("cascade"),
	unique("event_group_links_event_id_group_id_unique").on(table.eventId, table.groupId),
]);

export const eventDiscountCodes = pgTable("event_discount_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	code: varchar({ length: 50 }).notNull(),
	discountType: varchar("discount_type", { length: 20 }).notNull(),
	discountValue: numeric("discount_value", { precision: 10, scale:  2 }).notNull(),
	maxUses: integer("max_uses"),
	usedCount: integer("used_count").default(0),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).notNull(),
	validUntil: timestamp("valid_until", { withTimezone: true, mode: 'string' }).notNull(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_discount_codes_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_event_discount_codes_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_discount_codes_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const eventFaqs = pgTable("event_faqs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	question: text().notNull(),
	answer: text().notNull(),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_faqs_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const eventSpeakers = pgTable("event_speakers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	title: varchar({ length: 255 }),
	bio: text(),
	photoUrl: text("photo_url"),
	socialLinks: jsonb("social_links").default({}),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_speakers_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const eventSponsors = pgTable("event_sponsors", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	logoUrl: text("logo_url"),
	websiteUrl: text("website_url"),
	sponsorshipLevel: varchar("sponsorship_level", { length: 50 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_sponsors_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const eventWaitlist = pgTable("event_waitlist", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	ticketTierId: uuid("ticket_tier_id"),
	notified: boolean().default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_waitlist_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_waitlist_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_waitlist_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ticketTierId],
			foreignColumns: [eventTickets.id],
			name: "event_waitlist_ticket_tier_id_event_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_waitlist_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventLikes = pgTable("event_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_likes_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_event_likes_event_id").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_likes_event_user").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_likes_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_likes_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_likes_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_event_user_like").on(table.eventId, table.userId),
]);

export const groupAnnouncements = pgTable("group_announcements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	authorId: uuid("author_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	content: text().notNull(),
	isPinned: boolean("is_pinned").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [users.id],
			name: "group_announcements_author_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_announcements_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const posts = pgTable("posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	caption: text(),
	mediaUrls: json("media_urls").default([]).notNull(),
	mediaTypes: json("media_types").default([]).notNull(),
	location: varchar({ length: 255 }),
	likesCount: integer("likes_count").default(0).notNull(),
	commentsCount: integer("comments_count").default(0).notNull(),
	sharesCount: integer("shares_count").default(0).notNull(),
	isArchived: boolean("is_archived").default(false).notNull(),
	tags: json().default([]),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	repostsCount: integer("reposts_count").default(0).notNull(),
	viewsCount: integer("views_count").default(0).notNull(),
	visibility: varchar({ length: 20 }).default('public').notNull(),
	settings: json().default({"commentsDisabled":false,"hideLikes":false}),
	isStatusPost: boolean("is_status_post").default(false).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	aspectRatios: json("aspect_ratios").default([]),
	wallPostId: uuid("wall_post_id"),
	isCoverPost: boolean("is_cover_post").default(false).notNull(),
	status: varchar({ length: 20 }).default('published').notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	source: varchar({ length: 20 }).default('manual').notNull(),
}, (table) => [
	index("idx_posts_archived").using("btree", table.isArchived.asc().nullsLast().op("bool_ops")),
	index("idx_posts_cover_post").using("btree", table.isCoverPost.asc().nullsLast().op("bool_ops")),
	index("idx_posts_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_posts_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_posts_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_posts_scheduled_at").using("btree", table.scheduledAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_posts_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("idx_posts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_posts_status_post").using("btree", table.isStatusPost.asc().nullsLast().op("bool_ops")),
	index("idx_posts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_posts_wall_post").using("btree", table.wallPostId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "posts_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.wallPostId],
			foreignColumns: [socialWallPosts.id],
			name: "posts_wall_post_id_social_wall_posts_id_fk"
		}).onDelete("set null"),
]);

export const groupSubscriptionTiers = pgTable("group_subscription_tiers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: varchar({ length: 500 }),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	billingInterval: varchar("billing_interval", { length: 20 }).default('monthly').notNull(),
	features: varchar({ length: 1000 }),
	maxMembers: integer("max_members"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	stripeProductId: varchar("stripe_product_id", { length: 255 }),
	stripePriceId: varchar("stripe_price_id", { length: 255 }),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_subscription_tiers_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const interestCategories = pgTable("interest_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	description: text(),
	icon: varchar({ length: 50 }),
	color: varchar({ length: 7 }).default('#3B82F6'),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	usageCount: integer("usage_count").default(0).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
}, (table) => [
	index("idx_interest_categories_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_interest_categories_default").using("btree", table.isDefault.asc().nullsLast().op("bool_ops")),
	index("idx_interest_categories_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("idx_interest_categories_sort").using("btree", table.sortOrder.asc().nullsLast().op("int4_ops")),
	unique("interest_categories_name_unique").on(table.name),
	unique("interest_categories_slug_unique").on(table.slug),
]);

export const groupMemberRoles = pgTable("group_member_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	name: varchar({ length: 50 }).notNull(),
	permissions: jsonb().default([]),
	color: varchar({ length: 7 }).default('#000000'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_member_roles_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const groupRules = pgTable("group_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text().notNull(),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_rules_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const userHiddenPosts = pgTable("user_hidden_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_hidden_posts_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_user_hidden_posts_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_hidden_posts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "user_hidden_posts_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_hidden_posts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const usernameReservations = pgTable("username_reservations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: varchar("full_name", { length: 255 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	username: varchar({ length: 100 }).notNull(),
	primaryPlatform: socialPlatform("primary_platform").notNull(),
	followerCount: followerCountRange("follower_count").notNull(),
	profileUrl: text("profile_url").notNull(),
	additionalInfo: text("additional_info"),
	status: usernameReservationStatus().default('pending').notNull(),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	reviewNotes: text("review_notes"),
	rejectionReason: text("rejection_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_username_reservations_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_username_reservations_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_username_reservations_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_username_reservations_username").using("btree", table.username.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "username_reservations_reviewed_by_users_id_fk"
		}).onDelete("set null"),
]);

export const contactMessages = pgTable("contact_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firstName: varchar("first_name", { length: 100 }),
	lastName: varchar("last_name", { length: 100 }),
	email: varchar({ length: 255 }).notNull(),
	subject: varchar({ length: 255 }).notNull(),
	message: text().notNull(),
	status: varchar({ length: 20 }).default('new').notNull(),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_contact_messages_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_contact_messages_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_contact_messages_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const groups = pgTable("groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	coverImageUrl: text("cover_image_url"),
	isPublic: boolean("is_public").default(true),
	requiresApproval: boolean("requires_approval").default(false),
	maxMembers: integer("max_members"),
	memberCount: integer("member_count").default(0),
	categoryId: uuid("category_id"),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	googlePlaceId: varchar("google_place_id", { length: 255 }),
	address: text(),
	latitude: numeric({ precision: 10, scale:  8 }),
	longitude: numeric({ precision: 11, scale:  8 }),
	city: varchar({ length: 100 }),
	state: varchar({ length: 100 }),
	country: varchar({ length: 100 }),
	postalCode: varchar("postal_code", { length: 20 }),
	countryCode: varchar("country_code", { length: 10 }),
	isPaid: boolean("is_paid").default(false).notNull(),
	subscriptionPrice: numeric("subscription_price", { precision: 10, scale:  2 }),
	slug: varchar({ length: 255 }).notNull(),
	// TODO: failed to parse database type 'tsvector'
	groupSearch: unknown("group_search").generatedAlwaysAs(sql`(setweight(to_tsvector('english'::regconfig, (COALESCE(name, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char"))`),
	linkButton: jsonb("link_button"),
}, (table) => [
	index("idx_groups_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("idx_groups_public").using("btree", table.isPublic.asc().nullsLast().op("bool_ops")).where(sql`(is_public = true)`),
	index("idx_groups_search_fts").using("gin", table.groupSearch.asc().nullsLast().op("tsvector_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [groupCategories.id],
			name: "groups_category_id_group_categories_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "groups_created_by_users_id_fk"
		}).onDelete("cascade"),
	unique("groups_slug_unique").on(table.slug),
]);

export const socialWallPosts = pgTable("social_wall_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	profileId: uuid("profile_id").notNull(),
	authorId: uuid("author_id").notNull(),
	content: text().notNull(),
	status: wallPostStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	deletedBy: uuid("deleted_by"),
	postId: uuid("post_id"),
}, (table) => [
	index("idx_wall_posts_author").using("btree", table.authorId.asc().nullsLast().op("uuid_ops")),
	index("idx_wall_posts_profile").using("btree", table.profileId.asc().nullsLast().op("uuid_ops")),
	index("idx_wall_posts_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [users.id],
			name: "social_wall_posts_author_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "social_wall_posts_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deletedBy],
			foreignColumns: [users.id],
			name: "social_wall_posts_deleted_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "social_wall_posts_post_id_posts_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [socialProfiles.id],
			name: "social_wall_posts_profile_id_social_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "social_wall_posts_updated_by_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupFeaturedContent = pgTable("group_featured_content", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	mediaUrl: text("media_url"),
	mediaType: varchar("media_type", { length: 50 }),
	url: text(),
	isPinned: boolean("is_pinned").default(false),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_featured_content_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_group_featured_content_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_featured_content_pinned").using("btree", table.isPinned.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "group_featured_content_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_featured_content_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const groupMedia = pgTable("group_media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	uploaderId: uuid("uploader_id").notNull(),
	mediaUrl: text("media_url").notNull(),
	mediaType: varchar("media_type", { length: 50 }).notNull(),
	caption: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_media_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_media_uploader").using("btree", table.uploaderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_media_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaderId],
			foreignColumns: [users.id],
			name: "group_media_uploader_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupDiscussionNotifications = pgTable("group_discussion_notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_discussion_notifications_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_group_discussion_notifications_unique").using("btree", table.groupId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_discussion_notifications_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_discussion_notifications_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_discussion_notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const profileViews = pgTable("profile_views", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	profileId: uuid("profile_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_profile_views_profile").using("btree", table.profileId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_profile_views_unique").using("btree", table.profileId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_profile_views_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [socialProfiles.id],
			name: "profile_views_profile_id_social_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profile_views_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventVirtualDetails = pgTable("event_virtual_details", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	virtualPlatform: virtualPlatformEnum("virtual_platform").notNull(),
	meetingLink: text("meeting_link"),
	duration: integer(),
	maxAttendees: integer("max_attendees"),
	briteVideoLink: text("brite_video_link"),
	platformName: platformNameEnum("platform_name"),
	accessInstructions: text("access_instructions"),
	password: varchar({ length: 100 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_virtual_details_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_virtual_details_platform").using("btree", table.virtualPlatform.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_virtual_details_event_id_events_id_fk"
		}).onDelete("cascade"),
	unique("event_virtual_details_event_id_unique").on(table.eventId),
]);

export const postViews = pgTable("post_views", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_views_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_post_views_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_views_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_views_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_views_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const socialProfiles = pgTable("social_profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	organizerId: uuid("organizer_id"),
	bio: varchar({ length: 500 }),
	website: varchar({ length: 255 }),
	location: varchar({ length: 200 }),
	isPublic: boolean("is_public").default(true).notNull(),
	followersCount: integer("followers_count").default(0).notNull(),
	followingCount: integer("following_count").default(0).notNull(),
	postsCount: integer("posts_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isVerified: boolean("is_verified").default(false).notNull(),
	profileViewsCount: integer("profile_views_count").default(0).notNull(),
	age: integer(),
	gender: gender(),
	coverMedia: json("cover_media").default([]),
	status: text(),
	statusPostId: uuid("status_post_id"),
	hideFollowingCount: boolean("hide_following_count").default(false).notNull(),
	countryFlag1: varchar("country_flag_1", { length: 2 }),
	countryFlag2: varchar("country_flag_2", { length: 2 }),
	buttonMeta: jsonb("button_meta").default(null),
	coverPostId: uuid("cover_post_id"),
	shopVisible: boolean("shop_visible").default(true).notNull(),
	shopRefundsEnabled: boolean("shop_refunds_enabled").default(true).notNull(),
	shopRefundWindowDays: integer("shop_refund_window_days").default(14).notNull(),
	shopRefundAfterDownload: boolean("shop_refund_after_download").default(false).notNull(),
	defaultLandingTab: varchar("default_landing_tab", { length: 10 }).default('posts').notNull(),
	city: varchar({ length: 100 }),
	state: varchar({ length: 100 }),
	country: varchar({ length: 100 }),
}, (table) => [
	index("idx_social_profiles_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_social_profiles_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.coverPostId],
			foreignColumns: [posts.id],
			name: "social_profiles_cover_post_id_posts_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "social_profiles_organizer_id_organizers_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.statusPostId],
			foreignColumns: [posts.id],
			name: "social_profiles_status_post_id_posts_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "social_profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("social_profiles_user_id_unique").on(table.userId),
]);

export const storyLikes = pgTable("story_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storyId: uuid("story_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_story_likes_story").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_story_likes_unique").using("btree", table.storyId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_likes_story_id_stories_id_fk"
		}).onDelete("cascade"),
]);

export const stories = pgTable("stories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	mediaUrl: varchar("media_url", { length: 500 }).notNull(),
	mediaType: varchar("media_type", { length: 10 }).notNull(),
	caption: text(),
	viewsCount: integer("views_count").default(0).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	meta: json().default(null),
	likesCount: integer("likes_count").default(0).notNull(),
	commentsCount: integer("comments_count").default(0).notNull(),
	sharesCount: integer("shares_count").default(0).notNull(),
	visibility: varchar({ length: 20 }).default('followers').notNull(),
	commentsDisabled: boolean("comments_disabled").default(false).notNull(),
	hideViewCount: boolean("hide_view_count").default(false).notNull(),
}, (table) => [
	index("idx_stories_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_stories_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_stories_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_stories_visibility").using("btree", table.visibility.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "stories_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const talentFavorites = pgTable("talent_favorites", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_talent_favorites_profile").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_talent_favorites_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_favorites_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_favorites_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "talent_favorites_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyPolls = pgTable("story_polls", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storyId: uuid("story_id").notNull(),
	userId: uuid("user_id").notNull(),
	type: storyPollType().notNull(),
	question: text().notNull(),
	meta: jsonb().default(null),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_story_polls_story").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_polls_type").using("btree", table.type.asc().nullsLast().op("enum_ops")),
	index("idx_story_polls_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_polls_story_id_stories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_polls_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyPollResponses = pgTable("story_poll_responses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pollId: uuid("poll_id").notNull(),
	userId: uuid("user_id").notNull(),
	response: jsonb().notNull(),
	isCorrect: boolean("is_correct"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_story_poll_responses_poll").using("btree", table.pollId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_story_poll_responses_unique").using("btree", table.pollId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_poll_responses_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pollId],
			foreignColumns: [storyPolls.id],
			name: "story_poll_responses_poll_id_story_polls_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_poll_responses_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyCommentLikes = pgTable("story_comment_likes", {
	id: uuid().primaryKey().notNull(),
	commentId: uuid("comment_id"),
	userId: uuid("user_id"),
	createdAt: timestamp("created_at", { mode: 'string' }),
}, (table) => [
	index("idx_story_comment_likes_comment").using("btree", table.commentId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_story_comment_likes_unique").using("btree", table.commentId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_comment_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
]);

export const talentAvailability = pgTable("talent_availability", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	dayOfWeek: jsonb("day_of_week").default([]).notNull(),
	startTime: varchar("start_time", { length: 5 }).notNull(),
	endTime: varchar("end_time", { length: 5 }).notNull(),
	timezone: varchar({ length: 100 }).default('America/New_York').notNull(),
	durations: jsonb().default([15,30,45,60]).notNull(),
	priceOverrides: jsonb("price_overrides").default({}).notNull(),
	blockedDates: jsonb("blocked_dates").default([]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_talent_availability_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_talent_availability_profile").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_availability_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const talentDateOverrides = pgTable("talent_date_overrides", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	overrideDate: date("override_date").notNull(),
	isBlocked: boolean("is_blocked").default(false).notNull(),
	startTime: varchar("start_time", { length: 5 }),
	endTime: varchar("end_time", { length: 5 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_talent_date_overrides_date").using("btree", table.overrideDate.asc().nullsLast().op("date_ops")),
	index("idx_talent_date_overrides_profile").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_date_overrides_profile_date").using("btree", table.talentProfileId.asc().nullsLast().op("date_ops"), table.overrideDate.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_date_overrides_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const talentGiftCodes = pgTable("talent_gift_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gifterId: uuid("gifter_id").notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	code: varchar({ length: 20 }).notNull(),
	durationMins: integer("duration_mins").notNull(),
	priceCents: integer("price_cents").notNull(),
	recipientName: varchar("recipient_name", { length: 255 }),
	recipientEmail: varchar("recipient_email", { length: 255 }),
	recipientPhone: varchar("recipient_phone", { length: 50 }),
	occasion: varchar({ length: 100 }),
	personalMessage: text("personal_message"),
	deliveryDate: timestamp("delivery_date", { withTimezone: true, mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	status: varchar({ length: 20 }).default('active').notNull(),
	redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: 'string' }),
	redeemedSessionId: uuid("redeemed_session_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_talent_gift_codes_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_talent_gift_codes_expires").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_gift_codes_gifter").using("btree", table.gifterId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_gift_codes_recipient_email").using("btree", table.recipientEmail.asc().nullsLast().op("text_ops")),
	index("idx_talent_gift_codes_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_talent_gift_codes_talent").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.gifterId],
			foreignColumns: [users.id],
			name: "talent_gift_codes_gifter_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.redeemedSessionId],
			foreignColumns: [talentSessions.id],
			name: "talent_gift_codes_redeemed_session_id_talent_sessions_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_gift_codes_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const priorityMessagePayments = pgTable("priority_message_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	senderId: uuid("sender_id").notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	talentUserId: uuid("talent_user_id").notNull(),
	subject: varchar({ length: 255 }),
	amountCents: integer("amount_cents").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	stripePaymentIntent: varchar("stripe_payment_intent", { length: 255 }),
	conversationId: uuid("conversation_id"),
	messageId: uuid("message_id"),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	messageCount: integer("message_count").default(1).notNull(),
	messages: jsonb().default([]),
	repliedAt: timestamp("replied_at", { withTimezone: true, mode: 'string' }),
	baseCents: integer("base_cents"),
	metadata: jsonb().default({}),
	transferId: varchar("transfer_id", { length: 255 }),
	transferredAt: timestamp("transferred_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_pmp_conversation").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops")),
	index("idx_pmp_conversation_status").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_pmp_paid_at").using("btree", table.paidAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_pmp_sender").using("btree", table.senderId.asc().nullsLast().op("uuid_ops")),
	index("idx_pmp_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_pmp_talent_status").using("btree", table.talentUserId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("idx_pmp_talent_user").using("btree", table.talentUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "priority_message_payments_sender_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.talentUserId],
			foreignColumns: [users.id],
			name: "priority_message_payments_talent_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const talentSessions = pgTable("talent_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	bookerId: uuid("booker_id").notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }).notNull(),
	durationMins: integer("duration_mins").notNull(),
	joinAllowedAt: timestamp("join_allowed_at", { withTimezone: true, mode: 'string' }).notNull(),
	bookerJoinedAt: timestamp("booker_joined_at", { withTimezone: true, mode: 'string' }),
	talentJoinedAt: timestamp("talent_joined_at", { withTimezone: true, mode: 'string' }),
	billingStartedAt: timestamp("billing_started_at", { withTimezone: true, mode: 'string' }),
	billingEndedAt: timestamp("billing_ended_at", { withTimezone: true, mode: 'string' }),
	actualDurationMins: integer("actual_duration_mins"),
	priceCents: integer("price_cents").notNull(),
	status: varchar({ length: 30 }).default('pending').notNull(),
	subject: varchar({ length: 255 }).notNull(),
	discussion: text(),
	isGift: boolean("is_gift").default(false).notNull(),
	giftDetails: jsonb("gift_details").default({}),
	giftCode: varchar("gift_code", { length: 50 }),
	streamCallCid: varchar("stream_call_cid", { length: 255 }),
	reminder24HSentAt: timestamp("reminder_24h_sent_at", { withTimezone: true, mode: 'string' }),
	reminder1HSentAt: timestamp("reminder_1h_sent_at", { withTimezone: true, mode: 'string' }),
	reminder15MSentAt: timestamp("reminder_15m_sent_at", { withTimezone: true, mode: 'string' }),
	cancelledBy: uuid("cancelled_by"),
	cancellationReason: text("cancellation_reason"),
	refundIssuedAt: timestamp("refund_issued_at", { withTimezone: true, mode: 'string' }),
	rescheduledFromId: uuid("rescheduled_from_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	reserveAmountCents: integer("reserve_amount_cents").default(0),
	reserveReleasedAt: timestamp("reserve_released_at", { withTimezone: true, mode: 'string' }),
	stripeFeeCents: integer("stripe_fee_cents").default(0),
	platformShareCents: integer("platform_share_cents").default(0),
	bookerCallRating: integer("booker_call_rating"),
	bookerCallFeedback: text("booker_call_feedback"),
	talentCallRating: integer("talent_call_rating"),
	talentCallFeedback: text("talent_call_feedback"),
	reminder10MSentAt: timestamp("reminder_10m_sent_at", { withTimezone: true, mode: 'string' }),
	reminder1MSentAt: timestamp("reminder_1m_sent_at", { withTimezone: true, mode: 'string' }),
	reviewReminderSentAt: timestamp("review_reminder_sent_at", { withTimezone: true, mode: 'string' }),
	transferId: varchar("transfer_id", { length: 255 }),
	transferredAt: timestamp("transferred_at", { withTimezone: true, mode: 'string' }),
	moderationStatus: varchar("moderation_status", { length: 16 }).default('approved').notNull(),
	moderationEventsLog: jsonb("moderation_events_log").default([]),
}, (table) => [
	index("idx_talent_sessions_booker").using("btree", table.bookerId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_sessions_reminder_10m").using("btree", table.reminder10MSentAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_sessions_reminder_1h").using("btree", table.reminder1HSentAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_sessions_reminder_1m").using("btree", table.reminder1MSentAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_sessions_reminder_24h").using("btree", table.reminder24HSentAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_sessions_scheduled").using("btree", table.scheduledAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_sessions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_talent_sessions_stream_cid").using("btree", table.streamCallCid.asc().nullsLast().op("text_ops")),
	index("idx_talent_sessions_talent").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.bookerId],
			foreignColumns: [users.id],
			name: "talent_sessions_booker_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.cancelledBy],
			foreignColumns: [users.id],
			name: "talent_sessions_cancelled_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_sessions_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const livestreams = pgTable("livestreams", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	streamCallId: varchar("stream_call_id", { length: 255 }).notNull(),
	streamCallCid: varchar("stream_call_cid", { length: 255 }),
	status: varchar({ length: 20 }).default('idle').notNull(),
	allowComments: boolean("allow_comments").default(true).notNull(),
	thumbnailUrl: text("thumbnail_url"),
	viewerCount: integer("viewer_count").default(0).notNull(),
	peakViewerCount: integer("peak_viewer_count").default(0).notNull(),
	totalReactions: integer("total_reactions").default(0).notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_livestreams_started_at").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_livestreams_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_livestreams_stream_call_id").using("btree", table.streamCallId.asc().nullsLast().op("text_ops")),
	index("idx_livestreams_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "livestreams_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const livestreamComments = pgTable("livestream_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	livestreamId: uuid("livestream_id").notNull(),
	userId: uuid("user_id").notNull(),
	text: text().notNull(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_livestream_comments_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_livestream_comments_stream").using("btree", table.livestreamId.asc().nullsLast().op("uuid_ops")),
	index("idx_livestream_comments_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.livestreamId],
			foreignColumns: [livestreams.id],
			name: "livestream_comments_livestream_id_livestreams_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "livestream_comments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const livestreamReactions = pgTable("livestream_reactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	livestreamId: uuid("livestream_id").notNull(),
	userId: uuid("user_id").notNull(),
	emoji: varchar({ length: 10 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_livestream_reactions_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_livestream_reactions_stream").using("btree", table.livestreamId.asc().nullsLast().op("uuid_ops")),
	index("idx_livestream_reactions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.livestreamId],
			foreignColumns: [livestreams.id],
			name: "livestream_reactions_livestream_id_livestreams_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "livestream_reactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const livestreamViewers = pgTable("livestream_viewers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	livestreamId: uuid("livestream_id").notNull(),
	userId: uuid("user_id").notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	leftAt: timestamp("left_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_livestream_viewers_stream").using("btree", table.livestreamId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_livestream_viewers_unique").using("btree", table.livestreamId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_livestream_viewers_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.livestreamId],
			foreignColumns: [livestreams.id],
			name: "livestream_viewers_livestream_id_livestreams_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "livestream_viewers_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const stripeCustomers = pgTable("stripe_customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_stripe_customers_stripe_id").using("btree", table.stripeCustomerId.asc().nullsLast().op("text_ops")),
	index("idx_stripe_customers_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "stripe_customers_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("stripe_customers_stripe_customer_id_unique").on(table.stripeCustomerId),
	unique("stripe_customers_user_id_unique").on(table.userId),
]);

export const userSubscriptions = pgTable("user_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	planId: uuid("plan_id").notNull(),
	stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
	status: varchar({ length: 20 }).default('active').notNull(),
	currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: 'string' }),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
	canceledAt: timestamp("canceled_at", { withTimezone: true, mode: 'string' }),
	grantedBy: uuid("granted_by"),
	grantReason: text("grant_reason"),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_user_subscriptions_plan").using("btree", table.planId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_subscriptions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_user_subscriptions_stripe").using("btree", table.stripeSubscriptionId.asc().nullsLast().op("text_ops")),
	index("idx_user_subscriptions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "user_subscriptions_granted_by_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [subscriptionPlans.id],
			name: "user_subscriptions_plan_id_subscription_plans_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_subscriptions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const subscriptionAuditLogs = pgTable("subscription_audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userSubscriptionId: uuid("user_subscription_id"),
	planId: uuid("plan_id"),
	actorId: uuid("actor_id"),
	actorType: varchar("actor_type", { length: 20 }).notNull(),
	action: varchar({ length: 50 }).notNull(),
	previousValues: jsonb("previous_values"),
	newValues: jsonb("new_values"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_sub_audit_actor").using("btree", table.actorId.asc().nullsLast().op("uuid_ops")),
	index("idx_sub_audit_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_sub_audit_plan").using("btree", table.planId.asc().nullsLast().op("uuid_ops")),
	index("idx_sub_audit_subscription").using("btree", table.userSubscriptionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "subscription_audit_logs_actor_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [subscriptionPlans.id],
			name: "subscription_audit_logs_plan_id_subscription_plans_id_fk"
		}).onDelete("set null"),
]);

export const subscriptionPlans = pgTable("subscription_plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('usd').notNull(),
	interval: varchar({ length: 20 }).notNull(),
	stripePriceId: varchar("stripe_price_id", { length: 255 }),
	stripeProductId: varchar("stripe_product_id", { length: 255 }),
	isActive: boolean("is_active").default(true),
	displayOrder: integer("display_order").default(0),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_subscription_plans_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_subscription_plans_order").using("btree", table.displayOrder.asc().nullsLast().op("int4_ops")),
	unique("subscription_plans_stripe_price_id_unique").on(table.stripePriceId),
]);

export const subscriptionFeatures = pgTable("subscription_features", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planId: uuid("plan_id").notNull(),
	featureKey: varchar("feature_key", { length: 100 }).notNull(),
	featureLabel: varchar("feature_label", { length: 255 }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_subscription_features_plan").using("btree", table.planId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [subscriptionPlans.id],
			name: "subscription_features_plan_id_subscription_plans_id_fk"
		}).onDelete("cascade"),
]);

export const trackingLinks = pgTable("tracking_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	organizerId: uuid("organizer_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	code: varchar({ length: 100 }).notNull(),
	destinationUrl: text("destination_url"),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_tracking_links_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_tracking_links_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_tracking_links_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "tracking_links_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "tracking_links_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	unique("tracking_links_code_unique").on(table.code),
]);

export const trackingLinkClicks = pgTable("tracking_link_clicks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	trackingLinkId: uuid("tracking_link_id").notNull(),
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id"),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	referer: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_tracking_link_clicks_link").using("btree", table.trackingLinkId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "tracking_link_clicks_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.trackingLinkId],
			foreignColumns: [trackingLinks.id],
			name: "tracking_link_clicks_tracking_link_id_tracking_links_id_fk"
		}).onDelete("cascade"),
]);

export const scanSessions = pgTable("scan_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id").notNull(),
	memberId: uuid("member_id"),
	eventId: uuid("event_id"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	deviceInfo: jsonb("device_info").default({}),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	status: varchar({ length: 20 }).default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	teamMemberId: uuid("team_member_id"),
}, (table) => [
	index("idx_scan_sessions_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_scan_sessions_member").using("btree", table.memberId.asc().nullsLast().op("uuid_ops")),
	index("idx_scan_sessions_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "scan_sessions_event_id_events_id_fk"
		}),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [organizerMembers.id],
			name: "scan_sessions_member_id_organizer_members_id_fk"
		}),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "scan_sessions_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.teamMemberId],
			foreignColumns: [eventTeamMembers.id],
			name: "scan_sessions_team_member_id_event_team_members_id_fk"
		}),
]);

export const eventTeams = pgTable("event_teams", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	createdBy: uuid("created_by"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "event_teams_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_teams_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const eventTeamMembers = pgTable("event_team_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	teamId: uuid("team_id").notNull(),
	roleId: uuid("role_id"),
	userId: uuid("user_id"),
	memberCode: varchar("member_code", { length: 64 }),
	passwordHash: varchar("password_hash", { length: 255 }),
	permissions: jsonb().default([]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_team_event").using("btree", table.teamId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_team_member_code").using("btree", table.memberCode.asc().nullsLast().op("text_ops")),
	index("idx_event_team_members_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [eventTeamRoles.id],
			name: "event_team_members_role_id_event_team_roles_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [eventTeams.id],
			name: "event_team_members_team_id_event_teams_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "event_team_members_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const userFollowRequests = pgTable("user_follow_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	requesterId: uuid("requester_id").notNull(),
	targetId: uuid("target_id").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_follow_requests_requester").using("btree", table.requesterId.asc().nullsLast().op("uuid_ops")),
	index("idx_follow_requests_target").using("btree", table.targetId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_follow_requests_unique").using("btree", table.requesterId.asc().nullsLast().op("uuid_ops"), table.targetId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.requesterId],
			foreignColumns: [users.id],
			name: "user_follow_requests_requester_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [users.id],
			name: "user_follow_requests_target_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventTeamRoles = pgTable("event_team_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	permissions: jsonb().default([]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isActive: boolean("is_active").default(true).notNull(),
});

export const eventVenueProfiles = pgTable("event_venue_profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	venueId: uuid("venue_id").notNull(),
	description: text(),
	capacity: integer(),
	amenities: jsonb().default([]),
	additionalInformation: jsonb("additional_information").default({}),
	cancellationPolicy: text("cancellation_policy"),
	accessibility: jsonb().default([]),
	contactEmail: varchar("contact_email", { length: 255 }),
	contactPhone: varchar("contact_phone", { length: 20 }),
	parkingInfo: text("parking_info"),
	publicTransportInfo: text("public_transport_info"),
	emoji: varchar({ length: 10 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("idx_event_venue_profiles_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_venue_profiles_venue").using("btree", table.venueId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_venue_profiles_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "event_venue_profiles_venue_id_venues_id_fk"
		}).onDelete("restrict"),
]);

export const guestOrders = pgTable("guest_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	guestName: varchar("guest_name", { length: 255 }).notNull(),
	guestEmail: varchar("guest_email", { length: 255 }).notNull(),
	guestPhone: varchar("guest_phone", { length: 20 }),
	totalAmount: numeric("total_amount", { precision: 10, scale:  2 }).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	paymentIntentId: varchar("payment_intent_id", { length: 255 }),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	receiptUrl: varchar("receipt_url", { length: 255 }),
	isDoorSale: boolean("is_door_sale").default(true).notNull(),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_guest_orders_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_guest_orders_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "guest_orders_event_id_events_id_fk"
		}).onDelete("cascade"),
]);

export const guestOrderItems = pgTable("guest_order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	guestOrderId: uuid("guest_order_id").notNull(),
	ticketTierId: uuid("ticket_tier_id").notNull(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_guest_order_items_guest_order").using("btree", table.guestOrderId.asc().nullsLast().op("uuid_ops")),
	index("idx_guest_order_items_tier").using("btree", table.ticketTierId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.guestOrderId],
			foreignColumns: [guestOrders.id],
			name: "guest_order_items_guest_order_id_guest_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ticketTierId],
			foreignColumns: [eventTickets.id],
			name: "guest_order_items_ticket_tier_id_event_tickets_id_fk"
		}).onDelete("cascade"),
]);

export const guestPurchasedTickets = pgTable("guest_purchased_tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketCode: varchar("ticket_code", { length: 50 }).notNull(),
	eventId: uuid("event_id").notNull(),
	ticketTierId: uuid("ticket_tier_id").notNull(),
	guestOrderId: uuid("guest_order_id").notNull(),
	holderName: varchar("holder_name", { length: 255 }).notNull(),
	holderEmail: varchar("holder_email", { length: 255 }),
	holderPhone: varchar("holder_phone", { length: 20 }),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	qrCode: text("qr_code").notNull(),
	qrCodeUrl: text("qr_code_url"),
	status: varchar({ length: 20 }).default('active').notNull(),
	isUsed: boolean("is_used").default(false).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	scanCount: integer("scan_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "guest_purchased_tickets_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.guestOrderId],
			foreignColumns: [guestOrders.id],
			name: "guest_purchased_tickets_guest_order_id_guest_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ticketTierId],
			foreignColumns: [eventTickets.id],
			name: "guest_purchased_tickets_ticket_tier_id_event_tickets_id_fk"
		}).onDelete("cascade"),
	unique("guest_purchased_tickets_ticket_code_unique").on(table.ticketCode),
]);

export const groupSubscriptions = pgTable("group_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	groupId: uuid("group_id").notNull(),
	tierId: uuid("tier_id").notNull(),
	status: varchar({ length: 20 }).default('active').notNull(),
	stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
	currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: 'string' }),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	platformFeePercent: numeric("platform_fee_percent", { precision: 5, scale:  2 }),
	refundId: varchar("refund_id", { length: 255 }),
	refundStatus: varchar("refund_status", { length: 20 }),
	refundAmount: integer("refund_amount"),
}, (table) => [
	index("idx_group_subscriptions_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_subscriptions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_subscriptions_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tierId],
			foreignColumns: [groupSubscriptionTiers.id],
			name: "group_subscriptions_tier_id_group_subscription_tiers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_subscriptions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupQuestions = pgTable("group_questions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	questionText: varchar("question_text", { length: 500 }).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	meta: jsonb().default({}).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_questions_active").using("btree", table.groupId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_group_questions_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_questions_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const eventBlasts = pgTable("event_blasts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	sentBy: uuid("sent_by"),
	sentByTeamMember: uuid("sent_by_team_member"),
	type: varchar({ length: 10 }).notNull(),
	subject: varchar({ length: 255 }),
	message: text().notNull(),
	recipientCount: integer("recipient_count").default(0).notNull(),
	successCount: integer("success_count").default(0).notNull(),
	failureCount: integer("failure_count").default(0).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_event_blasts_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_event_blasts_event_created").using("btree", table.eventId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_blasts_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sentByTeamMember],
			foreignColumns: [eventTeamMembers.id],
			name: "event_blasts_sent_by_team_member_event_team_members_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.sentBy],
			foreignColumns: [users.id],
			name: "event_blasts_sent_by_users_id_fk"
		}).onDelete("set null"),
]);

export const userSpends = pgTable("user_spends", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	spendType: spendType("spend_type").notNull(),
	amountCents: integer("amount_cents").notNull(),
	referenceId: uuid("reference_id").notNull(),
	referenceType: varchar("reference_type", { length: 50 }).notNull(),
	eventId: uuid("event_id"),
	talentUserId: uuid("talent_user_id"),
	groupId: uuid("group_id"),
	metadata: jsonb().default({}),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isRefunded: boolean("is_refunded").default(false).notNull(),
	refundMeta: jsonb("refund_meta").default({}),
}, (table) => [
	index("idx_user_spends_event_id").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_spends_is_refunded").using("btree", table.isRefunded.asc().nullsLast().op("bool_ops")),
	index("idx_user_spends_paid_at").using("btree", table.paidAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_user_spends_reference_id").using("btree", table.referenceId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_spends_spend_type").using("btree", table.spendType.asc().nullsLast().op("enum_ops")),
	index("idx_user_spends_talent_user_id").using("btree", table.talentUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_spends_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "user_spends_event_id_events_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "user_spends_group_id_groups_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.talentUserId],
			foreignColumns: [users.id],
			name: "user_spends_talent_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_spends_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const organizerPresets = pgTable("organizer_presets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id").notNull(),
	presetName: varchar("preset_name", { length: 255 }).notNull(),
	businessName: varchar("business_name", { length: 255 }),
	businessDescription: text("business_description"),
	businessType: varchar("business_type", { length: 50 }),
	logoUrl: text("logo_url"),
	coverImageUrl: text("cover_image_url").array(),
	websiteUrl: text("website_url"),
	contactEmail: varchar("contact_email", { length: 255 }),
	contactPhone: varchar("contact_phone", { length: 50 }),
	businessAddress: text("business_address"),
	about: varchar({ length: 500 }),
	specialities: text().array(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_organizer_presets_default").using("btree", table.organizerId.asc().nullsLast().op("bool_ops"), table.isDefault.asc().nullsLast().op("bool_ops")),
	index("idx_organizer_presets_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "organizer_presets_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
]);

export const organizerPayouts = pgTable("organizer_payouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	organizerId: uuid("organizer_id").notNull(),
	payoutMethodId: uuid("payout_method_id"),
	amountCents: integer("amount_cents").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	type: varchar({ length: 20 }).default('standard').notNull(),
	stripePayoutId: varchar("stripe_payout_id", { length: 255 }),
	stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
	adminNote: varchar("admin_note", { length: 500 }),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_organizer_payouts_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_organizer_payouts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_organizer_payouts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "organizer_payouts_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.payoutMethodId],
			foreignColumns: [userPayoutMethods.id],
			name: "organizer_payouts_payout_method_id_user_payout_methods_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "organizer_payouts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userPayoutMethods = pgTable("user_payout_methods", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 20 }).notNull(),
	label: varchar({ length: 100 }).notNull(),
	accountHolderName: varchar("account_holder_name", { length: 255 }).notNull(),
	bankName: varchar("bank_name", { length: 255 }),
	accountNumberLast4: varchar("account_number_last4", { length: 4 }),
	routingNumberLast4: varchar("routing_number_last4", { length: 4 }),
	country: varchar({ length: 2 }).default('US'),
	currency: varchar({ length: 3 }).default('USD'),
	fullDetails: jsonb("full_details"),
	isDefault: boolean("is_default").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_payout_methods_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_payout_methods_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const stripeConnectAccounts = pgTable("stripe_connect_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	stripeAccountId: varchar("stripe_account_id", { length: 255 }).notNull(),
	onboardingComplete: boolean("onboarding_complete").default(false),
	chargesEnabled: boolean("charges_enabled").default(false),
	payoutsEnabled: boolean("payouts_enabled").default(false),
	country: varchar({ length: 2 }).default('US'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_stripe_connect_account").using("btree", table.stripeAccountId.asc().nullsLast().op("text_ops")),
	index("idx_stripe_connect_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "stripe_connect_accounts_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("stripe_connect_accounts_stripe_account_id_unique").on(table.stripeAccountId),
	unique("stripe_connect_accounts_user_id_unique").on(table.userId),
]);

export const talentPayouts = pgTable("talent_payouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	payoutMethodId: uuid("payout_method_id"),
	amountCents: integer("amount_cents").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	type: varchar({ length: 20 }).default('standard').notNull(),
	stripePayoutId: varchar("stripe_payout_id", { length: 255 }),
	stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
	adminNote: varchar("admin_note", { length: 500 }),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_talent_payouts_profile").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_payouts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_talent_payouts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.payoutMethodId],
			foreignColumns: [userPayoutMethods.id],
			name: "talent_payouts_payout_method_id_user_payout_methods_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_payouts_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "talent_payouts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupPayouts = pgTable("group_payouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	groupId: uuid("group_id"),
	payoutMethodId: uuid("payout_method_id"),
	amountCents: integer("amount_cents").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	type: varchar({ length: 20 }).default('standard').notNull(),
	stripePayoutId: varchar("stripe_payout_id", { length: 255 }),
	stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
	adminNote: varchar("admin_note", { length: 500 }),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_payouts_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_payouts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_group_payouts_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.payoutMethodId],
			foreignColumns: [userPayoutMethods.id],
			name: "group_payouts_payout_method_id_user_payout_methods_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_payouts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupCourses = pgTable("group_courses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id"),
	createdBy: uuid("created_by").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	thumbnailUrl: text("thumbnail_url"),
	isFree: boolean("is_free").default(true).notNull(),
	price: numeric({ precision: 10, scale:  2 }),
	stripeProductId: varchar("stripe_product_id", { length: 255 }),
	stripePriceId: varchar("stripe_price_id", { length: 255 }),
	status: courseStatus().default('draft').notNull(),
	metadata: jsonb().default({}),
	totalLessons: integer("total_lessons").default(0).notNull(),
	totalEnrollments: integer("total_enrollments").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	ownerId: uuid("owner_id"),
}, (table) => [
	index("idx_group_courses_creator").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("idx_group_courses_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_courses_owner").using("btree", table.ownerId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_courses_status").using("btree", table.groupId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "group_courses_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_courses_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [users.id],
			name: "group_courses_owner_id_users_id_fk"
		}).onDelete("cascade"),
	check("chk_group_courses_owner_xor", sql`((group_id IS NOT NULL) AND (owner_id IS NULL)) OR ((group_id IS NULL) AND (owner_id IS NOT NULL))`),
]);

export const groupCourseLessons = pgTable("group_course_lessons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	courseId: uuid("course_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	videoUrl: text("video_url"),
	thumbnailUrl: text("thumbnail_url"),
	duration: integer().default(0),
	sortOrder: integer("sort_order").default(0).notNull(),
	isPublished: boolean("is_published").default(true).notNull(),
	isFreePreview: boolean("is_free_preview").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	moduleId: uuid("module_id"),
	videoSourceType: videoSourceType("video_source_type"),
}, (table) => [
	index("idx_group_course_lessons_course").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_course_lessons_module_order").using("btree", table.moduleId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("uuid_ops")),
	index("idx_group_course_lessons_order").using("btree", table.courseId.asc().nullsLast().op("uuid_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [groupCourses.id],
			name: "group_course_lessons_course_id_group_courses_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moduleId],
			foreignColumns: [groupCourseModules.id],
			name: "group_course_lessons_module_id_group_course_modules_id_fk"
		}).onDelete("cascade"),
]);

export const groupCourseEnrollments = pgTable("group_course_enrollments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	courseId: uuid("course_id").notNull(),
	userId: uuid("user_id").notNull(),
	status: courseEnrollmentStatus().default('active').notNull(),
	amountPaid: numeric("amount_paid", { precision: 10, scale:  2 }).default('0').notNull(),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_course_enrollments_course").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_course_enrollments_unique").using("btree", table.courseId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_course_enrollments_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [groupCourses.id],
			name: "group_course_enrollments_course_id_group_courses_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_course_enrollments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const suspensionAppeals = pgTable("suspension_appeals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	reason: text().notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	adminId: uuid("admin_id"),
	adminResponse: text("admin_response"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	newSuspendedUntil: timestamp("new_suspended_until", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_suspension_appeals_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_suspension_appeals_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "suspension_appeals_admin_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "suspension_appeals_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	eventId: uuid("event_id").notNull(),
	totalAmount: numeric("total_amount", { precision: 10, scale:  2 }).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	paymentMethodId: uuid("payment_method_id"),
	paymentIntentId: varchar("payment_intent_id", { length: 255 }),
	billingAddress: jsonb("billing_address"),
	qrVerified: boolean("qr_verified").default(false),
	qrVerifiedAt: timestamp("qr_verified_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	receiptUrl: varchar("receipt_url", { length: 255 }).default(sql`NULL`),
	reserveAmountCents: integer("reserve_amount_cents").default(0),
	reserveReleasedAt: timestamp("reserve_released_at", { withTimezone: true, mode: 'string' }),
	stripeFeeCents: integer("stripe_fee_cents").default(0),
	platformShareCents: integer("platform_share_cents").default(0),
	transferId: varchar("transfer_id", { length: 255 }),
	transferredAt: timestamp("transferred_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_orders_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_orders_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_orders_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "orders_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paymentMethodId],
			foreignColumns: [paymentMethods.id],
			name: "orders_payment_method_id_payment_methods_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "orders_user_id_users_id_fk"
		}).onDelete("cascade"),
	check("total_amount_check", sql`total_amount >= (0)::numeric`),
]);

export const groupCourseLessonProgress = pgTable("group_course_lesson_progress", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	enrollmentId: uuid("enrollment_id").notNull(),
	lessonId: uuid("lesson_id").notNull(),
	userId: uuid("user_id").notNull(),
	watchedSeconds: integer("watched_seconds").default(0).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_lesson_progress_enrollment").using("btree", table.enrollmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_lesson_progress_lesson").using("btree", table.lessonId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_lesson_progress_unique").using("btree", table.enrollmentId.asc().nullsLast().op("uuid_ops"), table.lessonId.asc().nullsLast().op("uuid_ops")),
	index("idx_lesson_progress_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.enrollmentId],
			foreignColumns: [groupCourseEnrollments.id],
			name: "group_course_lesson_progress_enrollment_id_group_course_enrollm"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [groupCourseLessons.id],
			name: "group_course_lesson_progress_lesson_id_group_course_lessons_id_"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_course_lesson_progress_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const demoRegistrations = pgTable("demo_registrations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	demoSessionId: uuid("demo_session_id").notNull(),
	firstName: varchar("first_name", { length: 100 }).notNull(),
	lastName: varchar("last_name", { length: 100 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	audience: varchar({ length: 20 }).notNull(),
	audienceType: varchar("audience_type", { length: 100 }),
	primaryCategory: varchar("primary_category", { length: 255 }).notNull(),
	scaleMetric: varchar("scale_metric", { length: 255 }).notNull(),
	currentPlatform: varchar("current_platform", { length: 255 }),
	goals: text(),
	status: varchar({ length: 20 }).default('pending'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.demoSessionId],
			foreignColumns: [demoSessions.id],
			name: "demo_registrations_demo_session_id_demo_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const demoSessions = pgTable("demo_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }).notNull(),
	durationMinutes: integer("duration_minutes").default(60),
	streamCallId: varchar("stream_call_id", { length: 255 }),
	streamCallType: varchar("stream_call_type", { length: 50 }).default('default'),
	inviteLink: varchar("invite_link", { length: 500 }),
	maxParticipants: integer("max_participants"),
	status: varchar({ length: 20 }).default('upcoming'),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	meetingType: varchar("meeting_type", { length: 20 }).default('stream'),
	externalMeetingLink: varchar("external_meeting_link", { length: 500 }),
	sessionType: varchar("session_type", { length: 20 }),
});

export const talentIssues = pgTable("talent_issues", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reporterId: uuid("reporter_id").notNull(),
	talentUserId: uuid("talent_user_id").notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	entityType: varchar("entity_type", { length: 30 }).notNull(),
	entityId: uuid("entity_id").notNull(),
	reason: varchar({ length: 50 }).notNull(),
	message: text().notNull(),
	amountCents: integer("amount_cents").notNull(),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	status: varchar({ length: 20 }).default('pending').notNull(),
	adminId: uuid("admin_id"),
	adminNote: text("admin_note"),
	refundIssued: boolean("refund_issued").default(false).notNull(),
	refundAmountCents: integer("refund_amount_cents"),
	stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
	warningIssued: boolean("warning_issued").default(false).notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_talent_issues_entity").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_issues_reporter").using("btree", table.reporterId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_issues_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_talent_issues_talent_user").using("btree", table.talentUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "talent_issues_admin_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [users.id],
			name: "talent_issues_reporter_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_issues_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.talentUserId],
			foreignColumns: [users.id],
			name: "talent_issues_talent_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const talentReviews = pgTable("talent_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	reviewerId: uuid("reviewer_id").notNull(),
	sessionId: uuid("session_id"),
	rating: integer().notNull(),
	communicationRating: integer("communication_rating"),
	valueRating: integer("value_rating"),
	title: varchar({ length: 150 }),
	comment: text(),
	isVisible: boolean("is_visible").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sourceType: varchar("source_type", { length: 30 }).default('session').notNull(),
	priorityMessageId: uuid("priority_message_id"),
	reportedAt: timestamp("reported_at", { withTimezone: true, mode: 'string' }),
	reportReason: text("report_reason"),
	shopCustomOfferId: uuid("shop_custom_offer_id"),
}, (table) => [
	index("idx_talent_reviews_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_reviews_custom_offer").using("btree", table.shopCustomOfferId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_reviews_profile").using("btree", table.talentProfileId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_reviews_rating").using("btree", table.rating.asc().nullsLast().op("int4_ops")),
	index("idx_talent_reviews_reviewer").using("btree", table.reviewerId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_reviews_session").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("idx_talent_reviews_source").using("btree", table.sourceType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [users.id],
			name: "talent_reviews_reviewer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [talentSessions.id],
			name: "talent_reviews_session_id_talent_sessions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shopCustomOfferId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "talent_reviews_shop_custom_offer_id_shop_custom_service_offers_"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "talent_reviews_talent_profile_id_talent_profiles_id_fk"
		}).onDelete("cascade"),
	unique("uq_talent_reviews_session").on(table.sessionId),
	check("communication_rating_range", sql`(communication_rating IS NULL) OR ((communication_rating >= 1) AND (communication_rating <= 5))`),
	check("rating_range", sql`(rating >= 1) AND (rating <= 5)`),
	check("value_rating_range", sql`(value_rating IS NULL) OR ((value_rating >= 1) AND (value_rating <= 5))`),
]);

export const organizerSocialLinks = pgTable("organizer_social_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id"),
	instagram: text(),
	twitter: text(),
	facebook: text(),
	linkedin: text(),
	youtube: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	talentProfileId: uuid("talent_profile_id"),
}, (table) => [
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "organizer_social_links_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "organizer_social_links_talent_profile_id_fkey"
		}).onDelete("cascade"),
	unique("organizer_social_links_organizer_id_unique").on(table.organizerId),
	unique("organizer_social_links_talent_profile_id_unique").on(table.talentProfileId),
	check("chk_social_links_one_owner", sql`((organizer_id IS NOT NULL) AND (talent_profile_id IS NULL)) OR ((organizer_id IS NULL) AND (talent_profile_id IS NOT NULL))`),
]);

export const storyCollections = pgTable("story_collections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	coverImage: text("cover_image"),
	sortOrder: integer("sort_order").default(0).notNull(),
	itemsCount: integer("items_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("story_collections_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("story_collections_user_sort_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_collections_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyCollectionItems = pgTable("story_collection_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	collectionId: uuid("collection_id").notNull(),
	itemType: varchar("item_type", { length: 10 }).notNull(),
	storyId: uuid("story_id"),
	postId: uuid("post_id"),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("story_collection_items_collection_id_idx").using("btree", table.collectionId.asc().nullsLast().op("uuid_ops")),
	index("story_collection_items_item_type_idx").using("btree", table.itemType.asc().nullsLast().op("text_ops")),
	index("story_collection_items_post_id_idx").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("story_collection_items_story_id_idx").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.collectionId],
			foreignColumns: [storyCollections.id],
			name: "story_collection_items_collection_id_story_collections_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "story_collection_items_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_collection_items_story_id_stories_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firebaseUid: varchar("firebase_uid", { length: 255 }),
	username: varchar({ length: 50 }),
	email: varchar({ length: 255 }),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	name: varchar({ length: 255 }),
	firstName: varchar("first_name", { length: 100 }).notNull(),
	lastName: varchar("last_name", { length: 100 }).notNull(),
	dob: date(),
	image: text(),
	bio: text(),
	phoneNumber: varchar("phone_number", { length: 20 }),
	emailVerified: timestamp({ mode: 'string' }),
	isEmailVerified: boolean("is_email_verified").default(false),
	verificationToken: varchar("verification_token", { length: 255 }),
	verificationExpires: timestamp("verification_expires", { withTimezone: true, mode: 'string' }),
	resetPasswordToken: varchar("reset_password_token", { length: 255 }),
	resetPasswordExpires: timestamp("reset_password_expires", { withTimezone: true, mode: 'string' }),
	resetPasswordOtp: varchar("reset_password_otp", { length: 6 }),
	resetPasswordOtpExpires: timestamp("reset_password_otp_expires", { withTimezone: true, mode: 'string' }),
	preferences: jsonb().default({}),
	fcmTokens: text("fcm_tokens").array().default([""]),
	lastLogin: timestamp("last_login", { withTimezone: true, mode: 'string' }),
	loginCount: integer("login_count").default(0),
	timezone: varchar({ length: 50 }).default('UTC'),
	locale: varchar({ length: 10 }).default('en-US'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	isSuspended: boolean("is_suspended").default(false),
	suspendedUntil: timestamp("suspended_until", { withTimezone: true, mode: 'string' }),
	suspensionReason: text("suspension_reason"),
	// TODO: failed to parse database type 'tsvector'
	userSearch: unknown("user_search").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, (((((COALESCE(first_name, ''::character varying))::text || ' '::text) || (COALESCE(last_name, ''::character varying))::text) || ' '::text) || (COALESCE(username, ''::character varying))::text))`),
	isBritesidePlus: boolean("is_briteside_plus").default(false),
	showLastSeen: boolean("show_last_seen").default(true),
	lastSeen: timestamp("last_seen", { withTimezone: true, mode: 'string' }),
	showOnlineStatus: boolean("show_online_status").default(true),
	allowSearchByEmail: boolean("allow_search_by_email").default(false),
	allowSearchByPhone: boolean("allow_search_by_phone").default(false),
	allowTagging: boolean("allow_tagging").default(true),
	allowMessagesFrom: varchar("allow_messages_from", { length: 20 }).default('everyone'),
	allowCallsFrom: varchar("allow_calls_from", { length: 20 }).default('everyone'),
	profanityFilterEnabled: boolean("profanity_filter_enabled").default(false),
	isVerifiedAdult: boolean("is_verified_adult").default(false),
	ageVerificationSource: varchar("age_verification_source", { length: 50 }).default('pending'),
}, (table) => [
	index("idx_users_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("idx_users_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_users_firebase_uid").using("btree", table.firebaseUid.asc().nullsLast().op("text_ops")),
	index("idx_users_phone").using("btree", table.phoneNumber.asc().nullsLast().op("text_ops")),
	index("idx_users_search_fts").using("gin", table.userSearch.asc().nullsLast().op("tsvector_ops")),
	index("idx_users_username").using("btree", table.username.asc().nullsLast().op("text_ops")),
	index("idx_users_verified").using("btree", table.isEmailVerified.asc().nullsLast().op("bool_ops")).where(sql`(is_email_verified = true)`),
	unique("users_email_unique").on(table.email),
	unique("users_firebase_uid_unique").on(table.firebaseUid),
	unique("users_phone_number_unique").on(table.phoneNumber),
	unique("users_username_unique").on(table.username),
]);

export const bioLinks = pgTable("bio_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: varchar({ length: 100 }).notNull(),
	url: varchar({ length: 2000 }).notNull(),
	icon: varchar({ length: 50 }),
	clickCount: integer("click_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bio_links_user_created_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("bio_links_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "bio_links_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const eventTicketScheduleInventory = pgTable("event_ticket_schedule_inventory", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	ticketTierId: uuid("ticket_tier_id").notNull(),
	scheduleId: uuid("schedule_id").notNull(),
	quantityAvailable: integer("quantity_available").default(0).notNull(),
	quantitySold: integer("quantity_sold").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_ticket_schedule_inv_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_schedule_inv_schedule").using("btree", table.scheduleId.asc().nullsLast().op("uuid_ops")),
	index("idx_ticket_schedule_inv_ticket").using("btree", table.ticketTierId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_ticket_schedule_inventory_event_id_events_id_fk"
		}).onDelete("cascade"),
	check("qty_available_check", sql`quantity_available >= 0`),
	check("qty_sold_check", sql`quantity_sold >= 0`),
	check("qty_sold_lte_available", sql`quantity_sold <= quantity_available`),
]);

export const followerInviteLog = pgTable("follower_invite_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizerId: uuid("organizer_id").notNull(),
	eventId: uuid("event_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_follower_invite_log_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("idx_follower_invite_log_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "follower_invite_log_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "follower_invite_log_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
]);

export const storyComments = pgTable("story_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storyId: uuid("story_id").notNull(),
	userId: uuid("user_id").notNull(),
	parentId: uuid("parent_id"),
	content: text().notNull(),
	likesCount: integer("likes_count").default(0).notNull(),
	repliesCount: integer("replies_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_story_comments_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_story_comments_parent").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_comments_story").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	index("idx_story_comments_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "story_comments_parent_id_story_comments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "story_comments_story_id_stories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "story_comments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const profileViewSessions = pgTable("profile_view_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	profileId: uuid("profile_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_profile_view_sessions_profile").using("btree", table.profileId.asc().nullsLast().op("uuid_ops")),
	index("idx_profile_view_sessions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_profile_view_sessions_viewed_at").using("btree", table.viewedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [socialProfiles.id],
			name: "profile_view_sessions_profile_id_social_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profile_view_sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postCollaborators = pgTable("post_collaborators", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	collaboratorId: uuid("collaborator_id").notNull(),
	invitedById: uuid("invited_by_id").notNull(),
	status: collaboratorStatus().default('pending').notNull(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_collaborators_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_collaborators_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("idx_post_collaborators_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.collaboratorId.asc().nullsLast().op("uuid_ops")),
	index("idx_post_collaborators_user").using("btree", table.collaboratorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.collaboratorId],
			foreignColumns: [users.id],
			name: "post_collaborators_collaborator_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedById],
			foreignColumns: [users.id],
			name: "post_collaborators_invited_by_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_collaborators_post_id_posts_id_fk"
		}).onDelete("cascade"),
]);

export const imports = pgTable("imports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	status: importStatus().default('draft').notNull(),
	totalImages: integer("total_images").default(0).notNull(),
	processedImages: integer("processed_images").default(0).notNull(),
	failedImages: integer("failed_images").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	duplicateImages: integer("duplicate_images").default(0).notNull(),
}, (table) => [
	index("idx_imports_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_imports_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("one_draft_per_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'draft'::import_status)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "imports_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const importImages = pgTable("import_images", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	importId: uuid("import_id").notNull(),
	userId: uuid("user_id").notNull(),
	s3Key: text("s3_key").notNull(),
	originalFilename: varchar("original_filename", { length: 255 }),
	caption: varchar({ length: 500 }),
	displayOrder: smallint("display_order").notNull(),
	status: imageStatus().default('pending').notNull(),
	createdPostId: uuid("created_post_id"),
	failReason: text("fail_reason"),
	retryCount: integer("retry_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	fileHash: varchar("file_hash", { length: 64 }),
}, (table) => [
	index("idx_import_images_import_id").using("btree", table.importId.asc().nullsLast().op("uuid_ops")),
	index("idx_import_images_import_status").using("btree", table.importId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("idx_import_images_user_hash").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.fileHash.asc().nullsLast().op("uuid_ops")).where(sql`(file_hash IS NOT NULL)`),
	index("idx_import_images_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdPostId],
			foreignColumns: [posts.id],
			name: "import_images_created_post_id_posts_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.importId],
			foreignColumns: [imports.id],
			name: "import_images_import_id_imports_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "import_images_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const priorityMessageItems = pgTable("priority_message_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paymentId: uuid("payment_id").notNull(),
	position: integer().default(0).notNull(),
	repliedAt: timestamp("replied_at", { withTimezone: true, mode: 'string' }),
	replyMessageId: uuid("reply_message_id"),
	subject: varchar({ length: 255 }),
	messageContent: text("message_content").notNull(),
	messageId: uuid("message_id"),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	replyCount: integer("reply_count").default(0).notNull(),
	contentExtended: text("content_extended"),
}, (table) => [
	index("idx_pmi_message").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
	index("idx_pmi_payment").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	index("idx_pmi_payment_position").using("btree", table.paymentId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("uuid_ops")),
	index("idx_pmi_replied_at").using("btree", table.repliedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_pmi_reply_message").using("btree", table.replyMessageId.asc().nullsLast().op("uuid_ops")),
	index("idx_pmi_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [socialMessages.id],
			name: "priority_message_items_message_id_social_messages_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.replyMessageId],
			foreignColumns: [socialMessages.id],
			name: "priority_message_items_reply_message_id_social_messages_id_fk"
		}).onDelete("set null"),
	check("chk_content_extended_length", sql`char_length(content_extended) <= 1400`),
]);

export const priorityMessageAttachments = pgTable("priority_message_attachments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paymentId: uuid("payment_id").notNull(),
	itemId: uuid("item_id"),
	mediaId: uuid("media_id").notNull(),
	uploadedBy: uuid("uploaded_by").notNull(),
	url: text().notNull(),
	s3Key: text("s3_key").notNull(),
	originalName: varchar("original_name", { length: 255 }),
	mimetype: varchar({ length: 100 }),
	sizeBytes: integer("size_bytes"),
	priceCents: integer("price_cents").default(99).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pma_item").using("btree", table.itemId.asc().nullsLast().op("uuid_ops")),
	index("idx_pma_payment").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	index("idx_pma_payment_status").using("btree", table.paymentId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("idx_pma_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.mediaId],
			foreignColumns: [media.id],
			name: "priority_message_attachments_media_id_media_id_fk"
		}),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "priority_message_attachments_uploaded_by_users_id_fk"
		}),
]);

export const userPostOrderCounter = pgTable("user_post_order_counter", {
	userId: uuid("user_id").primaryKey().notNull(),
	nextOrder: integer("next_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_post_order_counter_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const contentModeration = pgTable("content_moderation", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	mediaId: uuid("media_id"),
	postId: uuid("post_id"),
	storyId: uuid("story_id"),
	userId: uuid("user_id"),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	status: varchar({ length: 16 }).default('pending').notNull(),
	reviewId: text("review_id"),
	labels: jsonb().default([]),
	moderatedAt: timestamp("moderated_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	eventId: uuid("event_id"),
	groupId: uuid("group_id"),
	discussionId: uuid("discussion_id"),
}, (table) => [
	uniqueIndex("idx_content_moderation_discussion").using("btree", table.discussionId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_content_moderation_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_content_moderation_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_content_moderation_media").using("btree", table.mediaId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_content_moderation_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_content_moderation_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_content_moderation_story").using("btree", table.storyId.asc().nullsLast().op("uuid_ops")),
	index("idx_content_moderation_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "content_moderation_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "content_moderation_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "content_moderation_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mediaId],
			foreignColumns: [media.id],
			name: "content_moderation_media_id_media_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "content_moderation_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storyId],
			foreignColumns: [stories.id],
			name: "content_moderation_story_id_stories_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "content_moderation_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const textModeration = pgTable("text_moderation", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	entityId: uuid("entity_id").notNull(),
	userId: uuid("user_id"),
	status: varchar({ length: 16 }).default('flagged').notNull(),
	fields: jsonb().default({}).notNull(),
	reviewId: text("review_id"),
	labels: jsonb().default([]),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	severity: varchar({ length: 16 }),
}, (table) => [
	uniqueIndex("idx_text_moderation_entity").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("text_ops")),
	index("idx_text_moderation_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_text_moderation_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "text_moderation_reviewed_by_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "text_moderation_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const pinnedProfiles = pgTable("pinned_profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	pinnedUserId: uuid("pinned_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pinned_profiles_pinned_user").using("btree", table.pinnedUserId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_pinned_profiles_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.pinnedUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_pinned_profiles_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pinnedUserId],
			foreignColumns: [users.id],
			name: "pinned_profiles_pinned_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "pinned_profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postShopProducts = pgTable("post_shop_products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	productId: uuid("product_id").notNull(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_shop_products_post").using("btree", table.postId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	index("idx_post_shop_products_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_post_shop_products_unique").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_shop_products_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "post_shop_products_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
	check("post_shop_products_position_range", sql`("position" >= 0) AND ("position" <= 2)`),
]);

export const shopProductViews = pgTable("shop_product_views", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_shop_product_views_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_shop_product_views_unique").using("btree", table.productId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_product_views_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_product_views_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "shop_product_views_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupShopProducts = pgTable("group_shop_products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	productId: uuid("product_id").notNull(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_group_shop_products_group").using("btree", table.groupId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	index("idx_group_shop_products_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_group_shop_products_unique").using("btree", table.groupId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_shop_products_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "group_shop_products_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
]);

export const shopRefundRequests = pgTable("shop_refund_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	sellerId: uuid("seller_id").notNull(),
	reason: varchar({ length: 50 }).notNull(),
	message: text().notNull(),
	amountCents: integer("amount_cents").notNull(),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	status: varchar({ length: 20 }).default('pending').notNull(),
	resolvedByUserId: uuid("resolved_by_user_id"),
	resolvedByRole: varchar("resolved_by_role", { length: 10 }),
	resolutionNote: text("resolution_note"),
	refundAmountCents: integer("refund_amount_cents"),
	stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_shop_refund_requests_buyer").using("btree", table.buyerId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_refund_requests_seller").using("btree", table.sellerId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_refund_requests_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_refund_requests_buyer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [shopOrders.id],
			name: "shop_refund_requests_order_id_shop_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resolvedByUserId],
			foreignColumns: [users.id],
			name: "shop_refund_requests_resolved_by_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "shop_refund_requests_seller_id_users_id_fk"
		}).onDelete("cascade"),
	unique("shop_refund_requests_order_id_unique").on(table.orderId),
]);

export const shopOrders = pgTable("shop_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	sellerId: uuid("seller_id").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	productTitleSnapshot: varchar("product_title_snapshot", { length: 200 }).notNull(),
	priceCents: integer("price_cents").notNull(),
	chargedCents: integer("charged_cents").notNull(),
	sellerReceiveCents: integer("seller_receive_cents").notNull(),
	platformShareCents: integer("platform_share_cents").notNull(),
	refundsAllowedSnapshot: boolean("refunds_allowed_snapshot").notNull(),
	refundWindowDaysSnapshot: integer("refund_window_days_snapshot").notNull(),
	refundAfterDownloadSnapshot: boolean("refund_after_download_snapshot").notNull(),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	downloadCount: integer("download_count").default(0).notNull(),
	firstDownloadedAt: timestamp("first_downloaded_at", { withTimezone: true, mode: 'string' }),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	refundAmountCents: integer("refund_amount_cents"),
	stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	customerName: varchar("customer_name", { length: 200 }),
	customerEmail: varchar("customer_email", { length: 255 }),
}, (table) => [
	index("idx_shop_orders_buyer").using("btree", table.buyerId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_orders_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_orders_seller").using("btree", table.sellerId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_orders_seller_paid").using("btree", table.sellerId.asc().nullsLast().op("timestamptz_ops"), table.paidAt.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_orders_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_shop_orders_stripe_session").using("btree", table.stripeSessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_orders_buyer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_orders_product_id_shop_products_id_fk"
		}),
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "shop_orders_seller_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const storyShares = pgTable("story_shares", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storyId: uuid("story_id").notNull(),
	userId: uuid("user_id").notNull(),
	caption: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const groupAboutGallery = pgTable("group_about_gallery", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	uploaderId: uuid("uploader_id").notNull(),
	mediaUrl: text("media_url").notNull(),
	mediaType: varchar("media_type", { length: 50 }).notNull(),
	caption: text(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_about_gallery_group").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_about_gallery_uploader").using("btree", table.uploaderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_about_gallery_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaderId],
			foreignColumns: [users.id],
			name: "group_about_gallery_uploader_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const shopCustomServiceOffers = pgTable("shop_custom_service_offers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sellerId: uuid("seller_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	basedOnProductId: uuid("based_on_product_id"),
	title: varchar({ length: 200 }).notNull(),
	description: text().notNull(),
	priceCents: integer("price_cents").notNull(),
	turnaround: varchar({ length: 100 }),
	dueDate: timestamp("due_date", { withTimezone: true, mode: 'string' }),
	deliverables: text(),
	revisionsIncluded: boolean("revisions_included").default(false).notNull(),
	revisionsCount: integer("revisions_count"),
	paymentMode: shopPaymentMode("payment_mode").default('full').notNull(),
	depositPercent: integer("deposit_percent"),
	milestones: jsonb(),
	note: text(),
	status: shopCustomOfferStatus().default('pending').notNull(),
	chargedCents: integer("charged_cents"),
	sellerReceiveCents: integer("seller_receive_cents"),
	platformShareCents: integer("platform_share_cents"),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	basePriceCoveredCents: integer("base_price_covered_cents").default(0).notNull(),
	reviewReminderSentAt: timestamp("review_reminder_sent_at", { withTimezone: true, mode: 'string' }),
	revisionsUsedCount: integer("revisions_used_count").default(0).notNull(),
	turnaroundMinutes: integer("turnaround_minutes"),
	deliveryState: shopCustomOfferDeliveryState("delivery_state").default('awaiting_delivery').notNull(),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	attachments: jsonb().default([]).notNull(),
}, (table) => [
	index("idx_custom_offers_buyer_status").using("btree", table.buyerId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("idx_custom_offers_seller").using("btree", table.sellerId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_custom_offers_stripe_session").using("btree", table.stripeSessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.basedOnProductId],
			foreignColumns: [shopProducts.id],
			name: "shop_custom_service_offers_based_on_product_id_fkey"
		}),
	foreignKey({
			columns: [table.basedOnProductId],
			foreignColumns: [shopProducts.id],
			name: "shop_custom_service_offers_based_on_product_id_shop_products_id"
		}),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_custom_service_offers_buyer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_custom_service_offers_buyer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "shop_custom_service_offers_seller_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "shop_custom_service_offers_seller_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupMessageReactions = pgTable("group_message_reactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	messageId: uuid("message_id").notNull(),
	userId: uuid("user_id").notNull(),
	emoji: varchar({ length: 10 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_group_message_reactions_emoji").using("btree", table.emoji.asc().nullsLast().op("text_ops")),
	index("idx_group_message_reactions_message").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
	index("idx_group_message_reactions_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [groupChatMessages.id],
			name: "group_message_reactions_message_id_group_chat_messages_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_message_reactions_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_group_message_user_emoji").on(table.emoji, table.messageId, table.userId),
]);

export const groupCourseModules = pgTable("group_course_modules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	courseId: uuid("course_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_group_course_modules_course_order").using("btree", table.courseId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [groupCourses.id],
			name: "group_course_modules_course_id_group_courses_id_fk"
		}).onDelete("cascade"),
]);

export const groupCourseLessonAttachments = pgTable("group_course_lesson_attachments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	lessonId: uuid("lesson_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	fileUrl: text("file_url").notNull(),
	fileType: varchar("file_type", { length: 50 }),
	size: integer(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [groupCourseLessons.id],
			name: "group_course_lesson_attachments_lesson_id_group_course_lessons_"
		}).onDelete("cascade"),
]);

export const shopCourseModules = pgTable("shop_course_modules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	lessonsCount: integer("lessons_count").default(1).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_course_modules_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
]);

export const talentProfiles = pgTable("talent_profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	category: varchar({ length: 100 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	bio: text(),
	location: varchar({ length: 255 }),
	introVideoUrl: varchar("intro_video_url", { length: 500 }),
	rates: jsonb().default({}).notNull(),
	languages: jsonb().default([]).notNull(),
	isVerified: boolean("is_verified").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	rating: numeric({ precision: 3, scale:  2 }).default('0.00'),
	reviewCount: integer("review_count").default(0).notNull(),
	totalSessions: integer("total_sessions").default(0).notNull(),
	priorityMessageFee: integer("priority_message_fee").default(500).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	// TODO: failed to parse database type 'tsvector'
	talentSearch: unknown("talent_search").generatedAlwaysAs(sql`((setweight(to_tsvector('simple'::regconfig, (COALESCE(category, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, (COALESCE(title, ''::character varying))::text), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(bio, ''::text)), 'C'::"char"))`),
	media: jsonb().default([]).notNull(),
	experience: jsonb().default([]).notNull(),
	education: jsonb().default([]).notNull(),
	qualifications: jsonb().default([]).notNull(),
	skills: jsonb().default([]).notNull(),
	shareCount: integer("share_count").default(0).notNull(),
	showShopProducts: boolean("show_shop_products").default(false).notNull(),
	city: varchar({ length: 100 }),
	state: varchar({ length: 100 }),
	country: varchar({ length: 100 }),
	countryCode: varchar("country_code", { length: 4 }),
	latitude: numeric({ precision: 10, scale:  7 }),
	longitude: numeric({ precision: 10, scale:  7 }),
	priorityMessagingEnabled: boolean("priority_messaging_enabled").default(true).notNull(),
}, (table) => [
	index("idx_talent_profiles_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_talent_profiles_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_talent_profiles_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_talent_profiles_rating").using("btree", table.rating.asc().nullsLast().op("numeric_ops")),
	index("idx_talent_profiles_search_fts").using("gin", table.talentSearch.asc().nullsLast().op("tsvector_ops")),
	index("idx_talent_profiles_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "talent_profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("talent_profiles_user_id_unique").on(table.userId),
]);

export const shopProducts = pgTable("shop_products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	priceCents: integer("price_cents").default(0).notNull(),
	coverUrl: varchar("cover_url", { length: 500 }),
	coverType: varchar("cover_type", { length: 10 }),
	gallery: jsonb().default([]).notNull(),
	ctaTitle: varchar("cta_title", { length: 100 }),
	buttonAction: varchar("button_action", { length: 20 }).default('payment').notNull(),
	redirectUrl: varchar("redirect_url", { length: 500 }),
	deliveryType: varchar("delivery_type", { length: 10 }),
	deliveryFileKey: varchar("delivery_file_key", { length: 500 }),
	deliveryFileName: varchar("delivery_file_name", { length: 255 }),
	deliveryLink: varchar("delivery_link", { length: 500 }),
	displayOrder: integer("display_order").default(0).notNull(),
	viewsCount: integer("views_count").default(0).notNull(),
	salesCount: integer("sales_count").default(0).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isPinned: boolean("is_pinned").default(false).notNull(),
	pinOrder: integer("pin_order"),
	listingType: shopListingType("listing_type").default('product').notNull(),
	serviceKind: varchar("service_kind", { length: 20 }),
	turnaround: varchar({ length: 100 }),
	cancellationPolicy: text("cancellation_policy"),
	revisionsIncluded: boolean("revisions_included"),
	revisionsCount: integer("revisions_count"),
	pricingModel: varchar("pricing_model", { length: 20 }),
	fromPrice: boolean("from_price"),
	paymentMode: shopPaymentMode("payment_mode"),
	depositPercent: integer("deposit_percent"),
	milestones: jsonb(),
	courseModules: jsonb("course_modules").default([]).notNull(),
	isPhysical: boolean("is_physical").default(false).notNull(),
	publishedToShop: boolean("published_to_shop").default(true).notNull(),
}, (table) => [
	index("idx_shop_products_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_shop_products_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_shop_products_user_order").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")),
	index("idx_shop_products_user_pinned").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isPinned.asc().nullsLast().op("bool_ops"), table.pinOrder.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "shop_products_user_id_users_id_fk"
		}).onDelete("cascade"),
	check("shop_pin_order_range", sql`(pin_order IS NULL) OR ((pin_order >= 1) AND (pin_order <= 9))`),
]);

export const shopCustomOfferDeliverables = pgTable("shop_custom_offer_deliverables", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
	fileKey: varchar("file_key", { length: 500 }).notNull(),
	fileName: varchar("file_name", { length: 255 }).notNull(),
	fileType: varchar("file_type", { length: 10 }).notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	roundNumber: integer("round_number").default(1).notNull(),
}, (table) => [
	index("idx_custom_offer_deliverables_offer").using("btree", table.offerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_deliverables_offer_id_shop_custom_service_off"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_deliverables_uploaded_by_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const reserveAdjustments = pgTable("reserve_adjustments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id"),
	eventId: uuid("event_id"),
	organizerId: uuid("organizer_id"),
	adminId: uuid("admin_id").notNull(),
	action: varchar({ length: 30 }).notNull(),
	previousAmountCents: integer("previous_amount_cents"),
	newAmountCents: integer("new_amount_cents"),
	deltaCents: integer("delta_cents"),
	transferId: varchar("transfer_id", { length: 255 }),
	reason: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "reserve_adjustments_event_id_events_id_fk"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "reserve_adjustments_order_id_orders_id_fk"
		}),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "reserve_adjustments_organizer_id_organizers_id_fk"
		}),
]);

export const shopCustomOfferActivity = pgTable("shop_custom_offer_activity", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	actorUserId: uuid("actor_user_id").notNull(),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_custom_offer_activity_offer").using("btree", table.offerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_activity_actor_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_activity_offer_id_shop_custom_service_offers_"
		}).onDelete("cascade"),
]);

export const shopCustomOfferDateExtensionRequests = pgTable("shop_custom_offer_date_extension_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	requestedByUserId: uuid("requested_by_user_id").notNull(),
	originalDueDate: timestamp("original_due_date", { withTimezone: true, mode: 'string' }),
	requestedDueDate: timestamp("requested_due_date", { withTimezone: true, mode: 'string' }).notNull(),
	reason: text(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_date_extension_requests_offer").using("btree", table.offerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_date_extension_requests_offer_id_shop_custom_"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedByUserId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_date_extension_requests_requested_by_user_id_"
		}).onDelete("cascade"),
]);

export const shopCustomOfferDisputes = pgTable("shop_custom_offer_disputes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	raisedByUserId: uuid("raised_by_user_id").notNull(),
	reason: varchar({ length: 50 }).notNull(),
	message: text().notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	resolvedByUserId: uuid("resolved_by_user_id"),
	resolutionNote: text("resolution_note"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_custom_offer_disputes_offer").using("btree", table.offerId.asc().nullsLast().op("uuid_ops")),
	index("idx_custom_offer_disputes_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_disputes_offer_id_shop_custom_service_offers_"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.raisedByUserId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_disputes_raised_by_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resolvedByUserId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_disputes_resolved_by_user_id_users_id_fk"
		}),
]);

export const shopCustomOfferRevisionRequests = pgTable("shop_custom_offer_revision_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	roundNumber: integer("round_number").notNull(),
	message: text().notNull(),
	attachments: jsonb().default([]).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_revision_requests_offer").using("btree", table.offerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_revision_requests_status").using("btree", table.offerId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_revision_requests_buyer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_revision_requests_offer_id_shop_custom_servic"
		}).onDelete("cascade"),
]);

export const shopCustomOfferTips = pgTable("shop_custom_offer_tips", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	offerId: uuid("offer_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	sellerId: uuid("seller_id").notNull(),
	amountCents: integer("amount_cents").notNull(),
	chargedCents: integer("charged_cents").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	stripeSessionId: varchar("stripe_session_id", { length: 255 }),
	stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_custom_offer_tips_offer").using("btree", table.offerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_custom_offer_tips_stripe_session").using("btree", table.stripeSessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_tips_buyer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [shopCustomServiceOffers.id],
			name: "shop_custom_offer_tips_offer_id_shop_custom_service_offers_id_f"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "shop_custom_offer_tips_seller_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const postTabLinks = pgTable("post_tab_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: varchar({ length: 100 }).notNull(),
	url: varchar({ length: 500 }).notNull(),
	coverUrl: varchar("cover_url", { length: 500 }),
	coverType: varchar("cover_type", { length: 10 }),
	displayOrder: integer("display_order").default(0).notNull(),
	clicksCount: integer("clicks_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_post_tab_links_user_order").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "post_tab_links_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userPostOrder = pgTable("user_post_order", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	postId: uuid("post_id"),
	displayOrder: integer("display_order").notNull(),
	itemType: postTabItemType("item_type").default('post').notNull(),
	linkId: uuid("link_id"),
}, (table) => [
	uniqueIndex("idx_user_post_order_unique_link").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.linkId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_user_post_order_unique_post").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.postId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_post_order_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.displayOrder.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.linkId],
			foreignColumns: [postTabLinks.id],
			name: "user_post_order_link_id_post_tab_links_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "user_post_order_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_post_order_user_id_users_id_fk"
		}).onDelete("cascade"),
	check("user_post_order_item_ref", sql`((item_type = 'post'::post_tab_item_type) AND (post_id IS NOT NULL) AND (link_id IS NULL)) OR ((item_type = 'link'::post_tab_item_type) AND (link_id IS NOT NULL) AND (post_id IS NULL))`),
]);

export const pinnedPosts = pgTable("pinned_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	postId: uuid("post_id"),
	pinOrder: integer("pin_order").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	itemType: text("item_type").default('post').notNull(),
	linkId: uuid("link_id"),
}, (table) => [
	index("idx_pinned_posts_link").using("btree", table.linkId.asc().nullsLast().op("uuid_ops")),
	index("idx_pinned_posts_post").using("btree", table.postId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_pinned_posts_unique_link").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.linkId.asc().nullsLast().op("uuid_ops")).where(sql`(link_id IS NOT NULL)`),
	uniqueIndex("idx_pinned_posts_unique_post").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.postId.asc().nullsLast().op("uuid_ops")).where(sql`(post_id IS NOT NULL)`),
	index("idx_pinned_posts_user_order").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.pinOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.linkId],
			foreignColumns: [postTabLinks.id],
			name: "pinned_posts_link_id_post_tab_links_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "pinned_posts_post_id_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "pinned_posts_user_id_users_id_fk"
		}).onDelete("cascade"),
	check("pin_order_range", sql`(pin_order >= 1) AND (pin_order <= 9)`),
	check("pinned_item_type_consistency", sql`((item_type = 'post'::text) AND (post_id IS NOT NULL) AND (link_id IS NULL)) OR ((item_type = 'link'::text) AND (link_id IS NOT NULL) AND (post_id IS NULL))`),
]);

export const popularLinkCovers = pgTable("popular_link_covers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 60 }).notNull(),
	url: varchar({ length: 500 }).notNull(),
	coverType: varchar("cover_type", { length: 10 }).default('image'),
	createdByUserId: uuid("created_by_user_id"),
	displayOrder: integer("display_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_popular_link_covers_created_by").using("btree", table.createdByUserId.asc().nullsLast().op("uuid_ops")),
	index("idx_popular_link_covers_order").using("btree", table.displayOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "popular_link_covers_created_by_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const shopCourseLessons = pgTable("shop_course_lessons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	moduleId: uuid("module_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	videoUrl: text("video_url"),
	videoSourceType: videoSourceType("video_source_type"),
	thumbnailUrl: text("thumbnail_url"),
	duration: integer().default(0),
	sortOrder: integer("sort_order").default(0).notNull(),
	isPublished: boolean("is_published").default(true).notNull(),
	isFreePreview: boolean("is_free_preview").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_shop_course_lessons_module_order").using("btree", table.moduleId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	index("idx_shop_course_lessons_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.moduleId],
			foreignColumns: [shopCourseModules.id],
			name: "shop_course_lessons_module_id_shop_course_modules_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_course_lessons_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
]);

export const shopCourseLessonAttachments = pgTable("shop_course_lesson_attachments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	lessonId: uuid("lesson_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	fileUrl: text("file_url").notNull(),
	fileType: varchar("file_type", { length: 50 }),
	size: integer(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_shop_course_lesson_attachments_lesson").using("btree", table.lessonId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [shopCourseLessons.id],
			name: "shop_course_lesson_attachments_lesson_id_shop_course_lessons_id"
		}).onDelete("cascade"),
]);

export const shopCourseLessonProgress = pgTable("shop_course_lesson_progress", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	lessonId: uuid("lesson_id").notNull(),
	userId: uuid("user_id").notNull(),
	watchedSeconds: integer("watched_seconds").default(0).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_shop_lesson_progress_unique").using("btree", table.lessonId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_shop_lesson_progress_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.lessonId],
			foreignColumns: [shopCourseLessons.id],
			name: "shop_course_lesson_progress_lesson_id_shop_course_lessons_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "shop_course_lesson_progress_product_id_shop_products_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "shop_course_lesson_progress_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupResources = pgTable("group_resources", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	fileUrl: text("file_url").notNull(),
	fileName: varchar("file_name", { length: 255 }),
	fileType: varchar("file_type", { length: 100 }),
	size: integer(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_group_resources_creator").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("idx_group_resources_group").using("btree", table.groupId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "group_resources_created_by_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_resources_group_id_groups_id_fk"
		}).onDelete("cascade"),
]);

export const events = pgTable("events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventCode: varchar("event_code", { length: 50 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	organizerId: uuid("organizer_id").notNull(),
	venueId: uuid("venue_id"),
	eventType: varchar("event_type", { length: 20 }).default('public').notNull(),
	eventStatus: varchar("event_status", { length: 20 }).default('draft').notNull(),
	isFree: boolean("is_free").default(false),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }).notNull(),
	capacity: integer(),
	totalViews: integer("total_views").default(0),
	uniqueVisitors: integer("unique_visitors").default(0),
	conversionRate: numeric("conversion_rate", { precision: 5, scale:  2 }).default('0'),
	totalRevenue: numeric("total_revenue", { precision: 12, scale:  2 }).default('0'),
	checkInCount: integer("check_in_count").default(0),
	noShowCount: integer("no_show_count").default(0),
	likeCount: integer("like_count").default(0).notNull(),
	platformFeePercentage: numeric("platform_fee_percentage", { precision: 3, scale:  1 }).default('0.0').notNull(),
	refundPolicy: text("refund_policy"),
	termsConditions: text("terms_conditions"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	isRefundable: boolean("is_refundable").default(true).notNull(),
	refundCutoffDays: integer("refund_cutoff_days").default(3).notNull(),
	eventMode: varchar("event_mode", { length: 20 }).default('in_person').notNull(),
	coverImages: jsonb("cover_images").default([]),
	categoryIds: jsonb("category_ids").default([]),
	attendReason: varchar("attend_reason", { length: 500 }),
	eventHighlights: jsonb("event_highlights").default([]),
	showAttendeeCount: boolean("show_attendee_count").default(true).notNull(),
	groupId: uuid("group_id"),
	hostedBy: hostedEnum("hosted_by").default('organizer').notNull(),
	slug: varchar({ length: 300 }).notNull(),
	// TODO: failed to parse database type 'tsvector'
	eventSearch: unknown("event_search").generatedAlwaysAs(sql`(setweight(to_tsvector('english'::regconfig, (COALESCE(title, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char"))`),
	recurrenceRule: jsonb("recurrence_rule"),
	isChatEnabled: boolean("is_chat_enabled").default(true).notNull(),
	youtubeVideoUrl: varchar("youtube_video_url", { length: 500 }),
	doorSalesEnabled: boolean("door_sales_enabled").default(false).notNull(),
	doorSalesToken: varchar("door_sales_token", { length: 64 }),
	doorSalesTokenCreatedAt: timestamp("door_sales_token_created_at", { withTimezone: true, mode: 'string' }),
	snsTopicArn: varchar("sns_topic_arn", { length: 255 }),
	showLikeCount: boolean("show_like_count").default(true).notNull(),
	presetId: uuid("preset_id"),
	showTicketsRemaining: boolean("show_tickets_remaining").default(true).notNull(),
	cancellationReason: text("cancellation_reason"),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_events_dates").using("btree", table.startDate.asc().nullsLast().op("timestamptz_ops"), table.endDate.asc().nullsLast().op("timestamptz_ops")),
	index("idx_events_deleted").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_events_organizer").using("btree", table.organizerId.asc().nullsLast().op("uuid_ops")),
	index("idx_events_preset").using("btree", table.presetId.asc().nullsLast().op("uuid_ops")),
	index("idx_events_search_fts").using("gin", table.eventSearch.asc().nullsLast().op("tsvector_ops")),
	index("idx_events_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("idx_events_start_date").using("btree", table.startDate.asc().nullsLast().op("timestamptz_ops")),
	index("idx_events_status").using("btree", table.eventStatus.asc().nullsLast().op("text_ops")),
	index("idx_events_venue").using("btree", table.venueId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organizerId],
			foreignColumns: [organizers.id],
			name: "events_organizer_id_organizers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.presetId],
			foreignColumns: [organizerPresets.id],
			name: "events_preset_id_organizer_presets_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "events_venue_id_venues_id_fk"
		}).onDelete("set null"),
	unique("events_event_code_unique").on(table.eventCode),
	check("end_date_check", sql`end_date > start_date`),
]);

export const eventMarketingSettings = pgTable("event_marketing_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	metaPixelId: varchar("meta_pixel_id", { length: 100 }),
	tiktokPixelId: varchar("tiktok_pixel_id", { length: 100 }),
	googleAdsId: varchar("google_ads_id", { length: 100 }),
	googleAnalyticsId: varchar("google_analytics_id", { length: 100 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("idx_event_marketing_settings_event").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_marketing_settings_event_id_fkey"
		}).onDelete("cascade"),
]);

export const analyticsEvents202609 = pgTable("analytics_events_2026_09", {
	id: uuid().defaultRandom().notNull(),
	eventName: varchar("event_name", { length: 64 }).notNull(),
	entityType: varchar("entity_type", { length: 32 }).notNull(),
	entityId: uuid("entity_id"),
	userId: uuid("user_id"),
	anonymousId: varchar("anonymous_id", { length: 64 }),
	sessionId: varchar("session_id", { length: 64 }),
	clientEventId: uuid("client_event_id").notNull(),
	properties: jsonb().default({}).notNull(),
	context: jsonb(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("analytics_events_2026_09_anonymous_id_occurred_at_idx").using("btree", table.anonymousId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(anonymous_id IS NOT NULL)`),
	uniqueIndex("analytics_events_2026_09_client_event_id_occurred_at_idx").using("btree", table.clientEventId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_09_entity_type_entity_id_event_name_o_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.eventName.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_09_entity_type_entity_id_occurred_at_idx").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_09_session_id_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_09_user_id_occurred_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_events_user_id_fkey"
		}).onDelete("set null"),
]);

export const analyticsEvents202610 = pgTable("analytics_events_2026_10", {
	id: uuid().defaultRandom().notNull(),
	eventName: varchar("event_name", { length: 64 }).notNull(),
	entityType: varchar("entity_type", { length: 32 }).notNull(),
	entityId: uuid("entity_id"),
	userId: uuid("user_id"),
	anonymousId: varchar("anonymous_id", { length: 64 }),
	sessionId: varchar("session_id", { length: 64 }),
	clientEventId: uuid("client_event_id").notNull(),
	properties: jsonb().default({}).notNull(),
	context: jsonb(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("analytics_events_2026_10_anonymous_id_occurred_at_idx").using("btree", table.anonymousId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(anonymous_id IS NOT NULL)`),
	uniqueIndex("analytics_events_2026_10_client_event_id_occurred_at_idx").using("btree", table.clientEventId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_10_entity_type_entity_id_event_name_o_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.eventName.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_10_entity_type_entity_id_occurred_at_idx").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_10_session_id_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_10_user_id_occurred_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_events_user_id_fkey"
		}).onDelete("set null"),
]);

export const analyticsEvents202611 = pgTable("analytics_events_2026_11", {
	id: uuid().defaultRandom().notNull(),
	eventName: varchar("event_name", { length: 64 }).notNull(),
	entityType: varchar("entity_type", { length: 32 }).notNull(),
	entityId: uuid("entity_id"),
	userId: uuid("user_id"),
	anonymousId: varchar("anonymous_id", { length: 64 }),
	sessionId: varchar("session_id", { length: 64 }),
	clientEventId: uuid("client_event_id").notNull(),
	properties: jsonb().default({}).notNull(),
	context: jsonb(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("analytics_events_2026_11_anonymous_id_occurred_at_idx").using("btree", table.anonymousId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(anonymous_id IS NOT NULL)`),
	uniqueIndex("analytics_events_2026_11_client_event_id_occurred_at_idx").using("btree", table.clientEventId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_11_entity_type_entity_id_event_name_o_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.eventName.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_11_entity_type_entity_id_occurred_at_idx").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_11_session_id_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_11_user_id_occurred_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_events_user_id_fkey"
		}).onDelete("set null"),
]);

export const analyticsEvents202612 = pgTable("analytics_events_2026_12", {
	id: uuid().defaultRandom().notNull(),
	eventName: varchar("event_name", { length: 64 }).notNull(),
	entityType: varchar("entity_type", { length: 32 }).notNull(),
	entityId: uuid("entity_id"),
	userId: uuid("user_id"),
	anonymousId: varchar("anonymous_id", { length: 64 }),
	sessionId: varchar("session_id", { length: 64 }),
	clientEventId: uuid("client_event_id").notNull(),
	properties: jsonb().default({}).notNull(),
	context: jsonb(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("analytics_events_2026_12_anonymous_id_occurred_at_idx").using("btree", table.anonymousId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(anonymous_id IS NOT NULL)`),
	uniqueIndex("analytics_events_2026_12_client_event_id_occurred_at_idx").using("btree", table.clientEventId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_12_entity_type_entity_id_event_name_o_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.eventName.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_12_entity_type_entity_id_occurred_at_idx").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("analytics_events_2026_12_session_id_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	index("analytics_events_2026_12_user_id_occurred_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_events_user_id_fkey"
		}).onDelete("set null"),
]);

export const analyticsIdentityLinks = pgTable("analytics_identity_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	anonymousId: varchar("anonymous_id", { length: 64 }).notNull(),
	userId: uuid("user_id").notNull(),
	linkedAt: timestamp("linked_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_analytics_identity_links_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_analytics_identity_links").using("btree", table.anonymousId.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_identity_links_user_id_fkey"
		}).onDelete("cascade"),
]);

export const postAnalyticsDaily = pgTable("post_analytics_daily", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	date: date().notNull(),
	impressions: integer().default(0).notNull(),
	views: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	comments: integer().default(0).notNull(),
	likes: integer().default(0).notNull(),
	shares: integer().default(0).notNull(),
	saves: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_post_analytics_daily").using("btree", table.postId.asc().nullsLast().op("date_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_analytics_daily_post_id_fkey"
		}).onDelete("cascade"),
]);

export const groupAnalyticsDaily = pgTable("group_analytics_daily", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	date: date().notNull(),
	impressions: integer().default(0).notNull(),
	views: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	joins: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_group_analytics_daily").using("btree", table.groupId.asc().nullsLast().op("date_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_analytics_daily_group_id_fkey"
		}).onDelete("cascade"),
]);

export const productAnalyticsDaily = pgTable("product_analytics_daily", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	date: date().notNull(),
	impressions: integer().default(0).notNull(),
	views: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	sales: integer().default(0).notNull(),
	revenue: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_product_analytics_daily").using("btree", table.productId.asc().nullsLast().op("date_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [shopProducts.id],
			name: "product_analytics_daily_product_id_fkey"
		}).onDelete("cascade"),
]);

export const serviceAnalyticsDaily = pgTable("service_analytics_daily", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	talentProfileId: uuid("talent_profile_id").notNull(),
	date: date().notNull(),
	impressions: integer().default(0).notNull(),
	views: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	bookingsStarted: integer("bookings_started").default(0).notNull(),
	bookingsCompleted: integer("bookings_completed").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_service_analytics_daily").using("btree", table.talentProfileId.asc().nullsLast().op("date_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.talentProfileId],
			foreignColumns: [talentProfiles.id],
			name: "service_analytics_daily_talent_profile_id_fkey"
		}).onDelete("cascade"),
]);

export const analyticsEventDefinitions = pgTable("analytics_event_definitions", {
	eventName: varchar("event_name", { length: 64 }).primaryKey().notNull(),
	label: varchar({ length: 128 }).notNull(),
	description: text(),
	applicableEntityTypes: text("applicable_entity_types").array().default([""]).notNull(),
	funnelOrder: integer("funnel_order"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const analyticsRollupState = pgTable("analytics_rollup_state", {
	key: varchar({ length: 64 }).primaryKey().notNull(),
	lastProcessedAt: timestamp("last_processed_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const discussionLikes = pgTable("discussion_likes", {
	discussionId: uuid("discussion_id").notNull(),
	userId: uuid("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.discussionId],
			foreignColumns: [discussions.id],
			name: "discussion_likes_discussion_id_discussions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "discussion_likes_user_id_users_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.discussionId, table.userId], name: "discussion_likes_discussion_id_user_id_pk"}),
]);

export const verificationTokens = pgTable("verification_tokens", {
	identifier: text().notNull(),
	token: text().notNull(),
	expires: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.identifier, table.token], name: "verification_tokens_identifier_token_pk"}),
]);

export const mediaOwners = pgTable("media_owners", {
	mediaId: uuid("media_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("media_owners_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.mediaId],
			foreignColumns: [media.id],
			name: "media_owners_media_id_media_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "media_owners_user_id_users_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.mediaId, table.userId], name: "media_owners_media_id_user_id_pk"}),
]);

export const accounts = pgTable("accounts", {
	userId: uuid().notNull(),
	type: text().notNull(),
	provider: text().notNull(),
	providerAccountId: text().notNull(),
	refreshToken: text("refresh_token"),
	accessToken: text("access_token"),
	expiresAt: integer("expires_at"),
	tokenType: text("token_type"),
	scope: text(),
	idToken: text("id_token"),
	sessionState: text("session_state"),
	providerData: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("accounts_provider_idx").using("btree", table.provider.asc().nullsLast().op("text_ops")),
	index("accounts_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "accounts_userId_users_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.provider, table.providerAccountId], name: "accounts_provider_providerAccountId_pk"}),
]);
