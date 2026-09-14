import { inArray, sql, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  analyticsEvents,
  analyticsRollupState,
  postAnalyticsDaily,
  groupAnalyticsDaily,
  productAnalyticsDaily,
  serviceAnalyticsDaily,
} from '../db/schema/index.js';
import { cronLogger as logger } from '../config/logger.js';

const CURSOR_KEY = 'default';
const BATCH_SIZE = 5000;

// Maps entityType -> { rollup table, id column, event name -> counter column }.
// Only counters sourced from the raw event log live here — sales/revenue/
// bookings stay owned by the existing order/booking flows (see
// docs/BRITESIDE_ANALYTICS.md section 4, reconciliation rule).
const ROLLUP_TARGETS = {
  post: {
    table: postAnalyticsDaily,
    idColumn: postAnalyticsDaily.postId,
    idField: 'postId',
    columns: {
      impression: 'impressions',
      view: 'views',
      click: 'clicks',
      comment: 'comments',
      like: 'likes',
      share: 'shares',
    },
  },
  group: {
    table: groupAnalyticsDaily,
    idColumn: groupAnalyticsDaily.groupId,
    idField: 'groupId',
    columns: {
      impression: 'impressions',
      view: 'views',
      click: 'clicks',
      join: 'joins',
    },
  },
  product: {
    table: productAnalyticsDaily,
    idColumn: productAnalyticsDaily.productId,
    idField: 'productId',
    columns: {
      impression: 'impressions',
      view: 'views',
      click: 'clicks',
    },
  },
  service: {
    table: serviceAnalyticsDaily,
    idColumn: serviceAnalyticsDaily.talentProfileId,
    idField: 'talentProfileId',
    columns: {
      impression: 'impressions',
      view: 'views',
      click: 'clicks',
    },
  },
};

async function getCursor() {
  const row = await db.query.analyticsRollupState.findFirst({
    where: eq(analyticsRollupState.key, CURSOR_KEY),
  });
  return row?.lastProcessedAt ?? new Date(0);
}

async function setCursor(timestamp) {
  await db
    .insert(analyticsRollupState)
    .values({ key: CURSOR_KEY, lastProcessedAt: timestamp })
    .onConflictDoUpdate({
      target: analyticsRollupState.key,
      set: { lastProcessedAt: timestamp, updatedAt: sql`now()` },
    });
}

function dateKeyFor(occurredAt) {
  return new Date(occurredAt).toISOString().slice(0, 10);
}

/** Groups raw rows into { "entityType:entityId:date": { eventName: count } }. */
function aggregate(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const target = ROLLUP_TARGETS[row.entityType];
    if (!target || !row.entityId) continue;
    const column = target.columns[row.eventName];
    if (!column) continue;

    const key = `${row.entityType}:${row.entityId}:${dateKeyFor(row.occurredAt)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { entityType: row.entityType, entityId: row.entityId, date: dateKeyFor(row.occurredAt), counts: {} };
      buckets.set(key, bucket);
    }
    bucket.counts[column] = (bucket.counts[column] ?? 0) + 1;
  }
  return [...buckets.values()];
}

async function upsertBucket(bucket) {
  const target = ROLLUP_TARGETS[bucket.entityType];
  const allColumns = Object.values(target.columns);

  const insertValues = { date: bucket.date };
  insertValues[target.idField] = bucket.entityId;
  for (const col of allColumns) insertValues[col] = bucket.counts[col] ?? 0;

  const updateSet = { updatedAt: sql`now()` };
  for (const col of allColumns) {
    updateSet[col] = sql`${target.table[col]} + ${bucket.counts[col] ?? 0}`;
  }

  await db
    .insert(target.table)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [target.idColumn, target.table.date],
      set: updateSet,
    });
}

export async function runAnalyticsRollup() {
  const cursor = await getCursor();

  const rows = await db
    .select({
      entityType: analyticsEvents.entityType,
      entityId: analyticsEvents.entityId,
      eventName: analyticsEvents.eventName,
      occurredAt: analyticsEvents.occurredAt,
      receivedAt: analyticsEvents.receivedAt,
    })
    .from(analyticsEvents)
    .where(sql`${analyticsEvents.receivedAt} > ${cursor} AND ${inArray(analyticsEvents.entityType, Object.keys(ROLLUP_TARGETS))}`)
    .orderBy(analyticsEvents.receivedAt)
    .limit(BATCH_SIZE);

  if (rows.length === 0) return;

  const buckets = aggregate(rows);
  for (const bucket of buckets) {
    await upsertBucket(bucket);
  }

  const maxReceivedAt = rows.reduce(
    (max, row) => (row.receivedAt > max ? row.receivedAt : max),
    cursor
  );
  await setCursor(maxReceivedAt);

  logger.info('[Cron] AnalyticsRollup: processed batch', {
    rowsProcessed: rows.length,
    bucketsUpdated: buckets.length,
    caughtUp: rows.length < BATCH_SIZE,
  });

  // If this batch was full, there's likely more backlog — keep draining now
  // rather than waiting for the next scheduled tick.
  if (rows.length === BATCH_SIZE) {
    await runAnalyticsRollup();
  }
}
