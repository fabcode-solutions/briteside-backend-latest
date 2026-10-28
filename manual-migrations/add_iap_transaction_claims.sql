-- Manual migration: one claim per App Store / Google Play purchase
--
-- NOT tracked by drizzle-kit for this repo (see add_event_marketing_settings.sql
-- for the same note about the drizzle-kit history already being inconsistent).
--
-- Priority messages and shop listings sell the same consumable price tiers, so
-- the per-table unique indexes on iap_transaction_id can't stop one purchase
-- being redeemed once in each table. IapClaimService inserts a row here in the
-- same DB transaction as the order/payment; (store, transaction_id) is unique.
--
-- Run BEFORE deploying the code that writes it. Backfills purchases already
-- recorded so they can't be redeemed again after deploy (environment is not
-- known for those rows, hence 'unknown').

CREATE TABLE IF NOT EXISTS "iap_transaction_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store" varchar(10) NOT NULL,
  "transaction_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "purpose" varchar(30) NOT NULL,
  "reference_id" uuid,
  "product_id" varchar(255) NOT NULL,
  "environment" varchar(12) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_iap_claims_store_txn"
  ON "iap_transaction_claims" ("store", "transaction_id");
CREATE INDEX IF NOT EXISTS "idx_iap_claims_user"
  ON "iap_transaction_claims" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_iap_claims_reference"
  ON "iap_transaction_claims" ("purpose", "reference_id");

INSERT INTO "iap_transaction_claims"
  ("store", "transaction_id", "user_id", "purpose", "reference_id", "product_id", "environment", "created_at")
SELECT
  CASE "purchase_channel" WHEN 'apple_iap' THEN 'apple' ELSE 'google' END,
  "iap_transaction_id", "sender_id", 'priority_message', "id", COALESCE("iap_product_id", 'unknown'), 'unknown',
  COALESCE("iap_verified_at", "created_at")
FROM "priority_message_payments"
WHERE "iap_transaction_id" IS NOT NULL
ON CONFLICT ("store", "transaction_id") DO NOTHING;

INSERT INTO "iap_transaction_claims"
  ("store", "transaction_id", "user_id", "purpose", "reference_id", "product_id", "environment", "created_at")
SELECT
  CASE "purchase_channel" WHEN 'apple_iap' THEN 'apple' ELSE 'google' END,
  "iap_transaction_id", "buyer_id", 'shop_order', "id", COALESCE("iap_product_id", 'unknown'), 'unknown',
  COALESCE("iap_verified_at", "created_at")
FROM "shop_orders"
WHERE "iap_transaction_id" IS NOT NULL
ON CONFLICT ("store", "transaction_id") DO NOTHING;
