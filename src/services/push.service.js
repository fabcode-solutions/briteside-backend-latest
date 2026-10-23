/**
 * Push delivery (Firebase Cloud Messaging HTTP v1) for in-app notifications, so every
 * notification also shows as a system banner while the mobile app is backgrounded or closed.
 * Disabled unless FIREBASE_SERVICE_ACCOUNT_JSON is set. Callers fire-and-forget: a failed push
 * never affects the stored notification or the request that created it.
 */
import { GoogleAuth } from 'google-auth-library';
import { and, eq, inArray } from 'drizzle-orm';

import config from '../config/config.js';
import logger from '../config/logger.js';
import { db } from '../config/database.js';
import { userDevices } from '../db/schema/index.js';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const SEND_TIMEOUT_MS = 10_000;
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 240;

// Android channels created by the app (briteside-expo hooks/useMessageAlerts.ts and
// hooks/useNotificationAlerts.ts); Android falls back to a default channel if one is missing.
const MESSAGES_CHANNEL = 'messages';
const DEFAULT_CHANNEL = 'app_notifications';

// FCM error codes meaning the token will never work again, so the device is deactivated.
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'SENDER_ID_MISMATCH']);

let messagingClient; // undefined = not initialised yet, null = push disabled

const getMessagingClient = () => {
  if (messagingClient !== undefined) return messagingClient;
  if (!config.firebase.configured) {
    messagingClient = null;
    return messagingClient;
  }
  try {
    const credentials = JSON.parse(config.firebase.serviceAccountJson);
    if (!credentials?.project_id) throw new Error('missing project_id');
    messagingClient = {
      auth: new GoogleAuth({ credentials, scopes: [FCM_SCOPE] }),
      projectId: credentials.project_id,
    };
  } catch {
    // The parse error can echo part of the secret, so it is not logged.
    logger.error('[push] FIREBASE_SERVICE_ACCOUNT_JSON is invalid; push notifications disabled');
    messagingClient = null;
  }
  return messagingClient;
};

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** FCM data values must be strings; empty values are dropped. */
const toData = fields =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)])
  );

const buildMessage = notification => {
  const metadata = notification.metadata ?? {};
  const isChat = notification.type === 'chat_message';
  const title = truncate(String(notification.title ?? '').trim() || 'Briteside', MAX_TITLE_LENGTH);
  const body = truncate(String(notification.message ?? '').trim(), MAX_BODY_LENGTH);
  // Matches the identifier of the app's own socket-raised banner (msg-<messageId> for chat,
  // ntf-<notificationId> otherwise), so the OS replaces one with the other instead of showing two.
  const messageId = isChat ? (metadata.messageId ?? metadata.messageIds?.[0]) : null;
  const collapseId =
    typeof messageId === 'string' && messageId ? `msg-${messageId}` : `ntf-${notification.id}`;

  return {
    notification: { title, body },
    // Read by the app's tap handler (briteside-expo services/messagePush.ts).
    data: toData({
      notificationId: notification.id,
      type: notification.type,
      redirectTo: notification.redirectTo,
      conversationId: typeof metadata.conversationId === 'string' ? metadata.conversationId : '',
      isPriority: metadata.isPriority ? 'true' : '',
      paymentId: typeof metadata.paymentId === 'string' ? metadata.paymentId : '',
    }),
    android: {
      priority: 'HIGH',
      notification: {
        channel_id: isChat ? MESSAGES_CHANNEL : DEFAULT_CHANNEL,
        sound: 'default',
        tag: collapseId,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-collapse-id': collapseId,
      },
      payload: { aps: { sound: 'default' } },
    },
  };
};

const sendToToken = async (client, accessToken, token, message) => {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(client.projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { ...message, token } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );
  if (res.ok) return { ok: true };

  const payload = await res.json().catch(() => null);
  const fcmCode = payload?.error?.details?.find(detail => detail?.errorCode)?.errorCode;
  const code = fcmCode ?? payload?.error?.status ?? `HTTP_${res.status}`;
  const invalidToken =
    code === 'INVALID_ARGUMENT' && /registration token/i.test(payload?.error?.message ?? '');
  return { ok: false, code, dead: DEAD_TOKEN_CODES.has(code) || invalidToken };
};

/**
 * Sends a stored notification to all of its recipient's active mobile devices.
 * Resolves without throwing when push is disabled or the user has no devices.
 */
export const sendPushForNotification = async notification => {
  const client = getMessagingClient();
  if (!client || !notification?.userId || !notification.id) return;

  const devices = await db
    .select({ token: userDevices.notificationUid })
    .from(userDevices)
    .where(
      and(
        eq(userDevices.userId, notification.userId),
        eq(userDevices.isActive, true),
        inArray(userDevices.platform, ['ios', 'android'])
      )
    );
  const tokens = [...new Set(devices.map(device => device.token).filter(Boolean))];
  if (!tokens.length) return;

  const accessToken = await client.auth.getAccessToken();
  if (!accessToken) throw new Error('could not obtain an FCM access token');

  const message = buildMessage(notification);
  const results = await Promise.allSettled(
    tokens.map(token => sendToToken(client, accessToken, token, message))
  );

  const deadTokens = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(`[push] send failed: ${result.reason?.name ?? 'Error'}`);
    } else if (!result.value.ok) {
      if (result.value.dead) deadTokens.push(tokens[index]);
      else logger.warn(`[push] send failed: ${result.value.code}`);
    }
  });

  if (deadTokens.length) {
    // Scoped to this user, so a token can only be deactivated for the account it was sent for.
    await db
      .update(userDevices)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(userDevices.userId, notification.userId),
          inArray(userDevices.notificationUid, deadTokens)
        )
      );
  }
};
