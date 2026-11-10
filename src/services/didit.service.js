import crypto from 'crypto';
import httpStatus from 'http-status';
import { eq } from 'drizzle-orm';

import env from '../config/config.js';
import logger from '../config/logger.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import ApiError from '../utils/api-error.js';

const MIN_AGE_YEARS = 18;
const WEBHOOK_TOLERANCE_SECONDS = 300;

// Statuses after which Didit will not change the session on its own —
// no point re-fetching them from the status endpoint.
const FINAL_STATUSES = new Set(['Approved', 'Declined', 'Abandoned', 'Expired', 'Kyc Expired']);

function assertConfigured() {
  if (!env.didit.configured) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Age verification is not configured');
  }
}

async function diditRequest(method, path, body) {
  const res = await fetch(`${env.didit.apiBaseUrl}${path}`, {
    method,
    headers: {
      'x-api-key': env.didit.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    logger.error(`[didit] ${method} ${path} failed: ${res.status} ${text?.slice(0, 500)}`);
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Age verification provider error');
  }
  return data;
}

function ageFromDob(dob) {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const m = today.getUTCMonth() - date.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

const asArray = v => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * The age Didit established for this session. A document age (ID check)
 * wins over a selfie age estimate. Handles both the v3 plural arrays and
 * the older singular objects. Returns null when the workflow produced no
 * age at all.
 */
export function extractVerifiedAge(decision) {
  if (!decision) return null;

  const idChecks = [...asArray(decision.id_verifications), ...asArray(decision.id_verification)];
  const docAges = idChecks
    .map(c => (typeof c?.age === 'number' ? c.age : c?.date_of_birth ? ageFromDob(c.date_of_birth) : null))
    .filter(a => typeof a === 'number');
  if (docAges.length > 0) return Math.min(...docAges);

  const liveness = [...asArray(decision.liveness_checks), ...asArray(decision.liveness)];
  const estimates = liveness
    .map(c => c?.age_estimation)
    .filter(a => typeof a === 'number');
  if (estimates.length > 0) return Math.min(...estimates);

  return null;
}

/**
 * Persist a session outcome on the user. Only an Approved session with an
 * age of 18+ verifies the user; a later Declined on that same session (e.g.
 * a manual review reversal) revokes a Didit-sourced verification.
 */
export async function applySessionResult({ userId, sessionId, status, decision }) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    logger.warn(`[didit] session ${sessionId} references unknown user ${userId}`);
    return null;
  }

  const isCurrentSession = !user.diditSessionId || user.diditSessionId === sessionId;
  const update = {};

  if (status === 'Approved') {
    const age = extractVerifiedAge(decision);
    if (age !== null && age >= MIN_AGE_YEARS) {
      Object.assign(update, {
        isVerifiedAdult: true,
        ageVerificationSource: 'didit',
        diditSessionId: sessionId,
        diditSessionStatus: 'Approved',
      });
    } else {
      // Approved by the workflow but no proof of 18+ — treat as a decline so
      // a misconfigured workflow can never let a minor (or no-age check) in.
      logger.warn(
        `[didit] session ${sessionId} approved without 18+ age (age=${age}); not verifying user ${userId}`
      );
      if (isCurrentSession) {
        Object.assign(update, { diditSessionId: sessionId, diditSessionStatus: 'Declined' });
      }
    }
  } else if (isCurrentSession) {
    update.diditSessionId = sessionId;
    update.diditSessionStatus = status;
    if (status === 'Declined' && user.isVerifiedAdult && user.ageVerificationSource === 'didit') {
      update.isVerifiedAdult = false;
      update.ageVerificationSource = 'pending';
    }
  }

  if (Object.keys(update).length === 0) return user;
  const [updated] = await db.update(users).set(update).where(eq(users.id, userId)).returning();
  return updated;
}

/**
 * Start (or resume — Didit returns the unfinished session for the same
 * workflow + vendor_data) a hosted verification session for the user.
 */
export async function createSession(user, callbackUrl) {
  assertConfigured();

  const session = await diditRequest('POST', '/v3/session/', {
    workflow_id: env.didit.workflowId,
    vendor_data: user.id,
    ...(callbackUrl ? { callback: callbackUrl } : {}),
    metadata: { purpose: 'age_verification' },
  });

  await db
    .update(users)
    .set({ diditSessionId: session.session_id, diditSessionStatus: session.status || 'Not Started' })
    .where(eq(users.id, user.id));

  return { sessionId: session.session_id, url: session.url, status: session.status };
}

export async function getDecision(sessionId) {
  assertConfigured();
  return diditRequest('GET', `/v3/session/${encodeURIComponent(sessionId)}/decision/`);
}

/**
 * Pull the latest decision for the user's current session from Didit and
 * apply it. Used by the status endpoint so the gate works even if the
 * webhook is delayed or not configured (e.g. local dev).
 */
export async function refreshUserStatus(user) {
  if (user.isVerifiedAdult || !user.diditSessionId || !env.didit.configured) return user;
  if (FINAL_STATUSES.has(user.diditSessionStatus)) return user;

  const decision = await getDecision(user.diditSessionId);
  if (!decision?.status) return user;
  if (decision.vendor_data && decision.vendor_data !== user.id) {
    logger.error(`[didit] session ${user.diditSessionId} vendor_data mismatch for user ${user.id}`);
    return user;
  }
  return (
    (await applySessionResult({
      userId: user.id,
      sessionId: user.diditSessionId,
      status: decision?.status,
      decision,
    })) || user
  );
}

// ── Webhook signature ───────────────────────────────────────────────────────

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeysDeep(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function hmacHex(payload) {
  return crypto.createHmac('sha256', env.didit.webhookSecret).update(payload).digest('hex');
}

function safeEqualHex(expected, received) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received.trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verifies a Didit webhook: timestamp freshness, then X-Signature (HMAC of
 * the raw bytes) or X-Signature-V2 (HMAC of key-sorted compact JSON), each
 * also accepted in its "-Previous" form during secret rotation.
 */
export function verifyWebhook(rawBody, headers) {
  if (!env.didit.webhookSecret) {
    logger.error('[didit] webhook received but DIDIT_WEBHOOK_SECRET is not set');
    return false;
  }

  const timestamp = Number(headers['x-timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const rawExpected = hmacHex(rawBody);
  if (
    safeEqualHex(rawExpected, headers['x-signature']) ||
    safeEqualHex(rawExpected, headers['x-signature-previous'])
  ) {
    return true;
  }

  const v2 = headers['x-signature-v2'] || headers['x-signature-v2-previous'];
  if (v2) {
    try {
      const canonical = JSON.stringify(sortKeysDeep(JSON.parse(rawBody.toString('utf8'))));
      const v2Expected = hmacHex(canonical);
      if (
        safeEqualHex(v2Expected, headers['x-signature-v2']) ||
        safeEqualHex(v2Expected, headers['x-signature-v2-previous'])
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export const DiditService = {
  createSession,
  getDecision,
  refreshUserStatus,
  applySessionResult,
  verifyWebhook,
  extractVerifiedAge,
};
