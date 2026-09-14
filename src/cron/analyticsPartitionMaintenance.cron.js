import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cronLogger as logger } from '../config/logger.js';

// analytics_events is range-partitioned by month on occurred_at (see
// manual-migrations/add_analytics_events_partitioned.sql). Keeps the current
// month + next 3 months of partitions always present so inserts never fail
// for lack of a target partition.
const MONTHS_AHEAD = 3;

export async function ensureAnalyticsPartitions() {
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + i, 1));
    const partitionName = `analytics_events_${monthStart.getUTCFullYear()}_${String(
      monthStart.getUTCMonth() + 1
    ).padStart(2, '0')}`;

    await db.execute(sql`
      DO $$
      DECLARE
        month_start date := ${monthStart.toISOString().slice(0, 10)}::date;
        month_end date := month_start + interval '1 month';
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
          ${partitionName}, month_start, month_end
        );
      END $$;
    `);
  }

  logger.info('[Cron] AnalyticsPartitionMaintenance: ensured partitions through', {
    monthsAhead: MONTHS_AHEAD,
  });
}
