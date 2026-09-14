import bcrypt from 'bcrypt';
import httpStatus from 'http-status';
import passport from 'passport';
import { db } from '../db/index.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { eq, isNull, and } from 'drizzle-orm';
import { TOKEN_TYPES } from '../config/tokens.js';
import { isUserEffectivelySuspended } from '../utils/suspension.js';
import ApiError from '../utils/api-error.js';
import { authService, tokenService, userService } from '../services/index.js';
import { sendResetPasswordEmail } from '../services/mail.service.js';
import {
  verifyGoogleIdTokenAndGetUser,
  verifyFacebookAccessTokenAndGetUser,
  verifyFacebookAuthenticationToken,
  verifyAppleIdentityTokenAndGetUser,
} from '../services/oauth.service.js';
import { users, userSubscriptions, organizers } from '../db/schema/index.js';
import { inArray } from 'drizzle-orm';
import logger from '../config/authLogger.js';
import { linkAnonymousIdentity } from '../services/analyticsIngest.service.js';

const ACTIVE_STATUSES = ['active', 'trialing', 'comped'];

const toPublicUser = user => {
  const isSuspended = isUserEffectivelySuspended(user);
  const until = user?.suspendedUntil ?? null;
  return {
    id: user?.id,
    phoneNumber: user?.phoneNumber,
    email: user?.email,
    firstName: user?.firstName,
    lastName: user?.lastName,
    username: user?.username,
    name: user?.name || `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
    image: user?.image,
    role: user?.role,
    roles: user?.roles,
    organizer: user?.organizer,
    userInformation: user?.userInformation || null,
    talentProfileId: user?.talentProfileId ?? null,
    hasTalentProfile: !!user?.talentProfileId,
    hasOrganizerProfile: !!user?.hasOrganizerProfile,
    isPlus: user?.isBritesidePlus ?? false,
    isEmailVerified: user?.isEmailVerified ?? false,
    isVerifiedAdult: user?.isVerifiedAdult ?? false,
    isSuspended,
    suspendedUntil: isSuspended ? until : null,
    suspensionReason: isSuspended ? (user?.suspensionReason ?? null) : null,
  };
};

// Existing token-based flows used by schema-driven routes
export async function register(req, res, next) {
  try {
    const { user } = await authService.registerUser(req.body);
    const tokens = await tokenService.generateAuthTokens(user);
    res.status(httpStatus.CREATED).send({ user, tokens });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    const token = await tokenService.findToken(req.body.refreshToken, TOKEN_TYPES.REFRESH);
    if (!token) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'token not found');
    }
    await tokenService.deleteToken(token.id);
    res.status(httpStatus.NO_CONTENT).send();
  } catch (error) {
    next(error);
  }
}

export async function refreshTokens(req, res, next) {
  try {
    const tokens = await tokenService.refreshAuth(req.body.refreshToken);
    return res.json({ tokens });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const user = await userService.getUserByUsernameOrEmail(req.body.usernameOrEmail);
    if (!user) {
      return res.status(httpStatus.NO_CONTENT).send();
    }
    const resetPasswordToken = await tokenService.generateResetPasswordToken(user.email);

    await sendResetPasswordEmail(user.email, resetPasswordToken);

    res.status(httpStatus.NO_CONTENT).send();
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const resetPasswordTokenDoc = await tokenService.verifyToken(
      req.body.token,
      TOKEN_TYPES.RESET_PASSWORD
    );
    const user = await userService.getUserById(resetPasswordTokenDoc.userId);
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 12);

    await userService.updateUserById(user.id, {
      passwordHash: hashedPassword,
      updatedAt: new Date(),
    });
    await tokenService.deleteMany(user.id, TOKEN_TYPES.RESET_PASSWORD);

    res.status(httpStatus.NO_CONTENT).send();
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const token = req.query.token;
    if (!token) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Verification token is required');
    }

    await authService.verifyEmailToken(token);
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
}

// Routes migrated from legacy auth.js
export async function registerBasic(req, res, next) {
  try {
    const { user, token } = await authService.registerUser(req.body);
    res.status(httpStatus.CREATED).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: toPublicUser(user),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  const payload = {
    identifier: req.body.usernameOrEmail ?? req.body.identifier,
    password: req.body.password,
  };
  try {
    const { user, token } = await authService.loginWithIdentifier(
      payload.identifier,
      payload.password
    );
    const tokens = await tokenService.generateAuthTokens(user);

    if (req.body.anonymousId) {
      linkAnonymousIdentity(req.body.anonymousId, user.id).catch(err =>
        logger.error({ method: 'login', message: 'Failed to link anonymousId', error: err.message })
      );
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: toPublicUser(user),
        token,
        tokens,
      },
    });
  } catch (error) {
    logger.error({
      method: 'login',
      identifier: payload.identifier,
      ip: req.ip,
      message: error.message,
    });
    next(error);
  }
}

export async function session(req, res) {
  const user = req.user;

  const [talentProfile, organizerProfile] = await Promise.all([
    db
      .select({ id: talentProfiles.id, subscription: users.isBritesidePlus })
      .from(talentProfiles)
      .leftJoin(users, eq(talentProfiles.userId, users.id))
      .where(and(eq(talentProfiles.userId, user.id), isNull(talentProfiles.deletedAt)))
      .limit(1),
    db
      .select({ id: organizers.id })
      .from(organizers)
      .where(eq(organizers.userId, user.id))
      .limit(1),
  ]);

  res.json({
    success: true,
    data: {
      user: toPublicUser({
        ...user,
        talentProfileId: talentProfile[0]?.id ?? null,
        hasOrganizerProfile: !!organizerProfile[0],
        isPlus: user.isBritesidePlus ?? false,
      }),
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
}

export async function logoutBasic(req, res) {
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

export async function forgotPasswordOtp(req, res, next) {
  try {
    const { identifier } = req.body;
    const result = await authService.generateAndSendOtp(identifier);
    if (!result.user) {
      return res.json({
        success: true,
        message: 'If an account exists, password reset code has been sent',
      });
    }

    const message = identifier.includes('@')
      ? 'Password reset code sent to your email'
      : 'Password reset code sent to your phone';

    res.json({
      success: true,
      message,
      data: { identifier: result.identifier },
    });
  } catch (error) {
    next(error);
  }
}

export async function resendOtp(req, res, next) {
  try {
    const { identifier } = req.body;
    const result = await authService.generateAndSendOtp(identifier);
    if (!result.user) {
      return res.json({
        success: true,
        message: 'If an account exists, password reset code has been sent',
      });
    }

    const message = identifier.includes('@')
      ? 'Password reset code sent to your email'
      : 'Password reset code sent to your phone';

    res.json({
      success: true,
      message,
      data: { identifier: result.identifier },
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const { identifier, otp } = req.body;
    authService.verifyOtpCode(identifier, otp);
    res.json({
      success: true,
      message: 'OTP verified successfully',
      data: { identifier },
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordWithOtp(req, res, next) {
  try {
    const { identifier, otp, password } = req.body;
    await authService.resetPasswordWithOtp(identifier, otp, password);
    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function mobileRegister(req, res, next) {
  try {
    const { user, token } = await authService.registerUser(req.body, {
      allowEmptyEmail: true,
    });
    res.status(httpStatus.CREATED).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: toPublicUser(user),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function mobileLogin(req, res, next) {
  try {
    const { phoneNumber, password } = req.body;
    const { user, token } = await authService.loginWithPhone(phoneNumber, password);
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: toPublicUser(user),
        token,
      },
    });
  } catch (error) {
    logger.error({ method: 'mobile-login', phoneNumber, ip: req.ip, message: error.message });
    next(error);
  }
}

export function googleAuth(req, res, next) {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })(req, res, next);
}

export function googleCallback(req, res, next) {
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    try {
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

      if (err) {
        logger.error({ method: 'google-oauth-callback', ip: req.ip, message: err.message });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            err.message || 'Authentication failed'
          )}`
        );
      }

      if (!user) {
        logger.warn({
          method: 'google-oauth-callback',
          ip: req.ip,
          message: info?.message || 'No user returned',
        });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            info?.message || 'Authentication failed'
          )}`
        );
      }

      const { token } = authService.issueAccessToken(user.id);

      await authService.recordLogin(user.id, user.loginCount);

      const redirectUrl = `${frontendBase}/auth/callback?token=${encodeURIComponent(token)}`;
      console.log(
        'OAuth redirect to:',
        frontendBase,
        'callback with token present, method=',
        req.method
      );
      res.redirect(redirectUrl);
    } catch (error) {
      logger.error({ method: 'google-oauth-callback', ip: req.ip, message: error.message });
      res.redirect(
        `${
          process.env.FRONTEND_URL || 'http://localhost:3000'
        }/auth/error?message=${encodeURIComponent('Authentication failed')}`
      );
    }
  })(req, res, next);
}

export async function googleCallbackMobile(req, res, next) {
  try {
    const { code } = req.body;
    if (!code) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Authorization code is required');
    }
    throw new ApiError(
      httpStatus.NOT_IMPLEMENTED,
      'Mobile Google OAuth not yet implemented. Use web flow.'
    );
  } catch (error) {
    next(error);
  }
}

export const googleMobileAuthController = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'idToken is required' });
    }

    // 1️⃣ Verify Google token + resolve user
    const user = await verifyGoogleIdTokenAndGetUser(idToken);

    // 2️⃣ Issue your JWT
    const { token } = authService.issueAccessToken(user.id);
    await authService.recordLogin(user.id, user.loginCount);

    // 3️⃣ Respond to mobile app
    return res.json({
      type: 'success',
      data: {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      },
    });
  } catch (error) {
    logger.error({ method: 'google-mobile-auth', ip: req.ip, message: error.message });
    return res.status(401).json({
      message: 'Google authentication failed',
    });
  }
};

export function facebookAuth(req, res, next) {
  passport.authenticate('facebook', { scope: ['email'], session: false })(req, res, next);
}

export function facebookCallback(req, res, next) {
  passport.authenticate('facebook', { session: false }, async (err, user, info) => {
    try {
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

      if (err) {
        logger.error({ method: 'facebook-oauth-callback', ip: req.ip, message: err.message });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            err.message || 'Authentication failed'
          )}`
        );
      }

      if (!user) {
        logger.warn({
          method: 'facebook-oauth-callback',
          ip: req.ip,
          message: info?.message || 'No user returned',
        });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            info?.message || 'Authentication failed'
          )}`
        );
      }

      const { token } = authService.issueAccessToken(user.id);

      await authService.recordLogin(user.id, user.loginCount);

      const redirectUrl = `${frontendBase}/auth/callback?token=${encodeURIComponent(token)}`;
      console.log(
        'OAuth redirect to:',
        frontendBase,
        'callback with token present, method=',
        req.method
      );
      res.redirect(redirectUrl);
    } catch (error) {
      logger.error({ method: 'facebook-oauth-callback', ip: req.ip, message: error.message });
      res.redirect(
        `${
          process.env.FRONTEND_URL || 'http://localhost:3000'
        }/auth/error?message=${encodeURIComponent('Authentication failed')}`
      );
    }
  })(req, res, next);
}

export const facebookMobileAuthController = async (req, res) => {
  try {
    const { accessToken, authenticationToken } = req.body;

    if (!accessToken && !authenticationToken) {
      return res.status(400).json({
        message: 'Either accessToken or authenticationToken is required',
      });
    }

    let user;
    let tokenToValidate = authenticationToken || accessToken;

    // Helper: Detect if token is JWT (iOS Limited Login) or traditional access token
    const isJWT = token => {
      if (!token) return false;
      // JWTs have 3 parts separated by dots
      const parts = token.split('.');
      return parts.length === 3;
    };

    const tokenType = isJWT(tokenToValidate) ? 'JWT' : 'Access Token';
    console.log('Received token type:', tokenType);
    console.log('Token preview:', tokenToValidate?.substring(0, 50) + '...');

    console.log('Starting Facebook token validation for mobile...', isJWT(tokenToValidate));
    // Try JWT validation first if token looks like a JWT
    if (isJWT(tokenToValidate)) {
      try {
        console.log('Attempting Facebook JWT validation...');
        user = await verifyFacebookAuthenticationToken(tokenToValidate);
        console.log('Facebook JWT validation successful');
      } catch (jwtError) {
        console.error('JWT validation failed:', jwtError.message);

        // If it looks like a JWT but validation failed, don't try as access token
        throw new Error(`Facebook JWT validation failed: ${jwtError.message}`);
      }
    } else {
      // Traditional access token validation (Android or old iOS)
      try {
        console.log('Attempting Facebook access token validation...');
        user = await verifyFacebookAccessTokenAndGetUser(tokenToValidate);
        console.log('Facebook access token validation successful');
      } catch (accessTokenError) {
        console.error('Access token validation failed:', accessTokenError.message);

        // If access token fails with "Cannot parse", it might be an OIDC token - try JWT
        if (accessTokenError.message.includes('Cannot parse')) {
          console.log('Access token parse failed, trying JWT validation as fallback...');
          try {
            user = await verifyFacebookAuthenticationToken(tokenToValidate);
            console.log('JWT fallback validation successful');
          } catch (jwtFallbackError) {
            console.error('JWT fallback also failed:', jwtFallbackError.message);
            throw new Error(
              `Facebook authentication failed. Access token: ${accessTokenError.message}. JWT fallback: ${jwtFallbackError.message}`
            );
          }
        } else {
          throw new Error(`Facebook access token validation failed: ${accessTokenError.message}`);
        }
      }
    }

    if (!user) {
      throw new Error('Failed to authenticate with Facebook');
    }

    const { token } = authService.issueAccessToken(user.id);
    await authService.recordLogin(user.id, user.loginCount);

    return res.json({
      success: true,
      data: {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      },
    });
  } catch (error) {
    logger.error({ method: 'facebook-mobile-auth', ip: req.ip, message: error.message });
    return res.status(401).json({
      message: 'Facebook authentication failed',
      error: error.message,
    });
  }
};

export function appleAuth(req, res, next) {
  passport.authenticate('apple', { scope: ['name', 'email'], session: false })(req, res, next);
}

export function appleCallback(req, res, next) {
  console.log('appleCallback invoked:', req.method, req.query, req.body);
  passport.authenticate('apple', { session: false }, async (err, user, info) => {
    try {
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

      if (err) {
        logger.error({ method: 'apple-oauth-callback', ip: req.ip, message: err.message });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            err.message || 'Authentication failed'
          )}`
        );
      }

      if (!user) {
        logger.warn({
          method: 'apple-oauth-callback',
          ip: req.ip,
          message: info?.message || 'No user returned',
        });
        return res.redirect(
          `${frontendBase}/auth/error?message=${encodeURIComponent(
            info?.message || 'Authentication failed'
          )}`
        );
      }

      const { token } = authService.issueAccessToken(user.id);

      await authService.recordLogin(user.id, user.loginCount);

      const redirectUrl = `${frontendBase}/auth/callback?token=${encodeURIComponent(token)}`;
      console.log(
        'OAuth redirect to:',
        frontendBase,
        'callback with token present, method=',
        req.method
      );
      res.redirect(redirectUrl);
    } catch (error) {
      logger.error({ method: 'apple-oauth-callback', ip: req.ip, message: error.message });
      res.redirect(
        `${
          process.env.FRONTEND_URL || 'http://localhost:3000'
        }/auth/error?message=${encodeURIComponent('Authentication failed')}`
      );
    }
  })(req, res, next);
}

export const appleMobileAuthController = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'idToken is required' });
    }

    // Verify Apple ID token & get user
    const user = await verifyAppleIdentityTokenAndGetUser(idToken);
    // Issue your app JWT
    const { token } = authService.issueAccessToken(user.id);
    await authService.recordLogin(user.id, user.loginCount);

    return res.json({
      type: 'success',
      data: {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      },
    });
  } catch (error) {
    logger.error({ method: 'apple-mobile-auth', ip: req.ip, message: error.message });
    return res.status(401).json({ message: 'Apple authentication failed' });
  }
};
