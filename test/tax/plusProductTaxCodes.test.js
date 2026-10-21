import { describe, it, expect } from 'vitest';
import { resolvePlusTaxCode, PLUS_TAX_CODES } from '../../src/lib/tax/plusProductTaxCodes.js';

describe('resolvePlusTaxCode', () => {
  it('tags a course as taxable digital educational material', () => {
    expect(resolvePlusTaxCode({ listingType: 'course' })).toEqual({
      taxCode: PLUS_TAX_CODES.COURSE,
      taxable: true,
    });
  });

  it('tags a digital product as taxable', () => {
    expect(resolvePlusTaxCode({ listingType: 'product', isPhysical: false })).toEqual({
      taxCode: PLUS_TAX_CODES.DIGITAL_PRODUCT,
      taxable: true,
    });
  });

  it('leaves a physical product untaxed (not covered by the source spec)', () => {
    expect(resolvePlusTaxCode({ listingType: 'product', isPhysical: true })).toEqual({
      taxCode: null,
      taxable: false,
    });
  });

  it('tags a service with the services code but marks it not taxable', () => {
    expect(resolvePlusTaxCode({ listingType: 'service' })).toEqual({
      taxCode: PLUS_TAX_CODES.SERVICE_NOT_TAXABLE,
      taxable: false,
    });
  });

  it('leaves a link/redirect listing untaxed', () => {
    expect(resolvePlusTaxCode({ listingType: 'link' })).toEqual({ taxCode: null, taxable: false });
  });

  it('fails toward untaxed for an unrecognized listing type instead of guessing', () => {
    expect(resolvePlusTaxCode({ listingType: 'talentRating' })).toEqual({
      taxCode: null,
      taxable: false,
    });
    expect(resolvePlusTaxCode(null)).toEqual({ taxCode: null, taxable: false });
  });
});
