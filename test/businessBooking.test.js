import { describe, it, expect } from 'vitest';
import {
  calculateBusinessBookingFeeCents,
  calculateBusinessCommissionCents,
} from '../src/utils/orderProcessingFee.js';
import {
  priceBooking,
  staffWindowsForDate,
  computeSlots,
  customerCancellationRefund,
} from '../src/services/businessBooking.service.js';
import { inPersonCents, inPersonCommissionCents } from '../src/services/businessCommission.service.js';

const WEEK = {
  0: null,
  1: { open: '09:00', close: '18:00' },
  2: { open: '09:00', close: '18:00' },
  3: { open: '09:00', close: '18:00' },
  4: { open: '09:00', close: '18:00' },
  5: { open: '09:00', close: '18:00' },
  6: { open: '10:00', close: '16:00' },
};
// 2030-01-07 is a Monday
const MONDAY = '2030-01-07';
const SUNDAY = '2030-01-06';
const TZ = 'America/Chicago';
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

describe('business booking fee tiers', () => {
  it.each([
    [0, 500],
    [10_000, 500], // $100
    [10_001, 700], // $100.01
    [50_000, 700], // $500
    [50_001, 1_000], // $500.01
    [100_000, 1_000], // $1,000
    [500_000, 1_000], // above $1,000 stays $10
  ])('price %i cents → fee %i cents', (price, fee) => {
    expect(calculateBusinessBookingFeeCents(price)).toBe(fee);
  });

  it('commission is 5% of the price', () => {
    expect(calculateBusinessCommissionCents(10_000)).toBe(500);
    expect(calculateBusinessCommissionCents(4_550)).toBe(228);
  });
});

describe('priceBooking', () => {
  const business = { defaultPaymentModel: 'full' };

  it('full payment: everything online, commission withheld', () => {
    expect(priceBooking({ priceCents: 10_000, paymentModel: 'full' }, business)).toMatchObject({
      amountDueNowCents: 10_000,
      customerFeeCents: 500,
      platformCommissionCents: 500,
      chargedNowCents: 10_500,
      balanceDueAtVisitCents: 0,
    });
  });

  it('agreed example: $200 full online → customer $207, provider $190, Briteside $17', () => {
    const p = priceBooking({ priceCents: 20_000, paymentModel: 'full' }, business);
    expect(p).toMatchObject({ customerFeeCents: 700, chargedNowCents: 20_700, platformCommissionCents: 1_000 });
    expect(p.amountDueNowCents - p.platformCommissionCents).toBe(19_000);
    expect(p.customerFeeCents + p.platformCommissionCents).toBe(1_700);
  });

  it('exactly $500 uses the $7 fee', () => {
    expect(priceBooking({ priceCents: 50_000, paymentModel: 'full' }, business).customerFeeCents).toBe(700);
  });

  it('deposit: fee on the full price, commission 5% of the deposit only', () => {
    expect(priceBooking({ priceCents: 60_000, paymentModel: 'deposit', depositCents: null }, business)).toMatchObject({
      amountDueNowCents: 12_000,
      customerFeeCents: 1_000,
      platformCommissionCents: 600,
      chargedNowCents: 13_000,
      balanceDueAtVisitCents: 48_000,
    });
  });

  it('pay in person: only the booking fee is charged online', () => {
    expect(priceBooking({ priceCents: 8_000, paymentModel: 'in_person' }, business)).toMatchObject({
      amountDueNowCents: 0,
      customerFeeCents: 500,
      platformCommissionCents: 0,
      chargedNowCents: 500,
    });
  });

  it('null paymentModel inherits the business default', () => {
    expect(priceBooking({ priceCents: 5_000, paymentModel: null }, { defaultPaymentModel: 'in_person' }).paymentModel).toBe('in_person');
  });
});

describe('staffWindowsForDate', () => {
  const business = { hours: WEEK };

  it('business closed → no windows, even with a staff override', () => {
    const overrides = [{ isBlocked: false, startTime: '09:00', endTime: '12:00' }];
    expect(staffWindowsForDate({ business, staff: {}, overrides, date: SUNDAY })).toEqual([]);
  });

  it('no schedule → business hours', () => {
    expect(staffWindowsForDate({ business, staff: {}, overrides: [], date: MONDAY })).toEqual([{ open: 540, close: 1080 }]);
  });

  it('staff schedule is clamped to business hours', () => {
    const staff = { schedule: { ...WEEK, 1: { open: '07:00', close: '12:00' } } };
    expect(staffWindowsForDate({ business, staff, overrides: [], date: MONDAY })).toEqual([{ open: 540, close: 720 }]);
  });

  it('override windows replace the weekly schedule; blocked closes the day', () => {
    const split = [
      { isBlocked: false, startTime: '09:00', endTime: '11:00' },
      { isBlocked: false, startTime: '14:00', endTime: '16:00' },
    ];
    expect(staffWindowsForDate({ business, staff: {}, overrides: split, date: MONDAY })).toHaveLength(2);
    expect(staffWindowsForDate({ business, staff: {}, overrides: [{ isBlocked: true }], date: MONDAY })).toEqual([]);
  });
});

describe('computeSlots', () => {
  const base = { date: MONDAY, tz: TZ, durationMins: 60, bufferMins: 10, now: LONG_AGO };

  it('30-minute steps that fit the window', () => {
    const slots = computeSlots({ ...base, windows: [{ open: 540, close: 720 }], busy: [] });
    expect(slots.map(s => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
    // 09:00 Chicago (CST, UTC-6) = 15:00Z
    expect(slots[0].startAt).toBe('2030-01-07T15:00:00.000Z');
  });

  it('existing bookings block overlapping slots including the larger buffer', () => {
    const busy = [{ startAt: new Date('2030-01-07T16:00:00Z'), endAt: new Date('2030-01-07T17:00:00Z'), bufferMins: 30 }];
    // busy 10:00-11:00 local, 30-min buffer → nothing from 09:00 (ends 10:00, +30 overlaps) to 11:00
    const slots = computeSlots({ ...base, windows: [{ open: 540, close: 780 }], busy });
    expect(slots.map(s => s.time)).toEqual(['11:30', '12:00']);
  });

  it('skips slots inside the minimum lead time', () => {
    const now = new Date('2030-01-07T15:10:00Z'); // 09:10 local; lead time 60 min
    const slots = computeSlots({ ...base, now, windows: [{ open: 540, close: 720 }], busy: [] });
    expect(slots[0].time).toBe('10:30');
  });
});

describe('customerCancellationRefund', () => {
  const business = { freeCancellationHours: 24, lateCancellationRefundPercent: 50 };
  const now = new Date('2030-01-07T12:00:00Z');
  const booking = (startAt, status = 'confirmed') => ({ status, startAt: new Date(startAt), amountPaidCents: 10_000 });

  it('pending request → full service refund (booking fee is non-refundable)', () => {
    expect(customerCancellationRefund(booking('2030-01-07T13:00:00Z', 'pending'), business, now)).toMatchObject({
      serviceRefundCents: 10_000,
      rule: 'not_yet_accepted',
    });
  });

  it('inside the free window → full service refund (booking fee is non-refundable)', () => {
    expect(customerCancellationRefund(booking('2030-01-08T13:00:00Z'), business, now)).toMatchObject({
      serviceRefundCents: 10_000,
      rule: 'free_window',
    });
  });

  it('late → policy percent of the service payment', () => {
    expect(customerCancellationRefund(booking('2030-01-07T20:00:00Z'), business, now)).toMatchObject({
      serviceRefundCents: 5_000,
      rule: 'late',
    });
  });

  it('never refunds the booking fee', () => {
    for (const b of [booking('2030-01-07T13:00:00Z', 'pending'), booking('2030-01-08T13:00:00Z')]) {
      expect(customerCancellationRefund(b, business, now)).not.toHaveProperty('refundFee');
    }
  });
});

describe('in-person commission (5% on what is paid at the visit)', () => {
  const svc = (priceCents, paymentModel, depositCents) => ({ priceCents, paymentModel, depositCents });

  it('pay in person: nothing withheld online, full 5% owed later', () => {
    const p = priceBooking(svc(10000, 'in_person'), {});
    expect(p.platformCommissionCents).toBe(0);
    expect(p.inPersonCommissionCents).toBe(500);
    expect(p.chargedNowCents).toBe(500); // only the booking fee online
  });

  it('deposit: 5% of the deposit online + 5% of the remainder owed', () => {
    const p = priceBooking(svc(20000, 'deposit', 4000), {});
    expect(p.platformCommissionCents).toBe(200);
    expect(p.inPersonCommissionCents).toBe(800);
    expect(p.platformCommissionCents + p.inPersonCommissionCents).toBe(calculateBusinessCommissionCents(20000));
  });

  it('full online: nothing owed later', () => {
    const p = priceBooking(svc(20000, 'full'), {});
    expect(p.platformCommissionCents).toBe(1000);
    expect(p.inPersonCommissionCents).toBe(0);
  });

  it('inPersonCents / inPersonCommissionCents follow what was actually paid online', () => {
    // Deposit booking whose balance was later paid online → nothing in person
    expect(inPersonCents({ servicePriceCents: 20000, amountPaidCents: 20000 })).toBe(0);
    expect(inPersonCommissionCents({ servicePriceCents: 20000, amountPaidCents: 4000 })).toBe(800);
    expect(inPersonCommissionCents({ servicePriceCents: 10000, amountPaidCents: 0 })).toBe(500);
    // Never negative
    expect(inPersonCents({ servicePriceCents: 100, amountPaidCents: 500 })).toBe(0);
  });
});
