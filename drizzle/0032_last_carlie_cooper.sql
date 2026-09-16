CREATE TABLE "user_follow_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_team_roles" DROP CONSTRAINT "event_team_roles_team_id_event_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "youtube_video_url" varchar(500);--> statement-breakpoint
ALTER TABLE "event_team_roles" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_team_roles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_follow_requests_requester" ON "user_follow_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_follow_requests_target" ON "user_follow_requests" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_follow_requests_unique" ON "user_follow_requests" USING btree ("requester_id","target_id");--> statement-breakpoint
ALTER TABLE "event_team_roles" DROP COLUMN "team_id";