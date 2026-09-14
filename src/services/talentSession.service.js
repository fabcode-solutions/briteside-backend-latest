import { db } from '../db/index.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { talentAvailability } from '../db/schema/talentAvailability.js';
import { users } from '../db/schema/users.js';
import { streamCalls } from '../db/schema/streamCalls.js';
import { ShopProductService } from './shop/shopProduct.service.js';
import {
  eq,
  and,
  gte,
  lte,
  isNull,
  isNotNull,
  or,
  ne,
  inArray,
  sql,
  desc,
  count,
} from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ApiError from '../utils/api-error.js';
import { shopCustomServiceOffers } from '../db/schema/shop.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import { StreamCallService, streamClient } from './stream.service.js';
import { MEDIA_CONFIG_KEY } from './moderation/mediaModeration.service.js';
import { StripeConnectService, getReserveRate } from './stripeConnect.service.js';
import { createNotification } from './notification.service.js';
import * as mailService from './mail.service.js';
import * as sessionEmails from '../cron/sessionEmails.js';
import dayjs from 'dayjs';
import {
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  sendBookingRescheduledEmail,
} from '../templates/index.js';
import { talentDateOverrides } from '../db/schema/talentDateOverrides.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { UserSpendService } from './userSpend.service.js';
import { talentFavorites } from '../db/schema/talentFavorites.js';
import { talentReviews } from '../db/schema/talentReviews.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { GiftCodeService } from './giftCode.service.js';
import { SubscriptionService } from './subscription.service.js';
import { FEATURES } from '../constants/features.js';
import Stripe from 'stripe';
import config from '../config/config.js';
import { getRedirectUrls } from '../utils/redirect-urls.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { emitSocialChat } from '../socket/emitter.js';
import { organizerSocialLinks } from '../db/schema/index.js';
import { calculateOrderProcessingFeeCents } from '../utils/orderProcessingFee.js';
dayjs.extend(utc);
dayjs.extend(timezone);

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

// ── Call moderation (frame recording) ───────────────────────────────────────
export const TALENT_SESSION_FRAME_ENTITY = 'gokiro:talentsession:frame';

// Bridges frameUrl from the synchronous moderation.check() call to the async
// moderation_check.completed webhook, which doesn't carry the original image
// URL back — only entity_id/action. Keyed by entityId (session:track:participant),
// so a participant with multiple frames in flight for the same track will have
// the newer submission's URL win if two checks resolve out of order. Best-effort:
// only affects the review dashboard's display, not the live moderation action.
const pendingFrameUrls = new Map();
const PENDING_FRAME_URL_TTL_MS = 5 * 60 * 1000;

function rememberPendingFrameUrl(entityId, frameUrl) {
  pendingFrameUrls.set(entityId, { frameUrl, storedAt: Date.now() });
}

function consumePendingFrameUrl(entityId) {
  const entry = pendingFrameUrls.get(entityId);
  if (!entry) return null;
  pendingFrameUrls.delete(entityId);
  return Date.now() - entry.storedAt <= PENDING_FRAME_URL_TTL_MS ? entry.frameUrl : null;
}

const FRAME_ACTION_TO_STATUS = {
  keep: 'approved',
  flag: 'flagged',
  remove: 'rejected',
  shadow: 'shadowed',
  shadow_block: 'shadowed',
};
// Worst-wins ordering for the session's aggregate moderationStatus.
const STATUS_SEVERITY = { approved: 0, flagged: 1, rejected: 2, shadowed: 3 };

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Returns the day-of-week number (0=Sun…6=Sat) for a given date string
 */
const getDayOfWeek = dateStr => new Date(dateStr).getDay();

/**
 * "HH:MM" → total minutes from midnight
 */
const timeToMins = t => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const EARTH_RADIUS_KM = 6371;
const DEFAULT_TALENT_SEARCH_RADIUS_KM = 50;



/**
 * Great-circle distance between two lat/lng points, in kilometers.
 * Used to filter talent by proximity to a searched location (mirrors the
 * lat/lng radius approach used by events/discover).
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ─── MEDIA VALIDATOR ──────────────────────────────────────────────────────────

const validateMedia = media => {
  if (!Array.isArray(media)) throw new ApiError(400, '`media` must be an array');
  if (media.length > 5) throw new ApiError(400, '`media` can contain at most 5 items');
  for (const item of media) {
    if (!item.url || typeof item.url !== 'string' || !item.url.startsWith('http'))
      throw new ApiError(400, 'Each media item must have a valid `url`');
    if (!['image', 'video'].includes(item.type))
      throw new ApiError(400, 'Each media item `type` must be "image" or "video"');
    if (item.caption !== undefined && item.caption !== null) {
      if (typeof item.caption !== 'string')
        throw new ApiError(400, 'Each media item `caption` must be a string');
      if (item.caption.length > 100)
        throw new ApiError(400, 'Each media item `caption` must be 100 characters or less');
    }
  }
};
/**
 * Applies a priceOverrides map to a base price.
 * overrides: { "09:00-12:00": 1.2, ... }
 * slotTime: "09:30"
 */
const applyPriceOverride = (basePriceCents, slotTime, priceOverrides = {}) => {
  const slotMins = timeToMins(slotTime);
  for (const [range, multiplier] of Object.entries(priceOverrides)) {
    const [start, end] = range.split('-');
    if (slotMins >= timeToMins(start) && slotMins < timeToMins(end)) {
      return Math.round(basePriceCents * multiplier);
    }
  }
  return basePriceCents;
};
const normalizeUserImage = user => {
  if (!user) return user;
  return { ...user, profileImage: user.profileImage || user.image || null };
};
/**
 * Send both in-app notification and email for a session event.
 * Errors are caught and logged so they never break the main flow.
 */
const notifyAndEmail = async ({
  userId,
  title,
  message,
  type,
  redirectTo,
  relatedId,
  actorUserId,
  emailFn,
}) => {
  try {
    await createNotification({
      userId,
      title,
      message,
      type,
      redirectTo,
      relatedId,
      metadata: { sessionId: relatedId, ...(actorUserId && { actorUserId }) },
    });
  } catch (err) {
    console.error('Notification error:', err.message);
  }
  try {
    if (emailFn) await emailFn();
  } catch (err) {
    console.error('Email error:', err.message);
  }
};

// ─── TALENT PROFILE SERVICE ───────────────────────────────────────────────────

export class TalentProfileService {
    static async create(userId, data) {
    const existing = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    if (existing) throw new ApiError(409, 'Talent profile already exists for this user');

    if (data.media !== undefined) validateMedia(data.media);

    if (data.rates !== undefined) {
      const invalidRate = Object.values(data.rates).find(v => Number(v) < 20);
      if (invalidRate !== undefined) throw new ApiError(400, 'Session rates must be at least $20');
    }

    const profileModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.PROFILE,
      entityCreatorId: userId,
      texts: [data.title, data.bio],
    });

    const [profile] = await db
      .insert(talentProfiles)
      .values({
        userId,
        category: data.category,
        title: data.title,
        bio: data.bio,
        location: data.location,
        city: data.city,
        state: data.state,
        country: data.country,
        countryCode: data.countryCode,
        latitude: data.latitude !== undefined ? String(data.latitude) : undefined,
        longitude: data.longitude !== undefined ? String(data.longitude) : undefined,
        introVideoUrl: data.introVideoUrl,
        showShopProducts: data.showShopProducts ?? false,
        rates: data.rates || {},
        languages: data.languages || [],
        experience: data.experience || [],
        education: data.education || [],
        qualifications: data.qualifications || [],
        skills: data.skills || [],
        priorityMessageFee: data.priorityMessageFee ?? 2000,
        media: data.media ?? [],
      })
      .returning();

    await TextModerationService.recordIfFlagged(profileModeration, {
      entityType: TEXT_ENTITY.TALENT_PROFILE,
      entityId: profile.id,
      userId,
      fieldNames: ['title', 'bio'],
      texts: [data.title, data.bio],
    });

    // Fire-and-forget: create Connect account prefilled with user email (talent = individual).
    db.query.users
      .findFirst({ where: eq(users.id, userId), columns: { email: true } })
      .then(user =>
        StripeConnectService.createAccount(userId).then(account =>
          StripeConnectService.prefillAccount(account.stripeAccountId, {
            email: user?.email,
            businessType: 'individual',
          })
        )
      )
      .catch(err => {
        if (!err.message?.includes('already exists')) {
          console.error('[Stripe] Auto connect account setup failed for talent:', err.message);
        }
      });

    return profile;
  }

static async update(userId, data) {
    if (data.media !== undefined) validateMedia(data.media);

    // Drizzle's decimal columns expect strings, not raw numbers.
    if (data.latitude !== undefined) data.latitude = String(data.latitude);
    if (data.longitude !== undefined) data.longitude = String(data.longitude);

    if (data.rates !== undefined) {
      const invalidRate = Object.values(data.rates).find(v => Number(v) < 20);
      if (invalidRate !== undefined) throw new ApiError(400, 'Session rates must be at least $20');
    }

    const talentTextEntries = [
      ['title', data.title],
      ['bio', data.bio],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    let profileModeration = { action: 'keep' };
    if (talentTextEntries.length > 0) {
      profileModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.PROFILE,
        entityCreatorId: userId,
        texts: talentTextEntries.map(([, value]) => value),
      });
    }

    // socialLinks lives in the separate organizer_social_links table, not on
    // talentProfiles — pull it out before the profile-row update below.
    const { socialLinks, ...profileData } = data;

    const [updated] = await db
      .update(talentProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(and(eq(talentProfiles.userId, userId), isNull(talentProfiles.deletedAt)))
      .returning();
    if (!updated) throw new ApiError(404, 'Talent profile not found');

    await TextModerationService.recordIfFlagged(profileModeration, {
      entityType: TEXT_ENTITY.TALENT_PROFILE,
      entityId: updated.id,
      userId,
      fieldNames: talentTextEntries.map(([name]) => name),
      texts: talentTextEntries.map(([, value]) => value),
    });

    // ── Upsert social links (shared table with organizers) ─────────────────
    if (socialLinks) {
      const { instagram, twitter, facebook, linkedin, youtube } = socialLinks;
      await db
        .insert(organizerSocialLinks)
        .values({
          talentProfileId: updated.id,
          instagram: instagram || null,
          twitter: twitter || null,
          facebook: facebook || null,
          linkedin: linkedin || null,
          youtube: youtube || null,
        })
        .onConflictDoUpdate({
          target: organizerSocialLinks.talentProfileId,
          set: {
            instagram: instagram || null,
            twitter: twitter || null,
            facebook: facebook || null,
            linkedin: linkedin || null,
            youtube: youtube || null,
            updatedAt: new Date(),
          },
        });
    }

    return updated;
  }

  static async list({ category, minRating, language, page = 1, limit = 20 } = {}) {
    const query = db.query.talentProfiles.findMany({
      where: and(
        eq(talentProfiles.isActive, true),
        isNull(talentProfiles.deletedAt),
        category ? eq(talentProfiles.category, category) : undefined,
        minRating ? gte(talentProfiles.rating, String(minRating)) : undefined
      ),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            image: true,
          },
        },
      },
      limit,
      offset: (page - 1) * limit,
      orderBy: (t, { desc }) => [desc(t.rating)],
    });

    let results = await query;
    results = results.map(t => ({ ...t, user: normalizeUserImage(t.user) }));

    // Language filter (jsonb array — easier in-app than SQL for now)
    if (language) {
      results = results.filter(t => Array.isArray(t.languages) && t.languages.includes(language));
    }

    return results;
  }

  // Feature availability flags for a single talent — same shape the list sends.
  // Frontend uses these to disable "book session" / "priority message".
   static async _featureFlags(talentUserId, priorityMessagingEnabled = true) {
    const featureMap = await SubscriptionService.getActiveFeaturesForUsers([talentUserId]);
    const feats = featureMap.get(talentUserId);
    return {
      priorityMessagingAvailable:
        (feats?.has(FEATURES.PRIORITY_MESSAGING) ?? false) && priorityMessagingEnabled !== false,
      videoBookingAvailable: feats?.has(FEATURES.VIDEO_BOOKING) ?? false,
    };
  }

   static async _getShopProductsForProfile(profile, viewerId) {
    if (!profile.showShopProducts) return null;

    try {
      const { products, pinnedProducts } = await ShopProductService.listForUser(
        profile.userId,
        viewerId
      );
      return { products, pinnedProducts };
    } catch (err) {
      // Never let a shop-fetch failure break the talent profile page.
      console.error('[TalentProfile] Failed to load shop products:', err.message);
      return null;
    }
  }

 static async getById(profileId, userId = null) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, profileId), isNull(talentProfiles.deletedAt)),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            image: true,
          },
        },
        socialLinks: true,
      },
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    let isLiked = false;
    if (userId) {
      const fav = await db.query.talentFavorites.findFirst({
        where: and(
          eq(talentFavorites.userId, userId),
          eq(talentFavorites.talentProfileId, profileId)
        ),
        columns: { id: true },
      });
      isLiked = !!fav;
    }

    const reviewStatus = await TalentProfileService._getReviewStatus(
      profile.id,
      userId,
      profile.userId
    );
    const featureFlags = await TalentProfileService._featureFlags(
      profile.userId,
      profile.priorityMessagingEnabled
    );
    const talentFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedTextSingle(profile, {
      entityType: TEXT_ENTITY.TALENT_PROFILE,
      fields: ['title', 'bio'],
      filterEnabled: talentFilterEnabled,
    });

    // ← ADD THIS
    const shop = await TalentProfileService._getShopProductsForProfile(profile, userId);

    return {
      ...profile,
      user: normalizeUserImage(profile.user),
      isLiked,
      reviewStatus,
      ...featureFlags,
      // ← ADD THESE TWO LINES
      shopProducts: shop?.products ?? [],
      pinnedShopProducts: shop?.pinnedProducts ?? [],
    };
  }

  static async getByUsername(username, userId = null) {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: { id: true },
    });
    if (!user) throw new ApiError(404, 'User not found');

    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.userId, user.id), isNull(talentProfiles.deletedAt)),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            image: true,
          },
        },
        socialLinks: true,
      },
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    const reviewStatus = await TalentProfileService._getReviewStatus(
      profile.id,
      userId,
      profile.userId
    );
    const featureFlags = await TalentProfileService._featureFlags(
      profile.userId,
      profile.priorityMessagingEnabled
    );
    const talentFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedTextSingle(profile, {
      entityType: TEXT_ENTITY.TALENT_PROFILE,
      fields: ['title', 'bio'],
      filterEnabled: talentFilterEnabled,
    });

    // ← ADD THIS
    const shop = await TalentProfileService._getShopProductsForProfile(profile, userId);

    return {
      ...profile,
      user: normalizeUserImage(profile.user),
      reviewStatus,
      ...featureFlags,
      // ← ADD THESE TWO LINES
      shopProducts: shop?.products ?? [],
      pinnedShopProducts: shop?.pinnedProducts ?? [],
    };
  }

  /**
   * Compute review eligibility for a viewer on a talent profile.
   *
   * Returns:
   *   { canReview: false, source: null, sourceId: null, existingReviewId: null }
   *   — viewer is not logged in, is the talent themselves, or has no qualifying interaction
   *
   *   { canReview: true, source: 'session'|'priority_message', sourceId: uuid, existingReviewId: null }
   *   — viewer has an unreviewed completed session or paid priority message
   *
   *   { canReview: false, source: 'session'|'priority_message', sourceId: uuid, existingReviewId: uuid }
   *   — viewer already left a review (use existingReviewId for the PATCH /reviews/:id edit endpoint)
   */
  static async _getReviewStatus(talentProfileId, viewerId, talentUserId) {
    const none = { canReview: false, source: null, sourceId: null, existingReviewId: null };

    // Must be logged in and not viewing their own profile
    if (!viewerId || viewerId === talentUserId) return none;

    // ── Check completed sessions ─────────────────────────────────────────
    const completedSessions = await db.query.talentSessions.findMany({
      where: and(
        eq(talentSessions.talentProfileId, talentProfileId),
        eq(talentSessions.bookerId, viewerId),
        eq(talentSessions.status, 'completed')
      ),
      columns: { id: true },
    });

    for (const session of completedSessions) {
      const review = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.sessionId, session.id),
        columns: { id: true },
      });
      if (!review) {
        return { canReview: true, source: 'session', sourceId: session.id, existingReviewId: null };
      }
      // Already reviewed this session — surface the edit option
      return {
        canReview: false,
        source: 'session',
        sourceId: session.id,
        existingReviewId: review.id,
      };
    }

    // ── Check paid priority messages ─────────────────────────────────────
    const paidMessages = await db.query.priorityMessagePayments.findMany({
      where: and(
        eq(priorityMessagePayments.talentProfileId, talentProfileId),
        eq(priorityMessagePayments.senderId, viewerId),
        eq(priorityMessagePayments.status, 'paid')
      ),
      columns: { id: true },
    });

        for (const msg of paidMessages) {
      const review = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.priorityMessageId, msg.id),
        columns: { id: true },
      });
      if (!review) {
        return {
          canReview: true,
          source: 'priority_message',
          sourceId: msg.id,
          existingReviewId: null,
        };
      }
      return {
        canReview: false,
        source: 'priority_message',
        sourceId: msg.id,
        existingReviewId: review.id,
      };
    }

    // ── Check completed custom offers ──────────────────────────────────────
    const completedOffers = await db.query.shopCustomServiceOffers.findMany({
      where: and(
        eq(shopCustomServiceOffers.sellerId, talentUserId),
        eq(shopCustomServiceOffers.buyerId, viewerId),
        eq(shopCustomServiceOffers.status, 'completed')
      ),
      columns: { id: true },
    });

    for (const offer of completedOffers) {
      const review = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.shopCustomOfferId, offer.id),
        columns: { id: true },
      });
      if (!review) {
        return {
          canReview: true,
          source: 'shop_custom_offer',
          sourceId: offer.id,
          existingReviewId: null,
        };
      }
      return {
        canReview: false,
        source: 'shop_custom_offer',
        sourceId: offer.id,
        existingReviewId: review.id,
      };
    }

    return none;
  }


    static async getByUserId(userId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.userId, userId), isNull(talentProfiles.deletedAt)),
      with: {
        socialLinks: true, 
      },
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');
    const featureFlags = await TalentProfileService._featureFlags(
      profile.userId,
      profile.priorityMessagingEnabled
    );
    const talentFilterEnabled = await TextModerationService.getFilterEnabled(userId);
    await TextModerationService.maskFlaggedTextSingle(profile, {
      entityType: TEXT_ENTITY.TALENT_PROFILE,
      fields: ['title', 'bio'],
      filterEnabled: talentFilterEnabled,
    });
    const shop = await TalentProfileService._getShopProductsForProfile(profile, userId);

    return {
      ...profile,
      ...featureFlags,
      // ← ADD THESE TWO LINES
      shopProducts: shop?.products ?? [],
      pinnedShopProducts: shop?.pinnedProducts ?? [],
    };
  }
}

// ─── AVAILABILITY SERVICE ─────────────────────────────────────────────────────

export class TalentAvailabilityService {
  // ── Upsert weekly windows (existing — unchanged) ──────────────────────────
  /**
   * Upsert-or-create a talent profile + save availability in one request.
   * Called by ManageSchedule on both first-time setup and subsequent saves.
   *
   * First-time (no existing profile):
   *   - `title` and `category` are required
   *   - Creates the talent profile with safe defaults
   *
   * Returning talent:
   *   - Updates rates and isActive on the existing profile
   *
   * Always:
   *   - Replaces all availability windows
   *   - Upserts date overrides if provided
   *
   * @param {string} userId
   * @param {{ isActive, rates, windows, dateOverrides, title?, category? }} input
   */
static async saveSchedule(
    userId,
    { isActive, rates, windows, dateOverrides, title, category, city, state, country, countryCode, latitude, longitude }
  ) {
    if (rates !== undefined) {
      const invalidRate = Object.values(rates).find(v => Number(v) < 20);
      if (invalidRate !== undefined) throw new ApiError(400, 'Session rates must be at least $20');
    }

    // ── 1. Get or create the talent profile ─────────────────────────────────
    let profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.userId, userId), isNull(talentProfiles.deletedAt)),
    });

    if (!profile) {
      // First-time — title and category are required to appear on the discovery page
      if (!title?.trim()) {
        throw new ApiError(
          400,
          '`title` is required when setting up your talent profile for the first time'
        );
      }
      if (!category?.trim()) {
        throw new ApiError(
          400,
          '`category` is required when setting up your talent profile for the first time'
        );
      }

      const titleModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.PROFILE,
        entityCreatorId: userId,
        texts: [title],
      });

      [profile] = await db
        .insert(talentProfiles)
        .values({
          userId,
          title: title.trim(),
          category: category.trim(),
          rates: rates || {},
          languages: [],
          media: [],
          city,
          state,
          country,
          countryCode,
          latitude: latitude !== undefined ? String(latitude) : undefined,
          longitude: longitude !== undefined ? String(longitude) : undefined,
          isActive: isActive !== undefined ? !!isActive : true,
          isVerified: false,
          priorityMessageFee: 500, // $5.00 default, talent can change later
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await TextModerationService.recordIfFlagged(titleModeration, {
        entityType: TEXT_ENTITY.TALENT_PROFILE,
        entityId: profile.id,
        userId,
        fieldNames: ['title'],
        texts: [title.trim()],
      });
    } else {
      // Returning talent — update rates and active status
      [profile] = await db
        .update(talentProfiles)
        .set({
          rates,
          isActive: isActive !== undefined ? !!isActive : profile.isActive,
          updatedAt: new Date(),
        })
        .where(eq(talentProfiles.id, profile.id))
        .returning();
    }

    // ── 2. Replace availability windows ─────────────────────────────────────
    await db.delete(talentAvailability).where(eq(talentAvailability.talentProfileId, profile.id));

    let savedWindows = [];
    if (Array.isArray(windows) && windows.length > 0) {
      savedWindows = await db
        .insert(talentAvailability)
        .values(windows.map(w => ({ ...w, talentProfileId: profile.id })))
        .returning();
    }

    // ── 3. Upsert date overrides if provided ────────────────────────────────
    if (Array.isArray(dateOverrides) && dateOverrides.length > 0) {
      await TalentAvailabilityService.upsertDateOverrides(userId, dateOverrides);
    }

    return { profile, availability: savedWindows };
  }

  static async upsert(talentProfileId, windows) {
    await db
      .delete(talentAvailability)
      .where(eq(talentAvailability.talentProfileId, talentProfileId));
    if (!windows || windows.length === 0) return [];
    const rows = windows.map(w => ({ talentProfileId, ...w }));
    return await db.insert(talentAvailability).values(rows).returning();
  }

  // ── Get weekly windows for a profile (existing — unchanged) ───────────────
  static async getForProfile(talentProfileId) {
    return await db.query.talentAvailability.findMany({
      where: and(
        eq(talentAvailability.talentProfileId, talentProfileId),
        eq(talentAvailability.isActive, true)
      ),
    });
  }

  // ── NEW: Get weekly windows for the authenticated talent (used by /manage-schedule load) ─
  static async getMyAvailability(userId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    return await db.query.talentAvailability.findMany({
      where: and(
        eq(talentAvailability.talentProfileId, profile.id),
        eq(talentAvailability.isActive, true)
      ),
    });
  }
  static async upsertDateOverrides(userId, overrides) {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    if (!Array.isArray(overrides) || overrides.length === 0) return [];

    const results = [];

    for (const entry of overrides) {
      const { date: overrideDate, isBlocked = false, slots = [] } = entry;

      if (!overrideDate || !/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
        throw new ApiError(400, `Invalid date format: "${overrideDate}". Use YYYY-MM-DD.`);
      }

      // Delete all existing rows for this talent + date
      await db
        .delete(talentDateOverrides)
        .where(
          and(
            eq(talentDateOverrides.talentProfileId, profile.id),
            eq(talentDateOverrides.overrideDate, overrideDate)
          )
        );

      // If isBlocked → insert one row with isBlocked=true
      if (isBlocked) {
        const [row] = await db
          .insert(talentDateOverrides)
          .values({
            talentProfileId: profile.id,
            overrideDate,
            isBlocked: true,
            startTime: null,
            endTime: null,
          })
          .returning();
        results.push(row);
        continue;
      }

      // If slots is empty → just deleted (clears any override → falls back to weekly)
      if (slots.length === 0) continue;

      // Insert one row per slot window
      for (const slot of slots) {
        if (!slot.startTime || !slot.endTime) {
          throw new ApiError(400, 'Each slot must have startTime and endTime (HH:MM).');
        }
        const [row] = await db
          .insert(talentDateOverrides)
          .values({
            talentProfileId: profile.id,
            overrideDate,
            isBlocked: false,
            startTime: slot.startTime,
            endTime: slot.endTime,
          })
          .returning();
        results.push(row);
      }
    }

    return results;
  }
  static async getDateOverridesForProfile(talentProfileId, daysAhead = 90) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + daysAhead);

    const todayStr = today.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    const rows = await db.query.talentDateOverrides.findMany({
      where: and(
        eq(talentDateOverrides.talentProfileId, talentProfileId),
        gte(talentDateOverrides.overrideDate, todayStr),
        lte(talentDateOverrides.overrideDate, maxDateStr)
      ),
      orderBy: (t, { asc }) => [asc(t.overrideDate), asc(t.startTime)],
    });

    // Group by date
    const grouped = {};
    for (const row of rows) {
      const d = row.overrideDate;
      if (!grouped[d]) {
        grouped[d] = { isBlocked: row.isBlocked, slots: [] };
      }
      if (!row.isBlocked && row.startTime && row.endTime) {
        grouped[d].slots.push({ startTime: row.startTime, endTime: row.endTime });
      }
      if (row.isBlocked) {
        grouped[d].isBlocked = true;
      }
    }

    return grouped;
  }
  static async getMyDateOverrides(userId, daysAhead = 90) {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');
    return TalentAvailabilityService.getDateOverridesForProfile(profile.id, daysAhead);
  }
  /**
   * Toggle favourite.
   * Returns { action: 'added' | 'removed', talentProfileId }
   */
  static async toggle(userId, talentProfileId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, talentProfileId), isNull(talentProfiles.deletedAt)),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    const existing = await db.query.talentFavorites.findFirst({
      where: and(
        eq(talentFavorites.userId, userId),
        eq(talentFavorites.talentProfileId, talentProfileId)
      ),
    });

    if (existing) {
      await db.delete(talentFavorites).where(eq(talentFavorites.id, existing.id));
      return { action: 'removed', talentProfileId };
    }

    await db.insert(talentFavorites).values({ userId, talentProfileId });
    return { action: 'added', talentProfileId };
  }
  static async getFavoriteIds(userId) {
    const rows = await db.query.talentFavorites.findMany({
      where: eq(talentFavorites.userId, userId),
    });
    return rows.map(r => r.talentProfileId);
  }

  /**
   * Generate available time slots for a given date and duration.
   *
   * Priority:
   *   1. If date is blocked → return []
   *   2. If date-specific override slots exist → use ONLY those windows
   *   3. Otherwise → use recurring weekly talent_availability windows
   *
   * @param {string} talentProfileId
   * @param {string} date  - "YYYY-MM-DD"
   * @param {number} durationMins - 15 | 30 | 45 | 60
   * @returns {Array} [{ time: "09:00", durationMins, priceCents, available }]
   */
  static async getAvailableSlots(talentProfileId, date, durationMins) {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.id, talentProfileId),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    console.log('=== SLOTS DEBUG ===');
    console.log('talentProfileId:', talentProfileId);
    console.log('date:', date);
    console.log('durationMins:', durationMins);
    console.log('profile.rates:', profile.rates);

    const baseRates = profile.rates || {};
    const basePriceCents = Math.round((baseRates[String(durationMins)] || 0) * 100);

    console.log('basePriceCents:', basePriceCents);
    console.log('rate key lookup:', String(durationMins), '→', baseRates[String(durationMins)]);

    if (basePriceCents === 0) {
      console.log('❌ RETURNING EARLY: basePriceCents is 0 — talent has no rate for this duration');
      throw new ApiError(400, `Talent does not offer ${durationMins}-min sessions`);
    }

    const overrideRows = await db.query.talentDateOverrides.findMany({
      where: and(
        eq(talentDateOverrides.talentProfileId, talentProfileId),
        eq(talentDateOverrides.overrideDate, date)
      ),
    });
    console.log('overrideRows:', JSON.stringify(overrideRows));

    if (overrideRows.some(r => r.isBlocked)) {
      console.log('❌ RETURNING EARLY: date is blocked by override');
      return [];
    }

    let windowsToUse = null;

    if (overrideRows.length > 0) {
      windowsToUse = overrideRows
        .filter(r => !r.isBlocked && r.startTime && r.endTime)
        .map(r => ({
          startTime: r.startTime,
          endTime: r.endTime,
          durations: Object.keys(baseRates).map(Number),
          priceOverrides: {},
        }));
      if (windowsToUse.length === 0) windowsToUse = null;
    }

    if (!windowsToUse) {
      // ✅ FIX: Use UTC to calculate day-of-week so server timezone never shifts the date.
      // new Date(year, month-1, day) uses LOCAL time — if server is UTC+5:30 and it's
      // near midnight, the parsed date can land on the wrong UTC day.
      // Appending T12:00:00Z anchors to UTC noon — immune to any UTC± offset.
      const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
      console.log('dayOfWeek calculated (UTC):', dayOfWeek, '(0=Sun, 1=Mon, ..., 6=Sat)');

      const allWindows = await db.query.talentAvailability.findMany({
        where: and(
          eq(talentAvailability.talentProfileId, talentProfileId),
          eq(talentAvailability.isActive, true)
        ),
      });
      console.log('allWindows from DB:', JSON.stringify(allWindows, null, 2));

      if (allWindows.length === 0) {
        console.log('❌ RETURNING EARLY: no availability windows saved for this talent');
        return [];
      }

      allWindows.forEach((w, i) => {
        console.log(
          `window[${i}] dayOfWeek array:`,
          w.dayOfWeek,
          '| includes(',
          dayOfWeek,
          '):',
          w.dayOfWeek?.includes(dayOfWeek),
          '| durations:',
          w.durations,
          '| includes(',
          durationMins,
          '):',
          w.durations?.includes(durationMins),
          '| isActive:',
          w.isActive
        );
      });

      const matchingWindows = allWindows.filter(
        w =>
          Array.isArray(w.dayOfWeek) &&
          w.dayOfWeek.includes(dayOfWeek) &&
          Array.isArray(w.durations) &&
          w.durations.includes(durationMins) &&
          !(Array.isArray(w.blockedDates) && w.blockedDates.includes(date))
      );
      console.log('matchingWindows:', JSON.stringify(matchingWindows, null, 2));

      if (matchingWindows.length === 0) {
        console.log('❌ RETURNING EARLY: no windows match this dayOfWeek + durationMins combo');
        return [];
      }
      windowsToUse = matchingWindows;
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const bookedSessions = await db.query.talentSessions.findMany({
      where: and(
        eq(talentSessions.talentProfileId, talentProfileId),
        gte(talentSessions.scheduledAt, dayStart),
        lte(talentSessions.scheduledAt, dayEnd),
        or(
          eq(talentSessions.status, 'awaiting_payment'),
          eq(talentSessions.status, 'pending'),
          eq(talentSessions.status, 'confirmed'),
          eq(talentSessions.status, 'live')
        )
      ),
    });
    console.log('bookedSessions count:', bookedSessions.length);

    const timeToMinsLocal = t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const applyPriceOverrideLocal = (base, slotTime, overrides = {}) => {
      const slotMins = timeToMinsLocal(slotTime);
      for (const [range, multiplier] of Object.entries(overrides)) {
        const [start, end] = range.split('-');
        if (slotMins >= timeToMinsLocal(start) && slotMins < timeToMinsLocal(end)) {
          return Math.round(base * multiplier);
        }
      }
      return base;
    };

    const talentTz = windowsToUse[0]?.timezone || 'UTC';
    const busyRanges = bookedSessions.map(s => {
      const localTime = dayjs(s.scheduledAt).tz(talentTz);
      const startMins = localTime.hour() * 60 + localTime.minute();
      return [startMins, startMins + s.durationMins];
    });

    const isSlotBusy = slotMins =>
      busyRanges.some(([bStart, bEnd]) => slotMins < bEnd && slotMins + durationMins > bStart);

    const slots = [];

    for (const win of windowsToUse) {
      let cursor = timeToMinsLocal(win.startTime);
      const endMins = timeToMinsLocal(win.endTime);
      console.log(
        `window: ${win.startTime} → ${win.endTime} | cursor:${cursor} endMins:${endMins}`
      );

      while (cursor + durationMins <= endMins) {
        const hh = String(Math.floor(cursor / 60)).padStart(2, '0');
        const mm = String(cursor % 60).padStart(2, '0');
        const time = `${hh}:${mm}`;
        const priceCents = applyPriceOverrideLocal(basePriceCents, time, win.priceOverrides || {});
        slots.push({ time, durationMins, priceCents, available: !isSlotBusy(cursor) });
        cursor += durationMins;
      }
    }

    const seen = new Set();
    const result = slots.filter(s => {
      if (seen.has(s.time)) return false;
      seen.add(s.time);
      return true;
    });

    console.log('✅ FINAL slots count:', result.length);
    console.log('=== END SLOTS DEBUG ===');

    return result;
  }
}

// ─── SESSION SERVICE ──────────────────────────────────────────────────────────

export class TalentSessionService {
  // ── Initiate Stripe Checkout for a session booking ────────────────────────

  static async createCheckout({
    talentProfileId,
    bookerId,
    date,
    time,
    durationMins,
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
    platform,
  }) {
    if (!stripe) throw new ApiError(503, 'Payment processing is not configured');

    const slots = await TalentAvailabilityService.getAvailableSlots(
      talentProfileId,
      date,
      durationMins
    );
    const slot = slots.find(s => s.time === time && s.available);
    if (!slot) throw new ApiError(409, 'This time slot is no longer available');

    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.id, talentProfileId),
      with: { user: true },
    });
    if (!profile) throw new ApiError(404, 'Talent not found');

    // Talent must have an active subscription with the video_booking feature,
    // otherwise they cannot confirm the session — don't take the booker's money.
    const canBook = await SubscriptionService.checkFeatureAccess(
      profile.userId,
      FEATURES.VIDEO_BOOKING
    );
    if (!canBook) {
      throw new ApiError(403, 'This talent is not currently accepting video bookings');
    }

    const booker = await db.query.users.findFirst({ where: eq(users.id, bookerId) });
    if (!booker) throw new ApiError(404, 'Booker not found');

    // Get talent timezone from their availability windows
    const availWindows = await TalentAvailabilityService.getForProfile(talentProfileId);
    const talentTz = availWindows[0]?.timezone || 'UTC';

    // Convert talent local time → UTC
    const scheduledAt = dayjs.tz(`${date}T${time}:00`, talentTz).utc().toDate();
    const joinAllowedAt = new Date(scheduledAt.getTime() - 5 * 60 * 1000);

    const callId = randomUUID();
    const streamCall = await StreamCallService.createCall({
      cid: callId,
      type: 'talent-session',
      created_by_user_id: bookerId,
      starts_at: scheduledAt,
      members: [
        { user_id: bookerId, role: 'user' },
        { user_id: profile.userId, role: 'admin' },
      ],
      custom: { isTalentSession: true, talentProfileId, bookerId, subject, durationMins },
    });

    const [session] = await db
      .insert(talentSessions)
      .values({
        talentProfileId,
        bookerId,
        scheduledAt,
        durationMins,
        joinAllowedAt,
        priceCents: slot.priceCents,
        status: 'awaiting_payment',
        subject: subject || '',
        discussion,
        isGift: !!isGift,
        giftDetails: giftDetails || {},
        giftCode: giftCode || null,
        streamCallCid: streamCall.cid || callId,
      })
      .returning();

    const talentName = `${profile.user.firstName} ${profile.user.lastName}`;

    // Fee structure:
    //   talentDeductionCents    = base × 0.05 — talent's marketplace commission (talent keeps 95%)
    //   orderProcessingFeeCents = flat, tiered by base (utils/orderProcessingFee.js) — 100% Briteside revenue
    //   platformFeeCents        = base × 0.05 — separate, additional charge, 100% Briteside revenue
    //   chargedCents            = base + orderProcessingFee + platformFee. Stripe's own processing
    //                             cost is Briteside-absorbed, not grossed up onto the booker.
    //   application_fee         = orderProcessingFee + platformFee + talent's commission
    const basePriceCents = slot.priceCents;
    const talentDeductionCents = Math.round(basePriceCents * 0.05);
    const talentPriceCents = basePriceCents;
    const orderProcessingFeeCents = calculateOrderProcessingFeeCents(basePriceCents);
    const platformFeeCents = Math.round(basePriceCents * 0.05);
    const chargedCents = basePriceCents + orderProcessingFeeCents + platformFeeCents;
    const applicationFeeCents = orderProcessingFeeCents + platformFeeCents + talentDeductionCents;
    // Stripe's actual processing cost is a separate, Briteside-absorbed expense —
    // tracked for reporting only, never charged to the booker or the talent.
    const estimatedStripeFeeCents = Math.round(chargedCents * 0.029) + 30;

    let connectAccount = await StripeConnectService.getForUser(profile.userId);
    // Self-heal: chargesEnabled only updates via webhook or the talent visiting
    // their earnings page — if it's stale-false, re-check Stripe live rather
    // than silently routing this booking's full amount to the platform.
    if (connectAccount && !connectAccount.chargesEnabled) {
      connectAccount = await StripeConnectService.syncStatus(profile.userId).catch(
        () => connectAccount
      );
    }

    const redirectUrls = getRedirectUrls(
      platform,
      FRONTEND_URL,
      '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=success',
      '/bookings?checkout_session_id={CHECKOUT_SESSION_ID}&status=cancelled'
    );

    const checkoutParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
            line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: talentPriceCents,
            product_data: {
              name: `${durationMins}-min session with ${talentName}`,
              description: subject || `Booked for ${date} at ${time}`,
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: platformFeeCents,
            product_data: {
              name: 'Platform fee (5%)',
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: orderProcessingFeeCents,
            product_data: {
              name: 'Order Processing Fee',
              description: 'Non-refundable order processing fee',
            },
          },
          quantity: 1,
        },
      ],
      success_url: redirectUrls.successUrl,
      cancel_url: redirectUrls.cancelUrl,
      customer_email: booker.email,
      metadata: {
        type: 'talent_session',
        sessionId: session.id,
        bookerId,
        talentUserId: profile.userId,
      },
    };

    if (connectAccount?.chargesEnabled) {
      checkoutParams.payment_intent_data = {
        application_fee_amount: applicationFeeCents,
        transfer_data: { destination: connectAccount.stripeAccountId },
        metadata: {
          type: 'talent_session',
          sessionId: session.id,
          bookerId,
          talentUserId: profile.userId,
        },
      };
    }

    const stripeSession = await stripe.checkout.sessions.create(checkoutParams);

    await db
      .update(talentSessions)
      .set({
        stripeSessionId: stripeSession.id,
        reserveAmountCents: 0,
        platformShareCents: applicationFeeCents,
        // Estimate now; the webhook overwrites with the real balance_transaction.fee.
        stripeFeeCents: estimatedStripeFeeCents,
        updatedAt: new Date(),
      })
      .where(eq(talentSessions.id, session.id));

    return { checkoutUrl: stripeSession.url, sessionId: session.id };
  }

  // ── Handle Stripe webhook after payment confirmed ─────────────────────────

  static async handlePaymentWebhook(stripeSession, io) {
    const { sessionId, bookerId: bookerIdMeta, talentUserId } = stripeSession.metadata ?? {};
    if (!sessionId) {
      console.error('[TalentSession] Webhook missing sessionId');
      return;
    }

    const existing = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });
    if (!existing) {
      console.error('[TalentSession] Session not found:', sessionId);
      return;
    }

    // Gift purchases: status = gift_purchased (not pending) — recipient books separately
    const newStatus = existing.isGift ? 'gift_purchased' : 'pending';

    // Atomic claim, not a SELECT-then-UPDATE: Stripe can redeliver the same
    // event, or fire both `checkout.session.completed` and
    // `checkout.session.async_payment_succeeded` for one payment. A plain
    // status check in JS let two near-simultaneous deliveries both read
    // 'awaiting_payment' before either wrote, so both proceeded to notify —
    // the double "New session request" / "Booking request sent" bug. The
    // WHERE status='awaiting_payment' means only one concurrent caller's
    // update can actually affect a row.
    const [session] = await db
      .update(talentSessions)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(talentSessions.id, sessionId), eq(talentSessions.status, 'awaiting_payment')))
      .returning();

    if (!session) {
      console.log('[TalentSession] Already processed:', sessionId);
      return;
    }

    let stripeFeeCents = 0;
    // Also captures transferId — records whether Stripe actually created the
    // Connect transfer for this charge, so a cron audit can spot payments
    // where the talent's cut is stuck in the platform balance.
    let transferId = null;
    if (stripe && stripeSession.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(stripeSession.payment_intent, {
          expand: ['latest_charge.balance_transaction'],
        });
        stripeFeeCents = pi.latest_charge?.balance_transaction?.fee ?? 0;
        transferId = pi.latest_charge?.transfer ?? null;
      } catch (err) {
        console.warn('[TalentSession] Could not retrieve Stripe fee:', err.message);
      }
    }

    await db
      .update(talentSessions)
      .set({
        stripeSessionId: stripeSession.id,
        stripePaymentIntentId: stripeSession.payment_intent ?? null,
        stripeFeeCents,
        transferId,
        transferredAt: transferId ? new Date() : null,
      })
      .where(eq(talentSessions.id, sessionId));

    if (session.giftCode) {
      await GiftCodeService.redeem(
        session.giftCode,
        session.talentProfileId,
        session.durationMins,
        session.id
      ).catch(err => console.error('[GiftCode] redeem failed:', err.message));
    }
    if (session.isGift && session.giftDetails?.recipientEmail) {
      await GiftCodeService.generate({
        gifterId: session.bookerId,
        talentProfileId: session.talentProfileId,
        durationMins: session.durationMins,
        priceCents: session.priceCents,
        recipientName: session.giftDetails.recipientName ?? null,
        recipientEmail: session.giftDetails.recipientEmail,
        recipientPhone: session.giftDetails.recipientPhone ?? null,
        occasion: session.giftDetails.occasion ?? null,
        personalMessage: session.giftDetails.message ?? null,
        deliveryDate: session.giftDetails.deliveryDate ?? null,
      }).catch(err => console.error('[GiftCode] generate failed:', err.message));
    }

    const [booker, profile] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, session.bookerId) }),
      db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.id, session.talentProfileId),
        with: { user: true },
      }),
    ]);
    const talentUser = profile.user;
    const talentName = `${talentUser.firstName} ${talentUser.lastName}`;

    UserSpendService.recordSpend({
      userId: session.bookerId,
      spendType: 'talent_session',
      amountCents: stripeSession.amount_total,
      referenceId: session.id,
      referenceType: 'talent_session',
      talentUserId: talentUser?.id ?? null,
      metadata: {
        durationMins: session.durationMins,
        subject: session.subject ?? null,
        talentName,
        paidViaCheckout: true,
      },
      stripePaymentIntentId: stripeSession.payment_intent ?? null,
      stripeSessionId: stripeSession.id,
      paidAt: new Date(),
    }).catch(err => console.error('[UserSpend] talent_session record failed:', err.message));

    if (session.isGift) {
      // Gift purchased — notify gifter only. Talent gets notified when recipient actually books.
      await notifyAndEmail({
        userId: session.bookerId,
        title: 'Gift purchased!',
        message: `Your gift of a ${session.durationMins}-min session with ${talentName} has been sent.`,
        type: 'purchase_confirmation',
        redirectTo: '/bookings',
        relatedId: session.id,
      });
      return;
    }

    await notifyAndEmail({
      userId: session.bookerId,
      title: 'Booking request sent',
      message: `Your session request with ${talentName} is pending confirmation.`,
      type: 'purchase_confirmation',
      redirectTo: '/bookings',
      relatedId: session.id,
      emailFn: async () => {
        await sendBookingConfirmationEmail(booker.email, {
          user_name: booker.firstName,
          creator_name: talentName,
          session_date: dayjs(session.scheduledAt).format('dddd, MMMM D, YYYY'),
          session_time: dayjs(session.scheduledAt)
            .tz(booker.timezone || 'UTC')
            .format('h:mm A'),
          timezone: booker.timezone || 'UTC',
          duration: session.durationMins,
          amount: `$${(session.priceCents / 100).toFixed(2)}`,
          cancellation_policy:
            'Full refund if cancelled 48+ hours before. 50% if 24–48 hours before. No refund within 48 hours.',
          join_link: `${FRONTEND_URL}/session/${session.id}`,
        });
      },
    });
    const talentAvailWindows = await TalentAvailabilityService.getForProfile(
      session.talentProfileId
    );
    const talentTz = talentAvailWindows[0]?.timezone || 'UTC';
    if (io) {
      try {
        emitSocialChat(io, `user:${talentUser.id}`, 'talent:request:new', {
          sessionId: session.id,
          talentProfileId: session.talentProfileId,
        });
      } catch (err) {
        console.error('[TalentSession] Socket emit failed on payment webhook:', err.message);
      }
    }
    await notifyAndEmail({
      userId: talentUser.id,
      title: 'New session request',
      message: `${booker.firstName} ${booker.lastName} wants to book a ${session.durationMins}-min session.`,
      type: 'purchase_confirmation',
      redirectTo: '/bookings',
      relatedId: session.id,
      emailFn: async () => {
        const { subject, html } = sessionEmails.newBookingRequestForTalent(
          talentUser,
          booker,
          session,
          talentTz
        );
        await mailService.sendMail(talentUser.email, subject, html);
      },
    });
  }

  // ── Handle Stripe checkout expired — release the slot ─────────────────────

  static async handlePaymentExpired(stripeSession) {
    const { sessionId } = stripeSession.metadata ?? {};
    if (!sessionId) return;
    await db
      .update(talentSessions)
      .set({ status: 'cancelled', cancellationReason: 'payment_expired', updatedAt: new Date() })
      .where(and(eq(talentSessions.id, sessionId), eq(talentSessions.status, 'awaiting_payment')));
  }

  static async book({
    talentProfileId,
    bookerId,
    date,
    time,
    durationMins,
    subject,
    discussion,
    isGift,
    giftDetails,
    giftCode,
    io,
  }) {
    // 1. Validate slot is still available
    const slots = await TalentAvailabilityService.getAvailableSlots(
      talentProfileId,
      date,
      durationMins
    );
    const slot = slots.find(s => s.time === time && s.available);
    if (!slot) throw new ApiError(409, 'This time slot is no longer available');

    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.id, talentProfileId),
      with: { user: true },
    });
    if (!profile) throw new ApiError(404, 'Talent not found');

    // Talent must have an active subscription with the video_booking feature,
    // otherwise they cannot confirm the session — don't take the booker's money.
    const canBook = await SubscriptionService.checkFeatureAccess(
      profile.userId,
      FEATURES.VIDEO_BOOKING
    );
    if (!canBook) {
      throw new ApiError(403, 'This talent is not currently accepting video bookings');
    }

    const booker = await db.query.users.findFirst({ where: eq(users.id, bookerId) });
    if (!booker) throw new ApiError(404, 'Booker not found');

    const availWindows = await TalentAvailabilityService.getForProfile(talentProfileId);
    const talentTz = availWindows[0]?.timezone || 'UTC';

    const scheduledAt = dayjs.tz(`${date}T${time}:00`, talentTz).utc().toDate();
    const joinAllowedAt = new Date(scheduledAt.getTime() - 3 * 60 * 1000);

    // 3. Create the Stream call (scheduled, not live yet)
    const callId = randomUUID();
    const streamCall = await StreamCallService.createCall({
      cid: callId,
      type: 'talent-session',
      created_by_user_id: bookerId,
      starts_at: scheduledAt,
      members: [
        { user_id: bookerId, role: 'user' },
        { user_id: profile.userId, role: 'admin' },
      ],
      custom: {
        isTalentSession: true,
        talentProfileId,
        bookerId,
        subject,
        durationMins,
      },
    });

    // 4. Create the talent_sessions row
    const [session] = await db
      .insert(talentSessions)
      .values({
        talentProfileId,
        bookerId,
        scheduledAt,
        durationMins,
        joinAllowedAt,
        priceCents: slot.priceCents,
        status: 'pending',
        subject,
        discussion,
        isGift: !!isGift,
        giftDetails: giftDetails || {},
        giftCode: giftCode || null,
        streamCallCid: streamCall.cid || callId,
      })
      .returning();
    // 4a. If this booking redeems a gift code, validate + mark it consumed
    if (giftCode) {
      await GiftCodeService.redeem(giftCode, talentProfileId, durationMins, session.id);
    }

    // 4b. If the booker is gifting to someone else, generate and email the code
    if (isGift && giftDetails?.recipientEmail) {
      await GiftCodeService.generate({
        gifterId: bookerId,
        talentProfileId,
        durationMins,
        priceCents: slot.priceCents,
        recipientName: giftDetails.recipientName ?? null,
        recipientEmail: giftDetails.recipientEmail,
        recipientPhone: giftDetails.recipientPhone ?? null,
        occasion: giftDetails.occasion ?? null,
        personalMessage: giftDetails.message ?? null,
        deliveryDate: giftDetails.deliveryDate ?? null,
      }).catch(err =>
        // Non-fatal: gift code generation failure should not block the booking
        console.error('[GiftCode] Failed to generate gift code:', err.message)
      );
    }
    // 5. Send notifications + emails to both parties
    const talentUser = profile.user;
    const talentName = `${talentUser.firstName} ${talentUser.lastName}`;

    const meetingLink = `${FRONTEND_URL}/session/${session.id}`;
    const bookingConfirmationParams = {
      user_name: booker.firstName,
      creator_name: talentName,
      session_date: dayjs(session.scheduledAt).format('dddd, MMMM D, YYYY'),
      session_time: dayjs(session.scheduledAt)
        .tz(booker.timezone || 'UTC')
        .format('h:mm A'),
      timezone: booker.timezone || 'UTC',
      duration: session.durationMins,
      amount: `$${(session.priceCents / 100).toFixed(2)}`,
      cancellation_policy:
        'Full refund if cancelled 48+ hours before the session. 50% refund if cancelled 24–48 hours before the session. No refund if cancelled within 24 hours.',
      join_link: meetingLink,
    };

    if (io) {
      try {
        emitSocialChat(io, `user:${profile.userId}`, 'talent:request:new', {
          sessionId: session.id,
          talentProfileId,
        });
      } catch (err) {
        console.error('[TalentSession] Socket emit failed on book:', err.message);
      }
    }

    // → Booker
    await notifyAndEmail({
      userId: bookerId,
      title: 'Booking request sent',
      message: `Your session request with ${talentName} is pending confirmation.`,
      type: 'purchase_confirmation',
      redirectTo: `/bookings`,
      relatedId: session.id,
      emailFn: async () => {
        await sendBookingConfirmationEmail(booker.email, bookingConfirmationParams);
      },
    });

    // → Talent
    await notifyAndEmail({
      userId: profile.userId,
      title: 'New session request',
      message: `${booker.firstName} ${booker.lastName} wants to book a ${durationMins}-min session.`,
      type: 'purchase_confirmation',
      redirectTo: `/bookings`,
      relatedId: session.id,
      emailFn: async () => {
        const { subject: sub, html } = sessionEmails.newBookingRequestForTalent(
          talentUser,
          booker,
          session,
          talentTz
        );
        await mailService.sendMail(talentUser.email, sub, html);
      },
    });

    return { ...session, meetingLink };
  }

  // ── Call moderation (frame recording) ───────────────────────────────────────

  /**
   * Admin dashboard: talent sessions with call-moderation history. Any row
   * with moderationStatus != 'approved' has real violation history — the
   * status only ratchets upward (worst-wins, see applyFrameVerdict), never
   * clears. The local log only records the action taken per frame, not why —
   * that lives on Stream's side (Bodyguard/Rekognition flags), so this
   * batch-fetches labels for this page's distinct reviewQueueItemIds.
   */
  static async listModeratedSessions({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const where = ne(talentSessions.moderationStatus, 'approved');

    const [rows, totalRows] = await Promise.all([
      db.query.talentSessions.findMany({
        where,
        limit,
        offset,
        orderBy: [desc(talentSessions.updatedAt)],
        columns: {
          id: true,
          talentProfileId: true,
          bookerId: true,
          scheduledAt: true,
          durationMins: true,
          status: true,
          moderationStatus: true,
          moderationEventsLog: true,
          updatedAt: true,
        },
        with: {
          booker: { columns: { id: true, username: true, firstName: true, lastName: true } },
          talentProfile: {
            columns: { id: true },
            with: {
              user: { columns: { id: true, username: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
      db.select({ total: count() }).from(talentSessions).where(where),
    ]);

    const reviewIds = [
      ...new Set(
        rows.flatMap(r =>
          (r.moderationEventsLog || []).map(e => e.reviewQueueItemId).filter(Boolean)
        )
      ),
    ];
    const labelsByReviewId = {};
    await Promise.all(
      reviewIds.map(async id => {
        try {
          const res = await streamClient.moderation.queryReviewQueue({ filter: { id }, limit: 1 });
          const flags = res?.items?.[0]?.flags || [];
          labelsByReviewId[id] = [...new Set(flags.flatMap(f => f.labels || []))];
        } catch (err) {
          console.error('[TalentSession] Failed to fetch review queue labels:', err.message);
        }
      })
    );

    const items = rows.map(row => ({
      id: row.id,
      talentProfileId: row.talentProfileId,
      scheduledAt: row.scheduledAt,
      durationMins: row.durationMins,
      status: row.status,
      moderationStatus: row.moderationStatus,
      updatedAt: row.updatedAt,
      booker: row.booker,
      talentUser: row.talentProfile?.user ?? null,
      events: (row.moderationEventsLog || []).map(e => ({
        ...e,
        labels: e.reviewQueueItemId ? (labelsByReviewId[e.reviewQueueItemId] ?? []) : [],
      })),
    }));

    return { items, total: totalRows[0]?.total ?? 0, page, limit };
  }

  static async getByCallId(callId) {
    return db.query.talentSessions.findFirst({
      where: eq(talentSessions.streamCallCid, callId),
    });
  }

  /**
   * Submit one captured call frame to the same image-moderation policy used
   * for photos. Image checks are usually synchronous — react immediately
   * when they are; async ones resolve later via the moderation_check.completed
   * webhook (routed back to applyFrameVerdict in streamWebhook.controller).
   */
  static async submitFrameForModeration({
    session,
    trackType,
    participantId,
    frameUrl,
    io = null,
  }) {
    if (!frameUrl || !participantId) return;
    const entityId = `${session.id}:${trackType}:${participantId}`;
    try {
      const res = await streamClient.moderation.check({
        entity_type: TALENT_SESSION_FRAME_ENTITY,
        entity_id: entityId,
        entity_creator_id: String(participantId),
        moderation_payload: { images: [frameUrl] },
        config_key: MEDIA_CONFIG_KEY,
      });
      if (res?.status === 'complete' && res?.recommended_action) {
        await TalentSessionService.applyFrameVerdict({
          entityId,
          action: res.recommended_action,
          frameUrl,
          io,
        });
      } else {
        rememberPendingFrameUrl(entityId, frameUrl);
      }
    } catch (err) {
      console.error('[TalentSession] Frame moderation check failed:', err.message);
    }
  }

  /**
   * Apply a Stream verdict for one call frame: log it, escalate the
   * session's aggregate moderationStatus (worst-wins), and take the
   * matching call action — flag→warn, remove→mute that track,
   * shadow/shadow_block→end the call. `frameUrl` is passed directly on the
   * synchronous path (submitFrameForModeration); webhook-delivered async
   * verdicts fall back to the pendingFrameUrls cache keyed by entityId,
   * populated when the check was first submitted.
   */
  static async applyFrameVerdict({
    entityId,
    action,
    frameUrl = null,
    reviewQueueItemId = null,
    io = null,
  }) {
    const [sessionId, trackType, participantId] = String(entityId).split(':');
    const status = FRAME_ACTION_TO_STATUS[action];
    if (!sessionId || !status) return;

    if (frameUrl === null) {
      frameUrl = consumePendingFrameUrl(entityId);
    }

    // Lock the session row for the read-count-write cycle — two frame verdicts
    // landing close together (e.g. camera + screen share both bad at once, or
    // two checks resolving within milliseconds of each other) would otherwise
    // both read the log before either write lands, both see e.g. "9 violations
    // so far", and both independently decide "this is #10" — double-firing the
    // same warning/kick tier. Locking serializes them so the second one sees
    // the first one's write before making its own decision.
    const result = await db.transaction(async tx => {
      const [session] = await tx
        .select()
        .from(talentSessions)
        .where(eq(talentSessions.id, sessionId))
        .for('update');
      if (!session || !session.streamCallCid) return null;

      const event = {
        trackType,
        action,
        participantId,
        frameUrl,
        reviewQueueItemId,
        capturedAt: new Date().toISOString(),
      };
      const nextLog = [...(session.moderationEventsLog || []), event];
      const nextStatus =
        (STATUS_SEVERITY[status] ?? 0) >= (STATUS_SEVERITY[session.moderationStatus] ?? 0)
          ? status
          : session.moderationStatus;

      await tx
        .update(talentSessions)
        .set({ moderationStatus: nextStatus, moderationEventsLog: nextLog, updatedAt: new Date() })
        .where(eq(talentSessions.id, sessionId));

      return { session, nextLog };
    });
    if (!result) return;
    const { session, nextLog } = result;

    const isScreenShare = trackType === 'TRACK_TYPE_SCREEN_SHARE';
    const trackLabel = isScreenShare ? 'screen share' : 'camera';

    if (status === 'approved') {
      // A clean frame after a flagged one — clear any warning popup still
      // showing for this participant instead of leaving it stuck on screen.
      if (io) {
        emitSocialChat(io, `user:${participantId}`, 'session:moderation_action', {
          sessionId,
          severity: 'cleared',
          trackLabel,
          message: '',
        });
      }
      return;
    }

    const call = streamClient.video.call('talent-session', session.streamCallCid);

    if (status === 'flagged') {
      const message = `Your ${trackLabel} was flagged for possibly violating our community guidelines. Please keep the session appropriate.`;
      await createNotification({
        userId: participantId,
        title: 'Content warning',
        message,
        type: 'system',
      }).catch(() => {});
      // Persistent (no auto-dismiss on the frontend) — stays up until this
      // clears via the 'approved' branch above, not a fixed timer.
      if (io) {
        emitSocialChat(io, `user:${participantId}`, 'session:moderation_action', {
          sessionId,
          severity: 'warning',
          trackLabel,
          message,
        });
      }
      return;
    }

    if (status === 'rejected') {
      // Stream's own escalating call-moderation (warn → mute → kick per violation
      // number) is feature-flag gated — contact Stream support to enable it. Until
      // then, replicate the same sequence ourselves using the same ungated call
      // primitives their rule engine would use under the hood (muteUsers, kickUser,
      // blockUser).
      //
      // Frames land every few seconds, so acting on every single bad frame would
      // fire way too often — instead, batch every 10 bad frames (for this
      // participant, cumulative for this session) into one "warning". 3 warnings
      // (each mutes the offending track and shows the count) are allowed; the
      // 4th batch of 10 — i.e. they turned the track back on after warning 3 and
      // violated again — gets them kicked and blocked from rejoining.
      const BAD_FRAMES_PER_WARNING = 10;
      const MAX_WARNINGS = 3;
      const badFrameCount = nextLog.filter(e => {
        if (e.participantId !== participantId) return false;
        const s = FRAME_ACTION_TO_STATUS[e.action];
        return s === 'rejected' || s === 'shadowed';
      }).length;

      // Still accumulating toward the next warning/kick tier — no action yet.
      if (badFrameCount % BAD_FRAMES_PER_WARNING !== 0) return;

      const warningNumber = badFrameCount / BAD_FRAMES_PER_WARNING;

      if (warningNumber <= MAX_WARNINGS) {
        try {
          await call.muteUsers({
            user_ids: [participantId],
            video: !isScreenShare,
            screenshare: isScreenShare,
            muted_by_id: 'system',
          });
        } catch (err) {
          console.error('[TalentSession] Mute-on-rejection failed:', err.message);
        }
        const message =
          warningNumber < MAX_WARNINGS
            ? `Your ${trackLabel} was turned off for violating our community guidelines. Warning ${warningNumber} of ${MAX_WARNINGS}.`
            : `Your ${trackLabel} was turned off for violating our community guidelines. Warning ${warningNumber} of ${MAX_WARNINGS} — turning it back on and violating again will remove you from the session.`;
        await createNotification({
          userId: participantId,
          title: `${trackLabel === 'screen share' ? 'Screen share' : 'Video'} blocked`,
          message,
          type: 'system',
        }).catch(() => {});
        if (io) {
          emitSocialChat(io, `user:${participantId}`, 'session:moderation_action', {
            sessionId,
            severity: 'blocked',
            trackLabel,
            message,
          });
        }
        return;
      }

      // Past the kick tier, do nothing further — the participant is already
      // being removed and more frames may still land while that's in flight.
      if (warningNumber > MAX_WARNINGS + 1) return;

      // 4th batch — they turned the track back on after the 3rd warning and
      // violated again. Kick them off the live call AND block them from
      // rejoining — kickUser alone only disconnects the current connection, it
      // does not prevent re-entry. The session continues for the other party.
      try {
        await call.kickUser({ user_id: participantId });
      } catch (err) {
        console.error('[TalentSession] Kick-on-repeated-rejection failed:', err.message);
      }
      try {
        await call.blockUser({ user_id: participantId });
      } catch (err) {
        console.error('[TalentSession] Block-on-repeated-rejection failed:', err.message);
      }
      const kickedMessage =
        'You have been kicked and blocked due to a community guideline violation.';
      if (io) {
        emitSocialChat(io, `user:${participantId}`, 'session:moderation_action', {
          sessionId,
          severity: 'removed',
          trackLabel,
          message: kickedMessage,
        });
      }
      await createNotification({
        userId: participantId,
        title: 'Removed from session',
        message: kickedMessage,
        type: 'system',
      }).catch(() => {});
      return;
    }

    // shadowed (shadow / shadow_block) — most severe, suspend the call
    try {
      await call.end();
    } catch (err) {
      console.error('[TalentSession] End-call-on-suspend failed:', err.message);
    }
    const { booker, talentUser } = await TalentSessionService._getParties(session);
    for (const userId of [booker?.id, talentUser?.id].filter(Boolean)) {
      await createNotification({
        userId,
        title: 'Session ended',
        message: 'This session was ended automatically due to a serious content violation.',
        type: 'system',
      }).catch(() => {});
    }
  }

  // ── Talent accepts booking ────────────────────────────────────────────────

  static async confirm(sessionId, talentUserId, io) {
    const session = await TalentSessionService._getSessionForTalent(sessionId, talentUserId);
    if (session.status !== 'pending')
      throw new ApiError(400, `Session is already ${session.status}`);
    if (new Date(session.scheduledAt) <= new Date())
      throw new ApiError(400, 'Cannot confirm a session that has already passed');

    const [updated] = await db
      .update(talentSessions)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    if (io) {
      console.log('[TalentSession] Emitting session:confirmed to', `user:${session.bookerId}`);

      try {
        emitSocialChat(io, `user:${session.bookerId}`, 'session:confirmed', {
          sessionId: session.id,
        });
      } catch (err) {
        console.error('[TalentSession] Socket emit failed on confirm:', err.message);
      }
    }

    const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);

    if (session.streamCallCid) {
      try {
        // Dedicated call type (frame_recording: auto-on) so recording starts the
        // moment the call actually goes live — no manual startFrameRecording() call,
        // which used to fire here at confirm-time, before either party had joined.
        const streamResponse = await StreamCallService.registerOnStream({
          callId: session.streamCallCid,
          type: 'talent-session',
          created_by_user_id: talentUser.id,
          members: [{ user_id: session.bookerId }, { user_id: talentUser.id, role: 'admin' }],
          starts_at: session.scheduledAt,
          max_duration_seconds: session.durationMins * 60 + 180,
          custom: {
            isTalentSession: true,
            talentProfileId: session.talentProfileId,
          },
        });
        console.log(
          '[TalentSession] Stream call registered:',
          JSON.stringify({
            id: streamResponse?.call?.id,
            starts_at: streamResponse?.call?.starts_at,
            members: streamResponse?.members?.map(m => ({ user_id: m.user_id, role: m.role })),
          })
        );
      } catch (err) {
        console.error('[TalentSession] Stream call registration failed:', err.message);
      }
    }

    await notifyAndEmail({
      userId: session.bookerId,
      title: 'Session confirmed!',
      message: `${talentName} confirmed your session.`,
      type: 'purchase_confirmation',
      redirectTo: `/bookings`,
      relatedId: session.id,
      emailFn: async () => {
        const { subject, html } = sessionEmails.sessionConfirmedForBooker(
          booker,
          { name: talentName },
          updated,
          booker.timezone || 'UTC'
        );
        await mailService.sendMail(booker.email, subject, html);
      },
    });

    return updated;
  }

  // ── Talent declines booking ───────────────────────────────────────────────

  static async decline(sessionId, talentUserId) {
    const session = await TalentSessionService._getSessionForTalent(sessionId, talentUserId);
    if (session.status !== 'pending')
      throw new ApiError(400, `Session is already ${session.status}`);

    const [updated] = await db
      .update(talentSessions)
      .set({ status: 'declined', updatedAt: new Date() })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    // Full refund to booker when talent declines
    if (session.stripePaymentIntentId && stripe) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: session.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: { sessionId, reason: 'talent_declined' },
        });
        await db
          .update(talentSessions)
          .set({ refundIssuedAt: new Date() })
          .where(eq(talentSessions.id, sessionId));

        await UserSpendService.markTalentSessionRefunded({
          sessionId,
          userId: session.bookerId,
          refundMeta: {
            source: 'talent_session_decline',
            stripeRefundId: refund.id,
            refundStatus: refund.status,
            refundAmountCents: refund.amount,
          },
        });
      } catch (err) {
        console.error('[TalentSession] Stripe refund failed on decline:', err.message);
      }
    }

    const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);

    await notifyAndEmail({
      userId: session.bookerId,
      title: 'Session request declined',
      message: `${talentName} could not accept your session. A full refund has been issued.`,
      type: 'purchase_confirmation',
      redirectTo: `/bookings`,
      relatedId: session.id,
      emailFn: async () => {
        const { subject, html } = sessionEmails.sessionDeclinedForBooker(
          booker,
          { name: talentName },
          session,
          booker.timezone || 'UTC'
        );
        await mailService.sendMail(booker.email, subject, html);
      },
    });

    return updated;
  }

  // ── Cancel (either party) ─────────────────────────────────────────────────

  static async cancel(sessionId, cancelledByUserId, reason) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });
    if (!session) throw new ApiError(404, 'Session not found');
    if (['completed', 'cancelled', 'declined'].includes(session.status)) {
      throw new ApiError(400, `Cannot cancel a session with status: ${session.status}`);
    }

    const now = new Date();
    const hoursUntil = (new Date(session.scheduledAt) - now) / 3_600_000;

    let refundNote = 'No refund — cancelled within 24 hours of session.';
    if (hoursUntil >= 48) refundNote = 'Full refund will be issued within 3–5 business days.';
    else if (hoursUntil >= 24) refundNote = '50% refund will be issued within 3–5 business days.';

    const [updated] = await db
      .update(talentSessions)
      .set({
        status: 'cancelled',
        cancelledBy: cancelledByUserId,
        cancellationReason: reason,
        updatedAt: now,
      })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    // Issue Stripe refund based on who cancelled and how far out
    if (session.stripePaymentIntentId && stripe) {
      const isTalentCancel = cancelledByUserId !== session.bookerId;
      let refundAmountCents = 0;
      if (isTalentCancel || hoursUntil >= 48) {
        refundAmountCents = session.priceCents;
      } else if (hoursUntil >= 24) {
        refundAmountCents = Math.round(session.priceCents * 0.5);
      }
      if (refundAmountCents > 0) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: session.stripePaymentIntentId,
            amount: refundAmountCents,
            reason: 'requested_by_customer',
            metadata: { sessionId, cancelledBy: cancelledByUserId },
          });
          await db
            .update(talentSessions)
            .set({ refundIssuedAt: new Date() })
            .where(eq(talentSessions.id, sessionId));

          await UserSpendService.markTalentSessionRefunded({
            sessionId,
            userId: session.bookerId,
            refundMeta: {
              source: 'talent_session_cancel',
              stripeRefundId: refund.id,
              refundStatus: refund.status,
              refundAmountCents,
              isTalentCancel,
              hoursUntil,
            },
          });
        } catch (err) {
          console.error('[TalentSession] Stripe refund failed on cancel:', err.message);
        }
      }
    }

    const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);
    const bookerIsCancel = cancelledByUserId === session.bookerId;

    if (bookerIsCancel) {
      // Notify talent
      await notifyAndEmail({
        userId: talentUser.id,
        title: 'Session cancelled',
        message: `${booker.firstName} ${booker.lastName} cancelled their session.`,
        type: 'event_update',
        redirectTo: `/bookings`,
        relatedId: session.id,
        emailFn: async () => {
          const { subject, html } = sessionEmails.sessionCancelledByBooker(
            talentUser,
            booker,
            session,
            refundNote,
            talentUser.timezone || 'UTC'
          );
          await mailService.sendMail(talentUser.email, subject, html);
        },
      });
    } else {
      // Talent cancelled — notify booker
      await notifyAndEmail({
        userId: session.bookerId,
        title: 'Session cancelled',
        message: `${talentName} cancelled your session. A refund will be issued.`,
        type: 'event_update',
        redirectTo: `/bookings`,
        relatedId: session.id,
        emailFn: async () => {
          await sendBookingCancellationEmail(booker.email, {
            user_name: booker.firstName,
            creator_name: talentName,
            session_date: dayjs(session.scheduledAt).format('MMMM D, YYYY'),
            session_time: dayjs(session.scheduledAt)
              .tz(booker.timezone || 'UTC')
              .format('h:mm A'),
            cancelled_by: talentName,
            cancellation_reason: reason || 'Not provided',
            amount: `$${(session.priceCents / 100).toFixed(2)}`,
            refund_reference: session.id,
          });
        },
      });
    }

    return updated;
  }

  // ── Record join events (called from Stream webhook / call room) ───────────

  static async recordJoin(sessionId, userId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
      with: { talentProfile: true },
    });
    if (!session) throw new ApiError(404, 'Session not found');

    const now = new Date();
    const isBooker = userId === session.bookerId;
    const isTalent = userId === session.talentProfile.userId;
    if (!isBooker && !isTalent) throw new ApiError(403, 'Not a participant in this session');

    // Enforce join window
    if (now < new Date(session.joinAllowedAt)) {
      throw new ApiError(403, 'Too early — you may join 3 minutes before the session starts');
    }

    const patch = {};
    if (isBooker && !session.bookerJoinedAt) patch.bookerJoinedAt = now;
    if (isTalent && !session.talentJoinedAt) patch.talentJoinedAt = now;
    if (session.status === 'confirmed') patch.status = 'live';

    // Check if both have now joined → start billing
    const bookerJoined = session.bookerJoinedAt || (isBooker ? now : null);
    const talentJoined = session.talentJoinedAt || (isTalent ? now : null);

    if (bookerJoined && talentJoined && !session.billingStartedAt) {
      patch.billingStartedAt = now;
    }

    if (Object.keys(patch).length === 0) return session;

    const [updated] = await db
      .update(talentSessions)
      .set({ ...patch, updatedAt: now })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    return updated;
  }

  // ── End session (auto-end job or explicit) ────────────────────────────────

  static async endSession(sessionId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });
    if (!session) throw new ApiError(404, 'Session not found');
    if (session.status === 'completed') return session;

    const now = new Date();
    let actualDurationMins = null;

    if (session.billingStartedAt) {
      const ms = now - new Date(session.billingStartedAt);
      actualDurationMins = Math.round(ms / 60_000);
    }

    const [updated] = await db
      .update(talentSessions)
      .set({ status: 'completed', billingEndedAt: now, actualDurationMins, updatedAt: now })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    if (session.streamCallCid) {
      try {
        await streamClient.video.call('talent-session', session.streamCallCid).stopFrameRecording();
      } catch (err) {
        console.error('[TalentSession] Failed to stop frame recording:', err.message);
      }
    }

    // Update talent stats
    await db
      .update(talentProfiles)
      .set({
        totalSessions: sql`total_sessions + 1`,
        updatedAt: now,
      })
      .where(eq(talentProfiles.id, session.talentProfileId));

    const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);

    // Record spend only for sessions NOT paid via Stripe checkout (legacy book() flow)
    // Checkout-paid sessions already record spend in handlePaymentWebhook
    if (!updated.stripePaymentIntentId)
      UserSpendService.recordSpend({
        userId: session.bookerId,
        spendType: 'talent_session',
        amountCents: session.priceCents,
        referenceId: session.id,
        referenceType: 'talent_session',
        talentUserId: talentUser?.id ?? null,
        metadata: {
          durationMins: session.durationMins,
          actualDurationMins: updated.actualDurationMins,
          subject: session.subject ?? null,
          talentName,
        },
        paidAt: updated.billingEndedAt ?? now,
      }).catch(err => console.error('[UserSpend] talent_session record failed:', err.message));

    // Notify booker only — prompt for review
    await notifyAndEmail({
      userId: booker.id,
      title: 'Session complete — leave a review',
      message: `Your session with ${talentName} is done. Share your experience!`,
      type: 'event_update',
      redirectTo: `/bookings`,
      relatedId: session.id,
      emailFn: async () => {
        const { subject, html } = sessionEmails.sessionCompletedForBoth(
          booker,
          talentName,
          updated,
          booker.timezone || 'UTC'
        );
        await mailService.sendMail(booker.email, subject, html);
      },
    });

    return updated;
  }

  // ── Auto-cancel no-show (called by cron) ─────────────────────────────────

  static async handleNoShow(sessionId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });

    // Only act on confirmed sessions
    if (!session || session.status !== 'confirmed') return null;

    const now = new Date();
    const graceEnd = new Date(new Date(session.scheduledAt).getTime() + 10 * 60_000);

    // Grace period hasn't elapsed yet — cron will retry
    if (now < graceEnd) return null;

    const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);
    const bookerName = `${booker.firstName} ${booker.lastName}`;

    // ── Case A: talent never joined and billing never started — full refund to booker ──
    if (!session.talentJoinedAt && !session.billingStartedAt) {
      const [updated] = await db
        .update(talentSessions)
        .set({
          status: 'cancelled',
          cancelledBy: talentUser.id,
          cancellationReason: 'talent_no_show',
          updatedAt: now,
        })
        .where(eq(talentSessions.id, sessionId))
        .returning();

      if (session.stripePaymentIntentId && stripe) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: session.stripePaymentIntentId,
            reason: 'requested_by_customer',
            metadata: { sessionId, reason: 'talent_no_show' },
          });
          await db
            .update(talentSessions)
            .set({ refundIssuedAt: new Date() })
            .where(eq(talentSessions.id, sessionId));
          await UserSpendService.markTalentSessionRefunded({
            sessionId,
            userId: session.bookerId,
            refundMeta: {
              source: 'talent_no_show',
              stripeRefundId: refund.id,
              refundStatus: refund.status,
              refundAmountCents: refund.amount,
            },
          });
        } catch (err) {
          console.error('[TalentSession] Stripe refund failed on talent no-show:', err.message);
        }
      }

      await notifyAndEmail({
        userId: session.bookerId,
        title: 'Session cancelled — talent did not join',
        message: `${talentName} did not join your session. A full refund has been issued.`,
        type: 'event_update',
        redirectTo: '/bookings',
        relatedId: session.id,
        emailFn: async () => {
          const { subject, html } = sessionEmails.talentNoShowForBooker(
            booker,
            { name: talentName },
            session,
            booker.timezone || 'UTC'
          );
          await mailService.sendMail(booker.email, subject, html);
        },
      });

      // Also notify the talent that their session was auto-cancelled
      await notifyAndEmail({
        userId: talentUser.id,
        title: 'Session auto-cancelled — you did not join',
        message: `Your session with ${bookerName} was cancelled because you did not join within the 10-minute grace period.`,
        type: 'event_update',
        redirectTo: '/bookings',
        relatedId: session.id,
      });

      console.log(
        `[NoShow] Talent no-show — session ${sessionId} cancelled, full refund to booker.`
      );
      return updated;
    }

    // ── Case B: talent joined but booker never joined ─────────────────────────
    // Talent showed up and is owed their fee. Cancel with no refund to booker.
    if (session.talentJoinedAt && !session.bookerJoinedAt) {
      const [updated] = await db
        .update(talentSessions)
        .set({
          status: 'cancelled',
          cancelledBy: session.bookerId, // booker side at fault
          cancellationReason: 'booker_no_show',
          updatedAt: now,
        })
        .where(eq(talentSessions.id, sessionId))
        .returning();

      // NOTE: No refund — booker forfeits session fee since talent showed up.
      // Talent payout still applies when payment is wired.

      // Notify booker — they forfeited
      await notifyAndEmail({
        userId: session.bookerId,
        title: 'Session cancelled — you did not join',
        message: `You did not join your session with ${talentName} within the grace period. No refund will be issued.`,
        type: 'event_update',
        redirectTo: '/bookings',
        relatedId: session.id,
      });

      // Notify talent — they get compensated
      await notifyAndEmail({
        userId: talentUser.id,
        title: 'Session cancelled — booker did not show',
        message: `${bookerName} did not join your session. You will still receive your session fee.`,
        type: 'event_update',
        redirectTo: '/bookings',
        relatedId: session.id,
      });

      console.log(`[NoShow] Booker no-show — session ${sessionId} cancelled, talent keeps fee.`);
      return updated;
    }

    // Both joined — not a no-show, do nothing
    return null;
  }

  // ── List sessions for a user (as booker or talent) ────────────────────────

  static async listForUser(userId, { role = 'all', tab = 'all', status, date } = {}) {
    const now = new Date();

    // ── 1. Role condition ──────────────────────────────────────────────────────
    let profileId = null;
    if (role === 'talent' || role === 'all') {
      const profile = await db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.userId, userId),
      });
      profileId = profile?.id ?? null;
    }

    let roleCondition;
    if (role === 'booker') {
      roleCondition = eq(talentSessions.bookerId, userId);
    } else if (role === 'talent') {
      if (!profileId) return { sessions: [], total: 0 };
      roleCondition = eq(talentSessions.talentProfileId, profileId);
    } else {
      roleCondition = profileId
        ? or(eq(talentSessions.bookerId, userId), eq(talentSessions.talentProfileId, profileId))
        : eq(talentSessions.bookerId, userId);
    }

    // ── 2. Tab / status condition ──────────────────────────────────────────────
    let tabCondition;
    if (status) {
      tabCondition = eq(talentSessions.status, status);
    } else {
      switch (tab) {
        case 'upcoming':
          tabCondition = and(
            inArray(talentSessions.status, ['pending', 'confirmed', 'live']),
            gte(talentSessions.scheduledAt, now)
          );
          break;
        case 'pending':
          tabCondition = eq(talentSessions.status, 'pending');
          break;
        case 'past':
          tabCondition = or(
            eq(talentSessions.status, 'completed'),
            eq(talentSessions.status, 'cancelled'),
            and(
              inArray(talentSessions.status, ['confirmed', 'live']),
              lte(talentSessions.scheduledAt, now)
            )
          );
          break;
        case 'cancelled':
          tabCondition = inArray(talentSessions.status, ['cancelled', 'declined']);
          break;
        default:
          tabCondition = undefined;
          break;
      }
    }

    let dateCondition;
    if (date) {
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);
      dateCondition = and(
        gte(talentSessions.scheduledAt, dayStart),
        lte(talentSessions.scheduledAt, dayEnd)
      );
    }

    const whereClause = and(
      roleCondition,
      tabCondition,
      dateCondition,
      ne(talentSessions.status, 'rescheduled')
    );

    // ── 3. Fetch sessions ──────────────────────────────────────────────────────
    // Always fetch BOTH relations — a session may need the booker's avatar
    // (when the viewer is the talent) or the talent's avatar (when the viewer
    // is the booker), and role:'all' views mix both cases in one list.
    const withRelations = {
      booker: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          profileImage: true,
          image: true,
          email: true,
        },
      },
      talentProfile: {
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              profileImage: true,
              image: true,
            },
          },
        },
      },
    };

    const allSessions = await db.query.talentSessions.findMany({
      where: whereClause,
      with: withRelations,
      orderBy: (s, { desc, asc }) =>
        tab === 'past' || tab === 'cancelled' ? [desc(s.scheduledAt)] : [asc(s.scheduledAt)],
    });

    // ── 4. Batch-fetch which sessions this user has already reviewed ───────────
    let reviewedSessionIds = new Set();
    if (allSessions.length > 0 && role !== 'talent') {
      const sessionIds = allSessions.map(s => s.id);
      const existingReviews = await db
        .select({ sessionId: talentReviews.sessionId })
        .from(talentReviews)
        .where(
          and(inArray(talentReviews.sessionId, sessionIds), eq(talentReviews.reviewerId, userId))
        );
      reviewedSessionIds = new Set(existingReviews.map(r => r.sessionId));
    }

    // ── 5. Normalize + attach alreadyReviewed flag ────────────────────────────
    const sessions = allSessions.map(item => ({
      ...item,
      talentProfile: {
        ...item.talentProfile,
        user: normalizeUserImage(item.talentProfile?.user),
      },
      booker: normalizeUserImage(item.booker),
      alreadyReviewed: reviewedSessionIds.has(item.id),
    }));

    return { sessions, total: sessions.length };
  }
  static async getVideoRequests(userId, { page = 1, limit = 10 } = {}) {
    return TalentSessionService.listForUser(userId, {
      role: 'talent',
      tab: 'pending',
      page,
      limit,
    });
  }
  // ── Private helpers ───────────────────────────────────────────────────────

  static async _getSessionForTalent(sessionId, talentUserId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
      with: { talentProfile: true },
    });
    if (!session) throw new ApiError(404, 'Session not found');
    if (session.talentProfile.userId !== talentUserId) throw new ApiError(403, 'Not your session');
    return session;
  }

  static async _getParties(session) {
    const [booker, talentProfile] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, session.bookerId) }),
      db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.id, session.talentProfileId),
        with: { user: true },
      }),
    ]);
    const talentUser = talentProfile.user;
    const talentName = `${talentUser.firstName} ${talentUser.lastName}`;
    return { booker, talentUser, talentName };
  }

  /**
   * Reschedule a session (booker-initiated).
   *
   * Rules:
   *  - Only the booker can request a reschedule.
   *  - Session must be pending or confirmed.
   *  - Must reschedule to at least 2 hours in the future.
   *  - The original session is marked 'rescheduled'.
   *  - A new session is created with status 'pending' (talent must re-confirm).
   *  - rescheduledFromId on the new session points back to the original.
   *
   * @param {string} sessionId
   * @param {string} bookerUserId
   * @param {object} newTime  { date: 'YYYY-MM-DD', time: 'HH:MM' }
   * @returns {{ oldSession, newSession }}
   */
  static async reschedule(sessionId, bookerUserId, { date, time, reason , io }) {
    // ── 1. Load original session ────────────────────────────────────────────
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
      with: { talentProfile: { with: { user: true } } },
    });
    if (!session) throw new ApiError(404, 'Session not found');

    // ── 2. Only booker can reschedule ───────────────────────────────────────
    if (session.bookerId !== bookerUserId) {
      throw new ApiError(403, 'Only the booker can reschedule this session');
    }

    // ── 3. Must be pending or confirmed ────────────────────────────────────
    if (!['pending', 'confirmed'].includes(session.status)) {
      throw new ApiError(400, `Cannot reschedule a session with status: ${session.status}`);
    }

    const availWindows = await TalentAvailabilityService.getForProfile(session.talentProfileId);
    const talentTz = availWindows[0]?.timezone || 'UTC';

    const newScheduledAt = dayjs.tz(`${date}T${time}:00`, talentTz).utc().toDate();

    if (newScheduledAt - new Date() < 2 * 3_600_000) {
      throw new ApiError(400, 'New time must be at least 2 hours in the future');
    }

    // ── 5. Validate the new slot is actually available ─────────────────────
    const slots = await TalentAvailabilityService.getAvailableSlots(
      session.talentProfileId,
      date,
      session.durationMins
    );
    const slot = slots.find(s => s.time === time && s.available);
    if (!slot) throw new ApiError(409, 'That time slot is not available');

    const joinAllowedAt = new Date(newScheduledAt.getTime() - 5 * 60 * 1000);

    // ── 6. Mark original session as 'rescheduled' ──────────────────────────
    const [oldSession] = await db
      .update(talentSessions)
      .set({ status: 'rescheduled', updatedAt: new Date() })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    // ── 7. Create new session ───────────────────────────────────────────────
    // Create a new Stream call for the rescheduled time
    const { randomUUID } = await import('crypto');
    const callId = randomUUID();
    const streamCall = await StreamCallService.createCall({
      cid: callId,
      type: 'talent-session',
      created_by_user_id: bookerUserId,
      starts_at: newScheduledAt,
      members: [
        { user_id: bookerUserId, role: 'user' },
        { user_id: session.talentProfile.userId, role: 'admin' },
      ],
      custom: {
        isTalentSession: true,
        talentProfileId: session.talentProfileId,
        bookerId: bookerUserId,
        subject: session.subject,
        durationMins: session.durationMins,
        rescheduledFrom: sessionId,
      },
    });

    const [newSession] = await db
      .insert(talentSessions)
      .values({
        talentProfileId: session.talentProfileId,
        bookerId: session.bookerId,
        scheduledAt: newScheduledAt,
        durationMins: session.durationMins,
        joinAllowedAt,
        priceCents: session.priceCents,
        status: 'pending', // talent must re-confirm
        subject: session.subject,
        discussion: session.discussion,
        isGift: session.isGift,
        giftDetails: session.giftDetails,
        giftCode: session.giftCode,
        streamCallCid: streamCall.cid || callId,
        rescheduledFromId: sessionId, // link back
      })
      .returning();
  if (io) {
      try {
        emitSocialChat(io, `user:${session.talentProfile.userId}`, 'talent:request:new', {
          sessionId: newSession.id,
          talentProfileId: session.talentProfileId,
        });
      } catch (err) {
        console.error('[TalentSession] Socket emit failed on reschedule:', err.message);
      }
    }
    // ── 8. Notify both parties ─────────────────────────────────────────────
    const booker = await db.query.users.findFirst({ where: eq(users.id, bookerUserId) });
    const talentUser = session.talentProfile.user;
    const talentName = `${talentUser.firstName} ${talentUser.lastName}`;
    const bookerName = `${booker.firstName} ${booker.lastName}`;

    const rescheduleEmailParams = {
      old_date: dayjs(session.scheduledAt).format('MMMM D, YYYY'),
      old_time: dayjs(session.scheduledAt)
        .tz(booker.timezone || 'UTC')
        .format('h:mm A'),
      new_time: dayjs(newScheduledAt)
        .tz(booker.timezone || 'UTC')
        .format('h:mm A'),
      new_date: dayjs(newScheduledAt).format('MMMM D, YYYY'),
      timezone: booker.timezone || 'UTC',
      duration: session.durationMins,
      reschedule_reason: reason || 'Requested by booker',
    };

    // → Talent needs to re-confirm
    await notifyAndEmail({
      userId: talentUser.id,
      title: 'Session rescheduled — please confirm',
      message: `${bookerName} has rescheduled their session to ${date} at ${time}. Please confirm.`,
      type: 'purchase_confirmation',
      redirectTo: '/bookings',
      relatedId: newSession.id,
      emailFn: async () => {
        await sendBookingRescheduledEmail(talentUser.email, {
          user_name: talentUser.firstName,
          creator_name: bookerName,
          ...rescheduleEmailParams,
        });
      },
    });

    // → Booker confirmation
    await notifyAndEmail({
      userId: bookerUserId,
      title: 'Session reschedule request sent',
      message: `Your session has been rescheduled to ${date} at ${time}. Waiting for ${talentName} to confirm.`,
      type: 'purchase_confirmation',
      redirectTo: '/bookings',
      relatedId: newSession.id,
      emailFn: async () => {
        await sendBookingRescheduledEmail(booker.email, {
          user_name: booker.firstName,
          creator_name: talentName,
          ...rescheduleEmailParams,
        });
      },
    });

    return { oldSession, newSession };
  }

  // ── Submit call quality feedback (either party, once each) ───────────────

  static async submitCallFeedback(sessionId, userId, { rating, feedback }) {
    if (!rating || rating < 1 || rating > 5) {
      throw new ApiError(400, '`rating` must be 1–5');
    }

    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
      with: { talentProfile: true },
    });
    if (!session) throw new ApiError(404, 'Session not found');
    if (session.status !== 'completed') {
      throw new ApiError(400, 'Call feedback can only be submitted after the session is completed');
    }

    const isBooker = session.bookerId === userId;
    const isTalent = session.talentProfile.userId === userId;
    if (!isBooker && !isTalent) throw new ApiError(403, 'Not a participant in this session');

    if (isBooker && session.bookerCallRating !== null) {
      throw new ApiError(409, 'You have already submitted call feedback for this session');
    }
    if (isTalent && session.talentCallRating !== null) {
      throw new ApiError(409, 'You have already submitted call feedback for this session');
    }

    const patch = isBooker
      ? { bookerCallRating: rating, bookerCallFeedback: feedback ?? null }
      : { talentCallRating: rating, talentCallFeedback: feedback ?? null };

    const [updated] = await db
      .update(talentSessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    return {
      sessionId,
      role: isBooker ? 'booker' : 'talent',
      rating,
      feedback: feedback ?? null,
    };
  }

  // ── Auto-expire unconfirmed pending sessions (called by cron) ─────────────

  static async autoExpirePending(sessionId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });
    if (!session || session.status !== 'pending') return null;

    const now = new Date();

    const [updated] = await db
      .update(talentSessions)
      .set({ status: 'cancelled', cancellationReason: 'talent_did_not_confirm', updatedAt: now })
      .where(eq(talentSessions.id, sessionId))
      .returning();

    if (session.stripePaymentIntentId && stripe) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: session.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: { sessionId, reason: 'talent_did_not_confirm' },
        });
        await db
          .update(talentSessions)
          .set({ refundIssuedAt: now })
          .where(eq(talentSessions.id, sessionId));
        await UserSpendService.markTalentSessionRefunded({
          sessionId,
          userId: session.bookerId,
          refundMeta: {
            source: 'talent_did_not_confirm',
            stripeRefundId: refund.id,
            refundStatus: refund.status,
            refundAmountCents: refund.amount,
          },
        });
      } catch (err) {
        console.error('[TalentSession] Stripe refund failed on auto-expire:', err.message);
      }
    }

    const { talentName } = await TalentSessionService._getParties(session);

    await notifyAndEmail({
      userId: session.bookerId,
      title: 'Booking automatically cancelled',
      message: `Your booking with ${talentName} was automatically cancelled because they did not confirm your request in time. A full refund has been issued.`,
      type: 'event_update',
      redirectTo: '/bookings',
      relatedId: session.id,
    });

    return updated;
  }
}

export class TalentProfileShareService {
  static async recordShare(talentProfileId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, talentProfileId), isNull(talentProfiles.deletedAt)),
      columns: { id: true, shareCount: true },
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    const [updated] = await db
      .update(talentProfiles)
      .set({ shareCount: sql`${talentProfiles.shareCount} + 1`, updatedAt: new Date() })
      .where(eq(talentProfiles.id, talentProfileId))
      .returning({ shareCount: talentProfiles.shareCount });

    return { talentProfileId, shareCount: updated.shareCount };
  }

  static async getShareCount(talentProfileId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, talentProfileId), isNull(talentProfiles.deletedAt)),
      columns: { shareCount: true },
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');
    return profile.shareCount;
  }
}

export class TalentFavoritesService {
  /**
   * Toggle favourite.
   * Returns { action: 'added' | 'removed', talentProfileId }
   */
  static async toggle(userId, talentProfileId) {
    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, talentProfileId), isNull(talentProfiles.deletedAt)),
    });
    if (!profile) throw new ApiError(404, 'Talent profile not found');

    const existing = await db.query.talentFavorites.findFirst({
      where: and(
        eq(talentFavorites.userId, userId),
        eq(talentFavorites.talentProfileId, talentProfileId)
      ),
    });

    if (existing) {
      await db.delete(talentFavorites).where(eq(talentFavorites.id, existing.id));
      return { action: 'removed', talentProfileId };
    }

    await db.insert(talentFavorites).values({ userId, talentProfileId });
    return { action: 'added', talentProfileId };
  }

  /**
   * Get all favourited talent profile IDs for a user (lightweight).
   */
  static async getFavoriteIds(userId) {
    const rows = await db.query.talentFavorites.findMany({
      where: eq(talentFavorites.userId, userId),
    });
    return rows.map(r => r.talentProfileId);
  }
}

/**
 * List talent profiles with FULL backend filtering, search, and pagination.
 *
 * Supported query params:
 *   category      exact category match
 *   minRating     minimum rating threshold (e.g. 4.5)
 *   language      single language string (e.g. "Spanish")
 *   search        searches firstName+lastName, title, bio, category
 *   minPrice      minimum lowest-rate in the rates object (dollars)
 *   maxPrice      maximum lowest-rate in the rates object (dollars)
 *   minMessageFee minimum priority-message fee (dollars)
 *   maxMessageFee maximum priority-message fee (dollars)
 *   favoritesOnly "true" — only profiles this user has favourited
 *   userId        requesting user id — used for favoritesOnly + isFavorited flag
 *   page          1-based (default 1)
 *   limit         per page (default 12, max 50)
 *
 * Returns: { profiles, total, page, limit, totalPages }
 */
export async function listTalentProfiles({
  category,
  minRating,
  language,
  search,
  minPrice,
  maxPrice,
  minMessageFee,
  maxMessageFee,
  favoritesOnly = false,
  lat,
  lng,
  radius,
  userId,
  page = 1,
  limit = 12,
} = {}) {
  limit = Math.min(Number(limit) || 12, 5000);
  page = Math.max(Number(page) || 1, 1);

  // ── 1. DB query — filters that can go to SQL ────────────────────────────────
  const whereClause = and(
    eq(talentProfiles.isActive, true),
    isNull(talentProfiles.deletedAt),
    category ? eq(talentProfiles.category, category) : undefined,
    minRating ? gte(talentProfiles.rating, String(minRating)) : undefined
  );

  let results = await db.query.talentProfiles.findMany({
    where: whereClause,
    with: {
      user: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          profileImage: true,
          image: true,
        },
      },
    },
    orderBy: (t, { desc }) => [desc(t.rating)],
  });
  results = results.map(item => ({ ...item, user: normalizeUserImage(item.user) }));

  // ── 2. JS-level filters (jsonb fields + full-text search) ─────────────────

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    results = results.filter(t => {
      const fullName = `${t.user.firstName} ${t.user.lastName}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.bio ?? '').toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        (t.location ?? '').toLowerCase().includes(q)
      );
    });
  }

  if (language) {
    results = results.filter(t => Array.isArray(t.languages) && t.languages.includes(language));
  }

  // ── Radius filter — same lat/lng approach as events/discover. A talent
  // without coordinates can't be matched against a location search, so they
  // drop out of results whenever a location filter is active.
  if (lat !== undefined && lng !== undefined) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusKm = radius !== undefined ? Number(radius) : DEFAULT_TALENT_SEARCH_RADIUS_KM;
    results = results.filter(t => {
      if (t.latitude == null || t.longitude == null) return false;
      const distance = haversineDistanceKm(latNum, lngNum, Number(t.latitude), Number(t.longitude));
      return distance <= radiusKm;
    });
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    const lo = minPrice !== undefined ? Number(minPrice) : -Infinity;
    const hi = maxPrice !== undefined ? Number(maxPrice) : Infinity;
    results = results.filter(t => {
      const vals = Object.values(t.rates || {}).map(Number);
      if (vals.length === 0) return false;
      const lowest = Math.min(...vals);
      return lowest >= lo && lowest <= hi;
    });
  }

  if (minMessageFee !== undefined || maxMessageFee !== undefined) {
    const lo = minMessageFee !== undefined ? Number(minMessageFee) : -Infinity;
    const hi = maxMessageFee !== undefined ? Number(maxMessageFee) : Infinity;
    results = results.filter(t => {
      const feeDollars = (t.priorityMessageFee ?? 0) / 100;
      return feeDollars >= lo && feeDollars <= hi;
    });
  }

  // ── 3. Favourites-only filter ──────────────────────────────────────────────
  let favoritedSet = new Set();
  if (userId) {
    const favRows = await db.query.talentFavorites.findMany({
      where: eq(talentFavorites.userId, userId),
    });
    favoritedSet = new Set(favRows.map(f => f.talentProfileId));
  }

  if (favoritesOnly && userId) {
    results = results.filter(t => favoritedSet.has(t.id));
  }

  // ── 4. Attach isFavorited flag ─────────────────────────────────────────────
  results = results.map(t => ({ ...t, isFavorited: favoritedSet.has(t.id) }));

  // ── 5. Paginate ────────────────────────────────────────────────────────────
  const total = results.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const offset = (page - 1) * limit;
  const profiles = results.slice(offset, offset + limit);

  // ── 6. Attach feature availability ─────────────────────────────────────────
  const featureMap = await SubscriptionService.getActiveFeaturesForUsers(
    profiles.map(p => p.userId)
  );
  const profilesWithFlags = profiles.map(p => {
    const feats = featureMap.get(p.userId);
    return {
      ...p,
      priorityMessagingAvailable:
        (feats?.has(FEATURES.PRIORITY_MESSAGING) ?? false) && p.priorityMessagingEnabled !== false,
      videoBookingAvailable: feats?.has(FEATURES.VIDEO_BOOKING) ?? false,
    };
  });

  return { profiles: profilesWithFlags, total, page, limit, totalPages };
}

/**
 * Highest video-session rate and priority-message fee currently listed by any
 * active talent (both in dollars). Powers the discovery filter panel's
 * default "Max" bound so it always reflects real platform pricing instead of
 * a stale hardcoded ceiling.
 */
export async function getTalentPriceBounds() {
  const results = await db.query.talentProfiles.findMany({
    where: and(eq(talentProfiles.isActive, true), isNull(talentProfiles.deletedAt)),
    columns: { rates: true, priorityMessageFee: true },
  });

  let maxSessionRate = 0;
  let maxMessageFee = 0;
  for (const t of results) {
    const vals = Object.values(t.rates || {}).map(Number);
    if (vals.length) maxSessionRate = Math.max(maxSessionRate, ...vals);
    maxMessageFee = Math.max(maxMessageFee, (t.priorityMessageFee ?? 0) / 100);
  }

  return { maxSessionRate, maxMessageFee };
}

/**
 * List sessions for the authenticated user with tab-based filtering + pagination.
 *
 * Tabs (maps to status groups):
 *   upcoming  — status IN (pending, confirmed, live) AND scheduledAt >= now
 *   pending   — status = pending  (talent's "Video Requests" view)
 *   past      — status = completed OR (status IN confirmed,live AND scheduledAt < now)
 *   cancelled — status IN (cancelled, declined)
 *   all       — no status filter
 *
 * Role:
 *   booker  — sessions where userId = bookerId
 *   talent  — sessions where userId owns the talentProfile
 *   all     — either role (default)
 *
 * Returns: { sessions, total, page, limit, totalPages }
 */
export async function listSessionsForUser(
  userId,
  { role = 'all', tab = 'all', status, date, page = 1, limit = 10 } = {}
) {
  limit = Math.min(Number(limit) || 10, 5000);
  page = Math.max(Number(page) || 1, 1);

  const now = new Date();

  // ── 1. Role condition ── (unchanged)
  let roleCondition;
  if (role === 'booker') {
    roleCondition = eq(talentSessions.bookerId, userId);
  } else if (role === 'talent') {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    if (!profile) return { sessions: [], total: 0, page, limit, totalPages: 0 };
    roleCondition = eq(talentSessions.talentProfileId, profile.id);
  } else {
    const profile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });
    roleCondition = profile
      ? or(eq(talentSessions.bookerId, userId), eq(talentSessions.talentProfileId, profile.id))
      : eq(talentSessions.bookerId, userId);
  }

  // ── 2. Tab / status condition ──────────────────────────────────────────────
  let tabCondition;
  if (status) {
    tabCondition = eq(talentSessions.status, status);
  } else {
    switch (tab) {
      case 'upcoming':
        tabCondition = and(
          inArray(talentSessions.status, ['pending', 'confirmed', 'live']),
          gte(talentSessions.scheduledAt, now)
        );
        break;
      case 'pending':
        tabCondition = eq(talentSessions.status, 'pending');
        break;
      case 'past':
        tabCondition = or(
          eq(talentSessions.status, 'completed'),
          and(
            inArray(talentSessions.status, ['confirmed', 'live']),
            lte(talentSessions.scheduledAt, now)
          )
        );
        break;
      case 'cancelled':
        tabCondition = inArray(talentSessions.status, ['cancelled', 'declined']);
        break;
      default:
        tabCondition = undefined;
        break;
    }
  }

  let dateCondition;
  if (date) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    dateCondition = and(
      gte(talentSessions.scheduledAt, dayStart),
      lte(talentSessions.scheduledAt, dayEnd)
    );
  }

  // ── 3. Fetch with talentProfile + user + booker ──
  const whereClause = and(roleCondition, tabCondition, dateCondition);

  const allSessions = await db.query.talentSessions.findMany({
    where: whereClause,
    with: {
      talentProfile: {
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              profileImage: true,
              image: true,
            },
          },
        },
      },
      booker: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          profileImage: true,
          image: true,
        },
      },
    },
    orderBy: (t, { desc, asc }) =>
      tab === 'past' || tab === 'cancelled' ? [desc(t.scheduledAt)] : [asc(t.scheduledAt)],
  });
  const normalizedSessions = allSessions.map(item => ({
    ...item,
    talentProfile: {
      ...item.talentProfile,
      user: normalizeUserImage(item.talentProfile?.user),
    },
    booker: normalizeUserImage(item.booker),
  }));
  // ── 4. Paginate ────────────────────────────────────────────────────────────
  const total = normalizedSessions.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const offset = (page - 1) * limit;
  const sessions = normalizedSessions.slice(offset, offset + limit);

  return { sessions, total, page, limit, totalPages };
}
// ─────────────────────────────────────────────────────────────────────────────
// TALENT REVIEW SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class TalentReviewService {
  /**
   * Submit a review — works for both session bookers and priority-message senders.
   *
   * Pass exactly one of:
   *   sessionId         — review a completed session (booker only)
   *   priorityMessageId — review after a paid priority message (sender only)
   *
   * Common fields: rating (1-5, required), communicationRating?, valueRating?, title?, comment?
   */
    static async create(
    reviewerId,
    {
      sessionId,
      priorityMessageId,
      shopCustomOfferId, 
      rating,
      communicationRating,
      valueRating,
      title,
      comment,
    }
  ) {
    if (rating < 1 || rating > 5) throw new ApiError(400, 'Rating must be between 1 and 5');

    let talentProfileId, sourceType, talentUserId;

    if (sessionId) {
      // ── Session path ────────────────────────────────────────────────────
      const session = await db.query.talentSessions.findFirst({
        where: eq(talentSessions.id, sessionId),
      });
      if (!session) throw new ApiError(404, 'Session not found');
      if (session.bookerId !== reviewerId)
        throw new ApiError(403, 'Only the booker can leave a review for this session');
      if (session.status !== 'completed')
        throw new ApiError(400, 'You can only review a completed session');

      const existing = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.sessionId, sessionId),
      });
      if (existing) throw new ApiError(409, 'You have already reviewed this session');

      talentProfileId = session.talentProfileId;
      sourceType = 'session';
      priorityMessageId = null;
      const tp = await db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.id, talentProfileId),
        columns: { userId: true },
      });
      talentUserId = tp.userId;
    } else if (priorityMessageId) {
      // ── Priority message path ───────────────────────────────────────────
      const payment = await db.query.priorityMessagePayments.findFirst({
        where: eq(priorityMessagePayments.id, priorityMessageId),
      });
      if (!payment) throw new ApiError(404, 'Priority message not found');
      if (payment.senderId !== reviewerId)
        throw new ApiError(403, 'Only the sender can leave a review for this message');
      if (payment.status !== 'paid')
        throw new ApiError(400, 'You can only review after a paid priority message');

      const existing = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.priorityMessageId, priorityMessageId),
      });
      if (existing) throw new ApiError(409, 'You have already reviewed this priority message');

            talentProfileId = payment.talentProfileId;
      sourceType = 'priority_message';
      sessionId = null;
      talentUserId = payment.talentUserId;
    } else if (shopCustomOfferId) {
      // ── Custom offer path ────────────────────────────────────────────────
      const offer = await db.query.shopCustomServiceOffers.findFirst({
        where: eq(shopCustomServiceOffers.id, shopCustomOfferId),
      });
      if (!offer) throw new ApiError(404, 'Offer not found');
      if (offer.buyerId !== reviewerId)
        throw new ApiError(403, 'Only the buyer can leave a review for this project');
      if (offer.status !== 'completed')
        throw new ApiError(400, 'You can only review a completed project');

      const existing = await db.query.talentReviews.findFirst({
        where: eq(talentReviews.shopCustomOfferId, shopCustomOfferId),
      });
      if (existing) throw new ApiError(409, 'You have already reviewed this project');

      const sellerProfile = await db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.userId, offer.sellerId),
        columns: { id: true, userId: true },
      });
      if (!sellerProfile) {
        throw new ApiError(409, 'This seller does not have a reviewable profile yet');
      }

      talentProfileId = sellerProfile.id;
      sourceType = 'shop_custom_offer';
      sessionId = null;
      priorityMessageId = null;
      talentUserId = sellerProfile.userId;
    } else {
      throw new ApiError(
        400,
        'One of `sessionId`, `priorityMessageId`, or `shopCustomOfferId` is required'
      );
    }

    // ── Shared: insert ────────────────────────────────────────────────────
    const reviewModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.REVIEW,
      entityCreatorId: reviewerId,
      texts: [title, comment],
    });

    const [review] = await db
      .insert(talentReviews)
      .values({
        talentProfileId,
        reviewerId,
        sourceType,
        sessionId,
        priorityMessageId,
         shopCustomOfferId: shopCustomOfferId ?? null,
        rating,
        communicationRating: communicationRating ?? null,
        valueRating: valueRating ?? null,
        title: title?.trim() || null,
        comment: comment?.trim() || null,
      })
      .returning();

    await TextModerationService.recordIfFlagged(reviewModeration, {
      entityType: TEXT_ENTITY.REVIEW,
      entityId: review.id,
      userId: reviewerId,
      fieldNames: ['title', 'comment'],
      texts: [title, comment],
    });

    // ── Shared: recompute + notify ────────────────────────────────────────
    await TalentReviewService._recomputeRating(talentProfileId);
    if (sourceType === 'shop_custom_offer' && shopCustomOfferId) {
  const { ShopCustomOfferService } = await import('./shop/shopCustomOffer.service.js');
  await ShopCustomOfferService.logActivity(shopCustomOfferId, reviewerId, 'review_submitted', {
    reviewId: review.id,
    rating,
    communicationRating: communicationRating ?? null,
    valueRating: valueRating ?? null,
    title: title?.trim() || null,
    comment: comment?.trim() || null,
  });
}
    const reviewer = await db.query.users.findFirst({ where: eq(users.id, reviewerId) });
    await notifyAndEmail({
      userId: talentUserId,
      title: 'New review received ⭐',
      message: `${reviewer.firstName} ${reviewer.lastName} left you a ${rating}-star review.`,
      type: 'social_update',
      redirectTo: '/talent-dashboard',
      relatedId: review.id,
      actorUserId: reviewerId,
    });

    return review;
  }

  /**
   * Get all visible reviews for a talent profile, newest first.
   */
  static async listForProfile(talentProfileId, { page = 1, limit = 10 } = {}) {
    limit = Math.min(Number(limit) || 10, 5000);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    const rows = await db.query.talentReviews.findMany({
      where: and(
        eq(talentReviews.talentProfileId, talentProfileId),
        eq(talentReviews.isVisible, true)
      ),
      with: {
        reviewer: {
          columns: { id: true, firstName: true, lastName: true, username: true, image: true },
        },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      limit,
      offset,
    });

    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(talentReviews)
      .where(
        and(eq(talentReviews.talentProfileId, talentProfileId), eq(talentReviews.isVisible, true))
      );

    const [stats] = await db
      .select({
        avgRating: sql`round(avg(${talentReviews.rating})::numeric, 2)`,
        avgCommunicationRating: sql`round(avg(${talentReviews.communicationRating})::numeric, 2)`,
        avgValueRating: sql`round(avg(${talentReviews.valueRating})::numeric, 2)`,
        totalReviews: sql`count(*)::int`,
        fiveStar: sql`count(*) filter (where ${talentReviews.rating} = 5)::int`,
        fourStar: sql`count(*) filter (where ${talentReviews.rating} = 4)::int`,
        threeStar: sql`count(*) filter (where ${talentReviews.rating} = 3)::int`,
        twoStar: sql`count(*) filter (where ${talentReviews.rating} = 2)::int`,
        oneStar: sql`count(*) filter (where ${talentReviews.rating} = 1)::int`,
      })
      .from(talentReviews)
      .where(
        and(eq(talentReviews.talentProfileId, talentProfileId), eq(talentReviews.isVisible, true))
      );

    return {
      reviews: rows,
      stats: {
        avgRating: parseFloat(stats.avgRating) || 0,
        avgCommunicationRating: parseFloat(stats.avgCommunicationRating) || 0,
        avgValueRating: parseFloat(stats.avgValueRating) || 0,
        totalReviews: stats.totalReviews,
        breakdown: {
          5: stats.fiveStar,
          4: stats.fourStar,
          3: stats.threeStar,
          2: stats.twoStar,
          1: stats.oneStar,
        },
      },
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
        hasMore: page * limit < count,
      },
    };
  }

  /**
   * Get the review for a specific session (if any), as the booker.
   */
  static async getForSession(sessionId, requesterId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, sessionId),
    });
    if (!session) throw new ApiError(404, 'Session not found');

    const talentProfile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.id, session.talentProfileId),
    });

    const isParticipant = session.bookerId === requesterId || talentProfile?.userId === requesterId;

    if (!isParticipant) throw new ApiError(403, 'Forbidden');

    const review = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.sessionId, sessionId),
      with: {
        reviewer: {
          columns: { id: true, firstName: true, lastName: true, username: true, image: true },
        },
      },
    });

    if (review) {
      const reviewFilterEnabled = await TextModerationService.getFilterEnabled(requesterId);
      await TextModerationService.maskFlaggedTextSingle(review, {
        entityType: TEXT_ENTITY.REVIEW,
        fields: ['title', 'comment'],
        filterEnabled: reviewFilterEnabled,
      });
    }

    return review ?? null;
  }

  /**
   * Update an existing review (reviewer edits their own).
   */
  static async update(
    reviewId,
    reviewerId,
    { rating, communicationRating, valueRating, title, comment }
  ) {
    const review = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.id, reviewId),
    });
    if (!review) throw new ApiError(404, 'Review not found');
    if (review.reviewerId !== reviewerId)
      throw new ApiError(403, 'You can only edit your own review');

    if (rating !== undefined && (rating < 1 || rating > 5))
      throw new ApiError(400, 'Rating must be between 1 and 5');

    const updates = { updatedAt: new Date() };
    if (rating !== undefined) updates.rating = rating;
    if (communicationRating !== undefined)
      updates.communicationRating = communicationRating ?? null;
    if (valueRating !== undefined) updates.valueRating = valueRating ?? null;
    if (title !== undefined) updates.title = title?.trim() || null;
    if (comment !== undefined) updates.comment = comment?.trim() || null;

    const reviewTextEntries = [
      ['title', updates.title],
      ['comment', updates.comment],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    let reviewModeration = { action: 'keep' };
    if (reviewTextEntries.length > 0) {
      reviewModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.REVIEW,
        entityId: reviewId,
        entityCreatorId: reviewerId,
        texts: reviewTextEntries.map(([, value]) => value),
      });
    }

    const [updated] = await db
      .update(talentReviews)
      .set(updates)
      .where(eq(talentReviews.id, reviewId))
      .returning();

    await TextModerationService.recordIfFlagged(reviewModeration, {
      entityType: TEXT_ENTITY.REVIEW,
      entityId: reviewId,
      userId: reviewerId,
      fieldNames: reviewTextEntries.map(([name]) => name),
      texts: reviewTextEntries.map(([, value]) => value),
    });

    if (rating !== undefined) {
      await TalentReviewService._recomputeRating(review.talentProfileId);
    }

    return updated;
  }

  /**
   * Talent reports a review as wrong/fake.
   * Reporter must be the owner of the talent profile that was reviewed.
   */
  static async reportReview(reviewId, reporterUserId, { reason }) {
    const review = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.id, reviewId),
    });
    if (!review) throw new ApiError(404, 'Review not found');

    // Only the talent whose profile was reviewed can report it
    const talentProfile = await db.query.talentProfiles.findFirst({
      where: and(
        eq(talentProfiles.id, review.talentProfileId),
        eq(talentProfiles.userId, reporterUserId)
      ),
    });
    if (!talentProfile)
      throw new ApiError(403, 'Only the talent can report a review on their profile');

    if (review.reportedAt) throw new ApiError(409, 'This review has already been reported');

    const [updated] = await db
      .update(talentReviews)
      .set({ reportedAt: new Date(), reportReason: reason?.trim() || null, updatedAt: new Date() })
      .where(eq(talentReviews.id, reviewId))
      .returning();

    return updated;
  }

  /**
   * Get all reviews submitted by the authenticated user.
   */
  static async getMyReviews(reviewerId, { page = 1, limit = 10 } = {}) {
    limit = Math.min(Number(limit) || 10, 5000);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    const rows = await db.query.talentReviews.findMany({
      where: eq(talentReviews.reviewerId, reviewerId),
      with: {
        talentProfile: {
          columns: { id: true, title: true, category: true },
          with: {
            user: {
              columns: { id: true, firstName: true, lastName: true, username: true, image: true },
            },
          },
        },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      limit,
      offset,
    });

    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(talentReviews)
      .where(eq(talentReviews.reviewerId, reviewerId));

    const myReviewsFilterEnabled = await TextModerationService.getFilterEnabled(reviewerId);
    await TextModerationService.maskFlaggedText(rows, {
      entityType: TEXT_ENTITY.REVIEW,
      fields: ['title', 'comment'],
      filterEnabled: myReviewsFilterEnabled,
    });

    return {
      reviews: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
        hasMore: page * limit < count,
      },
    };
  }

  /**
   * Admin: list all reviews that have been reported by talents.
   */
  static async adminListReported({ page = 1, limit = 20 } = {}) {
    limit = Math.min(Number(limit) || 20, 100);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    const rows = await db.query.talentReviews.findMany({
      where: isNotNull(talentReviews.reportedAt),
      with: {
        reviewer: {
          columns: { id: true, firstName: true, lastName: true, username: true, image: true },
        },
        talentProfile: {
          columns: { id: true, title: true, category: true },
          with: {
            user: { columns: { id: true, firstName: true, lastName: true, username: true } },
          },
        },
      },
      orderBy: (r, { desc }) => [desc(r.reportedAt)],
      limit,
      offset,
    });

    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(talentReviews)
      .where(isNotNull(talentReviews.reportedAt));

    return {
      reviews: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
        hasMore: page * limit < count,
      },
    };
  }

  /**
   * Admin: dismiss a report — clears reportedAt/reportReason, review stays visible.
   */
  static async adminDismissReviewReport(reviewId) {
    const review = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.id, reviewId),
    });
    if (!review) throw new ApiError(404, 'Review not found');
    if (!review.reportedAt) throw new ApiError(400, 'This review has no active report');

    const [updated] = await db
      .update(talentReviews)
      .set({ reportedAt: null, reportReason: null, updatedAt: new Date() })
      .where(eq(talentReviews.id, reviewId))
      .returning();

    return updated;
  }

  /**
   * Admin: hide a review by setting isVisible = false and recomputing profile rating.
   */
  static async adminRemoveReview(reviewId) {
    const review = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.id, reviewId),
    });
    if (!review) throw new ApiError(404, 'Review not found');

    const [updated] = await db
      .update(talentReviews)
      .set({ isVisible: false, updatedAt: new Date() })
      .where(eq(talentReviews.id, reviewId))
      .returning();

    await TalentReviewService._recomputeRating(review.talentProfileId);

    return updated;
  }

  /**
   * Recompute rating + reviewCount on the talent profile from all visible reviews.
   * Called after every insert/update/remove.
   */
  static async _recomputeRating(talentProfileId) {
    const [agg] = await db
      .select({
        avg: sql`round(avg(${talentReviews.rating})::numeric, 2)`,
        count: sql`count(*)::int`,
      })
      .from(talentReviews)
      .where(
        and(eq(talentReviews.talentProfileId, talentProfileId), eq(talentReviews.isVisible, true))
      );

    await db
      .update(talentProfiles)
      .set({
        rating: String(agg.avg ?? '0.00'),
        reviewCount: agg.count ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(talentProfiles.id, talentProfileId));
  }
}
