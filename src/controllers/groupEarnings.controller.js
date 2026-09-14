import { catchAsync } from '../utils/catch-async.js';
import { StripeConnectService, PayoutMethodService } from '../services/stripeConnect.service.js';
import { db } from '../db/index.js';
import { groupPayouts } from '../db/schema/index.js';
import { eq, sum, and, inArray } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { requireGroupCreator } from '../utils/group-helpers.js';

// ─── WALLET ───────────────────────────────────────────────────────────────────
//
// Returns the creator's Stripe Connect balance (unified across all earning types)
// plus the 5 most recent group payouts for quick display.

export const getGroupCreatorWallet = catchAsync(async (req, res) => {
  const [stripeBalance, recentPayouts] = await Promise.all([
    StripeConnectService.getBalance(req.user.id),
    db.query.groupPayouts.findMany({
      where: eq(groupPayouts.userId, req.user.id),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
      limit: 5,
      columns: {
        id: true,
        amountCents: true,
        status: true,
        type: true,
        groupId: true,
        stripePayoutId: true,
        processedAt: true,
        createdAt: true,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      availableCents: stripeBalance.availableCents,
      pendingCents: stripeBalance.pendingCents,
      available: Math.round(stripeBalance.availableCents / 100),
      pending: Math.round(stripeBalance.pendingCents / 100),
      currency: stripeBalance.currency,
      connected: stripeBalance.connected,
      recentPayouts: recentPayouts.map(p => ({ ...p, amount: Math.round(p.amountCents / 100) })),
    },
  });
});

// ─── WALLET SUMMARY (all groups) ──────────────────────────────────────────────
//
// Aggregates ALL group_subscription transfers for this creator.
// Uses getTransactionSummary (auto-paginates) then extracts the group_subscription bucket.
//
// Query params:
//   start   ISO date
//   end     ISO date

export const getGroupCreatorWalletSummary = catchAsync(async (req, res) => {
  const { start, end } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;

  const [full, [cashedOutRow], stripeBalance] = await Promise.all([
    StripeConnectService.getTransactionSummary(req.user.id, { startTs, endTs }),
    db
      .select({ total: sum(groupPayouts.amountCents) })
      .from(groupPayouts)
      .where(
        and(eq(groupPayouts.userId, req.user.id), inArray(groupPayouts.status, ['paid', 'pending']))
      ),
    StripeConnectService.getBalance(req.user.id),
  ]);

  const groupBucket = full.byType.find(t => t.type === 'group_subscription') ?? {
    type: 'group_subscription',
    label: 'Group Subscriptions',
    count: 0,
    grossCents: 0,
    gross: 0,
    platformFeesCents: 0,
    platformFees: 0,
    stripeFeeCents: 0,
    stripeFees: 0,
    refundsCents: 0,
    refunds: 0,
    netCents: 0,
    net: 0,
  };

  const cashedOutCents = Number(cashedOutRow?.total ?? 0);
  const featureAvailableCents = Math.min(
    Math.max(0, groupBucket.netCents - cashedOutCents),
    stripeBalance.availableCents
  );

  res.json({
    success: true,
    data: {
      ...groupBucket,
      cashedOutCents,
      cashedOut: +(cashedOutCents / 100).toFixed(2),
      featureAvailableCents,
      featureAvailable: +(featureAvailableCents / 100).toFixed(2),
      connected: full.connected,
      reserveRate: full.reserveRate,
    },
  });
});

// ─── TRANSACTIONS (all groups) ────────────────────────────────────────────────
//
// Lists platform transfers of type group_subscription for this creator.
// Optionally narrow to a specific group via ?groupId=<uuid> (matched against
// charge.metadata.groupId set at checkout time).
//
// Query params:
//   start          ISO date
//   end            ISO date
//   groupId        UUID — filter to a specific group
//   limit          max rows (default 50, max 100)
//   startingAfter  transfer ID cursor for next page

export const listGroupCreatorTransactions = catchAsync(async (req, res) => {
  const { start, end, groupId, limit, startingAfter } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;

  const data = await StripeConnectService.listDetailedTransactions(req.user.id, {
    startTs,
    endTs,
    type: 'group_subscription',
    groupId,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    startingAfter,
  });

  res.json({ success: true, data });
});

// ─── TRANSACTIONS (per group) ─────────────────────────────────────────────────
//
// Scoped to a specific group. Requires caller to be the group creator.
// Each item has the full fee breakdown: grossCents, platformFeeCents,
// stripeFeeCents, netCents, refundCents, finalNetCents.

export const listGroupTransactions = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  await requireGroupCreator(groupId, req.user.id, 'Only the group creator can view group wallet.');

  const { start, end, limit, startingAfter } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;

  const data = await StripeConnectService.listDetailedTransactions(req.user.id, {
    startTs,
    endTs,
    type: 'group_subscription',
    groupId,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    startingAfter,
  });

  res.json({ success: true, data });
});

// ─── WALLET SUMMARY (per group) ───────────────────────────────────────────────
//
// Full aggregation scoped to one group. Uses getTransactionSummary with the
// groupId filter — auto-paginates all transfers for accurate totals.
// Requires group creator.

export const getGroupWalletSummary = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  await requireGroupCreator(groupId, req.user.id, 'Only the group creator can view group wallet.');

  const { start, end } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;

  const full = await StripeConnectService.getTransactionSummary(req.user.id, {
    startTs,
    endTs,
    groupId,
  });

  const groupBucket = full.byType.find(t => t.type === 'group_subscription') ?? {
    type: 'group_subscription',
    label: 'Group Subscriptions',
    count: 0,
    grossCents: 0,
    gross: 0,
    platformFeesCents: 0,
    platformFees: 0,
    stripeFeeCents: 0,
    stripeFees: 0,
    refundsCents: 0,
    refunds: 0,
    netCents: 0,
    net: 0,
  };

  res.json({
    success: true,
    data: { groupId, ...groupBucket, connected: full.connected, reserveRate: full.reserveRate },
  });
});

// ─── CASHOUT ──────────────────────────────────────────────────────────────────
//
// Initiates a payout from the creator's Connect balance. groupId in body is
// optional — used to tag the record to a specific group for history.
//
// Body: { amountCents, payoutMethodId?, type?, groupId? }

export const requestGroupCashout = catchAsync(async (req, res) => {
  const { amountCents, payoutMethodId, type = 'standard', groupId } = req.body;
  if (!amountCents || amountCents < 100) throw new ApiError(400, 'Minimum cashout is $1.00');

  // Validate against feature-specific virtual balance (earned - already cashed out)
  const [summary, [cashedOutRow]] = await Promise.all([
    StripeConnectService.getTransactionSummary(req.user.id, { groupId }),
    db
      .select({ total: sum(groupPayouts.amountCents) })
      .from(groupPayouts)
      .where(
        and(eq(groupPayouts.userId, req.user.id), inArray(groupPayouts.status, ['paid', 'pending']))
      ),
  ]);

  const groupBucket = summary.byType.find(t => t.type === 'group_subscription');
  const earnedCents = groupBucket?.netCents ?? 0;
  const cashedOutCents = Number(cashedOutRow?.total ?? 0);
  const featureAvailableCents = Math.max(0, earnedCents - cashedOutCents);

  if (amountCents > featureAvailableCents) {
    throw new ApiError(
      400,
      `Insufficient group subscription earnings. Feature available: ${featureAvailableCents} cents`
    );
  }

  const connectAccount = await StripeConnectService.getForUser(req.user.id);
  let stripePayoutId = null;

  if (connectAccount?.payoutsEnabled) {
    const payout = await StripeConnectService.requestPayout(req.user.id, amountCents, type, {
      service: 'groups',
      ...(groupId && { groupId }),
    });
    stripePayoutId = payout.id;
  }

  const [record] = await db
    .insert(groupPayouts)
    .values({
      userId: req.user.id,
      groupId: groupId ?? null,
      payoutMethodId: payoutMethodId ?? null,
      amountCents,
      status: stripePayoutId ? 'paid' : 'pending',
      type: connectAccount?.payoutsEnabled ? type : 'manual',
      stripePayoutId,
      processedAt: stripePayoutId ? new Date() : null,
    })
    .returning();

  res
    .status(201)
    .json({ success: true, data: { ...record, amount: Math.round(record.amountCents / 100) } });
});

// ─── PAYOUTS ──────────────────────────────────────────────────────────────────

export const getGroupCreatorPayouts = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const p = page ? parseInt(page) : 1;
  const l = limit ? parseInt(limit) : 20;

  const { data } = await StripeConnectService.listPayouts(req.user.id, { limit: 100 });
  const offset = (p - 1) * l;
  const items = data.slice(offset, offset + l).map(payout => ({
    id: payout.id,
    amount: payout.amount / 100,
    amountCents: payout.amount,
    currency: payout.currency,
    status: payout.status,
    method: payout.method,
    arrivalDate: payout.arrival_date,
    destination: payout.destination,
    metadata: payout.metadata,
    createdAt: new Date(payout.created * 1000).toISOString(),
  }));

  res.json({ success: true, data: { items, page: p, limit: l, total: data.length } });
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
