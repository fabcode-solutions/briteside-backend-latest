import { describe, it, expect, vi } from 'vitest';
import {
  events,
  venues,
  organizers,
  eventTickets,
  eventMerchandise,
} from '../../src/db/schema/index.js';

// Regression test for TAX_STRATEGY.md §2.2 / §5: the source doc states
// unconditionally that "Eventbrite passes the collected tax funds to the
// organizer inside their regular payout" for Tax Tool (organizer-state)
// jurisdictions — no carve-out for an absorbed toggle. Absorbed tax must
// only change whether the BUYER is charged on top (see
// previewTicketOrderCharge.test.js); it must never be withheld from the
// organizer's payout onto Briteside's own platform balance, since Briteside
// has no nexus/registration in these states to justify holding tax funds.

const EVENT_ROW = {
  organizerId: 'organizer-1',
  title: 'test winter vibe',
  slug: 'test-winter-vibe',
  description: '',
  platformFeePercentage: '5.0',
  eventMode: 'in_person',
  venueId: 'venue-1',
  tax: null, // overridden per-test below
};

const VENUE_ROW = {
  address: '123 Main St',
  city: 'New York',
  state: 'New York',
  country: 'United States',
  countryCode: null,
  postalCode: '10001',
};

const TICKET_TIER_ROW = {
  name: 'General Admission',
  description: 'General admission ticket',
  price: '35.00',
  groupDealSize: null,
  isSaleActive: false,
  saleDiscountPercent: null,
  saleStartDate: null,
  saleEndDate: null,
};

let eventRowOverride = EVENT_ROW;

function fakeSelect() {
  return {
    from(table) {
      return {
        where: () => {
          if (table === events) return Promise.resolve([eventRowOverride]);
          if (table === venues) return Promise.resolve([VENUE_ROW]);
          if (table === organizers) return Promise.resolve([{ userId: 'user-1' }]);
          if (table === eventTickets) return Promise.resolve([TICKET_TIER_ROW]);
          if (table === eventMerchandise) return Promise.resolve([]);
          return Promise.resolve([]);
        },
      };
    },
  };
}

vi.mock('../../src/db/index.js', () => ({
  db: { select: (...args) => fakeSelect(...args) },
}));

vi.mock('../../src/services/stripeConnect.service.js', () => ({
  StripeConnectService: { getForUser: vi.fn(async () => null) },
  getReserveRate: vi.fn(async () => 0.15),
}));

const { PaymentService } = await import('../../src/services/payment.service.js');

describe('PaymentService._computeOrderCharge — organizer-state tax payout split', () => {
  it('passes absorbed tax through to the organizer (not withheld as Briteside platform share)', async () => {
    eventRowOverride = {
      ...EVENT_ROW,
      tax: {
        collectionEnabled: true,
        registrationId: '123456789',
        name: 'State Sales Tax',
        ratePercent: 7,
        absorbed: true,
        appliesToAllTickets: true,
        country: 'United States',
      },
    };

    const charge = await PaymentService._computeOrderCharge({
      eventId: 'event-1',
      orderItems: [{ itemType: 'ticket', itemId: 'ticket-1', quantity: 1 }],
    });

    // $35.00 ticket, 5% platform fee ($1.75) -> buyer isn't charged the tax
    // (absorbed), so totalCents is ticket + platform fee only.
    expect(charge.totalCents).toBe(3675);
    // Briteside's share is the platform fee ONLY — the tax amount must not
    // be folded in, since Briteside never remits it and has no nexus here.
    expect(charge.platformShareCents).toBe(175);
    // Organizer receives the full buyer total; they're the one who set the
    // ticket price knowing it would need to cover the absorbed tax.
    expect(charge.organizerGrossCents).toBe(3500);
  });

  it('passes non-absorbed organizer tax through to the organizer too (unchanged behavior)', async () => {
    eventRowOverride = {
      ...EVENT_ROW,
      tax: {
        collectionEnabled: true,
        registrationId: '123456789',
        name: 'State Sales Tax',
        ratePercent: 7,
        absorbed: false,
        appliesToAllTickets: true,
        country: 'United States',
      },
    };

    const charge = await PaymentService._computeOrderCharge({
      eventId: 'event-1',
      orderItems: [{ itemType: 'ticket', itemId: 'ticket-1', quantity: 1 }],
    });

    // $35.00 ticket, 5% platform fee ($1.75), 7% tax on $36.75 ($2.57) added on top.
    expect(charge.totalCents).toBe(3932);
    expect(charge.platformShareCents).toBe(175);
    // Organizer gets ticket + tax (collected on Briteside's behalf, passed
    // through for the organizer to remit themselves).
    expect(charge.organizerGrossCents).toBe(3757);
  });
});
