-- Manual migration: social_profiles.default_landing_tab
--
-- NOT tracked by drizzle-kit for this repo (drizzle/meta snapshots stop at
-- 0033 while drizzle/meta/_journal.json references tags up to 0117 with
-- duplicate/out-of-order idx values — drizzle-kit's own migration history is
-- already inconsistent here, independent of this change; see
-- add_event_marketing_settings.sql for the same note).
--
-- Matches `defaultLandingTab` in src/db/schema/social.js — the column was
-- added to the schema but its migration was never generated/applied, so any
-- query touching social_profiles (e.g. ProfileService.getOrCreateSocialProfile)
-- fails with "column default_landing_tab does not exist" until this runs.
-- Already applied to local dev.

ALTER TABLE "social_profiles"
  ADD COLUMN IF NOT EXISTS "default_landing_tab" varchar(10) NOT NULL DEFAULT 'posts';
