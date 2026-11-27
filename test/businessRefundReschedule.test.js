import { describe, it, expect } from 'vitest';
import {
  businessRefundableCents,
  customerRescheduleBlock,
  checkInBlock,
  normalizeExtraCharges,
  overlappingBookings,
} from '../src/services/businessBooking.service.js';
import { inPersonCents, inPersonCommissionCents } from '../src/services/businessCommission.service.js';

const NOW = new Date('2030-03-01T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const booking = (over = {}) => ({
  status: 'confirmed',
  amountPaidCents: 10_000,
  refundedCents: 0,
  standardReleasedAt: null,
  reserveReleasedAt: null,
  startAt: new Date(NOW.getTime() + 5 * DAY),
  ...over,
});

describe('businessRefundableCents', () => {
  it('is what was paid online minus earlier refunds', () => {
    expect(businessRefundableCents(booking())).toBe(10_000);
    expect(businessRefundableCents(booking({ refundedCents: 2_500 }))).toBe(7_500);
  });

  it.each(['confirmed', 'completed', 'no_show', 'cancelled'])('allows a %s booking', status => {
    expect(businessRefundableCents(booking({ status }))).toBe(10_000);
  });

  it.each(['pending', 'declined', 'expired', 'awaiting_payment'])('is 0 for a %s booking', status => {
    expect(businessRefundableCents(booking({ status }))).toBe(0);
  });

  it('is 0 once any of the payout was released', () => {
    expect(businessRefundableCents(booking({ standardReleasedAt: NOW }))).toBe(0);
    expect(businessRefundableCents(booking({ reserveReleasedAt: NOW }))).toBe(0);
  });

  it('is 0 when everything was refunded already', () => {
    expect(businessRefundableCents(booking({ refundedCents: 10_000 }))).toBe(0);
  });
});

describe('customerRescheduleBlock', () => {
  const business = (over = {}) => ({ allowCustomerRescheduling: true, reschedulingNoticeDays: 2, ...over });

  it('allows an upcoming booking outside the notice window', () => {
    expect(customerRescheduleBlock(booking(), business(), NOW)).toBeNull();
    expect(customerRescheduleBlock(booking({ status: 'pending' }), business(), NOW)).toBeNull();
  });

  it('blocks when the business does not allow it', () => {
    expect(customerRescheduleBlock(booking(), business({ allowCustomerRescheduling: false }), NOW)).toMatch(
      /doesn't allow/
    );
  });

  it('blocks inside the notice window', () => {
    const soon = booking({ startAt: new Date(NOW.getTime() + DAY) });
    expect(customerRescheduleBlock(soon, business(), NOW)).toMatch(/up to 2 days before/);
  });

  it('with no notice days, still needs the minimum lead time', () => {
    const b = business({ reschedulingNoticeDays: null });
    expect(customerRescheduleBlock(booking({ startAt: new Date(NOW.getTime() + 2 * HOUR) }), b, NOW)).toBeNull();
    expect(customerRescheduleBlock(booking({ startAt: new Date(NOW.getTime() + 30 * 60_000) }), b, NOW)).toMatch(
      /too close/
    );
  });

  it.each(['completed', 'cancelled', 'no_show', 'declined'])('blocks a %s booking', status => {
    expect(customerRescheduleBlock(booking({ status }), business(), NOW)).toMatch(/no longer/);
  });
});

describe('checkInBlock', () => {
  it('allows a confirmed booking from 2 hours before the start', () => {
    expect(checkInBlock(booking({ startAt: new Date(NOW.getTime() + 2 * HOUR) }), NOW)).toBeNull();
    expect(checkInBlock(booking({ startAt: new Date(NOW.getTime() - HOUR) }), NOW)).toBeNull();
  });

  it('blocks earlier than that', () => {
    expect(checkInBlock(booking({ startAt: new Date(NOW.getTime() + 3 * HOUR) }), NOW)).toMatch(/opens 2 hours/);
  });

  it('asks to accept a request first, and rejects closed bookings', () => {
    expect(checkInBlock(booking({ status: 'pending' }), NOW)).toMatch(/Accept/);
    expect(checkInBlock(booking({ status: 'completed' }), NOW)).toMatch(/Only confirmed/);
  });
});

describe('normalizeExtraCharges', () => {
  it('trims labels, rounds cents and totals them', () => {
    expect(
      normalizeExtraCharges([
        { label: '  Hair product ', amountCents: 1800 },
        { label: 'Extra time', amountCents: 2000.4 },
      ])
    ).toEqual({
      lines: [
        { label: 'Hair product', amountCents: 1800 },
        { label: 'Extra time', amountCents: 2000 },
      ],
      totalCents: 3800,
    });
  });

  it('drops empty or non-positive lines', () => {
    expect(normalizeExtraCharges([{ label: '', amountCents: 500 }, { label: 'x', amountCents: 0 }]).lines).toEqual([]);
    expect(normalizeExtraCharges().totalCents).toBe(0);
  });
});

describe('overlappingBookings', () => {
  const at = h => new Date(NOW.getTime() + h * HOUR);
  const busy = [{ startAt: at(1), endAt: at(2), bufferMins: 0 }];

  it('finds a clash and ignores back-to-back bookings', () => {
    expect(overlappingBookings(busy, at(1.5), at(2.5))).toHaveLength(1);
    expect(overlappingBookings(busy, at(2), at(3))).toHaveLength(0);
  });

  it('counts the buffer', () => {
    expect(overlappingBookings(busy, at(2), at(3), 15)).toHaveLength(1);
  });
});

describe('in-person commission with extras', () => {
  it('charges 5% on the unpaid service price plus extras', () => {
    // $100 pay-in-person + $18 product → $118 in person → $5.90
    const b = { servicePriceCents: 10_000, extraChargesCents: 1_800, amountPaidCents: 0 };
    expect(inPersonCents(b)).toBe(11_800);
    expect(inPersonCommissionCents(b)).toBe(590);
  });

  it('only counts what was not already paid online', () => {
    // $100 with $20 deposit paid online, + $10 extra → $90 in person
    expect(inPersonCents({ servicePriceCents: 10_000, extraChargesCents: 1_000, amountPaidCents: 2_000 })).toBe(9_000);
  });

  it('works for bookings without extras', () => {
    expect(inPersonCents({ servicePriceCents: 10_000, amountPaidCents: 0 })).toBe(10_000);
  });
});

describe('serviceDepositCents', () => {
  it('uses the percentage when set', async () => {
    const { serviceDepositCents } = await import('../src/utils/businessDeposit.js');
    expect(serviceDepositCents({ priceCents: 12_000, depositPercent: 25 })).toBe(3_000);
    // rounds to the cent: 33% of $10.01 = $3.3033 → $3.30
    expect(serviceDepositCents({ priceCents: 1_001, depositPercent: 33 })).toBe(330);
  });

  it('percentage wins over a stale fixed amount', async () => {
    const { serviceDepositCents } = await import('../src/utils/businessDeposit.js');
    expect(serviceDepositCents({ priceCents: 10_000, depositPercent: 50, depositCents: 1_000 })).toBe(5_000);
  });

  it('uses the fixed amount, capped at the price', async () => {
    const { serviceDepositCents } = await import('../src/utils/businessDeposit.js');
    expect(serviceDepositCents({ priceCents: 10_000, depositCents: 2_500 })).toBe(2_500);
    expect(serviceDepositCents({ priceCents: 1_000, depositCents: 2_500 })).toBe(1_000);
  });

  it('defaults to 20%', async () => {
    const { serviceDepositCents } = await import('../src/utils/businessDeposit.js');
    expect(serviceDepositCents({ priceCents: 10_000 })).toBe(2_000);
  });
});

describe('priceBooking with a percentage deposit', () => {
  it('charges the % deposit now and withholds the full 5% of the price from it', async () => {
    const { priceBooking } = await import('../src/services/businessBooking.service.js');
    const p = priceBooking({ priceCents: 20_000, paymentModel: 'deposit', depositPercent: 30 }, { defaultPaymentModel: 'full' });
    expect(p.amountDueNowCents).toBe(6_000);
    expect(p.platformCommissionCents).toBe(1_000);
    expect(p.balanceDueAtVisitCents).toBe(14_000);
    expect(p.customerFeeCents).toBe(700); // $200 → $7 tier, on the full price
  });
});

describe('priceBooking with add-ons', () => {
  const biz = { defaultPaymentModel: 'full' };
  const deep = { priceCents: 2_500, durationMins: 15 };

  it('adds add-ons to the price, fee tier and 5%', async () => {
    const { priceBooking } = await import('../src/services/businessBooking.service.js');
    // $100 + $25 = $125 → $7 fee tier, 5% = $6.25
    const p = priceBooking({ priceCents: 10_000, paymentModel: 'full' }, biz, [deep]);
    expect(p.servicePriceCents).toBe(12_500);
    expect(p.addOnsCents).toBe(2_500);
    expect(p.customerFeeCents).toBe(700);
    expect(p.platformCommissionCents).toBe(625);
  });

  it('applies a % deposit to the total but keeps a fixed deposit as set', async () => {
    const { priceBooking } = await import('../src/services/businessBooking.service.js');
    const pct = priceBooking({ priceCents: 10_000, paymentModel: 'deposit', depositPercent: 20 }, biz, [deep]);
    expect(pct.amountDueNowCents).toBe(2_500);
    const fixed = priceBooking({ priceCents: 10_000, paymentModel: 'deposit', depositCents: 3_000 }, biz, [deep]);
    expect(fixed.amountDueNowCents).toBe(3_000);
    expect(fixed.balanceDueAtVisitCents).toBe(9_500);
  });

  it('is unchanged without add-ons', async () => {
    const { priceBooking } = await import('../src/services/businessBooking.service.js');
    expect(priceBooking({ priceCents: 10_000, paymentModel: 'full' }, biz).addOnsCents).toBe(0);
  });
});

describe('addOnApplies', () => {
  it('offers an add-on with no service list everywhere, else only on its services', async () => {
    const { addOnApplies } = await import('../src/services/businessBooking.service.js');
    expect(addOnApplies({ serviceIds: [] }, 's1')).toBe(true);
    expect(addOnApplies({ serviceIds: ['s1'] }, 's1')).toBe(true);
    expect(addOnApplies({ serviceIds: ['s2'] }, 's1')).toBe(false);
  });
});
