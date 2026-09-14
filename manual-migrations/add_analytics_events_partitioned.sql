-- Manual migration: analytics_events (partitioned), analytics_identity_links,
-- post/group/product/service_analytics_daily, analytics_event_definitions.
--
-- NOT tracked by drizzle-kit (drizzle-kit cannot generate `PARTITION BY RANGE`
-- DDL). Run this file by hand against any environment before running
-- `drizzle-kit generate`/`migrate` for the rest of the schema — drizzle-kit
-- will see these tables already exist and generate no conflicting DDL for
-- them, since the shapes here match src/db/schema/analyticsEvents.js,
-- analyticsIdentity.js, analyticsRollups.js, analyticsEventDefinitions.js
-- exactly. See docs/BRITESIDE_ANALYTICS.md section 1.
--
-- Range-partitioned by month on occurred_at. This migration creates the
-- current month + next 3 months; src/cron/analyticsPartitionMaintenance.cron.js
-- keeps rolling that window forward.

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "event_name" varchar(64) NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" uuid,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "anonymous_id" varchar(64),
  "session_id" varchar(64),
  "client_event_id" uuid NOT NULL,
  "properties" jsonb NOT NULL DEFAULT '{}',
  "context" jsonb,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE ("occurred_at");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_analytics_events_client_event"
  ON "analytics_events" ("client_event_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_entity_timeline"
  ON "analytics_events" ("entity_type", "entity_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_entity_funnel"
  ON "analytics_events" ("entity_type", "entity_id", "event_name", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_analytics_events_user"
  ON "analytics_events" ("user_id", "occurred_at") WHERE "user_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_analytics_events_anonymous"
  ON "analytics_events" ("anonymous_id", "occurred_at") WHERE "anonymous_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_analytics_events_session"
  ON "analytics_events" ("session_id");

-- Pre-create current month + next 3 months of partitions. Idempotent: safe to
-- re-run (also what analyticsPartitionMaintenance.cron.js does going forward).
DO $$
DECLARE
  month_start date;
  month_end date;
  partition_name text;
  i integer;
BEGIN
  FOR i IN 0..3 LOOP
    month_start := date_trunc('month', now() + (i || ' months')::interval);
    month_end := month_start + interval '1 month';
    partition_name := 'analytics_events_' || to_char(month_start, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
      partition_name, month_start, month_end
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS "analytics_identity_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "anonymous_id" varchar(64) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "linked_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_identity_links"
  ON "analytics_identity_links" ("anonymous_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_analytics_identity_links_user"
  ON "analytics_identity_links" ("user_id");

CREATE TABLE IF NOT EXISTS "post_analytics_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "views" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "comments" integer NOT NULL DEFAULT 0,
  "likes" integer NOT NULL DEFAULT 0,
  "shares" integer NOT NULL DEFAULT 0,
  "saves" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_post_analytics_daily"
  ON "post_analytics_daily" ("post_id", "date");

CREATE TABLE IF NOT EXISTS "group_analytics_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "views" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "joins" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_group_analytics_daily"
  ON "group_analytics_daily" ("group_id", "date");

CREATE TABLE IF NOT EXISTS "product_analytics_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "shop_products"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "views" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "sales" integer NOT NULL DEFAULT 0,
  "revenue" decimal(10, 2) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_analytics_daily"
  ON "product_analytics_daily" ("product_id", "date");

CREATE TABLE IF NOT EXISTS "service_analytics_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "talent_profile_id" uuid NOT NULL REFERENCES "talent_profiles"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "views" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "bookings_started" integer NOT NULL DEFAULT 0,
  "bookings_completed" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_analytics_daily"
  ON "service_analytics_daily" ("talent_profile_id", "date");

CREATE TABLE IF NOT EXISTS "analytics_event_definitions" (
  "event_name" varchar(64) PRIMARY KEY,
  "label" varchar(128) NOT NULL,
  "description" text,
  "applicable_entity_types" text[] NOT NULL DEFAULT '{}',
  "funnel_order" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "analytics_event_definitions"
  ("event_name", "label", "description", "applicable_entity_types", "funnel_order")
VALUES
  ('impression', 'Impression', 'Entity shown in a feed/search result', '{post,group,event,product,service}', 1),
  ('view', 'Dwell View', '2-4s+ viewport dwell', '{post,group,event,product,service}', 2),
  ('click', 'Click', 'Entity opened', '{post,group,event,product,service}', 3),
  ('comment', 'Comment', 'Comment posted', '{post,event}', 4),
  ('like', 'Like', 'Like/reaction added', '{post,event}', NULL),
  ('share', 'Share', 'Entity shared', '{post,group,event,product,service}', NULL),
  ('search_performed', 'Search Performed', 'Search query executed', '{none}', NULL)
ON CONFLICT ("event_name") DO NOTHING;

-- Rollup cursor — single row, tracks how far analyticsRollup.cron.js has
-- processed analytics_events (by received_at, the server-assigned column).
CREATE TABLE IF NOT EXISTS "analytics_rollup_state" (
  "key" varchar(64) PRIMARY KEY,
  "last_processed_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "analytics_rollup_state" ("key", "last_processed_at")
VALUES ('default', 'epoch')
ON CONFLICT ("key") DO NOTHING;
