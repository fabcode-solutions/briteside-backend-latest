// src/services/push.service.js
// Firebase Cloud Messaging fan-out to a user's registered devices
// (user_devices, registered by the app via POST /users/devices).
//
// Optional by design: without FIREBASE_SERVICE_ACCOUNT_JSON the service logs
// once and every send is a no-op, so local/dev environments without Firebase
// credentials keep working exactly as before.

import admin from 'firebase-admin';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userDevices } from '../db/schema/index.js';
import { getActiveDevicesForUser } from './userDevice.service.js';
import logger from '../config/logger.js';

// Must match the channel the app creates (hooks/useMessageAlerts.ts).
const ANDROID_MESSAGES_CHANNEL_ID = 'messages';

// FCM error codes meaning the token will never work again.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

let messaging = null;
let initAttempted = false;

/** Accepts the service-account JSON raw or base64-encoded. */
function parseServiceAccount(value) {
  const raw = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  const account = JSON.parse(raw);
  // Keys pasted into env vars often carry literal "\n" — restore real newlines.
  if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
  return account;
}

function getMessaging() {
  if (initAttempted) return messaging;
  initAttempted = true;

  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value) {
    logger.warn('[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled');
    return null;
  }
  try {
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(parseServiceAccount(value)) });
    messaging = app.messaging();
  } catch (err) {
    logger.error(`[push] Firebase init failed — push notifications disabled: ${err.message}`);
  }
  return messaging;
}

/** FCM data values must all be strings. */
function toStringData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );
}

/**
 * Sends one push to every active device of `userId`. Never throws — a push
 * failure must not break the request that triggered it. Tokens FCM reports
 * as permanently invalid are deactivated so they aren't retried forever.
 */
export async function sendPushToUser(userId, { title, body, data } = {}) {
  const fcm = getMessaging();
  if (!fcm || !userId) return;

  try {
    const devices = await getActiveDevicesForUser(userId);
    const tokens = devices
      .filter(d => d.platform !== 'web' && d.notificationUid)
      .map(d => d.notificationUid);
    if (!tokens.length) return;

    const response = await fcm.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: toStringData(data),
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_MESSAGES_CHANNEL_ID, sound: 'default' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const deadTokens = response.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? tokens[i] : null))
      .filter(Boolean);
    if (deadTokens.length) {
      await db
        .update(userDevices)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(eq(userDevices.userId, userId), inArray(userDevices.notificationUid, deadTokens))
        );
    }
  } catch (err) {
    logger.warn(`[push] send to user ${userId} failed: ${err.message}`);
  }
}
