import { db } from '../db/index.js';
import { groupMembers, discussions, groups, groupJoinRequests } from '../db/schema/index.js';
import { and, inArray, eq, like, isNull, sql } from 'drizzle-orm';
import ApiError from './api-error.js';
import slugify from 'slugify';

/**
 * Verify that a user is a member of a group
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID
 * @param {Object} options - Optional configuration
 * @param {string|string[]} options.status - Required status(es) (default: 'joined')
 * @param {string|string[]} options.role - Required role(s) (optional)
 * @param {string} options.errorMessage - Custom error message
 * @param {number} options.errorCode - Custom error code (default: 403)
 * @returns {Promise<Object>} The membership record
 * @throws {ApiError} If user is not a member or doesn't meet requirements
 */
export async function verifyGroupMembership(groupId, userId, options = {}) {
  const {
    status = 'joined',
    role = null,
    errorMessage = 'Unauthorized to access this group.',
    errorCode = 403,
  } = options;

  const conditions = [eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)];

  // Handle status condition
  if (Array.isArray(status)) {
    conditions.push(inArray(groupMembers.status, status));
  } else {
    conditions.push(eq(groupMembers.status, status));
  }

  const membership = await db.query.groupMembers.findFirst({
    where: and(...conditions),
  });

  if (!membership) {
    throw new ApiError(errorCode, errorMessage);
  }

  // Check role if specified
  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!allowedRoles.includes(membership.role)) {
      throw new ApiError(
        errorCode,
        `This action requires one of the following roles: ${allowedRoles.join(', ')}`
      );
    }
  }

  return membership;
}

/**
 * Check if a user is a member of a group (non-throwing version)
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID
 * @param {Object} options - Optional configuration
 * @param {string|string[]} options.status - Required status(es) (default: 'joined')
 * @param {string|string[]} options.role - Required role(s) (optional)
 * @returns {Promise<Object|null>} The membership record or null
 */
export async function checkGroupMembership(groupId, userId, options = {}) {
  const { status = 'joined', role = null } = options;

  const conditions = [eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)];

  // Handle status condition
  if (Array.isArray(status)) {
    conditions.push(inArray(groupMembers.status, status));
  } else {
    conditions.push(eq(groupMembers.status, status));
  }

  const membership = await db.query.groupMembers.findFirst({
    where: and(...conditions),
  });

  if (!membership) {
    return null;
  }

  // Check role if specified
  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!allowedRoles.includes(membership.role)) {
      return null;
    }
  }

  return membership;
}

/**
 * Check if a user has a pending join request for a group
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object|null>} The pending join request or null
 */
export async function checkPendingJoinRequest(groupId, userId) {
  const [pendingRequest] = await db
    .select()
    .from(groupJoinRequests)
    .where(
      and(
        eq(groupJoinRequests.groupId, groupId),
        eq(groupJoinRequests.userId, userId),
        eq(groupJoinRequests.status, 'pending')
      )
    )
    .limit(1);

  return pendingRequest || null;
}

/**
 * Require that a user has admin or moderator role in a group
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Object>} The membership record
 * @throws {ApiError} If user is not an admin or moderator
 */
export async function requireGroupAdminOrModerator(groupId, userId, errorMessage = null) {
  return await verifyGroupMembership(groupId, userId, {
    role: ['admin', 'moderator', 'owner'],
    errorMessage: errorMessage || 'You are not authorized to perform this action',
    errorCode: 403,
  });
}

/**
 * Require that a user has admin role in a group
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Object>} The membership record
 * @throws {ApiError} If user is not an admin
 */
export async function requireGroupAdmin(groupId, userId, errorMessage = null) {
  return await verifyGroupMembership(groupId, userId, {
    role: ['admin', 'owner'],
    errorMessage: errorMessage || 'You must be a group admin to perform this action',
    errorCode: 403,
  });
}

/**
 * Require that a user is the original creator (createdBy) of a group.
 * Used to gate tier management to the group creator only.
 */
export async function requireGroupCreator(groupId, userId, errorMessage = null) {
  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), isNull(groups.deletedAt)),
    columns: { id: true, createdBy: true },
  });

  if (!group) throw new ApiError(404, 'Group not found');
  if (group.createdBy !== userId) {
    throw new ApiError(403, errorMessage || 'Only the group creator can perform this action');
  }

  return group;
}

/**
 * Get all discussion IDs for a group
 * @param {string} groupId - The group ID
 * @returns {Promise<string[]>} Array of discussion IDs
 */
export async function getGroupDiscussionIds(groupId) {
  const groupDiscussions = await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(eq(discussions.groupId, groupId));

  return groupDiscussions.map(d => d.id);
}

/**
 * Get all discussions with their IDs for a group
 * @param {string} groupId - The group ID
 * @returns {Promise<Array>} Array of discussion objects with id
 */
export async function getGroupDiscussions(groupId) {
  return await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(eq(discussions.groupId, groupId));
}

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
