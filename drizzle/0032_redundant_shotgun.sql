CREATE TABLE "guest_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_name" varchar(255) NOT NULL,
	"guest_email" varchar(255) NOT NULL,
	"guest_phone" varchar(20),
	"total_amount" numeric(10, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payment_intent_id" varchar(255),
	"stripe_session_id" varchar(255),
	"receipt_url" varchar(255),
	"is_door_sale" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guest_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_order_id" uuid NOT NULL,
	"ticket_tier_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guest_purchased_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_code" varchar(50) NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_tier_id" uuid NOT NULL,
	"guest_order_id" uuid NOT NULL,
	"holder_name" varchar(255) NOT NULL,
	"holder_email" varchar(255),
	"holder_phone" varchar(20),
	"price" numeric(10, 2) NOT NULL,
	"qr_code" text NOT NULL,
	"qr_code_url" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "guest_purchased_tickets_ticket_code_unique" UNIQUE("ticket_code")
);
--> statement-breakpoint
CREATE TABLE "user_follow_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "door_sales_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "door_sales_token" varchar(64);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "door_sales_token_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "youtube_video_url" varchar(500);--> statement-breakpoint
ALTER TABLE "event_tickets" ADD COLUMN "door_sale_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "guest_orders" ADD CONSTRAINT "guest_orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_guest_order_id_guest_orders_id_fk" FOREIGN KEY ("guest_order_id") REFERENCES "public"."guest_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_ticket_tier_id_event_tickets_id_fk" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."event_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_purchased_tickets" ADD CONSTRAINT "guest_purchased_tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_purchased_tickets" ADD CONSTRAINT "guest_purchased_tickets_ticket_tier_id_event_tickets_id_fk" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."event_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_purchased_tickets" ADD CONSTRAINT "guest_purchased_tickets_guest_order_id_guest_orders_id_fk" FOREIGN KEY ("guest_order_id") REFERENCES "public"."guest_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follow_requests" ADD CONSTRAINT "user_follow_requests_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guest_orders_event" ON "guest_orders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_guest_orders_status" ON "guest_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_guest_order_items_guest_order" ON "guest_order_items" USING btree ("guest_order_id");--> statement-breakpoint
CREATE INDEX "idx_guest_order_items_tier" ON "guest_order_items" USING btree ("ticket_tier_id");--> statement-breakpoint
CREATE INDEX "idx_follow_requests_requester" ON "user_follow_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_follow_requests_target" ON "user_follow_requests" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_follow_requests_unique" ON "user_follow_requests" USING btree ("requester_id","target_id");