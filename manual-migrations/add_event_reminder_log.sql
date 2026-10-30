-- Manual migration: remember which event reminders were already sent
--
-- NOT tracked by drizzle-kit for this repo (see add_event_marketing_settings.sql
-- for the same note about the drizzle-kit history already being inconsistent).
--
-- The 24h/6h event-reminder crons re-scan every event in their window on each
-- run (hourly / every 2 hours) and had no record of what they'd sent, so ticket
-- holders got the same reminder notification + email every run. The cron now
-- inserts here first and only sends when the insert wins the unique index.
--
-- Run BEFORE deploying the code that writes it. Backfills reminders already
-- sent so nobody gets one more copy right after deploy.

CREATE TABLE IF NOT EXISTS "event_reminder_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "hours_before" integer NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_reminder_log"
  ON "event_reminder_log" ("event_id", "user_id", "hours_before");

INSERT INTO "event_reminder_log" ("event_id", "user_id", "hours_before", "sent_at")
SELECT DISTINCT ON (e."id", n."user_id", (n."metadata"->>'hoursBefore')::int)
  e."id", n."user_id", (n."metadata"->>'hoursBefore')::int, n."created_at"
FROM "notifications" n
JOIN "events" e ON e."id"::text = n."metadata"->>'eventId'
WHERE n."type" = 'event_reminder'
  AND n."metadata"->>'hoursBefore' ~ '^[0-9]+$'
ORDER BY e."id", n."user_id", (n."metadata"->>'hoursBefore')::int, n."created_at"
ON CONFLICT DO NOTHING;
