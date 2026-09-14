import 'dotenv/config.js';
import z from 'zod';

import logger from './logger.js';

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
  // Apple Sign In
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.string().optional(),
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
    secretKey: envVars.STRIPE_SECRET_KEY_LOCAL || envVars.STRIPE_SECRET_KEY,
    publishableKey: envVars.STRIPE_PUBLISHABLE_KEY,
    // STRIPE_WEBHOOK_SECRET_LOCAL takes precedence in dev to override the prod secret from AWS
    webhookSecret: envVars.STRIPE_WEBHOOK_SECRET_LOCAL || envVars.STRIPE_WEBHOOK_SECRET,
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
};

export default env;
