import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { usernameReservationService } from '../services/usernameReservation.service.js';
import ApiError from '../utils/api-error.js';
import {
  sendUsernameReservationApprovedEmail,
  sendUsernameReservationRejectedEmail,
} from '../services/mail.service.js';

/**
 * Check username availability (public endpoint)
 * @route GET /api/reservations/check-username/:username
 */
const checkUsernameAvailability = catchAsync(async (req, res) => {
  const { username } = req.params;

  if (!username || username.trim().length < 3) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Username must be at least 3 characters');
  }

  const result = await usernameReservationService.checkUsernameAvailability(username);

  res.status(httpStatus.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Create a username reservation (public endpoint)
 * @route POST /api/reservations
 */
const createReservation = catchAsync(async (req, res) => {
  const { fullName, email, username, primaryPlatform, followerCount, profileUrl, additionalInfo } =
    req.body;

  const reservation = await usernameReservationService.createReservation({
    fullName,
    email,
    username,
    primaryPlatform,
    followerCount,
    profileUrl,
    additionalInfo,
  });

  res.status(httpStatus.CREATED).json({
    success: true,
    message:
      'Username reservation submitted successfully. We will review your application within 24-48 hours.',
    data: {
      id: reservation.id,
      username: reservation.username,
      email: reservation.email,
      status: reservation.status,
      createdAt: reservation.createdAt,
    },
  });
});

/**
 * Get reservations (admin endpoint)
 * @route GET /api/admin/reservations
 */
const getReservations = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const result = await usernameReservationService.getReservations({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    status,
    search,
    sortBy,
    sortOrder,
  });

  res.status(httpStatus.OK).json({
    success: true,
    data: result.data,
    pagination: result.pagination,
  });
});

/**
 * Get a single reservation by ID (admin endpoint)
 * @route GET /api/admin/reservations/:reservationId
 */
const getReservationById = catchAsync(async (req, res) => {
  const { reservationId } = req.params;

  const reservation = await usernameReservationService.getReservationById(reservationId);

  res.status(httpStatus.OK).json({
    success: true,
    data: reservation,
  });
});

/**
 * Update reservation status (admin endpoint)
 * @route PATCH /api/admin/reservations/:reservationId/status
 */
const updateReservationStatus = catchAsync(async (req, res) => {
  const { reservationId } = req.params;
  const { status, reviewNotes, rejectionReason } = req.body;

  if (!status) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Status is required');
  }

  const validStatuses = ['pending', 'approved', 'rejected'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Status must be one of: ${validStatuses.join(', ')}`
    );
  }

  if (status === 'rejected' && !rejectionReason) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Rejection reason is required when rejecting');
  }

  const reservation = await usernameReservationService.updateReservationStatus(
    reservationId,
    { status, reviewNotes, rejectionReason },
    req.user.id
  );

  if (status === 'approved') {
    sendUsernameReservationApprovedEmail({
      to: reservation.email,
      fullName: reservation.fullName,
      username: reservation.username,
    }).catch(err => console.error('[Mail] reservation approved email failed:', err.message));
  } else if (status === 'rejected') {
    sendUsernameReservationRejectedEmail({
      to: reservation.email,
      fullName: reservation.fullName,
      username: reservation.username,
      rejectionReason: reservation.rejectionReason,
    }).catch(err => console.error('[Mail] reservation rejected email failed:', err.message));
  }

  const messages = {
    pending: 'Reservation status updated to pending',
    approved: 'Username reservation approved successfully',
    rejected: 'Username reservation rejected',
  };

  res.status(httpStatus.OK).json({
    success: true,
    message: messages[status],
    data: reservation,
  });
});

/**
 * Get reservation statistics (admin endpoint)
 * @route GET /api/admin/reservations/statistics
 */
const getReservationStatistics = catchAsync(async (req, res) => {
  const stats = await usernameReservationService.getReservationStatistics();

  res.status(httpStatus.OK).json({
    success: true,
    data: stats,
  });
});

/**
 * Check reservation status by email (public endpoint)
 * @route GET /api/reservations/status
 */
const getReservationStatus = catchAsync(async (req, res) => {
  const { email } = req.query;

  if (!email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email is required');
  }

  // Get all reservations for this email
  const result = await usernameReservationService.getReservations({
    page: 1,
    limit: 10,
    search: email,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  // Filter to only show reservations matching the exact email
  const reservations = result.data.filter(r => r.email.toLowerCase() === email.toLowerCase());

  res.status(httpStatus.OK).json({
    success: true,
    data: reservations.map(r => ({
      id: r.id,
      username: r.username,
      status: r.status,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    })),
  });
});

export const usernameReservationController = {
  checkUsernameAvailability,
  createReservation,
  getReservations,
  getReservationById,
  updateReservationStatus,
  getReservationStatistics,
  getReservationStatus,
};
