-- Manual migration: organizers.show_tickets_sold
--
-- NOT tracked by drizzle-kit for this repo (see add_users_age_verification.sql
-- for the same note about the drizzle-kit history already being inconsistent).
--
-- Schema (src/db/schema/organizers.js) declares this column, so every query
-- that selects from organizers (including the users -> organizer relation used
-- by login) fails with "column does not exist" until it is applied.

ALTER TABLE "organizers"
  ADD COLUMN IF NOT EXISTS "show_tickets_sold" boolean DEFAULT true NOT NULL;
