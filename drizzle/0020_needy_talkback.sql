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
ALTER TABLE "talent_date_overrides" ADD CONSTRAINT "talent_date_overrides_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_profile" ON "talent_date_overrides" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_date" ON "talent_date_overrides" USING btree ("override_date");--> statement-breakpoint
CREATE INDEX "idx_talent_date_overrides_profile_date" ON "talent_date_overrides" USING btree ("talent_profile_id","override_date");