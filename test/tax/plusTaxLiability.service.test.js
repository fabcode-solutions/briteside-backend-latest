import { describe, it, expect, vi, beforeEach } from 'vitest';

const registrationsList = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    tax: { registrations: { list: registrationsList } },
  })),
}));

const getForUser = vi.fn();
vi.mock('../../src/services/stripeConnect.service.js', () => ({
  StripeConnectService: { getForUser },
}));

const { PlusTaxLiabilityService } =
  await import('../../src/services/tax/plusTaxLiability.service.js');

describe('PlusTaxLiabilityService.resolveLiability', () => {
  beforeEach(() => {
    registrationsList.mockReset();
    getForUser.mockReset();
  });

  it('prefers the creator when they hold an active US registration', async () => {
    getForUser.mockResolvedValue({ stripeAccountId: 'acct_creator' });
    registrationsList.mockImplementation((params, opts) => {
      // First call is the creator's (scoped via stripeAccount); has nexus.
      if (opts?.stripeAccount === 'acct_creator') {
        return Promise.resolve({ data: [{ country: 'US' }] });
      }
      return Promise.resolve({ data: [] });
    });

    const result = await PlusTaxLiabilityService.resolveLiability('user-1');
    expect(result).toEqual({ liability: { type: 'account', account: 'acct_creator' } });
  });

  it('falls back to Briteside when only the platform has nexus', async () => {
    getForUser.mockResolvedValue({ stripeAccountId: 'acct_creator' });
    registrationsList.mockImplementation((params, opts) => {
      if (opts?.stripeAccount === 'acct_creator') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [{ country: 'US' }] }); // Briteside's own
    });

    const result = await PlusTaxLiabilityService.resolveLiability('user-1');
    expect(result).toEqual({ liability: { type: 'self' } });
  });

  it('disables automatic_tax entirely when nobody has nexus (fail toward $0)', async () => {
    getForUser.mockResolvedValue({ stripeAccountId: 'acct_creator' });
    registrationsList.mockResolvedValue({ data: [] });

    const result = await PlusTaxLiabilityService.resolveLiability('user-1');
    expect(result).toEqual({ liability: null });
  });

  it('disables automatic_tax when the seller has no connected account at all', async () => {
    getForUser.mockResolvedValue(null);
    registrationsList.mockResolvedValue({ data: [{ country: 'US' }] }); // Briteside has nexus

    const result = await PlusTaxLiabilityService.resolveLiability('user-1');
    expect(result).toEqual({ liability: { type: 'self' } });
  });

  it('fails toward $0 (disabled) if the Stripe lookup itself errors', async () => {
    getForUser.mockRejectedValue(new Error('db down'));
    registrationsList.mockRejectedValue(new Error('stripe down'));

    const result = await PlusTaxLiabilityService.resolveLiability('user-1');
    expect(result).toEqual({ liability: null });
  });
});
