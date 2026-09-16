import { db } from '../db/index.js';
import { userReports } from '../db/schema/userReports.js';
import { users, roles, userRoles, userInformation } from '../db/schema/users.js';
import {
  posts,
  postComments,
  socialProfiles,
  interestCategories,
  userInterests,
} from '../db/schema/social.js';
import { categories } from '../db/schema/categories.js';
import { auditLogs, systemSettings } from '../db/schema/admin.js';
import { events } from '../db/schema/events.js';
import { groups, groupMembers, discussions, discussionReplies } from '../db/schema/groups.js';
import { orders } from '../db/schema/payments.js';
import { organizers } from '../db/schema/organizers.js';
import dayjs from 'dayjs';
import env from '../config/config.js';
import * as tokenService from './token.service.js';
import { TOKEN_TYPES } from '../config/tokens.js';
import { ACCESS_TOKEN_TTL_DAYS } from './auth.service.js';
import { EventService } from './event.service.js';
import {
  eq,
  and,
  desc,
  asc,
  or,
  ilike,
  isNull,
  isNotNull,
  sql,
  inArray,
  gte,
  lte,
  count,
} from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { talentSessionFrames } from '../db/schema/talentSessionFrames.js';
import { sendSuspensionEmail, sendUnsuspensionEmail } from './mail.service.js';

const PLATFORM_FEE_KEY = 'platform_fee_percentage';

/**
 * Write an audit log entry for admin actions.
 */
export const writeAuditLog = async (
  adminId,
  action,
  resourceType,
  resourceId,
  { previousValues, newValues, changes } = {}
) => {
  await db.insert(auditLogs).values({
    userId: adminId,
    action,
    resourceType,
    resourceId,
    previousValues: previousValues ?? null,
    newValues: newValues ?? null,
    changes: changes ?? null,
    createdAt: new Date(),
  });
};

/**
 * Update report status
 * @param {string} reportId - Report ID
 * @param {Object} updateData - Update data
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Updated report
 */
const updateReportStatus = async (reportId, updateData, adminId) => {
  const { status, actionTaken } = updateData;

  const [updatedReport] = await db
    .update(userReports)
    .set({
      status,
      actionTaken,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .where(eq(userReports.id, reportId))
    .returning();

  if (!updatedReport) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
  }

  // Fetch full report with relations
  const report = await db.query.userReports.findFirst({
    where: eq(userReports.id, reportId),
    with: {
      reporter: {
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      targetUser: {
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          isSuspended: true,
        },
      },
      reviewedBy: {
        columns: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return report;
};

/**
 * Toggle user suspension status (suspend or unsuspend)
 * @param {string} userId - User ID
 * @param {Object} suspensionData - Suspension details
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Updated user
 */
const toggleUserSuspension = async (userId, suspensionData, adminId) => {
  const { isSuspended, reason, duration, reportId } = suspensionData;

  // Check if user exists
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, isSuspended: true, suspendedUntil: true },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  let updateData;
  let actionMessage;

  if (isSuspended) {
    // Suspending user
    if (user.isSuspended) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User is already suspended');
    }

    // Calculate suspension end date if duration provided (in days)
    let suspendedUntil = null;
    if (duration) {
      suspendedUntil = new Date();
      suspendedUntil.setDate(suspendedUntil.getDate() + duration);
    }

    updateData = {
      isSuspended: true,
      suspendedUntil,
      suspensionReason: reason,
    };
    actionMessage = `User suspended: ${reason}`;
  } else {
    // Unsuspending user
    if (!user.isSuspended) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User is not suspended');
    }

    updateData = {
      isSuspended: false,
      suspendedUntil: null,
      suspensionReason: null,
    };
    actionMessage = 'User unsuspended';
  }

  // Update user suspension status
  const [updatedUser] = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      isSuspended: users.isSuspended,
      suspendedUntil: users.suspendedUntil,
      suspensionReason: users.suspensionReason,
    });

  // Fire-and-forget — email failure must not break the API response
  if (user.email) {
    if (isSuspended) {
      sendSuspensionEmail({
        to: user.email,
        username: user.username || user.firstName,
        reason,
        suspendedUntil: updatedUser.suspendedUntil,
      }).catch(() => {});
    } else {
      sendUnsuspensionEmail({
        to: user.email,
        username: user.username || user.firstName,
      }).catch(() => {});
    }
  }

  // Update related report if provided
  if (reportId) {
    await db
      .update(userReports)
      .set({
        status: 'resolved',
        actionTaken: actionMessage,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      })
      .where(eq(userReports.id, reportId));
  }

  return updatedUser;
};

/**
 * Soft delete a post
 * @param {string} postId - Post ID to delete
 * @param {Object} deleteData - Deletion details
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Updated post
 */
const deletePost = async (postId, deleteData, adminId) => {
  const { reason, reportId } = deleteData;

  // Check if post exists and is not already deleted
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), isNull(posts.deletedAt)),
  });

  if (!post) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Post not found or already deleted');
  }

  // Soft delete the post
  const [updatedPost] = await db
    .update(posts)
    .set({
      deletedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning({
      id: posts.id,
      userId: posts.userId,
      caption: posts.caption,
      deletedAt: posts.deletedAt,
    });

  // Update related report if provided
  if (reportId) {
    await db
      .update(userReports)
      .set({
        status: 'resolved',
        actionTaken: `Post deleted: ${reason || 'Violated community guidelines'}`,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      })
      .where(eq(userReports.id, reportId));
  }

  return updatedPost;
};

/**
 * Get report statistics
 * @returns {Promise<Object>} Report statistics
 */
const getReportStatistics = async () => {
  const [stats] = await db
    .select({
      total: sql`count(*)`,
      pending: sql`count(*) filter (where status = 'pending')`,
      reviewed: sql`count(*) filter (where status = 'reviewed')`,
      resolved: sql`count(*) filter (where status = 'resolved')`,
      dismissed: sql`count(*) filter (where status = 'dismissed')`,
      userReports: sql`count(*) filter (where type = 'user')`,
      postReports: sql`count(*) filter (where type = 'post')`,
      groupReports: sql`count(*) filter (where type = 'group')`,
      eventReports: sql`count(*) filter (where type = 'event')`,
    })
    .from(userReports);

  return stats;
};

/**
 * Create a new category
 * @param {Object} categoryData - Category data
 * @returns {Promise<Object>} Created category
 */
const createCategory = async categoryData => {
  const { name, description, iconUrl, emoji } = categoryData;

  // Check if category with same name already exists
  const existingCategory = await db.query.categories.findFirst({
    where: eq(categories.name, name),
  });

  if (existingCategory) {
    throw new ApiError(httpStatus.CONFLICT, 'Category with this name already exists');
  }

  const [category] = await db
    .insert(categories)
    .values({
      name,
      description,
      iconUrl,
      emoji,
      createdAt: new Date(),
    })
    .returning();

  return category;
};

/**
 * Update a category
 * @param {string} categoryId - Category ID
 * @param {Object} updateData - Update data
 * @returns {Promise<Object>} Updated category
 */
const updateCategory = async (categoryId, updateData) => {
  // Check if category exists
  const existingCategory = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId),
  });

  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  // If updating name, check if new name conflicts with another category
  if (updateData.name && updateData.name !== existingCategory.name) {
    const nameConflict = await db.query.categories.findFirst({
      where: and(eq(categories.name, updateData.name), sql`${categories.id} != ${categoryId}`),
    });

    if (nameConflict) {
      throw new ApiError(httpStatus.CONFLICT, 'Category with this name already exists');
    }
  }

  const [category] = await db
    .update(categories)
    .set({
      ...updateData,
    })
    .where(eq(categories.id, categoryId))
    .returning();

  return category;
};

/**
 * Delete a category
 * @param {string} categoryId - Category ID
 * @returns {Promise<void>}
 */
const deleteCategory = async categoryId => {
  // Check if category exists
  const existingCategory = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId),
  });

  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  await db.delete(categories).where(eq(categories.id, categoryId));
};

/**
 * Get current platform fee percentage from system settings.
 * Returns the setting record with percentage value.
 */
const getPlatformFeePercentage = async () => {
  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.settingKey, PLATFORM_FEE_KEY),
  });

  const percentage = setting ? Number(setting.settingValue.percentage ?? 10) : 10;
  return { percentage, setting };
};

/**
 * Upsert the platform fee percentage in system settings.
 * @param {number} percentage - Fee percentage (0-100)
 * @param {string} adminId - Admin user performing the update
 */
const updatePlatformFeePercentage = async (percentage, adminId) => {
  if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Percentage must be a number between 0 and 100');
  }

  const existing = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.settingKey, PLATFORM_FEE_KEY),
  });

  let record;
  if (existing) {
    [record] = await db
      .update(systemSettings)
      .set({
        settingValue: { percentage },
        updatedAt: new Date(),
      })
      .where(eq(systemSettings.settingKey, PLATFORM_FEE_KEY))
      .returning();
  } else {
    [record] = await db
      .insert(systemSettings)
      .values({
        settingKey: PLATFORM_FEE_KEY,
        settingValue: { percentage },
        description: 'Platform cut-off fee percentage applied to all events',
        isPublic: true,
      })
      .returning();
  }

  return { percentage: Number(record.settingValue.percentage), updatedAt: record.updatedAt };
};
const listTalentForVerification = async ({ isVerified, page = 1, limit = 20 } = {}) => {
  limit = Math.min(Number(limit) || 20, 100);
  page = Math.max(Number(page) || 1, 1);
  const offset = (page - 1) * limit;

  const whereClause = and(
    isNull(talentProfiles.deletedAt),
    isVerified !== undefined ? eq(talentProfiles.isVerified, isVerified) : undefined
  );

  const [rows, [{ total }]] = await Promise.all([
    db.query.talentProfiles.findMany({
      where: whereClause,
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit,
      offset,
    }),
    db
      .select({ total: sql`count(*)::int` })
      .from(talentProfiles)
      .where(whereClause),
  ]);

  return {
    profiles: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
    },
  };
};

/**
 * Set isVerified on a talent profile and write an audit log entry.
 *
 * @param {string} talentProfileId
 * @param {boolean} isVerified
 * @param {string} adminId
 * @param {string|undefined} note  - optional admin note stored in audit log
 */
const setTalentVerification = async (talentProfileId, isVerified, adminId, note) => {
  // Confirm profile exists
  const existing = await db.query.talentProfiles.findFirst({
    where: and(eq(talentProfiles.id, talentProfileId), isNull(talentProfiles.deletedAt)),
    with: { user: { columns: { id: true, firstName: true, lastName: true, email: true } } },
  });
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Talent profile not found');

  // Update
  const [updated] = await db
    .update(talentProfiles)
    .set({ isVerified, updatedAt: new Date() })
    .where(eq(talentProfiles.id, talentProfileId))
    .returning();

  // Write audit log
  await writeAuditLog(
    adminId,
    isVerified ? 'talent_verified' : 'talent_unverified',
    'talent_profile',
    talentProfileId,
    {
      changes: {
        talentUserId: existing.user.id,
        talentName: `${existing.user.firstName} ${existing.user.lastName}`,
        talentEmail: existing.user.email,
        isVerified,
        note: note ?? null,
      },
    }
  );

  return updated;
};

// ─── PHASE 2: USER MANAGEMENT ─────────────────────────────────────────────────

const listUsers = async ({ page = 1, limit = 20, search, status, sortBy = 'createdAt' } = {}) => {
  limit = Math.min(Number(limit) || 20, 100);
  page = Math.max(Number(page) || 1, 1);
  const offset = (page - 1) * limit;

  const conditions = [];

  // Status filter
  if (status === 'active') {
    conditions.push(isNull(users.deletedAt), eq(users.isSuspended, false));
  } else if (status === 'suspended') {
    conditions.push(eq(users.isSuspended, true));
  } else if (status === 'deleted') {
    conditions.push(isNotNull(users.deletedAt));
  } else {
    // Default: exclude deleted
    conditions.push(isNull(users.deletedAt));
  }

  // Search filter
  if (search) {
    conditions.push(
      or(
        ilike(users.firstName, `%${search}%`),
        ilike(users.lastName, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.username, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Sort
  const orderMap = {
    createdAt: desc(users.createdAt),
    name: asc(users.firstName),
    email: asc(users.email),
  };
  const orderBy = orderMap[sortBy] || desc(users.createdAt);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        image: users.image,
        phoneNumber: users.phoneNumber,
        isSuspended: users.isSuspended,
        suspendedUntil: users.suspendedUntil,
        isEmailVerified: users.isEmailVerified,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql`count(*)::int` })
      .from(users)
      .where(whereClause),
  ]);

  return {
    users: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
    },
  };
};

const impersonateUser = async (targetUserId, adminId, reason) => {
  if (targetUserId === adminId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot impersonate yourself');
  }
 
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      deletedAt: true,
    },
  });
 
  if (!targetUser) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  if (targetUser.deletedAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot impersonate a deleted user');
  }
 
  const expires = dayjs().add(ACCESS_TOKEN_TTL_DAYS, 'd');
  const token = tokenService.generateToken(
    targetUserId,
    expires,
    TOKEN_TYPES.ACCESS,
    env.jwt.secret,
    { impersonatedBy: adminId }
  );
 
  await writeAuditLog(adminId, 'user_impersonation_started', 'user', targetUserId, {
    changes: {
      targetUsername: targetUser.username,
      targetEmail: targetUser.email,
      reason: reason ?? null,
    },
  });
 
  return {
    token,
    expiresAt: expires.toDate(),
    user: {
      id: targetUser.id,
      username: targetUser.username,
      email: targetUser.email,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
    },
  };
};
 

const endImpersonation = async (targetUserId, adminId) => {
  await writeAuditLog(adminId, 'user_impersonation_ended', 'user', targetUserId, {});
  return { ended: true };
};

const getAdminUserById = async userId => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      username: true,
      email: true,
      phoneNumber: true,
      firstName: true,
      lastName: true,
      name: true,
      dob: true,
      image: true,
      bio: true,
      isEmailVerified: true,
      emailVerified: true,
      preferences: true,
      lastLogin: true,
      lastSeen: true,
      showLastSeen: true,
      showOnlineStatus: true,
      loginCount: true,
      timezone: true,
      locale: true,
      allowSearchByEmail: true,
      allowSearchByPhone: true,
      allowTagging: true,
      allowMessagesFrom: true,
      isBritesidePlus: true,
      isSuspended: true,
      suspendedUntil: true,
      suspensionReason: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
    with: {
      roles: { with: { role: { columns: { name: true } } } },
      userInformation: true,
      socialProfile: {
        columns: {
          id: true,
          followersCount: true,
          followingCount: true,
          postsCount: true,
          isVerified: true,
        },
      },
      organizer: { columns: { id: true, businessName: true } },
    },
  });

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

  // Count reports against this user
  const [{ reportCount }] = await db
    .select({ reportCount: sql`count(*)::int` })
    .from(userReports)
    .where(eq(userReports.targetUserId, userId));

  return { ...user, reportCount };
};

const updateUserByAdmin = async (userId, updateData, adminId) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

  // Only allow specific fields
  const allowedFields = ['firstName', 'lastName', 'email', 'phoneNumber', 'bio', 'image'];
  const filtered = {};
  for (const key of allowedFields) {
    if (updateData[key] !== undefined) filtered[key] = updateData[key];
  }

  if (Object.keys(filtered).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No valid fields to update');
  }

  filtered.updatedAt = new Date();

  const [updated] = await db.update(users).set(filtered).where(eq(users.id, userId)).returning({
    id: users.id,
    username: users.username,
    email: users.email,
    firstName: users.firstName,
    lastName: users.lastName,
    phoneNumber: users.phoneNumber,
    bio: users.bio,
    image: users.image,
  });

  // Capture only changed fields for audit
  const previousValues = {};
  const newValues = {};
  for (const key of Object.keys(filtered)) {
    if (key === 'updatedAt') continue;
    if (user[key] !== filtered[key]) {
      previousValues[key] = user[key];
      newValues[key] = filtered[key];
    }
  }
  if (Object.keys(previousValues).length > 0) {
    await writeAuditLog(adminId, 'user_updated', 'user', userId, { previousValues, newValues });
  }

  return updated;
};

const deleteUserByAdmin = async (userId, adminId) => {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found or already deleted');

  const [deleted] = await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id, username: users.username, email: users.email });

  await writeAuditLog(adminId, 'user_deleted', 'user', userId, {
    previousValues: { username: user.username, email: user.email },
  });

  return deleted;
};

const assignRole = async (userId, roleName, adminId) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

  const role = await db.query.roles.findFirst({ where: eq(roles.name, roleName) });
  if (!role) throw new ApiError(httpStatus.NOT_FOUND, `Role "${roleName}" not found`);

  const existing = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)),
  });
  if (existing) throw new ApiError(httpStatus.CONFLICT, `User already has role "${roleName}"`);

  await db.insert(userRoles).values({ userId, roleId: role.id });
  await writeAuditLog(adminId, 'role_assigned', 'user', userId, { newValues: { role: roleName } });

  return { userId, role: roleName };
};

const removeRole = async (userId, roleName, adminId) => {
  const role = await db.query.roles.findFirst({ where: eq(roles.name, roleName) });
  if (!role) throw new ApiError(httpStatus.NOT_FOUND, `Role "${roleName}" not found`);

  const existing = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)),
  });
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, `User does not have role "${roleName}"`);

  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  await writeAuditLog(adminId, 'role_removed', 'user', userId, {
    previousValues: { role: roleName },
  });

  return { userId, role: roleName };
};

// ─── PHASE 3: EVENT MODERATION ────────────────────────────────────────────────

const listAllEvents = async ({
  page = 1,
  limit = 20,
  search,
  status,
  sortBy = 'createdAt',
} = {}) => {
  limit = Math.min(Number(limit) || 20, 100);
  page = Math.max(Number(page) || 1, 1);
  const offset = (page - 1) * limit;

  const conditions = [isNull(events.deletedAt)];

  if (status) conditions.push(eq(events.eventStatus, status));
  if (search) conditions.push(ilike(events.title, `%${search}%`));

  const whereClause = and(...conditions);

  const orderMap = {
    createdAt: desc(events.createdAt),
    startDate: asc(events.startDate),
    title: asc(events.title),
  };

  const [rows, [{ total }]] = await Promise.all([
    db.query.events.findMany({
      where: whereClause,
      orderBy: orderMap[sortBy] || desc(events.createdAt),
      limit,
      offset,
      columns: {
        id: true,
        title: true,
        slug: true,
        eventStatus: true,
        eventType: true,
        eventMode: true,
        startDate: true,
        endDate: true,
        capacity: true,
        totalRevenue: true,
        likeCount: true,
        isFree: true,
        coverImages: true,
        createdAt: true,
      },
      with: {
        organizer: {
          columns: {
            id: true,
            businessName: true,
            logoUrl: true,
            isVerified: true,
            rating: true,
            totalEvents: true,
          },
          with: {
            user: {
              columns: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                image: true,
                username: true,
              },
            },
          },
        },
      },
    }),
    db
      .select({ total: sql`count(*)::int` })
      .from(events)
      .where(whereClause),
  ]);

  return {
    events: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
    },
  };
};

const getAdminEventById = async eventId => {
  const event = await db.query.events.findFirst({
    where: and(eq(events.id, eventId)),
    with: {
      organizer: {
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              image: true,
              username: true,
            },
          },
        },
      },
      venue: true,
      schedules: true,
    },
  });

  if (!event) throw new ApiError(httpStatus.NOT_FOUND, 'Event not found');
   return EventService.getEventById(eventId);
};

const cancelEvent = async (eventId, reason, adminId) => {
  const event = await db.query.events.findFirst({
    where: and(eq(events.id, eventId), isNull(events.deletedAt)),
  });
  if (!event) throw new ApiError(httpStatus.NOT_FOUND, 'Event not found');
  if (event.eventStatus === 'cancelled')
    throw new ApiError(httpStatus.BAD_REQUEST, 'Event is already cancelled');

  const [updated] = await db
    .update(events)
    .set({ eventStatus: 'cancelled', updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning({ id: events.id, title: events.title, eventStatus: events.eventStatus });

  await writeAuditLog(adminId, 'event_cancelled', 'event', eventId, {
    previousValues: { eventStatus: event.eventStatus },
    newValues: { eventStatus: 'cancelled' },
    changes: { reason },
  });

  return updated;
};

  const updateEventByAdmin = async (eventId, updateData, adminId) => {
  const updatedEvent = await EventService.updateEvent(eventId, updateData, { isAdmin: true });

  await writeAuditLog(adminId, 'event_updated_by_admin', 'event', eventId, {
    newValues: updateData,
  });

  return updatedEvent;
};

const deleteEvent = async (eventId, reason, adminId) => {
  const event = await db.query.events.findFirst({
    where: and(eq(events.id, eventId), isNull(events.deletedAt)),
  });
  if (!event) throw new ApiError(httpStatus.NOT_FOUND, 'Event not found or already deleted');

  const [deleted] = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning({ id: events.id, title: events.title });

  await writeAuditLog(adminId, 'event_deleted', 'event', eventId, {
    previousValues: { title: event.title },
    changes: { reason },
  });

  return deleted;
};

// ─── PHASE 4: GROUP MODERATION ────────────────────────────────────────────────

const listAllGroups = async ({ page = 1, limit = 20, search, sortBy = 'createdAt' } = {}) => {
  limit = Math.min(Number(limit) || 20, 100);
  page = Math.max(Number(page) || 1, 1);
  const offset = (page - 1) * limit;

  const conditions = [isNull(groups.deletedAt)];
  if (search) conditions.push(ilike(groups.name, `%${search}%`));

  const whereClause = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: groups.id,
        name: groups.name,
        slug: groups.slug,
        isPublic: groups.isPublic,
        memberCount: groups.memberCount,
        city: groups.city,
        country: groups.country,
        isPaid: groups.isPaid,
        createdAt: groups.createdAt,
        creatorName: sql`concat(${users.firstName}, ' ', ${users.lastName})`,
      })
      .from(groups)
      .leftJoin(users, eq(groups.createdBy, users.id))
      .where(whereClause)
      .orderBy(sortBy === 'name' ? asc(groups.name) : desc(groups.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql`count(*)::int` })
      .from(groups)
      .where(whereClause),
  ]);

  return {
    groups: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
    },
  };
};

const getAdminGroupById = async groupId => {
  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), isNull(groups.deletedAt)),
    with: {
      createdBy: {
        columns: { id: true, firstName: true, lastName: true, username: true, image: true },
      },
      category: true,
      members: {
        limit: 10,
        orderBy: (m, { desc }) => [desc(m.joinedAt)],
        with: {
          user: {
            columns: { id: true, firstName: true, lastName: true, username: true, image: true },
          },
        },
      },
    },
  });

  if (!group) throw new ApiError(httpStatus.NOT_FOUND, 'Group not found');
  return group;
};

const deleteGroup = async (groupId, reason, adminId) => {
  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), isNull(groups.deletedAt)),
  });
  if (!group) throw new ApiError(httpStatus.NOT_FOUND, 'Group not found or already deleted');

  const [deleted] = await db
    .update(groups)
    .set({ deletedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning({ id: groups.id, name: groups.name });

  await writeAuditLog(adminId, 'group_deleted', 'group', groupId, {
    previousValues: { name: group.name },
    changes: { reason },
  });

  return deleted;
};

const removeGroupMember = async (groupId, userId, reason, adminId) => {
  const member = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
  });
  if (!member) throw new ApiError(httpStatus.NOT_FOUND, 'Member not found in this group');

  await db.delete(groupMembers).where(eq(groupMembers.id, member.id));

  // Decrement member count
  await db
    .update(groups)
    .set({ memberCount: sql`greatest(${groups.memberCount} - 1, 0)` })
    .where(eq(groups.id, groupId));

  await writeAuditLog(adminId, 'group_member_removed', 'group', groupId, {
    changes: { removedUserId: userId, reason },
  });

  return { groupId, userId };
};

const updateGroupByAdmin = async (groupId, updateData, adminId) => {
  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), isNull(groups.deletedAt)),
  });
  if (!group) throw new ApiError(httpStatus.NOT_FOUND, 'Group not found');

  const allowedFields = [
    'name',
    'description',
    'isPublic',
    'requiresApproval',
    'isPaid',
    'subscriptionPrice',
    'maxMembers',
    'categoryId',
    'coverImageUrl',
    'city',
    'state',
    'country',
  ];
  const filtered = {};
  for (const key of allowedFields) {
    if (updateData[key] !== undefined) filtered[key] = updateData[key];
  }

  if (Object.keys(filtered).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No valid fields to update');
  }

  filtered.updatedAt = new Date();

  const [updated] = await db
    .update(groups)
    .set(filtered)
    .where(eq(groups.id, groupId))
    .returning({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      isPublic: groups.isPublic,
      requiresApproval: groups.requiresApproval,
      isPaid: groups.isPaid,
      subscriptionPrice: groups.subscriptionPrice,
      maxMembers: groups.maxMembers,
      categoryId: groups.categoryId,
      coverImageUrl: groups.coverImageUrl,
      city: groups.city,
      state: groups.state,
      country: groups.country,
      updatedAt: groups.updatedAt,
    });

  // Capture only changed fields for audit
  const previousValues = {};
  const newValues = {};
  for (const key of Object.keys(filtered)) {
    if (key === 'updatedAt') continue;
    if (group[key] !== filtered[key]) {
      previousValues[key] = group[key];
      newValues[key] = filtered[key];
    }
  }
  if (Object.keys(previousValues).length > 0) {
    await writeAuditLog(adminId, 'group_updated', 'group', groupId, {
      previousValues,
      newValues,
    });
  }

  return updated;
};

// ─── PHASE 5: SOCIAL MODERATION ──────────────────────────────────────────────

const listAllPosts = async ({ page = 1, limit = 20, userId, sortBy = 'createdAt' } = {}) => {
  limit = Math.min(Number(limit) || 20, 100);
  page = Math.max(Number(page) || 1, 1);
  const offset = (page - 1) * limit;

  const conditions = [isNull(posts.deletedAt)];
  if (userId) conditions.push(eq(posts.userId, userId));

  const whereClause = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: posts.id,
        caption: posts.caption,
        mediaUrls: posts.mediaUrls,
        likesCount: posts.likesCount,
        commentsCount: posts.commentsCount,
        visibility: posts.visibility,
        createdAt: posts.createdAt,
        authorName: sql`concat(${users.firstName}, ' ', ${users.lastName})`,
        authorUsername: users.username,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .where(whereClause)
      .orderBy(sortBy === 'likes' ? desc(posts.likesCount) : desc(posts.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql`count(*)::int` })
      .from(posts)
      .where(whereClause),
  ]);

  return {
    posts: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
    },
  };
};

const deleteComment = async (commentId, reason, adminId) => {
  const comment = await db.query.postComments.findFirst({ where: eq(postComments.id, commentId) });
  if (!comment) throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');

  await db.delete(postComments).where(eq(postComments.id, commentId));

  // Decrement comment count on the post
  await db
    .update(posts)
    .set({ commentsCount: sql`greatest(${posts.commentsCount} - 1, 0)` })
    .where(eq(posts.id, comment.postId));

  await writeAuditLog(adminId, 'comment_deleted', 'comment', commentId, {
    previousValues: { content: comment.content, postId: comment.postId, userId: comment.userId },
    changes: { reason },
  });

  return { commentId, postId: comment.postId };
};

// ─── PHASE 6: REPORTS ENHANCED ───────────────────────────────────────────────

const getReportById = async reportId => {
  const report = await db.query.userReports.findFirst({
    where: eq(userReports.id, reportId),
    with: {
      reporter: {
        columns: { id: true, username: true, firstName: true, lastName: true, image: true },
      },
      targetUser: {
        columns: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          image: true,
          isSuspended: true,
        },
      },
      reviewedBy: { columns: { id: true, username: true, firstName: true, lastName: true } },
      post: { columns: { id: true, caption: true, mediaUrls: true, mediaTypes: true } },
      group: { columns: { id: true, name: true, slug: true } },
      event: { columns: { id: true, title: true, slug: true } },
      discussion: { columns: { id: true, title: true, groupId: true } },
      talentSession: {
        columns: {
          id: true,
          moderationStatus: true,
          moderationEventsLog: true,
          scheduledAt: true,
          durationMins: true,
          status: true,
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
      },
    },
  });

  if (!report) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');

  // Resolve the reported content based on type
  let reportedContent = null;
  if (report.type === 'post' && report.postId) {
    reportedContent = await db.query.posts.findFirst({
      where: eq(posts.id, report.postId),
      columns: { id: true, caption: true, mediaUrls: true, deletedAt: true, createdAt: true },
    });
  } else if (report.type === 'event' && report.eventId) {
    reportedContent = await db.query.events.findFirst({
      where: eq(events.id, report.eventId),
      columns: { id: true, title: true, slug: true, eventStatus: true, deletedAt: true },
    });
  } else if (report.type === 'group' && report.groupId) {
    reportedContent = await db.query.groups.findFirst({
      where: eq(groups.id, report.groupId),
      columns: { id: true, name: true, slug: true, deletedAt: true },
    });
  }

  // Support shouldn't have to cross-reference GET /api/admin/moderation/calls
  // separately — surface the session's archived frames right here, split by
  // reason so the report page's gallery can label them distinctly. No signed
  // URLs generated eagerly (same on-demand-per-frame endpoint as the
  // moderation queue covers this page too).
  let flaggedFrames = [];
  let reportScreenshots = [];
  if (report.type === 'talent_session' && report.talentSessionId) {
    const frames = await db
      .select({
        id: talentSessionFrames.id,
        reason: talentSessionFrames.reason,
        moderationAction: talentSessionFrames.moderationAction,
        trackType: talentSessionFrames.trackType,
        capturedAt: talentSessionFrames.capturedAt,
      })
      .from(talentSessionFrames)
      .where(eq(talentSessionFrames.sessionId, report.talentSessionId));

    flaggedFrames = frames.filter(f => f.reason === 'moderation_flag');
    reportScreenshots = frames.filter(f => f.reason === 'report_sample');
  }

  // `comment` covers both a post comment and a discussion reply — the specific
  // id lives in metadata (no dedicated FK column, see report.controller.js
  // createReport). `report.post`/`report.discussion` above already give the
  // PARENT context; this resolves the actual comment/reply text on top of it.
  let comment = null;
  let discussionReply = null;
  const commentId = report.metadata?.commentId;
  const discussionReplyId = report.metadata?.discussionReplyId;
  if (report.type === 'comment' && commentId) {
    comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, commentId),
      columns: { id: true, content: true, postId: true, createdAt: true },
    });
  } else if (report.type === 'comment' && discussionReplyId) {
    discussionReply = await db.query.discussionReplies.findFirst({
      where: eq(discussionReplies.id, discussionReplyId),
      columns: { id: true, content: true, discussionId: true, createdAt: true },
    });
  }

  return { ...report, reportedContent, comment, discussionReply, flaggedFrames, reportScreenshots };
};

const resolveReportedEntity = async (reportId, action, reason, adminId) => {
  const report = await db.query.userReports.findFirst({
    where: eq(userReports.id, reportId),
  });
  if (!report) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
  if (report.status === 'resolved')
    throw new ApiError(httpStatus.BAD_REQUEST, 'Report is already resolved');

  const actionLabel = reason || 'Violated community guidelines';
  let removedEntity = null;

  switch (report.type) {
    case 'post': {
      if (!report.postId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated post');
      const [updated] = await db
        .update(posts)
        .set({ deletedAt: new Date() })
        .where(and(eq(posts.id, report.postId), isNull(posts.deletedAt)))
        .returning({ id: posts.id });
      if (!updated) throw new ApiError(httpStatus.NOT_FOUND, 'Post not found or already deleted');
      removedEntity = { type: 'post', id: updated.id };
      await writeAuditLog(adminId, 'DELETE_POST_VIA_REPORT', 'post', updated.id, {
        changes: { reportId, reason },
      });
      break;
    }
    case 'comment': {
      // The specific comment/reply id lives in metadata (no dedicated FK
      // column — see report.controller.js createReport); report.postId /
      // report.discussionId are the PARENT post/discussion, not the comment.
      const commentId = report.metadata?.commentId;
      const discussionReplyId = report.metadata?.discussionReplyId;
      if (!commentId && !discussionReplyId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated comment');

      if (commentId) {
        const [deleted] = await db
          .delete(postComments)
          .where(eq(postComments.id, commentId))
          .returning({ id: postComments.id });
        if (!deleted)
          throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found or already deleted');
        removedEntity = { type: 'comment', id: deleted.id };
        await writeAuditLog(adminId, 'DELETE_COMMENT_VIA_REPORT', 'comment', deleted.id, {
          changes: { reportId, reason },
        });
      } else {
        const [deleted] = await db
          .delete(discussionReplies)
          .where(eq(discussionReplies.id, discussionReplyId))
          .returning({ id: discussionReplies.id });
        if (!deleted)
          throw new ApiError(httpStatus.NOT_FOUND, 'Discussion reply not found or already deleted');
        removedEntity = { type: 'discussion_reply', id: deleted.id };
        await writeAuditLog(
          adminId,
          'DELETE_DISCUSSION_REPLY_VIA_REPORT',
          'discussion_reply',
          deleted.id,
          {
            changes: { reportId, reason },
          }
        );
      }
      break;
    }
    case 'event': {
      if (!report.eventId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated event');
      if (action === 'delete') {
        const [updated] = await db
          .update(events)
          .set({ deletedAt: new Date() })
          .where(and(eq(events.id, report.eventId), isNull(events.deletedAt)))
          .returning({ id: events.id });
        if (!updated)
          throw new ApiError(httpStatus.NOT_FOUND, 'Event not found or already deleted');
        removedEntity = { type: 'event', id: updated.id, action: 'deleted' };
        await writeAuditLog(adminId, 'DELETE_EVENT_VIA_REPORT', 'event', updated.id, {
          changes: { reportId, reason },
        });
      } else {
        const [updated] = await db
          .update(events)
          .set({ eventStatus: 'cancelled' })
          .where(and(eq(events.id, report.eventId), isNull(events.deletedAt)))
          .returning({ id: events.id });
        if (!updated)
          throw new ApiError(httpStatus.NOT_FOUND, 'Event not found or already deleted');
        removedEntity = { type: 'event', id: updated.id, action: 'cancelled' };
        await writeAuditLog(adminId, 'CANCEL_EVENT_VIA_REPORT', 'event', updated.id, {
          changes: { reportId, reason },
        });
      }
      break;
    }
    case 'group': {
      if (!report.groupId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated group');
      const [updated] = await db
        .update(groups)
        .set({ deletedAt: new Date() })
        .where(and(eq(groups.id, report.groupId), isNull(groups.deletedAt)))
        .returning({ id: groups.id });
      if (!updated) throw new ApiError(httpStatus.NOT_FOUND, 'Group not found or already deleted');
      removedEntity = { type: 'group', id: updated.id };
      await writeAuditLog(adminId, 'DELETE_GROUP_VIA_REPORT', 'group', updated.id, {
        changes: { reportId, reason },
      });
      break;
    }
    case 'user': {
      if (!report.targetUserId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated user');
      const [updated] = await db
        .update(users)
        .set({ isSuspended: true })
        .where(eq(users.id, report.targetUserId))
        .returning({ id: users.id });
      if (!updated) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
      removedEntity = { type: 'user', id: updated.id, action: 'suspended' };
      await writeAuditLog(adminId, 'SUSPEND_USER_VIA_REPORT', 'user', updated.id, {
        changes: { reportId, reason },
      });
      break;
    }
    case 'discussion': {
      if (!report.discussionId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Report has no associated discussion');
      const [updated] = await db
        .update(discussions)
        .set({ deletedAt: new Date() })
        .where(and(eq(discussions.id, report.discussionId), isNull(discussions.deletedAt)))
        .returning({ id: discussions.id });
      if (!updated)
        throw new ApiError(httpStatus.NOT_FOUND, 'Discussion not found or already deleted');
      removedEntity = { type: 'discussion', id: updated.id };
      await writeAuditLog(adminId, 'DELETE_DISCUSSION_VIA_REPORT', 'discussion', updated.id, {
        changes: { reportId, reason },
      });
      break;
    }
    default:
      throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported report type: ${report.type}`);
  }

  // Mark the report as resolved
  await db
    .update(userReports)
    .set({
      status: 'resolved',
      actionTaken: `${removedEntity.type} ${removedEntity.action || 'removed'}: ${actionLabel}`,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .where(eq(userReports.id, reportId));

  return { report: { id: reportId, status: 'resolved' }, removedEntity };
};

const bulkUpdateReportStatus = async (reportIds, status, actionTaken, adminId) => {
  if (!reportIds?.length) throw new ApiError(httpStatus.BAD_REQUEST, 'reportIds array is required');

  const updated = await db
    .update(userReports)
    .set({ status, actionTaken, reviewedBy: adminId, reviewedAt: new Date() })
    .where(inArray(userReports.id, reportIds))
    .returning({ id: userReports.id, status: userReports.status });

  return { updatedCount: updated.length, reports: updated };
};

// ─── PHASE 7: DASHBOARD ─────────────────────────────────────────────────────

const getDashboardStats = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    [userStats],
    [eventStats],
    [groupStats],
    [postStats],
    [reportStats],
    [revenueStats],
    userGrowth,
  ] = await Promise.all([
    // Users
    db
      .select({
        total: sql`count(*)::int`,
        newLast30Days: sql`count(*) filter (where ${users.createdAt} >= ${thirtyDaysAgo})::int`,
        suspended: sql`count(*) filter (where ${users.isSuspended} = true)::int`,
      })
      .from(users)
      .where(isNull(users.deletedAt)),

    // Events
    db
      .select({
        total: sql`count(*)::int`,
        published: sql`count(*) filter (where ${events.eventStatus} = 'published')::int`,
        draft: sql`count(*) filter (where ${events.eventStatus} = 'draft')::int`,
        cancelled: sql`count(*) filter (where ${events.eventStatus} = 'cancelled')::int`,
      })
      .from(events)
      .where(isNull(events.deletedAt)),

    // Groups
    db
      .select({
        total: sql`count(*)::int`,
      })
      .from(groups)
      .where(isNull(groups.deletedAt)),

    // Posts
    db
      .select({
        total: sql`count(*)::int`,
      })
      .from(posts)
      .where(isNull(posts.deletedAt)),

    // Pending reports
    db
      .select({
        total: sql`count(*)::int`,
        pending: sql`count(*) filter (where ${userReports.status} = 'pending')::int`,
      })
      .from(userReports),

    // Revenue (completed orders)
    db
      .select({
        total: sql`coalesce(sum(${orders.totalAmount}), 0)::numeric`,
      })
      .from(orders)
      .where(eq(orders.status, 'completed')),

    // User growth — last 12 months
    db
      .select({
        month: sql`to_char(${users.createdAt}, 'YYYY-MM')`.as('month'),
        count: sql`count(*)::int`,
      })
      .from(users)
      .where(and(isNull(users.deletedAt), gte(users.createdAt, sql`now() - interval '12 months'`)))
      .groupBy(sql`to_char(${users.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${users.createdAt}, 'YYYY-MM')`),
  ]);

  return {
    users: userStats,
    events: eventStats,
    groups: groupStats,
    posts: postStats,
    reports: reportStats,
    revenue: { total: Number(revenueStats.total) },
    userGrowth,
  };
};

export const getActivityLogs = async ({
  page = 1,
  limit = 20,
  action,
  resourceType,
  adminId,
  dateFrom,
  dateTo,
} = {}) => {
  const conditions = [];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
  if (adminId) conditions.push(eq(auditLogs.userId, adminId));
  if (dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLogs.createdAt, new Date(dateTo)));

  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.query.auditLogs.findMany({
      where,
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: desc(auditLogs.createdAt),
      limit,
      offset,
    }),
    db
      .select({ total: sql`count(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);

  return {
    logs: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

export const getOverviewStats = async ({ dateFrom, dateTo } = {}) => {
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  const hasRange = start || end;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const userRangeFilter = hasRange
    ? and(
        isNull(users.deletedAt),
        start ? gte(users.createdAt, start) : undefined,
        end ? lte(users.createdAt, end) : undefined
      )
    : isNull(users.deletedAt);

  const eventRangeFilter = hasRange
    ? and(
        isNull(events.deletedAt),
        eq(events.eventStatus, 'published'),
        start ? gte(events.createdAt, start) : undefined,
        end ? lte(events.createdAt, end) : undefined
      )
    : and(isNull(events.deletedAt), eq(events.eventStatus, 'published'));

  const reportRangeFilter = hasRange
    ? and(
        eq(userReports.status, 'pending'),
        start ? gte(userReports.createdAt, start) : undefined,
        end ? lte(userReports.createdAt, end) : undefined
      )
    : eq(userReports.status, 'pending');

  const [
    [totalUsers],
    [usersLastWeek],
    [plusNow],
    [plusLastWeek],
    [activeEvents],
    [eventsLastWeek],
    [pendingNow],
    [pendingLastWeek],
  ] = await Promise.all([
    db
      .select({ v: sql`count(*)::int` })
      .from(users)
      .where(userRangeFilter),
    hasRange
      ? db
          .select({ v: sql`count(*)::int` })
          .from(users)
          .where(userRangeFilter)
      : db
          .select({ v: sql`count(*)::int` })
          .from(users)
          .where(and(isNull(users.deletedAt), lte(users.createdAt, weekAgo))),
    db
      .select({ v: sql`count(*)::int` })
      .from(users)
      .where(and(userRangeFilter, eq(users.isBritesidePlus, true))),
    hasRange
      ? db
          .select({ v: sql`count(*)::int` })
          .from(users)
          .where(and(userRangeFilter, eq(users.isBritesidePlus, true)))
      : db
          .select({ v: sql`count(*)::int` })
          .from(users)
          .where(
            and(
              isNull(users.deletedAt),
              eq(users.isBritesidePlus, true),
              lte(users.createdAt, weekAgo)
            )
          ),
    db
      .select({ v: sql`count(*)::int` })
      .from(events)
      .where(eventRangeFilter),
    hasRange
      ? db
          .select({ v: sql`count(*)::int` })
          .from(events)
          .where(eventRangeFilter)
      : db
          .select({ v: sql`count(*)::int` })
          .from(events)
          .where(
            and(
              isNull(events.deletedAt),
              eq(events.eventStatus, 'published'),
              lte(events.createdAt, weekAgo)
            )
          ),
    db
      .select({ v: sql`count(*)::int` })
      .from(userReports)
      .where(reportRangeFilter),
    hasRange
      ? db
          .select({ v: sql`count(*)::int` })
          .from(userReports)
          .where(reportRangeFilter)
      : db
          .select({ v: sql`count(*)::int` })
          .from(userReports)
          .where(and(eq(userReports.status, 'pending'), lte(userReports.createdAt, weekAgo))),
  ]);

  const pct = (cur, prev) => (prev === 0 ? null : Number((((cur - prev) / prev) * 100).toFixed(1)));

  return {
    totalUsers: {
      value: totalUsers.v,
      weekChange: hasRange ? null : pct(totalUsers.v, usersLastWeek.v),
    },
    plusMembers: { value: plusNow.v, weekChange: hasRange ? null : pct(plusNow.v, plusLastWeek.v) },
    activeEvents: {
      value: activeEvents.v,
      weekChange: hasRange ? null : pct(activeEvents.v, eventsLastWeek.v),
    },
    pendingReports: {
      value: pendingNow.v,
      weekChange: hasRange ? null : pct(pendingNow.v, pendingLastWeek.v),
    },
  };
};

export const getUserMetrics = async ({ dateFrom, dateTo } = {}) => {
  const now = new Date();
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  const hasRange = start || end;

  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const startOfMonth = hasRange ? start : new Date(now.getFullYear(), now.getMonth(), 1);
  const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endLastMonth = hasRange ? end : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const signupFilter = and(
    isNull(users.deletedAt),
    startOfMonth ? gte(users.createdAt, startOfMonth) : undefined,
    endLastMonth ? lte(users.createdAt, endLastMonth) : undefined
  );

  const [[totalRow], [mauRow], [dauRow], [signupsRow], [signupsLastMonthRow], activeCountriesRows] =
    await Promise.all([
      db
        .select({ v: sql`count(*)::int` })
        .from(users)
        .where(isNull(users.deletedAt)),
      db
        .select({ v: sql`count(*)::int` })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            gte(users.lastLogin, hasRange ? (start ?? thirtyDaysAgo) : thirtyDaysAgo),
            end ? lte(users.lastLogin, end) : undefined
          )
        ),
      db
        .select({ v: sql`count(*)::int` })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            gte(users.lastLogin, hasRange ? (start ?? oneDayAgo) : oneDayAgo),
            end ? lte(users.lastLogin, end) : undefined
          )
        ),
      db
        .select({ v: sql`count(*)::int` })
        .from(users)
        .where(signupFilter),
      hasRange
        ? db
            .select({ v: sql`count(*)::int` })
            .from(users)
            .where(signupFilter)
        : db
            .select({ v: sql`count(*)::int` })
            .from(users)
            .where(
              and(
                isNull(users.deletedAt),
                gte(users.createdAt, startLastMonth),
                lte(users.createdAt, endLastMonth)
              )
            ),
      db
        .selectDistinct({ country: userInformation.country })
        .from(userInformation)
        .innerJoin(users, eq(userInformation.userId, users.id))
        .where(
          and(
            isNull(users.deletedAt),
            gte(users.lastLogin, hasRange ? (start ?? thirtyDaysAgo) : thirtyDaysAgo),
            end ? lte(users.lastLogin, end) : undefined,
            isNotNull(userInformation.country)
          )
        ),
    ]);

  const mau = mauRow.v;
  const dau = dauRow.v;
  const signupsMoM = hasRange
    ? null
    : signupsLastMonthRow.v === 0
      ? null
      : Number((((signupsRow.v - signupsLastMonthRow.v) / signupsLastMonthRow.v) * 100).toFixed(1));

  return {
    totalUsers: totalRow.v,
    mau,
    dau,
    newSignupsThisMonth: signupsRow.v,
    signupsMoMChange: signupsMoM,
    activeCountries: activeCountriesRows.length,
    dauMauRatio: mau > 0 ? Number(((dau / mau) * 100).toFixed(1)) : 0,
  };
};

export const getMauTrend = async ({ dateFrom, dateTo } = {}) => {
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  return db
    .select({
      month: sql`to_char(date_trunc('month', ${users.lastLogin}), 'Mon ''YY')`.as('month'),
      mau: sql`count(*)::int`.as('mau'),
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        isNotNull(users.lastLogin),
        start
          ? gte(users.lastLogin, start)
          : gte(users.lastLogin, sql`now() - interval '12 months'`),
        end ? lte(users.lastLogin, end) : undefined
      )
    )
    .groupBy(sql`date_trunc('month', ${users.lastLogin})`)
    .orderBy(sql`date_trunc('month', ${users.lastLogin})`);
};

export const getSignupsTrend = async ({ dateFrom, dateTo } = {}) => {
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  return db
    .select({
      month: sql`to_char(date_trunc('month', ${users.createdAt}), 'Mon ''YY')`.as('month'),
      signups: sql`count(*)::int`.as('signups'),
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        start
          ? gte(users.createdAt, start)
          : gte(users.createdAt, sql`now() - interval '12 months'`),
        end ? lte(users.createdAt, end) : undefined
      )
    )
    .groupBy(sql`date_trunc('month', ${users.createdAt})`)
    .orderBy(sql`date_trunc('month', ${users.createdAt})`);
};

export const getInterestsAnalytics = async ({ dateFrom, dateTo } = {}) => {
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  const dateFilter = and(
    start ? gte(userInterests.createdAt, start) : undefined,
    end ? lte(userInterests.createdAt, end) : undefined
  );

  const intensityTier = sql`
    CASE
      WHEN ${userInterests.intensity} >= 75 THEN 'high'
      WHEN ${userInterests.intensity} >= 40 THEN 'medium'
      ELSE 'low'
    END
  `;

  const [topInterests, intensityRows, totalRow] = await Promise.all([
    db
      .select({
        categoryId: interestCategories.id,
        name: interestCategories.name,
        slug: interestCategories.slug,
        userCount: count(userInterests.userId),
        avgIntensity: sql`ROUND(AVG(${userInterests.intensity}))::int`.as('avg_intensity'),
      })
      .from(userInterests)
      .innerJoin(interestCategories, eq(userInterests.categoryId, interestCategories.id))
      .where(dateFilter)
      .groupBy(interestCategories.id, interestCategories.name, interestCategories.slug)
      .orderBy(desc(count(userInterests.userId))),

    db
      .select({
        tier: intensityTier.as('tier'),
        count: sql`count(*)::int`.as('count'),
      })
      .from(userInterests)
      .where(dateFilter)
      .groupBy(intensityTier),

    db
      .select({ count: sql`count(distinct ${userInterests.userId})::int`.as('count') })
      .from(userInterests)
      .where(dateFilter),
  ]);

  return {
    topInterests,
    intensityBreakdown: Object.fromEntries(intensityRows.map(r => [r.tier, r.count])),
    totalUsersWithInterests: totalRow[0]?.count ?? 0,
  };
};

export const getDemographicsStats = async ({ dateFrom, dateTo } = {}) => {
  const start = dateFrom ? new Date(dateFrom) : null;
  const end = dateTo ? new Date(dateTo) : null;
  const userDateFilter = and(
    isNull(users.deletedAt),
    start ? gte(users.createdAt, start) : undefined,
    end ? lte(users.createdAt, end) : undefined
  );

  const [ageBuckets, genderRows, topCities, countriesRows] = await Promise.all([
    (() => {
      const ageBucket = sql`
        CASE
          WHEN date_part('year', age(${users.dob})) BETWEEN 13 AND 17 THEN '13-17'
          WHEN date_part('year', age(${users.dob})) BETWEEN 18 AND 24 THEN '18-24'
          WHEN date_part('year', age(${users.dob})) BETWEEN 25 AND 34 THEN '25-34'
          WHEN date_part('year', age(${users.dob})) BETWEEN 35 AND 44 THEN '35-44'
          WHEN date_part('year', age(${users.dob})) BETWEEN 45 AND 54 THEN '45-54'
          WHEN date_part('year', age(${users.dob})) BETWEEN 55 AND 64 THEN '55-64'
          WHEN date_part('year', age(${users.dob})) >= 65            THEN '65+'
        END
      `;
      return db
        .select({
          bucket: ageBucket.as('bucket'),
          count: sql`count(*)::int`.as('count'),
        })
        .from(userInformation)
        .innerJoin(users, eq(userInformation.userId, users.id))
        .where(and(userDateFilter, isNotNull(users.dob)))
        .groupBy(ageBucket)
        .having(sql`${ageBucket} IS NOT NULL`)
        .orderBy(sql`MIN(date_part('year', age(${users.dob})))`);
    })(),

    db
      .select({
        gender: socialProfiles.gender,
        count: sql`count(*)::int`.as('count'),
      })
      .from(socialProfiles)
      .innerJoin(users, eq(socialProfiles.userId, users.id))
      .where(and(userDateFilter, isNotNull(socialProfiles.gender)))
      .groupBy(socialProfiles.gender),

    db
      .select({
        city: userInformation.city,
        count: sql`count(*)::int`.as('count'),
      })
      .from(userInformation)
      .innerJoin(users, eq(userInformation.userId, users.id))
      .where(and(userDateFilter, isNotNull(userInformation.city)))
      .groupBy(userInformation.city)
      .orderBy(sql`count(*) DESC`)
      .limit(10),

    db
      .select({
        country: userInformation.country,
        count: sql`count(*)::int`.as('count'),
      })
      .from(userInformation)
      .innerJoin(users, eq(userInformation.userId, users.id))
      .where(and(userDateFilter, isNotNull(userInformation.country)))
      .groupBy(userInformation.country)
      .orderBy(sql`count(*) DESC`),
  ]);

  const totalWithCountry = countriesRows.reduce((s, r) => s + r.count, 0);
  const countries = countriesRows.map(r => ({
    country: r.country,
    count: r.count,
    percent: totalWithCountry > 0 ? Number(((r.count / totalWithCountry) * 100).toFixed(1)) : 0,
  }));

  return { ageBuckets, gender: genderRows, topCities, countries };
};

export const adminService = {
  // Existing
  updateReportStatus,
  toggleUserSuspension,
  deletePost,
  getReportStatistics,
  createCategory,
  updateCategory,
  deleteCategory,
  getPlatformFeePercentage,
  updatePlatformFeePercentage,
  listTalentForVerification,
  setTalentVerification,
  // Phase 2: User management
  listUsers,
  getAdminUserById,
  updateUserByAdmin,
  deleteUserByAdmin,
  assignRole,
  removeRole,
  // Phase 3: Event moderation
  listAllEvents,
  getAdminEventById,
  cancelEvent,
  deleteEvent,
  // Phase 4: Group moderation
  listAllGroups,
  getAdminGroupById,
  updateGroupByAdmin,  
  deleteGroup,
  removeGroupMember,
  // Phase 5: Social moderation
  listAllPosts,
  deleteComment,
  // Phase 6: Reports
  getReportById,
  resolveReportedEntity,
  bulkUpdateReportStatus,
  // Phase 7: Dashboard
  getDashboardStats,
  // Phase 8: Activity logs + analytics
  getActivityLogs,
  getOverviewStats,
  getUserMetrics,
  getMauTrend,
  getSignupsTrend,
  getDemographicsStats,
  getInterestsAnalytics,
  impersonateUser,
  endImpersonation,
  updateEventByAdmin ,
};
