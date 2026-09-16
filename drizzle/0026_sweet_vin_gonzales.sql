CREATE TABLE "livestream_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livestream_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "livestream_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livestream_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "livestream_viewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"livestream_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "livestreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"stream_call_id" varchar(255) NOT NULL,
	"stream_call_cid" varchar(255),
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"thumbnail_url" text,
	"viewer_count" integer DEFAULT 0 NOT NULL,
	"peak_viewer_count" integer DEFAULT 0 NOT NULL,
	"total_reactions" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "livestream_comments" ADD CONSTRAINT "livestream_comments_livestream_id_livestreams_id_fk" FOREIGN KEY ("livestream_id") REFERENCES "public"."livestreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestream_comments" ADD CONSTRAINT "livestream_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestream_reactions" ADD CONSTRAINT "livestream_reactions_livestream_id_livestreams_id_fk" FOREIGN KEY ("livestream_id") REFERENCES "public"."livestreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestream_reactions" ADD CONSTRAINT "livestream_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestream_viewers" ADD CONSTRAINT "livestream_viewers_livestream_id_livestreams_id_fk" FOREIGN KEY ("livestream_id") REFERENCES "public"."livestreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestream_viewers" ADD CONSTRAINT "livestream_viewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestreams" ADD CONSTRAINT "livestreams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_livestream_comments_stream" ON "livestream_comments" USING btree ("livestream_id");--> statement-breakpoint
CREATE INDEX "idx_livestream_comments_user" ON "livestream_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_livestream_comments_created" ON "livestream_comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_livestream_reactions_stream" ON "livestream_reactions" USING btree ("livestream_id");--> statement-breakpoint
CREATE INDEX "idx_livestream_reactions_user" ON "livestream_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_livestream_reactions_created" ON "livestream_reactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_livestream_viewers_stream" ON "livestream_viewers" USING btree ("livestream_id");--> statement-breakpoint
CREATE INDEX "idx_livestream_viewers_user" ON "livestream_viewers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_livestream_viewers_unique" ON "livestream_viewers" USING btree ("livestream_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_livestreams_user" ON "livestreams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_livestreams_status" ON "livestreams" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_livestreams_started_at" ON "livestreams" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_livestreams_stream_call_id" ON "livestreams" USING btree ("stream_call_id");