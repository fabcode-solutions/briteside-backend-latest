import { describe, expect, it } from 'vitest';
import {
  partySizeProblem,
  sessionBaseCents,
  sessionSettingsProblem,
  seatsLeft,
} from '../src/utils/businessSession.js';
import { customerRescheduleBlock, priceBooking } from '../src/services/businessBooking.service.js';
import {
  calculateBusinessBookingFeeCents,
  calculateBusinessCommissionCents,
} from '../src/utils/orderProcessingFee.js';

const business = { defaultPaymentModel: 'full', allowCustomerRescheduling: true, reschedulingNoticeDays: 0 };
const group = { sessionType: 'group', priceCents: 2500, capacity: 8, paymentModel: 'full' };
const privateEvent = {
  sessionType: 'private_group',
  priceCents: 3000,
  minGuests: 4,
  maxGuests: 20,
  minimumTotalCents: 15000,
  paymentModel: 'full',
};

describe('session pricing', () => {
  it('group: seats × seat price', () => {
    expect(sessionBaseCents(group, 3)).toBe(7500);
  });

  it('private event: guests × price, never below the minimum', () => {
    expect(sessionBaseCents(privateEvent, 4)).toBe(15000); // 4 × 30 = 120 → minimum 150
    expect(sessionBaseCents(privateEvent, 6)).toBe(18000);
  });

  it('individual ignores party size', () => {
    expect(sessionBaseCents({ priceCents: 4000 }, 5)).toBe(4000);
  });

  it('fee tier and 5% use the booked total', () => {
    const p = priceBooking(group, business, [], { partySize: 4 });
    expect(p.servicePriceCents).toBe(10000);
    expect(p.amountDueNowCents).toBe(10000);
    expect(p.customerFeeCents).toBe(calculateBusinessBookingFeeCents(10000));
    expect(p.platformCommissionCents).toBe(calculateBusinessCommissionCents(10000));
  });

  it('group deposit: a fixed amount counts per seat, a % uses the total', () => {
    const fixed = priceBooking({ ...group, paymentModel: 'deposit', depositCents: 500 }, business, [], { partySize: 3 });
    expect(fixed.amountDueNowCents).toBe(1500);
    expect(fixed.balanceDueAtVisitCents).toBe(6000);
    const pct = priceBooking({ ...group, paymentModel: 'deposit', depositPercent: 50 }, business, [], { partySize: 3 });
    expect(pct.amountDueNowCents).toBe(3750);
  });

  it('private event deposit: a fixed amount is charged once', () => {
    const p = priceBooking({ ...privateEvent, paymentModel: 'deposit', depositCents: 5000 }, business, [], { partySize: 8 });
    expect(p.servicePriceCents).toBe(24000);
    expect(p.amountDueNowCents).toBe(5000);
  });

  it('private event add-ons are added once to the total', () => {
    const p = priceBooking(privateEvent, business, [{ priceCents: 2000 }], { partySize: 6 });
    expect(p.servicePriceCents).toBe(20000);
  });
});

describe('party size', () => {
  it('group: 1–20 seats per booking', () => {
    expect(partySizeProblem(group, 1)).toBeNull();
    expect(partySizeProblem(group, 21)).toMatch(/up to 20 seats/);
    expect(partySizeProblem(group, 0)).toMatch(/how many/);
  });

  it('private event: within min and max guests', () => {
    expect(partySizeProblem(privateEvent, 3)).toBe('This event is for at least 4 guests');
    expect(partySizeProblem(privateEvent, 21)).toBe('This event is for up to 20 guests');
    expect(partySizeProblem(privateEvent, 10)).toBeNull();
  });

  it('individual: one person', () => {
    expect(partySizeProblem({ sessionType: 'individual' }, 2)).toMatch(/one person/);
    expect(partySizeProblem({}, 1)).toBeNull();
  });

  it('seats left never goes negative', () => {
    expect(seatsLeft(8, 3)).toBe(5);
    expect(seatsLeft(8, 10)).toBe(0);
  });
});

describe('session settings', () => {
  it('group needs seats per session', () => {
    expect(sessionSettingsProblem({ sessionType: 'group' })).toMatch(/seats/);
    expect(sessionSettingsProblem({ sessionType: 'group', capacity: 10 })).toBeNull();
  });

  it('private event needs a valid guest range', () => {
    expect(sessionSettingsProblem({ sessionType: 'private_group' })).toMatch(/smallest and largest/);
    expect(sessionSettingsProblem({ sessionType: 'private_group', minGuests: 10, maxGuests: 5 })).toMatch(
      /can’t be more than/
    );
    expect(sessionSettingsProblem({ sessionType: 'private_group', minGuests: 2, maxGuests: 12 })).toBeNull();
  });

  it('individual needs nothing extra', () => {
    expect(sessionSettingsProblem({ sessionType: 'individual' })).toBeNull();
  });
});

describe('rescheduling', () => {
  it('seats in a group session can’t be moved', () => {
    const booking = {
      status: 'confirmed',
      groupSessionId: 's1',
      startAt: new Date(Date.now() + 7 * 86_400_000),
    };
    expect(customerRescheduleBlock(booking, business)).toMatch(/can’t be moved/);
    expect(customerRescheduleBlock({ ...booking, groupSessionId: null }, business)).toBeNull();
  });
});
