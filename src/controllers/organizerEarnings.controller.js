import { catchAsync } from '../utils/catch-async.js';
import { OrganizerEarningsService } from '../services/organizerEarnings.service.js';
import { StripeConnectService, PayoutMethodService } from '../services/stripeConnect.service.js';
import { db } from '../db/index.js';
import { organizers } from '../db/schema/index.js';
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
  const org = await db.query.organizers.findFirst({
    where: eq(organizers.userId, req.user.id),
    columns: {
      contactEmail: true,
      businessName: true,
      websiteUrl: true,
      contactPhone: true,
      businessType: true,
      country: true,
    },
  });
  const link = await StripeConnectService.getOnboardingLink(req.user.id, org?.country || 'US', {
    email: org?.contactEmail,
    businessName: org?.businessName,
    websiteUrl: org?.websiteUrl,
    contactPhone: org?.contactPhone,
    businessType: org?.businessType,
  });
  res.json({ success: true, data: link });
});

export const getStripeDashboardLink = catchAsync(async (req, res) => {
  const link = await StripeConnectService.getDashboardLink(req.user.id);
  res.json({ success: true, data: link });
});

// ─── EARNINGS ─────────────────────────────────────────────────────────────────

export const getOrganizerEarnings = catchAsync(async (req, res) => {
  const { period, start, end } = req.query;
  const data = await OrganizerEarningsService.getEarnings(req.user.id, { period, start, end });
  res.json({ success: true, data });
});

export const getEventEarnings = catchAsync(async (req, res) => {
  const { period, start, end } = req.query;
  const data = await OrganizerEarningsService.getEventEarnings(req.user.id, req.params.eventId, {
    period,
    start,
    end,
  });
  res.json({ success: true, data });
});

export const getFeeCalculator = catchAsync(async (req, res) => {
  const { totalSales } = req.query;
  const data = await OrganizerEarningsService.getFeeCalculator(req.user.id, { totalSales });
  res.json({ success: true, data });
});

export const getEventFeeCalculator = catchAsync(async (req, res) => {
  const { totalSales } = req.query;
  const data = await OrganizerEarningsService.getFeeCalculator(req.user.id, {
    eventId: req.params.eventId,
    totalSales,
  });
  res.json({ success: true, data });
});

// ─── WALLET ───────────────────────────────────────────────────────────────────

export const getOrganizerWallet = catchAsync(async (req, res) => {
  const data = await OrganizerEarningsService.getWallet(req.user.id);
  res.json({ success: true, data });
});

export const requestOrganizerCashout = catchAsync(async (req, res) => {
  const { amountCents, payoutMethodId, type } = req.body;
  const data = await OrganizerEarningsService.requestCashout(req.user.id, {
    amountCents,
    payoutMethodId,
    type,
  });
  res.status(201).json({ success: true, data });
});

export const getOrganizerPayouts = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const data = await OrganizerEarningsService.getPayouts(req.user.id, {
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
// cash-out fees, net released — broken down by payment type.
// Matches the summary card shown in the organizer wallet dashboard.
//
// Query params:
//   start   ISO date — filter from this date
//   end     ISO date — filter to this date
//   type    ticket | group_subscription | ... (optional server-side filter on byType result)

export const getOrganizerWalletSummary = catchAsync(async (req, res) => {
  const { start, end } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
  const data = await StripeConnectService.getTransactionSummary(req.user.id, { startTs, endTs });
  res.json({ success: true, data });
});
