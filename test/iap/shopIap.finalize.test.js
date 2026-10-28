import { describe, it, expect, vi, beforeEach } from 'vitest';

const BUYER = '6f1c1d2e-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  product: null,
  existingClaim: null,
  raceClaim: null,
  ownedOrder: null,
  priorOrder: null,
  orders: [],
  claims: [],
  locks: 0,
}));

vi.mock('../../src/db/index.js', () => {
  const tx = {
    execute: async () => {
      state.locks += 1;
    },
    insert: () => ({
      values: v => ({
        // shop order insert
        returning: async () => {
          const row = { id: `order-${state.orders.length + 1}`, ...v };
          state.orders.push(row);
          return [row];
        },
        // claim insert
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.raceClaim) return [];
            state.claims.push(v);
            return [{ id: 'claim-1' }];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    query: {
      iapTransactionClaims: {
        findFirst: async () => state.existingClaim ?? state.raceClaim,
      },
      shopOrders: {
        findFirst: vi.fn(async ({ columns }) =>
          columns?.productId ? state.priorOrder : state.ownedOrder
        ),
      },
    },
  };
  // The race case: no claim at the up-front check, one by the time we insert.
  const transaction = async fn => {
    const realFindFirst = tx.query.iapTransactionClaims.findFirst;
    let calls = 0;
    tx.query.iapTransactionClaims.findFirst = async () => {
      calls += 1;
      return calls === 1 ? state.existingClaim : (state.existingClaim ?? state.raceClaim);
    };
    try {
      return await fn(tx);
    } finally {
      tx.query.iapTransactionClaims.findFirst = realFindFirst;
    }
  };
  return {
    db: {
      query: { shopProducts: { findFirst: async () => state.product } },
      update: () => ({ set: () => ({ where: async () => {} }) }),
      transaction,
    },
  };
});

vi.mock('../../src/services/shop/shopOrder.service.js', () => ({
  ShopOrderService: {
    computeFees: priceCents => ({
      chargedCents: priceCents + 75,
      sellerReceiveCents: priceCents - 50,
    }),
    notifyPurchase: vi.fn(async () => {}),
  },
}));
vi.mock('../../src/services/shop/shopProduct.service.js', () => ({
  ShopProductService: {
    getShopSettings: async () => ({
      refundsEnabled: false,
      refundWindowDays: 0,
      refundAfterDownload: false,
    }),
  },
}));
const recordSpend = vi.fn(async () => {});
vi.mock('../../src/services/userSpend.service.js', () => ({
  UserSpendService: { recordSpend: (...a) => recordSpend(...a) },
}));
vi.mock('../../src/config/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
// The real config exits the process without a full env.
vi.mock('../../src/config/config.js', () => ({
  default: {
    appleIap: { configured: true },
    googleIap: { configured: true },
    iap: { accountTokenRequiredFrom: null },
  },
}));

const { ShopIapService } = await import('../../src/services/shop/shopIap.service.js');

const reasonOf = async promise => {
  try {
    await promise;
  } catch (err) {
    return { status: err.statusCode, reason: err.details?.reason };
  }
  return null;
};

let expectedSku;

beforeEach(() => {
  state.product = {
    id: 'prod-1',
    userId: 'seller-1',
    title: 'Ebook',
    priceCents: 1000,
    buttonAction: 'payment',
    listingType: 'product',
    deletedAt: null,
  };
  expectedSku = ShopIapService.computePricingOptions(1000).appTierProductId;
  state.existingClaim = null;
  state.raceClaim = null;
  state.ownedOrder = null;
  state.priorOrder = null;
  state.orders = [];
  state.claims = [];
  state.locks = 0;
  recordSpend.mockClear();
  vi.spyOn(ShopIapService, 'verifyAppleTransaction').mockResolvedValue({
    productId: expectedSku,
    transactionId: 'tx-1',
    environment: 'Production',
  });
});

describe('ShopIapService.finalizePurchase', () => {
  it('records a paid order and claims the purchase under the buyer lock', async () => {
    const result = await ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', {
      transactionId: 'tx-1',
    });
    expect(result.orderId).toBe('order-1');
    expect(state.locks).toBe(1);
    expect(state.claims[0]).toMatchObject({
      purpose: 'shop_order',
      referenceId: 'order-1',
      environment: 'production',
    });
    expect(state.orders[0].sellerReceiveCents).toBe(950);
    expect(recordSpend).toHaveBeenCalledOnce();
  });

  it('refuses a purchase already used to pay for a priority message', async () => {
    state.existingClaim = { purpose: 'priority_message', referenceId: 'pay-1', userId: BUYER };
    const err = await reasonOf(
      ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_TRANSACTION_USED' });
    expect(state.orders).toHaveLength(0);
  });

  it("treats the buyer's own retry for the same product as already recorded", async () => {
    state.existingClaim = { purpose: 'shop_order', referenceId: 'order-0', userId: BUYER };
    state.priorOrder = { productId: 'prod-1' };
    const err = await reasonOf(
      ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_ALREADY_RECORDED' });
  });

  it('rolls back when a concurrent finalize claimed the purchase first', async () => {
    state.raceClaim = { purpose: 'priority_message', referenceId: 'pay-1', userId: BUYER };
    const err = await reasonOf(
      ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', { transactionId: 'tx-1' })
    );
    expect(err?.reason).toBe('IAP_TRANSACTION_USED');
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it('tells an owner apart from a retry', async () => {
    state.ownedOrder = { id: 'order-0' };
    const err = await reasonOf(
      ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', { transactionId: 'tx-2' })
    );
    expect(err).toEqual({ status: 409, reason: 'IAP_ALREADY_OWNED' });
  });

  it('records sandbox purchases with no money and no spend', async () => {
    ShopIapService.verifyAppleTransaction.mockResolvedValue({
      productId: expectedSku,
      transactionId: 'tx-1',
      environment: 'Sandbox',
    });
    await ShopIapService.finalizePurchase(BUYER, 'prod-1', 'apple', { transactionId: 'tx-1' });
    expect(state.orders[0]).toMatchObject({ chargedCents: 0, sellerReceiveCents: 0 });
    expect(state.claims[0].environment).toBe('sandbox');
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
