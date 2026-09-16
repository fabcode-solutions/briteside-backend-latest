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
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_reviews" ADD CONSTRAINT "talent_reviews_session_id_talent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_profile" ON "talent_reviews" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_reviewer" ON "talent_reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_session" ON "talent_reviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_rating" ON "talent_reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_talent_reviews_created" ON "talent_reviews" USING btree ("created_at");