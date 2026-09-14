import Stripe from 'stripe';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { stripeConnectAccounts, userPayoutMethods } from '../db/schema/index.js';
import { orders } from '../db/schema/payments.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { systemSettings } from '../db/schema/admin.js';
import { groupSubscriptions } from '../db/schema/subscriptions.js';
import { stripeCustomers } from '../db/schema/britesidePlus.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';
const DEFAULT_RESERVE_RATE = 0.15;

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2026-03-25.dahlia' });
}

function ensureStripe() {
  if (!stripe) throw new ApiError(503, 'Payment provider not configured');
}

// ─── RESERVE RATE ─────────────────────────────────────────────────────────────
// Admin-editable via systemSettings key 'payout_reserve_rate' (e.g. 0.15 = 15%)

export async function getReserveRate() {
  const setting = await db.query.systemSettings
    .findFirst({ where: eq(systemSettings.settingKey, 'payout_reserve_rate') })
    .catch(() => null);

  const val = setting?.settingValue;
  if (val === undefined || val === null) return DEFAULT_RESERVE_RATE;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? DEFAULT_RESERVE_RATE : parsed;
}

// ─── CONNECT ACCOUNT ──────────────────────────────────────────────────────────

export class StripeConnectService {
  static async getForUser(userId) {
    return db.query.stripeConnectAccounts.findFirst({
      where: eq(stripeConnectAccounts.userId, userId),
    });
  }

  static async createAccount(userId, country = 'US') {
    ensureStripe();
    const existing = await StripeConnectService.getForUser(userId);
    if (existing) throw new ApiError(409, 'Stripe Connect account already exists for this user');

    // v1 endpoint with explicit controller properties (no legacy 'type' param)
    const account = await stripe.accounts.create({
      country,
      controller: {
        losses: { payments: 'application' },
        fees: { payer: 'application' },
        stripe_dashboard: { type: 'express' },
        requirement_collection: 'stripe',
      },
      // Requested explicitly rather than relying on the platform's per-country
      // Express defaults — a country with no defaults configured is what
      // produced "You must provide an account with capabilities...".
      //
      // `transfers` is what destination charges actually require. `card_payments`
      // is requested because it drives `charges_enabled`, and that flag gates
      // shop checkout, talent bookings, the Connect banner and the onboarding
      // nudge. Request it and those stay correct; omit it and they would all
      // report a fully-onboarded seller as unable to sell.
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const [record] = await db
      .insert(stripeConnectAccounts)
      .values({
        userId,
        stripeAccountId: account.id,
        country,
        onboardingComplete: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      })
      .returning();

    return record;
  }

  static async getOnboardingLink(userId, country = 'US', prefillData = {}) {
    ensureStripe();
    let account = await StripeConnectService.getForUser(userId);
    if (!account) account = await StripeConnectService.createAccount(userId, country);

    if (Object.keys(prefillData).length) {
      await StripeConnectService.prefillAccount(account.stripeAccountId, prefillData).catch(err =>
        console.error('[Stripe] prefill failed:', err.message)
      );
    }

    const link = await stripe.accountLinks.create({
      account: account.stripeAccountId,
      refresh_url: `${FRONTEND_URL}/settings/stripe?refresh=true`,
      return_url: `${FRONTEND_URL}/settings/stripe?onboarding=complete`,
      type: 'account_onboarding',
      collection_options: { fields: 'currently_due' },
    });

    return { url: link.url, expiresAt: link.expires_at };
  }

  // Push known profile data to Stripe so hosted onboarding only asks currently_due fields.
  static async prefillAccount(
    stripeAccountId,
    { email, businessName, websiteUrl, contactPhone, businessType } = {}
  ) {
    ensureStripe();
    const update = {};
    if (email) update.email = email;
    if (businessType) {
      update.business_type = businessType === 'individual' ? 'individual' : 'company';
    }
    const profile = {};
    if (businessName) profile.name = businessName;
    if (websiteUrl) profile.url = websiteUrl;
    if (contactPhone) profile.support_phone = contactPhone;
    if (Object.keys(profile).length) update.business_profile = profile;
    if (!Object.keys(update).length) return;
    await stripe.accounts.update(stripeAccountId, update);
  }

  // Syncs chargesEnabled / payoutsEnabled from Stripe — call after onboarding return
  static async syncStatus(userId) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record) throw new ApiError(404, 'No Stripe Connect account found');

    const account = await stripe.accounts.retrieve(record.stripeAccountId);

    const [updated] = await db
      .update(stripeConnectAccounts)
      .set({
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        onboardingComplete: account.details_submitted,
        updatedAt: new Date(),
      })
      .where(eq(stripeConnectAccounts.userId, userId))
      .returning();

    return updated;
  }

  static async getDashboardLink(userId) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record) throw new ApiError(404, 'No Stripe Connect account found');
    if (!record.onboardingComplete) throw new ApiError(400, 'Complete Stripe onboarding first');

    const link = await stripe.accounts.createLoginLink(record.stripeAccountId);
    return { url: link.url };
  }

  // ─── WALLET ───────────────────────────────────────────────────────────────

  static async getBalance(userId) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record || !record.chargesEnabled) {
      return { availableCents: 0, pendingCents: 0, currency: 'usd', connected: false };
    }

    const balance = await stripe.balance.retrieve({}, { stripeAccount: record.stripeAccountId });

    const availableCents = balance.available.reduce((sum, b) => sum + b.amount, 0);
    const pendingCents = balance.pending.reduce((sum, b) => sum + b.amount, 0);

    return {
      availableCents,
      pendingCents,
      currency: balance.available[0]?.currency ?? 'usd',
      connected: true,
    };
  }

  // ─── EARNINGS FROM STRIPE ────────────────────────────────────────────────────

  // List transfers platform → connected account with expanded source_transaction
  // so callers can match payment_intent IDs back to DB records for categorization.
  static async listTransfers(userId, { startTs, endTs } = {}) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record?.chargesEnabled) return [];

    const params = {
      destination: record.stripeAccountId,
      limit: 100,
      expand: ['data.source_transaction'],
    };
    if (startTs || endTs) {
      params.created = {};
      if (startTs) params.created.gte = startTs;
      if (endTs) params.created.lte = endTs;
    }

    const all = [];
    let hasMore = true;
    let startingAfter;
    while (hasMore) {
      if (startingAfter) params.starting_after = startingAfter;
      const page = await stripe.transfers.list(params);
      all.push(...page.data);
      hasMore = page.has_more;
      if (hasMore) startingAfter = page.data[page.data.length - 1].id;
    }
    return all;
  }

  // Raw balance transactions on the connected account (for /wallet/transactions endpoint).
  static async listBalanceTransactions(userId, { startTs, endTs, type } = {}) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record?.chargesEnabled) return [];

    const params = { limit: 100 };
    if (startTs || endTs) {
      params.created = {};
      if (startTs) params.created.gte = startTs;
      if (endTs) params.created.lte = endTs;
    }
    if (type) params.type = type;

    const all = [];
    let hasMore = true;
    let startingAfter;
    while (hasMore) {
      if (startingAfter) params.starting_after = startingAfter;
      const page = await stripe.balanceTransactions.list(params, {
        stripeAccount: record.stripeAccountId,
      });
      all.push(...page.data);
      hasMore = page.has_more;
      if (hasMore) startingAfter = page.data[page.data.length - 1].id;
    }
    return all;
  }

  static async listPayouts(userId, { limit = 100 } = {}) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record?.payoutsEnabled) return { data: [], hasMore: false };

    const result = await stripe.payouts.list({ limit }, { stripeAccount: record.stripeAccountId });
    return { data: result.data, hasMore: result.has_more };
  }

  // ─── DETAILED TRANSACTION LIST ───────────────────────────────────────────────
  //
  // Queries platform-side transfers destined for the connected account and expands
  // source_transaction (the platform Charge) to surface a full fee breakdown:
  //
  //   grossCents       — what the customer was charged
  //   platformFeeCents — application_fee_amount kept by the platform
  //   stripeFeeCents   — Stripe processing fee (paid by platform, fees.payer=application)
  //   reservedCents    — explicitly reserved portion (= platformFee for event tickets)
  //   netCents         — amount actually transferred to the connected account
  //
  // type filter values: 'ticket' | 'talent_session' | 'priority_message' |
  //                     'group_subscription' | 'other'
  //
  // type    — filter by metadata.type  (ticket | talent_session | priority_message | group_subscription)
  // feature — filter by metadata.feature (same values; some charges only set one of the two)
  static async listDetailedTransactions(
    userId,
    { startTs, endTs, limit = 50, startingAfter, type, feature, groupId } = {}
  ) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record?.chargesEnabled) return { data: [], hasMore: false, cursor: null };

    const reserveRate = await getReserveRate();

    const params = {
      destination: record.stripeAccountId,
      limit: Math.min(limit, 100),
      expand: [
        'data.source_transaction',
        'data.source_transaction.balance_transaction',
        'data.source_transaction.invoice',
        'data.source_transaction.invoice.subscription',
      ],
    };

    if (startTs || endTs) {
      params.created = {};
      if (startTs) params.created.gte = startTs;
      if (endTs) params.created.lte = endTs;
    }
    if (startingAfter) params.starting_after = startingAfter;

    // Pre-load subscriber Stripe customer IDs for this group so we can match
    // py_ PaymentRecord charges (which have no invoice/metadata) by customer ID.
    let groupCustomerIds = null;
    if (groupId) {
      const subs = await db
        .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
        .from(groupSubscriptions)
        .innerJoin(stripeCustomers, eq(stripeCustomers.userId, groupSubscriptions.userId))
        .where(eq(groupSubscriptions.groupId, groupId));
      groupCustomerIds = new Set(subs.map(s => s.stripeCustomerId).filter(Boolean));
    }

    const page = await stripe.transfers.list(params);

    const TYPE_LABELS = {
      ticket: 'Event Ticket',
      talent_session: 'Session Booking',
      priority_message: 'Priority Message',
      group_subscription: 'Group Subscription',
      shop: 'Shop Sale',
    };

    let items = page.data.map(transfer => {
      const charge =
        transfer.source_transaction && typeof transfer.source_transaction === 'object'
          ? transfer.source_transaction
          : null;

      const invoiceObj =
        charge?.invoice && typeof charge.invoice === 'object' ? charge.invoice : null;
      const subObj =
        invoiceObj?.subscription && typeof invoiceObj.subscription === 'object'
          ? invoiceObj.subscription
          : null;
      const subMeta = subObj?.metadata ?? {};

      const grossCents = charge?.amount ?? 0;
      const platformFeeCents = charge?.application_fee_amount ?? 0;
      const balanceTxn =
        charge?.balance_transaction && typeof charge.balance_transaction === 'object'
          ? charge.balance_transaction
          : null;
      // Stripe's processing fee — paid by platform (fees.payer: 'application').
      // It is NOT deducted from the connected account; shown here for transparency.
      const stripeFeeCents = balanceTxn?.fee ?? 0;

      // transfer.amount is the GROSS amount sent to the connected account.
      // Stripe then reverses application_fee_amount back to the platform.
      // Connected account actually keeps: transfer.amount - application_fee_amount
      const transferredCents = transfer.amount;
      const netCents = transferredCents - platformFeeCents;

      // Refunds reduce what the connected account effectively keeps
      const refundCents = charge?.amount_refunded ?? 0;
      const finalNetCents = Math.max(0, netCents - refundCents);

      // py_ PaymentRecord charges (new Stripe API) have no invoice field and empty metadata.
      // Use description "Subscription creation/update" as a reliable fallback signal.
      const chargeCustomer = charge?.customer ?? null;
      const isSubDesc =
        typeof charge?.description === 'string' && charge.description.startsWith('Subscription');
      let txnType = charge?.metadata?.type ?? subMeta.type ?? null;
      if (!txnType && (charge?.invoice || isSubDesc)) txnType = 'group_subscription';
      if (!txnType) txnType = 'other';
      const txnFeature = charge?.metadata?.feature ?? subMeta.feature ?? txnType;

      return {
        id: transfer.id,
        type: txnType,
        feature: txnFeature,
        typeLabel: TYPE_LABELS[txnType] ?? 'Other',

        // ── Amounts in cents ────────────────────────────────────────────
        grossCents, // What the customer was charged
        platformFeeCents, // Application fee kept by platform
        stripeFeeCents, // Stripe processing fee (platform pays, not connected account)
        transferredCents, // Gross amount sent to connected account (before fee reversal)
        netCents, // What connected account actually keeps (transferred - platformFee)
        refundCents, // Total refunded back to customer
        finalNetCents, // Net after refunds

        // ── Dollar amounts (2 dp) ────────────────────────────────────────
        gross: +(grossCents / 100).toFixed(2),
        platformFee: +(platformFeeCents / 100).toFixed(2),
        stripeFee: +(stripeFeeCents / 100).toFixed(2),
        transferred: +(transferredCents / 100).toFixed(2),
        net: +(netCents / 100).toFixed(2),
        refund: +(refundCents / 100).toFixed(2),
        finalNet: +(finalNetCents / 100).toFixed(2),

        currency: transfer.currency,
        description: charge?.description ?? transfer.description ?? null,
        createdAt: transfer.created,

        // ── Status flags ─────────────────────────────────────────────────
        refunded: refundCents > 0,
        partiallyRefunded: refundCents > 0 && refundCents < grossCents,
        fullyRefunded: refundCents > 0 && refundCents >= grossCents,
        disputed: charge?.disputed ?? false,

        // ── Contextual identifiers ───────────────────────────────────────
        chargeId: charge?.id ?? null,
        chargeCustomer,
        paymentIntentId: typeof charge?.payment_intent === 'string' ? charge.payment_intent : null,
        customer: {
          stripeCustomerId: chargeCustomer,
          email: charge?.billing_details?.email ?? charge?.receipt_email ?? null,
          name: charge?.billing_details?.name ?? null,
          phone: charge?.billing_details?.phone ?? null,
        },
        metadata: { ...subMeta, ...charge?.metadata },
      };
    });

    // Server-side filters — Stripe transfers API has no metadata filter support.
    // type, feature, and groupId are derived from charge.metadata and filtered locally.
    if (type) {
      items = items.filter(t => t.type === type);
    }
    if (feature) {
      items = items.filter(t => t.feature === feature);
    }
    if (groupId) {
      items = items.filter(
        t =>
          t.metadata?.groupId === groupId ||
          (groupCustomerIds && t.chargeCustomer && groupCustomerIds.has(t.chargeCustomer))
      );
    }

    // Enrich items with reserve breakdown from DB (platformShare vs reserve split)
    const orderIds = items
      .filter(t => t.type === 'ticket' && t.metadata?.orderId)
      .map(t => t.metadata.orderId);
    const sessionIds = items
      .filter(t => t.type === 'talent_session' && t.metadata?.sessionId)
      .map(t => t.metadata.sessionId);

    const [orderRows, sessionRows] = await Promise.all([
      orderIds.length
        ? db
            .select({
              id: orders.id,
              platformShareCents: orders.platformShareCents,
              reserveAmountCents: orders.reserveAmountCents,
              reserveReleasedAt: orders.reserveReleasedAt,
            })
            .from(orders)
            .where(inArray(orders.id, orderIds))
        : [],
      sessionIds.length
        ? db
            .select({
              id: talentSessions.id,
              platformShareCents: talentSessions.platformShareCents,
              reserveAmountCents: talentSessions.reserveAmountCents,
              reserveReleasedAt: talentSessions.reserveReleasedAt,
            })
            .from(talentSessions)
            .where(inArray(talentSessions.id, sessionIds))
        : [],
    ]);

    const orderMap = new Map(orderRows.map(r => [r.id, r]));
    const sessionMap = new Map(sessionRows.map(r => [r.id, r]));

    const d2 = n => +(n / 100).toFixed(2);
    const pct = (n, total) => (total > 0 ? +((n / total) * 100).toFixed(2) : 0);

    const buildTypeBreakdown = (
      txnType,
      {
        grossCents,
        platformFeeCents,
        stripeFeeCents,
        netCents,
        platformShareCents,
        reserveAmountCents,
      }
    ) => {
      switch (txnType) {
        case 'ticket': {
          // application_fee = platformShare + reserve + estimatedStripeFee
          // stripeFeeCents (actual) is paid by platform, covered by the stripe portion of app_fee
          const pShare =
            platformShareCents ??
            Math.max(0, platformFeeCents - (reserveAmountCents ?? 0) - stripeFeeCents);
          const reserve = reserveAmountCents ?? 0;
          const eventualNet = netCents + reserve; // reserve returned after window
          return {
            platformShareCents: pShare,
            platformShare: d2(pShare),
            reserveCents: reserve,
            reserve: d2(reserve),
            stripeFeeCents,
            stripeFee: d2(stripeFeeCents),
            totalDeductedCents: pShare + reserve + stripeFeeCents,
            totalDeducted: d2(pShare + reserve + stripeFeeCents),
            netImmediateCents: netCents,
            netImmediate: d2(netCents),
            eventualNetCents: eventualNet,
            eventualNet: d2(eventualNet),
            platformSharePercent: pct(pShare, grossCents),
            reservePercent: pct(reserve, grossCents),
            stripeFeePercent: pct(stripeFeeCents, grossCents),
            netPercent: pct(eventualNet, grossCents),
          };
        }
        // Shop sales use identical fee math to bookings — 5% from the buyer,
        // 5% commission from the seller, Stripe borne by the seller — so they
        // share this breakdown rather than duplicating it.
        case 'shop':
        case 'talent_session': {
          // application_fee = 5% booking (from user) + 5% commission (from talent) + ~2.9% Stripe
          // Stripe pays from platform using stripe portion of app_fee; platform keeps the rest
          const platformRevenue = Math.max(0, platformFeeCents - stripeFeeCents);
          return {
            applicationFeeCents: platformFeeCents,
            applicationFee: d2(platformFeeCents),
            platformRevenueCents: platformRevenue,
            platformRevenue: d2(platformRevenue),
            stripeFeeCents,
            stripeFee: d2(stripeFeeCents),
            talentNetCents: netCents,
            talentNet: d2(netCents),
            applicationFeePercent: pct(platformFeeCents, grossCents),
            stripeFeePercent: pct(stripeFeeCents, grossCents),
            talentNetPercent: pct(netCents, grossCents),
          };
        }
        case 'priority_message': {
          // application_fee = stripeEstimate + 5% platformCommission
          // Talent gets: chargedCents − appFee ≈ baseCents × 0.95
          // Platform revenue: appFee − actual Stripe fee ≈ baseCents × 0.05
          const platformRevenue = Math.max(0, platformFeeCents - stripeFeeCents);
          return {
            applicationFeeCents: platformFeeCents,
            applicationFee: d2(platformFeeCents),
            stripeFeeCents,
            stripeFee: d2(stripeFeeCents),
            platformRevenueCents: platformRevenue,
            platformRevenue: d2(platformRevenue),
            talentNetCents: netCents,
            talentNet: d2(netCents),
            applicationFeePercent: pct(platformFeeCents, grossCents),
            stripeFeePercent: pct(stripeFeeCents, grossCents),
            platformRevenuePercent: pct(platformRevenue, grossCents),
            talentNetPercent: pct(netCents, grossCents),
          };
        }
        case 'group_subscription': {
          const platformRevenue = Math.max(0, platformFeeCents - stripeFeeCents);
          return {
            platformFeeCents,
            platformFee: d2(platformFeeCents),
            platformRevenueCents: platformRevenue,
            platformRevenue: d2(platformRevenue),
            stripeFeeCents,
            stripeFee: d2(stripeFeeCents),
            organizerNetCents: netCents,
            organizerNet: d2(netCents),
            platformFeePercent: pct(platformFeeCents, grossCents),
            stripeFeePercent: pct(stripeFeeCents, grossCents),
            netPercent: pct(netCents, grossCents),
          };
        }
        default: {
          return {
            platformFeeCents,
            platformFee: d2(platformFeeCents),
            stripeFeeCents,
            stripeFee: d2(stripeFeeCents),
            netCents,
            net: d2(netCents),
            platformFeePercent: pct(platformFeeCents, grossCents),
            stripeFeePercent: pct(stripeFeeCents, grossCents),
            netPercent: pct(netCents, grossCents),
          };
        }
      }
    };

    items = items.map(item => {
      let dbRow = null;
      if (item.type === 'ticket' && item.metadata?.orderId) {
        dbRow = orderMap.get(item.metadata.orderId) ?? null;
      } else if (item.type === 'talent_session' && item.metadata?.sessionId) {
        dbRow = sessionMap.get(item.metadata.sessionId) ?? null;
      }

      const platformShareCents = dbRow?.platformShareCents ?? null;
      const reserveAmountCents = dbRow?.reserveAmountCents ?? null;
      const reserveReleasedAt = dbRow?.reserveReleasedAt ?? null;
      // Stripe fee is now covered by organizer via application_fee — no extra deduction
      const eventualNetCents =
        reserveAmountCents !== null ? item.netCents + reserveAmountCents : null;

      const feeBreakdown = buildTypeBreakdown(item.type, {
        grossCents: item.grossCents,
        platformFeeCents: item.platformFeeCents,
        stripeFeeCents: item.stripeFeeCents,
        netCents: item.netCents,
        platformShareCents,
        reserveAmountCents,
      });

      return {
        ...item,
        platformShareCents,
        platformShare: platformShareCents !== null ? d2(platformShareCents) : null,
        reserveAmountCents,
        reserveAmount: reserveAmountCents !== null ? d2(reserveAmountCents) : null,
        reserveReleasedAt,
        reserveStatus: reserveAmountCents === null ? null : reserveReleasedAt ? 'released' : 'held',
        eventualNetCents,
        eventualNet: eventualNetCents !== null ? d2(eventualNetCents) : null,
        feeBreakdown,
      };
    });

    return {
      data: items,
      hasMore: page.has_more,
      cursor: page.data[page.data.length - 1]?.id ?? null,
      reserveRate,
    };
  }

  // ─── WALLET SUMMARY ──────────────────────────────────────────────────────────
  //
  // Aggregates all payment data for a connected account to produce the summary
  // view shown in the wallet dashboard:
  //
  //   gross           — total charged to customers (from charge.amount)
  //   refunds         — total refunded (from charge.amount_refunded)
  //   chargebacks     — total disputed + lost (from stripe.disputes, platform key)
  //   reserveReleased — gross − refunds − chargebacks (net that settled)
  //   platformFees    — total kept by platform (from charge.application_fee_amount)
  //   stripeFees      — total Stripe processing fees (from balance_transaction.fee)
  //   cashOutFee      — payout fees for instant cashouts (connected account btxns)
  //   netReleased     — reserveReleased − platformFees − cashOutFee
  //   byType[]        — same breakdown grouped by metadata.type
  //
  // NOTE: Because fees.payer = 'application' + losses.payments = 'application',
  // Stripe fees and dispute losses hit the PLATFORM balance, not the connected
  // account. Disputes are therefore fetched via the platform Stripe key.
  //
  static async getTransactionSummary(userId, { startTs, endTs, groupId } = {}) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);

    const empty = {
      grossCents: 0,
      gross: 0,
      refundsCents: 0,
      refunds: 0,
      chargebacksCents: 0,
      chargebacks: 0,
      reserveReleasedCents: 0,
      reserveReleased: 0,
      platformFeesCents: 0,
      platformFees: 0,
      stripeFeeCents: 0,
      stripeFees: 0,
      cashOutFeeCents: 0,
      cashOutFee: 0,
      netReleasedCents: 0,
      netReleased: 0,
      transactionCount: 0,
      byType: [],
      connected: false,
    };

    if (!record?.chargesEnabled) return empty;

    const reserveRate = await getReserveRate();

    // ── 1. All platform→connected transfers with charge + balance_transaction ──
    const transferParams = {
      destination: record.stripeAccountId,
      limit: 100,
      expand: [
        'data.source_transaction',
        'data.source_transaction.balance_transaction',
        'data.source_transaction.invoice',
        'data.source_transaction.invoice.subscription',
      ],
    };
    if (startTs || endTs) {
      transferParams.created = {};
      if (startTs) transferParams.created.gte = startTs;
      if (endTs) transferParams.created.lte = endTs;
    }

    const allTransfers = [];
    let hasMore = true;
    let startingAfter;
    while (hasMore) {
      if (startingAfter) transferParams.starting_after = startingAfter;
      const page = await stripe.transfers.list(transferParams);
      allTransfers.push(...page.data);
      hasMore = page.has_more;
      if (hasMore) startingAfter = page.data[page.data.length - 1].id;
    }

    // ── 2. Payout balance transactions on connected account (for cashout fees) ─
    const payoutBtxnParams = { type: 'payout', limit: 100 };
    if (startTs || endTs) {
      payoutBtxnParams.created = {};
      if (startTs) payoutBtxnParams.created.gte = startTs;
      if (endTs) payoutBtxnParams.created.lte = endTs;
    }
    const payoutBtxns = [];
    let payoutHasMore = true;
    let payoutCursor;
    while (payoutHasMore) {
      if (payoutCursor) payoutBtxnParams.starting_after = payoutCursor;
      const page = await stripe.balanceTransactions.list(payoutBtxnParams, {
        stripeAccount: record.stripeAccountId,
      });
      payoutBtxns.push(...page.data);
      payoutHasMore = page.has_more;
      if (payoutHasMore) payoutCursor = page.data[page.data.length - 1].id;
    }

    // ── 3. Fetch disputes for any disputed charges (platform key) ─────────────
    // With fees.payer=application + losses.payments=application, disputes are
    // debited from the platform balance — fetch via platform stripe key.
    const disputedChargeIds = allTransfers
      .filter(
        t =>
          t.source_transaction &&
          typeof t.source_transaction === 'object' &&
          t.source_transaction.disputed
      )
      .map(t => t.source_transaction.id);

    let chargebacksCents = 0;
    for (const chargeId of disputedChargeIds) {
      try {
        const disputes = await stripe.disputes.list({ charge: chargeId, limit: 10 });
        for (const d of disputes.data) {
          // Count disputes that resulted in or may result in a loss
          if (
            [
              'lost',
              'needs_response',
              'under_review',
              'warning_needs_response',
              'warning_under_review',
            ].includes(d.status)
          ) {
            chargebacksCents += d.amount;
          }
        }
      } catch (_) {
        /* non-fatal */
      }
    }

    // ── 3b. Optional groupId filter — applied before aggregation ──────────────
    // py_ PaymentRecord charges lack invoice/metadata — fall back to customer ID match.
    let summaryGroupCustomerIds = null;
    if (groupId) {
      const subs = await db
        .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
        .from(groupSubscriptions)
        .innerJoin(stripeCustomers, eq(stripeCustomers.userId, groupSubscriptions.userId))
        .where(eq(groupSubscriptions.groupId, groupId));
      summaryGroupCustomerIds = new Set(subs.map(s => s.stripeCustomerId).filter(Boolean));
    }

    const transfersToAggregate = groupId
      ? allTransfers.filter(t => {
          const charge =
            t.source_transaction && typeof t.source_transaction === 'object'
              ? t.source_transaction
              : null;
          if (charge?.metadata?.groupId) return charge.metadata.groupId === groupId;
          const invObj =
            charge?.invoice && typeof charge.invoice === 'object' ? charge.invoice : null;
          const subObj =
            invObj?.subscription && typeof invObj.subscription === 'object'
              ? invObj.subscription
              : null;
          if (subObj?.metadata?.groupId) return subObj.metadata.groupId === groupId;
          return !!(
            summaryGroupCustomerIds &&
            charge?.customer &&
            summaryGroupCustomerIds.has(charge.customer)
          );
        })
      : allTransfers;

    // ── 4. Aggregate by type ───────────────────────────────────────────────────
    const TYPE_LABELS = {
      ticket: 'Event Tickets',
      talent_session: 'Session Bookings',
      priority_message: 'Priority Messages',
      group_subscription: 'Group Subscriptions',
      shop: 'Shop Sales',
    };

    const byType = {};
    let grossCents = 0;
    let refundsCents = 0;
    let platformFeesCents = 0;
    let stripeFeeCents = 0;

    for (const transfer of transfersToAggregate) {
      const charge =
        transfer.source_transaction && typeof transfer.source_transaction === 'object'
          ? transfer.source_transaction
          : null;
      const balanceTxn =
        charge?.balance_transaction && typeof charge.balance_transaction === 'object'
          ? charge.balance_transaction
          : null;

      const txnGross = charge?.amount ?? transfer.amount;
      const txnRefund = charge?.amount_refunded ?? 0;
      const txnPlatformFee = charge?.application_fee_amount ?? 0;
      const txnStripeFee = balanceTxn?.fee ?? 0;

      grossCents += txnGross;
      refundsCents += txnRefund;
      platformFeesCents += txnPlatformFee;
      stripeFeeCents += txnStripeFee;

      const isSubDescSummary =
        typeof charge?.description === 'string' && charge.description.startsWith('Subscription');
      let txnType = charge?.metadata?.type ?? null;
      if (!txnType && (charge?.invoice || isSubDescSummary)) txnType = 'group_subscription';
      if (!txnType) txnType = 'other';

      if (!byType[txnType]) {
        byType[txnType] = {
          type: txnType,
          label: TYPE_LABELS[txnType] ?? 'Other',
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
      }
      const bucket = byType[txnType];
      bucket.count++;
      bucket.grossCents += txnGross;
      bucket.platformFeesCents += txnPlatformFee;
      bucket.stripeFeeCents += txnStripeFee;
      bucket.refundsCents += txnRefund;
      bucket.netCents += transfer.amount - txnPlatformFee;
    }

    // Finalise byType dollar values
    for (const t of Object.values(byType)) {
      t.gross = +(t.grossCents / 100).toFixed(2);
      t.platformFees = +(t.platformFeesCents / 100).toFixed(2);
      t.stripeFees = +(t.stripeFeeCents / 100).toFixed(2);
      t.refunds = +(t.refundsCents / 100).toFixed(2);
      t.net = +(t.netCents / 100).toFixed(2);
    }

    // Cash-out fees: instant payout fees appear as a fee on payout balance txns
    const cashOutFeeCents = payoutBtxns.reduce((sum, p) => sum + (p.fee ?? 0), 0);

    // Reserve Released = Gross - Refunds - Chargebacks (net settled amount)
    const reserveReleasedCents = Math.max(0, grossCents - refundsCents - chargebacksCents);
    // Net Released = what the user actually keeps after platform cuts + cashout fees
    const netReleasedCents = Math.max(
      0,
      reserveReleasedCents - platformFeesCents - cashOutFeeCents
    );

    return {
      grossCents,
      gross: +(grossCents / 100).toFixed(2),
      refundsCents,
      refunds: +(refundsCents / 100).toFixed(2),
      chargebacksCents,
      chargebacks: +(chargebacksCents / 100).toFixed(2),
      reserveReleasedCents,
      reserveReleased: +(reserveReleasedCents / 100).toFixed(2),
      platformFeesCents,
      platformFees: +(platformFeesCents / 100).toFixed(2),
      stripeFeeCents,
      stripeFees: +(stripeFeeCents / 100).toFixed(2),
      cashOutFeeCents,
      cashOutFee: +(cashOutFeeCents / 100).toFixed(2),
      netReleasedCents,
      netReleased: +(netReleasedCents / 100).toFixed(2),
      reserveRate,
      transactionCount: allTransfers.length,
      byType: Object.values(byType),
      connected: true,
    };
  }

  static async requestPayout(userId, amountCents, type = 'standard', metadata = {}) {
    ensureStripe();
    const record = await StripeConnectService.getForUser(userId);
    if (!record) throw new ApiError(404, 'No Stripe Connect account found');
    if (!record.payoutsEnabled)
      throw new ApiError(400, 'Payouts not enabled. Complete onboarding.');

    const balance = await stripe.balance.retrieve({}, { stripeAccount: record.stripeAccountId });
    const availableCents = balance.available.reduce((sum, b) => sum + b.amount, 0);
    if (amountCents > availableCents) {
      throw new ApiError(400, `Insufficient balance. Available: ${availableCents} cents`);
    }

    const payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: balance.available[0]?.currency ?? 'usd',
        method: type === 'instant' ? 'instant' : 'standard',
        metadata,
      },
      { stripeAccount: record.stripeAccountId }
    );

    return payout;
  }

  // ─── ADMIN: ALL PLATFORM TRANSFERS ───────────────────────────────────────────
  // Lists all transfers from the platform to any connected account.
  // Used by admin to see every payout made across all talents and organizers.
  // Stripe cursor pagination — pass cursor as startingAfter for next page.
  //
  // destination — filter by a specific stripeAccountId (acct_xxx)

  static async listAllPlatformTransfers({
    startTs,
    endTs,
    limit = 50,
    startingAfter,
    destination,
  } = {}) {
    ensureStripe();

    const params = { limit: Math.min(limit, 100) };

    if (startTs || endTs) {
      params.created = {};
      if (startTs) params.created.gte = startTs;
      if (endTs) params.created.lte = endTs;
    }
    if (startingAfter) params.starting_after = startingAfter;
    if (destination) params.destination = destination;

    const page = await stripe.transfers.list(params);

    const data = page.data.map(t => ({
      id: t.id,
      amountCents: t.amount,
      amount: +(t.amount / 100).toFixed(2),
      currency: t.currency,
      stripeAccountId:
        typeof t.destination === 'string' ? t.destination : (t.destination?.id ?? null),
      description: t.description ?? null,
      metadata: t.metadata ?? {},
      reversedCents: t.amount_reversed ?? 0,
      reversed: (t.amount_reversed ?? 0) > 0,
      createdAt: new Date(t.created * 1000).toISOString(),
      transferGroup: t.transfer_group ?? null,
    }));

    return {
      data,
      hasMore: page.has_more,
      cursor: page.data[page.data.length - 1]?.id ?? null,
    };
  }
}

// ─── PAYOUT METHODS ───────────────────────────────────────────────────────────

export class PayoutMethodService {
  static async list(userId) {
    return db.query.userPayoutMethods.findMany({
      where: eq(userPayoutMethods.userId, userId),
      columns: {
        id: true,
        type: true,
        label: true,
        accountHolderName: true,
        bankName: true,
        accountNumberLast4: true,
        routingNumberLast4: true,
        country: true,
        currency: true,
        isDefault: true,
        createdAt: true,
        // fullDetails excluded — never sent to client
      },
      orderBy: (m, { desc }) => [desc(m.isDefault), desc(m.createdAt)],
    });
  }

  static async add(
    userId,
    {
      type,
      label,
      accountHolderName,
      bankName,
      accountNumberLast4,
      routingNumberLast4,
      country,
      currency,
    }
  ) {
    const existing = await db.query.userPayoutMethods.findMany({
      where: eq(userPayoutMethods.userId, userId),
    });
    const isFirst = existing.length === 0;

    const [record] = await db
      .insert(userPayoutMethods)
      .values({
        userId,
        type,
        label,
        accountHolderName,
        bankName: bankName ?? null,
        accountNumberLast4: accountNumberLast4 ?? null,
        routingNumberLast4: routingNumberLast4 ?? null,
        country: country ?? 'US',
        currency: currency ?? 'USD',
        isDefault: isFirst,
      })
      .returning({
        id: userPayoutMethods.id,
        type: userPayoutMethods.type,
        label: userPayoutMethods.label,
        accountHolderName: userPayoutMethods.accountHolderName,
        bankName: userPayoutMethods.bankName,
        accountNumberLast4: userPayoutMethods.accountNumberLast4,
        routingNumberLast4: userPayoutMethods.routingNumberLast4,
        country: userPayoutMethods.country,
        currency: userPayoutMethods.currency,
        isDefault: userPayoutMethods.isDefault,
        createdAt: userPayoutMethods.createdAt,
      });

    return record;
  }

  static async setDefault(userId, methodId) {
    // Clear all defaults for user first
    await db
      .update(userPayoutMethods)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(userPayoutMethods.userId, userId));

    const [updated] = await db
      .update(userPayoutMethods)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(userPayoutMethods.id, methodId), eq(userPayoutMethods.userId, userId)))
      .returning({
        id: userPayoutMethods.id,
        label: userPayoutMethods.label,
        isDefault: userPayoutMethods.isDefault,
      });

    if (!updated) throw new ApiError(404, 'Payout method not found');
    return updated;
  }

  static async remove(userId, methodId) {
    const [deleted] = await db
      .delete(userPayoutMethods)
      .where(and(eq(userPayoutMethods.id, methodId), eq(userPayoutMethods.userId, userId)))
      .returning({ id: userPayoutMethods.id });

    if (!deleted) throw new ApiError(404, 'Payout method not found');

    // If deleted was default, auto-promote the most recent remaining method
    const remaining = await db.query.userPayoutMethods.findFirst({
      where: eq(userPayoutMethods.userId, userId),
      orderBy: (m, { desc }) => [desc(m.createdAt)],
    });
    if (remaining) {
      await db
        .update(userPayoutMethods)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(userPayoutMethods.id, remaining.id));
    }

    return deleted;
  }
}
