-- Manual migration: users.is_verified_adult / users.age_verification_source
--
-- NOT tracked by drizzle-kit for this repo (see add_event_marketing_settings.sql
-- and add_social_profiles_default_landing_tab.sql for the same note about the
-- drizzle-kit history already being inconsistent here).
--
-- Supports the 18+ policy: dob-based checks happen at registration
-- (see auth.route.js dobSchema), and these columns record the outcome so
-- content/service endpoints can gate on a fast boolean instead of
-- recomputing age from dob on every request. age_verification_source is
-- reserved for a future native age-signal check on mobile
-- (e.g. 'apple_native_api' / 'google_native_api') without a schema change.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_verified_adult" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "age_verification_source" varchar(50) DEFAULT 'pending';
