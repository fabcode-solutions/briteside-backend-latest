-- Manual migration: native App Store / Google Play purchases for priority messages
--
-- NOT tracked by drizzle-kit for this repo (see add_event_marketing_settings.sql
-- for the same note about the drizzle-kit history already being inconsistent).
--
-- Adds the columns PriorityMessageIapService writes when a sender pays with
-- "Pay in App" (consumable price-tier IAP) instead of Stripe Checkout.
-- Existing rows default to purchase_channel = 'stripe'.

ALTER TABLE "priority_message_payments"
  ADD COLUMN IF NOT EXISTS "purchase_channel" varchar(12) NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS "iap_product_id" varchar(40),
  ADD COLUMN IF NOT EXISTS "iap_transaction_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "iap_order_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "iap_verified_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pmp_iap_transaction_id"
  ON "priority_message_payments" ("iap_transaction_id");
