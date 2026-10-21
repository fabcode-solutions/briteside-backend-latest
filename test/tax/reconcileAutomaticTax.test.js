import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers the "database order totals vs Stripe PaymentIntent amounts" gap:
// a hosted Checkout Session for a virtual Marketplace-Facilitator event
// uses Stripe's automatic_tax, which only resolves the real tax amount
// once the buyer's billing address is collected live during checkout. The
// order was saved with a pre-tax placeholder total at session-creation
// time (taxPendingAutomatic: true) — this reconciles it from the
// completed session, and must be safe to run twice (retried webhook
// deliveries) without double-adjusting anything.

const updateSet = vi.fn();
const updateWhere = vi.fn(() => Promise.resolve());

vi.mock('../../src/db/index.js', () => ({
  db: {
    update: () => ({
      set: (...args) => {
        updateSet(...args);
        return { where: (...whereArgs) => updateWhere(...whereArgs) };
      },
    }),
  },
}));

vi.mock('../../src/services/stripeConnect.service.js', () => ({
  StripeConnectService: { getForUser: vi.fn(async () => null) },
  getReserveRate: vi.fn(async () => 0.15),
}));

const { PaymentService } = await import('../../src/services/payment.service.js');

beforeEach(() => {
  updateSet.mockClear();
  updateWhere.mockClear();
});

describe('PaymentService.reconcileAutomaticTaxOnOrder', () => {
  it('is a no-op for an order that never used automatic_tax', async () => {
    const order = {
      id: 'order-1',
      taxPendingAutomatic: false,
      totalAmount: '36.75',
      platformShareCents: 175,
    };

    await PaymentService.reconcileAutomaticTaxOnOrder(order, {
      amount_total: 3932,
      total_details: { amount_tax: 257 },
    });

    expect(updateSet).not.toHaveBeenCalled();
  });

  it('reconciles tax/total/platform-share from the completed session', async () => {
    const order = {
      id: 'order-1',
      taxPendingAutomatic: true,
      totalAmount: '36.75', // pre-tax placeholder: $35 ticket + $1.75 fee
      platformShareCents: 175, // just the platform fee, pre-reconciliation
    };

    const session = {
      amount_total: 3932, // Stripe's real, tax-inclusive charge: $39.32
      total_details: { amount_tax: 257 }, // $2.57 real tax
    };

    await PaymentService.reconcileAutomaticTaxOnOrder(order, session);

    expect(updateSet).toHaveBeenCalledTimes(1);
    const persisted = updateSet.mock.calls[0][0];
    expect(persisted.totalAmount).toBe('39.32');
    expect(persisted.taxAmountCents).toBe(257);
    // Facilitator tax is always withheld into Briteside's share: 175 + 257
    expect(persisted.platformShareCents).toBe(432);
    expect(persisted.reserveAmountCents).toBe(Math.round((3932 - 432) * 0.15));
    expect(persisted.taxPendingAutomatic).toBe(false);
  });

  it('is idempotent — a retried webhook delivery does not double-adjust', async () => {
    // Simulates the ACTUAL retry: taxPendingAutomatic is already false going
    // into the second call, exactly as it would be in the real DB row after
    // the first reconciliation persisted it.
    const alreadyReconciledOrder = {
      id: 'order-1',
      taxPendingAutomatic: false,
      totalAmount: '39.32',
      taxAmountCents: 257,
      platformShareCents: 432,
    };

    await PaymentService.reconcileAutomaticTaxOnOrder(alreadyReconciledOrder, {
      amount_total: 3932,
      total_details: { amount_tax: 257 },
    });

    expect(updateSet).not.toHaveBeenCalled();
  });

  it('treats a missing total_details as $0 tax rather than throwing', async () => {
    const order = { id: 'order-1', taxPendingAutomatic: true, totalAmount: '36.75', platformShareCents: 175 };

    await PaymentService.reconcileAutomaticTaxOnOrder(order, { amount_total: 3675 });

    const persisted = updateSet.mock.calls[0][0];
    expect(persisted.taxAmountCents).toBe(0);
    expect(persisted.totalAmount).toBe('36.75');
    expect(persisted.platformShareCents).toBe(175);
  });
});
