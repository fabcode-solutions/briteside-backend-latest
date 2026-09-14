import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

// Single-row-per-key cursor table so analyticsRollup.cron.js knows where it
// left off in analytics_events (keyed by receivedAt, which is server-assigned
// and therefore safe to cursor on — unlike client-supplied occurredAt).
export const analyticsRollupState = pgTable('analytics_rollup_state', {
  key: varchar('key', { length: 64 }).primaryKey(),
  lastProcessedAt: timestamp('last_processed_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
