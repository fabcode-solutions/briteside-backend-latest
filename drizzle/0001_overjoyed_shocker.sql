CREATE TABLE "talent_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"day_of_week" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"timezone" varchar(100) DEFAULT 'America/New_York' NOT NULL,
	"durations" jsonb DEFAULT '[15,30,45,60]'::jsonb NOT NULL,
	"price_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"bio" text,
	"location" varchar(255),
	"intro_video_url" varchar(500),
	"rates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"review_count" integer DEFAULT 0 NOT NULL,
	"total_sessions" integer DEFAULT 0 NOT NULL,
	"priority_message_fee" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "talent_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "talent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"booker_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_mins" integer NOT NULL,
	"join_allowed_at" timestamp with time zone NOT NULL,
	"booker_joined_at" timestamp with time zone,
	"talent_joined_at" timestamp with time zone,
	"billing_started_at" timestamp with time zone,
	"billing_ended_at" timestamp with time zone,
	"actual_duration_mins" integer,
	"price_cents" integer NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"subject" varchar(255) NOT NULL,
	"discussion" text,
	"is_gift" boolean DEFAULT false NOT NULL,
	"gift_details" jsonb DEFAULT '{}'::jsonb,
	"gift_code" varchar(50),
	"stream_call_cid" varchar(255),
	"reminder_24h_sent_at" timestamp with time zone,
	"reminder_1h_sent_at" timestamp with time zone,
	"reminder_15m_sent_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"refund_issued_at" timestamp with time zone,
	"rescheduled_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent_availability" ADD CONSTRAINT "talent_availability_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD CONSTRAINT "talent_sessions_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD CONSTRAINT "talent_sessions_booker_id_users_id_fk" FOREIGN KEY ("booker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD CONSTRAINT "talent_sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_availability_profile" ON "talent_availability" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_availability_active" ON "talent_availability" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_talent_profiles_user" ON "talent_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_talent_profiles_category" ON "talent_profiles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_talent_profiles_active" ON "talent_profiles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_talent_profiles_rating" ON "talent_profiles" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_talent_profiles_deleted" ON "talent_profiles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_talent" ON "talent_sessions" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_booker" ON "talent_sessions" USING btree ("booker_id");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_status" ON "talent_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_scheduled" ON "talent_sessions" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_stream_cid" ON "talent_sessions" USING btree ("stream_call_cid");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_reminder_24h" ON "talent_sessions" USING btree ("reminder_24h_sent_at");--> statement-breakpoint
CREATE INDEX "idx_talent_sessions_reminder_1h" ON "talent_sessions" USING btree ("reminder_1h_sent_at");