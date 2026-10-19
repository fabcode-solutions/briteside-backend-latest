-- Manual migration: vanity slug columns on event_marketing_settings
--
-- NOT tracked by drizzle-kit (see add_event_marketing_settings.sql for why
-- this table's migrations are hand-written). Run this file by hand against
-- any environment that already has event_marketing_settings and needs the
-- organizer-facing vanity URL field on the Marketing tab.
--
-- Matches src/db/schema/eventMarketing.js.

ALTER TABLE "event_marketing_settings"
  ADD COLUMN IF NOT EXISTS "vanity_slug" varchar(50),
  ADD COLUMN IF NOT EXISTS "vanity_slug_expires_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_marketing_settings_vanity_slug"
  ON "event_marketing_settings" ("vanity_slug");
