import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  analyticsEvents,
  talentProfiles,
  serviceAnalyticsDaily,
  analyticsRollupState,
} from '../src/db/schema/index.js';

// Bug: service_analytics_daily.talent_profile_id is a FOREIGN KEY, so a
// 'service' analytics event logged for a talent profile that's since been
// deleted (or never existed — a stale/replayed event) throws on upsert and
// aborts the ENTIRE rollup batch, including every other unrelated bucket in
// it. Fixed by skipping only the buckets referencing a missing profile.

function chainableFrom(resultPromise) {
  const obj = {
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve, reject) => resultPromise.then(resolve, reject),
    catch: reject => resultPromise.catch(reject),
  };
  return obj;
}

const insertCalls = [];

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      analyticsRollupState: { findFirst: vi.fn(async () => null) },
    },
    select: () => ({
      from(table) {
        if (table === analyticsEvents) {
          return chainableFrom(
            Promise.resolve([
              {
                entityType: 'service',
                entityId: 'existing-profile',
                eventName: 'view',
                occurredAt: new Date('2026-09-18T12:00:00Z'),
                receivedAt: new Date('2026-09-18T12:00:01Z'),
              },
              {
                entityType: 'service',
                entityId: 'missing-profile',
                eventName: 'view',
                occurredAt: new Date('2026-09-18T12:00:00Z'),
                receivedAt: new Date('2026-09-18T12:00:02Z'),
              },
            ])
          );
        }
        if (table === talentProfiles) {
          // Only 'existing-profile' is actually in the talent_profiles table.
          return chainableFrom(Promise.resolve([{ id: 'existing-profile' }]));
        }
        return chainableFrom(Promise.resolve([]));
      },
    }),
    insert: table => ({
      values: vals => ({
        onConflictDoUpdate: opts => {
          insertCalls.push({ table, vals, opts });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

const { runAnalyticsRollup } = await import('../src/cron/analyticsRollup.cron.js');

beforeEach(() => {
  insertCalls.length = 0;
});

describe('runAnalyticsRollup', () => {
  it('skips a service event for a talent profile that no longer exists, without failing the rest of the batch', async () => {
    await runAnalyticsRollup();

    const serviceUpserts = insertCalls.filter(c => c.table === serviceAnalyticsDaily);
    expect(serviceUpserts).toHaveLength(1);
    expect(serviceUpserts[0].vals.talentProfileId).toBe('existing-profile');

    // The missing profile must never reach the insert at all.
    expect(insertCalls.some(c => c.vals.talentProfileId === 'missing-profile')).toBe(false);

    // The cursor still advances past both events (including the skipped
    // one) -- otherwise the same unresolvable event would be retried on
    // every future tick forever.
    const cursorUpsert = insertCalls.find(c => c.table === analyticsRollupState);
    expect(cursorUpsert).toBeTruthy();
  });
});
