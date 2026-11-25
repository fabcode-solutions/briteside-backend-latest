import { describe, it, expect } from 'vitest';
import {
  reserveNowCheckoutSchema,
  reserveNowConfirmSchema,
  updateBusinessSchema,
} from '../src/validations/business.validation.js';
import {
  isReserveNowLive,
  serializeReserveNow,
  RESERVE_NOW_PRICE_CENTS,
} from '../src/services/businessReserveNow.service.js';

const BID = '11111111-1111-4111-8111-111111111111';
const parse = reservationUrl =>
  updateBusinessSchema.safeParse({ params: { businessId: BID }, body: { reservationUrl } });

describe('business reservationUrl validation', () => {
  it.each([
    'https://www.opentable.com/r/my-place-new-york',
    'https://resy.com/cities/ny/my-place',
    'https://www.exploretock.com/my-place',
    '',
    null,
  ])('accepts %s', v => {
    expect(parse(v).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'resy.com/x', 'https://localhost'])('rejects %s', v => {
    const r = parse(v);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/Reservation link/);
  });

  it('checkout body is optional and validates the link', () => {
    expect(reserveNowCheckoutSchema.safeParse({ params: { businessId: BID } }).success).toBe(true);
    expect(
      reserveNowCheckoutSchema.safeParse({ params: { businessId: BID }, body: { reservationUrl: 'javascript:x' } })
        .success
    ).toBe(false);
  });

  it('confirm needs a Checkout session id', () => {
    const ok = reserveNowConfirmSchema.safeParse({ params: { businessId: BID }, body: { sessionId: 'cs_test_a1B2' } });
    const bad = reserveNowConfirmSchema.safeParse({ params: { businessId: BID }, body: { sessionId: 'pi_123' } });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});

describe('Reserve Now state', () => {
  it.each([
    ['active', true],
    ['past_due', true],
    ['pending', false],
    ['canceled', false],
    [null, false],
  ])('status %s → live %s', (status, live) => {
    expect(isReserveNowLive({ reserveNowStatus: status })).toBe(live);
  });

  it('only Food & Dining is eligible', () => {
    expect(serializeReserveNow({ category: 'dining' }).eligible).toBe(true);
    expect(serializeReserveNow({ category: 'beauty' }).eligible).toBe(false);
  });

  it('summarises the subscription for the dashboard', () => {
    const end = new Date('2026-12-25T00:00:00Z');
    expect(
      serializeReserveNow({
        category: 'dining',
        reserveNowStatus: 'active',
        reserveNowPeriodEnd: end,
        reserveNowCancelAtPeriodEnd: true,
      })
    ).toEqual({
      eligible: true,
      status: 'active',
      live: true,
      priceCents: RESERVE_NOW_PRICE_CENTS,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: true,
    });
    expect(RESERVE_NOW_PRICE_CENTS).toBe(2000);
  });
});
