import { describe, it, expect } from 'vitest';
import { normalizeTicketmasterEvent } from '../src/services/externalEvents/ticketmaster.client.js';
import { normalizeVenuniteEvent } from '../src/services/externalEvents/venunite.client.js';

const tmEvent = overrides => ({
  id: 'vvG1zZ9xKpQ3aB',
  name: 'The Lumineers – Automatic World Tour',
  url: 'https://www.ticketmaster.com/event/vvG1zZ9xKpQ3aB',
  dates: {
    start: { localDate: '2026-12-05', localTime: '19:30:00', dateTime: '2026-12-06T00:30:00Z' },
    timezone: 'America/New_York',
    status: { code: 'onsale' },
  },
  images: [
    { url: 'https://img/small_16_9.jpg', ratio: '16_9', width: 640 },
    { url: 'https://img/large_16_9.jpg', ratio: '16_9', width: 1024 },
    { url: 'https://img/large_3_2.jpg', ratio: '3_2', width: 2048 },
  ],
  priceRanges: [{ min: 45, max: 150, currency: 'USD' }],
  classifications: [{ primary: true, segment: { name: 'Music' }, genre: { name: 'Rock' } }],
  _embedded: {
    venues: [
      {
        name: 'XL Center',
        address: { line1: '1 Civic Center Plaza' },
        city: { name: 'Hartford' },
        state: { stateCode: 'CT' },
        postalCode: '06103',
        country: { countryCode: 'US' },
        location: { latitude: '41.7681', longitude: '-72.6767' },
      },
    ],
  },
  ...overrides,
});

describe('normalizeTicketmasterEvent', () => {
  it('maps the core fields', () => {
    const e = normalizeTicketmasterEvent(tmEvent());
    expect(e).toMatchObject({
      source: 'ticketmaster',
      externalId: 'vvG1zZ9xKpQ3aB',
      status: 'active',
      imageUrl: 'https://img/large_16_9.jpg',
      priceMin: 45,
      priceMax: 150,
      categoryHints: ['Music', 'Rock'],
      venue: { name: 'XL Center', city: 'Hartford', stateCode: 'CT', latitude: 41.7681 },
    });
    expect(e.startDate.toISOString()).toBe('2026-12-06T00:30:00.000Z');
    // No end time upstream — defaults to start + 3h
    expect(e.endDate - e.startDate).toBe(3 * 60 * 60 * 1000);
  });

  it('anchors a time-TBA event to 7pm in the venue timezone', () => {
    const e = normalizeTicketmasterEvent(
      tmEvent({
        dates: {
          start: { localDate: '2026-12-05', noSpecificTime: true },
          timezone: 'America/New_York',
          status: { code: 'onsale' },
        },
      })
    );
    expect(e.startDate.toISOString()).toBe('2026-12-06T00:00:00.000Z');
  });

  it('maps cancelled / postponed status', () => {
    const cancelled = tmEvent();
    cancelled.dates.status.code = 'cancelled';
    expect(normalizeTicketmasterEvent(cancelled).status).toBe('cancelled');
  });

  it('drops events without a buy link, venue or date', () => {
    expect(normalizeTicketmasterEvent(tmEvent({ url: undefined }))).toBeNull();
    expect(normalizeTicketmasterEvent(tmEvent({ _embedded: {} }))).toBeNull();
    expect(
      normalizeTicketmasterEvent(tmEvent({ dates: { start: { dateTBD: true } } }))
    ).toBeNull();
  });
});

describe('normalizeVenuniteEvent', () => {
  const vnEvent = overrides => ({
    id: 4521,
    title: 'Friday Trivia Night',
    eventUrl: 'https://venunite.com/e/friday-trivia',
    ticketUrl: null,
    startDate: '2026-11-06T23:00:00.000Z',
    endDate: null,
    categories: ['Trivia', 'Food & Drink'],
    cost: '$10 - $15',
    isFree: false,
    imageUrl: 'https://img/trivia.jpg',
    venue: { name: 'Two Roads Brewing', city: 'Stratford', state: 'CT', latitude: 41.2, longitude: -73.1 },
    ...overrides,
  });

  it('maps the core fields and parses cost', () => {
    const e = normalizeVenuniteEvent(vnEvent());
    expect(e).toMatchObject({
      source: 'venunite',
      externalId: '4521',
      url: 'https://venunite.com/e/friday-trivia',
      priceMin: 10,
      priceMax: 15,
      categoryHints: ['Trivia', 'Food & Drink'],
      venue: { name: 'Two Roads Brewing', stateCode: 'CT' },
    });
    expect(e.endDate - e.startDate).toBe(3 * 60 * 60 * 1000);
  });

  it('prefers the ticket link and handles free events', () => {
    const e = normalizeVenuniteEvent(
      vnEvent({ ticketUrl: 'https://tickets.example/1', isFree: true, cost: 'Free' })
    );
    expect(e.url).toBe('https://tickets.example/1');
    expect(e).toMatchObject({ isFree: true, priceMin: 0, priceMax: 0 });
  });

  it('drops events without a link or venue', () => {
    expect(normalizeVenuniteEvent(vnEvent({ eventUrl: null }))).toBeNull();
    expect(normalizeVenuniteEvent(vnEvent({ venue: null }))).toBeNull();
  });
});
