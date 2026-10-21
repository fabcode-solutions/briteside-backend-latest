import { describe, it, expect } from 'vitest';
import {
  SERVICE_TAX_CODE,
  buildServiceAutomaticTax,
  applyTaxLiabilityToReserve,
} from '../../src/lib/tax/serviceCheckoutTax.js';
import { PLUS_TAX_CODES } from '../../src/lib/tax/plusProductTaxCodes.js';

describe('serviceCheckoutTax', () => {
  it('SERVICE_TAX_CODE is the shared services tax code (txcd_20030000)', () => {
    expect(SERVICE_TAX_CODE).toBe(PLUS_TAX_CODES.SERVICE_NOT_TAXABLE);
  });

  describe('buildServiceAutomaticTax', () => {
    it('enables automatic_tax with the resolved liability when one was found', () => {
      expect(buildServiceAutomaticTax({ type: 'account', account: 'acct_123' })).toEqual({
        enabled: true,
        liability: { type: 'account', account: 'acct_123' },
      });
      expect(buildServiceAutomaticTax({ type: 'self' })).toEqual({
        enabled: true,
        liability: { type: 'self' },
      });
    });

    it('returns undefined (automatic_tax omitted) when no liable party was found', () => {
      expect(buildServiceAutomaticTax(null)).toBeUndefined();
      expect(buildServiceAutomaticTax(undefined)).toBeUndefined();
    });
  });

  describe('applyTaxLiabilityToReserve', () => {
    it('adds the collected tax to the reserve when the talent/creator is liable', () => {
      expect(applyTaxLiabilityToReserve(10000, 750, 'account')).toBe(10750);
    });

    it('leaves the reserve untouched when Briteside is liable', () => {
      expect(applyTaxLiabilityToReserve(10000, 750, 'self')).toBe(10000);
    });

    it('leaves the reserve untouched when no tax was ever enabled', () => {
      expect(applyTaxLiabilityToReserve(10000, 0, 'none')).toBe(10000);
    });

    it('treats a missing/undefined tax amount as 0', () => {
      expect(applyTaxLiabilityToReserve(10000, undefined, 'account')).toBe(10000);
      expect(applyTaxLiabilityToReserve(10000, null, 'account')).toBe(10000);
    });
  });
});
