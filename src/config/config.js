import 'dotenv/config.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import z from 'zod';

import logger from './logger.js';

// Raw values from the .env file only (AWS secrets can't overwrite these)
let fileEnv = {};
try {
  fileEnv = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env')));
} catch (e) {
  fileEnv = {};
}

const EnvVariables = z.object({
  PORT: z.preprocess(a => +a, z.number().optional().default(5000)),
  POSTGRESQL_HOST: z.string(),
  POSTGRESQL_PORT: z.preprocess(a => +a, z.number().optional().default(5432)),
  POSTGRESQL_DB_NAME: z.string(),
  POSTGRESQL_USER: z.string(),
  POSTGRESQL_PASSWORD: z.string(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ACCESS_EXPIRATION_MINUTES: z.preprocess(a => +a, z.number().default(30)),
  JWT_REFRESH_EXPIRATION_DAYS: z.preprocess(a => +a, z.number().default(30)),
  JWT_RESET_PASSWORD_EXPIRATION_MINUTES: z.preprocess(a => +a, z.number().default(10)),
  JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: z.preprocess(a => +a, z.number().default(10)),
  GMAIL_EMAIL: z.string(),
  GMAIL_APP_PASSWORD: z.string(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_SECRET_KEY_LOCAL: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY_LOCAL: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_WEBHOOK_SECRET_LOCAL: z.string().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_CALLBACK_URL: z.string(),
  // Facebook OAuth
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_CALLBACK_URL: z.string().optional(),
  FACEBOOK_CLIENT_TOKEN: z.string().optional(),
  // Apple Sign In
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.string().optional(),

  // Apple In-App Purchase — App Store Server API (transaction verification)
  APPLE_IAP_ISSUER_ID: z.string().optional(),
  APPLE_IAP_KEY_ID: z.string().optional(),
  APPLE_IAP_BUNDLE_ID: z.string().optional(),
  APPLE_IAP_ENVIRONMENT: z.enum(['Sandbox', 'Production']).optional().default('Sandbox'),
  APPLE_IAP_PRIVATE_KEY: z.string().optional(),
  // App Store Connect API (automatic in-app-purchase product registration) —
  // a separate key pair/scope from the App Store Server API above.
  APPLE_ASC_KEY_ID: z.string().optional(),
  APPLE_ASC_PRIVATE_KEY: z.string().optional(),
  APPLE_ASC_APP_ID: z.string().optional(),

  // Google Play In-App Purchase — Play Developer API (service account)
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // Pub/Sub push auth for Play Real-time Developer Notifications: the push
  // subscription's OIDC audience and the service account it signs as.
  GOOGLE_PLAY_RTDN_AUDIENCE: z.string().optional(),
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT: z.string().optional(),
  // ISO date. Once the App build that tags purchases with the buyer is out,
  // purchases made after this without that tag are refused.
  IAP_ACCOUNT_TOKEN_REQUIRED_FROM: z.string().datetime({ offset: true }).optional(),

  // Firebase Cloud Messaging — service-account JSON for push notifications (optional)
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // ACRCloud — audio fingerprint matching for copyright scans
  ACRCLOUD_HOST: z.string().optional(),
  ACRCLOUD_ACCESS_KEY: z.string().optional(),
  ACRCLOUD_ACCESS_SECRET: z.string().optional(),

  // Imported event listings (src/services/externalEvents). Each source only
  // syncs when its key is set.
  TICKETMASTER_API_KEY: z.string().optional(),
  // Optional affiliate wrapper for Ticketmaster links; "{url}" is replaced
  // with the URL-encoded event URL.
  TICKETMASTER_AFFILIATE_URL_TEMPLATE: z.string().optional(),
  VENUNITE_API_KEY: z.string().optional(),
  // VenuNite lookahead override — the REST trial only serves the next 30 days.
  VENUNITE_DAYS_AHEAD: z.preprocess(
    a => (a === undefined ? undefined : +a),
    z.number().int().min(1).optional()
  ),
  // Rows per VenuNite request: 100 on paid plans, 25 on the REST trial.
  VENUNITE_PAGE_SIZE: z.preprocess(
    a => (a === undefined ? undefined : +a),
    z.number().int().min(1).max(100).optional().default(100)
  ),
  // Comma-separated USPS state codes to import, e.g. "CT" or "CT,NY"
  EXTERNAL_EVENTS_STATES: z.string().optional().default('CT'),
  EXTERNAL_EVENTS_DAYS_AHEAD: z.preprocess(
    a => (a === undefined ? undefined : +a),
    z.number().optional().default(90)
  ),
  // Existing organizer that owns imported events. When unset a dedicated
  // system organizer is created on the first sync.
  EXTERNAL_EVENTS_ORGANIZER_ID: z.string().uuid().optional(),
  // Cover used when a listing has no image (events need at least one).
  // Listings without an image are skipped when this is unset.
  EXTERNAL_EVENTS_DEFAULT_IMAGE: z.string().optional(),
});

let envVars;

try {
  envVars = EnvVariables.parse(process.env);
} catch (error) {
  logger.error(`Env validation error: ${error}`);
  process.exit(1);
}

const env = {
  nodeEnv: process.env.NODE_ENV,
  apiHost: process.env.API_HOST,
  port: envVars.PORT,
  db: {
    host: envVars.POSTGRESQL_HOST,
    port: envVars.POSTGRESQL_PORT,
    database: envVars.POSTGRESQL_DB_NAME,
    user: envVars.POSTGRESQL_USER,
    password: envVars.POSTGRESQL_PASSWORD,
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  gmail: {
    email: envVars.GMAIL_EMAIL,
    appPassword: envVars.GMAIL_APP_PASSWORD,
  },
  stripe: {
    secretKey:
      fileEnv.STRIPE_SECRET_KEY_LOCAL ||
      envVars.STRIPE_SECRET_KEY_LOCAL ||
      envVars.STRIPE_SECRET_KEY,

    publishableKey:
      fileEnv.STRIPE_PUBLISHABLE_KEY_LOCAL ||
      envVars.STRIPE_PUBLISHABLE_KEY_LOCAL ||
      envVars.STRIPE_PUBLISHABLE_KEY,

    webhookSecret:
      fileEnv.STRIPE_WEBHOOK_SECRET_LOCAL ||
      envVars.STRIPE_WEBHOOK_SECRET_LOCAL ||
      envVars.STRIPE_WEBHOOK_SECRET,
  },
  google: {
    clientId: envVars.GOOGLE_CLIENT_ID,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET,
    callbackUrl: envVars.GOOGLE_CALLBACK_URL,
  },
  facebook: {
    appId: envVars.FACEBOOK_APP_ID,
    appSecret: envVars.FACEBOOK_APP_SECRET,
    callbackUrl: envVars.FACEBOOK_CALLBACK_URL,
    clientToken: envVars.FACEBOOK_CLIENT_TOKEN,
  },
  apple: {
    teamId: envVars.APPLE_TEAM_ID,
    keyId: envVars.APPLE_KEY_ID,
    clientId: envVars.APPLE_CLIENT_ID,
    privateKey: envVars.APPLE_PRIVATE_KEY,
    callbackUrl: envVars.APPLE_CALLBACK_URL,
  },
  appleIap: {
    issuerId: envVars.APPLE_IAP_ISSUER_ID,
    keyId: envVars.APPLE_IAP_KEY_ID,
    bundleId: envVars.APPLE_IAP_BUNDLE_ID,
    environment: envVars.APPLE_IAP_ENVIRONMENT,
    // .env stores this with literal \n escapes (real newlines inside a .env
    // value are unreliable across parsers) — unescape back to a real PEM.
    privateKey: envVars.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ascKeyId: envVars.APPLE_ASC_KEY_ID,
    ascPrivateKey: envVars.APPLE_ASC_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ascAppId: envVars.APPLE_ASC_APP_ID,
    configured: !!(
      envVars.APPLE_IAP_ISSUER_ID &&
      envVars.APPLE_IAP_KEY_ID &&
      envVars.APPLE_IAP_PRIVATE_KEY
    ),
  },
  googleIap: {
    packageName: envVars.GOOGLE_PLAY_PACKAGE_NAME,
    serviceAccountJson: envVars.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    rtdnPushAudience: envVars.GOOGLE_PLAY_RTDN_AUDIENCE,
    rtdnPushServiceAccount: envVars.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT,
    configured: !!(envVars.GOOGLE_PLAY_PACKAGE_NAME && envVars.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
  },
  iap: {
    accountTokenRequiredFrom: envVars.IAP_ACCOUNT_TOKEN_REQUIRED_FROM
      ? new Date(envVars.IAP_ACCOUNT_TOKEN_REQUIRED_FROM)
      : null,
  },
  firebase: {
    serviceAccountJson: envVars.FIREBASE_SERVICE_ACCOUNT_JSON,
    configured: !!envVars.FIREBASE_SERVICE_ACCOUNT_JSON,
  },
  acrcloud: {
    host: envVars.ACRCLOUD_HOST,
    accessKey: envVars.ACRCLOUD_ACCESS_KEY,
    accessSecret: envVars.ACRCLOUD_ACCESS_SECRET,
    configured: !!(
      envVars.ACRCLOUD_HOST &&
      envVars.ACRCLOUD_ACCESS_KEY &&
      envVars.ACRCLOUD_ACCESS_SECRET
    ),
  },
  externalEvents: {
    ticketmasterApiKey: envVars.TICKETMASTER_API_KEY,
    ticketmasterAffiliateUrlTemplate: envVars.TICKETMASTER_AFFILIATE_URL_TEMPLATE,
    venuniteApiKey: envVars.VENUNITE_API_KEY,
    venunitePageSize: envVars.VENUNITE_PAGE_SIZE,
    venuniteDaysAhead: envVars.VENUNITE_DAYS_AHEAD,
    states: envVars.EXTERNAL_EVENTS_STATES.split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean),
    daysAhead: envVars.EXTERNAL_EVENTS_DAYS_AHEAD,
    organizerId: envVars.EXTERNAL_EVENTS_ORGANIZER_ID,
    defaultImage: envVars.EXTERNAL_EVENTS_DEFAULT_IMAGE,
    configured: !!(envVars.TICKETMASTER_API_KEY || envVars.VENUNITE_API_KEY),
  },
};

// Missing store settings don't stop the server (IAP endpoints answer 503),
// but in production a buyer can be charged by the store and then stay
// unconfirmed — say so loudly at boot.
if (env.nodeEnv === 'production') {
  const missingIap = [
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_KEY_ID',
    'APPLE_IAP_PRIVATE_KEY',
    'APPLE_IAP_BUNDLE_ID',
    'APPLE_ASC_APP_ID',
    'GOOGLE_PLAY_PACKAGE_NAME',
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
  ].filter(key => !envVars[key]);
  if (missingIap.length > 0) {
    logger.error(`[config] In-app purchases are not fully configured — missing: ${missingIap.join(', ')}`);
  }
}

export default env;