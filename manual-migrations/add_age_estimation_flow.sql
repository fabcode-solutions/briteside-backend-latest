-- Manual migration: selfie age estimation first, ID only for the 18-22 band
--
-- NOT tracked by drizzle-kit for this repo (same note as
-- add_users_age_verification.sql). Run once per database, after
-- add_users_didit_age_verification.sql.
--
-- age_verification_step: NULL = start with the selfie age estimate;
--   'id_required' = the estimate came back under the auto-pass age, so the
--   user must finish with an ID document + selfie.
-- didit_session_kind: which Didit workflow the current session belongs to
--   ('estimate' | 'id'); NULL for sessions created before this change, which
--   are treated as ID sessions.
-- age_verification_consents: one row per consent clickwrap acceptance.

BEGIN;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "age_verification_step" varchar(20),
  ADD COLUMN IF NOT EXISTS "didit_session_kind" varchar(20);

CREATE TABLE IF NOT EXISTS "age_verification_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "text_version" varchar(20) NOT NULL,
  "consent_text" text NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_age_verification_consents_user"
  ON "age_verification_consents" ("user_id", "created_at");

COMMIT;
