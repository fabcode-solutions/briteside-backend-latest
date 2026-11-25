import { describe, it, expect } from 'vitest';
import { saleStatus, salePriceCents, withSale } from '../src/utils/businessSale.js';
import { priceBooking } from '../src/services/businessBooking.service.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const base = { priceCents: 5000, paymentModel: 'full', salePercent: 20, saleStartsAt: null, saleEndsAt: null };

describe('service sales', () => {
  it('reports where a sale stands', () => {
    expect(saleStatus({ ...base, salePercent: null }, NOW)).toBe(null);
    expect(saleStatus(base, NOW)).toBe('active');
    expect(saleStatus({ ...base, saleStartsAt: '2026-11-26T00:00:00Z' }, NOW)).toBe('scheduled');
    expect(saleStatus({ ...base, saleEndsAt: '2026-11-25T11:59:00Z' }, NOW)).toBe('ended');
    // "Starts from" services can go on sale too (their starting price drops)
    expect(saleStatus({ ...base, priceOnRequest: true }, NOW)).toBe('active');
  });

  it('rounds the sale price to the cent', () => {
    expect(salePriceCents(4999, 15)).toBe(4249);
    expect(salePriceCents(5000, 90)).toBe(500);
  });

  it('charges the sale price only while the sale runs', () => {
    const on = withSale(base, NOW);
    expect(on.priceCents).toBe(4000);
    expect(on.listPriceCents).toBe(5000);
    expect(priceBooking(on, { defaultPaymentModel: 'full' }).servicePriceCents).toBe(4000);
    const later = withSale({ ...base, saleStartsAt: '2026-12-01T00:00:00Z' }, NOW);
    expect(later.priceCents).toBe(5000);
  });
});
