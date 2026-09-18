CREATE TYPE "public"."device_platform_enum" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_uid" text NOT NULL,
	"platform" "device_platform_enum",
	"device_model" varchar(100),
	"app_version" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"first_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_devices_user_id" ON "user_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_devices_notification_uid" ON "user_devices" USING btree ("notification_uid");--> statement-breakpoint
CREATE INDEX "idx_user_devices_is_active" ON "user_devices" USING btree ("is_active");