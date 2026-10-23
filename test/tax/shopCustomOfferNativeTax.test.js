import { describe, it, expect, vi, beforeEach } from 'vitest';

// ShopCustomOfferService._calculateServiceNativeTax is the Services
// equivalent of ShopOrderService._calculateNativeTax (see
// shopOrderNativeTax.test.js) — a standalone Stripe Tax Calculation for the
// native (raw PaymentIntent) accept/remainder/milestone-funding checkouts,
// anchored to the buyer's own billing country/ZIP/state. Simpler than shop's
// version: Services always use the one fixed SERVICE_TAX_CODE, no per-
// product resolvePlusTaxCode lookup. Isolated the same way
// shopOrderNativeTax.test.js is — mocking 'stripe' directly and every module
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

const { ShopCustomOfferService } = await import(
  '../../src/services/shop/shopCustomOffer.service.js'
);

describe('ShopCustomOfferService._calculateServiceNativeTax', () => {
  beforeEach(() => {
    calculationsCreate.mockReset();
  });

  it('charges no tax when there is no liable party', async () => {
    const result = await ShopCustomOfferService._calculateServiceNativeTax({
      chargedCents: 2000,
      country: 'US',
      postalCode: '98101',
      liability: null,
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax when no postal code was collected yet', async () => {
    const result = await ShopCustomOfferService._calculateServiceNativeTax({
      chargedCents: 2000,
      country: 'US',
      postalCode: '',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('calculates real tax from the buyer address when Briteside is liable', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 227 });
    const result = await ShopCustomOfferService._calculateServiceNativeTax({
      chargedCents: 2150,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 227, taxLabel: 'Tax' });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].line_items[0]).toMatchObject({
      amount: 2150,
      tax_code: 'txcd_20030000',
      tax_behavior: 'exclusive',
    });
    expect(callArgs[0].customer_details.address).toMatchObject({
      country: 'US',
      postal_code: '98101',
    });
    // Briteside-liable calls use the platform's own Stripe context — no
    // second (stripeAccount) options argument.
    expect(callArgs[1]).toBeUndefined();
  });

  it('normalizes a full state name to its abbreviation, matching the shop native-tax precedent', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 227 });
    await ShopCustomOfferService._calculateServiceNativeTax({
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
    await ShopCustomOfferService._calculateServiceNativeTax({
      chargedCents: 2150,
      country: 'US',
      postalCode: '98101',
      state: 'Not A State',
      liability: { type: 'self' },
    });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].customer_details.address.state).toBeUndefined();
  });

  it("scopes the calculation to the creator's connected account when they are liable", async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 150 });
    const result = await ShopCustomOfferService._calculateServiceNativeTax({
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
    const result = await ShopCustomOfferService._calculateServiceNativeTax({
      chargedCents: 2000,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
  });
});
