-- Manual migration: app setup flow (onboarding) — event + group category interests
--
-- NOT tracked by drizzle-kit for this repo (same note as
-- add_users_age_verification.sql).
--
-- users.onboarding_completed_at — set once the user has picked their event and
-- group categories; the web app blocks on the setup screens until it's set.
-- The two preference tables drive "for you" ranking on the Events / Groups tabs.
-- (The legacy, unused user_preferences table is intentionally left alone.)

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamptz;

CREATE TABLE IF NOT EXISTS "user_event_category_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_event_category_pref"
  ON "user_event_category_preferences" ("user_id", "category_id");

CREATE TABLE IF NOT EXISTS "user_group_category_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "group_categories"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_group_category_pref"
  ON "user_group_category_preferences" ("user_id", "category_id");
