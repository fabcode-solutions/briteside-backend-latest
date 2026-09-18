ALTER TYPE "public"."shop_custom_offer_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TABLE "shop_custom_service_offers" ADD COLUMN "reserve_amount_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "shop_custom_service_offers" ADD COLUMN "reserve_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "reserve_amount_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "reserve_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "reserve_amount_cents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "priority_message_payments" ADD COLUMN "reserve_released_at" timestamp with time zone;