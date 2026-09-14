import { userService } from '../services/index.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { z } from 'zod';
import {
  TextModerationService,
  TEXT_ENTITY,
} from '../services/moderation/textModeration.service.js';

const userInformationSchema = z.object({
  address: z.string().min(1, 'Address is required'),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  googlePlaceId: z.string().optional(),
});

const MIN_AGE_YEARS = 18;

const isAtLeastMinAge = dateString => {
  const date = new Date(dateString);
  const today = new Date();
  const age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  const dayDiff = today.getDate() - date.getDate();
  const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
  return actualAge >= MIN_AGE_YEARS;
};

const updateProfileSchema = z.object({
  image: z.url('Invalid image URL').optional(),
  bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional(),
  firstName: z.string().min(1, 'First name is required').optional(),
  lastName: z.string().min(1, 'Last name is required').optional(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be in YYYY-MM-DD format')
    .refine(date => new Date(date).getTime() <= Date.now(), {
      message: 'Date of birth cannot be in the future',
    })
    .refine(isAtLeastMinAge, {
      message: 'You must be at least 18 years old to use this platform',
    })
    .optional(),
  userInformation: userInformationSchema.optional(),
  showOnlineStatus: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
});

export const getUserProfile = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const result = await userService.getUserById(req.user.id);
  if (!result) {
    throw new ApiError(404, 'User not found');
  }

  res.json({
    success: true,
    data: result,
  });
});

export const getUserInformation = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const info = await userService.getUserInformationByUserId(req.user.id);
  if (!info) {
    return res.status(404).json({ success: false, message: 'User information not found' });
  }

  res.json({ success: true, data: info });
});

export const upsertUserInformation = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  const validated = userInformationSchema.parse(req.body);

  const existing = await userService.getUserInformationByUserId(req.user.id);
  let result;
  if (existing) {
    result = await userService.updateUserInformationByUserId(req.user.id, validated);
  } else {
    result = await userService.createUserInformation(req.user.id, validated);
  }

  res.json({ success: true, message: 'User information saved successfully', data: result });
});

export const updateUserProfile = catchAsync(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError(401, 'User not authenticated');
  }

  // Validate request body
  const validatedData = updateProfileSchema.parse(req.body);

  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(400, 'No valid fields provided for update');
  }

  const profileTextEntries = [
    ['bio', validatedData.bio],
    ['firstName', validatedData.firstName],
    ['lastName', validatedData.lastName],
  ].filter(([, value]) => typeof value === 'string' && value.trim());

  let profileModeration = { action: 'keep' };
  if (profileTextEntries.length > 0) {
    profileModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.PROFILE,
      entityId: req.user.id,
      entityCreatorId: req.user.id,
      texts: profileTextEntries.map(([, value]) => value),
    });
  }

  const { userInformation, ...userData } = validatedData;

  // dob passed the 18+ refine above — record it as the verification source
  // (covers OAuth signups, which don't collect dob at registration)
  if (userData.dob) {
    userData.isVerifiedAdult = true;
    userData.ageVerificationSource = 'dob_profile_update';
  }

  // Update users table if there are user fields
  if (Object.keys(userData).length > 0) {
    const updatedUser = await userService.updateUserById(req.user.id, userData);
    if (!updatedUser) {
      throw new ApiError(404, 'User not found');
    }
  }

  await TextModerationService.recordIfFlagged(profileModeration, {
    entityType: TEXT_ENTITY.USER_PROFILE,
    entityId: req.user.id,
    userId: req.user.id,
    fieldNames: profileTextEntries.map(([name]) => name),
    texts: profileTextEntries.map(([, value]) => value),
  });

  // Upsert userInformation (create if missing, update if exists)
  if (userInformation) {
    const existing = await userService.getUserInformationByUserId(req.user.id);
    if (existing) {
      await userService.updateUserInformationByUserId(req.user.id, userInformation);
    } else {
      await userService.createUserInformation(req.user.id, userInformation);
    }
  }

  // Return the full updated user
  const result = await userService.getUserById(req.user.id);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: result,
  });
});
