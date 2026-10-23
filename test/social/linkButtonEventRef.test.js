import 'dotenv/config.js';
import { describe, it, expect, vi } from 'vitest';
import { events, eventTickets } from '../../src/db/schema/index.js';

// Covers PostService._resolveLinkButtonEventRef — the optional eventId/
// ticketId deep-link metadata on a URL-type linkButton. Distinct from
// linkedEventId (a separate, mutually exclusive way to attach an event):
// this just rides along on an ordinary { label, url } button, and must be
// ownership-checked the same way linkedEventId is, so a post can't carry a
// deep link to someone else's event/ticket.

let ownedEventRows = [];
let ticketRows = [];

function fakeSelect() {
  return {
    from(table) {
      if (table === events) {
        return {
          innerJoin: () => ({
            where: () => Promise.resolve(ownedEventRows),
          }),
        };
      }
      if (table === eventTickets) {
        return {
          where: () => Promise.resolve(ticketRows),
        };
      }
      return { where: () => Promise.resolve([]) };
    },
  };
}

vi.mock('../../src/db/index.js', () => ({
  db: { select: (...args) => fakeSelect(...args) },
}));

const { PostService } = await import('../../src/services/social/post.service.js');

describe('PostService._resolveLinkButtonEventRef', () => {
  it('returns the linkButton unchanged when no eventId is given', async () => {
    const linkButton = { label: 'Learn more', url: 'https://example.com' };
    const result = await PostService._resolveLinkButtonEventRef('user-1', linkButton, {});
    expect(result).toBe(linkButton);
  });

  it('returns null unchanged when there is no linkButton at all', async () => {
    const result = await PostService._resolveLinkButtonEventRef('user-1', null, { eventId: 'event-1' });
    expect(result).toBeNull();
  });

  it('attaches eventId when the event is owned by the user', async () => {
    ownedEventRows = [{ id: 'event-1' }];
    const linkButton = { label: 'Buy Tickets', url: 'https://www.briteside.app/events/my-event' };

    const result = await PostService._resolveLinkButtonEventRef('user-1', linkButton, {
      eventId: 'event-1',
    });

    expect(result).toEqual({ ...linkButton, eventId: 'event-1', ticketId: null });
  });

  it('attaches eventId and ticketId when the ticket belongs to that event', async () => {
    ownedEventRows = [{ id: 'event-1' }];
    ticketRows = [{ id: 'ticket-1' }];
    const linkButton = { label: 'Buy Tickets', url: 'https://www.briteside.app/events/my-event' };

    const result = await PostService._resolveLinkButtonEventRef('user-1', linkButton, {
      eventId: 'event-1',
      ticketId: 'ticket-1',
    });

    expect(result).toEqual({ ...linkButton, eventId: 'event-1', ticketId: 'ticket-1' });
  });

  it('throws when eventId is not owned by the user', async () => {
    ownedEventRows = []; // ownership join found nothing
    const linkButton = { label: 'Buy Tickets', url: 'https://www.briteside.app/events/not-mine' };

    await expect(
      PostService._resolveLinkButtonEventRef('user-1', linkButton, { eventId: 'someone-elses-event' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when ticketId does not belong to the given eventId', async () => {
    ownedEventRows = [{ id: 'event-1' }];
    ticketRows = []; // ticket lookup found nothing for this event
    const linkButton = { label: 'Buy Tickets', url: 'https://www.briteside.app/events/my-event' };

    await expect(
      PostService._resolveLinkButtonEventRef('user-1', linkButton, {
        eventId: 'event-1',
        ticketId: 'ticket-from-another-event',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
