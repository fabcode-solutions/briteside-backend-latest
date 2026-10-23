import { describe, it, expect, vi, beforeEach } from 'vitest';

// EventTaxService talks to Stripe Tax only for the facilitator + in-person
// branch. Mock the 'stripe' package itself so no real network call happens
// and we can assert both the happy path and the "fail toward $0 on error"
// behavior deterministically. `locations.create` is the performance-location
// lookup `_getOrCreatePerformanceLocation` needs — see that method's own
// describe block below for dedicated coverage.
const calculationsCreate = vi.fn();
const locationsCreate = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    tax: {
      calculations: { create: calculationsCreate },
      locations: { create: locationsCreate },
    },
  })),
}));

const venuesUpdateWhere = vi.fn().mockResolvedValue(undefined);
const venuesUpdateSet = vi.fn(() => ({ where: venuesUpdateWhere }));
const venuesUpdate = vi.fn(() => ({ set: venuesUpdateSet }));
vi.mock('../../src/db/index.js', () => ({ db: { update: (...args) => venuesUpdate(...args) } }));
vi.mock('../../src/db/schema/venues.js', () => ({ venues: { id: 'venues.id' } }));

const { EventTaxService } = await import('../../src/services/tax/eventTax.service.js');

describe('EventTaxService.computeTax', () => {
  beforeEach(() => {
    calculationsCreate.mockReset();
    locationsCreate.mockReset();
    venuesUpdate.mockClear();
    venuesUpdateSet.mockClear();
    venuesUpdateWhere.mockClear();
    // Sane default for every facilitator in-person test below, so each one
    // doesn't have to set this up individually just to reach the actual
    // Tax Calculation call — overridden explicitly in the tests that care
    // about the location lookup itself.
    locationsCreate.mockResolvedValue({ id: 'taxloc_default' });
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

  it('charges no tax when collectionEnabled is explicitly false, even if a rate/registration are still on file from when it was previously enabled', async () => {
    // Guards against stale data: an organizer who enables the Tax Tool,
    // then turns it back off, might leave ratePercent/registrationId/name
    // populated in the persisted event rather than cleared. Toggling
    // collectionEnabled off must always win regardless.
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: {
        collectionEnabled: false,
        registrationId: '123456789',
        ratePercent: 7.5,
        name: 'CA Sales Tax',
        absorbed: false,
      },
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
        registrationId: 'CA-SALES-TAX-12345',
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
      organizerTax: {
        collectionEnabled: true,
        registrationId: 'CA-SALES-TAX-12345',
        ratePercent: 10,
        absorbed: true,
      },
    });
    expect(result).toMatchObject({ amountCents: 1000, absorbed: true });
  });

  it('charges no tax when the organizer opted in but never entered a TIN/registration ID', async () => {
    // Mirrors Eventbrite's own hard requirement: without a registration on
    // file, no tax line item is ever added, regardless of the rate entered.
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: { collectionEnabled: true, ratePercent: 7.5, name: 'CA Sales Tax' },
    });
    expect(result).toMatchObject({ jurisdictionStatus: 'organizer', amountCents: 0 });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax when the registration ID is only whitespace', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: {
        collectionEnabled: true,
        registrationId: '   ',
        ratePercent: 7.5,
        name: 'CA Sales Tax',
      },
    });
    expect(result).toMatchObject({ jurisdictionStatus: 'organizer', amountCents: 0 });
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
    // Required for ticket/event tax codes per docs.stripe.com/tax/tax-for-tickets
    // — a live 400 confirmed this is enforced, not merely optional.
    expect(callArgs.line_items[0].performance_location).toBe('taxloc_default');
    expect(result).toMatchObject({
      jurisdictionStatus: 'facilitator',
      amountCents: 825,
      automaticTax: null,
    });
  });

  it('defaults to the spectator-admissions tax code when the event is not a business conference', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
    });
    expect(result.taxCode).toBe('txcd_50010003');
  });

  it('uses the business-conference tax code when the event is tagged as one', async () => {
    const result = await EventTaxService.computeTax({
      venue: { state: 'CA', address: '123 Main St' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
      isBusinessConference: true,
    });
    expect(result.taxCode).toBe('txcd_50013001');
  });

  it('tags the Stripe Tax Calculation line item with the business-conference code for an in-person facilitator event', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 500 });
    await EventTaxService.computeTax({
      venue: { state: 'TX', address: '123 Main St', countryCode: 'US' },
      eventMode: 'in_person',
      subtotalCents: 10_000,
      organizerTax: null,
      isBusinessConference: true,
    });
    const callArgs = calculationsCreate.mock.calls[0][0];
    expect(callArgs.line_items[0].tax_code).toBe('txcd_50013001');
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

describe('EventTaxService._getOrCreatePerformanceLocation', () => {
  beforeEach(() => {
    locationsCreate.mockReset();
    venuesUpdate.mockClear();
    venuesUpdateSet.mockClear();
    venuesUpdateWhere.mockClear();
  });

  it("reuses the venue's cached location id without calling Stripe", async () => {
    const result = await EventTaxService._getOrCreatePerformanceLocation({
      id: 'venue-1',
      stripeTaxLocationId: 'taxloc_cached',
    });
    expect(result).toBe('taxloc_cached');
    expect(locationsCreate).not.toHaveBeenCalled();
  });

  it('creates and persists a new location when the venue has none cached', async () => {
    locationsCreate.mockResolvedValue({ id: 'taxloc_new' });
    const result = await EventTaxService._getOrCreatePerformanceLocation({
      id: 'venue-2',
      address: '123 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      countryCode: 'US',
    });
    expect(result).toBe('taxloc_new');
    expect(locationsCreate).toHaveBeenCalledWith({
      type: 'performance',
      address: {
        line1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    });
    expect(venuesUpdate).toHaveBeenCalledTimes(1);
    expect(venuesUpdateSet).toHaveBeenCalledWith({ stripeTaxLocationId: 'taxloc_new' });
  });

  it('creates a location but skips persistence when the venue has no id (e.g. a test/ad-hoc caller)', async () => {
    locationsCreate.mockResolvedValue({ id: 'taxloc_new' });
    const result = await EventTaxService._getOrCreatePerformanceLocation({
      address: '123 Main St',
      state: 'TX',
    });
    expect(result).toBe('taxloc_new');
    expect(venuesUpdate).not.toHaveBeenCalled();
  });

  it('fails toward null (not an error) if the Stripe location create call fails', async () => {
    locationsCreate.mockRejectedValue(new Error('Stripe is down'));
    const result = await EventTaxService._getOrCreatePerformanceLocation({
      id: 'venue-3',
      address: '123 Main St',
      state: 'TX',
    });
    expect(result).toBeNull();
    expect(venuesUpdate).not.toHaveBeenCalled();
  });
});
