CREATE TABLE "priority_message_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"talent_user_id" uuid NOT NULL,
	"subject" varchar(255),
	"message_content" text,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stripe_session_id" varchar(255),
	"stripe_payment_intent" varchar(255),
	"conversation_id" uuid,
	"message_id" uuid,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD CONSTRAINT "priority_message_payments_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD CONSTRAINT "priority_message_payments_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD CONSTRAINT "priority_message_payments_talent_user_id_users_id_fk" FOREIGN KEY ("talent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD CONSTRAINT "priority_message_payments_conversation_id_social_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."social_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD CONSTRAINT "priority_message_payments_message_id_social_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."social_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pmp_sender" ON "priority_message_payments" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_pmp_talent_user" ON "priority_message_payments" USING btree ("talent_user_id");--> statement-breakpoint
CREATE INDEX "idx_pmp_talent_profile" ON "priority_message_payments" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_pmp_status" ON "priority_message_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pmp_stripe_session" ON "priority_message_payments" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_pmp_paid_at" ON "priority_message_payments" USING btree ("paid_at");