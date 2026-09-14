-- Manual migration: event_marketing_settings
--
-- NOT tracked by drizzle-kit (drizzle/meta snapshots stop at 0033 while
-- drizzle/meta/_journal.json references tags up to 0117 with duplicate/
-- out-of-order idx values — drizzle-kit's own migration history is already
-- inconsistent in this repo, independent of this change). Run this file by
-- hand against any environment that needs the Marketing tab (pixel IDs,
-- QR code, embed checkout) and doesn't already have this table.
--
-- Matches src/db/schema/eventMarketing.js. Already applied to the local
-- dev database.

CREATE TABLE IF NOT EXISTS "event_marketing_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "meta_pixel_id" varchar(100),
  "tiktok_pixel_id" varchar(100),
  "google_ads_id" varchar(100),
  "google_analytics_id" varchar(100),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_marketing_settings_event"
  ON "event_marketing_settings" ("event_id");
