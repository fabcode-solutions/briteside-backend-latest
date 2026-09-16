CREATE TABLE "talent_date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"override_date" date NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"communication_rating" integer,
	"value_rating" integer,
	"title" varchar(150),
	"comment" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_talent_reviews_session" UNIQUE("session_id"),
	CONSTRAINT "rating_range" CHECK ("talent_reviews"."rating" >= 1 AND "talent_reviews"."rating" <= 5),
	CONSTRAINT "communication_rating_range" CHECK ("talent_reviews"."communication_rating" IS NULL OR ("talent_reviews"."communication_rating" >= 1 AND "talent_reviews"."communication_rating" <= 5)),
	CONSTRAINT "value_rating_range" CHECK ("talent_reviews"."value_rating" IS NULL OR ("talent_reviews"."value_rating" >= 1 AND "talent_reviews"."value_rating" <= 5))
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "comments_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "hide_view_count" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "talent_date_overrides" ADD CONSTRAINT "talent_date_overrides_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_favorites" ADD CONSTRAINT "talent_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_favorites" ADD CONSTRAINT "talent_favorites_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_session_id_talent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_profile" ON "talent_date_overrides" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_date" ON "talent_date_overrides" USING btree ("override_date");--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_profile_date" ON "talent_date_overrides" USING btree ("talent_profile_id","override_date");--> statement-breakpoint
CREATE INDEX "idx_talent_favorites_user" ON "talent_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_talent_favorites_profile" ON "talent_favorites" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_talent_favorites_unique" ON "talent_favorites" USING btree ("user_id","talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_profile" ON "talent_reviews" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_reviewer" ON "talent_reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_session" ON "talent_reviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_rating" ON "talent_reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_created" ON "talent_reviews" USING btree ("created_at");