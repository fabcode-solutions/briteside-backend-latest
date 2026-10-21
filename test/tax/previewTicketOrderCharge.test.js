import { describe, it, expect, vi } from 'vitest';
import {
  events,
  venues,
  organizers,
  eventTickets,
  eventMerchandise,
} from '../../src/db/schema/index.js';

// Regression test for a live bug: TicketPurchaseModal.tsx computed its own
// subtotal/platform-fee total independently on the frontend and never
// learned about event tax when it was added — the actual backend charge
// (_computeOrderCharge) was already correct the whole time. This test
// covers the fix (PaymentService.previewTicketOrderCharge), which now
// backs that UI with the same real, already-tested calculation instead of
// a second reimplementation — so the two can never drift apart again.

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

describe('PaymentService.previewTicketOrderCharge', () => {
  it('includes organizer-collect tax on top of ticket + platform fee (the "Buyer Total" rule) — the exact bug scenario', async () => {
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

    const result = await PaymentService.previewTicketOrderCharge({
      eventId: 'event-1',
      ticketSelections: [{ ticketId: 'ticket-1', quantity: 1 }],
      merchandiseSelections: [],
    });

    // $35.00 ticket, 5% platform fee ($1.75), 7% tax on the $36.75 buyer
    // total ($2.57) — NOT 7% of the $35 ticket alone ($2.45). Tax applying
    // to ticket + passed-on platform fee is confirmed, not assumed — see
    // TAX_STRATEGY.md §2.1 "Buyer Total (ticket price + any passed-on
    // platform fees)".
    expect(result).toEqual({
      subtotalCents: 3500,
      platformFeeCents: 175,
      taxAmountCents: 257,
      taxName: 'State Sales Tax',
      taxPending: false,
      totalCents: 3932,
    });
  });

  it('never double-charges tax when absorbed=true — buyer total excludes it, but the amount is still itemized', async () => {
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

    const result = await PaymentService.previewTicketOrderCharge({
      eventId: 'event-1',
      ticketSelections: [{ ticketId: 'ticket-1', quantity: 1 }],
      merchandiseSelections: [],
    });

    expect(result.taxAmountCents).toBe(257);
    // Absorbed tax is deducted from the organizer's revenue, never added to
    // what the buyer pays — total is ticket + platform fee only.
    expect(result.totalCents).toBe(3675);
  });

  it('charges no tax when the organizer never enabled collection (unchanged pre-existing behavior)', async () => {
    eventRowOverride = { ...EVENT_ROW, tax: null };

    const result = await PaymentService.previewTicketOrderCharge({
      eventId: 'event-1',
      ticketSelections: [{ ticketId: 'ticket-1', quantity: 1 }],
      merchandiseSelections: [],
    });

    expect(result.taxAmountCents).toBe(0);
    expect(result.totalCents).toBe(3675); // $35.00 + $1.75 platform fee only
  });
});
