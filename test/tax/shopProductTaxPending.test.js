import { describe, it, expect, vi, beforeEach } from 'vitest';

// ShopProductService.resolveTaxPending is the signal the shop frontend shows
// pre-checkout ("tax may apply" vs nothing) — TAX_STRATEGY.md §3 has no UI
// requirement for Plus the way §2.3 does for Events, so this mirrors the
// existing taxPending pattern already used for virtual facilitator events
// (PriceDetailsPopover's taxPending prop) rather than inventing new UX.
// Isolated from the DB/Stripe-Connect-heavy rest of ShopProductService by
// mocking its two actual dependencies directly.

const resolveLiability = vi.fn();
vi.mock('../../src/services/tax/plusTaxLiability.service.js', () => ({
  PlusTaxLiabilityService: { resolveLiability },
}));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
// Unrelated to tax — mocked purely to dodge ShopProductService's unused-here
// import of ProfileService, whose own transitive chain (textModeration ->
// streamClient) throws at import time without STREAM_API_SECRET set.
vi.mock('../../src/services/social/profile.service.js', () => ({ ProfileService: {} }));

const { ShopProductService } = await import('../../src/services/shop/shopProduct.service.js');

describe('ShopProductService.resolveTaxPending', () => {
  beforeEach(() => {
    resolveLiability.mockReset();
  });

  it('never calls the Stripe nexus lookup when nothing in the list is a taxable type', async () => {
    const result = await ShopProductService.resolveTaxPending('seller-1', [
      { id: 'p1', listingType: 'service' },
      { id: 'p2', listingType: 'product', isPhysical: true },
      { id: 'p3', listingType: 'link' },
    ]);
    expect(result.size).toBe(0);
    expect(resolveLiability).not.toHaveBeenCalled();
  });

  it('marks taxable listings pending when a liable party resolves', async () => {
    resolveLiability.mockResolvedValue({ liability: { type: 'self' } });
    const result = await ShopProductService.resolveTaxPending('seller-1', [
      { id: 'p1', listingType: 'course' },
      { id: 'p2', listingType: 'product', isPhysical: false },
      { id: 'p3', listingType: 'service' },
    ]);
    expect(result.get('p1')).toBe(true);
    expect(result.get('p2')).toBe(true);
    expect(result.has('p3')).toBe(false);
    expect(resolveLiability).toHaveBeenCalledTimes(1);
    expect(resolveLiability).toHaveBeenCalledWith('seller-1');
  });

  it('marks nothing pending when no one holds a tax registration, even for taxable types', async () => {
    resolveLiability.mockResolvedValue({ liability: null });
    const result = await ShopProductService.resolveTaxPending('seller-1', [
      { id: 'p1', listingType: 'course' },
    ]);
    expect(result.size).toBe(0);
  });

  it('only resolves liability once for a mixed list, not once per taxable product', async () => {
    resolveLiability.mockResolvedValue({ liability: { type: 'account', account: 'acct_x' } });
    await ShopProductService.resolveTaxPending('seller-1', [
      { id: 'p1', listingType: 'course' },
      { id: 'p2', listingType: 'product', isPhysical: false },
    ]);
    expect(resolveLiability).toHaveBeenCalledTimes(1);
  });
});
