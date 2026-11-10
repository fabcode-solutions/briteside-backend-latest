-- Manual migration: Didit age verification tracking on users
--
-- NOT tracked by drizzle-kit for this repo (same note as
-- add_users_age_verification.sql).
--
-- is_verified_adult is now only set by an Approved Didit session
-- (age_verification_source = 'didit'). These columns remember the user's
-- latest Didit session so the web gate can resume/poll it and webhooks can
-- tell a stale session from the current one.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "didit_session_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "didit_session_status" varchar(30);

CREATE INDEX IF NOT EXISTS "idx_users_didit_session_id" ON "users" ("didit_session_id");
