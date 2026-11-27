import { z } from 'zod';
import {
  BUSINESS_MESSAGES_FROM,
  BUSINESS_NOTIFICATION_KEYS,
  BUSINESS_WALL_POSTS,
} from '../config/business-account.js';

const uuid = z.string().uuid();
const businessIdParams = z.object({ businessId: uuid });
const usernameParam = z.string().trim().min(1).max(100);
const pageQuery = z.coerce.number().int().min(1).max(10000).optional();
const limitQuery = z.coerce.number().int().min(1).max(100).optional();

export const businessOnlySchema = z.object({ params: businessIdParams });

export const updateNotificationSettingsSchema = z.object({
  params: businessIdParams,
  body: z.object({
    prefs: z.object(Object.fromEntries(BUSINESS_NOTIFICATION_KEYS.map(k => [k, z.boolean().optional()]))).strict(),
  }),
});

export const updatePrivacySchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      messagesFrom: z.enum(BUSINESS_MESSAGES_FROM).optional(),
      wallPosts: z.enum(BUSINESS_WALL_POSTS).optional(),
      showReviews: z.boolean().optional(),
      showFollowerCount: z.boolean().optional(),
      showStaff: z.boolean().optional(),
      hideAddressUntilBooked: z.boolean().optional(),
      discoverable: z.boolean().optional(),
      profanityFilter: z.boolean().optional(),
    })
    .strict(),
});

export const blockUserSchema = z.object({
  params: businessIdParams,
  body: z.object({ username: usernameParam }),
});

export const unblockUserSchema = z.object({
  params: z.object({ businessId: uuid, userId: uuid }),
});

export const listPinnedSchema = z.object({
  params: businessIdParams,
  query: z.object({
    page: pageQuery,
    limit: limitQuery,
    search: z.string().trim().max(100).optional(),
  }),
});

export const pinUsernameSchema = z.object({
  params: z.object({ businessId: uuid, username: usernameParam }),
});

export const pinBusinessSchema = z.object({
  params: z.object({ businessId: uuid, idOrSlug: z.string().trim().min(1).max(120) }),
});

export const saveInterestsSchema = z.object({
  params: businessIdParams,
  body: z.object({
    eventCategoryIds: z.array(uuid).max(200),
    groupCategoryIds: z.array(uuid).max(200),
  }),
});

export const paymentPortalSchema = z.object({
  params: businessIdParams,
  body: z.object({ returnUrl: z.string().url().max(2000) }),
});

export const spendTimelineSchema = z.object({
  params: businessIdParams,
  query: z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
});

export const spendRecentSchema = z.object({
  params: businessIdParams,
  query: z.object({
    page: pageQuery,
    limit: limitQuery,
    type: z.string().trim().max(50).optional(),
  }),
});

export const listPurchasesSchema = z.object({
  params: businessIdParams,
  query: z.object({ page: pageQuery, limit: limitQuery }),
});

export const purchaseDownloadSchema = z.object({
  params: z.object({ businessId: uuid, orderId: uuid }),
});
