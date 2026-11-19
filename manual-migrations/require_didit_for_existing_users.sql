-- Manual migration: require Didit age verification for EXISTING accounts too
--
-- NOT tracked by drizzle-kit for this repo (same note as
-- add_users_age_verification.sql). Run once per database, after
-- add_users_didit_age_verification.sql.
--
-- Before Didit, accounts were marked as verified adults from a self-typed
-- date of birth (age_verification_source = 'dob_registration' or
-- 'dob_profile_update'). A typed DOB isn't proof of age, so those accounts
-- are reset to 'pending': the web gate (AgeVerificationGate +
-- auth.middleware.js) will send them through Didit on their next visit,
-- exactly like a newly created account. Accounts already verified by Didit
-- (source 'didit') are untouched; admins stay exempt in code.
--
-- Reversible: the previous values are saved to
-- users_age_verification_backup first. To undo:
--
--   UPDATE "users" u
--   SET "is_verified_adult" = b."is_verified_adult",
--       "age_verification_source" = b."age_verification_source"
--   FROM "users_age_verification_backup" b
--   WHERE u."id" = b."user_id" AND u."age_verification_source" = 'pending';

BEGIN;

CREATE TABLE IF NOT EXISTS "users_age_verification_backup" (
  "user_id" uuid PRIMARY KEY,
  "is_verified_adult" boolean,
  "age_verification_source" varchar(50),
  "backed_up_at" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "users_age_verification_backup" ("user_id", "is_verified_adult", "age_verification_source")
SELECT "id", "is_verified_adult", "age_verification_source"
FROM "users"
WHERE "age_verification_source" IN ('dob_registration', 'dob_profile_update')
ON CONFLICT ("user_id") DO NOTHING;

UPDATE "users"
SET "is_verified_adult" = false,
    "age_verification_source" = 'pending'
WHERE "age_verification_source" IN ('dob_registration', 'dob_profile_update');

COMMIT;
