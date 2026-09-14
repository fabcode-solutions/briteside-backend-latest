import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as AppleStrategy } from 'passport-apple';
import { eq, and, inArray } from 'drizzle-orm';

import env from './config.js';
import { TOKEN_TYPES } from './tokens.js';
import { users, organizers, userRoles, roles, userSubscriptions } from '../db/schema/index.js';
import { db } from '../db/index.js';
import {
  findOrCreateGoogleUser,
  findOrCreateFacebookUser,
  findOrCreateAppleUser,
} from '../services/oauth.service.js';
import logger from './authLogger.js';

const jwtOptions = {
  secretOrKey: env.jwt.secret,
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
};

async function jwtVerify(payload, done) {
  try {
    if (payload.type !== TOKEN_TYPES.ACCESS) {
      throw new Error('Invalid token type');
    }
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.sub),
    });
    if (!user) {
      return done(null, false);
    }

    // Fetch user roles
    const userRoleRows = await db
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    // Check if user has an organizer profile
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, user.id),
      columns: { id: true },
    });

    const activeSub = await db.query.userSubscriptions.findFirst({
      where: and(
        eq(userSubscriptions.userId, user.id),
        inArray(userSubscriptions.status, ['active', 'trialing', 'comped'])
      ),
      columns: { id: true },
    });
    const liveIsPlus = !!activeSub;

    // Keep DB in sync if flag drifted (fire-and-forget — never block the request)
    if (user.isBritesidePlus !== liveIsPlus) {
      db.update(users)
        .set({ isBritesidePlus: liveIsPlus, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .catch(() => {});
    }

    const userWithMeta = {
      ...user,
      isBritesidePlus: liveIsPlus,
      roles: userRoleRows.map(r => r.name),
      organizerId: organizer?.id || null,
      // Set only when this token was minted by admin.service.impersonateUser —
      // carries the real admin's id through to authMiddleware / req.impersonatedBy
      impersonatedBy: payload.impersonatedBy || null,
    };

    done(null, userWithMeta);
  } catch (error) {
    logger.error({ method: 'jwt-verify', userId: payload?.sub, message: error.message });
    done(error, false);
  }
}

export const jwtStrategy = new JwtStrategy(jwtOptions, jwtVerify);

// Google OAuth Strategy
const googleOptions = {
  clientID: env.google.clientId || '',
  clientSecret: env.google.clientSecret || '',
  callbackURL: env.google.callbackUrl || 'http://localhost:5000/api/auth/google/callback',
  scope: ['profile', 'email'],
};

async function googleVerify(accessToken, refreshToken, profile, done) {
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    const tokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
      scope: 'profile email',
      id_token: profile.id,
    };

    const user = await findOrCreateGoogleUser(profile, tokens);

    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, user.id),
      columns: { id: true },
    });

    const userWithOrganizer = {
      ...user,
      organizerId: organizer?.id || null,
    };

    done(null, userWithOrganizer);
  } catch (error) {
    logger.error({ method: 'google-strategy', profileId: profile?.id, message: error.message });
    done(error, false);
  }
}

export const googleStrategy = new GoogleStrategy(googleOptions, googleVerify);

// Facebook OAuth Strategy
const facebookOptions = {
  clientID: env.facebook.appId || '',
  clientSecret: env.facebook.appSecret || '',
  callbackURL: env.facebook.callbackUrl || 'http://localhost:3000/api/auth/facebook/callback',
  profileFields: ['id', 'displayName', 'name', 'emails', 'photos'],
};

async function facebookVerify(accessToken, refreshToken, profile, done) {
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    const tokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
      scope: null,
      id_token: null,
    };

    const user = await findOrCreateFacebookUser(profile, tokens);

    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, user.id),
      columns: { id: true },
    });

    const userWithOrganizer = {
      ...user,
      organizerId: organizer?.id || null,
    };

    done(null, userWithOrganizer);
  } catch (error) {
    logger.error({ method: 'facebook-strategy', profileId: profile?.id, message: error.message });
    done(error, false);
  }
}

export const facebookStrategy = new FacebookStrategy(facebookOptions, facebookVerify);

async function appleVerify(req, accessToken, refreshToken, idToken, profile, done) {
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    const tokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
      scope: null,
      id_token: idToken || null,
    };

    const user = await findOrCreateAppleUser(idToken, tokens);

    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, user.id),
      columns: { id: true },
    });

    const userWithOrganizer = {
      ...user,
      organizerId: organizer?.id || null,
    };

    done(null, userWithOrganizer);
  } catch (error) {
    logger.error({ method: 'apple-strategy', message: error.message });
    done(error, false);
  }
}

// export const appleStrategy = new AppleStrategy(appleOptions, appleVerify);