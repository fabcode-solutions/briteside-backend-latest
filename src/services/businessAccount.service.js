/**
 * A business is its own account. This is the business's copy of the personal
 * account tools: notification + privacy settings, blocked accounts, pinned
 * profiles, interests, saved cards (its own Stripe customer), spend log and
 * digital product purchases.
 *
 * Routes: routes/businessAccount.route.js (/businesses/:businessId/account/…).
 * Stripe ids never leave this file in a response.
 */
import httpStatus from 'http-status';
import Stripe from 'stripe';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businesses,
  businessBlocks,
  businessPinnedProfiles,
  businessTeamMembers,
  businessEventCategoryPreferences,
  businessGroupCategoryPreferences,
  categories,
  groupCategories,
  socialProfiles,
  users,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { resolveBusinessAccess } from '../middlewares/businessAccess.middleware.js';
import {
  BUSINESS_NOTIFICATION_KEYS,
  BUSINESS_PRIVACY_FIELDS,
  businessPrivacyOf,
  resolveBusinessNotificationPrefs,
} from '../config/business-account.js';
import { UserSpendService } from './userSpend.service.js';
import { ShopOrderService } from './shop/shopOrder.service.js';
import {
  countPinnedBusinesses,
  findPinnableBusiness,
  isBusinessPinned,
  mergePinPage,
  pinnedBusinessRows,
  toggleBusinessPin,
} from './pinnedBusiness.helper.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Access ─────────────────────────────────────────────────────────────────

/**
 * For code outside the business routes (e.g. shop checkout with a businessId):
 * the business row when `user` has `permission` on it. Same errors as
 * requireBusinessPermission (404 to outsiders, 403 without the permission).
 */
export async function assertBusinessPermission(businessId, user, permission) {
  if (!user?.id) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  if (typeof businessId !== 'string' || !UUID_RE.test(businessId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid business');
  }
  const business = await db.query.businesses.findFirst({
    where: and(eq(businesses.id, businessId), isNull(businesses.deletedAt)),
  });
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  const access = await resolveBusinessAccess(business, user);
  if (!access) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  if (permission && !access.permissions.includes(permission)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to do this for this business');
  }
  return business;
}

// ─── Notification settings ──────────────────────────────────────────────────

export function getNotificationPrefs(business) {
  return { prefs: resolveBusinessNotificationPrefs(business.notificationPrefs) };
}

export async function updateNotificationPrefs(business, prefs = {}) {
  const changes = Object.fromEntries(
    Object.entries(prefs).filter(([k, v]) => BUSINESS_NOTIFICATION_KEYS.includes(k) && typeof v === 'boolean')
  );
  const merged = resolveBusinessNotificationPrefs({ ...(business.notificationPrefs ?? {}), ...changes });
  await db
    .update(businesses)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(businesses.id, business.id));
  return { prefs: merged };
}

// ─── Privacy ────────────────────────────────────────────────────────────────

export const getPrivacy = business => businessPrivacyOf(business);

export async function updatePrivacy(business, patch = {}) {
  const set = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => BUSINESS_PRIVACY_FIELDS.includes(k) && v !== undefined)
  );
  if (!Object.keys(set).length) return businessPrivacyOf(business);
  const [row] = await db
    .update(businesses)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(businesses.id, business.id))
    .returning();
  return businessPrivacyOf(row);
}

// ─── Blocked accounts ───────────────────────────────────────────────────────

const blockedUserColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  profileImage: users.image,
  blockedAt: businessBlocks.createdAt,
};

export async function listBlocked(business) {
  const rows = await db
    .select(blockedUserColumns)
    .from(businessBlocks)
    .innerJoin(users, eq(users.id, businessBlocks.blockedUserId))
    .where(eq(businessBlocks.businessId, business.id))
    .orderBy(desc(businessBlocks.createdAt));
  return { users: rows };
}

async function findUserByUsername(username) {
  const handle = String(username ?? '').trim().replace(/^@/, '');
  if (!handle) throw new ApiError(httpStatus.BAD_REQUEST, 'Enter a username');
  const user = await db.query.users.findFirst({
    where: sql`lower(${users.username}) = lower(${handle})`,
    columns: { id: true, username: true, firstName: true, lastName: true, image: true },
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  return user;
}

/** True when the user runs this business (owner or an active team member). */
async function isOnTeam(business, userId) {
  if (business.ownerId === userId) return true;
  const member = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, business.id),
      eq(businessTeamMembers.userId, userId),
      eq(businessTeamMembers.status, 'active')
    ),
    columns: { id: true },
  });
  return !!member;
}

export async function blockUser(business, username, actorId) {
  const user = await findUserByUsername(username);
  if (await isOnTeam(business, user.id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "You can't block someone on your business's team");
  }
  await db
    .insert(businessBlocks)
    .values({ businessId: business.id, blockedUserId: user.id, createdBy: actorId })
    .onConflictDoNothing({ target: [businessBlocks.businessId, businessBlocks.blockedUserId] });
  const [row] = await db
    .select(blockedUserColumns)
    .from(businessBlocks)
    .innerJoin(users, eq(users.id, businessBlocks.blockedUserId))
    .where(and(eq(businessBlocks.businessId, business.id), eq(businessBlocks.blockedUserId, user.id)));
  return { user: row };
}

export async function unblockUser(business, userId) {
  await db
    .delete(businessBlocks)
    .where(and(eq(businessBlocks.businessId, business.id), eq(businessBlocks.blockedUserId, userId)));
  return { blocked: false };
}

// ─── Pinned profiles ────────────────────────────────────────────────────────

/** Pin / unpin a business page (shows in the same Pinned Profiles list). */
export async function togglePinBusiness(business, idOrSlug) {
  const target = await findPinnableBusiness(idOrSlug);
  if (target.id === business.id) {
    throw new ApiError(httpStatus.BAD_REQUEST, "A business can't pin its own page");
  }
  return toggleBusinessPin(businessPinnedProfiles, 'businessId', business.id, target.id);
}

export async function isBusinessPinnedBy(business, idOrSlug) {
  const target = await findPinnableBusiness(idOrSlug);
  return { pinned: await isBusinessPinned(businessPinnedProfiles, 'businessId', business.id, target.id) };
}

export async function togglePin(business, username) {
  const user = await findUserByUsername(username);
  const existing = await db.query.businessPinnedProfiles.findFirst({
    where: and(eq(businessPinnedProfiles.businessId, business.id), eq(businessPinnedProfiles.pinnedUserId, user.id)),
    columns: { id: true },
  });
  if (existing) {
    await db.delete(businessPinnedProfiles).where(eq(businessPinnedProfiles.id, existing.id));
    return { pinned: false };
  }
  await db
    .insert(businessPinnedProfiles)
    .values({ businessId: business.id, pinnedUserId: user.id })
    .onConflictDoNothing({ target: [businessPinnedProfiles.businessId, businessPinnedProfiles.pinnedUserId] });
  return { pinned: true };
}

export async function isPinned(business, username) {
  const user = await findUserByUsername(username);
  const existing = await db.query.businessPinnedProfiles.findFirst({
    where: and(eq(businessPinnedProfiles.businessId, business.id), eq(businessPinnedProfiles.pinnedUserId, user.id)),
    columns: { id: true },
  });
  return { pinned: !!existing };
}

/** Same row shape as PinnedProfileService.getPinnedProfiles (personal). */
export async function listPinned(business, page = 1, limit = 20, search = '') {
  const offset = (page - 1) * limit;
  // People and business pages merged newest-first (+1 to know hasMore)
  const take = offset + limit + 1;
  // Accounts the business blocked are hidden (not unpinned), like personal pins
  const blocked = await db
    .select({ id: businessBlocks.blockedUserId })
    .from(businessBlocks)
    .where(eq(businessBlocks.businessId, business.id));
  const blockedIds = blocked.map(r => r.id);
  const blockCondition = blockedIds.length ? notInArray(businessPinnedProfiles.pinnedUserId, blockedIds) : undefined;
  const nameCondition = search
    ? or(
        sql`${users.username} ILIKE ${`%${search}%`}`,
        sql`${users.firstName} ILIKE ${`%${search}%`}`,
        sql`${users.lastName} ILIKE ${`%${search}%`}`
      )
    : undefined;
  const mine = and(
    eq(businessPinnedProfiles.businessId, business.id),
    isNotNull(businessPinnedProfiles.pinnedUserId)
  );

  const [rows, [{ value: peopleTotal }], businessRows, businessTotal] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        image: users.image,
        bio: socialProfiles.bio,
        pinnedAt: businessPinnedProfiles.createdAt,
      })
      .from(businessPinnedProfiles)
      .innerJoin(users, eq(users.id, businessPinnedProfiles.pinnedUserId))
      .leftJoin(socialProfiles, eq(socialProfiles.userId, users.id))
      .where(and(mine, blockCondition, nameCondition))
      .orderBy(desc(businessPinnedProfiles.createdAt))
      .limit(take),
    // Unfiltered by search: feeds the menu badge
    db.select({ value: count() }).from(businessPinnedProfiles).where(and(mine, blockCondition)),
    pinnedBusinessRows(businessPinnedProfiles, 'businessId', business.id, { search, take }),
    countPinnedBusinesses(businessPinnedProfiles, 'businessId', business.id),
  ]);
  const { items, hasMore } = mergePinPage(rows, businessRows, offset, limit);
  return { items, hasMore, total: Number(peopleTotal) + businessTotal };
}

// ─── Interests ──────────────────────────────────────────────────────────────

export async function getBusinessEventCategoryIds(businessId) {
  const rows = await db
    .select({ id: businessEventCategoryPreferences.categoryId })
    .from(businessEventCategoryPreferences)
    .where(eq(businessEventCategoryPreferences.businessId, businessId));
  return rows.map(r => r.id);
}

export async function getBusinessGroupCategoryIds(businessId) {
  const rows = await db
    .select({ id: businessGroupCategoryPreferences.categoryId })
    .from(businessGroupCategoryPreferences)
    .where(eq(businessGroupCategoryPreferences.businessId, businessId));
  return rows.map(r => r.id);
}

const activeEventCategories = () =>
  db
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji, iconUrl: categories.iconUrl })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.name));

const activeGroupCategories = () =>
  db
    .select({
      id: groupCategories.id,
      name: groupCategories.name,
      emoji: groupCategories.emoji,
      iconUrl: groupCategories.iconUrl,
    })
    .from(groupCategories)
    .where(eq(groupCategories.isActive, true))
    .orderBy(asc(groupCategories.name));

/** The business's picks + the category lists to choose from. */
export async function getInterests(business) {
  const [eventCategoryIds, groupCategoryIds, eventCategories, groupCategoryList] = await Promise.all([
    getBusinessEventCategoryIds(business.id),
    getBusinessGroupCategoryIds(business.id),
    activeEventCategories(),
    activeGroupCategories(),
  ]);
  return { eventCategoryIds, groupCategoryIds, eventCategories, groupCategories: groupCategoryList };
}

const uniqueIds = v =>
  Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && UUID_RE.test(x)))] : [];

/** Replace the business's interests (no minimum — unlike the personal setup flow). */
export async function saveInterests(business, { eventCategoryIds, groupCategoryIds }) {
  const eventIds = uniqueIds(eventCategoryIds);
  const groupIds = uniqueIds(groupCategoryIds);
  const [validEvent, validGroup] = await Promise.all([
    eventIds.length
      ? db
          .select({ id: categories.id })
          .from(categories)
          .where(and(inArray(categories.id, eventIds), eq(categories.isActive, true)))
      : [],
    groupIds.length
      ? db
          .select({ id: groupCategories.id })
          .from(groupCategories)
          .where(and(inArray(groupCategories.id, groupIds), eq(groupCategories.isActive, true)))
      : [],
  ]);
  await db.transaction(async tx => {
    await tx
      .delete(businessEventCategoryPreferences)
      .where(eq(businessEventCategoryPreferences.businessId, business.id));
    await tx
      .delete(businessGroupCategoryPreferences)
      .where(eq(businessGroupCategoryPreferences.businessId, business.id));
    if (validEvent.length) {
      await tx
        .insert(businessEventCategoryPreferences)
        .values(validEvent.map(r => ({ businessId: business.id, categoryId: r.id })));
    }
    if (validGroup.length) {
      await tx
        .insert(businessGroupCategoryPreferences)
        .values(validGroup.map(r => ({ businessId: business.id, categoryId: r.id })));
    }
  });
  return getInterests(business);
}

/**
 * Categories to rank the Events / Groups tab by. `asBusinessId` (the business
 * the viewer is acting as) wins when they're on its team; anything else falls
 * back to the person's own setup-flow picks. Never throws.
 */
export async function rankingCategoryIds(kind, user, asBusinessId, personalLookup) {
  if (!user?.id) return [];
  if (asBusinessId && typeof asBusinessId === 'string' && UUID_RE.test(asBusinessId)) {
    try {
      const business = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, asBusinessId), isNull(businesses.deletedAt)),
      });
      if (business && (await resolveBusinessAccess(business, user))) {
        return kind === 'event'
          ? getBusinessEventCategoryIds(business.id)
          : getBusinessGroupCategoryIds(business.id);
      }
    } catch (err) {
      logger.warn(`[businessAccount] interest ranking lookup failed: ${err.message}`);
    }
  }
  return personalLookup(user.id);
}

// ─── Stripe customer + payment methods ──────────────────────────────────────

function ensureStripe() {
  if (!stripe) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Payments are unavailable right now');
}

/** The business's own Stripe customer id, or null when it has none (or it was deleted in Stripe). */
export async function existingBusinessCustomerId(business) {
  if (!stripe || !business?.stripeCustomerId) return null;
  try {
    const c = await stripe.customers.retrieve(business.stripeCustomerId);
    return c?.deleted ? null : c.id;
  } catch (err) {
    if (err?.statusCode === 404 || err?.code === 'resource_missing') return null;
    throw err;
  }
}

/**
 * The business's own Stripe customer (separate from the owner's personal one),
 * created on first use. Concurrent callers end up with the same stored id.
 */
export async function getOrCreateBusinessCustomer(business) {
  ensureStripe();
  const existing = await existingBusinessCustomerId(business);
  if (existing) return existing;

  const owner = await db.query.users.findFirst({
    where: eq(users.id, business.ownerId),
    columns: { email: true },
  });
  const customer = await stripe.customers.create(
    {
      name: business.name,
      email: business.email || owner?.email || undefined,
      metadata: { type: 'business', businessId: business.id, ownerId: business.ownerId },
    },
    { idempotencyKey: `business-customer-${business.id}-${business.stripeCustomerId ?? 'new'}` }
  );
  // Only claim the slot if nobody else did meanwhile (or it held a dead id)
  const [claimed] = await db
    .update(businesses)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(
      and(
        eq(businesses.id, business.id),
        business.stripeCustomerId
          ? eq(businesses.stripeCustomerId, business.stripeCustomerId)
          : isNull(businesses.stripeCustomerId)
      )
    )
    .returning({ stripeCustomerId: businesses.stripeCustomerId });
  if (claimed) return claimed.stripeCustomerId;
  const fresh = await db.query.businesses.findFirst({
    where: eq(businesses.id, business.id),
    columns: { stripeCustomerId: true },
  });
  return fresh?.stripeCustomerId ?? customer.id;
}

const pmIdOf = pm => (typeof pm === 'string' ? pm : pm?.id) ?? null;

/** The business customer's card to charge off-session: its default, else any card. */
export async function businessDefaultCard(business) {
  const customerId = await existingBusinessCustomerId(business).catch(() => null);
  if (!customerId) return null;
  const c = await stripe.customers.retrieve(customerId).catch(() => null);
  let paymentMethod = pmIdOf(c?.invoice_settings?.default_payment_method);
  if (!paymentMethod) {
    const list = await stripe.paymentMethods
      .list({ customer: customerId, type: 'card', limit: 1 })
      .catch(() => null);
    paymentMethod = list?.data?.[0]?.id ?? null;
  }
  return paymentMethod ? { customerId, paymentMethod } : null;
}

/** Saved cards (no Stripe ids other than the card's own pm id, which the portal uses anyway). */
export async function listPaymentMethods(business) {
  if (!stripe) return { cards: [] };
  const customerId = await existingBusinessCustomerId(business);
  if (!customerId) return { cards: [] };
  const [customer, list] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 20 }),
  ]);
  const defaultId = pmIdOf(customer?.invoice_settings?.default_payment_method);
  return {
    cards: list.data.map((pm, i) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '',
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      // No explicit default → the first card is what gets charged
      isDefault: defaultId ? pm.id === defaultId : i === 0,
    })),
  };
}

/** Stripe Billing Portal for the business's own customer (add / remove / default card). */
export async function createPaymentPortal(business, returnUrl) {
  ensureStripe();
  const customer = await getOrCreateBusinessCustomer(business);
  const session = await stripe.billingPortal.sessions.create({ customer, return_url: returnUrl });
  return { url: session.url };
}

// ─── Spend log ──────────────────────────────────────────────────────────────

export const spendSummary = business => UserSpendService.getSummary({ businessId: business.id });
export const spendTimeline = (business, q) => UserSpendService.getTimeline({ businessId: business.id }, q);
export const spendRecent = (business, q) => UserSpendService.getRecentSpends({ businessId: business.id }, q);

// ─── Digital product purchases ──────────────────────────────────────────────

export const listPurchases = (business, userId, page, limit) =>
  ShopOrderService.listPurchases(userId, page, limit, { businessId: business.id });

export const getPurchaseDownload = (business, userId, orderId) =>
  ShopOrderService.getDownload(userId, orderId, { businessId: business.id });
