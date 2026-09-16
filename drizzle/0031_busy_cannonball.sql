CREATE TABLE "event_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"member_code" varchar(64),
	"password_hash" varchar(255),
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_authenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_team_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ticket_scans" ALTER COLUMN "scanned_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_scans" ADD COLUMN "scanned_by_team_member" uuid;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD COLUMN "team_member_id" uuid;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD COLUMN "checked_in_by_team_member" uuid;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_team_id_event_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."event_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_role_id_event_team_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_team_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_roles" ADD CONSTRAINT "event_team_roles_team_id_event_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."event_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_teams" ADD CONSTRAINT "event_teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_teams" ADD CONSTRAINT "event_teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_team_event" ON "event_team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_event_team_member_code" ON "event_team_members" USING btree ("member_code");--> statement-breakpoint
CREATE INDEX "idx_event_team_members_user" ON "event_team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_scanned_by_team_member_event_team_members_id_fk" FOREIGN KEY ("scanned_by_team_member") REFERENCES "public"."event_team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_team_member_id_event_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."event_team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_checked_in_by_team_member_event_team_members_id_fk" FOREIGN KEY ("checked_in_by_team_member") REFERENCES "public"."event_team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_scans_team_member" ON "ticket_scans" USING btree ("scanned_by_team_member");