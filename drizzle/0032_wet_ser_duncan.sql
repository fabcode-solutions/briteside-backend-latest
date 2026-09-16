ALTER TYPE "public"."report_type" ADD VALUE 'discussion';--> statement-breakpoint
CREATE TABLE "user_follow_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "youtube_video_url" varchar(500);--> statement-breakpoint
ALTER TABLE "user_reports" ADD COLUMN "discussion_id" uuid;--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_follow_requests_requester" ON "user_follow_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_follow_requests_target" ON "user_follow_requests" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_follow_requests_unique" ON "user_follow_requests" USING btree ("requester_id","target_id");--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_discussion_id_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reports_discussion" ON "user_reports" USING btree ("discussion_id");--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "unique_discussion_report" UNIQUE("reporter_id","discussion_id");