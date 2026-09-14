import express from 'express';
import { z } from 'zod';
import { usernameReservationController } from '../controllers/usernameReservation.controller.js';
import { catchAsync } from '../utils/catch-async.js';

const router = express.Router();

// Validation middleware
const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    console.log('Validation error:', error);
    next(error);
  }
};

// Validation schemas
const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username cannot exceed 50 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');

const createReservationSchema = z.object({
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(255, 'Full name cannot exceed 255 characters'),
  email: z.string().email('Please enter a valid email address'),
  username: usernameSchema,
  primaryPlatform: z.enum(
    [
      'Instagram',
      'Tiktok',
      'YouTube',
      'Twitter',
      'Facebook',
      'LinkedIn',
      'Snapchat',
      'Twitch',
      'Other',
    ],
    { errorMap: () => ({ message: 'Please select a valid social platform' }) }
  ),
  followerCount: z.enum(
    ['10k-50k', '50k-100k', '100k-500k', '500k-1M', '1M-5M', '5M-10M', '10M+'],
    { errorMap: () => ({ message: 'Please select a valid follower count range' }) }
  ),
  profileUrl: z.string().url('Please enter a valid profile URL'),
  additionalInfo: z
    .string()
    .max(2000, 'Additional information cannot exceed 2000 characters')
    .optional(),
});

// Public routes (no authentication required)

/**
 * @route GET /api/reservations/check-username/:username
 * @desc Check if a username is available for reservation
 * @access Public
 */
router.get(
  '/check-username/:username',
  catchAsync(usernameReservationController.checkUsernameAvailability)
);

/**
 * @route POST /api/reservations
 * @desc Submit a username reservation request
 * @access Public
 */
router.post(
  '/',
  validate(createReservationSchema),
  catchAsync(usernameReservationController.createReservation)
);

/**
 * @route GET /api/reservations/status
 * @desc Check reservation status by email
 * @access Public
 */
router.get('/status', catchAsync(usernameReservationController.getReservationStatus));

export default router;
