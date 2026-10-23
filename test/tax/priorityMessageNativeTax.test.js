import { describe, it, expect, vi, beforeEach } from 'vitest';

// PriorityMessageService._calculateNativeTax is the Priority Messages
// equivalent of ShopCustomOfferService._calculateServiceNativeTax /
// ShopOrderService._calculateNativeTax — a standalone Stripe Tax
// Calculation for the native (raw PaymentIntent) checkout path. Isolated
// the same way the other native-tax test files are — mocking 'stripe'
// directly and every module whose own transitive imports throw at import
// time without env vars/DB set.

const calculationsCreate = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    tax: { calculations: { create: calculationsCreate } },
  })),
}));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../src/services/socialChat.service.js', () => ({ SocialChatService: {} }));
vi.mock('../../src/services/subscription.service.js', () => ({ SubscriptionService: {} }));
vi.mock('../../src/services/notification.service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../../src/services/userSpend.service.js', () => ({ UserSpendService: {} }));
vi.mock('../../src/services/mail.service.js', () => ({}));
vi.mock('../../src/services/moderation/textModeration.service.js', () => ({
  TextModerationService: {},
  TEXT_ENTITY: {},
}));
vi.mock('../../src/services/moderation/mediaModeration.service.js', () => ({
  MediaModerationService: {},
}));
vi.mock('../../src/services/stripeConnect.service.js', () => ({ StripeConnectService: {} }));
vi.mock('../../src/services/shop/shopIap.service.js', () => ({ ShopIapService: {} }));
vi.mock('../../src/services/payoutLedger.service.js', () => ({ PayoutLedgerService: {} }));

const { PriorityMessageService } = await import('../../src/services/priorityMessage.service.js');

describe('PriorityMessageService._calculateNativeTax', () => {
  beforeEach(() => {
    calculationsCreate.mockReset();
  });

  it('charges no tax when there is no liable party', async () => {
    const result = await PriorityMessageService._calculateNativeTax({
      chargedCents: 500,
      country: 'US',
      postalCode: '98101',
      liability: null,
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('charges no tax when no postal code was collected yet', async () => {
    const result = await PriorityMessageService._calculateNativeTax({
      chargedCents: 500,
      country: 'US',
      postalCode: '',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
    expect(calculationsCreate).not.toHaveBeenCalled();
  });

  it('calls Stripe with the service tax code and real address when a liable party exists', async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 0 });
    await PriorityMessageService._calculateNativeTax({
      chargedCents: 538,
      country: 'US',
      postalCode: '98101',
      state: 'Washington',
      liability: { type: 'self' },
    });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[0].line_items[0]).toMatchObject({
      amount: 538,
      tax_code: 'txcd_20030000',
      tax_behavior: 'exclusive',
    });
    expect(callArgs[0].customer_details.address).toMatchObject({
      country: 'US',
      postal_code: '98101',
      state: 'WA',
    });
  });

  it("scopes the calculation to the creator's connected account when they are liable", async () => {
    calculationsCreate.mockResolvedValue({ tax_amount_exclusive: 0 });
    const result = await PriorityMessageService._calculateNativeTax({
      chargedCents: 500,
      country: 'US',
      postalCode: '94043',
      liability: { type: 'account', account: 'acct_creator123' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: 'Tax' });
    const callArgs = calculationsCreate.mock.calls[0];
    expect(callArgs[1]).toEqual({ stripeAccount: 'acct_creator123' });
  });

  it('fails toward $0 if the Stripe Tax Calculation call errors', async () => {
    calculationsCreate.mockRejectedValue(new Error('Stripe is down'));
    const result = await PriorityMessageService._calculateNativeTax({
      chargedCents: 500,
      country: 'US',
      postalCode: '98101',
      liability: { type: 'self' },
    });
    expect(result).toEqual({ amountCents: 0, taxLabel: null });
  });
});
