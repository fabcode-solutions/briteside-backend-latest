CREATE TABLE "talent_gift_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gifter_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"duration_mins" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"recipient_name" varchar(255),
	"recipient_email" varchar(255),
	"recipient_phone" varchar(50),
	"occasion" varchar(100),
	"personal_message" text,
	"delivery_date" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent_gift_codes" ADD CONSTRAINT "talent_gift_codes_gifter_id_users_id_fk" FOREIGN KEY ("gifter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_gift_codes" ADD CONSTRAINT "talent_gift_codes_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_gift_codes" ADD CONSTRAINT "talent_gift_codes_redeemed_session_id_talent_sessions_id_fk" FOREIGN KEY ("redeemed_session_id") REFERENCES "public"."talent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_talent_gift_codes_code" ON "talent_gift_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_talent_gift_codes_gifter" ON "talent_gift_codes" USING btree ("gifter_id");--> statement-breakpoint
CREATE INDEX "idx_talent_gift_codes_talent" ON "talent_gift_codes" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_gift_codes_status" ON "talent_gift_codes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_talent_gift_codes_recipient_email" ON "talent_gift_codes" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "idx_talent_gift_codes_expires" ON "talent_gift_codes" USING btree ("expires_at");