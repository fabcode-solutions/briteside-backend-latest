ALTER TYPE "public"."report_type" ADD VALUE 'talent_session';--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "report_screenshot_targets" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "booker_recording_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "talent_recording_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent_sessions" ADD COLUMN "recording_disclosure_version" varchar(32);--> statement-breakpoint
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
ALTER TABLE "talent_session_frames" ADD CONSTRAINT "talent_session_frames_session_id_talent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_session_frames_session" ON "talent_session_frames" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "user_reports" ADD COLUMN "talent_session_id" uuid;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_talent_session_id_talent_sessions_id_fk" FOREIGN KEY ("talent_session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reports_talent_session" ON "user_reports" USING btree ("talent_session_id");--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "unique_talent_session_report" UNIQUE("reporter_id","talent_session_id");
