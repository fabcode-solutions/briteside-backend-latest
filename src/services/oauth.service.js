import crypto from 'crypto';
import { db } from '../config/database.js';
import { accounts, users } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { createUser, findByEmail } from './user.service.js';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/**
 * Generate a unique 10-digit phone number not in DB
 */
export const generateUniquePhoneNumber = async () => {
  let phone;
  let exists = true;

  while (exists) {
    phone = String(Math.floor(1000000000 + Math.random() * 9000000000)); // always 10 digits

    const user = await db.query.users.findFirst({
      where: eq(users.phoneNumber, phone),
      columns: { id: true },
    });

    exists = !!user;
  }

  return phone;
};

/**
 * Generate a unique username not in DB, derived from a base (name/email/dob-ish seed)
 */
export const generateUniqueUsername = async baseName => {
  const cleanBase =
    (baseName || 'user')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20) || 'user';

  let username = cleanBase;
  let exists = true;

  while (exists) {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: { id: true },
    });

    exists = !!user;

    if (exists) {
      username = `${cleanBase}${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }

  return username;
};

/**
 * Find an OAuth account by provider and provider account ID
 * @param {string} provider - OAuth provider (e.g., 'google')
 * @param {string} providerAccountId - Provider's user ID
 * @returns {Promise<Object|null>} Account with user data or null
 */
export const findAccountByProvider = async (provider, providerAccountId) => {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)),
    with: {
      user: true,
    },
  });

  return account;
};

/**
 * Create a new OAuth account link
 * @param {Object} data - Account data
 * @returns {Promise<Object>} Created account
 */
export const createAccount = async data => {
  const [account] = await db.insert(accounts).values(data).returning();
  return account;
};

/**
 * Update OAuth account tokens
 * @param {string} provider - OAuth provider
 * @param {string} providerAccountId - Provider's user ID
 * @param {Object} tokens - Token data to update
 * @returns {Promise<Object>} Updated account
 */
export const updateAccountTokens = async (provider, providerAccountId, tokens) => {
  const [account] = await db
    .update(accounts)
    .set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      token_type: tokens.token_type,
      scope: tokens.scope,
      id_token: tokens.id_token,
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)))
    .returning();

  return account;
};

/**
 * Find or create a user from Google OAuth profile
 * @param {Object} profile - Google profile data
 * @param {Object} tokens - OAuth tokens
 * @returns {Promise<Object>} User object
 */
// export const findOrCreateGoogleUser = async (profile, tokens) => {
//   // Check if account already exists
//   const existingAccount = await findAccountByProvider("google", profile.id);

//   if (existingAccount) {
//     // Update tokens and return existing user
//     await updateAccountTokens("google", profile.id, tokens);
//     return existingAccount.user;
//   }

//   // Check if user exists with the same email
//   const email = profile.emails?.[0]?.value;
//   let user = null;

//   if (email) {
//     user = await findByEmail(email);
//   }

//   // Create new user if doesn't exist
//   if (!user) {
//     const firstName = profile.name?.givenName || profile.displayName?.split(" ")[0] || "User";
//     const lastName = profile.name?.familyName || profile.displayName?.split(" ").slice(1).join(" ") || "";
//     const username = email?.split("@")[0] || `user_${profile.id}`;

//     // Generate a random phone number placeholder (will need to be updated by user)
//     // In production, you might want to make phone optional for OAuth users
//     // const randomPhone = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
//     const randomPhone = null;

//     user = await createUser({
//       email: email || null,
//       phoneNumber: randomPhone, // Placeholder - user should update this
//       passwordHash: "", // No password for OAuth users
//       firstName,
//       lastName,
//       username,
//       name: profile.displayName || `${firstName} ${lastName}`.trim(),
//       image: profile.photos?.[0]?.value || null,
//       isEmailVerified: profile.emails?.[0]?.verified || false,
//       emailVerified: profile.emails?.[0]?.verified ? new Date() : null,
//     });
//   }

//   // Link Google account to user
//   await createAccount({
//     userId: user.id,
//     type: "oauth",
//     provider: "google",
//     providerAccountId: profile.id,
//     access_token: tokens.access_token,
//     refresh_token: tokens.refresh_token,
//     expires_at: tokens.expires_at,
//     token_type: tokens.token_type || "Bearer",
//     scope: tokens.scope,
//     id_token: tokens.id_token,
//     providerData: JSON.stringify(profile),
//   });

//   return user;
// };

export const findOrCreateGoogleUser = async (profile, tokens) => {
  // 1️⃣ Check if Google account already exists
  const existingAccount = await findAccountByProvider('google', profile.id);

  if (existingAccount) {
    // ✅ Only update tokens if they actually exist (web OAuth)
    if (tokens?.access_token) {
      await updateAccountTokens('google', profile.id, tokens);
    }
    return existingAccount.user;
  }

  // 2️⃣ Check user by email
  const email = profile.emails?.[0]?.value;
  let user = null;

  if (email) {
    user = await findByEmail(email);
  }

  // 3️⃣ Create user if not exists
  if (!user) {
    const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';

    const lastName =
      profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';

    const usernameBase =
      email?.split('@')[0] || `${firstName}${lastName}`.trim() || `user_${profile.id}`;
    const username = await generateUniqueUsername(usernameBase);
    const phoneNumber = await generateUniquePhoneNumber();
    user = await createUser({
      email: email || null,
      phoneNumber,
      passwordHash: '',
      firstName,
      lastName,
      username,
      name: profile.displayName || `${firstName} ${lastName}`.trim(),
      image: profile.photos?.[0]?.value || null,
      isEmailVerified: profile.emails?.[0]?.verified || false,
      emailVerified: profile.emails?.[0]?.verified ? new Date() : null,
    });
  }

  // 4️⃣ Link Google account
  await createAccount({
    userId: user.id,
    type: 'oauth',
    provider: 'google',
    providerAccountId: profile.id,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    expires_at: tokens.expires_at || null,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope || null,
    id_token: null, // ❌ NEVER store mobile idToken
    providerData: JSON.stringify(profile),
  });

  return user;
};

/**
 * Link Google account to an existing user
 * @param {string} userId - User ID to link account to
 * @param {Object} profile - Google profile data
 * @param {Object} tokens - OAuth tokens
 * @returns {Promise<Object>} Created account
 */
export const linkGoogleAccount = async (userId, profile, tokens) => {
  // Check if this Google account is already linked to another user
  const existingAccount = await findAccountByProvider('google', profile.id);

  if (existingAccount) {
    if (existingAccount.userId === userId) {
      // Already linked to this user, just update tokens
      return await updateAccountTokens('google', profile.id, tokens);
    } else {
      throw new Error('This Google account is already linked to another user');
    }
  }

  // Create new account link
  const account = await createAccount({
    userId,
    type: 'oauth',
    provider: 'google',
    providerAccountId: profile.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope,
    id_token: tokens.id_token,
    providerData: JSON.stringify(profile),
  });

  return account;
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const verifyGoogleIdTokenAndGetUser = async idToken => {
  // 1️⃣ Verify Google ID token
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload || !payload.email_verified) {
    throw new Error('Google email not verified');
  }

  // 2️⃣ Convert payload → Passport-style profile
  const profile = {
    id: payload.sub,
    displayName: payload.name,
    emails: [
      {
        value: payload.email,
        verified: payload.email_verified,
      },
    ],
    name: {
      givenName: payload.given_name,
      familyName: payload.family_name,
    },
    photos: payload.picture ? [{ value: payload.picture }] : [],
  };

  // 3️⃣ Mobile-safe tokens object (never store Google tokens)
  const tokens = {
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: 'Bearer',
    scope: 'openid email profile',
    id_token: null,
  };

  // 4️⃣ Reuse existing logic
  return await findOrCreateGoogleUser(profile, tokens);
};

/**
 * Facebook helpers
 */
export const findOrCreateFacebookUser = async (profile, tokens) => {
  // 1️⃣ Check existing Facebook account
  const existingAccount = await findAccountByProvider('facebook', profile.id);

  if (existingAccount) {
    return existingAccount.user;
  }

  // 2️⃣ Try matching by email (if provided)
  const email = profile.emails?.[0]?.value ?? null;
  let user = null;

  if (email) {
    user = await findByEmail(email);
  }

  // 3️⃣ Create user if needed
  if (!user) {
    const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';

    const lastName =
      profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';

    const usernameBase =
      email?.split('@')[0] || `${firstName}${lastName}`.trim() || `fb_${profile.id}`;
    const username = await generateUniqueUsername(usernameBase);
    const phoneNumber = await generateUniquePhoneNumber();

    user = await createUser({
      email,
      phoneNumber,
      passwordHash: '', // oauth user
      firstName,
      lastName,
      username,
      name: profile.displayName || `${firstName} ${lastName}`.trim(),
      image: profile.photos?.[0]?.value || null,

      // ❗ Facebook email is NOT verified
      isEmailVerified: false,
      emailVerified: null,
    });
  }

  // 4️⃣ Link Facebook account (NO token persistence)
  await createAccount({
    userId: user.id,
    type: 'oauth',
    provider: 'facebook',
    providerAccountId: profile.id,

    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: 'Bearer',
    scope: null,
    id_token: null,

    providerData: JSON.stringify({
      id: profile.id,
      name: profile.displayName,
    }),
  });

  return user;
};

export const linkFacebookAccount = async (userId, profile, tokens) => {
  const existingAccount = await findAccountByProvider('facebook', profile.id);

  if (existingAccount) {
    if (existingAccount.userId === userId) {
      return await updateAccountTokens('facebook', profile.id, tokens);
    } else {
      throw new Error('This Facebook account is already linked to another user');
    }
  }

  const account = await createAccount({
    userId,
    type: 'oauth',
    provider: 'facebook',
    providerAccountId: profile.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope,
    id_token: tokens.id_token,
    providerData: JSON.stringify(profile),
  });

  return account;
};

const FB_GRAPH = 'https://graph.facebook.com/v18.0';

/* ------------------------------- */
/* App Access Token */
/* ------------------------------- */
const getFacebookAppAccessToken = async () => {
  const url =
    `${FB_GRAPH}/oauth/access_token` +
    `?client_id=${process.env.FACEBOOK_APP_ID}` +
    `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
    `&grant_type=client_credentials`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('Failed to obtain Facebook App access token');
  }

  return data.access_token;
};

/* ------------------------------- */
/* Verify User Token */
/* ------------------------------- */
export const verifyFacebookAccessTokenAndGetUser = async userAccessToken => {
  // 1️⃣ Validate token
  const appAccessToken = `${
    process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID
  }|${process.env.FB_APP_SECRET || process.env.FACEBOOK_APP_SECRET}`;

  console.log('Validating Facebook access token with app access token...', appAccessToken);
  const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
    userAccessToken
  )}&access_token=${encodeURIComponent(appAccessToken)}`;

  const debugRes = await fetch(debugUrl);
  const debugJson = await debugRes.json();

  // Better error logging
  if (!debugJson?.data?.is_valid) {
    console.error('Facebook token validation failed:', JSON.stringify(debugJson, null, 2));
    throw new Error(debugJson?.data?.error?.message || 'Invalid Facebook access token');
  }

  if (debugJson.data.app_id !== (process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID)) {
    throw new Error('Token not issued for this Facebook app');
  }

  // 2️⃣ Fetch user profile
  const profileUrl = `https://graph.facebook.com/me?fields=id,first_name,last_name,name,email,picture.type(large)&access_token=${encodeURIComponent(
    userAccessToken
  )}`;

  const profileRes = await fetch(profileUrl);
  const profileJson = await profileRes.json();

  if (!profileJson.id) {
    throw new Error('Failed to fetch Facebook profile');
  }

  // 3️⃣ Normalize profile
  const profile = {
    id: profileJson.id,
    displayName: profileJson.name,
    emails: profileJson.email ? [{ value: profileJson.email, verified: true }] : [],
    name: {
      givenName: profileJson.first_name || null,
      familyName: profileJson.last_name || null,
    },
    photos: profileJson.picture?.data?.url ? [{ value: profileJson.picture.data.url }] : [],
  };

  // 4️⃣ Do NOT store mobile token
  const tokens = {
    access_token: null,
    refresh_token: null,
    expires_at: debugJson.data.expires_at || null,
    token_type: 'Bearer',
    scope: null,
    id_token: null,
  };

  return await findOrCreateFacebookUser(profile, tokens);
};

/* ------------------------------- */
/* Verify Facebook JWT (iOS Limited Login) */
/* ------------------------------- */
export const verifyFacebookAuthenticationToken = async authToken => {
  try {
    // 1️⃣ Decode token to get header (kid)
    const decoded = jwt.decode(authToken, { complete: true });

    if (!decoded || !decoded.header || !decoded.header.kid) {
      throw new Error('Invalid JWT token format');
    }

    // 2️⃣ Get Facebook's JWKS (public keys)
    const client = jwksClient({
      jwksUri: 'https://limited.facebook.com/.well-known/oauth/openid/jwks/',
      timeout: 10000,
      cache: true,
      cacheMaxAge: 86400000, // 24 hours
    });

    const key = await client.getSigningKey(decoded.header.kid);
    const publicKey = key.getPublicKey();

    // 3️⃣ Verify JWT signature and claims
    const facebookAppId = process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID;
    const verified = jwt.verify(authToken, publicKey, {
      algorithms: ['RS256'],
      audience: facebookAppId,
      issuer: 'https://www.facebook.com',
    });

    // 4️⃣ Extract user info from JWT claims
    const profile = {
      id: verified.sub, // Facebook user ID
      displayName: verified.name || '',
      emails: verified.email ? [{ value: verified.email, verified: true }] : [],
      name: {
        givenName: verified.given_name || null,
        familyName: verified.family_name || null,
      },
      photos: verified.picture ? [{ value: verified.picture }] : [],
    };

    // 5️⃣ Prepare tokens metadata (JWT doesn't need storage)
    const tokens = {
      access_token: null,
      refresh_token: null,
      expires_at: verified.exp || null,
      token_type: 'Bearer',
      scope: null,
      id_token: authToken,
    };

    return await findOrCreateFacebookUser(profile, tokens);
  } catch (error) {
    console.error('Facebook JWT verification failed:', error.message);
    throw new Error(`Failed to verify Facebook authentication token: ${error.message}`);
  }
};

/**
 * Apple helpers
 */

export const findOrCreateAppleUser = async (idToken, tokens) => {
  // 1️⃣ Decode Apple ID token
  console.log('Apple ID Token--------------:', idToken);
  const decoded = jwt.decode(idToken);

  if (!decoded?.sub) {
    throw new Error('Invalid Apple ID token');
  }

  const appleId = decoded.sub; // ✅ stable Apple user ID
  const email = decoded.email ?? null;
  const emailVerified = decoded.email_verified === 'true';

  // 2️⃣ Check if Apple account already exists
  const existingAccount = await findAccountByProvider('apple', appleId);

  if (existingAccount) {
    if (tokens?.access_token) {
      await updateAccountTokens('apple', appleId, tokens);
    }
    return existingAccount.user;
  }

  // 3️⃣ Try finding user by email (only if email exists)
  let user = null;
  if (email) {
    user = await findByEmail(email);
  }

  // 4️⃣ Create user if not exists
  if (!user) {
    const username = await generateUniqueUsername(`apple_${crypto.randomUUID().slice(0, 8)}`);

    user = await createUser({
      email,
      phoneNumber: null,
      passwordHash: '',
      firstName: 'Apple',
      lastName: 'User',
      username,
      name: 'Apple User',
      image: null,
      isEmailVerified: emailVerified,
      emailVerified: emailVerified ? new Date() : null,
    });
  }

  // 5️⃣ Link Apple account
  await createAccount({
    userId: user.id,
    type: 'oauth',
    provider: 'apple',
    providerAccountId: appleId,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    expires_at: tokens.expires_at || null,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope || null,
    id_token: idToken,
    providerData: JSON.stringify({
      sub: appleId,
      email,
      emailVerified,
    }),
  });

  return user;
};

export const linkAppleAccount = async (userId, profile, tokens) => {
  const existingAccount = await findAccountByProvider('apple', profile.id);

  if (existingAccount) {
    if (existingAccount.userId === userId) {
      return await updateAccountTokens('apple', profile.id, tokens);
    } else {
      throw new Error('This Apple account is already linked to another user');
    }
  }

  const account = await createAccount({
    userId,
    type: 'oauth',
    provider: 'apple',
    providerAccountId: profile.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope,
    id_token: tokens.id_token,
    providerData: JSON.stringify(profile),
  });

  return account;
};

export const verifyAppleIdentityTokenAndGetUser = async identityToken => {
  if (!identityToken) {
    throw new Error('Apple identity token is required');
  }

  // ✅ Verify signature + claims using Apple JWKS
  const payload = await appleSignin.verifyIdToken(identityToken, {
    audience: [process.env.APPLE_WEB_CLIENT_ID, process.env.APPLE_MOBILE_CLIENT_ID],
    ignoreExpiration: false,
  });

  // payload example:
  // {
  //   sub, email, email_verified, is_private_email, aud, iss, exp
  // }

  const tokens = {
    access_token: null, // Apple mobile does not give this
    refresh_token: null,
    expires_at: payload.exp ?? null,
    token_type: 'Bearer',
    scope: null,
    id_token: null, // DO NOT store mobile id_token
  };

  // ✅ Use SAME logic as web
  return await findOrCreateAppleUser(identityToken, tokens);
};

export const exchangeAppleAuthorizationCodeAndGetUser = async code => {
  // Optionally implement server-side authorization code exchange with Apple token endpoint.
  // This requires generating a client_secret (JWT signed with APPLE_PRIVATE_KEY / APPLE_KEY_ID / APPLE_TEAM_ID).
  // TODO: Implement this helper when web server needs to exchange authorization codes.
  throw new Error('Authorization code exchange not implemented');
};
