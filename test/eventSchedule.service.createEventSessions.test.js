import { describe, it, expect, vi } from 'vitest';
import { EventScheduleService } from '../src/services/eventSchedule.service.js';

// Minimal fake drizzle client. `findMany` is called twice per successful run:
// once (before any insert) to check for overlaps against existing schedules,
// and once again (after the insert) to recompute the event's date range from
// everything now on file — so the second call must see the just-inserted rows.
function makeFakeDbClient({ existingSchedules = [] } = {}) {
  const insertedRows = [];
  let findManyCalls = 0;

  const findMany = vi.fn(async () => {
    findManyCalls += 1;
    return findManyCalls === 1 ? existingSchedules : insertedRows;
  });

  const insert = vi.fn(() => ({
    values: values => ({
      returning: async () => {
        const rows = (Array.isArray(values) ? values : [values]).map((v, i) => ({
          id: `session-${insertedRows.length + i}`,
          ...v,
        }));
        insertedRows.push(...rows);
        return rows;
      },
    }),
  }));

  const where = vi.fn(async () => {});
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return {
    query: { eventSchedules: { findMany } },
    insert,
    update,
    _insertedRows: insertedRows,
  };
}

const session = (date, startTime, endTime, title = 'Session') => ({
  title,
  date,
  startTime,
  endTime,
});

describe('EventScheduleService.createEventSessions', () => {
  it('rejects two new sessions that overlap each other and inserts nothing', async () => {
    const dbClient = makeFakeDbClient();
    const sessions = [
      session('2026-10-17', '2026-10-17T16:00:00.000Z', '2026-10-17T18:00:00.000Z', 'Session A'),
      session('2026-10-17', '2026-10-17T17:00:00.000Z', '2026-10-17T19:00:00.000Z', 'Session B'),
    ];

    await expect(
      EventScheduleService.createEventSessions('event-1', 'Event', 'Desc', sessions, dbClient)
    ).rejects.toThrow(/overlap/i);

    expect(dbClient.insert).not.toHaveBeenCalled();
    expect(dbClient._insertedRows).toHaveLength(0);
  });

  it('rejects a new session that overlaps an existing schedule and inserts nothing', async () => {
    const dbClient = makeFakeDbClient({
      existingSchedules: [
        {
          id: 'existing-1',
          title: 'Existing session',
          startTime: new Date('2026-10-17T16:00:00.000Z'),
          endTime: new Date('2026-10-17T18:00:00.000Z'),
        },
      ],
    });
    const sessions = [
      session('2026-10-17', '2026-10-17T17:00:00.000Z', '2026-10-17T19:00:00.000Z'),
    ];

    await expect(
      EventScheduleService.createEventSessions('event-1', 'Event', 'Desc', sessions, dbClient)
    ).rejects.toThrow(/overlaps with existing session/i);

    expect(dbClient.insert).not.toHaveBeenCalled();
  });

  it('creates all sessions and updates the event date range when nothing overlaps', async () => {
    const dbClient = makeFakeDbClient();
    const sessions = [
      session('2026-10-17', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 'Session A'),
      session('2026-10-17', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 'Session B'),
    ];

    const created = await EventScheduleService.createEventSessions(
      'event-1',
      'Event',
      'Desc',
      sessions,
      dbClient
    );

    expect(created).toHaveLength(2);
    expect(dbClient.insert).toHaveBeenCalledTimes(1);
    expect(dbClient._insertedRows).toHaveLength(2);
    expect(dbClient.update).toHaveBeenCalledTimes(1);
  });

  it('fixing the conflicting session time and retrying succeeds against the same dbClient', async () => {
    const dbClient = makeFakeDbClient();
    const overlapping = [
      session('2026-10-17', '2026-10-17T16:00:00.000Z', '2026-10-17T18:00:00.000Z', 'Session A'),
      session('2026-10-17', '2026-10-17T17:00:00.000Z', '2026-10-17T19:00:00.000Z', 'Session B'),
    ];

    await expect(
      EventScheduleService.createEventSessions('event-1', 'Event', 'Desc', overlapping, dbClient)
    ).rejects.toThrow(/overlap/i);
    expect(dbClient.insert).not.toHaveBeenCalled();

    const fixed = [
      session('2026-10-17', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 'Session A'),
      session('2026-10-17', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 'Session B'),
    ];
    const created = await EventScheduleService.createEventSessions(
      'event-1',
      'Event',
      'Desc',
      fixed,
      dbClient
    );

    expect(created).toHaveLength(2);
    expect(dbClient.insert).toHaveBeenCalledTimes(1);
  });
});
