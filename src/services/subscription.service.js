import Stripe from 'stripe';
import httpStatus from 'http-status';
import config from '../config/config.js';
import { db } from '../db/index.js';
import {
  users,
  stripeCustomers,
  subscriptionPlans,
  subscriptionFeatures,
  userSubscriptions,
  subscriptionAuditLogs,
  userSpends,
} from '../db/schema/index.js';
import { eq, and, desc, or, ilike, sql, count, inArray } from 'drizzle-orm';
import { UserSpendService } from './userSpend.service.js';
import ApiError from '../utils/api-error.js';
import dayjs from 'dayjs';
import {
  sendBridesidePlusSignupEmail,
  sendBridesidePlusCancellationEmail,
  sendBridesidePlusPaymentFailedEmail,
} from '../templates/index.js';

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
} else {
  console.warn('Stripe is not configured. STRIPE_SECRET_KEY missing.');
}

// ─── STATUS CONSTANTS ──────────────────────────────────────────────────────
const ACTIVE_STATUSES = ['active', 'trialing', 'comped'];

const STRIPE_STATUS_MAP = {
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  trialing: 'trialing',
  unpaid: 'past_due',
};

// ─── INTERNAL HELPERS ──────────────────────────────────────────────────────

// Stripe flexible billing mode moves period dates to items[0]; top-level may be undefined
const resolveSubPeriod = sub => {
  const item = sub.items?.data?.[0];
  const start = sub.current_period_start ?? item?.current_period_start ?? null;
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  return {
    periodStart: start ? new Date(start * 1000) : null,
    periodEnd: end ? new Date(end * 1000) : null,
  };
};

const writeSubscriptionAuditLog = async ({
  userSubscriptionId = null,
  planId = null,
  actorId = null,
  actorType,
  action,
  previousValues = null,
  newValues = null,
}) => {
  await db.insert(subscriptionAuditLogs).values({
    userSubscriptionId,
    planId,
    actorId,
    actorType,
    action,
    previousValues,
    newValues,
    createdAt: new Date(),
  });
};

// ─── SERVICE CLASS ─────────────────────────────────────────────────────────
export class SubscriptionService {
  static ensureStripe() {
    if (!stripe) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payment provider not configured');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // PLAN MANAGEMENT (Admin)
  // ───────────────────────────────────────────────────────────────────────

  static async createPlan(data, adminId) {
    this.ensureStripe();

    const {
      name,
      description,
      price,
      currency = 'usd',
      interval,
      displayOrder,
      metadata,
      features,
    } = data;

    // Create Stripe Product
    const product = await stripe.products.create({
      name,
      description: description || undefined,
      metadata: { source: 'briteside_plus' },
    });

    // Create Stripe Price
    const stripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(parseFloat(price) * 100),
      currency,
      recurring: { interval },
    });

    // Insert plan into DB
    const [plan] = await db
      .insert(subscriptionPlans)
      .values({
        name,
        description: description || null,
        price,
        currency,
        interval,
        stripePriceId: stripePrice.id,
        stripeProductId: product.id,
        isActive: true,
        displayOrder: displayOrder || 0,
        metadata: metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Insert features if provided
    let createdFeatures = [];
    if (features && features.length > 0) {
      createdFeatures = await db
        .insert(subscriptionFeatures)
        .values(
          features.map(f => ({
            planId: plan.id,
            featureKey: f.featureKey,
            featureLabel: f.featureLabel,
            description: f.description || null,
            createdAt: new Date(),
          }))
        )
        .returning();
    }

    await writeSubscriptionAuditLog({
      planId: plan.id,
      actorId: adminId,
      actorType: 'admin',
      action: 'plan_created',
      newValues: { name, price, currency, interval, features: features?.length || 0 },
    });

    return { ...plan, features: createdFeatures };
  }

  static async updatePlan(planId, data, adminId) {
    this.ensureStripe();

    const existingPlan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!existingPlan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    const previousValues = {
      name: existingPlan.name,
      description: existingPlan.description,
      price: existingPlan.price,
      interval: existingPlan.interval,
      displayOrder: existingPlan.displayOrder,
      isActive: existingPlan.isActive,
    };

    const updates = { updatedAt: new Date() };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.displayOrder !== undefined) updates.displayOrder = data.displayOrder;
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.metadata !== undefined) updates.metadata = data.metadata;

    // If price or interval changed, create a new Stripe Price (prices are immutable)
    const priceChanged =
      data.price !== undefined && String(data.price) !== String(existingPlan.price);
    const intervalChanged = data.interval !== undefined && data.interval !== existingPlan.interval;

    if (priceChanged || intervalChanged) {
      const newPrice = data.price !== undefined ? data.price : existingPlan.price;
      const newInterval = data.interval !== undefined ? data.interval : existingPlan.interval;
      const currency = data.currency || existingPlan.currency;

      const stripePrice = await stripe.prices.create({
        product: existingPlan.stripeProductId,
        unit_amount: Math.round(parseFloat(newPrice) * 100),
        currency,
        recurring: { interval: newInterval },
      });

      // Archive old price
      if (existingPlan.stripePriceId) {
        await stripe.prices.update(existingPlan.stripePriceId, { active: false });
      }

      updates.stripePriceId = stripePrice.id;
      updates.price = newPrice;
      if (intervalChanged) updates.interval = newInterval;
    }

    // Update Stripe Product metadata if name or description changed
    if ((data.name || data.description) && existingPlan.stripeProductId) {
      const productUpdate = {};
      if (data.name) productUpdate.name = data.name;
      if (data.description !== undefined) productUpdate.description = data.description || '';
      await stripe.products.update(existingPlan.stripeProductId, productUpdate);
    }

    const [updatedPlan] = await db
      .update(subscriptionPlans)
      .set(updates)
      .where(eq(subscriptionPlans.id, planId))
      .returning();

    await writeSubscriptionAuditLog({
      planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'plan_updated',
      previousValues,
      newValues: updates,
    });

    return updatedPlan;
  }

  static async deactivatePlan(planId, adminId) {
    this.ensureStripe();

    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    // Archive Stripe price
    if (plan.stripePriceId) {
      await stripe.prices.update(plan.stripePriceId, { active: false });
    }

    const [deactivated] = await db
      .update(subscriptionPlans)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(subscriptionPlans.id, planId))
      .returning();

    await writeSubscriptionAuditLog({
      planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'plan_deactivated',
      previousValues: { isActive: true },
      newValues: { isActive: false },
    });

    return deactivated;
  }

  static async getPlan(planId) {
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
      with: { features: true },
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    return plan;
  }

  static async listPlans({ includeInactive = false } = {}) {
    const conditions = [];
    if (!includeInactive) {
      conditions.push(eq(subscriptionPlans.isActive, true));
    }

    const plans = await db.query.subscriptionPlans.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [subscriptionPlans.displayOrder],
      with: { features: true },
    });

    return plans;
  }

  static async addFeatureToPlan(planId, featureData, adminId) {
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    const [feature] = await db
      .insert(subscriptionFeatures)
      .values({
        planId,
        featureKey: featureData.featureKey,
        featureLabel: featureData.featureLabel,
        description: featureData.description || null,
        createdAt: new Date(),
      })
      .returning();

    await writeSubscriptionAuditLog({
      planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'feature_added',
      newValues: { featureKey: featureData.featureKey, featureLabel: featureData.featureLabel },
    });

    return feature;
  }

  static async removeFeatureFromPlan(planId, featureId, adminId) {
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    const feature = await db.query.subscriptionFeatures.findFirst({
      where: and(eq(subscriptionFeatures.id, featureId), eq(subscriptionFeatures.planId, planId)),
    });

    if (!feature) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Feature not found for this plan');
    }

    await db.delete(subscriptionFeatures).where(eq(subscriptionFeatures.id, featureId));

    await writeSubscriptionAuditLog({
      planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'feature_removed',
      previousValues: { featureKey: feature.featureKey, featureLabel: feature.featureLabel },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // STRIPE CUSTOMER MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────

  static async getOrCreateStripeCustomer(userId) {
    this.ensureStripe();

    const existing = await db.query.stripeCustomers.findFirst({
      where: eq(stripeCustomers.userId, userId),
    });

    if (existing) {
      // Verify the customer still exists in Stripe (guards against stale/seeded IDs)
      try {
        await stripe.customers.retrieve(existing.stripeCustomerId);
        return existing.stripeCustomerId;
      } catch (err) {
        if (err?.statusCode === 404 || err?.code === 'resource_missing') {
          // Stale record — delete it and fall through to create a fresh customer
          await db.delete(stripeCustomers).where(eq(stripeCustomers.userId, userId));
        } else {
          throw err;
        }
      }
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    const customerName = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;

    const customer = await stripe.customers.create({
      email: user.email,
      name: customerName,
      metadata: { userId },
    });

    await db.insert(stripeCustomers).values({
      userId,
      stripeCustomerId: customer.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return customer.id;
  }

  // ───────────────────────────────────────────────────────────────────────
  // USER SUBSCRIPTION
  // ───────────────────────────────────────────────────────────────────────

  static async createCheckoutSession(userId, planId, successUrl, cancelUrl) {
    this.ensureStripe();

    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    if (!plan.isActive) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is no longer available');
    }

    if (!plan.stripePriceId) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'This plan is not yet configured for payment. Please contact support.'
      );
    }

    // Check DB for existing active subscription
    const existingSub = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
    });

    if (existingSub) {
      throw new ApiError(httpStatus.CONFLICT, 'User already has an active subscription');
    }

    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    // Also check Stripe directly — guards against webhook-delay race where DB is stale
    // Only conflict if same plan price is already active (not other sub types like group)
    const existingStripeSubs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'active',
      limit: 10,
    });
    const duplicate = existingStripeSubs.data.find(
      sub =>
        sub.metadata?.planId === planId ||
        sub.items?.data?.some(item => item.price?.id === plan.stripePriceId)
    );
    if (duplicate) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'User already has an active subscription for this plan'
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true, firstName: true, lastName: true },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Off by default — without this Checkout renders no promo code field at all,
      // so an existing coupon has no way to be redeemed. BriteSide Plus only;
      // group subscriptions and courses deliberately don't accept promo codes.
      allow_promotion_codes: true,
      metadata: {
        userId,
        planId,
        planName: plan.name,
        billingInterval: plan.interval,
        userEmail: user?.email ?? '',
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
          planName: plan.name,
          billingInterval: plan.interval,
          userEmail: user?.email ?? '',
        },
      },
    });

    return { sessionId: session.id, url: session.url };
  }

  static async getCustomerPortalSession(userId, returnUrl) {
    this.ensureStripe();

    const customer = await db.query.stripeCustomers.findFirst({
      where: eq(stripeCustomers.userId, userId),
    });

    if (!customer) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No billing account found for this user');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  static async getUserSubscription(userId) {
    const comped = await db.query.userSubscriptions.findFirst({
      where: and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.status, 'comped')),
      with: { plan: { with: { features: true } } },
    });
    if (comped) return comped;

    return db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: { plan: { with: { features: true } } },
    });
  }

  static async getUserSubscriptionHistory(userId) {
    const subscriptions = await db.query.userSubscriptions.findMany({
      where: eq(userSubscriptions.userId, userId),
      orderBy: [desc(userSubscriptions.createdAt)],
      with: { plan: true },
    });

    return subscriptions;
  }

  static async cancelSubscription(userId) {
    const subscription = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
    });

    if (!subscription) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No active subscription found');
    }

    const previousValues = {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };

    if (subscription.status === 'comped') {
      // Comped subscriptions are canceled immediately
      const [updated] = await db
        .update(userSubscriptions)
        .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(userSubscriptions.id, subscription.id))
        .returning();

      await writeSubscriptionAuditLog({
        userSubscriptionId: subscription.id,
        planId: subscription.planId,
        actorId: userId,
        actorType: 'user',
        action: 'canceled',
        previousValues,
        newValues: { status: 'canceled', canceledAt: updated.canceledAt },
      });

      try {
        const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
        if (user) {
          await sendBridesidePlusCancellationEmail(user.email, {
            user_name: user.firstName,
            access_end_date: dayjs().format('MMMM D, YYYY'),
          });
        }
      } catch (emailErr) {
        console.error('[Subscription] Cancellation email failed:', emailErr.message);
      }

      return updated;
    }

    // Cancel at period end via Stripe
    if (subscription.stripeSubscriptionId) {
      this.ensureStripe();
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    const [updated] = await db
      .update(userSubscriptions)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(userSubscriptions.id, subscription.id))
      .returning();

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscription.id,
      planId: subscription.planId,
      actorId: userId,
      actorType: 'user',
      action: 'canceled',
      previousValues,
      newValues: { cancelAtPeriodEnd: true },
    });

    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (user) {
        await sendBridesidePlusCancellationEmail(user.email, {
          user_name: user.firstName,
          access_end_date: dayjs(subscription.currentPeriodEnd).format('MMMM D, YYYY'),
        });
      }
    } catch (emailErr) {
      console.error('[Subscription] Cancellation email failed:', emailErr.message);
    }

    return updated;
  }

  static async checkFeatureAccess(userId, featureKey) {
    const subscription = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: {
        plan: {
          with: { features: true },
        },
      },
    });

    if (!subscription) return false;

    return subscription.plan.features.some(f => f.featureKey === featureKey);
  }

  // Batch variant of checkFeatureAccess for list views.
  // Returns Map<userId, Set<featureKey>> for all users with an active subscription.
  static async getActiveFeaturesForUsers(userIds) {
    const map = new Map();
    const uniqueIds = [...new Set((userIds ?? []).filter(Boolean))];
    if (uniqueIds.length === 0) return map;

    const subs = await db.query.userSubscriptions.findMany({
      where: and(
        inArray(userSubscriptions.userId, uniqueIds),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: { plan: { with: { features: true } } },
    });

    for (const sub of subs) {
      const keys = sub.plan?.features?.map(f => f.featureKey) ?? [];
      const existing = map.get(sub.userId) ?? new Set();
      keys.forEach(k => existing.add(k));
      map.set(sub.userId, existing);
    }
    return map;
  }

  // ───────────────────────────────────────────────────────────────────────
  // ADMIN-ONLY
  // ───────────────────────────────────────────────────────────────────────

  static async grantSubscription(userId, planId, adminId, reason) {
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found');
    }

    if (!plan.isActive) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot grant an inactive plan');
    }

    const existingSub = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
    });

    if (existingSub) {
      throw new ApiError(httpStatus.CONFLICT, 'User already has an active subscription');
    }

    const [subscription] = await db
      .insert(userSubscriptions)
      .values({
        userId,
        planId,
        status: 'comped',
        grantedBy: adminId,
        grantReason: reason || null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscription.id,
      planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'comped',
      newValues: { userId, planId, reason, status: 'comped' },
    });

    return subscription;
  }

  static async revokeSubscription(subscriptionId, adminId, reason) {
    const subscription = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.id, subscriptionId),
    });

    if (!subscription) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    }

    const previousValues = { status: subscription.status };

    // Cancel at Stripe if it has a Stripe subscription
    if (subscription.stripeSubscriptionId) {
      this.ensureStripe();
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    }

    const [updated] = await db
      .update(userSubscriptions)
      .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
      .where(eq(userSubscriptions.id, subscriptionId))
      .returning();

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscriptionId,
      planId: subscription.planId,
      actorId: adminId,
      actorType: 'admin',
      action: 'revoked',
      previousValues,
      newValues: { status: 'canceled', reason },
    });

    return updated;
  }

  static async listAllSubscriptions({
    page = 1,
    limit = 20,
    status,
    search,
    sortBy = 'createdAt',
  } = {}) {
    const offset = (page - 1) * limit;

    // Build conditions
    const conditions = [];
    if (status) {
      conditions.push(eq(userSubscriptions.status, status));
    }

    // For search we need a join-based approach
    if (search) {
      const searchTerm = `%${search}%`;
      const matchingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            ilike(users.firstName, searchTerm),
            ilike(users.lastName, searchTerm),
            ilike(users.email, searchTerm)
          )
        );

      const matchingUserIds = matchingUsers.map(u => u.id);
      if (matchingUserIds.length === 0) {
        return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
      conditions.push(inArray(userSubscriptions.userId, matchingUserIds));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(userSubscriptions)
      .where(whereClause);

    const totalCount = Number(total);
    const totalPages = Math.ceil(totalCount / limit);

    // Determine sort order
    const orderByMap = {
      createdAt: desc(userSubscriptions.createdAt),
      status: userSubscriptions.status,
      updatedAt: desc(userSubscriptions.updatedAt),
    };
    const orderBy = orderByMap[sortBy] || desc(userSubscriptions.createdAt);

    const data = await db.query.userSubscriptions.findMany({
      where: whereClause,
      orderBy: [orderBy],
      limit,
      offset,
      with: {
        user: {
          columns: { id: true, firstName: true, lastName: true, email: true },
        },
        plan: true,
      },
    });

    return {
      data,
      pagination: { page, limit, total: totalCount, totalPages },
    };
  }

  static async getSubscriptionById(subscriptionId) {
    const subscription = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.id, subscriptionId),
      with: {
        user: {
          columns: { id: true, firstName: true, lastName: true, email: true },
        },
        plan: {
          with: { features: true },
        },
        auditLogs: {
          orderBy: [desc(subscriptionAuditLogs.createdAt)],
        },
      },
    });

    if (!subscription) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    }

    return subscription;
  }

  static async getSubscriptionAnalytics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      [{ total: totalActive }],
      [{ total: totalTrialing }],
      [{ total: totalPastDue }],
      [{ total: totalCanceled }],
      [{ total: totalExpired }],
      [{ total: pendingCancellation }],
      [{ total: newThisMonth }],
      [{ total: newLastMonth }],
      [{ total: canceledThisMonth }],
      [{ rev: revenueThisMonth }],
      [{ rev: revenueLastMonth }],
      planBreakdownRows,
    ] = await Promise.all([
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(inArray(userSubscriptions.status, ['active', 'comped'])),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.status, 'trialing')),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.status, 'past_due')),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.status, 'canceled')),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.status, 'expired')),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(
          and(
            inArray(userSubscriptions.status, ['active', 'trialing']),
            eq(userSubscriptions.cancelAtPeriodEnd, true)
          )
        ),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(sql`${userSubscriptions.createdAt} >= ${startOfMonth}`),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(
          and(
            sql`${userSubscriptions.createdAt} >= ${startOfLastMonth}`,
            sql`${userSubscriptions.createdAt} < ${startOfMonth}`
          )
        ),
      db
        .select({ total: count() })
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.status, 'canceled'),
            sql`${userSubscriptions.canceledAt} >= ${startOfMonth}`
          )
        ),
      db
        .select({ rev: sql`coalesce(sum(${userSpends.amountCents}), 0)` })
        .from(userSpends)
        .where(
          and(
            eq(userSpends.spendType, 'platform_subscription'),
            eq(userSpends.isRefunded, false),
            sql`${userSpends.paidAt} >= ${startOfMonth}`
          )
        ),
      db
        .select({ rev: sql`coalesce(sum(${userSpends.amountCents}), 0)` })
        .from(userSpends)
        .where(
          and(
            eq(userSpends.spendType, 'platform_subscription'),
            eq(userSpends.isRefunded, false),
            sql`${userSpends.paidAt} >= ${startOfLastMonth}`,
            sql`${userSpends.paidAt} < ${startOfMonth}`
          )
        ),
      db
        .select({
          planId: userSubscriptions.planId,
          planName: subscriptionPlans.name,
          interval: subscriptionPlans.interval,
          price: subscriptionPlans.price,
          count: count(),
        })
        .from(userSubscriptions)
        .innerJoin(subscriptionPlans, eq(userSubscriptions.planId, subscriptionPlans.id))
        .where(inArray(userSubscriptions.status, ['active', 'comped', 'trialing']))
        .groupBy(
          userSubscriptions.planId,
          subscriptionPlans.name,
          subscriptionPlans.interval,
          subscriptionPlans.price
        ),
    ]);

    let mrrEstimated = 0;
    const planBreakdown = planBreakdownRows.map(row => {
      const price = parseFloat(row.price);
      const cnt = Number(row.count);
      const planMrr = row.interval === 'year' ? (price * cnt) / 12 : price * cnt;
      const planArr = row.interval === 'month' ? price * cnt * 12 : price * cnt;
      mrrEstimated += planMrr;
      return {
        planId: row.planId,
        planName: row.planName,
        interval: row.interval,
        pricePerUnit: price,
        activeCount: cnt,
        mrr: Math.round(planMrr * 100) / 100,
        arr: Math.round(planArr * 100) / 100,
      };
    });
    mrrEstimated = Math.round(mrrEstimated * 100) / 100;

    return {
      overview: {
        totalActive: Number(totalActive),
        totalTrialing: Number(totalTrialing),
        totalPastDue: Number(totalPastDue),
        totalCanceled: Number(totalCanceled),
        totalExpired: Number(totalExpired),
        pendingCancellation: Number(pendingCancellation),
      },
      revenue: {
        mrrEstimated,
        arrEstimated: Math.round(mrrEstimated * 12 * 100) / 100,
        revenueThisMonth: Math.round(Number(revenueThisMonth)) / 100,
        revenueLastMonth: Math.round(Number(revenueLastMonth)) / 100,
      },
      growth: {
        newThisMonth: Number(newThisMonth),
        newLastMonth: Number(newLastMonth),
        canceledThisMonth: Number(canceledThisMonth),
      },
      planBreakdown,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // WEBHOOK HANDLERS
  // ───────────────────────────────────────────────────────────────────────

  static async handleCheckoutSessionCompleted(session) {
    if (session.mode !== 'subscription') return;

    const userId = session.metadata?.userId;
    const planId = session.metadata?.planId;

    if (!userId || !planId) return;

    this.ensureStripe();
    const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);

    // Idempotency: check if subscription already exists
    const existing = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeSubscriptionId, stripeSubscription.id),
    });

    const { periodStart: csPeriodStart, periodEnd: csPeriodEnd } =
      resolveSubPeriod(stripeSubscription);

    if (existing) {
      // Already processed, update if needed
      await db
        .update(userSubscriptions)
        .set({
          status: 'active',
          currentPeriodStart: csPeriodStart,
          currentPeriodEnd: csPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(userSubscriptions.id, existing.id));
      await this._syncPlusFlag(userId);
      return;
    }

    const [subscription] = await db
      .insert(userSubscriptions)
      .values({
        userId,
        planId,
        stripeSubscriptionId: stripeSubscription.id,
        status: 'active',
        currentPeriodStart: csPeriodStart,
        currentPeriodEnd: csPeriodEnd,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscription.id,
      planId,
      actorId: userId,
      actorType: 'system',
      action: 'subscribed',
      newValues: { stripeSubscriptionId: stripeSubscription.id, status: 'active' },
    });

    // Record initial subscription spend
    try {
      const plan = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.id, planId),
        columns: { name: true, price: true, interval: true },
      });
      await UserSpendService.recordSpend({
        userId,
        spendType: 'platform_subscription',
        amountCents: plan ? Math.round(parseFloat(plan.price) * 100) : 0,
        referenceId: subscription.id,
        referenceType: 'user_subscription',
        metadata: {
          planName: plan?.name ?? null,
          interval: plan?.interval ?? null,
          periodStart: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
          periodEnd: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
        },
        stripeSessionId: session.id,
        paidAt: new Date(),
      });
    } catch (spendErr) {
      console.error('[UserSpend] platform_subscription initial record failed:', spendErr.message);
    }

    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (user) {
        await sendBridesidePlusSignupEmail(user.email, {
          user_name: user.firstName,
          next_billing_date: dayjs(subscription.currentPeriodEnd).format('MMMM D, YYYY'),
        });
      }
    } catch (emailErr) {
      console.error('[Subscription] Signup email failed:', emailErr.message);
    }

    await this._syncPlusFlag(userId);
  }

  // Recomputes users.isBritesidePlus from live userSubscriptions rows.
  // Call after any status change so the denormalized flag stays accurate.
  static async _syncPlusFlag(userId) {
    const active = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
      columns: { id: true },
    });
    await db
      .update(users)
      .set({ isBritesidePlus: !!active, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  static async getActiveSubscription(userId) {
    const comped = await db.query.userSubscriptions.findFirst({
      where: and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.status, 'comped')),
      with: { plan: { with: { features: true } } },
    });
    if (comped) return comped;

    return db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, userId),
        inArray(userSubscriptions.status, ACTIVE_STATUSES)
      ),
      with: { plan: { with: { features: true } } },
    });
  }

  static async syncAllPlusFlags() {
    const rows = await db
      .selectDistinct({ userId: userSubscriptions.userId })
      .from(userSubscriptions);
    let synced = 0;
    for (const { userId } of rows) {
      await this._syncPlusFlag(userId);
      synced++;
    }
    return { synced };
  }

  static async handleSubscriptionUpdated(stripeSubscription) {
    const existing = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeSubscriptionId, stripeSubscription.id),
    });

    const newStatus = STRIPE_STATUS_MAP[stripeSubscription.status] || stripeSubscription.status;
    const { periodStart, periodEnd } = resolveSubPeriod(stripeSubscription);
    const cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end || false;

    if (!existing) {
      let userId = stripeSubscription.metadata?.userId ?? null;
      let planId = stripeSubscription.metadata?.planId ?? null;

      if (!planId) {
        const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
        if (priceId) {
          const planByPrice = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.stripePriceId, priceId),
            columns: { id: true },
          });
          planId = planByPrice?.id ?? null;
        }
      }

      // Portal-renewed subscriptions have no metadata — resolve user via stripeCustomers table
      if (!userId && stripeSubscription.customer) {
        const customerRow = await db.query.stripeCustomers.findFirst({
          where: eq(stripeCustomers.stripeCustomerId, stripeSubscription.customer),
          columns: { userId: true },
        });
        userId = customerRow?.userId ?? null;
      }

      if (!userId || !planId) return;

      const [newSub] = await db
        .insert(userSubscriptions)
        .values({
          userId,
          planId,
          stripeSubscriptionId: stripeSubscription.id,
          status: newStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(newStatus === 'canceled' ? { canceledAt: new Date() } : {}),
        })
        .returning();

      await writeSubscriptionAuditLog({
        userSubscriptionId: newSub.id,
        planId,
        actorId: null,
        actorType: 'system',
        action: 'subscribed',
        newValues: {
          stripeSubscriptionId: stripeSubscription.id,
          status: newStatus,
          source: 'webhook_sync',
        },
      });
      await this._syncPlusFlag(userId);
      return;
    }

    const previousValues = {
      status: existing.status,
      currentPeriodStart: existing.currentPeriodStart,
      currentPeriodEnd: existing.currentPeriodEnd,
      cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
    };

    const updates = {
      status: newStatus,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      updatedAt: new Date(),
    };

    if (newStatus === 'canceled') {
      updates.canceledAt = new Date();
    }

    await db.update(userSubscriptions).set(updates).where(eq(userSubscriptions.id, existing.id));

    await writeSubscriptionAuditLog({
      userSubscriptionId: existing.id,
      planId: existing.planId,
      actorId: null,
      actorType: 'system',
      action: 'updated',
      previousValues,
      newValues: updates,
    });

    await this._syncPlusFlag(existing.userId);
  }

  static async handleSubscriptionDeleted(stripeSubscription) {
    const existing = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeSubscriptionId, stripeSubscription.id),
    });

    if (!existing) return;

    const previousValues = { status: existing.status };

    await db
      .update(userSubscriptions)
      .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
      .where(eq(userSubscriptions.id, existing.id));

    await writeSubscriptionAuditLog({
      userSubscriptionId: existing.id,
      planId: existing.planId,
      actorId: null,
      actorType: 'system',
      action: 'canceled',
      previousValues,
      newValues: { status: 'canceled' },
    });

    await this._syncPlusFlag(existing.userId);
  }

  static async handleInvoicePaid(invoice) {
    if (!invoice.subscription) return;

    const existing = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeSubscriptionId, invoice.subscription),
    });

    if (!existing) return;

    await db
      .update(userSubscriptions)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(userSubscriptions.id, existing.id));

    await writeSubscriptionAuditLog({
      userSubscriptionId: existing.id,
      planId: existing.planId,
      actorId: null,
      actorType: 'system',
      action: 'renewed',
      previousValues: { status: existing.status },
      newValues: { status: 'active' },
    });

    // Record renewal spend — invoice.amount_paid is already in cents
    try {
      const plan = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.id, existing.planId),
        columns: { name: true, price: true, interval: true },
      });
      await UserSpendService.recordSpend({
        userId: existing.userId,
        spendType: 'platform_subscription',
        amountCents: invoice.amount_paid ?? (plan ? Math.round(parseFloat(plan.price) * 100) : 0),
        referenceId: existing.id,
        referenceType: 'user_subscription',
        metadata: {
          planName: plan?.name ?? null,
          interval: plan?.interval ?? null,
          invoiceId: invoice.id,
        },
        paidAt: new Date(),
      });
    } catch (spendErr) {
      console.error('[UserSpend] platform_subscription renewal record failed:', spendErr.message);
    }
  }

  static async handleInvoicePaymentFailed(invoice) {
    if (!invoice.subscription) return;

    const existing = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.stripeSubscriptionId, invoice.subscription),
    });

    if (!existing) return;

    await db
      .update(userSubscriptions)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(userSubscriptions.id, existing.id));

    await writeSubscriptionAuditLog({
      userSubscriptionId: existing.id,
      planId: existing.planId,
      actorId: null,
      actorType: 'system',
      action: 'payment_failed',
      previousValues: { status: existing.status },
      newValues: { status: 'past_due' },
    });

    await this._syncPlusFlag(existing.userId);

    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, existing.userId) });
      if (user) {
        const nextRetry = invoice.next_payment_attempt
          ? dayjs(invoice.next_payment_attempt * 1000).format('MMMM D, YYYY')
          : 'soon';
        const suspensionDate = invoice.next_payment_attempt
          ? dayjs(invoice.next_payment_attempt * 1000)
              .add(14, 'days')
              .format('MMMM D, YYYY')
          : dayjs().add(21, 'days').format('MMMM D, YYYY');
        await sendBridesidePlusPaymentFailedEmail(user.email, {
          user_name: user.firstName,
          payment_method_last4: invoice.last_payment_error?.payment_method?.card?.last4 ?? '****',
          failed_date: dayjs(invoice.created * 1000).format('MMMM D, YYYY'),
          next_retry_date: nextRetry,
          max_retries: 4,
          suspension_date: suspensionDate,
        });
      }
    } catch (emailErr) {
      console.error('[Subscription] Payment failed email error:', emailErr.message);
    }
  }

  // ─── COUPON MANAGEMENT (Admin) ────────────────────────────────────────────

  static async createCoupon(
    { name, percentOff, durationMonths, maxRedemptions, couponId } = {},
    adminId
  ) {
    this.ensureStripe();

    const params = {
      name,
      percent_off: percentOff,
      duration: durationMonths ? 'repeating' : 'forever',
      metadata: { createdBy: adminId, source: 'platform_admin' },
    };
    if (durationMonths) params.duration_in_months = durationMonths;
    if (maxRedemptions) params.max_redemptions = maxRedemptions;
    if (couponId) params.id = couponId;

    const coupon = await stripe.coupons.create(params);

    await writeSubscriptionAuditLog({
      actorId: adminId,
      actorType: 'admin',
      action: 'coupon_created',
      newValues: { couponId: coupon.id, name, percentOff, durationMonths },
    });

    return coupon;
  }

  static async listCoupons({ limit = 20, startingAfter } = {}) {
    this.ensureStripe();
    const params = { limit };
    if (startingAfter) params.starting_after = startingAfter;
    return stripe.coupons.list(params);
  }

  static async applyCouponToSubscription(subscriptionId, couponId, adminId) {
    this.ensureStripe();

    const sub = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.id, subscriptionId),
    });
    if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    if (!sub.stripeSubscriptionId) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Subscription has no Stripe ID (comped)');
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      discounts: [{ coupon: couponId }],
    });

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscriptionId,
      actorId: adminId,
      actorType: 'admin',
      action: 'coupon_applied',
      newValues: { couponId },
    });

    return { subscriptionId, couponId, applied: true };
  }

  static async removeCouponFromSubscription(subscriptionId, adminId) {
    this.ensureStripe();

    const sub = await db.query.userSubscriptions.findFirst({
      where: eq(userSubscriptions.id, subscriptionId),
    });
    if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    if (!sub.stripeSubscriptionId) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Subscription has no Stripe ID (comped)');
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      discounts: [],
    });

    await writeSubscriptionAuditLog({
      userSubscriptionId: subscriptionId,
      actorId: adminId,
      actorType: 'admin',
      action: 'coupon_removed',
    });

    return { subscriptionId, removed: true };
  }

  static async updateCoupon(couponId, { name }, adminId) {
    this.ensureStripe();
    // Stripe coupons: only `name` and `metadata` are mutable after creation
    const coupon = await stripe.coupons.update(couponId, { name });

    await writeSubscriptionAuditLog({
      actorId: adminId,
      actorType: 'admin',
      action: 'coupon_updated',
      newValues: { couponId, name },
    });

    return coupon;
  }

  static async deleteCoupon(couponId, adminId) {
    this.ensureStripe();
    const deleted = await stripe.coupons.del(couponId);

    await writeSubscriptionAuditLog({
      actorId: adminId,
      actorType: 'admin',
      action: 'coupon_deleted',
      newValues: { couponId },
    });

    return deleted;
  }

  static async ensureDefaultCoupons() {
    this.ensureStripe();
    try {
      await stripe.coupons.retrieve('GOKYRO_1YEAR_FREE');
    } catch (err) {
      if (err?.statusCode === 404 || err?.code === 'resource_missing') {
        await stripe.coupons.create({
          id: 'GOKYRO_1YEAR_FREE',
          name: '1 Year Subscription Waiver',
          percent_off: 100,
          duration: 'repeating',
          duration_in_months: 12,
          metadata: { source: 'platform_default', type: '1_year_free' },
        });
      }
    }
  }
}
