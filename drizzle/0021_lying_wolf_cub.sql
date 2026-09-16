CREATE TABLE "talent_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"talent_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent_favorites" ADD CONSTRAINT "talent_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_favorites" ADD CONSTRAINT "talent_favorites_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_favorites_user" ON "talent_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_talent_favorites_profile" ON "talent_favorites" USING btree ("talent_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_talent_favorites_unique" ON "talent_favorites" USING btree ("user_id","talent_profile_id");