-- Imported third-party event listings (Ticketmaster, VenuNite).
-- See src/services/externalEvents. Safe to re-run.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'briteside' NOT NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_url" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_status" varchar(20);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_price_min" numeric(10, 2);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_price_max" numeric(10, 2);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "external_last_seen_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_events_source_external_id"
  ON "events" USING btree ("source", "external_id")
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_events_source" ON "events" USING btree ("source");

-- One session per upstream performance, each with its own buy link.
ALTER TABLE "event_schedules" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
ALTER TABLE "event_schedules" ADD COLUMN IF NOT EXISTS "external_url" text;
