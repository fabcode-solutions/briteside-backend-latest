import { db } from '../db/index.js';
import { usernameReservations } from '../db/schema/usernameReservations.js';
import { users } from '../db/schema/users.js';
import { eq, and, or, desc, asc, ilike, sql, ne } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';

/**
 * Check if a username is available for reservation
 * Checks both existing users and pending/approved reservations
 * @param {string} username - The username to check
 * @param {object} [options]
 * @param {string} [options.excludeUserId] - Skip the "taken" hit when the matching user is this one
 *   (used when a user is checking/keeping their own current username during a profile edit)
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export const checkUsernameAvailability = async (username, { excludeUserId } = {}) => {
  const normalizedUsername = username.toLowerCase().trim();

  // Check if username exists in users table
  const existingUser = await db.query.users.findFirst({
    where: excludeUserId
      ? and(ilike(users.username, normalizedUsername), ne(users.id, excludeUserId))
      : ilike(users.username, normalizedUsername),
    columns: { id: true },
  });

  if (existingUser) {
    return { available: false, reason: 'Username is already taken by an existing user' };
  }

  // Check if username has a pending or approved reservation
  const existingReservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.username, normalizedUsername),
      or(eq(usernameReservations.status, 'pending'), eq(usernameReservations.status, 'approved'))
    ),
    columns: { id: true, status: true },
  });

  if (existingReservation) {
    const reason =
      existingReservation.status === 'pending'
        ? 'Username is already reserved and pending approval'
        : 'Username is already reserved';
    return { available: false, reason };
  }

  return { available: true };
};

/**
 * Create a new username reservation
 * @param {Object} data - Reservation data
 * @returns {Promise<Object>} Created reservation
 */
export const createReservation = async data => {
  const { fullName, email, username, primaryPlatform, followerCount, profileUrl, additionalInfo } =
    data;

  const normalizedUsername = username.toLowerCase().trim();
  const normalizedEmail = email.toLowerCase().trim();

  // Check username availability
  const availability = await checkUsernameAvailability(normalizedUsername);
  if (!availability.available) {
    throw new ApiError(httpStatus.CONFLICT, availability.reason);
  }

  // Check if user already has a pending reservation for the same email
  const existingEmailReservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.email, normalizedEmail),
      eq(usernameReservations.status, 'pending')
    ),
  });

  if (existingEmailReservation) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'You already have a pending username reservation. Please wait for it to be reviewed.'
    );
  }

  // Create the reservation
  const [reservation] = await db
    .insert(usernameReservations)
    .values({
      fullName: fullName.trim(),
      email: normalizedEmail,
      username: normalizedUsername,
      primaryPlatform,
      followerCount,
      profileUrl: profileUrl.trim(),
      additionalInfo: additionalInfo?.trim() || null,
      status: 'pending',
    })
    .returning();

  return reservation;
};

/**
 * Get all reservations with pagination and filtering (for admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated reservations
 */
export const getReservations = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    status,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (status) {
    conditions.push(eq(usernameReservations.status, status));
  }

  if (search) {
    conditions.push(
      or(
        ilike(usernameReservations.username, `%${search}%`),
        ilike(usernameReservations.email, `%${search}%`),
        ilike(usernameReservations.fullName, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(usernameReservations)
    .where(whereClause);

  // Get reservations
  const orderColumn = usernameReservations[sortBy] || usernameReservations.createdAt;
  const orderDirection = sortOrder === 'asc' ? asc : desc;

  const reservations = await db
    .select({
      id: usernameReservations.id,
      fullName: usernameReservations.fullName,
      email: usernameReservations.email,
      username: usernameReservations.username,
      primaryPlatform: usernameReservations.primaryPlatform,
      followerCount: usernameReservations.followerCount,
      profileUrl: usernameReservations.profileUrl,
      additionalInfo: usernameReservations.additionalInfo,
      status: usernameReservations.status,
      reviewNotes: usernameReservations.reviewNotes,
      rejectionReason: usernameReservations.rejectionReason,
      reviewedAt: usernameReservations.reviewedAt,
      createdAt: usernameReservations.createdAt,
      updatedAt: usernameReservations.updatedAt,
    })
    .from(usernameReservations)
    .where(whereClause)
    .orderBy(orderDirection(orderColumn))
    .limit(limit)
    .offset(offset);

  return {
    data: reservations,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  };
};

/**
 * Get a single reservation by ID
 * @param {string} reservationId - Reservation ID
 * @returns {Promise<Object>} Reservation
 */
export const getReservationById = async reservationId => {
  const reservation = await db.query.usernameReservations.findFirst({
    where: eq(usernameReservations.id, reservationId),
  });

  if (!reservation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Reservation not found');
  }

  return reservation;
};

/**
 * Update reservation status (admin action)
 * @param {string} reservationId - Reservation ID
 * @param {Object} updateData - Update data
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Updated reservation
 */
export const updateReservationStatus = async (reservationId, updateData, adminId) => {
  const { status, reviewNotes, rejectionReason } = updateData;

  // Get the current reservation
  const currentReservation = await getReservationById(reservationId);

  // If approving, check if username is still available
  if (status === 'approved' && currentReservation.status !== 'approved') {
    // Check if username was taken by someone else in the meantime
    const existingUser = await db.query.users.findFirst({
      where: ilike(users.username, currentReservation.username),
      columns: { id: true },
    });

    if (existingUser) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot approve: Username has been taken by another user'
      );
    }

    // Check if another reservation was approved for the same username
    const otherApprovedReservation = await db.query.usernameReservations.findFirst({
      where: and(
        ilike(usernameReservations.username, currentReservation.username),
        eq(usernameReservations.status, 'approved'),
        ne(usernameReservations.id, reservationId)
      ),
    });

    if (otherApprovedReservation) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot approve: Another reservation for this username was already approved'
      );
    }
  }

  // Update the reservation
  const [updatedReservation] = await db
    .update(usernameReservations)
    .set({
      status,
      reviewNotes: reviewNotes || null,
      rejectionReason: status === 'rejected' ? rejectionReason : null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
      // Set expiry for approved reservations (e.g., 30 days to register)
    })
    .where(eq(usernameReservations.id, reservationId))
    .returning();

  return updatedReservation;
};

/**
 * Get reservation statistics (for admin dashboard)
 * @returns {Promise<Object>} Statistics
 */
export const getReservationStatistics = async () => {
  const stats = await db
    .select({
      status: usernameReservations.status,
      count: sql`count(*)::int`,
    })
    .from(usernameReservations)
    .groupBy(usernameReservations.status);

  const formattedStats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  };

  stats.forEach(stat => {
    formattedStats[stat.status] = stat.count;
    formattedStats.total += stat.count;
  });

  return formattedStats;
};

/**
 * Check if a username is reserved (for registration validation)
 * Returns reservation details if username is reserved
 * @param {string} username - Username to check
 * @param {string} email - Email of the registering user (to allow them to use their approved username)
 * @returns {Promise<Object|null>} Reservation if found, null otherwise
 */
export const getApprovedReservationForUser = async (username, email) => {
  const normalizedUsername = username.toLowerCase().trim();
  const normalizedEmail = email?.toLowerCase().trim();

  // Check if user has an approved reservation for this username
  const reservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.username, normalizedUsername),
      eq(usernameReservations.status, 'approved'),
      normalizedEmail ? ilike(usernameReservations.email, normalizedEmail) : sql`false`
    ),
  });

  return reservation;
};

/**
 * Check if username is reserved by someone else
 * @param {string} username - Username to check
 * @param {string} email - Email of the registering user
 * @returns {Promise<{isReserved: boolean, canUse: boolean, message?: string}>}
 */
export const checkUsernameForRegistration = async (username, email) => {
  const normalizedUsername = username.toLowerCase().trim();
  const normalizedEmail = email?.toLowerCase().trim();

  // First, check if username exists in users table
  const existingUser = await db.query.users.findFirst({
    where: ilike(users.username, normalizedUsername),
    columns: { id: true },
  });

  if (existingUser) {
    return {
      isReserved: false,
      canUse: false,
      message: 'This username is already taken',
    };
  }

  // Check for approved reservation
  const approvedReservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.username, normalizedUsername),
      eq(usernameReservations.status, 'approved')
    ),
  });

  if (approvedReservation) {
    // Check if the reservation belongs to this user (by email)
    if (normalizedEmail && approvedReservation.email.toLowerCase() === normalizedEmail) {
      // Check if reservation is expired
      if (approvedReservation.expiresAt && new Date(approvedReservation.expiresAt) < new Date()) {
        return {
          isReserved: true,
          canUse: false,
          message:
            'Your username reservation has expired. Please submit a new reservation request.',
        };
      }
      return {
        isReserved: true,
        canUse: true,
        message: 'You can use your reserved username',
      };
    } else {
      return {
        isReserved: true,
        canUse: false,
        message: 'This username is reserved by another user',
      };
    }
  }

  // Check for pending reservation
  const pendingReservation = await db.query.usernameReservations.findFirst({
    where: and(
      ilike(usernameReservations.username, normalizedUsername),
      eq(usernameReservations.status, 'pending')
    ),
  });

  if (pendingReservation) {
    if (normalizedEmail && pendingReservation.email.toLowerCase() === normalizedEmail) {
      return {
        isReserved: true,
        canUse: false,
        message:
          'Your username reservation is still pending approval. Please wait for it to be approved before registering.',
      };
    } else {
      return {
        isReserved: true,
        canUse: false,
        message: 'This username is reserved and pending approval',
      };
    }
  }

  // Username is available
  return {
    isReserved: false,
    canUse: true,
  };
};

/**
 * Mark a reservation as used (after successful registration)
 * @param {string} username - Username that was used
 * @param {string} email - Email of the user who registered
 * @returns {Promise<void>}
 */
export const markReservationAsUsed = async (username, email) => {
  const normalizedUsername = username.toLowerCase().trim();
  const normalizedEmail = email?.toLowerCase().trim();

  if (!normalizedEmail) return;

  // Find and update the approved reservation
  await db
    .update(usernameReservations)
    .set({
      reviewNotes: 'User successfully registered with this username',
      updatedAt: new Date(),
    })
    .where(
      and(
        ilike(usernameReservations.username, normalizedUsername),
        ilike(usernameReservations.email, normalizedEmail),
        eq(usernameReservations.status, 'approved')
      )
    );
};

export const usernameReservationService = {
  checkUsernameAvailability,
  createReservation,
  getReservations,
  getReservationById,
  updateReservationStatus,
  getReservationStatistics,
  getApprovedReservationForUser,
  checkUsernameForRegistration,
  markReservationAsUsed,
};
