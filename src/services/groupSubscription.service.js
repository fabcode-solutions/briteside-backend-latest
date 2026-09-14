import Stripe from 'stripe';
import config from '../config/config.js';
import { StripeConnectService } from './stripeConnect.service.js';
import { db } from '../db/index.js';
import { eq, and, inArray, sql, desc, count } from 'drizzle-orm';
import { groups, groupMembers, users, groupJoinRequests } from '../db/schema/index.js';
import { groupSubscriptionTiers, groupSubscriptions } from '../db/schema/subscriptions.js';
import { stripeCustomers } from '../db/schema/britesidePlus.js';
import ApiError from '../utils/api-error.js';
import { SubscriptionService } from './subscription.service.js';
import { adminService } from './admin.service.js';
import { GroupDiscussionNotificationService } from './group.service.js';
import {
  sendPaidGroupSubscriptionEmail,
  sendGroupMembershipCancellationEmail,
  sendGroupPaymentFailedEmail,
  sendGroupFeeChangeEmail,
} from '../templates/index.js';
import { getUserInformation } from '../utils/helper.js';
import { requireGroupCreator } from '../utils/group-helpers.js';
import { UserSpendService } from './userSpend.service.js';

const ACTIVE_STATUSES = ['active', 'trialing'];

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!config.stripe?.secretKey) throw new ApiError(503, 'Stripe is not configured');
    _stripe = new Stripe(config.stripe.secretKey);
  }
  return _stripe;
}

// Flexible billing mode moves period dates to items[0]; top-level may be undefined
const resolveSubPeriod = sub => {
  const item = sub.items?.data?.[0];
  const start =
    sub.current_period_start ?? item?.current_period_start ?? sub.start_date ?? sub.created ?? null;
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  return {
    periodStart: start ? new Date(Number(start) * 1000) : null,
    periodEnd: end ? new Date(Number(end) * 1000) : null,
  };
};

export class GroupSubscriptionService {
  // ─────────────────────────────────────────────────────────────────
  // TIER MANAGEMENT  (group creator only)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a subscription tier for a private group.
   * Creates a Stripe Product + Price and persists the tier.
   */
  static async createTier(
    groupId,
    creatorId,
    { name, description, price, billingInterval = 'monthly', features, maxMembers }
  ) {
    await requireGroupCreator(
      groupId,
      creatorId,
      'Only the group creator can manage subscription tiers.'
    );

    const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!group) throw new ApiError(404, 'Group not found');
    if (!group.isPaid)
      throw new ApiError(400, 'Subscription tiers can only be created for paid groups.');

    const s = getStripe();

    const product = await s.products.create({
      name: `${group.name} — ${name}`,
      description: description ?? undefined,
      metadata: { groupId, creatorId },
    });

    const stripePrice = await s.prices.create({
      currency: 'usd',
      unit_amount: Math.round(parseFloat(price) * 100),
      recurring: { interval: billingInterval === 'yearly' ? 'year' : 'month' },
      product: product.id,
      metadata: { groupId },
    });

    const [tier] = await db
      .insert(groupSubscriptionTiers)
      .values({
        groupId,
        name,
        description,
        price: price.toString(),
        billingInterval,
        features,
        maxMembers,
        stripeProductId: product.id,
        stripePriceId: stripePrice.id,
      })
      .returning();

    return tier;
  }

  /**
   * Update a tier's metadata or price.
   * When price changes: archives the old Stripe Price, creates a new one,
   * and sends sendGroupFeeChangeEmail to all active subscribers.
   */
  static async updateTier(tierId, creatorId, updates) {
    const tier = await db.query.groupSubscriptionTiers.findFirst({
      where: eq(groupSubscriptionTiers.id, tierId),
    });
    if (!tier) throw new ApiError(404, 'Tier not found');

    await requireGroupCreator(tier.groupId, creatorId, 'Only the group creator can update tiers.');

    const { name, description, price, billingInterval, features, maxMembers } = updates;

    let newStripePriceId = tier.stripePriceId;
    const priceChanged = price !== undefined && parseFloat(price) !== parseFloat(tier.price);

    if (priceChanged) {
      const s = getStripe();

      await s.prices.update(tier.stripePriceId, { active: false });

      const newStripePrice = await s.prices.create({
        currency: 'usd',
        unit_amount: Math.round(parseFloat(price) * 100),
        recurring: {
          interval: (billingInterval ?? tier.billingInterval) === 'yearly' ? 'year' : 'month',
        },
        product: tier.stripeProductId,
        metadata: { groupId: tier.groupId },
      });
      newStripePriceId = newStripePrice.id;

      await this._notifyFeeChange(tier, price, billingInterval);
    }

    const [updated] = await db
      .update(groupSubscriptionTiers)
      .set({
        name: name ?? tier.name,
        description: description ?? tier.description,
        price: price?.toString() ?? tier.price,
        billingInterval: billingInterval ?? tier.billingInterval,
        features: features ?? tier.features,
        maxMembers: maxMembers ?? tier.maxMembers,
        stripePriceId: newStripePriceId,
        updatedAt: new Date(),
      })
      .where(eq(groupSubscriptionTiers.id, tierId))
      .returning();

    return updated;
  }

  /**
   * Deactivate a tier — archives the Stripe Price and marks the tier inactive.
   */
  static async deactivateTier(tierId, creatorId) {
    const tier = await db.query.groupSubscriptionTiers.findFirst({
      where: eq(groupSubscriptionTiers.id, tierId),
    });
    if (!tier) throw new ApiError(404, 'Tier not found');

    await requireGroupCreator(
      tier.groupId,
      creatorId,
      'Only the group creator can deactivate tiers.'
    );

    const s = getStripe();
    if (tier.stripePriceId) {
      await s.prices
        .update(tier.stripePriceId, { active: false })
        .catch(err => console.error('Stripe price archive failed:', err.message));
    }

    const [updated] = await db
      .update(groupSubscriptionTiers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(groupSubscriptionTiers.id, tierId))
      .returning();

    return updated;
  }

  /**
   * List active tiers for a group.
   */
  static async getTiers(groupId) {
    return db.query.groupSubscriptionTiers.findMany({
      where: and(
        eq(groupSubscriptionTiers.groupId, groupId),
        eq(groupSubscriptionTiers.isActive, true)
      ),
      orderBy: groupSubscriptionTiers.price,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // USER CHECKOUT + SUBSCRIPTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout Session for a group subscription tier.
   * Embeds metadata.type = 'group_subscription' so the webhook can route correctly.
   */
  static async createCheckoutSession(userId, tierId, successUrl, cancelUrl) {
    const tier = await db.query.groupSubscriptionTiers.findFirst({
      where: and(eq(groupSubscriptionTiers.id, tierId), eq(groupSubscriptionTiers.isActive, true)),
    });
    if (!tier) throw new ApiError(404, 'Subscription tier not found or inactive');

    const group = await db.query.groups.findFirst({ where: eq(groups.id, tier.groupId) });
    if (!group) throw new ApiError(404, 'Group not found');
    if (!group.isPaid) throw new ApiError(400, 'This group does not require a subscription');

    const existing = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.userId, userId),
        eq(groupSubscriptions.groupId, tier.groupId),
        inArray(groupSubscriptions.status, [...ACTIVE_STATUSES, 'past_due'])
      ),
    });
    if (existing) throw new ApiError(409, 'You already have an active subscription for this group');

    const { percentage: platformFeePercent } = await adminService.getPlatformFeePercentage();
    let [stripeCustomerId, organizerConnect] = await Promise.all([
      SubscriptionService.getOrCreateStripeCustomer(userId),
      StripeConnectService.getForUser(group.createdBy).catch(() => null),
    ]);
    // Self-heal: chargesEnabled only updates via webhook or the organizer
    // visiting their earnings page — if it's stale-false, re-check Stripe live
    // rather than silently routing this subscription's full amount to platform.
    if (organizerConnect && !organizerConnect.chargesEnabled) {
      organizerConnect = await StripeConnectService.syncStatus(group.createdBy).catch(
        () => organizerConnect
      );
    }
    const s = getStripe();

    const subscriptionData = {
      metadata: {
        type: 'group_subscription',
        userId,
        groupId: tier.groupId,
        tierId: tier.id,
        organizerId: group.createdBy,
        platformFeePercent: String(platformFeePercent),
      },
    };

    if (organizerConnect?.chargesEnabled) {
      subscriptionData.application_fee_percent = 5;
      subscriptionData.transfer_data = { destination: organizerConnect.stripeAccountId };
    }

    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: tier.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'group_subscription',
        userId,
        groupId: tier.groupId,
        tierId: tier.id,
        organizerId: group.createdBy,
        platformFeePercent: String(platformFeePercent),
      },
      subscription_data: subscriptionData,
    });

    return { sessionId: session.id, url: session.url };
  }

  /**
   * Get a user's active subscription for a specific group.
   * Syncs live status from Stripe on every call and handles post-checkout race conditions.
   */
  static async getMyGroupSubscription(userId, groupId) {
    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.userId, userId),
        eq(groupSubscriptions.groupId, groupId),
        inArray(groupSubscriptions.status, [...ACTIVE_STATUSES, 'past_due'])
      ),
      with: { tier: true },
    });

    let s;
    try {
      s = getStripe();
    } catch {
      return subscription ?? null;
    }

    // DB record found — sync live state from Stripe
    if (subscription?.stripeSubscriptionId) {
      try {
        const stripeSub = await s.subscriptions.retrieve(subscription.stripeSubscriptionId);
        const { periodStart: _ps, periodEnd: _pe } = resolveSubPeriod(stripeSub);
        const updates = {
          status: stripeSub.status,
          currentPeriodStart: _ps,
          currentPeriodEnd: _pe,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
          updatedAt: new Date(),
        };
        await db
          .update(groupSubscriptions)
          .set(updates)
          .where(eq(groupSubscriptions.id, subscription.id));
        Object.assign(subscription, updates);
      } catch (err) {
        console.error(
          '[GroupSubscription] Stripe sync failed, returning cached data:',
          err.message
        );
      }
      return subscription;
    }

    // No DB record — post-checkout race: find matching active sub on Stripe
    if (!subscription) {
      const customerRow = await db.query.stripeCustomers.findFirst({
        where: eq(stripeCustomers.userId, userId),
      });
      if (!customerRow) return null;

      const list = await s.subscriptions.list({
        customer: customerRow.stripeCustomerId,
        status: 'active',
        limit: 10,
      });
      const stripeSub = list.data.find(
        sub => sub.metadata?.groupId === groupId && sub.metadata?.type === 'group_subscription'
      );
      if (!stripeSub?.metadata?.tierId) return null;

      // Replay checkout handler to create the DB record (idempotent insert)
      await this.handleCheckoutCompleted({
        id: `sync_${stripeSub.id}`,
        subscription: stripeSub.id,
        metadata: stripeSub.metadata,
      });

      return db.query.groupSubscriptions.findFirst({
        where: and(
          eq(groupSubscriptions.userId, userId),
          eq(groupSubscriptions.groupId, groupId),
          inArray(groupSubscriptions.status, [...ACTIVE_STATUSES, 'past_due'])
        ),
        with: { tier: true },
      });
    }

    return subscription;
  }

  static async getGroupSubscriptionsForAdmin(groupId) {
    const [tiers, subscriptions, statusCounts] = await Promise.all([
      db.query.groupSubscriptionTiers.findMany({
        where: eq(groupSubscriptionTiers.groupId, groupId),
        orderBy: groupSubscriptionTiers.price,
      }),
      db.query.groupSubscriptions.findMany({
        where: eq(groupSubscriptions.groupId, groupId),
        orderBy: [desc(groupSubscriptions.createdAt)],
        with: {
          tier: { columns: { id: true, name: true, price: true, billingInterval: true } },
          user: {
            columns: { id: true, firstName: true, lastName: true, email: true, profileImage: true },
          },
        },
      }),
      db
        .select({ status: groupSubscriptions.status, total: count() })
        .from(groupSubscriptions)
        .where(eq(groupSubscriptions.groupId, groupId))
        .groupBy(groupSubscriptions.status),
    ]);

    const activeSubs = subscriptions.filter(s => ACTIVE_STATUSES.includes(s.status));
    const mrr = activeSubs.reduce((sum, s) => {
      const price = parseFloat(s.tier?.price ?? 0);
      const monthly = s.tier?.billingInterval === 'yearly' ? price / 12 : price;
      return sum + monthly;
    }, 0);

    return {
      tiers,
      subscriptions,
      summary: {
        totalSubscriptions: subscriptions.length,
        activeCount: activeSubs.length,
        mrr: Number(mrr.toFixed(2)),
        byStatus: statusCounts,
      },
    };
  }

  /**
   * Cancel a group subscription at period end.
   */
  static async cancelGroupSubscription(userId, groupId) {
    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.userId, userId),
        eq(groupSubscriptions.groupId, groupId),
        inArray(groupSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: { tier: true },
    });
    if (!subscription) throw new ApiError(404, 'No active subscription found for this group');

    if (subscription.cancelAtPeriodEnd) {
      throw new ApiError(400, 'Subscription is already set to cancel at period end');
    }

    const s = getStripe();
    try {
      await s.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await db
        .update(groupSubscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(groupSubscriptions.id, subscription.id));

      this._sendCancellationEmail(userId, groupId, subscription).catch(err =>
        console.error('Cancellation email failed:', err.message)
      );

      return { cancelled: true, accessUntil: subscription.currentPeriodEnd };
    } catch (err) {
      console.error('Stripe cancellation failed:', err);
      throw new ApiError(500, `Failed to cancel subscription: ${err.message}`);
    }
  }

  /**
   * Immediately cancel, issue a refund on the latest invoice, and remove user from the group.
   */
static async refundGroupSubscription(userId, groupId) {
  const subscription = await db.query.groupSubscriptions.findFirst({
    where: and(
      eq(groupSubscriptions.userId, userId),
      eq(groupSubscriptions.groupId, groupId),
      inArray(groupSubscriptions.status, [...ACTIVE_STATUSES, 'past_due'])
    ),
    with: { tier: true },
  });
  if (!subscription) throw new ApiError(404, 'No active subscription found for this group');

  const s = getStripe();
  try {
    const stripeSub = await s.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const invoice = await s.invoices.retrieve(stripeSub.latest_invoice);

    if (!invoice) throw new ApiError(400, 'No invoice found to refund');

    let refund = null;
    let refundProcessed = false;

    if (invoice.status === 'paid') {
      // Find the charge that matches this invoice by amount and timestamp
      const charges = await s.charges.list({
        customer: stripeSub.customer,
        limit: 10,
      });

      const invoicePaidTime = invoice.status_transitions?.paid_at;
      const matchingCharge = charges.data.find(charge => {
        const amountMatches = charge.amount === invoice.amount_paid;
        const timeMatches = !invoicePaidTime || Math.abs(charge.created - invoicePaidTime) < 60;
        const isSucceeded = charge.status === 'succeeded';
        return amountMatches && timeMatches && isSucceeded;
      });

      if (matchingCharge) {
        if (matchingCharge.payment_intent) {
          refund = await s.refunds.create({
            payment_intent: matchingCharge.payment_intent,
            reason: 'requested_by_customer',
          });
          refundProcessed = true;
        } else {
          refund = await s.refunds.create({
            charge: matchingCharge.id,
            reason: 'requested_by_customer',
          });
          refundProcessed = true;
        }
      } else {
        console.warn(
          `No charge found for invoice ${invoice.id}. ` +
          `Cancelling subscription without refund.`
        );
      }

      if (refundProcessed && (!refund || (refund.status !== 'succeeded' && refund.status !== 'pending'))) {
        throw new ApiError(500, `Refund failed with status: ${refund?.status ?? 'unknown'}`);
      }
    } else if (invoice.status === 'draft' || invoice.status === 'open') {
      console.log(`Invoice ${invoice.id} status is ${invoice.status}, cancelling without refund`);
    } else {
      throw new ApiError(400, `Cannot process refund for invoice with status: ${invoice.status}`);
    }

    await s.subscriptions.cancel(subscription.stripeSubscriptionId);

    await db
      .update(groupSubscriptions)
      .set({
        status: 'cancelled',
        cancelAtPeriodEnd: false,
        refundId: refund?.id ?? null,
        refundStatus: refund?.status ?? 'no_refund',
        refundAmount: refund?.amount ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(groupSubscriptions.id, subscription.id));

    if (refundProcessed && refund) {
      await UserSpendService.markSpendRefunded({
        userId,
        referenceId: subscription.id,
        referenceType: 'group_subscription',
        spendType: 'group_subscription',
        refundMeta: {
          source: 'group_subscription_user_refund',
          stripeRefundId: refund.id,
          refundStatus: refund.status,
          refundedAmountCents: refund.amount,
          groupId,
        },
      });
    }

    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

    GroupDiscussionNotificationService.unsubscribe(groupId, userId).catch(() => {});

    this._sendCancellationEmail(userId, groupId, subscription, refundProcessed).catch(err =>
      console.error('Refund cancellation email failed:', err.message)
    );

    return {
      refunded: refundProcessed,
      refundId: refund?.id ?? null,
      refundStatus: refund?.status ?? 'no_refund',
      refundAmount: refund?.amount ?? 0,
      message: refundProcessed 
        ? 'Subscription cancelled and refunded' 
        : 'Subscription cancelled (no payment to refund)',
    };
  } catch (err) {
    console.error('Refund process failed:', err);
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, `Refund failed: ${err.message}`);
  }
}

  /**
   * Open the Stripe Customer Portal — reuses the shared stripeCustomers record.
   */
  static async getCustomerPortalSession(userId, returnUrl) {
    return SubscriptionService.getCustomerPortalSession(userId, returnUrl);
  }

  // ─────────────────────────────────────────────────────────────────
  // WEBHOOK HANDLERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * checkout.session.completed — metadata.type === 'group_subscription'
   * Persists groupSubscriptions row, adds user to groupMembers, sends welcome email.
   */
  static async handleCheckoutCompleted(session) {
    const { userId, groupId, tierId, platformFeePercent } = session.metadata ?? {};
    console.log('GroupSubscriptionService.handleCheckoutCompleted called', {
      sessionId: session.id,
      subscriptionId: session.subscription,
      metadata: session.metadata,
    });
    if (!userId || !groupId || !tierId) {
      console.error(
        'Group subscription checkout: missing metadata on session',
        session.id,
        session.metadata
      );
      return;
    }

    const s = getStripe();
    const stripeSub = await s.subscriptions.retrieve(session.subscription);
    console.log('Retrieved Stripe subscription for group checkout', {
      subscriptionId: stripeSub.id,
      status: stripeSub.status,
      current_period_start: stripeSub.current_period_start,
      current_period_end: stripeSub.current_period_end,
      start_date: stripeSub.start_date,
      created: stripeSub.created,
    });

    const { periodStart: checkoutPeriodStart, periodEnd: checkoutPeriodEnd } =
      resolveSubPeriod(stripeSub);

    const [dbSub] = await db
      .insert(groupSubscriptions)
      .values({
        userId,
        groupId,
        tierId,
        status: 'active',
        stripeSubscriptionId: session.subscription,
        currentPeriodStart: checkoutPeriodStart,
        currentPeriodEnd: checkoutPeriodEnd,
        cancelAtPeriodEnd: false,
        platformFeePercent: platformFeePercent ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!dbSub) return; // idempotency guard

    // Record spend — fetch tier + group for metadata
    try {
      const [tier, group] = await Promise.all([
        db.query.groupSubscriptionTiers.findFirst({
          where: eq(groupSubscriptionTiers.id, tierId),
          columns: { name: true, price: true, billingInterval: true },
        }),
        db.query.groups.findFirst({
          where: eq(groups.id, groupId),
          columns: { name: true },
        }),
      ]);
      await UserSpendService.recordSpend({
        userId,
        spendType: 'group_subscription',
        amountCents: tier ? Math.round(parseFloat(tier.price) * 100) : 0,
        referenceId: dbSub.id,
        referenceType: 'group_subscription',
        groupId,
        metadata: {
          groupName: group?.name ?? null,
          tierName: tier?.name ?? null,
          billingInterval: tier?.billingInterval ?? null,
          periodStart: dbSub.currentPeriodStart?.toISOString() ?? null,
          periodEnd: dbSub.currentPeriodEnd?.toISOString() ?? null,
        },
        stripeSessionId: session.id,
        paidAt: new Date(),
      });
    } catch (spendErr) {
      console.error('[UserSpend] group_subscription record failed:', spendErr.message);
    }

    const existing = await db.query.groupMembers.findFirst({
      where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    });

    if (!existing) {
      await db.insert(groupMembers).values({
        groupId,
        userId,
        role: 'member',
        status: 'joined',
        joinedAt: new Date(),
      });

      await db
        .update(groups)
        .set({ memberCount: sql`${groups.memberCount} + 1` })
        .where(eq(groups.id, groupId))
        .catch(err => console.error('Member count increment failed:', err.message));

      GroupDiscussionNotificationService.subscribe(groupId, userId).catch(() => {});
    }

    // Resolve any pending join request (created when user answered questions before checkout)
    await db
      .update(groupJoinRequests)
      .set({ status: 'approved', is_completed: true, respondedAt: new Date() })
      .where(
        and(
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.userId, userId),
          eq(groupJoinRequests.status, 'pending')
        )
      )
      .catch(err =>
        console.error('Failed to resolve pending join request after checkout:', err.message)
      );

    this._sendWelcomeEmail(userId, groupId, tierId, stripeSub).catch(err =>
      console.error('Subscription welcome email failed:', err.message)
    );
  }

  /**
   * customer.subscription.updated — sync period dates and status.
   */
  static async handleSubscriptionUpdated(subscription) {
    if (subscription.metadata?.type !== 'group_subscription') return;

    let { periodStart, periodEnd } = resolveSubPeriod(subscription);

    // Stripe sometimes omits current_period_end in the webhook payload (e.g. on cancel_at_period_end).
    // Fall back to a full retrieve so currentPeriodEnd is never lost.
    if (!periodEnd && subscription.id) {
      try {
        const full = await getStripe().subscriptions.retrieve(subscription.id);
        const resolved = resolveSubPeriod(full);
        periodEnd = resolved.periodEnd;
        if (!periodStart) periodStart = resolved.periodStart;
      } catch (err) {
        console.error(
          '[GroupSub] Failed to retrieve full subscription for period end:',
          err.message
        );
      }
    }

    await db
      .update(groupSubscriptions)
      .set({
        status: subscription.status,
        currentPeriodStart: periodStart ?? null,
        currentPeriodEnd: periodEnd ?? null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        updatedAt: new Date(),
      })
      .where(eq(groupSubscriptions.stripeSubscriptionId, subscription.id));
  }

  /**
   * customer.subscription.deleted — mark cancelled and remove user from group.
   */
  static async handleSubscriptionDeleted(subscription) {
    if (subscription.metadata?.type !== 'group_subscription') return;

    const [dbSub] = await db
      .update(groupSubscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(groupSubscriptions.stripeSubscriptionId, subscription.id))
      .returning();

    if (!dbSub) return;

    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, dbSub.groupId), eq(groupMembers.userId, dbSub.userId)));

    GroupDiscussionNotificationService.unsubscribe(dbSub.groupId, dbSub.userId).catch(() => {});

    this._sendCancellationEmail(dbSub.userId, dbSub.groupId, dbSub, true).catch(err =>
      console.error('Subscription deleted email failed:', err.message)
    );
  }

  /**
   * invoice.payment_failed — mark subscription past_due and send payment failure email.
   * If Stripe already cancelled the subscription (all retries exhausted), reject any
   * pending join request so the user isn't stuck in a limbo state.
   */
  static async handleInvoicePaymentFailed(invoice) {
    if (!invoice.subscription) return;

    const dbSub = await db.query.groupSubscriptions.findFirst({
      where: eq(groupSubscriptions.stripeSubscriptionId, invoice.subscription),
      with: { tier: true },
    });
    if (!dbSub) return;

    // Retrieve the live subscription to check its current status
    let stripeSubStatus = null;
    try {
      const s = getStripe();
      const stripeSub = await s.subscriptions.retrieve(invoice.subscription);
      stripeSubStatus = stripeSub.status;
    } catch (err) {
      console.error(
        '[GroupSub] Failed to retrieve subscription status on payment failure:',
        err.message
      );
    }

    await db
      .update(groupSubscriptions)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(groupSubscriptions.id, dbSub.id));

    // If Stripe cancelled the subscription after exhausting retries, reject any pending join request
    if (stripeSubStatus === 'canceled' || stripeSubStatus === 'unpaid') {
      await this._rejectPendingJoinRequest(
        dbSub.groupId,
        dbSub.userId,
        'All payment retries exhausted'
      );
    }

    const [user, group] = await Promise.all([
      getUserInformation(dbSub.userId),
      db.query.groups.findFirst({ where: eq(groups.id, dbSub.groupId), columns: { name: true } }),
    ]).catch(() => [null, null]);

    if (!user || !group) return;

    await sendGroupPaymentFailedEmail(user.email, {
      user_name: `${user.firstName} ${user.lastName}`,
      group_name: group.name,
      membership_price: `$${parseFloat(dbSub.tier.price).toFixed(2)}`,
      payment_method_last4: '****',
      failed_date: new Date(invoice.created * 1000).toLocaleDateString(),
      next_retry_date: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
        : 'N/A',
      max_retries: '3',
      suspension_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    }).catch(err => console.error('Payment failed email error:', err.message));
  }

  /**
   * invoice.paid — stamps charge + payment_intent metadata with groupId/type so that
   * listDetailedTransactions can filter by metadata without expanding the invoice chain.
   * Subscription renewal charges have empty metadata — this backfills them.
   */
  static async handleInvoicePaid(invoice) {
    if (!invoice.subscription) return;
    const s = getStripe();
    const sub = await s.subscriptions.retrieve(invoice.subscription);
    const { groupId, tierId, userId } = sub.metadata ?? {};
    if (!groupId) return;

    const meta = {
      type: 'group_subscription',
      groupId,
      tierId: tierId ?? '',
      userId: userId ?? '',
    };
    const tasks = [];
    if (invoice.charge)
      tasks.push(s.charges.update(invoice.charge, { metadata: meta }).catch(() => {}));
    if (invoice.payment_intent && typeof invoice.payment_intent === 'string') {
      tasks.push(
        s.paymentIntents.update(invoice.payment_intent, { metadata: meta }).catch(() => {})
      );
    }
    await Promise.all(tasks);
  }

  /**
   * checkout.session.expired — metadata.type === 'group_subscription'
   * Rejects any pending join request so the user doesn't stay in limbo.
   */
  static async handleCheckoutExpired(session) {
    const { userId, groupId } = session.metadata ?? {};
    if (!userId || !groupId) return;
    await this._rejectPendingJoinRequest(
      groupId,
      userId,
      'Payment not completed — checkout expired'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Rejects a pending join request for the given user+group, if one exists.
   */
  static async _rejectPendingJoinRequest(groupId, userId, reason = 'Payment failed') {
    await db
      .update(groupJoinRequests)
      .set({ status: 'rejected', is_completed: true, respondedAt: new Date() })
      .where(
        and(
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.userId, userId),
          eq(groupJoinRequests.status, 'pending')
        )
      )
      .catch(err =>
        console.error(`Failed to reject pending join request (${reason}):`, err.message)
      );
  }

  static async _sendWelcomeEmail(userId, groupId, tierId, stripeSub) {
    const [user, group, tier] = await Promise.all([
      getUserInformation(userId),
      db.query.groups.findFirst({
        where: eq(groups.id, groupId),
        columns: { name: true, createdBy: true },
      }),
      db.query.groupSubscriptionTiers.findFirst({
        where: eq(groupSubscriptionTiers.id, tierId),
        columns: { price: true },
      }),
    ]);

    const organizer = await getUserInformation(group.createdBy);

    await sendPaidGroupSubscriptionEmail(user.email, {
      user_name: `${user.firstName} ${user.lastName}`,
      group_name: group.name,
      organizer_name: `${organizer.firstName} ${organizer.lastName}`,
      membership_price: `$${parseFloat(tier.price).toFixed(2)}`,
      next_billing_date: (resolveSubPeriod(stripeSub).periodEnd ?? new Date()).toLocaleDateString(),
    });
  }

  static async _sendCancellationEmail(userId, groupId, subscription, immediate = false) {
    const [user, group] = await Promise.all([
      getUserInformation(userId),
      db.query.groups.findFirst({ where: eq(groups.id, groupId), columns: { name: true } }),
    ]);

    const tierPrice = subscription.tier?.price ?? subscription.tierPrice ?? '0';
    const accessEndDate = immediate
      ? new Date().toLocaleDateString()
      : (subscription.currentPeriodEnd?.toLocaleDateString() ?? 'end of period');

    await sendGroupMembershipCancellationEmail(user.email, {
      user_name: `${user.firstName} ${user.lastName}`,
      group_name: group.name,
      access_end_date: accessEndDate,
      final_charge: `$${parseFloat(tierPrice).toFixed(2)}`,
    });
  }

  static async _notifyFeeChange(tier, newPrice, billingInterval) {
    const activeSubscriptions = await db
      .select({ userId: groupSubscriptions.userId })
      .from(groupSubscriptions)
      .where(
        and(
          eq(groupSubscriptions.tierId, tier.id),
          inArray(groupSubscriptions.status, ACTIVE_STATUSES)
        )
      );

    if (!activeSubscriptions.length) return;

    const group = await db.query.groups.findFirst({
      where: eq(groups.id, tier.groupId),
      columns: { name: true },
    });

    const oldFee = parseFloat(tier.price);
    const newFee = parseFloat(newPrice);
    const isIncrease = newFee > oldFee;
    const changePercentage =
      oldFee > 0 ? Math.abs(((newFee - oldFee) / oldFee) * 100).toFixed(1) : '0';
    const effectiveDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();

    for (const sub of activeSubscriptions) {
      const user = await getUserInformation(sub.userId).catch(() => null);
      if (!user) continue;

      await sendGroupFeeChangeEmail(user.email, {
        user_name: `${user.firstName} ${user.lastName}`,
        group_name: group.name,
        effective_date: effectiveDate,
        old_fee: `$${oldFee.toFixed(2)}`,
        new_fee: `$${newFee.toFixed(2)}`,
        billing_cycle: billingInterval ?? tier.billingInterval,
        is_price_increase: isIncrease,
        change_percentage: `${changePercentage}%`,
      }).catch(err =>
        console.error(`Fee change email failed for user ${sub.userId}:`, err.message)
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────
  // CREATOR ADMIN — MEMBER SUBSCRIPTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all subscriptions for a group (creator only).
   * Supports pagination and optional status filter.
   */
  static async listGroupMemberSubscriptions(
    groupId,
    creatorId,
    { page = 1, limit = 20, status } = {}
  ) {
    await requireGroupCreator(
      groupId,
      creatorId,
      'Only the group creator can view member subscriptions.'
    );

    const offset = (page - 1) * limit;
    const conditions = [eq(groupSubscriptions.groupId, groupId)];
    if (status) conditions.push(eq(groupSubscriptions.status, status));
    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(groupSubscriptions)
      .where(whereClause);

    const rows = await db.query.groupSubscriptions.findMany({
      where: whereClause,
      orderBy: [desc(groupSubscriptions.createdAt)],
      limit,
      offset,
      with: {
        tier: { columns: { id: true, name: true, price: true, billingInterval: true } },
        user: {
          columns: { id: true, firstName: true, lastName: true, email: true, profileImage: true },
        },
      },
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    };
  }

  /**
   * Get a single member's subscription detail for a group (creator only).
   */
  static async getGroupMemberSubscription(groupId, targetUserId, creatorId) {
    await requireGroupCreator(
      groupId,
      creatorId,
      'Only the group creator can view member subscriptions.'
    );

    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.groupId, groupId),
        eq(groupSubscriptions.userId, targetUserId)
      ),
      with: {
        tier: true,
        user: {
          columns: { id: true, firstName: true, lastName: true, email: true, profileImage: true },
        },
      },
    });

    if (!subscription) throw new ApiError(404, 'No subscription found for this member');
    return subscription;
  }

  /**
   * Cancel a member's subscription at period end (creator only).
   */
  static async adminCancelMemberSubscription(groupId, targetUserId, creatorId) {
    await requireGroupCreator(
      groupId,
      creatorId,
      'Only the group creator can cancel member subscriptions.'
    );

    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.userId, targetUserId),
        eq(groupSubscriptions.groupId, groupId),
        inArray(groupSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: { tier: true },
    });
    if (!subscription) throw new ApiError(404, 'No active subscription found for this member');

    if (subscription.cancelAtPeriodEnd) {
      throw new ApiError(400, 'Subscription is already set to cancel at period end');
    }

    const s = getStripe();
    try {
      await s.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await db
        .update(groupSubscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(groupSubscriptions.id, subscription.id));

      this._sendCancellationEmail(targetUserId, groupId, subscription).catch(err =>
        console.error('Admin cancel email failed:', err.message)
      );

      return { cancelled: true, accessUntil: subscription.currentPeriodEnd };
    } catch (err) {
      console.error('Stripe admin cancellation failed:', err);
      throw new ApiError(500, `Failed to cancel subscription: ${err.message}`);
    }
  }

  /**
   * Immediately cancel and refund a member's subscription (creator only).
   */
  static async adminRefundMemberSubscription(groupId, targetUserId, creatorId) {
    await requireGroupCreator(
      groupId,
      creatorId,
      'Only the group creator can refund member subscriptions.'
    );

    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(
        eq(groupSubscriptions.userId, targetUserId),
        eq(groupSubscriptions.groupId, groupId),
        inArray(groupSubscriptions.status, [...ACTIVE_STATUSES, 'past_due'])
      ),
      with: { tier: true },
    });
    if (!subscription) throw new ApiError(404, 'No active subscription found for this member');

    const s = getStripe();
    try {
      const stripeSub = await s.subscriptions.retrieve(subscription.stripeSubscriptionId, {
        expand: ['latest_invoice.payment_intent', 'latest_invoice.charge'],
      });

      const invoice = stripeSub.latest_invoice;
      if (!invoice) throw new ApiError(400, 'No invoice found to refund');

      let refund = null;
      if (invoice.status === 'paid') {
        if (invoice.payment_intent?.id) {
          refund = await s.refunds.create({
            payment_intent: invoice.payment_intent.id,
            reason: 'requested_by_customer',
          });
        } else if (invoice.charge?.id) {
          refund = await s.refunds.create({
            charge: invoice.charge.id,
            reason: 'requested_by_customer',
          });
        } else {
          throw new ApiError(400, 'Invoice has no refundable payment method');
        }
      } else {
        throw new ApiError(400, `Cannot refund invoice with status: ${invoice.status}`);
      }

      if (!refund || (refund.status !== 'succeeded' && refund.status !== 'pending')) {
        throw new ApiError(500, `Refund failed with status: ${refund?.status ?? 'unknown'}`);
      }

      // Only cancel the subscription after a successful refund
      await s.subscriptions.cancel(subscription.stripeSubscriptionId);

      await db
        .update(groupSubscriptions)
        .set({
          status: 'cancelled',
          cancelAtPeriodEnd: false,
          refundId: refund.id,
          refundStatus: refund.status,
          refundAmount: refund.amount,
          updatedAt: new Date(),
        })
        .where(eq(groupSubscriptions.id, subscription.id));

      await UserSpendService.markSpendRefunded({
        userId: targetUserId,
        referenceId: subscription.id,
        referenceType: 'group_subscription',
        spendType: 'group_subscription',
        refundMeta: {
          source: 'group_subscription_admin_refund',
          stripeRefundId: refund.id,
          refundStatus: refund.status,
          refundedAmountCents: refund.amount,
          groupId,
          adminUserId: creatorId,
        },
      });

      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      GroupDiscussionNotificationService.unsubscribe(groupId, targetUserId).catch(() => {});

      this._sendCancellationEmail(targetUserId, groupId, subscription, true).catch(err =>
        console.error('Admin refund email failed:', err.message)
      );

      return {
        refunded: true,
        refundId: refund.id,
        refundStatus: refund.status,
        refundAmount: refund.amount,
      };
    } catch (err) {
      console.error('Admin refund process failed:', err);
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, `Refund failed: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // USER — ALL GROUP SUBSCRIPTIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all group subscriptions for the logged-in user across all groups.
   * Syncs live Stripe status for active subscriptions in parallel.
   */
  static async getMyAllGroupSubscriptions(userId) {
    const rows = await db.query.groupSubscriptions.findMany({
      where: eq(groupSubscriptions.userId, userId),
      orderBy: [desc(groupSubscriptions.createdAt)],
      with: {
        tier: { columns: { id: true, name: true, price: true, billingInterval: true } },
        group: {
          columns: { id: true, name: true, slug: true, coverImage: true, isPaid: true },
        },
      },
    });

    // Sync live status from Stripe for active/trialing subscriptions
    let s;
    try {
      s = getStripe();
    } catch {
      return rows;
    }

    await Promise.all(
      rows
        .filter(r => ACTIVE_STATUSES.includes(r.status) && r.stripeSubscriptionId)
        .map(async row => {
          try {
            const stripeSub = await s.subscriptions.retrieve(row.stripeSubscriptionId);
            const { periodStart: bulkPs, periodEnd: bulkPe } = resolveSubPeriod(stripeSub);
            const updates = {
              status: stripeSub.status,
              currentPeriodStart: bulkPs,
              currentPeriodEnd: bulkPe,
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
              updatedAt: new Date(),
            };
            await db
              .update(groupSubscriptions)
              .set(updates)
              .where(eq(groupSubscriptions.id, row.id));
            Object.assign(row, updates);
          } catch (err) {
            console.error(`[GroupSubscription] Stripe sync failed for ${row.id}:`, err.message);
          }
        })
    );

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────
  // REFUND STATUS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check the current refund status for a user's group subscription.
   * Syncs status from Stripe if it has changed in the DB.
   */
  static async checkRefundStatus(userId, groupId) {
    const subscription = await db.query.groupSubscriptions.findFirst({
      where: and(eq(groupSubscriptions.userId, userId), eq(groupSubscriptions.groupId, groupId)),
      columns: { id: true, refundId: true, refundStatus: true, refundAmount: true },
    });

    if (!subscription?.refundId) return { hasRefund: false };

    const s = getStripe();
    try {
      const refund = await s.refunds.retrieve(subscription.refundId);

      // Sync status to DB if Stripe has updated it
      if (refund.status !== subscription.refundStatus) {
        await db
          .update(groupSubscriptions)
          .set({ refundStatus: refund.status, updatedAt: new Date() })
          .where(eq(groupSubscriptions.id, subscription.id));
      }

      return {
        hasRefund: true,
        refund: {
          id: refund.id,
          status: refund.status,
          amount: refund.amount,
          currency: refund.currency,
          created: new Date(refund.created * 1000),
          reason: refund.reason,
        },
      };
    } catch (err) {
      console.error('Failed to check refund status from Stripe:', err.message);
      // Return cached DB data if Stripe call fails
      return {
        hasRefund: true,
        refund: {
          id: subscription.refundId,
          status: subscription.refundStatus,
          amount: subscription.refundAmount,
        },
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // WEBHOOK — CHARGE.REFUNDED
  // ─────────────────────────────────────────────────────────────────

  /**
   * charge.refunded webhook — sync refund status for group subscriptions.
   * Only updates rows that were created by our refund logic (has a matching refundId).
   */
  static async handleRefundWebhook(charge) {
    const latestRefund = charge.refunds?.data?.[0];
    if (!latestRefund) return;

    const updatedSubscriptions = await db
      .update(groupSubscriptions)
      .set({ refundStatus: latestRefund.status, updatedAt: new Date() })
      .where(eq(groupSubscriptions.refundId, latestRefund.id))
      .returning({
        id: groupSubscriptions.id,
        userId: groupSubscriptions.userId,
        groupId: groupSubscriptions.groupId,
      });

    if (latestRefund.status === 'succeeded' || latestRefund.status === 'pending') {
      await Promise.all(
        updatedSubscriptions.map(sub =>
          UserSpendService.markSpendRefunded({
            userId: sub.userId,
            referenceId: sub.id,
            referenceType: 'group_subscription',
            spendType: 'group_subscription',
            refundMeta: {
              source: 'group_subscription_refund_webhook',
              stripeRefundId: latestRefund.id,
              refundStatus: latestRefund.status,
              refundedAmountCents: latestRefund.amount,
              groupId: sub.groupId,
            },
          })
        )
      );
    }

    if (updatedSubscriptions.length > 0) {
      console.log(
        `Group subscription refund status synced: ${latestRefund.id} → ${latestRefund.status}`
      );
    }
  }
}
