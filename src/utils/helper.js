import chalk from 'chalk';
import dayjs from 'dayjs';
import { db } from '../db/index.js';
import {
  events,
  groupEventPromotions,
  groupMembers,
  purchasedTickets,
  users,
  venues,
  userInformation,
} from '../db/schema/index.js';
import { eq, and, count, asc, gte, sql, inArray } from 'drizzle-orm';

export async function getGroupMemberCount(groupId) {
  const result = await db
    .select({ count: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')));
  return result[0]?.count || 0;
}

/**
 * Get user information by user ID
 * @param {string} userId - The user's ID
 * @returns {Promise<object|null>} User data object with selected fields or null if not found
 */
export async function getUserInformation(userId) {
  const result = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      name: users.name,
      image: users.image,
      bio: users.bio,
      phoneNumber: users.phoneNumber,
      isEmailVerified: users.isEmailVerified,
      preferences: users.preferences,
      lastLogin: users.lastLogin,
      timezone: users.timezone,
      locale: users.locale,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      address: userInformation.address,
      city: userInformation.city,
      state: userInformation.state,
      country: userInformation.country,
      postalCode: userInformation.postalCode,
      latitude: userInformation.latitude,
      longitude: userInformation.longitude,
      googlePlaceId: userInformation.googlePlaceId,
    })
    .from(users)
    .leftJoin(userInformation, eq(userInformation.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = result[0];
  if (!row) return null;

  const userInfo = {
    address: row.address || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || null,
    postalCode: row.postalCode || null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    googlePlaceId: row.googlePlaceId || null,
  };

  // Build returned object
  const user = {
    id: row.id,
    username: row.username,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    name: row.name,
    image: row.image,
    bio: row.bio,
    phoneNumber: row.phoneNumber,
    isEmailVerified: row.isEmailVerified,
    preferences: row.preferences,
    lastLogin: row.lastLogin,
    timezone: row.timezone,
    locale: row.locale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userInformation: userInfo,
  };

  return user;
}
/**
 * Batch-fetch minimal actor profiles for notification enrichment.
 * Returns a map keyed by user ID for O(1) lookup.
 * @param {string[]} userIds
 */
export async function getActorDisplayName(userId) {
  if (!userId) return 'Someone';
  const rows = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const u = rows[0];
  if (!u) return 'Someone';
  return `${u.firstName} ${u.lastName}`.trim() || 'Someone';
}

export async function getActorProfiles(userIds) {
  if (!userIds?.length) return {};
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
      image: users.image,
    })
    .from(users)
    .where(inArray(users.id, uniqueIds));

  return Object.fromEntries(
    rows.map(row => [
      row.id,
      {
        ...row,
        profileImage: row.image,
      },
    ])
  );
}

//add background color to log messages
export function logInfo(message, data = null) {
  console.log(chalk.blue('[INFO]'), chalk.bgYellow(message));
  if (data) {
    console.log(chalk.blue('[data]'), chalk.bgYellow('---->>>>>>>>>>'), data);
  }
}

export function logWarning(message) {
  console.log(chalk.yellow('[WARNING]'), chalk.bgYellow(message));
}

export function logError(message) {
  console.log(chalk.red('[ERROR]'), chalk.bgRed(message));
}

export function getCurrentUserMembership(memberships, groupId) {
  const membership = memberships.find(m => m.groupId === groupId);
  if (!membership) return null;
  return {
    isJoined: membership.status === 'joined',
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
  };
}

/**
 * Build a frontend door-sales landing page URL
 * @param {string} token - door sales token
 * @returns {string}
 */
export function buildDoorSalesUrl(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid door sales token');
  }
  const frontendBase = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://gokyro.com';
  // const frontendBase =  'http://localhost:3000';
  return `${frontendBase.replace(/\/+$/, '')}/door-sale/${encodeURIComponent(token)}`;
}

/**
 * Build a frontend ticket-bundle download page URL
 * @param {string} orderId
 * @returns {string}
 */
export function buildTicketBundleUrl(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('Invalid order ID');
  }
  const frontendBase = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://gokyro.com';
  return `${frontendBase.replace(/\/+$/, '')}/door-sale/success?orderId=${encodeURIComponent(orderId)}`;
}

/**
 * Build a frontend single ticket view URL
 * @param {string} ticketCode
 * @returns {string}
 */
export function buildTicketUrl(ticketCode) {
  if (!ticketCode || typeof ticketCode !== 'string') {
    throw new Error('Invalid ticket code');
  }
  const frontendBase = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://gokyro.com';
  return `${frontendBase.replace(/\/+$/, '')}/tickets/${encodeURIComponent(ticketCode)}`;
}

/**
 * Get the group admin information
 * @param {string} groupId - The group's ID
 * @returns {Promise<object|null>} Admin user data object or null if not found
 */
export async function getGroupAdmin(groupId) {
  const [admin] = await db
    .select({
      userId: groupMembers.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      image: users.image,
    })
    .from(groupMembers)
    .leftJoin(users, eq(groupMembers.userId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin')))
    .limit(1);

  return admin || null;
}

/**
 * Get count of tickets purchased by a user for a specific ticket tier
 * @param {string} userId - The user's ID
 * @param {string} ticketTierId - The ticket tier ID
 * @returns {Promise<number>} Number of tickets purchased
 */
export async function getUserTicketCountForTier(userId, ticketTierId) {
  const result = await db
    .select({ count: count() })
    .from(purchasedTickets)
    .where(
      and(
        eq(purchasedTickets.userId, userId),
        eq(purchasedTickets.ticketTierId, ticketTierId),
        eq(purchasedTickets.status, 'active')
      )
    );
  return result[0]?.count || 0;
}

/**
 * Get ticket counts for multiple tiers for a specific user
 * @param {string} userId - The user's ID
 * @param {string[]} ticketTierIds - Array of ticket tier IDs
 * @returns {Promise<Map<string, number>>} Map of ticket tier ID to count
 */
export async function getUserTicketCountsForTiers(userId, ticketTierIds) {
  if (!userId || !ticketTierIds || ticketTierIds.length === 0) {
    return new Map();
  }

  const results = await db
    .select({
      ticketTierId: purchasedTickets.ticketTierId,
      count: count(),
    })
    .from(purchasedTickets)
    .where(and(eq(purchasedTickets.userId, userId), eq(purchasedTickets.status, 'active')))
    .groupBy(purchasedTickets.ticketTierId);

  const countsMap = new Map();
  results.forEach(result => {
    countsMap.set(result.ticketTierId, result.count);
  });

  return countsMap;
}

export async function getNextTwoEventsByGroupId(groupId) {
  return await db
    .select({
      id: events.id,
      title: events.title,
      startDate: events.startDate,
      endDate: events.endDate,
      coverImageUrl: events.coverImages,
      capacity: events.capacity,
      checkInCount: events.checkInCount,
      venueCity: venues.city,
      venueState: venues.state,
      venueCountry: venues.country,
      slug: events.slug,
    })
    .from(groupEventPromotions)
    .innerJoin(events, eq(events.id, groupEventPromotions.eventId))
    .leftJoin(venues, eq(events.venueId, venues.id))
    .where(
      and(
        eq(groupEventPromotions.groupId, groupId),
        gte(events.startDate, sql`NOW()`),
        eq(events.eventStatus, 'published')
      )
    )
    .orderBy(asc(events.startDate))
    .limit(2);
}

/**
 * Parse date string to Date object using dayjs
 * Supports multiple formats: YYYY-MM-DD, YY-MM-DD, MM-DD-YYYY, etc.
 * @param {string} dateString - Date string to parse
 * @returns {Date} Parsed Date object
 */
export function parseDate(dateString) {
  if (!dateString) return null;

  // Try parsing with common formats
  const formats = [
    'YYYY-MM-DD',
    'YY-MM-DD',
    'DD-MM-YYYY',
    'MM-DD-YYYY',
    'YYYY/MM/DD',
    'DD/MM/YYYY',
  ];

  for (const format of formats) {
    const parsed = dayjs(dateString, format);
    if (parsed.isValid()) {
      return parsed.toDate();
    }
  }

  // Fallback to default parsing
  const fallback = dayjs(dateString);
  return fallback.isValid() ? fallback.toDate() : null;
}

/**
 * Parse date string to ISO string using dayjs
 * Supports multiple formats: YYYY-MM-DD, YY-MM-DD, MM-DD-YYYY, etc.
 * @param {string} dateString - Date string to parse
 * @returns {string} ISO string
 */
export function parseDateToISO(dateString) {
  if (!dateString) return null;

  // Try parsing with common formats
  const formats = [
    'YYYY-MM-DD',
    'YY-MM-DD',
    'DD-MM-YYYY',
    'MM-DD-YYYY',
    'YYYY/MM/DD',
    'DD/MM/YYYY',
  ];

  for (const format of formats) {
    const parsed = dayjs(dateString, format);
    if (parsed.isValid()) {
      return parsed.toISOString();
    }
  }

  // Fallback to default parsing
  const fallback = dayjs(dateString);
  return fallback.isValid() ? fallback.toISOString() : null;
}

/**
 * Get date N days ago from now using dayjs
 * @param {number} days - Number of days ago
 * @returns {Date} Date object
 */
export function getDaysAgo(days) {
  return dayjs().subtract(days, 'day').toDate();
}

/**
 * Standard age range buckets used across analytics breakdowns.
 */
export const AGE_RANGES = [
  { label: '18-24', min: 18, max: 24 },
  { label: '25-34', min: 25, max: 34 },
  { label: '35-44', min: 35, max: 44 },
  { label: '45-54', min: 45, max: 54 },
  { label: '55+', min: 55, max: null },
];

/**
 * Compute percentage breakdown from a list of { label, count } items.
 * The total is derived from the sum of all items.
 * @param {Array<{ label: string, count: number }>} items
 * @returns {Array<{ label: string, count: number, percentage: number }>}
 */
export function computePercentageBreakdown(items) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items.map(item => ({
    label: item.label,
    count: item.count,
    percentage: total > 0 ? parseFloat(((item.count / total) * 100).toFixed(1)) : 0,
  }));
}

/**
 * Get default date range for analytics (last 30 days)
 * @param {string} dateFrom - Optional start date
 * @param {string} dateTo - Optional end date
 * @returns {Object} Object with startDate and endDate as Date objects
 */
export function getDateRange(dateFrom, dateTo) {
  let startDate = null;
  let endDate = null;

  if (dateFrom) {
    const parsed = parseDate(dateFrom);
    startDate = parsed || getDaysAgo(30);
  } else {
    startDate = getDaysAgo(30);
  }

  if (dateTo) {
    const parsed = parseDate(dateTo);
    endDate = parsed || dayjs().toDate();
  } else {
    endDate = dayjs().toDate();
  }

  // Ensure startDate is before endDate
  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  return { startDate, endDate };
}
