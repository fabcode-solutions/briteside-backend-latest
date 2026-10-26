-- Manual migration: purchased_tickets.view_token / purchased_tickets.view_token_expires_at
--
-- NOT tracked by drizzle-kit for this repo (see add_event_marketing_settings.sql
-- and add_social_profiles_default_landing_tab.sql for the same note about the
-- drizzle-kit history already being inconsistent here).
--
-- Backs the no-login "view your ticket" link sent in the purchase
-- confirmation email. view_token is a crypto.randomBytes(32) hex secret
-- (same pattern as door_sales tokens) — deliberately not ticket_code, which
-- is Math.random-based and not safe to use as a public link secret.

ALTER TABLE "purchased_tickets"
  ADD COLUMN IF NOT EXISTS "view_token" varchar(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS "view_token_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_purchased_tickets_view_token" ON "purchased_tickets" ("view_token");
