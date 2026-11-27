/**
 * Pinned business pages. Both pin tables (pinned_profiles for people,
 * business_pinned_profiles for business accounts) hold either a pinned person
 * or a pinned business page; these helpers handle the business side and merge
 * both kinds into one list (newest pin first).
 */
import httpStatus from 'http-status';
import { and, count, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The business page being pinned (by id or @username / slug). */
export async function findPinnableBusiness(idOrSlug) {
  const key = String(idOrSlug ?? '').trim().replace(/^@/, '');
  if (!key) throw new ApiError(httpStatus.BAD_REQUEST, 'Business is required');
  const business = await db.query.businesses.findFirst({
    where: and(
      UUID_RE.test(key) ? eq(businesses.id, key) : sql`lower(${businesses.slug}) = lower(${key})`,
      isNull(businesses.deletedAt)
    ),
    columns: { id: true, slug: true, name: true },
  });
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  return business;
}

/**
 * Toggle a business-page pin in `table`, owned by `table[ownerKey] = ownerId`
 * (pinned_profiles 'userId', or business_pinned_profiles 'businessId').
 */
export async function toggleBusinessPin(table, ownerKey, ownerId, businessId) {
  const ownerCol = table[ownerKey];
  const where = and(eq(ownerCol, ownerId), eq(table.pinnedBusinessId, businessId));
  const [existing] = await db.select({ id: table.id }).from(table).where(where).limit(1);
  if (existing) {
    await db.delete(table).where(eq(table.id, existing.id));
    return { pinned: false };
  }
  await db
    .insert(table)
    .values({ [ownerKey]: ownerId, pinnedBusinessId: businessId })
    .onConflictDoNothing();
  return { pinned: true };
}

export async function isBusinessPinned(table, ownerKey, ownerId, businessId) {
  const ownerCol = table[ownerKey];
  const [existing] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(ownerCol, ownerId), eq(table.pinnedBusinessId, businessId)))
    .limit(1);
  return !!existing;
}

/**
 * The newest `take` business-page pins, in the pin-list row shape (people rows
 * use username / firstName / lastName / image / bio; a business maps to
 * @slug / name / logo / subcategory), tagged type 'business'.
 */
export async function pinnedBusinessRows(table, ownerKey, ownerId, { search = '', take }) {
  const ownerCol = table[ownerKey];
  const nameCondition = search
    ? or(
        sql`${businesses.name} ILIKE ${`%${search}%`}`,
        sql`${businesses.slug} ILIKE ${`%${search}%`}`
      )
    : undefined;
  const rows = await db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      logoUrl: businesses.logoUrl,
      subcategory: businesses.subcategory,
      city: businesses.city,
      pinnedAt: table.createdAt,
    })
    .from(table)
    .innerJoin(businesses, eq(businesses.id, table.pinnedBusinessId))
    .where(and(eq(ownerCol, ownerId), isNull(businesses.deletedAt), nameCondition))
    .orderBy(desc(table.createdAt))
    .limit(take);
  return rows.map(b => ({
    id: b.id,
    username: b.slug,
    firstName: b.name,
    lastName: null,
    image: b.logoUrl,
    bio: [b.subcategory, b.city].filter(Boolean).join(' · ') || null,
    pinnedAt: b.pinnedAt,
    type: 'business',
  }));
}

export async function countPinnedBusinesses(table, ownerKey, ownerId) {
  const ownerCol = table[ownerKey];
  const [{ value }] = await db
    .select({ value: count() })
    .from(table)
    .innerJoin(businesses, eq(businesses.id, table.pinnedBusinessId))
    .where(and(eq(ownerCol, ownerId), isNotNull(table.pinnedBusinessId), isNull(businesses.deletedAt)));
  return Number(value);
}

/**
 * One page of people + business pins together, newest first. Each source must
 * be fetched with take = offset + limit + 1 so hasMore is exact.
 */
export function mergePinPage(peopleRows, businessRows, offset, limit) {
  const merged = [...peopleRows.map(r => ({ ...r, type: 'user' })), ...businessRows].sort(
    (a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()
  );
  const items = merged.slice(offset, offset + limit);
  return { items, hasMore: merged.length > offset + limit };
}
