import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApiError from '../src/utils/api-error.js';

// event.service.js pulls in a large dependency graph (moderation, uploads,
// SNS, organizer bookkeeping...). For this test we only care about its own
// orchestration — did it wrap the event insert + session creation in one
// transaction, did it pass that transaction down to EventScheduleService,
// did it short-circuit on a replayed clientRequestId — so everything else is
// stubbed out to keep the test deterministic and network-free.

const organizerRow = { id: 'organizer-1', userId: 'user-1' };

const findFirstOrganizers = vi.fn(async () => organizerRow);
const findFirstEvents = vi.fn(async () => null); // default: slug free, no replay match

let lastTx = null;
const txInsertEvents = vi.fn();
const transaction = vi.fn(async cb => {
  const tx = {
    insert: table => ({
      values: values => ({
        returning: async () => {
          const row = {
            id: 'event-1',
            coverImages: [],
            ...values,
          };
          txInsertEvents(table, values);
          return [row];
        },
      }),
    }),
  };
  lastTx = tx;
  return cb(tx);
});

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      organizers: { findFirst: (...args) => findFirstOrganizers(...args) },
      events: { findFirst: (...args) => findFirstEvents(...args) },
    },
    transaction: (...args) => transaction(...args),
  },
}));

const createEventSessions = vi.fn(async () => [{ id: 'session-1' }]);
vi.mock('../src/services/eventSchedule.service.js', () => ({
  EventScheduleService: { createEventSessions: (...args) => createEventSessions(...args) },
}));

const assertAllowed = vi.fn(async () => ({ action: 'allow' }));
const recordIfFlagged = vi.fn();
vi.mock('../src/services/moderation/textModeration.service.js', () => ({
  TextModerationService: {
    assertAllowed: (...args) => assertAllowed(...args),
    recordIfFlagged: (...args) => recordIfFlagged(...args),
  },
  TEXT_ENTITY: { EVENT: 'event' },
}));

const adoptMediaVerdicts = vi.fn(async () => {});
vi.mock('../src/services/moderation/mediaModeration.service.js', () => ({
  MediaModerationService: {
    adoptMediaVerdicts: (...args) => adoptMediaVerdicts(...args),
    splitUrls: () => ({ imageUrls: [], videoUrls: [] }),
  },
  MEDIA_ENTITY: { EVENT: 'event' },
}));

const incrementEventCount = vi.fn(async () => {});
vi.mock('../src/services/organizer.service.js', () => ({
  OrganizerService: { incrementEventCount: (...args) => incrementEventCount(...args) },
}));

const { EventService } = await import('../src/services/event.service.js');

const baseEventData = () => ({
  title: 'Duplicate event create',
  description: 'Test description',
  categoryIds: ['cat-1'],
  eventType: 'public',
  eventStatus: 'draft', // skip the SNS-topic branch entirely
  eventMode: 'in_person',
  isFree: true,
  capacity: 50,
  coverImages: ['https://example.com/cover.jpg'],
  sessions: [
    {
      title: 'Session A',
      date: '2026-10-17',
      startTime: '2026-10-17T16:00:00.000Z',
      endTime: '2026-10-17T17:00:00.000Z',
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  findFirstOrganizers.mockResolvedValue(organizerRow);
  findFirstEvents.mockResolvedValue(null);
  createEventSessions.mockResolvedValue([{ id: 'session-1' }]);
  vi.spyOn(EventService, 'getEventById').mockImplementation(async id => ({ id, stub: true }));
});

describe('EventService.createEvent — transactional atomicity', () => {
  it('creates the event and its sessions inside one transaction, passing the tx client through', async () => {
    await EventService.createEvent('organizer-1', baseEventData());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txInsertEvents).toHaveBeenCalledTimes(1);
    expect(createEventSessions).toHaveBeenCalledTimes(1);
    // 5th arg is the transaction's tx client, not the bare db — this is what
    // makes an overlap failure roll back the event row with it.
    expect(createEventSessions.mock.calls[0][4]).toBe(lastTx);
    expect(incrementEventCount).toHaveBeenCalledTimes(1);
  });

  it('propagates the overlap error and performs no side effects beyond the rolled-back transaction', async () => {
    createEventSessions.mockRejectedValueOnce(
      new ApiError(400, 'Sessions overlap: Two event sessions overlap with each other.')
    );

    await expect(EventService.createEvent('organizer-1', baseEventData())).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/overlap/i),
    });

    // Nothing past the transaction ran: no count bump, no moderation bookkeeping.
    expect(incrementEventCount).not.toHaveBeenCalled();
    expect(adoptMediaVerdicts).not.toHaveBeenCalled();
    expect(recordIfFlagged).not.toHaveBeenCalled();
  });

  it('retrying after fixing the session succeeds and only ever inserts one event row', async () => {
    createEventSessions.mockRejectedValueOnce(new ApiError(400, 'Sessions overlap'));
    await expect(EventService.createEvent('organizer-1', baseEventData())).rejects.toThrow();
    expect(txInsertEvents).toHaveBeenCalledTimes(1); // attempted, but rolled back by the throw

    createEventSessions.mockResolvedValueOnce([{ id: 'session-1' }]);
    await EventService.createEvent('organizer-1', baseEventData());

    // Across both attempts, the (fixed) retry is the only one that completes —
    // a real Postgres transaction discards the first insert on the throw above,
    // so only this second commit is the one the retry correctly expects: one event.
    expect(incrementEventCount).toHaveBeenCalledTimes(1);
  });
});

describe('EventService.createEvent — duplicate submission (clientRequestId)', () => {
  it('a brand-new clientRequestId proceeds to create normally', async () => {
    await EventService.createEvent('organizer-1', { ...baseEventData(), clientRequestId: 'req-1' });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(incrementEventCount).toHaveBeenCalledTimes(1);
  });

  it('a clientRequestId that already has a matching event short-circuits before the transaction', async () => {
    findFirstEvents.mockResolvedValueOnce(null); // slug-uniqueness check (unrelated lookup)
    findFirstEvents.mockResolvedValueOnce({ id: 'existing-event-1' }); // idempotency check hit

    const result = await EventService.createEvent('organizer-1', {
      ...baseEventData(),
      clientRequestId: 'req-2',
    });

    expect(result).toEqual({ id: 'existing-event-1', stub: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(createEventSessions).not.toHaveBeenCalled();
    expect(incrementEventCount).not.toHaveBeenCalled();
  });

  it('a race that loses the unique-constraint insert resolves to the existing event instead of erroring', async () => {
    const conflict = new Error('duplicate key value violates unique constraint');
    conflict.code = '23505';
    createEventSessions.mockRejectedValueOnce(conflict);
    findFirstEvents.mockResolvedValueOnce(null); // slug-uniqueness check
    findFirstEvents.mockResolvedValueOnce(null); // pre-transaction idempotency check: no match yet
    findFirstEvents.mockResolvedValueOnce({ id: 'existing-event-2' }); // post-conflict lookup

    const result = await EventService.createEvent('organizer-1', {
      ...baseEventData(),
      clientRequestId: 'req-3',
    });

    expect(result).toEqual({ id: 'existing-event-2', stub: true });
    expect(incrementEventCount).not.toHaveBeenCalled();
  });
});
