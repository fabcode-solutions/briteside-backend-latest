import { db } from '../db/index.js';
import { groups } from '../db/schema/index.js';
import { eq, like, and, isNull, sql } from 'drizzle-orm';
import slugify from 'slugify';

/**
 * Generate a URL-friendly slug from a group name
 * @param {string} name - The group name
 * @returns {string} A slugified version of the name
 */
export function generateSlugFromName(name) {
  return slugify(name, {
    lower: true,
    strict: true,
    trim: true,
  });
}

/**
 * Generates a unique slug by appending an incrementing suffix if duplicates exist.
 * e.g. "tech-meetup" → "tech-meetup-1" → "tech-meetup-2"
 *
 * @param {string} baseSlug - The initial slug (name-slugified)
 * @param {string} [excludeGroupId] - Optional group ID to exclude from uniqueness check (for updates)
 * @returns {Promise<string>} A slug guaranteed to be unique in the groups table
 */
export async function generateUniqueGroupSlug(baseSlug, excludeGroupId = null) {
  // Build conditions for the query
  const conditions = [eq(groups.slug, baseSlug), isNull(groups.deletedAt)];

  if (excludeGroupId) {
    // When updating, exclude the current group from the check
    conditions.push(sql`${groups.id} != ${excludeGroupId}`);
  }

  // Check if the base slug is already taken
  const existing = await db.query.groups.findFirst({
    where: and(...conditions),
  });

  if (!existing) {
    return baseSlug; // No conflict, use as-is
  }

  // Find all slugs that start with the base slug followed by a dash and a number
  // e.g. "tech-meetup-1", "tech-meetup-2", ...
  const searchPattern = `${baseSlug}-%`;

  const whereConditions = [like(groups.slug, searchPattern), isNull(groups.deletedAt)];

  if (excludeGroupId) {
    whereConditions.push(sql`${groups.id} != ${excludeGroupId}`);
  }

  const candidates = await db
    .select({ slug: groups.slug })
    .from(groups)
    .where(and(...whereConditions));

  // Extract the numeric suffixes from matching slugs
  let maxSuffix = 0;
  for (const { slug } of candidates) {
    const tail = slug.slice(baseSlug.length + 1); // strip "baseSlug-"
    const num = Number(tail);
    if (Number.isInteger(num) && num >= maxSuffix) {
      maxSuffix = num;
    }
  }

  return `${baseSlug}-${maxSuffix + 1}`;
}

/**
 * Generate a unique slug for a group based on its name
 * @param {string} name - The group name
 * @param {string} [excludeGroupId] - Optional group ID to exclude from uniqueness check (for updates)
 * @returns {Promise<string>} A unique slug for the group
 */
export async function createUniqueSlugForGroup(name, excludeGroupId = null) {
  const baseSlug = generateSlugFromName(name);
  return generateUniqueGroupSlug(baseSlug, excludeGroupId);
}

/**
 * Check if a slug needs to be regenerated (when group name changes)
 * @param {string} oldName - The old group name
 * @param {string} newName - The new group name
 * @returns {boolean} Whether the slug should be regenerated
 */
export function shouldRegenerateSlug(oldName, newName) {
  if (!newName || !oldName) return false;
  return oldName.trim() !== newName.trim();
}
