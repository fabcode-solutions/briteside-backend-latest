-- Manual migration: subscription_plans.trial_days
--
-- NOT tracked by drizzle-kit for this repo (see add_users_age_verification.sql
-- for the same note about the drizzle-kit history already being inconsistent).
--
-- Free trial length (days) offered to first-time BriteSide Plus subscribers on
-- this plan; 0 = no trial. Schema (src/db/schema/britesidePlus.js) declares
-- this column, so every query that selects from subscription_plans fails with
-- "column does not exist" until it is applied.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "trial_days" integer DEFAULT 0 NOT NULL;
