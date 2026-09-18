CREATE TYPE "public"."collaborator_status" AS ENUM('pending', 'accepted', 'rejected', 'removed');--> statement-breakpoint
CREATE TYPE "public"."post_tab_item_type" AS ENUM('post', 'link');--> statement-breakpoint
CREATE TYPE "public"."shop_custom_offer_delivery_state" AS ENUM('awaiting_delivery', 'delivered', 'revision_requested');--> statement-breakpoint
CREATE TYPE "public"."shop_custom_offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'withdrawn', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."shop_listing_type" AS ENUM('product', 'course', 'service', 'link');--> statement-breakpoint
CREATE TYPE "public"."shop_payment_mode" AS ENUM('full', 'deposit', 'milestones');--> statement-breakpoint
CREATE TYPE "public"."course_enrollment_status" AS ENUM('active', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."video_source_type" AS ENUM('youtube', 'vimeo', 'upload');--> statement-breakpoint
CREATE TYPE "public"."spend_type" AS ENUM('ticket_purchase', 'platform_subscription', 'group_subscription', 'talent_session', 'priority_message', 'shop');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('pending', 'processing', 'published', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('draft', 'pending', 'processing', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."group_member_status" ADD VALUE 'blocked';--> statement-breakpoint
ALTER TYPE "public"."report_type" ADD VALUE 'talent_session';--> statement-breakpoint
CREATE TABLE "organizer_social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid,
	"talent_profile_id" uuid,
	"instagram" text,
	"twitter" text,
	"facebook" text,
	"linkedin" text,
	"youtube" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "organizer_social_links_organizer_id_unique" UNIQUE("organizer_id"),
	CONSTRAINT "organizer_social_links_talent_profile_id_unique" UNIQUE("talent_profile_id"),
	CONSTRAINT "chk_social_links_one_owner" CHECK (("organizer_social_links"."organizer_id" IS NOT NULL AND "organizer_social_links"."talent_profile_id" IS NULL) OR
          ("organizer_social_links"."organizer_id" IS NULL AND "organizer_social_links"."talent_profile_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "organizer_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"preset_name" varchar(255) NOT NULL,
	"business_name" varchar(255),
	"business_description" text,
	"business_type" varchar(50),
	"logo_url" text,
	"cover_image_url" text[],
	"website_url" text,
	"contact_email" varchar(255),
	"contact_phone" varchar(50),
	"business_address" text,
	"about" varchar(500),
	"specialities" text[],
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_venue_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"description" text,
	"capacity" integer,
	"amenities" jsonb DEFAULT '[]'::jsonb,
	"additional_information" jsonb DEFAULT '{}'::jsonb,
	"cancellation_policy" text,
	"accessibility" jsonb DEFAULT '[]'::jsonb,
	"contact_email" varchar(255),
	"contact_phone" varchar(20),
	"parking_info" text,
	"public_transport_info" text,
	"emoji" varchar(10),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_ticket_schedule_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_tier_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"quantity_available" integer DEFAULT 0 NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_ticket_schedule" UNIQUE("ticket_tier_id","schedule_id"),
	CONSTRAINT "qty_available_check" CHECK ("event_ticket_schedule_inventory"."quantity_available" >= 0),
	CONSTRAINT "qty_sold_check" CHECK ("event_ticket_schedule_inventory"."quantity_sold" >= 0),
	CONSTRAINT "qty_sold_lte_available" CHECK ("event_ticket_schedule_inventory"."quantity_sold" <= "event_ticket_schedule_inventory"."quantity_available")
);
--> statement-breakpoint
CREATE TABLE "event_marketing_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"meta_pixel_id" varchar(100),
	"tiktok_pixel_id" varchar(100),
	"google_ads_id" varchar(100),
	"google_analytics_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reserve_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"event_id" uuid,
	"organizer_id" uuid,
	"admin_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"previous_amount_cents" integer,
	"new_amount_cents" integer,
	"delta_cents" integer,
	"transfer_id" varchar(255),
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_about_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"media_url" text NOT NULL,
	"media_type" varchar(50) NOT NULL,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "media_owners" (
	"media_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "media_owners_media_id_user_id_pk" PRIMARY KEY("media_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "follower_invite_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type" text DEFAULT 'post' NOT NULL,
	"post_id" uuid,
	"link_id" uuid,
	"pin_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_order_range" CHECK ("pinned_posts"."pin_order" BETWEEN 1 AND 9),
	CONSTRAINT "pinned_item_type_consistency" CHECK (("pinned_posts"."item_type" = 'post' AND "pinned_posts"."post_id" IS NOT NULL AND "pinned_posts"."link_id" IS NULL)
       OR ("pinned_posts"."item_type" = 'link' AND "pinned_posts"."link_id" IS NOT NULL AND "pinned_posts"."post_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "pinned_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pinned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "popular_link_covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"url" varchar(500) NOT NULL,
	"cover_type" varchar(10) DEFAULT 'image',
	"created_by_user_id" uuid,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"invited_by_id" uuid NOT NULL,
	"status" "collaborator_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tab_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"cover_url" varchar(500),
	"cover_type" varchar(10),
	"display_order" integer DEFAULT 0 NOT NULL,
	"clicks_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_view_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_post_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type" "post_tab_item_type" DEFAULT 'post' NOT NULL,
	"post_id" uuid,
	"link_id" uuid,
	"display_order" integer NOT NULL,
	CONSTRAINT "user_post_order_item_ref" CHECK (("user_post_order"."item_type" = 'post' AND "user_post_order"."post_id" IS NOT NULL AND "user_post_order"."link_id" IS NULL)
       OR ("user_post_order"."item_type" = 'link' AND "user_post_order"."link_id" IS NOT NULL AND "user_post_order"."post_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "user_post_order_counter" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"next_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_shop_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_shop_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_shop_products_position_range" CHECK ("post_shop_products"."position" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE TABLE "shop_course_lesson_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(50),
	"size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_course_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_course_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"video_url" text,
	"video_source_type" "video_source_type",
	"thumbnail_url" text,
	"duration" integer DEFAULT 0,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"is_free_preview" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"lessons_count" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_date_extension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"original_due_date" timestamp with time zone,
	"requested_due_date" timestamp with time zone NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"file_key" varchar(500) NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(10) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"raised_by_user_id" uuid NOT NULL,
	"reason" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_revision_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"message" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_offer_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"charged_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stripe_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_custom_service_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"based_on_product_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"revisions_used_count" integer DEFAULT 0 NOT NULL,
	"turnaround" varchar(100),
	"turnaround_minutes" integer,
	"due_date" timestamp with time zone,
	"deliverables" text,
	"delivered_at" timestamp with time zone,
	"revisions_included" boolean DEFAULT false NOT NULL,
	"revisions_count" integer,
	"payment_mode" "shop_payment_mode" DEFAULT 'full' NOT NULL,
	"deposit_percent" integer,
	"milestones" jsonb,
	"note" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "shop_custom_offer_status" DEFAULT 'pending' NOT NULL,
	"delivery_state" "shop_custom_offer_delivery_state" DEFAULT 'awaiting_delivery' NOT NULL,
	"base_price_covered_cents" integer DEFAULT 0 NOT NULL,
	"charged_cents" integer,
	"seller_receive_cents" integer,
	"platform_share_cents" integer,
	"stripe_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"completed_at" timestamp with time zone,
	"review_reminder_sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"product_title_snapshot" varchar(200) NOT NULL,
	"price_cents" integer NOT NULL,
	"charged_cents" integer NOT NULL,
	"seller_receive_cents" integer NOT NULL,
	"platform_share_cents" integer NOT NULL,
	"refunds_allowed_snapshot" boolean NOT NULL,
	"refund_window_days_snapshot" integer NOT NULL,
	"refund_after_download_snapshot" boolean NOT NULL,
	"stripe_session_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"download_count" integer DEFAULT 0 NOT NULL,
	"first_downloaded_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_amount_cents" integer,
	"stripe_refund_id" varchar(255),
	"customer_name" varchar(200),
	"customer_email" varchar(255),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_product_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"is_physical" boolean DEFAULT false NOT NULL,
	"listing_type" "shop_listing_type" DEFAULT 'product' NOT NULL,
	"cover_url" varchar(500),
	"cover_type" varchar(10),
	"gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_title" varchar(100),
	"button_action" varchar(20) DEFAULT 'payment' NOT NULL,
	"redirect_url" varchar(500),
	"delivery_type" varchar(10),
	"delivery_file_key" varchar(500),
	"delivery_file_name" varchar(255),
	"delivery_link" varchar(500),
	"service_kind" varchar(20),
	"turnaround" varchar(100),
	"cancellation_policy" text,
	"revisions_included" boolean,
	"revisions_count" integer,
	"pricing_model" varchar(20),
	"from_price" boolean,
	"payment_mode" "shop_payment_mode",
	"deposit_percent" integer,
	"milestones" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published_to_shop" boolean DEFAULT true NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"pin_order" integer,
	"views_count" integer DEFAULT 0 NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_pin_order_range" CHECK ("shop_products"."pin_order" IS NULL OR "shop_products"."pin_order" BETWEEN 1 AND 9)
);
--> statement-breakpoint
CREATE TABLE "shop_refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"reason" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_by_role" varchar(10),
	"resolution_note" text,
	"refund_amount_cents" integer,
	"stripe_refund_id" varchar(255),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_refund_requests_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "group_message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_message_user_emoji" UNIQUE("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "group_course_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "course_enrollment_status" DEFAULT 'active' NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"stripe_session_id" varchar(255),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_course_lesson_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(50),
	"size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_course_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_course_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text,
	"video_url" text,
	"video_source_type" "video_source_type",
	"thumbnail_url" text,
	"duration" integer DEFAULT 0,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"is_free_preview" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"thumbnail_url" text,
	"is_free" boolean DEFAULT true NOT NULL,
	"price" numeric(10, 2),
	"stripe_product_id" varchar(255),
	"stripe_price_id" varchar(255),
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"total_lessons" integer DEFAULT 0 NOT NULL,
	"total_enrollments" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"file_url" text NOT NULL,
	"file_name" varchar(255),
	"file_type" varchar(100),
	"size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"question_text" varchar(500) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_spends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"spend_type" "spend_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference_id" uuid NOT NULL,
	"reference_type" varchar(50) NOT NULL,
	"event_id" uuid,
	"talent_user_id" uuid,
	"group_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"stripe_payment_intent_id" varchar(255),
	"stripe_session_id" varchar(255),
	"is_refunded" boolean DEFAULT false NOT NULL,
	"refund_meta" jsonb DEFAULT '{}'::jsonb,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_session_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"track_type" varchar(64),
	"participant_id" uuid,
	"s3_bucket" varchar(255) NOT NULL,
	"s3_key" varchar(512) NOT NULL,
	"moderation_action" varchar(32),
	"reason" varchar(32) NOT NULL,
	"review_queue_item_id" varchar(255),
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_message_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"replied_at" timestamp with time zone,
	"reply_message_id" uuid,
	"subject" varchar(255),
	"message_content" text NOT NULL,
	"content_extended" text,
	"message_id" uuid,
	"delivered_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_content_extended_length" CHECK (char_length(content_extended) <= 1400)
);
--> statement-breakpoint
CREATE TABLE "priority_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"item_id" uuid,
	"media_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"url" text NOT NULL,
	"s3_key" text NOT NULL,
	"original_name" varchar(255),
	"mimetype" varchar(100),
	"size_bytes" integer,
	"price_cents" integer DEFAULT 99 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"viewed_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_blasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"sent_by" uuid,
	"sent_by_team_member" uuid,
	"type" varchar(10) NOT NULL,
	"subject" varchar(255),
	"message" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "group_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid,
	"payout_method_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"type" varchar(20) DEFAULT 'standard' NOT NULL,
	"stripe_payout_id" varchar(255),
	"stripe_transfer_id" varchar(255),
	"admin_note" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizer_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"payout_method_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"type" varchar(20) DEFAULT 'standard' NOT NULL,
	"stripe_payout_id" varchar(255),
	"stripe_transfer_id" varchar(255),
	"admin_note" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stripe_connect_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"onboarding_complete" boolean DEFAULT false,
	"charges_enabled" boolean DEFAULT false,
	"payouts_enabled" boolean DEFAULT false,
	"country" varchar(2) DEFAULT 'US',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "stripe_connect_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "stripe_connect_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "talent_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"payout_method_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"type" varchar(20) DEFAULT 'standard' NOT NULL,
	"stripe_payout_id" varchar(255),
	"stripe_transfer_id" varchar(255),
	"admin_note" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"label" varchar(100) NOT NULL,
	"account_holder_name" varchar(255) NOT NULL,
	"bank_name" varchar(255),
	"account_number_last4" varchar(4),
	"routing_number_last4" varchar(4),
	"country" varchar(2) DEFAULT 'US',
	"currency" varchar(3) DEFAULT 'USD',
	"full_details" jsonb,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "suspension_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"admin_id" uuid,
	"admin_response" text,
	"reviewed_at" timestamp with time zone,
	"new_suspended_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60,
	"session_type" varchar(20),
	"meeting_type" varchar(20) DEFAULT 'stream',
	"stream_call_id" varchar(255),
	"stream_call_type" varchar(50) DEFAULT 'default',
	"external_meeting_link" varchar(500),
	"invite_link" varchar(500),
	"max_participants" integer,
	"status" varchar(20) DEFAULT 'upcoming',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demo_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demo_session_id" uuid NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"audience" varchar(20) NOT NULL,
	"audience_type" varchar(100),
	"primary_category" varchar(255) NOT NULL,
	"scale_metric" varchar(255) NOT NULL,
	"current_platform" varchar(255),
	"goals" text,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "talent_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"talent_user_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"admin_id" uuid,
	"admin_note" text,
	"refund_issued" boolean DEFAULT false NOT NULL,
	"refund_amount_cents" integer,
	"stripe_refund_id" varchar(255),
	"warning_issued" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "story_collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"item_type" varchar(10) NOT NULL,
	"story_id" uuid,
	"post_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"cover_image" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"items_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bio_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"url" varchar(2000) NOT NULL,
	"icon" varchar(50),
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"file_hash" varchar(64),
	"original_filename" varchar(255),
	"caption" varchar(500),
	"display_order" smallint NOT NULL,
	"status" "image_status" DEFAULT 'pending' NOT NULL,
	"created_post_id" uuid,
	"fail_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "import_status" DEFAULT 'draft' NOT NULL,
	"total_images" integer DEFAULT 0 NOT NULL,
	"duplicate_images" integer DEFAULT 0 NOT NULL,
	"processed_images" integer DEFAULT 0 NOT NULL,
	"failed_images" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_moderation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid,
	"post_id" uuid,
	"story_id" uuid,
	"event_id" uuid,
	"group_id" uuid,
	"discussion_id" uuid,
	"user_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"review_id" text,
	"labels" jsonb DEFAULT '[]'::jsonb,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_moderation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid,
	"status" varchar(16) DEFAULT 'flagged' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_id" text,
	"labels" jsonb DEFAULT '[]'::jsonb,
	"severity" varchar(16),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_name" varchar(64) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" uuid,
	"user_id" uuid,
	"anonymous_id" varchar(64),
	"session_id" varchar(64),
	"client_event_id" uuid NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analytics_identity_links" UNIQUE("anonymous_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_group_analytics_daily" UNIQUE("group_id","date")
);
--> statement-breakpoint
CREATE TABLE "post_analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_post_analytics_daily" UNIQUE("post_id","date")
);
--> statement-breakpoint
CREATE TABLE "product_analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_product_analytics_daily" UNIQUE("product_id","date")
);
--> statement-breakpoint
CREATE TABLE "service_analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"bookings_started" integer DEFAULT 0 NOT NULL,
	"bookings_completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_service_analytics_daily" UNIQUE("talent_profile_id","date")
);
--> statement-breakpoint
CREATE TABLE "analytics_event_definitions" (
	"event_name" varchar(64) PRIMARY KEY NOT NULL,
	"label" varchar(128) NOT NULL,
	"description" text,
	"applicable_entity_types" text[] DEFAULT '{}' NOT NULL,
	"funnel_order" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_rollup_state" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"last_processed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_conversations" DROP CONSTRAINT "unique_social_conversation_pair";--> statement-breakpoint
ALTER TABLE "event_attendees" DROP CONSTRAINT "event_attendees_checked_in_by_team_member_event_team_members_id_fk";
--> statement-breakpoint
ALTER TABLE "priority_message_payments" DROP CONSTRAINT "priority_message_payments_message_id_social_messages_id_fk";
--> statement-breakpoint
DROP INDEX "idx_pmp_talent_profile";--> statement-breakpoint
DROP INDEX "idx_pmp_stripe_session";--> statement-breakpoint
ALTER TABLE "social_profiles" ALTER COLUMN "location" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "talent_reviews" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_last_seen" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_online_status" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_search_by_email" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_search_by_phone" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_briteside_plus" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_tagging" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profanity_filter_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_messages_from" varchar(20) DEFAULT 'everyone';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_calls_from" varchar(20) DEFAULT 'everyone';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_verified_adult" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_verification_source" varchar(50) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "country" varchar(2) DEFAULT 'US';--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "show_tickets_sold" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "show_like_count" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "preset_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sns_topic_arn" varchar(255);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "show_tickets_remaining" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "group_deal_size" integer;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "sale_discount_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "sale_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "sale_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "is_sale_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchased_tickets" ADD COLUMN "sns_subscription_arn" varchar(512);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reserve_amount_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reserve_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_share_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_fee_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transfer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "stripe_meta" jsonb;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "link_button" jsonb;--> statement-breakpoint
ALTER TABLE "interest_categories" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_categories" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "is_cover_post" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "wall_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "status" varchar(20) DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "state" varchar(100);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "country" varchar(100);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "hide_following_count" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "cover_media" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "cover_post_id" uuid;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "country_flag_1" varchar(2);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "country_flag_2" varchar(2);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "button_meta" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "shop_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "shop_refunds_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "default_landing_tab" varchar(10) DEFAULT 'posts' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "shop_refund_window_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "shop_refund_after_download" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_track_id" varchar(50);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_track_name" varchar(300);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_artist_name" varchar(300);--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_artwork_url" text;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_preview_url" text;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "profile_song_apple_music_url" text;--> statement-breakpoint
ALTER TABLE "social_wall_posts" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "conversation_type" varchar(20) DEFAULT 'social' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "organizer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "is_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_subscription_tiers" ADD COLUMN "stripe_product_id" varchar(255);--> statement-breakpoint
ALTER TABLE "group_subscription_tiers" ADD COLUMN "stripe_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "group_subscriptions" ADD COLUMN "platform_fee_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "group_subscriptions" ADD COLUMN "refund_id" varchar(255);--> statement-breakpoint
ALTER TABLE "group_subscriptions" ADD COLUMN "refund_status" varchar(20);--> statement-breakpoint
ALTER TABLE "group_subscriptions" ADD COLUMN "refund_amount" integer;--> statement-breakpoint
ALTER TABLE "user_reports" ADD COLUMN "talent_session_id" uuid;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "media" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "experience" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "education" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "qualifications" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "show_shop_products" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "priority_messaging_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "state" varchar(100);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "country" varchar(100);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "country_code" varchar(4);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "longitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "share_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "moderation_status" varchar(16) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "moderation_events_log" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "report_screenshot_targets" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "booker_recording_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "talent_recording_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "recording_disclosure_version" varchar(32);--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "stripe_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "stripe_payment_intent_id" varchar(255);--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "transfer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "reminder_10m_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "reminder_1m_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "review_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "reserve_amount_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "reserve_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "platform_share_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "stripe_fee_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "booker_call_rating" integer;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "booker_call_feedback" text;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "talent_call_rating" integer;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "talent_call_feedback" text;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD COLUMN "source_type" varchar(30) DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD COLUMN "priority_message_id" uuid;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD COLUMN "shop_custom_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD COLUMN "report_reason" text;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "message_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "base_cents" integer;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "transfer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "organizer_social_links" ADD CONSTRAINT "organizer_social_links_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_social_links" ADD CONSTRAINT "organizer_social_links_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_presets" ADD CONSTRAINT "organizer_presets_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_venue_profiles" ADD CONSTRAINT "event_venue_profiles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_venue_profiles" ADD CONSTRAINT "event_venue_profiles_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_schedule_inventory" ADD CONSTRAINT "event_ticket_schedule_inventory_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_schedule_inventory" ADD CONSTRAINT "event_ticket_schedule_inventory_ticket_tier_id_event_tickets_id_fk" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."event_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_schedule_inventory" ADD CONSTRAINT "event_ticket_schedule_inventory_schedule_id_event_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."event_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_marketing_settings" ADD CONSTRAINT "event_marketing_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_about_gallery" ADD CONSTRAINT "group_about_gallery_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_about_gallery" ADD CONSTRAINT "group_about_gallery_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_owners" ADD CONSTRAINT "media_owners_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_owners" ADD CONSTRAINT "media_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follower_invite_log" ADD CONSTRAINT "follower_invite_log_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follower_invite_log" ADD CONSTRAINT "follower_invite_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_posts" ADD CONSTRAINT "pinned_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_posts" ADD CONSTRAINT "pinned_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_posts" ADD CONSTRAINT "pinned_posts_link_id_post_tab_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."post_tab_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_profiles" ADD CONSTRAINT "pinned_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_profiles" ADD CONSTRAINT "pinned_profiles_pinned_user_id_users_id_fk" FOREIGN KEY ("pinned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popular_link_covers" ADD CONSTRAINT "popular_link_covers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD CONSTRAINT "post_collaborators_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD CONSTRAINT "post_collaborators_collaborator_id_users_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD CONSTRAINT "post_collaborators_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tab_links" ADD CONSTRAINT "post_tab_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_view_sessions" ADD CONSTRAINT "profile_view_sessions_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_view_sessions" ADD CONSTRAINT "profile_view_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_post_order" ADD CONSTRAINT "user_post_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_post_order" ADD CONSTRAINT "user_post_order_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_post_order" ADD CONSTRAINT "user_post_order_link_id_post_tab_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."post_tab_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_post_order_counter" ADD CONSTRAINT "user_post_order_counter_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_shop_products" ADD CONSTRAINT "group_shop_products_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_shop_products" ADD CONSTRAINT "group_shop_products_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_shop_products" ADD CONSTRAINT "post_shop_products_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_shop_products" ADD CONSTRAINT "post_shop_products_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lesson_attachments" ADD CONSTRAINT "shop_course_lesson_attachments_lesson_id_shop_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."shop_course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lesson_progress" ADD CONSTRAINT "shop_course_lesson_progress_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lesson_progress" ADD CONSTRAINT "shop_course_lesson_progress_lesson_id_shop_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."shop_course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lesson_progress" ADD CONSTRAINT "shop_course_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lessons" ADD CONSTRAINT "shop_course_lessons_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_lessons" ADD CONSTRAINT "shop_course_lessons_module_id_shop_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."shop_course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_course_modules" ADD CONSTRAINT "shop_course_modules_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_activity" ADD CONSTRAINT "shop_custom_offer_activity_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_activity" ADD CONSTRAINT "shop_custom_offer_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_date_extension_requests" ADD CONSTRAINT "shop_custom_offer_date_extension_requests_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_date_extension_requests" ADD CONSTRAINT "shop_custom_offer_date_extension_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_deliverables" ADD CONSTRAINT "shop_custom_offer_deliverables_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_deliverables" ADD CONSTRAINT "shop_custom_offer_deliverables_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_disputes" ADD CONSTRAINT "shop_custom_offer_disputes_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_disputes" ADD CONSTRAINT "shop_custom_offer_disputes_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_disputes" ADD CONSTRAINT "shop_custom_offer_disputes_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_revision_requests" ADD CONSTRAINT "shop_custom_offer_revision_requests_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_revision_requests" ADD CONSTRAINT "shop_custom_offer_revision_requests_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_tips" ADD CONSTRAINT "shop_custom_offer_tips_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_tips" ADD CONSTRAINT "shop_custom_offer_tips_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_offer_tips" ADD CONSTRAINT "shop_custom_offer_tips_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_service_offers" ADD CONSTRAINT "shop_custom_service_offers_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_service_offers" ADD CONSTRAINT "shop_custom_service_offers_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_custom_service_offers" ADD CONSTRAINT "shop_custom_service_offers_based_on_product_id_shop_products_id_fk" FOREIGN KEY ("based_on_product_id") REFERENCES "public"."shop_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_product_views" ADD CONSTRAINT "shop_product_views_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_product_views" ADD CONSTRAINT "shop_product_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_refund_requests" ADD CONSTRAINT "shop_refund_requests_order_id_shop_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shop_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_refund_requests" ADD CONSTRAINT "shop_refund_requests_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_refund_requests" ADD CONSTRAINT "shop_refund_requests_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_refund_requests" ADD CONSTRAINT "shop_refund_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message_reactions" ADD CONSTRAINT "group_message_reactions_message_id_group_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message_reactions" ADD CONSTRAINT "group_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_enrollments" ADD CONSTRAINT "group_course_enrollments_course_id_group_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."group_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_enrollments" ADD CONSTRAINT "group_course_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lesson_attachments" ADD CONSTRAINT "group_course_lesson_attachments_lesson_id_group_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."group_course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lesson_progress" ADD CONSTRAINT "group_course_lesson_progress_enrollment_id_group_course_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."group_course_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lesson_progress" ADD CONSTRAINT "group_course_lesson_progress_lesson_id_group_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."group_course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lesson_progress" ADD CONSTRAINT "group_course_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lessons" ADD CONSTRAINT "group_course_lessons_course_id_group_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."group_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_lessons" ADD CONSTRAINT "group_course_lessons_module_id_group_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."group_course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_course_modules" ADD CONSTRAINT "group_course_modules_course_id_group_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."group_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_courses" ADD CONSTRAINT "group_courses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_courses" ADD CONSTRAINT "group_courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_resources" ADD CONSTRAINT "group_resources_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_resources" ADD CONSTRAINT "group_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_questions" ADD CONSTRAINT "group_questions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_spends" ADD CONSTRAINT "user_spends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_spends" ADD CONSTRAINT "user_spends_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_spends" ADD CONSTRAINT "user_spends_talent_user_id_users_id_fk" FOREIGN KEY ("talent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_spends" ADD CONSTRAINT "user_spends_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_session_frames" ADD CONSTRAINT "talent_session_frames_session_id_talent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_items" ADD CONSTRAINT "priority_message_items_payment_id_priority_message_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."priority_message_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_items" ADD CONSTRAINT "priority_message_items_reply_message_id_social_messages_id_fk" FOREIGN KEY ("reply_message_id") REFERENCES "public"."social_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_items" ADD CONSTRAINT "priority_message_items_message_id_social_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."social_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_attachments" ADD CONSTRAINT "priority_message_attachments_payment_id_priority_message_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."priority_message_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_attachments" ADD CONSTRAINT "priority_message_attachments_item_id_priority_message_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."priority_message_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_attachments" ADD CONSTRAINT "priority_message_attachments_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_attachments" ADD CONSTRAINT "priority_message_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_blasts" ADD CONSTRAINT "event_blasts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_blasts" ADD CONSTRAINT "event_blasts_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_blasts" ADD CONSTRAINT "event_blasts_sent_by_team_member_event_team_members_id_fk" FOREIGN KEY ("sent_by_team_member") REFERENCES "public"."event_team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payouts" ADD CONSTRAINT "group_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payouts" ADD CONSTRAINT "group_payouts_payout_method_id_user_payout_methods_id_fk" FOREIGN KEY ("payout_method_id") REFERENCES "public"."user_payout_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_payouts" ADD CONSTRAINT "organizer_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_payouts" ADD CONSTRAINT "organizer_payouts_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_payouts" ADD CONSTRAINT "organizer_payouts_payout_method_id_user_payout_methods_id_fk" FOREIGN KEY ("payout_method_id") REFERENCES "public"."user_payout_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_payouts" ADD CONSTRAINT "talent_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_payouts" ADD CONSTRAINT "talent_payouts_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_payouts" ADD CONSTRAINT "talent_payouts_payout_method_id_user_payout_methods_id_fk" FOREIGN KEY ("payout_method_id") REFERENCES "public"."user_payout_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_payout_methods" ADD CONSTRAINT "user_payout_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_appeals" ADD CONSTRAINT "suspension_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_appeals" ADD CONSTRAINT "suspension_appeals_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_registrations" ADD CONSTRAINT "demo_registrations_demo_session_id_demo_sessions_id_fk" FOREIGN KEY ("demo_session_id") REFERENCES "public"."demo_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_issues" ADD CONSTRAINT "talent_issues_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_issues" ADD CONSTRAINT "talent_issues_talent_user_id_users_id_fk" FOREIGN KEY ("talent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_issues" ADD CONSTRAINT "talent_issues_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_issues" ADD CONSTRAINT "talent_issues_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_collection_items" ADD CONSTRAINT "story_collection_items_collection_id_story_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."story_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_collection_items" ADD CONSTRAINT "story_collection_items_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_collection_items" ADD CONSTRAINT "story_collection_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_collections" ADD CONSTRAINT "story_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_images" ADD CONSTRAINT "import_images_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_images" ADD CONSTRAINT "import_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_images" ADD CONSTRAINT "import_images_created_post_id_posts_id_fk" FOREIGN KEY ("created_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_discussion_id_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_moderation" ADD CONSTRAINT "content_moderation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_moderation" ADD CONSTRAINT "text_moderation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_moderation" ADD CONSTRAINT "text_moderation_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_identity_links" ADD CONSTRAINT "analytics_identity_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_analytics_daily" ADD CONSTRAINT "group_analytics_daily_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_analytics_daily" ADD CONSTRAINT "post_analytics_daily_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_analytics_daily" ADD CONSTRAINT "product_analytics_daily_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_analytics_daily" ADD CONSTRAINT "service_analytics_daily_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organizer_presets_organizer" ON "organizer_presets" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "idx_organizer_presets_default" ON "organizer_presets" USING btree ("organizer_id","is_default");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_event_venue_profiles_event" ON "event_venue_profiles" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_venue_profiles_venue" ON "event_venue_profiles" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_schedule_inv_ticket" ON "event_ticket_schedule_inventory" USING btree ("ticket_tier_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_schedule_inv_schedule" ON "event_ticket_schedule_inventory" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_schedule_inv_event" ON "event_ticket_schedule_inventory" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_event_marketing_settings_event" ON "event_marketing_settings" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_group_about_gallery_group" ON "group_about_gallery" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_about_gallery_uploader" ON "group_about_gallery" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "media_owners_user_idx" ON "media_owners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_follower_invite_log_organizer" ON "follower_invite_log" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "idx_follower_invite_log_event" ON "follower_invite_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_pinned_posts_user_order" ON "pinned_posts" USING btree ("user_id","pin_order");--> statement-breakpoint
CREATE INDEX "idx_pinned_posts_post" ON "pinned_posts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "idx_pinned_posts_link" ON "pinned_posts" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pinned_posts_unique_post" ON "pinned_posts" USING btree ("user_id","post_id") WHERE "pinned_posts"."post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pinned_posts_unique_link" ON "pinned_posts" USING btree ("user_id","link_id") WHERE "pinned_posts"."link_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_pinned_profiles_user" ON "pinned_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pinned_profiles_pinned_user" ON "pinned_profiles" USING btree ("pinned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pinned_profiles_unique" ON "pinned_profiles" USING btree ("user_id","pinned_user_id");--> statement-breakpoint
CREATE INDEX "idx_popular_link_covers_order" ON "popular_link_covers" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "idx_popular_link_covers_created_by" ON "popular_link_covers" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_post_collaborators_post" ON "post_collaborators" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "idx_post_collaborators_user" ON "post_collaborators" USING btree ("collaborator_id");--> statement-breakpoint
CREATE INDEX "idx_post_collaborators_status" ON "post_collaborators" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_post_collaborators_unique" ON "post_collaborators" USING btree ("post_id","collaborator_id");--> statement-breakpoint
CREATE INDEX "idx_post_tab_links_user_order" ON "post_tab_links" USING btree ("user_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_profile_view_sessions_profile" ON "profile_view_sessions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_profile_view_sessions_user" ON "profile_view_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_profile_view_sessions_viewed_at" ON "profile_view_sessions" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX "idx_user_post_order_user" ON "user_post_order" USING btree ("user_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_post_order_unique_post" ON "user_post_order" USING btree ("user_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_post_order_unique_link" ON "user_post_order" USING btree ("user_id","link_id");--> statement-breakpoint
CREATE INDEX "idx_group_shop_products_group" ON "group_shop_products" USING btree ("group_id","position");--> statement-breakpoint
CREATE INDEX "idx_group_shop_products_product" ON "group_shop_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_shop_products_unique" ON "group_shop_products" USING btree ("group_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_post_shop_products_post" ON "post_shop_products" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "idx_post_shop_products_product" ON "post_shop_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_post_shop_products_unique" ON "post_shop_products" USING btree ("post_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_shop_course_lesson_attachments_lesson" ON "shop_course_lesson_attachments" USING btree ("lesson_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shop_lesson_progress_unique" ON "shop_course_lesson_progress" USING btree ("lesson_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_shop_lesson_progress_user" ON "shop_course_lesson_progress" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_shop_course_lessons_product" ON "shop_course_lessons" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_shop_course_lessons_module_order" ON "shop_course_lessons" USING btree ("module_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_shop_course_modules_product_order" ON "shop_course_modules" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_custom_offer_activity_offer" ON "shop_custom_offer_activity" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_date_extension_requests_offer" ON "shop_custom_offer_date_extension_requests" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_custom_offer_deliverables_offer" ON "shop_custom_offer_deliverables" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_custom_offer_disputes_offer" ON "shop_custom_offer_disputes" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_custom_offer_disputes_status" ON "shop_custom_offer_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_revision_requests_offer" ON "shop_custom_offer_revision_requests" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_revision_requests_status" ON "shop_custom_offer_revision_requests" USING btree ("offer_id","status");--> statement-breakpoint
CREATE INDEX "idx_custom_offer_tips_offer" ON "shop_custom_offer_tips" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_offer_tips_stripe_session" ON "shop_custom_offer_tips" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_custom_offers_seller" ON "shop_custom_service_offers" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_custom_offers_buyer_status" ON "shop_custom_service_offers" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_offers_stripe_session" ON "shop_custom_service_offers" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_buyer" ON "shop_orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_seller" ON "shop_orders" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_product" ON "shop_orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_status" ON "shop_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_seller_paid" ON "shop_orders" USING btree ("seller_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shop_orders_stripe_session" ON "shop_orders" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_shop_product_views_product" ON "shop_product_views" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_shop_product_views_user" ON "shop_product_views" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shop_product_views_unique" ON "shop_product_views" USING btree ("product_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_shop_products_user_order" ON "shop_products" USING btree ("user_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_shop_products_deleted" ON "shop_products" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_shop_products_created_at" ON "shop_products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_shop_products_user_pinned" ON "shop_products" USING btree ("user_id","is_pinned","pin_order");--> statement-breakpoint
CREATE INDEX "idx_shop_refund_requests_buyer" ON "shop_refund_requests" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_shop_refund_requests_seller" ON "shop_refund_requests" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_shop_refund_requests_status" ON "shop_refund_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_group_message_reactions_message" ON "group_message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_group_message_reactions_user" ON "group_message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_group_message_reactions_emoji" ON "group_message_reactions" USING btree ("emoji");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_course_enrollments_unique" ON "group_course_enrollments" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_user" ON "group_course_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_course" ON "group_course_enrollments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_group_course_lesson_attachments_lesson" ON "group_course_lesson_attachments" USING btree ("lesson_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lesson_progress_unique" ON "group_course_lesson_progress" USING btree ("enrollment_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_progress_enrollment" ON "group_course_lesson_progress" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_progress_user" ON "group_course_lesson_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_progress_lesson" ON "group_course_lesson_progress" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "idx_group_course_lessons_course" ON "group_course_lessons" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_group_course_lessons_order" ON "group_course_lessons" USING btree ("course_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_group_course_lessons_module_order" ON "group_course_lessons" USING btree ("module_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_group_course_modules_course_order" ON "group_course_modules" USING btree ("course_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_group_courses_group" ON "group_courses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_courses_creator" ON "group_courses" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_group_courses_status" ON "group_courses" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "idx_group_resources_group" ON "group_resources" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_group_resources_creator" ON "group_resources" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_group_questions_group" ON "group_questions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_questions_active" ON "group_questions" USING btree ("group_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_user_spends_user_id" ON "user_spends" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_spends_spend_type" ON "user_spends" USING btree ("spend_type");--> statement-breakpoint
CREATE INDEX "idx_user_spends_paid_at" ON "user_spends" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "idx_user_spends_is_refunded" ON "user_spends" USING btree ("is_refunded");--> statement-breakpoint
CREATE INDEX "idx_user_spends_event_id" ON "user_spends" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_user_spends_talent_user_id" ON "user_spends" USING btree ("talent_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_spends_reference_id" ON "user_spends" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "idx_talent_session_frames_session" ON "talent_session_frames" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_pmi_payment" ON "priority_message_items" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_pmi_message" ON "priority_message_items" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_pmi_payment_position" ON "priority_message_items" USING btree ("payment_id","position");--> statement-breakpoint
CREATE INDEX "idx_pmi_replied_at" ON "priority_message_items" USING btree ("replied_at");--> statement-breakpoint
CREATE INDEX "idx_pmi_reply_message" ON "priority_message_items" USING btree ("reply_message_id");--> statement-breakpoint
CREATE INDEX "idx_pmi_status" ON "priority_message_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pma_payment" ON "priority_message_attachments" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_pma_item" ON "priority_message_attachments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_pma_status" ON "priority_message_attachments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pma_payment_status" ON "priority_message_attachments" USING btree ("payment_id","status");--> statement-breakpoint
CREATE INDEX "idx_event_blasts_event" ON "event_blasts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_blasts_event_created" ON "event_blasts" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_group_payouts_user" ON "group_payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_group_payouts_group" ON "group_payouts" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_payouts_status" ON "group_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_organizer_payouts_user" ON "organizer_payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_organizer_payouts_organizer" ON "organizer_payouts" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "idx_organizer_payouts_status" ON "organizer_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_user" ON "stripe_connect_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_account" ON "stripe_connect_accounts" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "idx_talent_payouts_user" ON "talent_payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_talent_payouts_profile" ON "talent_payouts" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_payouts_status" ON "talent_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payout_methods_user" ON "user_payout_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_suspension_appeals_user" ON "suspension_appeals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_suspension_appeals_status" ON "suspension_appeals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_talent_issues_reporter" ON "talent_issues" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "idx_talent_issues_talent_user" ON "talent_issues" USING btree ("talent_user_id");--> statement-breakpoint
CREATE INDEX "idx_talent_issues_status" ON "talent_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_talent_issues_entity" ON "talent_issues" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "story_collection_items_collection_id_idx" ON "story_collection_items" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "story_collection_items_story_id_idx" ON "story_collection_items" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_collection_items_post_id_idx" ON "story_collection_items" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "story_collection_items_item_type_idx" ON "story_collection_items" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX "story_collections_user_id_idx" ON "story_collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_collections_user_sort_idx" ON "story_collections" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "bio_links_user_id_idx" ON "bio_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bio_links_user_created_at_idx" ON "bio_links" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_import_images_import_status" ON "import_images" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "idx_import_images_import_id" ON "import_images" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "idx_import_images_user_id" ON "import_images" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_import_images_user_hash" ON "import_images" USING btree ("user_id","file_hash") WHERE file_hash IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "one_draft_per_user" ON "imports" USING btree ("user_id") WHERE status = 'draft';--> statement-breakpoint
CREATE INDEX "idx_imports_status" ON "imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_imports_user_id" ON "imports" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_media" ON "content_moderation" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_post" ON "content_moderation" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_story" ON "content_moderation" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_event" ON "content_moderation" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_group" ON "content_moderation" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_moderation_discussion" ON "content_moderation" USING btree ("discussion_id");--> statement-breakpoint
CREATE INDEX "idx_content_moderation_status" ON "content_moderation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_content_moderation_user" ON "content_moderation" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_text_moderation_entity" ON "text_moderation" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_text_moderation_status" ON "text_moderation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_text_moderation_user" ON "text_moderation" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_analytics_events_client_event" ON "analytics_events" USING btree ("client_event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_entity_timeline" ON "analytics_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_entity_funnel" ON "analytics_events" USING btree ("entity_type","entity_id","event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_user" ON "analytics_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_anonymous" ON "analytics_events" USING btree ("anonymous_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_session" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_identity_links_user" ON "analytics_identity_links" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_preset_id_organizer_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."organizer_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_checked_in_by_team_member_event_team_members_id_fk" FOREIGN KEY ("checked_in_by_team_member") REFERENCES "public"."event_team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_wall_post_id_social_wall_posts_id_fk" FOREIGN KEY ("wall_post_id") REFERENCES "public"."social_wall_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_cover_post_id_posts_id_fk" FOREIGN KEY ("cover_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_wall_posts" ADD CONSTRAINT "social_wall_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_organizer_user_id_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_talent_session_id_talent_sessions_id_fk" FOREIGN KEY ("talent_session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_shop_custom_offer_id_shop_custom_service_offers_id_fk" FOREIGN KEY ("shop_custom_offer_id") REFERENCES "public"."shop_custom_service_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_preset" ON "events" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "idx_interest_categories_default" ON "interest_categories" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "idx_posts_wall_post" ON "posts" USING btree ("wall_post_id");--> statement-breakpoint
CREATE INDEX "idx_posts_cover_post" ON "posts" USING btree ("is_cover_post");--> statement-breakpoint
CREATE INDEX "idx_posts_status" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_posts_scheduled_at" ON "posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_posts_source" ON "posts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_social_conversations_type" ON "social_conversations" USING btree ("conversation_type");--> statement-breakpoint
CREATE INDEX "idx_social_conversations_last_message_at" ON "social_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_social_messages_is_priority" ON "social_messages" USING btree ("is_priority");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_tag" ON "group_tags" USING btree ("group_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tags_name" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_reports_talent_session" ON "user_reports" USING btree ("talent_session_id");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_reminder_10m" ON "talent_sessions" USING btree ("reminder_10m_sent_at");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_reminder_1m" ON "talent_sessions" USING btree ("reminder_1m_sent_at");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_custom_offer" ON "talent_reviews" USING btree ("shop_custom_offer_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_source" ON "talent_reviews" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "idx_pmp_conversation" ON "priority_message_payments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_pmp_talent_status" ON "priority_message_payments" USING btree ("talent_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_pmp_conversation_status" ON "priority_message_payments" USING btree ("conversation_id","status");--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "capacity";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "amenities";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "additional_information";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "cancellation_policy";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "accessibility";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "contact_email";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "contact_phone";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "parking_info";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "public_transport_info";--> statement-breakpoint
ALTER TABLE "venues" DROP COLUMN "emoji";--> statement-breakpoint
ALTER TABLE "social_profiles" DROP COLUMN "cover_images";--> statement-breakpoint
ALTER TABLE "priority_message_payments" DROP COLUMN "subject";--> statement-breakpoint
ALTER TABLE "priority_message_payments" DROP COLUMN "message_content";--> statement-breakpoint
ALTER TABLE "priority_message_payments" DROP COLUMN "message_id";--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "unique_social_conversation_pair" UNIQUE("user_a_id","user_b_id","conversation_type");--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "unique_talent_session_report" UNIQUE("reporter_id","talent_session_id");--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "group_deal_size_check" CHECK ("event_tickets"."group_deal_size" IS NULL OR "event_tickets"."group_deal_size" >= 2);--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "sale_discount_check" CHECK ("event_tickets"."sale_discount_percent" IS NULL OR ("event_tickets"."sale_discount_percent" > 0 AND "event_tickets"."sale_discount_percent" <= 60));