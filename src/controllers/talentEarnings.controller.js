import { catchAsync } from '../utils/catch-async.js';
import { TalentEarningsService } from '../services/talentEarnings.service.js';
import { StripeConnectService, PayoutMethodService } from '../services/stripeConnect.service.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { eq } from 'drizzle-orm';

// ─── STRIPE CONNECT ───────────────────────────────────────────────────────────

export const createConnectAccount = catchAsync(async (req, res) => {
  const { country = 'US' } = req.body;
  const account = await StripeConnectService.createAccount(req.user.id, country);
  res.status(201).json({ success: true, data: account });
});

export const getConnectStatus = catchAsync(async (req, res) => {
  const account = await StripeConnectService.syncStatus(req.user.id);
  res.json({ success: true, data: account });
});

export const getOnboardingLink = catchAsync(async (req, res) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, req.user.id),
    columns: { email: true },
  });
  const link = await StripeConnectService.getOnboardingLink(req.user.id, 'US', {
    email: user?.email,
    businessType: 'individual',
  });
  res.json({ success: true, data: link });
});

export const getStripeDashboardLink = catchAsync(async (req, res) => {
  const link = await StripeConnectService.getDashboardLink(req.user.id);
  res.json({ success: true, data: link });
});

// ─── EARNINGS ─────────────────────────────────────────────────────────────────

export const getEarnings = catchAsync(async (req, res) => {
  const { period, start, end } = req.query;
  const data = await TalentEarningsService.getEarnings(req.user.id, { period, start, end });
  res.json({ success: true, data });
});

// ─── WALLET TRANSACTIONS ──────────────────────────────────────────────────────
//
// Returns platform-level transfers to the connected account with a full fee
// breakdown per transaction:
//
//   grossCents       — amount charged to the customer
//   platformFeeCents — application fee kept by the platform
//   stripeFeeCents   — Stripe processing fee (paid by platform)
//   reservedCents    — explicitly reserved amount (event tickets only, = platform fee)
//   netCents         — amount received by the connected account
//
// Query params:
//   start          ISO date — filter from this date
//   end            ISO date — filter to this date
//   type           ticket | talent_session | priority_message | group_subscription  (from metadata.type)
//   feature        ticket | talent_session | priority_message | group_subscription  (from metadata.feature)
//   limit          max rows per page (default 50, max 100)
//   startingAfter  transfer ID cursor for next page (Stripe cursor pagination)

export const listTransactions = catchAsync(async (req, res) => {
  const { start, end, type, feature, limit, startingAfter } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
  const data = await StripeConnectService.listDetailedTransactions(req.user.id, {
    startTs,
    endTs,
    type,
    feature,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    startingAfter,
  });
  res.json({ success: true, data });
});

// ─── WALLET ───────────────────────────────────────────────────────────────────

export const getWallet = catchAsync(async (req, res) => {
  const data = await TalentEarningsService.getWallet(req.user.id);
  res.json({ success: true, data });
});

export const requestCashout = catchAsync(async (req, res) => {
  const { amountCents, payoutMethodId, type } = req.body;
  const data = await TalentEarningsService.requestCashout(req.user.id, {
    amountCents,
    payoutMethodId,
    type,
  });
  res.status(201).json({ success: true, data });
});

export const getPayouts = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const data = await TalentEarningsService.getPayouts(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 20,
  });
  res.json({ success: true, data });
});

// ─── PAYOUT METHODS ───────────────────────────────────────────────────────────

export const listPayoutMethods = catchAsync(async (req, res) => {
  const data = await PayoutMethodService.list(req.user.id);
  res.json({ success: true, data });
});

export const addPayoutMethod = catchAsync(async (req, res) => {
  const data = await PayoutMethodService.add(req.user.id, req.body);
  res.status(201).json({ success: true, data });
});

export const setDefaultPayoutMethod = catchAsync(async (req, res) => {
  const data = await PayoutMethodService.setDefault(req.user.id, req.params.methodId);
  res.json({ success: true, data });
});

export const deletePayoutMethod = catchAsync(async (req, res) => {
  await PayoutMethodService.remove(req.user.id, req.params.methodId);
  res.json({ success: true, message: 'Payout method removed' });
});

// ─── WALLET SUMMARY ───────────────────────────────────────────────────────────
//
// Aggregate view: gross, refunds, chargebacks, platform fees, Stripe fees,
// cash-out fees, net released — broken down by payment type (talent_session,
// priority_message, group_subscription, etc.).
//
// Query params:
//   start   ISO date — filter from this date
//   end     ISO date — filter to this date

export const getWalletSummary = catchAsync(async (req, res) => {
  const { start, end } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
  const data = await StripeConnectService.getTransactionSummary(req.user.id, { startTs, endTs });
  res.json({ success: true, data });
});
