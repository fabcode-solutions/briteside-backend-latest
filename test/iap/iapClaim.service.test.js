import { describe, it, expect, vi } from 'vitest';
import { IapClaimService, IAP_REASON } from '../../src/services/iapClaim.service.js';

const USER = '6f1c1d2e-0000-4000-8000-000000000001';

function fakeTx({ inserted, existing } = {}) {
  const findFirst = vi.fn(async () => existing ?? null);
  const returning = vi.fn(async () => (inserted ? [{ id: 'claim-1' }] : []));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  return {
    insert: vi.fn(() => ({ values })),
    query: { iapTransactionClaims: { findFirst } },
    _values: values,
  };
}

const claimInput = {
  store: 'apple',
  transactionId: '2000000123',
  userId: USER,
  purpose: 'priority_message',
  referenceId: 'pay-1',
  productId: 'com.gokyro.app.tier_1299',
  environment: 'production',
};

describe('IapClaimService.environmentOf', () => {
  it('treats only Apple Production as real money', () => {
    expect(IapClaimService.environmentOf('apple', { environment: 'Production' })).toBe(
      'production'
    );
    expect(IapClaimService.environmentOf('apple', { environment: 'Sandbox' })).toBe('sandbox');
    expect(IapClaimService.environmentOf('apple', { environment: 'Xcode' })).toBe('sandbox');
  });

  it('treats Google purchases carrying purchaseType (test/promo/rewarded) as sandbox', () => {
    expect(IapClaimService.environmentOf('google', {})).toBe('production');
    expect(IapClaimService.environmentOf('google', { purchaseType: 0 })).toBe('sandbox');
    expect(IapClaimService.environmentOf('google', { purchaseType: 1 })).toBe('sandbox');
  });
});

describe('IapClaimService.assertBuyer', () => {
  it('accepts a matching or missing account tag', () => {
    expect(() =>
      IapClaimService.assertBuyer('apple', { appAccountToken: USER.toUpperCase() }, USER)
    ).not.toThrow();
    expect(() => IapClaimService.assertBuyer('apple', {}, USER)).not.toThrow();
    expect(() =>
      IapClaimService.assertBuyer('google', { obfuscatedExternalAccountId: USER }, USER)
    ).not.toThrow();
  });

  it("rejects a purchase tagged with someone else's account", () => {
    try {
      IapClaimService.assertBuyer('google', { obfuscatedExternalAccountId: 'other' }, USER);
      expect.unreachable();
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.details.reason).toBe(IAP_REASON.ACCOUNT_MISMATCH);
    }
  });
});

describe('IapClaimService.assertBuyer cutoff', () => {
  const cutoff = new Date('2026-11-15T00:00:00Z');

  it('still accepts untagged purchases made before the cutoff (older App builds)', () => {
    const before = { purchaseDate: cutoff.getTime() - 1000 };
    expect(() => IapClaimService.assertBuyer('apple', before, USER, cutoff)).not.toThrow();
  });

  it('refuses untagged purchases made after the cutoff', () => {
    const after = { purchaseTimeMillis: String(cutoff.getTime() + 1000) };
    expect(() => IapClaimService.assertBuyer('google', after, USER, cutoff)).toThrow(
      /not linked to your account/
    );
  });

  it('refuses an untagged purchase with no purchase date once a cutoff is set', () => {
    expect(() => IapClaimService.assertBuyer('apple', {}, USER, cutoff)).toThrow();
  });
});

describe('IapClaimService.claim', () => {
  it('returns null when the purchase is newly claimed', async () => {
    const tx = fakeTx({ inserted: true });
    await expect(IapClaimService.claim(tx, claimInput)).resolves.toBeNull();
    expect(tx._values).toHaveBeenCalledWith(claimInput);
  });

  it('returns the existing claim when the purchase was already redeemed', async () => {
    const existing = { ...claimInput, purpose: 'shop_order', referenceId: 'order-9' };
    const tx = fakeTx({ inserted: false, existing });
    await expect(IapClaimService.claim(tx, claimInput)).resolves.toEqual(existing);
  });

  it('distinguishes an idempotent retry from a reuse by reason', () => {
    expect(IapClaimService.alreadyRecorded().details.reason).toBe(IAP_REASON.ALREADY_RECORDED);
    expect(IapClaimService.transactionUsed().details.reason).toBe(IAP_REASON.TRANSACTION_USED);
    expect(IapClaimService.transactionUsed().statusCode).toBe(409);
  });
});
