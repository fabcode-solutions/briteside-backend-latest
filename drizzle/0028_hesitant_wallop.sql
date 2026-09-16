ALTER TYPE "public"."report_type" ADD VALUE 'social_chat';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurrence_rule" jsonb;--> statement-breakpoint
ALTER TABLE "user_reports" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_conversation_id_social_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."social_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "unique_social_chat_report" UNIQUE("reporter_id","conversation_id");