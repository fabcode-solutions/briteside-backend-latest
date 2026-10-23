import { describe, it, expect, vi, beforeEach } from 'vitest';

// ShopOrderService._calculateNativeTax is the piece that lets the native
// (raw PaymentIntent, not hosted-Checkout) shop flow actually charge real
// tax — a standalone Stripe Tax Calculation anchored to the buyer's own
// billing country/ZIP (already collected by NativeCheckoutForm), mirroring
// EventTaxService's venue-anchored calculation but destination-based here.
// Isolated from the DB/notification/mail-heavy rest of ShopOrderService by
// mocking 'stripe' directly (like eventTax.service.test.js) and the modules
// whose own transitive imports throw at import time without env vars set.

const calculationsCreate = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    tax: { calculations: { create: calculationsCreate } },
  })),
}));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../src/services/social/profile.service.js', () => ({ ProfileService: {} }));
vi.mock('../../src/services/notification.service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../../src/services/mail.service.js', () => ({}));
vi.mock('../../src/services/userSpend.service.js', () => ({ UserSpendService: {} }));
vi.mock('../../src/services/payoutLedger.service.js', () => ({ PayoutLedgerService: {} }));
vi.mock('../../src/services/shop/shopDeliverable.service.js', () => ({ ShopDeliverableService: {} }));

const { ShopOrderService } = await import('../../src/services/shop/shopOrder.service.js');

describe('ShopOrderService._calculateNativeTax', () => {
  beforeEach(() => {
    calculationsCreate.mockReset();
  });

  const product = { listingType: 'course' };

  it('charges no tax when there is no liable party', async () => {
    const result = await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2000,
      country: 'US',
      postalCode: '98101',
      liability: null,
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax when no postal code was collected yet', async () => {
    const result = await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2000,
      country: 'US',
      postalCode: '',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax for a non-taxable listing type regardless of liability', async () => {
    const result = await ShopOrderService._calculateNativeTax({
      product: { listingType: 'service' },
      chargedCents: 2000,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('calculates real tax from the buyer address when Briteside is liable', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 227 });
    const result = await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2150,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 227, taxLabel: 'Tax' });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].customer_details.address).toMatchObject({
      country: 'US',
      postal_code: '98101',
    });
    // Briteside-liable calls use the platform's own Stripe context — no
    // second (stripeAccount) options argument.
    expect(callArgs[1]).toBeUndefined();
  });

  it('includes a normalized state alongside postal_code when one is provided, matching index.pdf\'s example payload', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 227 });
    await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2150,
      country: 'US',
      postalCode: '98101',
      state: 'Washington',
      liability: { type: 'self' },
    });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].customer_details.address).toMatchObject({
      country: 'US',
      postal_code: '98101',
      state: 'WA',
    });
  });

  it('omits state entirely when none was provided or it is unrecognized', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 227 });
    await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2150,
      country: 'US',
      postalCode: '98101',
      state: 'Not A State',
      liability: { type: 'self' },
    });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].customer_details.address.state).toBeUndefined();
  });

  it('scopes the calculation to the creator\'s connected account when they are liable', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 150 });
    const result = await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2000,
      country: 'US',
      postalCode: '94043',
      liability: { type: 'account', account: 'acct_creator123' },
    });
    expect(result).toEqual({ amountCents: 150, taxLabel: 'Tax' });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[1]).toEqual({ stripeAccount: 'acct_creator123' });
  });

  it('fails toward $0 if the Stripe Tax Calculation call errors', async () => {
    calculationsCreate.mockRejectedValue(new Error('Stripe is down'));
    const result = await ShopOrderService._calculateNativeTax({
      product,
      chargedCents: 2000,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
  });
});
