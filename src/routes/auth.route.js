import express from 'express';
import { z, ZodError } from 'zod';
import httpStatus from 'http-status';

import { authController } from '../controllers/index.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { catchAsync } from '../utils/catch-async.js';
import { refreshTokenSchema } from '../db/schema.js';
import ApiError from '../utils/api-error.js';

import {
  loginLimiter,
  mobileLimiter,
  registerLimiter,
  otpLimiter,
  verifyOtpLimiter,
  passwordResetLimiter,
} from '../middlewares/rateLimiter.js';
import { resetPassword } from '../controllers/auth.controller.js';
import { csrfProtection } from '../middlewares/csrf.middleware.js';

const router = express.Router();

const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      return next(new ApiError(httpStatus.BAD_REQUEST, firstIssue.message));
    }
    next(error);
  }
};

const emailSchema = z.string().min(1, 'Email is required').email('Invalid email address');
const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
  .optional();
const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username cannot exceed 30 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
  .optional();

const STRONG_PASSWORD_HINT =
  'Enter a strong password: use 8–30 characters (longer is safer), and include uppercase letters, lowercase letters, numbers, and special symbols.';

const strongPasswordSchema = z
  .string()
  .min(8, STRONG_PASSWORD_HINT)
  .max(30, 'Password cannot exceed 30 characters')
  .superRefine((password, ctx) => {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasLower || !hasUpper || !hasNumber || !hasSpecial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: STRONG_PASSWORD_HINT });
    }
  });

const loginSchema = z.object({
  identifier: z.union(
    [z.email(), phoneSchema, usernameSchema],
    'Please enter a valid email, phone number, or username'
  ),
  password: z.string().min(1),
  // Client-generated anonymous id — when present, gets linked to the now-known
  // user so pre-login analytics events can be folded into their profile.
  anonymousId: z.string().max(64).optional(),
});

const userInformationSchema = z
  .object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    googlePlaceId: z.string().optional(),
  })
  .optional();

const MIN_AGE_YEARS = 18;

const dobSchema = z.coerce
  .date()
  .refine(date => date.getTime() <= Date.now(), {
    message: 'Date of birth cannot be in the future',
  })
  .refine(
    date => {
      const today = new Date();
      const age = today.getFullYear() - date.getFullYear();
      const monthDiff = today.getMonth() - date.getMonth();
      const dayDiff = today.getDate() - date.getDate();
      const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
      return actualAge >= MIN_AGE_YEARS;
    },
    { message: 'You must be at least 18 years old to create an account' }
  );

const registerSchema = z.object({
  phoneNumber: phoneSchema,
  email: emailSchema,
  password: strongPasswordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  username: usernameSchema,
  dob: dobSchema,
  userInformation: userInformationSchema,
});

const mobileLoginSchema = z.object({
  phoneNumber: phoneSchema,
  password: z.string().min(1),
});

const mobileRegisterSchema = z.object({
  phoneNumber: phoneSchema,
  password: strongPasswordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  username: usernameSchema,
  dob: dobSchema,
  email: z.email('Invalid email address').optional().or(z.literal('')),
  userInformation: userInformationSchema,
});

const forgotPasswordSchema = z.object({
  identifier: z.union([z.email(), phoneSchema], 'Please enter a valid email or phone number'),
});

const verifyOtpSchema = z.object({
  identifier: z.union([z.email(), phoneSchema], 'Please enter a valid email or phone number'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

const resetPasswordSchema = z.object({
  identifier: z.union([z.email(), phoneSchema], 'Please enter a valid email or phone number'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  password: strongPasswordSchema,
});

router.post(
  '/register',
  registerLimiter,
  csrfProtection,
  validate(registerSchema),
  catchAsync(authController.registerBasic)
);

router.post(
  '/login',
  loginLimiter,
  csrfProtection,
  validate(loginSchema),
  catchAsync(authController.login)
);

router.get('/session', authMiddleware, catchAsync(authController.session));

router.post('/logout', catchAsync(authController.logoutBasic));

router.post(
  '/refresh-token',
  validate(refreshTokenSchema),
  catchAsync(authController.refreshTokens)
);

router.post(
  '/forgot-password',
  otpLimiter,
  validate(forgotPasswordSchema),
  catchAsync(authController.forgotPasswordOtp)
);

router.post(
  '/resend-otp',
  otpLimiter,
  validate(forgotPasswordSchema),
  catchAsync(authController.resendOtp)
);

router.post(
  '/verify-otp',
  verifyOtpLimiter,
  validate(verifyOtpSchema),
  catchAsync(authController.verifyOtp)
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  validate(resetPasswordSchema),
  catchAsync(authController.resetPasswordWithOtp)
);

router.post(
  '/mobile/register',
  registerLimiter,
  validate(mobileRegisterSchema),
  catchAsync(authController.mobileRegister)
);

router.post(
  '/mobile/login',
  mobileLimiter,
  validate(mobileLoginSchema),
  catchAsync(authController.mobileLogin)
);

router.get('/verify-email', catchAsync(authController.verifyEmail));
// CSRF token endpoint for web clients
router.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ success: true, csrfToken: req.csrfToken() });
});

router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);
router.post('/google/mobile', authController.googleMobileAuthController);
// Facebook OAuth (web)
router.get('/facebook', authController.facebookAuth);
router.get('/facebook/callback', authController.facebookCallback);
// Apple OAuth (web)
router.get('/apple', authController.appleAuth);
router.get('/apple/callback', authController.appleCallback);
// Apple sometimes POSTs to the callback URL, support both methods
router.post('/apple/callback', authController.appleCallback);
// Facebook Mobile
const facebookMobileSchema = z.object({
  accessToken: z.string().min(1),
  profile: z
    .object({
      id: z.string().optional(),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      picture: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
});

router.post(
  '/facebook/mobile',
  mobileLimiter,
  validate(facebookMobileSchema),
  catchAsync(authController.facebookMobileAuthController)
);

const appleMobileSchema = z.object({
  idToken: z.string().min(1),
  profile: z
    .object({
      id: z.string().optional(),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      picture: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
});

router.post(
  '/apple/mobile',
  mobileLimiter,
  validate(appleMobileSchema),
  catchAsync(authController.appleMobileAuthController)
);

export default router;