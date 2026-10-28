import { describe, it, expect, vi, beforeEach } from 'vitest';

const SENDER = '6f1c1d2e-0000-4000-8000-000000000001';
const SKU = 'com.gokyro.app.tier_1299';

const state = vi.hoisted(() => ({
  payment: null,
  existingClaim: null,
  updateReturns: [],
  updates: [],
  claimInserts: [],
}));

vi.mock('../../src/db/index.js', () => {
  const tx = {
    insert: () => ({
      values: v => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            state.claimInserts.push(v);
            return state.existingClaim ? [] : [{ id: 'claim-1' }];
          },
        }),
      }),
    }),
    update: () => ({
      set: values => ({
        where: () => ({
          returning: async () => {
            state.updates.push(values);
            return state.updateReturns;
          },
        }),
      }),
    }),
    query: {
      iapTransactionClaims: { findFirst: async () => state.existingClaim },
      priorityMessagePayments: { findFirst: async () => state.payment },
    },
  };
  return {
    db: {
      query: { priorityMessagePayments: { findFirst: async () => state.payment } },
      transaction: async fn => fn(tx),
    },
  };
});

const verifyApple = vi.fn();
const verifyGoogle = vi.fn();
const acknowledge = vi.fn(async () => {});
vi.mock('../../src/services/shop/shopIap.service.js', () => ({
  ShopIapService: {
    verifyAppleTransaction: (...a) => verifyApple(...a),
    verifyGooglePurchase: (...a) => verifyGoogle(...a),
    rejectRealMoneyGooglePurchase: async () => {},
    acknowledgeGooglePurchase: (...a) => acknowledge(...a),
  },
}));

const deliver = vi.fn(async () => ({ conversationId: 'c1' }));
vi.mock('../../src/services/priorityMessage.service.js', () => ({
  PriorityMessageService: { _deliverPaidPayment: (...a) => deliver(...a) },
}));

// The real config exits the process without a full env.
vi.mock('../../src/config/config.js', () => ({
  default: { iap: { accountTokenRequiredFrom: null } },
}));
vi.mock('../../src/config/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn() } }));

const { PriorityMessageIapService } =
  await import('../../src/services/priorityMessageIap.service.js');

const reasonOf = async promise => {
  try {
    await promise;
  } catch (err) {
    return { status: err.statusCode, reason: err.details?.reason };
  }
  return null;
};

beforeEach(() => {
  state.payment = {
    id: 'pay-1',
    senderId: SENDER,
    talentUserId: 'talent-1',
    status: 'pending',
    iapProductId: SKU,
  };
  state.existingClaim = null;
  state.updateReturns = [{ id: 'pay-1' }];
  state.updates = [];
  state.claimInserts = [];
  verifyApple.mockReset().mockResolvedValue({
    productId: SKU,
    transactionId: 'tx-1',
    environment: 'Production',
    appAccountToken: SENDER,
  });
  verifyGoogle.mockReset();
  acknowledge.mockClear();
  deliver.mockClear();
});

describe('PriorityMessageIapService.finalize', () => {
  it('claims the purchase, records the tier price and delivers', async () => {
    const result = await PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', {
      transactionId: 'tx-1',
    });
    expect(result.paymentId).toBe('pay-1');
    expect(state.claimInserts[0]).toMatchObject({
      store: 'apple',
      transactionId: 'tx-1',
      purpose: 'priority_message',
      referenceId: 'pay-1',
      environment: 'production',
    });
    expect(state.updates[0].amountCents).toBe(1299);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('refuses a purchase already redeemed for a shop order (no delivery)', async () => {
    state.existingClaim = { purpose: 'shop_order', referenceId: 'order-1', userId: SENDER };
    const err = await reasonOf(
      PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_TRANSACTION_USED' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('reports its own completed retry as already recorded', async () => {
    state.existingClaim = { purpose: 'priority_message', referenceId: 'pay-1', userId: SENDER };
    state.payment = { ...state.payment, status: 'paid', iapVerifiedAt: new Date() };
    const err = await reasonOf(
      PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_ALREADY_RECORDED' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('retries a delivery that stalled after the purchase was recorded', async () => {
    state.existingClaim = { purpose: 'priority_message', referenceId: 'pay-1', userId: SENDER };
    state.payment = {
      ...state.payment,
      iapVerifiedAt: new Date(Date.now() - 10 * 60 * 1000),
    };
    const result = await PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', {
      transactionId: 'tx-1',
    });
    expect(result.retriedDelivery).toBe(true);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('does not re-deliver while a recent delivery may still be running', async () => {
    state.existingClaim = { purpose: 'priority_message', referenceId: 'pay-1', userId: SENDER };
    state.payment = { ...state.payment, iapVerifiedAt: new Date() };
    const err = await reasonOf(
      PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err?.reason).toBe('IAP_ALREADY_RECORDED');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('refuses a second, different purchase for an already-paid payment', async () => {
    state.updateReturns = [];
    const err = await reasonOf(
      PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_PAYMENT_ALREADY_PROCESSED' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects a purchase tagged with another user's account", async () => {
    verifyApple.mockResolvedValue({
      productId: SKU,
      transactionId: 'tx-1',
      environment: 'Production',
      appAccountToken: '00000000-0000-4000-8000-000000000000',
    });
    const err = await reasonOf(
      PriorityMessageIapService.finalize(SENDER, 'pay-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 403, reason: 'IAP_ACCOUNT_MISMATCH' });
    expect(state.claimInserts).toHaveLength(0);
  });

  it('records sandbox purchases with no money and acknowledges Google purchases', async () => {
    verifyGoogle.mockResolvedValue({ purchaseState: 0, purchaseType: 0, orderId: 'GPA.1' });
    await PriorityMessageIapService.finalize(SENDER, 'pay-1', 'google', { purchaseToken: 'tok' });
    expect(state.claimInserts[0].environment).toBe('sandbox');
    expect(state.updates[0].amountCents).toBe(0);
    expect(acknowledge).toHaveBeenCalledWith('tok', SKU);
  });
});
