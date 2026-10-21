import { describe, it, expect, vi, beforeEach } from 'vitest';

// EventTaxService talks to Stripe Tax only for the facilitator + in-person
// branch. Mock the 'stripe' package itself so no real network call happens
// and we can assert both the happy path and the "fail toward $0 on error"
// behavior deterministically.
const calculationsCreate = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    tax: { calculations: { create: calculationsCreate } },
  })),
}));

const { EventTaxService } = await import('../../src/services/tax/eventTax.service.js');

describe('EventTaxService.computeTax', () => {
  beforeEach(() => {
    calculationsCreate.mockReset();
  });

  it('charges no tax in a NOMAD (no-sales-tax) state', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'Oregon', city: null, address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result).toMatchObject({
      jurisdictionStatus: 'no-sales-tax',
      amountCents: 0,
      automaticTax: null,
    });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax for an unresolved/unknown venue state', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'Not A State', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result.jurisdictionStatus).toBe('unknown');
    expect(result.amountCents).toBe(0);
  });

  it('charges no tax in an organizer-collect state when the organizer has not opted in', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result).toMatchObject({ jurisdictionStatus: 'organizer', amountCents: 0 });
  });

  it('applies the organizer manual rate on top of the buyer total when opted in (not absorbed)', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: {
        collectionEnabled: true,
        ratePercent: 7.5,
        absorbed: false,
        name: 'CA Sales Tax',
      },
    });
    expect(result).toMatchObject({
      jurisdictionStatus: 'organizer',
      amountCents: 750, // 7.5% of $100.00
      absorbed: false,
      taxName: 'CA Sales Tax',
    });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('marks the result absorbed when the organizer toggled "absorb tax"', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: { collectionEnabled: true, ratePercent: 10, absorbed: true },
    });
    expect(result).toMatchObject({ amountCents: 1000, absorbed: true });
  });

  it('ignores a non-finite or zero organizer rate rather than charging $0.00-rounds-to-nonzero', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: { collectionEnabled: true, ratePercent: 0 },
    });
    expect(result.amountCents).toBe(0);
  });

  it('defers to buyer-billing-address automatic tax for a virtual event in a facilitator state', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'TX', address: '123 Main St' },
      eventMode: 'virtual',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result.jurisdictionStatus).toBe('facilitator');
    expect(result.automaticTax).toEqual({ enabled: true });
    expect(result.amountCents).toBe(0);
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('calculates tax from the venue address for an in-person facilitator-state event', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 825 });
    const result = await EventTaxService.computeTax({
      venue: {
        state: 'TX',
        city: 'Austin',
        address: '123 Main St',
        postalCode: '78701',
        countryCode: 'US',
      },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(calculationsCreate).toHaveBeenCalledTimes(1);
    const callArgs = calculationsCreate.mock.calls[0][0];
    // Venue address sources the calculation, never the buyer's.
    expect(callArgs.customer_details.address).toMatchObject({ state: 'TX', country: 'US' });
    expect(result).toMatchObject({
      jurisdictionStatus: 'facilitator',
      amountCents: 825,
      automaticTax: null,
    });
  });

  it('fails toward $0 tax if the Stripe Tax Calculation call errors', async () => {
    calculationsCreate.mockRejectedValue(new Error('Stripe is down'));
    const result = await EventTaxService.computeTax({
      venue: { state: 'TX', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result.amountCents).toBe(0);
  });

  it('never calls Stripe Tax for an in-person event with no venue address', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'TX', address: null },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    // Falls back to buyer-billing automatic tax rather than failing outright.
    expect(result.automaticTax).toEqual({ enabled: true });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });
});
