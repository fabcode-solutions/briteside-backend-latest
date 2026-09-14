import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import httpStatus from 'http-status';

import env from '../config/config.js';
import { TOKEN_TYPES } from '../config/tokens.js';
import ApiError from '../utils/api-error.js';
import { sendMail, sendOtpEmail, sendResetPasswordEmail } from './mail.service.js';
import * as tokenService from './token.service.js';
import * as userService from './user.service.js';
import { sendSMS } from '../utils/aws.util.js';
import { usernameReservationService } from './usernameReservation.service.js';
import { sendWelcomeEmail, sendEmailVerification } from '../templates/index.js';
import { db } from '../db/index.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { eq, isNull, and } from 'drizzle-orm';
const otpStore = new Map();
const DEFAULT_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 3;
export const ACCESS_TOKEN_TTL_DAYS = 7;

const sanitizeUser = user => {
  if (!user) return null;
  // eslint-disable-next-line no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
};

const issueAccessToken = userId => {
  const expires = dayjs().add(ACCESS_TOKEN_TTL_DAYS, 'd');
  const token = tokenService.generateToken(userId, expires, TOKEN_TYPES.ACCESS, env.jwt.secret);
  return { token, expiresAt: expires.toDate() };
};

const ensureUniqueUserFields = async ({ phoneNumber, email, username }) => {
  if (phoneNumber) {
    const existingPhone = await userService.findByPhone(phoneNumber);
    if (existingPhone) {
      throw new ApiError(httpStatus.CONFLICT, 'User with this phone number already exists');
    }
  }

  if (email) {
    const existingEmail = await userService.findByEmail(email);
    if (existingEmail) {
      throw new ApiError(httpStatus.CONFLICT, 'User with this email already exists');
    }
  }

  if (username) {
    const existingUsername = await userService.findByUsername(username);
    if (existingUsername) {
      throw new ApiError(httpStatus.CONFLICT, 'This username is already taken');
    }

    // Check if username is reserved by someone else
    const reservationCheck = await usernameReservationService.checkUsernameForRegistration(
      username,
      email
    );

    if (!reservationCheck.canUse) {
      throw new ApiError(httpStatus.CONFLICT, reservationCheck.message);
    }
  }
};
const enrichUserWithTalentProfile = async user => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;

  const talentProfile = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(and(eq(talentProfiles.userId, user.id), isNull(talentProfiles.deletedAt)))
    .limit(1);

  return {
    ...rest,
    talentProfileId: talentProfile[0]?.id ?? null,
  };
};
export async function registerUser(data, { allowEmptyEmail = false } = {}) {
  const { phoneNumber, email, password, firstName, lastName, username, dob } = data;

  const normalizedEmail = allowEmptyEmail && email?.trim() === '' ? null : (email ?? null);

  await ensureUniqueUserFields({
    phoneNumber,
    email: normalizedEmail || undefined,
    username,
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = await userService.createUser({
    phoneNumber,
    email: normalizedEmail,
    passwordHash,
    firstName,
    lastName,
    username,
    dob: new Date(dob).toDateString(),
    name: `${firstName} ${lastName}`,
    // dobSchema in auth.route.js already enforced 18+ before this ran
    isVerifiedAdult: true,
    ageVerificationSource: 'dob_registration',
  });

  // Create required user information if provided
  if (data.userInformation) {
    // createUserInformation will insert the row tied to this user
    await userService.createUserInformation(newUser.id, data.userInformation);
  }

  // Mark username reservation as used if applicable
  if (username && normalizedEmail) {
    await usernameReservationService.markReservationAsUsed(username, normalizedEmail);
  }

  // Retrieve the full user with relations (roles, userInformation, etc.)
  const user = await userService.getUserById(newUser.id);

  const access = issueAccessToken(user.id);

  if (user.email) {
    const { token: verificationToken, expires: verificationExpires } =
      await tokenService.generateVerifyEmailToken(user.id);

    await userService.updateUserById(user.id, {
      verificationToken,
      verificationExpires: verificationExpires.toDate(),
      isEmailVerified: false,
    });

    const verificationLink = `${env.apiHost || 'http://localhost:5000'}/auth/verify-email?token=${encodeURIComponent(
      verificationToken
    )}`;

    try {
      await sendEmailVerification(user.email, {
        user_name: user.firstName,
        verification_link: verificationLink,
        ip_address: 'N/A',
        location: 'N/A',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to send email verification:', error);
    }

    try {
      await sendWelcomeEmail(user.email, { user_name: user.firstName });
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }
  }

  return {
    user: await enrichUserWithTalentProfile(user),
    token: access.token,
    tokenExpiresAt: access.expiresAt,
  };
}

export async function loginWithIdentifier(identifier, password) {
  const user = await userService.getUserByUsernameOrEmail(identifier);
  if (!user || !user.passwordHash) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
  }

  await recordLogin(user.id, user.loginCount);

  const access = issueAccessToken(user.id);
  return {
    user: await enrichUserWithTalentProfile(user),
    token: access.token,
  };
}

export async function loginWithPhone(phoneNumber, password) {
  const user = await userService.findByPhone(phoneNumber);
  if (!user || !user.passwordHash) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
  }

  await recordLogin(user.id, user.loginCount);

  const access = issueAccessToken(user.id);
  return {
    user: await enrichUserWithTalentProfile(user),
    token: access.token,
  };
}

export const recordLogin = async (userId, existingLoginCount = 0) => {
  await userService.updateUserById(userId, {
    lastLogin: new Date(),
    loginCount: (existingLoginCount || 0) + 1,
  });
};

const createOtpEntry = (identifier, userId, otp, expiresAt) => {
  const timeout = setTimeout(
    () => {
      const stored = otpStore.get(identifier);
      if (stored && stored.expiresAt === expiresAt) {
        otpStore.delete(identifier);
      }
    },
    Math.max(expiresAt - Date.now(), 0)
  );

  otpStore.set(identifier, { otp, userId, expiresAt, attempts: 0, timeout });
};

const clearOtpEntry = identifier => {
  const entry = otpStore.get(identifier);
  if (entry?.timeout) {
    clearTimeout(entry.timeout);
  }
  otpStore.delete(identifier);
};

const generateOtpCode = () => Math.floor(100000 + Math.random() * 900000).toString();

export async function generateAndSendOtp(identifier) {
  const user = await userService.getUserByUsernameOrEmail(identifier);
  if (!user) {
    return { user: null };
  }
  const otp = generateOtpCode();
  const message = `Your OTP for resetting your GoKyro password is ${otp}. It will expire in 10 minutes. Do not share this code with anyone.If you didn’t request this, please ignore this message.`;
  const isEmail = identifier.includes('@');
  const targetIdentifier = isEmail ? user.email : user.phoneNumber;
  const expiresAt = Date.now() + DEFAULT_OTP_TTL_MS;
  if (!isEmail) {
    sendSMS(targetIdentifier, message);
  }
  clearOtpEntry(targetIdentifier);
  createOtpEntry(targetIdentifier, user.id, otp, expiresAt);

  if (isEmail && targetIdentifier) {
    try {
      await sendOtpEmail(targetIdentifier, otp);
      await sendResetPasswordEmail(targetIdentifier, otp);
    } catch (error) {
      // We intentionally swallow the error to avoid leaking OTP delivery failures.
      // Clients receive a success response regardless.
    }
  } else {
    // Placeholder for SMS integration
    // console.log(`OTP for ${targetIdentifier}: ${otp}`);
  }

  return {
    user: sanitizeUser(user),
    identifier: targetIdentifier,
    expiresAt,
  };
}

export async function resendOtp(identifier) {
  // Explicit wrapper for resend semantics; generateAndSendOtp already clears previous OTPs.
  return generateAndSendOtp(identifier);
}

export function verifyOtpCode(identifier, otp) {
  const otpData = otpStore.get(identifier);
  if (!otpData) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or expired OTP');
  }

  if (Date.now() > otpData.expiresAt) {
    clearOtpEntry(identifier);
    throw new ApiError(httpStatus.BAD_REQUEST, 'OTP has expired');
  }

  if (otpData.attempts >= MAX_OTP_ATTEMPTS) {
    clearOtpEntry(identifier);
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Too many failed attempts. Please request a new OTP'
    );
  }

  if (otpData.otp !== otp) {
    otpData.attempts += 1;
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid OTP');
  }

  return otpData;
}

export async function resetPasswordWithOtp(identifier, otp, password) {
  const otpData = verifyOtpCode(identifier, otp);

  const passwordHash = await bcrypt.hash(password, 10);
  await userService.updateUserById(otpData.userId, {
    passwordHash,
    updatedAt: new Date(),
  });

  clearOtpEntry(identifier);
}

export async function verifyEmailToken(token) {
  const tokenDoc = await tokenService.verifyToken(token, TOKEN_TYPES.VERIFY_EMAIL);
  if (!tokenDoc) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid verification token');
  }

  const user = await userService.getUserById(tokenDoc.userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  if (user.isEmailVerified) {
    return user;
  }

  const updatedUser = await userService.updateUserById(user.id, {
    isEmailVerified: true,
    emailVerified: new Date(),
    verificationToken: null,
    verificationExpires: null,
    updatedAt: new Date(),
  });

  await tokenService.deleteMany(user.id, TOKEN_TYPES.VERIFY_EMAIL);

  return updatedUser;
}

export function clearOtp(identifier) {
  clearOtpEntry(identifier);
}

export { sanitizeUser, issueAccessToken };
