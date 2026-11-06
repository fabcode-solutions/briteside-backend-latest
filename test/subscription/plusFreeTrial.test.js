import { describe, it, expect, vi, beforeEach } from 'vitest';

// BriteSide Plus free trial — eligibility (one trial per user, ever), the
// native checkout's SetupIntent-first trial path, and the webhook handlers
// that must not treat a trial's $0 invoice as a real payment. Isolated the
// same way the native-tax tests are: 'stripe', the DB and every module with
// import-time side effects are mocked.

const stripeMock = {
  customers: { retrieve: vi.fn() },
  subscriptions: { list: vi.fn(), create: vi.fn(), cancel: vi.fn() },
  setupIntents: { create: vi.fn(), retrieve: vi.fn() },
  invoices: { retrieve: vi.fn() },
  products: { retrieve: vi.fn(), create: vi.fn() },
  prices: { retrieve: vi.fn(), create: vi.fn() },
};
vi.mock('stripe', () => ({ default: vi.fn().mockImplementation(() => stripeMock) }));
vi.mock('../../src/config/config.js', () => ({ default: { stripe: { secretKey: 'sk_test' } } }));

const findFirst = {
  subscriptionPlans: vi.fn(),
  userSubscriptions: vi.fn(),
  users: vi.fn(),
  stripeCustomers: vi.fn(),
};
const insertReturning = vi.fn();
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: {
      subscriptionPlans: { findFirst: (...a) => findFirst.subscriptionPlans(...a) },
      userSubscriptions: { findFirst: (...a) => findFirst.userSubscriptions(...a) },
      users: { findFirst: (...a) => findFirst.users(...a) },
      stripeCustomers: { findFirst: (...a) => findFirst.stripeCustomers(...a) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: insertReturning })),
    })),
    update: vi.fn(() => ({ set: updateSet })),
  },
}));

const recordSpend = vi.fn();
vi.mock('../../src/services/userSpend.service.js', () => ({
  UserSpendService: { recordSpend: (...a) => recordSpend(...a) },
}));
const sendSignup = vi.fn();
vi.mock('../../src/templates/index.js', () => ({
  sendBridesidePlusSignupEmail: (...a) => sendSignup(...a),
  sendBridesidePlusCancellationEmail: vi.fn(),
  sendBridesidePlusPaymentFailedEmail: vi.fn(),
  sendBridesidePlusTrialEndingEmail: vi.fn(),
}));

const { SubscriptionService } = await import('../../src/services/subscription.service.js');

const USER_ID = 'user-1';
const PLAN = {
  id: 'plan-1',
  name: 'Plus Monthly',
  price: '10.00',
  currency: 'usd',
  interval: 'month',
  isActive: true,
  stripeProductId: 'prod_1',
  stripePriceId: 'price_1',
  trialDays: 7,
};

const missing = () => Object.assign(new Error('No such product'), { code: 'resource_missing' });

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.subscriptionPlans.mockResolvedValue(PLAN);
  findFirst.userSubscriptions.mockResolvedValue(undefined);
  findFirst.users.mockResolvedValue({ email: 'a@example.com', firstName: 'Alex' });
  findFirst.stripeCustomers.mockResolvedValue({ stripeCustomerId: 'cus_1' });
  stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_1' });
  stripeMock.subscriptions.list.mockResolvedValue({ data: [] });
  stripeMock.products.retrieve.mockResolvedValue({ id: 'prod_1' });
  stripeMock.prices.retrieve.mockResolvedValue({ id: 'price_1' });
  insertReturning.mockResolvedValue([{ id: 'row-1', currentPeriodEnd: new Date() }]);
});

describe('ensurePlanStripeIds', () => {
  it('leaves a plan alone when its Stripe product and price exist', async () => {
    expect(await SubscriptionService.ensurePlanStripeIds(PLAN)).toBe(PLAN);
    expect(stripeMock.products.create).not.toHaveBeenCalled();
    expect(stripeMock.prices.create).not.toHaveBeenCalled();
  });

  it('recreates product and price when they belong to another Stripe account', async () => {
    stripeMock.products.retrieve.mockRejectedValue(missing());
    stripeMock.products.create.mockResolvedValue({ id: 'prod_new' });
    stripeMock.prices.create.mockResolvedValue({ id: 'price_new' });
    updateReturning.mockResolvedValue([
      { ...PLAN, stripeProductId: 'prod_new', stripePriceId: 'price_new' },
    ]);

    const repaired = await SubscriptionService.ensurePlanStripeIds(PLAN);

    expect(repaired).toMatchObject({ stripeProductId: 'prod_new', stripePriceId: 'price_new' });
    expect(stripeMock.prices.create).toHaveBeenCalledWith({
      product: 'prod_new',
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ stripeProductId: 'prod_new', stripePriceId: 'price_new' })
    );
  });

  it('only recreates the price when just the price is missing', async () => {
    stripeMock.prices.retrieve.mockRejectedValue(missing());
    stripeMock.prices.create.mockResolvedValue({ id: 'price_new' });
    updateReturning.mockResolvedValue([{ ...PLAN, stripePriceId: 'price_new' }]);

    await SubscriptionService.ensurePlanStripeIds(PLAN);

    expect(stripeMock.products.create).not.toHaveBeenCalled();
    expect(stripeMock.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ product: 'prod_1' })
    );
  });

  it('rethrows Stripe errors other than a missing resource', async () => {
    stripeMock.products.retrieve.mockRejectedValue(new Error('Stripe is down'));
    await expect(SubscriptionService.ensurePlanStripeIds(PLAN)).rejects.toThrow('Stripe is down');
    expect(stripeMock.products.create).not.toHaveBeenCalled();
  });
});

describe('resolveTrialDays', () => {
  it('offers no trial when the plan has none, without querying history', async () => {
    expect(await SubscriptionService.resolveTrialDays(USER_ID, { ...PLAN, trialDays: 0 })).toBe(0);
    expect(findFirst.userSubscriptions).not.toHaveBeenCalled();
  });

  it("offers the plan's trial to a first-time subscriber", async () => {
    expect(await SubscriptionService.resolveTrialDays(USER_ID, PLAN)).toBe(7);
  });

  it('offers no trial once the user has had any Stripe-backed Plus subscription', async () => {
    findFirst.userSubscriptions.mockResolvedValue({ id: 'old-sub' });
    expect(await SubscriptionService.resolveTrialDays(USER_ID, PLAN)).toBe(0);
  });
});

describe('createNativeSubscriptionIntent', () => {
  it('saves the card via a SetupIntent instead of creating a subscription for a trial', async () => {
    stripeMock.setupIntents.create.mockResolvedValue({
      id: 'seti_1',
      client_secret: 'seti_secret',
    });

    const result = await SubscriptionService.createNativeSubscriptionIntent(USER_ID, PLAN.id);

    expect(result).toEqual({
      paymentId: 'seti_1',
      clientSecret: 'seti_secret',
      intentType: 'setup',
      trialDays: 7,
    });
    expect(stripeMock.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        usage: 'off_session',
        metadata: { userId: USER_ID, planId: PLAN.id, trialDays: '7' },
      })
    );
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });

  it('charges up front with no trial for a returning subscriber', async () => {
    // First lookup = active-sub guard (none); second = trial history (has one)
    findFirst.userSubscriptions
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'old-sub' });
    stripeMock.subscriptions.create.mockResolvedValue({
      id: 'sub_1',
      latest_invoice: { id: 'in_1' },
    });
    stripeMock.invoices.retrieve.mockResolvedValue({
      payments: {
        data: [
          { payment: { type: 'payment_intent', payment_intent: { client_secret: 'pi_secret' } } },
        ],
      },
    });

    const result = await SubscriptionService.createNativeSubscriptionIntent(USER_ID, PLAN.id);

    expect(result).toEqual({
      paymentId: 'sub_1',
      clientSecret: 'pi_secret',
      intentType: 'payment',
    });
    expect(stripeMock.setupIntents.create).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.create.mock.calls[0][0]).not.toHaveProperty(
      'trial_period_days'
    );
  });
});

describe('finalizeNativeTrialSubscription', () => {
  const succeededSetupIntent = {
    id: 'seti_1',
    status: 'succeeded',
    customer: 'cus_1',
    payment_method: 'pm_1',
    metadata: { userId: USER_ID, planId: PLAN.id, trialDays: '7' },
  };
  const trialingSub = {
    id: 'sub_trial',
    status: 'trialing',
    trial_end: Math.floor(Date.now() / 1000) + 7 * 86400,
    items: { data: [] },
  };

  it("rejects another user's SetupIntent", async () => {
    stripeMock.setupIntents.retrieve.mockResolvedValue({
      ...succeededSetupIntent,
      metadata: { ...succeededSetupIntent.metadata, userId: 'someone-else' },
    });
    await expect(
      SubscriptionService.finalizeNativeTrialSubscription(USER_ID, 'seti_1')
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a SetupIntent whose card was never confirmed', async () => {
    stripeMock.setupIntents.retrieve.mockResolvedValue({
      ...succeededSetupIntent,
      status: 'requires_payment_method',
    });
    await expect(
      SubscriptionService.finalizeNativeTrialSubscription(USER_ID, 'seti_1')
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });

  it('creates a trialing subscription on the saved card and records no spend', async () => {
    stripeMock.setupIntents.retrieve.mockResolvedValue(succeededSetupIntent);
    stripeMock.subscriptions.create.mockResolvedValue(trialingSub);

    const result = await SubscriptionService.finalizeNativeTrialSubscription(USER_ID, 'seti_1');

    expect(result).toMatchObject({ subscriptionId: 'sub_trial', status: 'trialing' });
    const [params, options] = stripeMock.subscriptions.create.mock.calls[0];
    expect(params).toMatchObject({
      customer: 'cus_1',
      items: [{ price: 'price_1' }],
      default_payment_method: 'pm_1',
      trial_period_days: 7,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: expect.objectContaining({ setupIntentId: 'seti_1', userId: USER_ID }),
    });
    expect(options).toEqual({ idempotencyKey: 'plus-trial-seti_1' });
    expect(recordSpend).not.toHaveBeenCalled();
    expect(sendSignup.mock.calls[0][1].trial_end_date).toBeTruthy();
  });

  it('reuses the subscription a retried finalize already created', async () => {
    stripeMock.setupIntents.retrieve.mockResolvedValue(succeededSetupIntent);
    stripeMock.subscriptions.list.mockResolvedValue({
      data: [{ ...trialingSub, metadata: { setupIntentId: 'seti_1' } }],
    });
    // The first run's row now exists and would fail the eligibility check
    findFirst.userSubscriptions.mockResolvedValue({ id: 'row-1', userId: USER_ID });

    const result = await SubscriptionService.finalizeNativeTrialSubscription(USER_ID, 'seti_1');

    expect(result).toMatchObject({ subscriptionId: 'sub_trial' });
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });
});

describe('handleInvoicePaid', () => {
  it("ignores the trial's $0 opening invoice", async () => {
    await SubscriptionService.handleInvoicePaid({
      id: 'in_0',
      amount_paid: 0,
      billing_reason: 'subscription_create',
      parent: { subscription_details: { subscription: 'sub_trial' } },
    });
    expect(updateSet).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it('activates and records the first real charge when the trial converts', async () => {
    findFirst.userSubscriptions.mockResolvedValue({
      id: 'row-1',
      userId: USER_ID,
      planId: PLAN.id,
      status: 'trialing',
    });

    await SubscriptionService.handleInvoicePaid({
      id: 'in_1',
      amount_paid: 1000,
      billing_reason: 'subscription_cycle',
      parent: { subscription_details: { subscription: 'sub_trial' } },
    });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    expect(recordSpend).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1000 }));
  });
});
