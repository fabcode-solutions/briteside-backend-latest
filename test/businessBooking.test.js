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
  balanceCommissionCents,
} from '../src/services/businessBooking.service.js';
import {
  inPersonCents,
  inPersonCommissionCents,
  commissionOwedCents,
} from '../src/services/businessCommission.service.js';

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

  it('deposit: fee and the full 5% both on the full price, 5% withheld from the deposit', () => {
    expect(priceBooking({ priceCents: 60_000, paymentModel: 'deposit', depositCents: null }, business)).toMatchObject({
      amountDueNowCents: 12_000,
      customerFeeCents: 1_000,
      platformCommissionCents: 3_000,
      inPersonCommissionCents: 0,
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

describe('full-cut commission (whole 5% withheld at booking)', () => {
  const svc = (priceCents, paymentModel, depositCents) => ({ priceCents, paymentModel, depositCents });

  it('pay in person: nothing withheld online, full 5% owed later', () => {
    const p = priceBooking(svc(10000, 'in_person'), {});
    expect(p.platformCommissionCents).toBe(0);
    expect(p.inPersonCommissionCents).toBe(500);
    expect(p.chargedNowCents).toBe(500); // only the booking fee online
  });

  it('$50 with a $10 deposit: $2.50 taken from the deposit, business gets $7.50 now', () => {
    const p = priceBooking(svc(5000, 'deposit', 1000), {});
    expect(p).toMatchObject({ chargedNowCents: 1500, platformCommissionCents: 250, inPersonCommissionCents: 0 });
    expect(p.amountDueNowCents - p.platformCommissionCents).toBe(750);
  });

  it('deposit smaller than the 5%: whole deposit withheld, the rest owed', () => {
    const p = priceBooking(svc(20000, 'deposit', 500), {});
    expect(p.platformCommissionCents).toBe(500);
    expect(p.inPersonCommissionCents).toBe(500);
  });

  it('withheld + owed always add up to exactly 5% of the price (no rounding drift)', () => {
    for (const [price, dep] of [[3333, 667], [1220, 110], [5000, 1000], [20000, 500]]) {
      const p = priceBooking(svc(price, 'deposit', dep), {});
      expect(p.platformCommissionCents + p.inPersonCommissionCents).toBe(calculateBusinessCommissionCents(price));
    }
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

describe('commissionOwedCents', () => {
  // $50 service, $10 deposit, $2.50 withheld at booking
  const upfront = over => ({
    commissionUpfront: true,
    servicePriceCents: 5000,
    amountPaidCents: 1000,
    platformCommissionCents: 250,
    extraChargesCents: 0,
    status: 'completed',
    ...over,
  });

  it('completed / no-show / late cancel: nothing more owed', () => {
    for (const status of ['completed', 'no_show', 'cancelled']) {
      expect(commissionOwedCents(upfront({ status }))).toBe(0);
    }
  });

  it('cancelled with the deposit refunded: the 5% is non-refundable, so $2.50 is owed', () => {
    // refundBooking lowers the withheld 5% to what's still held ($0)
    expect(commissionOwedCents(upfront({ status: 'cancelled', platformCommissionCents: 0 }))).toBe(250);
  });

  it('declined / expired requests owe nothing', () => {
    for (const status of ['declined', 'expired']) {
      expect(commissionOwedCents(upfront({ status, platformCommissionCents: 0 }))).toBe(0);
    }
  });

  it('extras added at the visit: 5% of them owed', () => {
    expect(commissionOwedCents(upfront({ extraChargesCents: 1500 }))).toBe(75);
  });

  it('small deposit: the rest of the 5% is owed even on a no-show', () => {
    const b = { servicePriceCents: 20000, amountPaidCents: 500, platformCommissionCents: 500 };
    expect(commissionOwedCents(upfront({ ...b, status: 'no_show' }))).toBe(500);
  });

  it('pay in person: 5% owed once completed, nothing if it never happened', () => {
    const b = { amountPaidCents: 0, platformCommissionCents: 0 };
    expect(commissionOwedCents(upfront({ ...b, status: 'completed' }))).toBe(250);
    expect(commissionOwedCents(upfront({ ...b, status: 'cancelled' }))).toBe(0);
    expect(commissionOwedCents(upfront({ ...b, status: 'no_show' }))).toBe(0);
  });

  it('older split bookings keep the old rule: 5% of the in-person part once completed', () => {
    const split = { commissionUpfront: false, servicePriceCents: 5000, amountPaidCents: 1000, platformCommissionCents: 50 };
    expect(commissionOwedCents({ ...split, status: 'completed' })).toBe(200);
    expect(commissionOwedCents({ ...split, status: 'cancelled' })).toBe(0);
  });
});

describe('balanceCommissionCents', () => {
  it('full cut: nothing more taken from a balance paid online', () => {
    const b = { commissionUpfront: true, servicePriceCents: 5000, platformCommissionCents: 250 };
    expect(balanceCommissionCents(b, 4000)).toBe(0);
  });

  it('full cut: takes what a small deposit / pay-in-person could not cover', () => {
    expect(balanceCommissionCents({ commissionUpfront: true, servicePriceCents: 20000, platformCommissionCents: 500 }, 19500)).toBe(500);
    expect(balanceCommissionCents({ commissionUpfront: true, servicePriceCents: 5000, platformCommissionCents: 0 }, 5000)).toBe(250);
  });

  it('split: 5% of the balance', () => {
    expect(balanceCommissionCents({ commissionUpfront: false, servicePriceCents: 5000, platformCommissionCents: 50 }, 4000)).toBe(200);
  });
});
