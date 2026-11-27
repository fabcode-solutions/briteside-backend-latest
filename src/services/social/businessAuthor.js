import httpStatus from 'http-status';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { businesses, events, groups, livestreams, posts, stories } from '../../db/schema/index.js';
import ApiError from '../../utils/api-error.js';
import { resolveBusinessAccess } from '../../middlewares/businessAccess.middleware.js';
import { BUSINESS_PERMISSIONS } from '../../config/business-permissions.js';

/**
 * Business-authored posts and stories.
 *
 * A business is a separate account: content published while acting as it has
 * `business_id` set. `user_id` stays the person who made it (owner or a team
 * member), so edit/delete keep working as before; everyone else sees the
 * business — name, logo, page link — as the author, never the person.
 */

/** The business `user` may publish as (owner, or a team member who can edit its page). */
export async function assertCanPublishAs(user, businessId) {
  const business = await db.query.businesses.findFirst({
    where: and(eq(businesses.id, businessId), isNull(businesses.deletedAt)),
  });
  const access = business ? await resolveBusinessAccess(business, user) : null;
  if (!access) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  if (!access.permissions.includes(BUSINESS_PERMISSIONS.PROFILE_EDIT)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to post as this business');
  }
  return business;
}

export const toBusinessAuthor = b => ({
  id: b.id,
  name: b.name,
  slug: b.slug,
  logoUrl: b.logoUrl ?? null,
  href: `/business/${b.slug}`,
});

/** businessId → author, for the given business ids. */
export async function businessAuthorsById(businessIds) {
  const ids = [...new Set(businessIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.query.businesses.findMany({
    where: inArray(businesses.id, ids),
    columns: { id: true, name: true, slug: true, logoUrl: true },
  });
  return new Map(rows.map(b => [b.id, toBusinessAuthor(b)]));
}

/**
 * Sets `business` (author) and `businessId` on every item that is a
 * business-authored post / story; leaves the rest untouched (business: null).
 * Works on any serialized shape that has the row's `id`, so each listing
 * endpoint only needs one call before it returns. Mutates and returns `items`.
 */
async function attach(items, table) {
  const list = (Array.isArray(items) ? items : [items]).filter(i => i && i.id && !i.isStory);
  if (!list.length) return items;
  const rows = await db
    .select({ id: table.id, businessId: table.businessId })
    .from(table)
    .where(inArray(table.id, [...new Set(list.map(i => i.id))]));
  const businessOf = new Map(rows.map(r => [r.id, r.businessId]));
  const authors = await businessAuthorsById(rows.map(r => r.businessId));
  for (const item of list) {
    const businessId = businessOf.get(item.id) ?? null;
    const business = businessId ? (authors.get(businessId) ?? null) : null;
    item.businessId = businessId;
    item.business = business;
    if (business && item.user) item.user = asBusinessUser(item.user, business);
  }
  return items;
}

/**
 * The author block shown for a business's content: the business's name, logo
 * and handle (business handles share the username namespace, and /<handle>
 * opens the business page). Only the creator's id is kept, for the "is this
 * mine" checks (edit / delete) — nothing else about the person is exposed.
 */
export function asBusinessUser(user, business, { idIsBusiness = false } = {}) {
  return {
    // Story rings are grouped by user id in the app, so a business's ring uses
    // the business id (never merging with the owner's own ring)
    id: idIsBusiness ? business.id : user.id,
    username: business.slug,
    firstName: business.name,
    lastName: '',
    name: business.name,
    image: business.logoUrl,
    bio: null,
    isPublic: true,
    coverImages: [],
    hasStory: false,
    isEmailVerified: false,
    isBritesidePlus: false,
    isBusiness: true,
    businessId: business.id,
  };
}

export const attachBusinessAuthorsToPosts = items => attach(items, posts);
export const attachBusinessAuthorsToStories = items => attach(items, stories);

/** businessId of each row of `table` among `ids`. */
async function businessIdsOf(table, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: table.id, businessId: table.businessId })
    .from(table)
    .where(inArray(table.id, unique));
  return new Map(rows.map(r => [r.id, r.businessId]));
}

/**
 * Events hosted as a business: `business` is set and the organizer / creator
 * blocks show the business (name, logo) instead of the person's organizer
 * profile. The organizer's id stays — it still runs tickets and payouts.
 * Works on any event shape with `id`; mutates and returns `items`.
 */
export async function attachBusinessHostsToEvents(items) {
  const list = (Array.isArray(items) ? items : [items]).filter(e => e && e.id);
  if (!list.length) return items;
  const businessOf = await businessIdsOf(events, list.map(e => e.id));
  const authors = await businessAuthorsById([...businessOf.values()]);
  for (const event of list) {
    const businessId = businessOf.get(event.id) ?? null;
    const business = businessId ? (authors.get(businessId) ?? null) : null;
    event.businessId = businessId;
    event.business = business;
    if (!business) continue;
    event.hostedBy = business.name;
    if (event.organizer && typeof event.organizer === 'object') {
      event.organizer = {
        ...event.organizer,
        businessName: business.name,
        logoUrl: business.logoUrl,
        about: null,
        businessDescription: null,
        websiteUrl: null,
        contactEmail: null,
        contactPhone: null,
        isBusiness: true,
        businessId: business.id,
        businessSlug: business.slug,
      };
    }
    if (event.createdBy && typeof event.createdBy === 'object') {
      event.createdBy = asBusinessUser(event.createdBy, business);
    }
  }
  return items;
}

/**
 * Groups run as a business: `business` is set and the creator block shows the
 * business. Mutates and returns `items`.
 */
export async function attachBusinessHostsToGroups(items) {
  const list = (Array.isArray(items) ? items : [items]).filter(g => g && g.id);
  if (!list.length) return items;
  const businessOf = await businessIdsOf(groups, list.map(g => g.id));
  const authors = await businessAuthorsById([...businessOf.values()]);
  for (const group of list) {
    const businessId = businessOf.get(group.id) ?? null;
    const business = businessId ? (authors.get(businessId) ?? null) : null;
    group.businessId = businessId;
    group.business = business;
    if (!business) continue;
    // The creator block (an object on detail reads; just an id on lists)
    for (const key of ['createdBy', 'creator', 'createdByUser', 'owner']) {
      if (group[key] && typeof group[key] === 'object') group[key] = asBusinessUser(group[key], business);
    }
  }
  return items;
}

/**
 * Live streams broadcast as a business: the host block (`user`) shows the
 * business. Mutates and returns `items`.
 */
export async function attachBusinessHostsToLivestreams(items) {
  const list = (Array.isArray(items) ? items : [items]).filter(s => s && s.id);
  if (!list.length) return items;
  const businessOf = await businessIdsOf(livestreams, list.map(s => s.id));
  const authors = await businessAuthorsById([...businessOf.values()]);
  for (const stream of list) {
    const businessId = businessOf.get(stream.id) ?? null;
    const business = businessId ? (authors.get(businessId) ?? null) : null;
    stream.businessId = businessId;
    stream.business = business;
    if (business && stream.user && typeof stream.user === 'object') {
      stream.user = asBusinessUser(stream.user, business);
    }
  }
  return items;
}
