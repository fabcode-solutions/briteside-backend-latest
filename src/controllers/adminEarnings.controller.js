import { catchAsync } from '../utils/catch-async.js';
import { TalentEarningsService } from '../services/talentEarnings.service.js';
import { StripeConnectService } from '../services/stripeConnect.service.js';
import { db } from '../db/index.js';
import { stripeConnectAccounts } from '../db/schema/stripeConnect.js';
import { users } from '../db/schema/users.js';
import { eq, ilike, or, and, desc, asc, inArray } from 'drizzle-orm';

// ─── LIST USERS WITH CONNECT ACCOUNTS ─────────────────────────────────────────
// GET /admin/connect-accounts
// Query: connectStatus (incomplete|onboarded|enabled), isSuspended (true|false),
//        search (name/email/username), page, limit, sortOrder (asc|desc)

export const listConnectAccounts = catchAsync(async (req, res) => {
  const {
    connectStatus,
    isSuspended,
    search,
    page = 1,
    limit = 20,
    sortOrder = 'desc',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(users.firstName, `%${search}%`),
        ilike(users.lastName, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.username, `%${search}%`)
      )
    );
  }

  if (isSuspended !== undefined) {
    conditions.push(eq(users.isSuspended, isSuspended === 'true'));
  }

  if (connectStatus === 'enabled') {
    conditions.push(eq(stripeConnectAccounts.chargesEnabled, true));
  } else if (connectStatus === 'onboarded') {
    conditions.push(
      and(
        eq(stripeConnectAccounts.onboardingComplete, true),
        eq(stripeConnectAccounts.chargesEnabled, false)
      )
    );
  } else if (connectStatus === 'incomplete') {
    conditions.push(eq(stripeConnectAccounts.onboardingComplete, false));
  }

  const orderCol =
    sortOrder === 'asc'
      ? asc(stripeConnectAccounts.createdAt)
      : desc(stripeConnectAccounts.createdAt);

  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      username: users.username,
      image: users.image,
      isSuspended: users.isSuspended,
      userCreatedAt: users.createdAt,
      stripeAccountId: stripeConnectAccounts.stripeAccountId,
      onboardingComplete: stripeConnectAccounts.onboardingComplete,
      chargesEnabled: stripeConnectAccounts.chargesEnabled,
      payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
      country: stripeConnectAccounts.country,
      connectCreatedAt: stripeConnectAccounts.createdAt,
    })
    .from(stripeConnectAccounts)
    .innerJoin(users, eq(stripeConnectAccounts.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderCol)
    .limit(limitNum)
    .offset(offset);

  const data = rows.map(r => ({
    ...r,
    connectStatus: r.chargesEnabled ? 'enabled' : r.onboardingComplete ? 'onboarded' : 'incomplete',
  }));

  res.json({ success: true, data, meta: { page: pageNum, limit: limitNum } });
});

// ─── PER-USER: CONNECT STATUS ─────────────────────────────────────────────────
// GET /admin/users/:userId/connect-status

export const getUserConnectStatus = catchAsync(async (req, res) => {
  const data = await StripeConnectService.syncStatus(req.params.userId);
  res.json({ success: true, data });
});

// ─── PER-USER: STRIPE EXPRESS DASHBOARD LINK ─────────────────────────────────
// GET /admin/users/:userId/stripe-dashboard
// Returns a one-time Stripe Express dashboard URL for the user's connected account.
// Admin use only — lets admin view disputes, balance, and payouts in Stripe directly.

export const getUserStripeDashboard = catchAsync(async (req, res) => {
  const data = await StripeConnectService.getDashboardLink(req.params.userId);
  res.json({ success: true, data });
});

// ─── PER-USER: WALLET ─────────────────────────────────────────────────────────
// GET /admin/users/:userId/wallet

export const getUserWallet = catchAsync(async (req, res) => {
  const data = await TalentEarningsService.getWallet(req.params.userId);
  res.json({ success: true, data });
});

// ─── PER-USER: WALLET SUMMARY ─────────────────────────────────────────────────
// GET /admin/users/:userId/wallet-summary
// Query: start, end (ISO dates)

export const getUserWalletSummary = catchAsync(async (req, res) => {
  const { start, end } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
  const data = await StripeConnectService.getTransactionSummary(req.params.userId, {
    startTs,
    endTs,
  });
  res.json({ success: true, data });
});

// ─── PER-USER: TRANSACTIONS ───────────────────────────────────────────────────
// GET /admin/users/:userId/transactions
// Query: start, end, type, feature, limit, startingAfter

export const getUserTransactions = catchAsync(async (req, res) => {
  const { start, end, type, feature, limit, startingAfter } = req.query;
  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
  const data = await StripeConnectService.listDetailedTransactions(req.params.userId, {
    startTs,
    endTs,
    type,
    feature,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    startingAfter,
  });
  res.json({ success: true, data });
});

// ─── PER-USER: PAYOUTS ────────────────────────────────────────────────────────
// GET /admin/users/:userId/payouts
// Query: page, limit

export const getUserPayouts = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const data = await TalentEarningsService.getPayouts(req.params.userId, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 20,
  });
  res.json({ success: true, data });
});

// ─── PER-USER: EARNINGS ───────────────────────────────────────────────────────
// GET /admin/users/:userId/earnings
// Query: period (weekly|monthly|yearly|custom), start, end

export const getUserEarnings = catchAsync(async (req, res) => {
  const { period, start, end } = req.query;
  const data = await TalentEarningsService.getEarnings(req.params.userId, { period, start, end });
  res.json({ success: true, data });
});

// ─── PLATFORM: ALL PAYOUTS (STRIPE) ──────────────────────────────────────────
// GET /admin/payouts
// Fetches all transfers platform → connected accounts directly from Stripe.
// Enriches each transfer with user info from DB via stripeAccountId lookup.
//
// Query: start, end (ISO dates), limit (max 100), startingAfter (Stripe cursor),
//        destination (acct_xxx — filter to one connected account)

export const listAllPayouts = catchAsync(async (req, res) => {
  const { start, end, limit, startingAfter, destination } = req.query;

  const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
  const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;

  const {
    data: transfers,
    hasMore,
    cursor,
  } = await StripeConnectService.listAllPlatformTransfers({
    startTs,
    endTs,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    startingAfter,
    destination,
  });

  // Batch-enrich with user info via stripeAccountId → DB lookup
  const accountIds = [...new Set(transfers.map(t => t.stripeAccountId).filter(Boolean))];

  const userMap = new Map();
  if (accountIds.length) {
    const rows = await db
      .select({
        stripeAccountId: stripeConnectAccounts.stripeAccountId,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        username: users.username,
      })
      .from(stripeConnectAccounts)
      .innerJoin(users, eq(stripeConnectAccounts.userId, users.id))
      .where(inArray(stripeConnectAccounts.stripeAccountId, accountIds));

    for (const r of rows) userMap.set(r.stripeAccountId, r);
  }

  const data = transfers.map(t => ({ ...t, user: userMap.get(t.stripeAccountId) ?? null }));

  res.json({ success: true, data, meta: { hasMore, cursor } });
});
