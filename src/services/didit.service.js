import crypto from 'crypto';
import httpStatus from 'http-status';
import { and, desc, eq, gte } from 'drizzle-orm';

import env from '../config/config.js';
import logger from '../config/logger.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { ageVerificationConsents } from '../db/schema/ageVerificationConsents.js';
import ApiError from '../utils/api-error.js';

const MIN_AGE_YEARS = 18;
const WEBHOOK_TOLERANCE_SECONDS = 300;
// A consent only covers a verification started shortly after it was given —
// the clickwrap must sit right before the camera turns on.
const CONSENT_VALID_MS = 30 * 60 * 1000;

// Statuses after which Didit will not change the session on its own —
// no point re-fetching them from the status endpoint.
const FINAL_STATUSES = new Set(['Approved', 'Declined', 'Abandoned', 'Expired', 'Kyc Expired']);
// Outcomes we act on and then purge from Didit (when deleteSessions is on).
const DECIDED_STATUSES = new Set(['Approved', 'Declined']);

/**
 * Verification steps ("kinds"), each backed by its own Didit workflow:
 *  - 'estimate': selfie-only liveness + age estimation (no ID). An estimate
 *    of autoPassAge+ verifies the user; anything lower moves them to 'id'.
 *  - 'id': ID document + selfie face match. The document age must be 18+.
 */
export const KINDS = ['estimate', 'id'];

/**
 * Consent clickwrap copy, shown right before each step's camera opens and
 * stored verbatim with every acceptance. Bump the version on any wording
 * change.
 */
export const CONSENT_TEXTS = {
  // Client-specified wording, verbatim. Backed by: the ISO/IEC 27566-1 Didit
  // workflow (no biometric template stored), DIDIT_DELETE_SESSIONS purging
  // the session as soon as the result is recorded, and nothing biometric
  // ever stored on our servers.
  estimate: {
    version: 'estimate-v3',
    text:
      'I consent to the temporary scanning of my facial features solely to estimate my age. ' +
      'The biometric data is processed in-memory and deleted immediately.',
  },
  id: {
    version: 'id-v1',
    text:
      'I consent to my photo ID and a selfie being processed solely to verify my age and confirm ' +
      'that the ID belongs to me. The images are processed by our verification partner, Didit, and ' +
      "deleted as soon as my verification is complete. They are never stored on Briteside's servers.",
  },
};

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
    const err = new ApiError(httpStatus.BAD_GATEWAY, 'Age verification provider error');
    err.diditStatus = res.status;
    err.diditBody = data;
    throw err;
  }
  return data;
}

// Didit only accepts a callback on the domains allow-listed for the
// application in its console (e.g. https://www.briteside.app), and answers
// 400 {"callback": [...]} for anything else — e.g. a localhost/staging
// frontend that isn't listed.
const isCallbackRejected = err => err?.diditStatus === 400 && !!err?.diditBody?.callback;

/** Didit no longer has the session — typically because we already purged it. */
export const isSessionGone = err => err?.diditStatus === 404;

/**
 * The step the user is on now. Without an estimation workflow configured
 * everyone goes straight to the ID check (the pre-estimation behaviour).
 */
export function currentKind(user) {
  if (user.ageVerificationStep === 'id_required' || !env.didit.estimateWorkflowId) return 'id';
  return 'estimate';
}

/** The selfie estimate put this user under 18 — they're blocked, no ID step, no retry. */
export const isUnderage = user => user.ageVerificationStep === 'underage';

function assertNotUnderage(user) {
  if (isUnderage(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You must be 18 or older to use Briteside');
  }
}

// Didit warning tags meaning "the estimate is below the minimum age"
// (e.g. AGE_BELOW_MINIMUM). The ISO/IEC 27566-1 template doesn't return the
// age itself, so the warning is how an under-18 decline is told apart from
// a liveness failure.
const UNDERAGE_WARNING = /AGE_BELOW_MINIMUM|BELOW_MINIMUM_AGE|UNDER_?AGE|MINOR_DETECTED/i;

function collectWarningTags(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => collectWarningTags(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/warning/i.test(k)) {
        asArray(v).forEach(w => out.push(typeof w === 'string' ? w : w?.risk || w?.tag || w?.code || ''));
      } else collectWarningTags(v, out);
    }
  }
  return out.filter(Boolean);
}

/** True when Didit declined the selfie because the estimate is under the minimum age. */
function isUnderageDecline(decision, age) {
  if (typeof age === 'number') return age < MIN_AGE_YEARS;
  return collectWarningTags(decision).some(t => UNDERAGE_WARNING.test(t));
}

function workflowFor(kind) {
  return kind === 'estimate' ? env.didit.estimateWorkflowId : env.didit.workflowId;
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
const minOrNull = nums => (nums.length > 0 ? Math.min(...nums) : null);

/** Age read from the ID document(s). Handles v3 plural arrays and older singular objects. */
export function extractDocumentAge(decision) {
  if (!decision) return null;
  const idChecks = [...asArray(decision.id_verifications), ...asArray(decision.id_verification)];
  return minOrNull(
    idChecks
      .map(c => (typeof c?.age === 'number' ? c.age : c?.date_of_birth ? ageFromDob(c.date_of_birth) : null))
      .filter(a => typeof a === 'number')
  );
}

/** True when the session ran an ID document check (e.g. Didit's in-flow age fallback). */
export function hasIdCheck(decision) {
  if (!decision) return false;
  return [...asArray(decision.id_verifications), ...asArray(decision.id_verification)].length > 0;
}

/** Age estimated from the selfie by the liveness step. */
export function extractEstimatedAge(decision) {
  if (!decision) return null;
  const liveness = [...asArray(decision.liveness_checks), ...asArray(decision.liveness)];
  return minOrNull(liveness.map(c => c?.age_estimation).filter(a => typeof a === 'number'));
}

/** A document age wins over a selfie estimate; null when the workflow produced no age. */
export function extractVerifiedAge(decision) {
  return extractDocumentAge(decision) ?? extractEstimatedAge(decision);
}

/**
 * Which workflow a session belongs to: what we stored when creating it,
 * else the metadata we sent Didit, else its workflow id. Sessions created
 * before the estimation step existed carry none of these → 'id'.
 */
function sessionKindFor(user, sessionId, decision) {
  if (user.diditSessionId === sessionId && KINDS.includes(user.diditSessionKind)) {
    return user.diditSessionKind;
  }
  if (KINDS.includes(decision?.metadata?.step)) return decision.metadata.step;
  if (env.didit.estimateWorkflowId && decision?.workflow_id === env.didit.estimateWorkflowId) {
    return 'estimate';
  }
  return 'id';
}

/** Permanently remove a session (images, face data) from Didit. Never throws. */
export async function deleteSession(sessionId) {
  if (!env.didit.deleteSessions || !sessionId) return;
  try {
    await diditRequest('DELETE', `/v3/session/${encodeURIComponent(sessionId)}/delete/`);
    logger.info(`[didit] purged session ${sessionId}`);
  } catch (err) {
    if (isSessionGone(err)) return;
    // Didit's retention window still deletes it eventually; log for follow-up.
    logger.error(`[didit] failed to purge session ${sessionId}: ${err.message}`);
  }
}

/** Outcome of a selfie age-estimation session. */
function estimateUpdate({ user, sessionId, status, decision, isCurrentSession }) {
  // A late webhook for an old estimate must never undo a finished verification.
  if (user.isVerifiedAdult || !isCurrentSession) return {};
  // Nobody manually reviews selfie estimates (e.g. Didit flags a too-dark or
  // too-bright selfie for review) — don't leave the user waiting; the ID
  // step decides instead.
  if (status === 'In Review') {
    logger.info(`[didit] session ${sessionId}: estimate In Review, ID required`);
    return {
      ageVerificationStep: 'id_required',
      diditSessionId: null,
      diditSessionStatus: null,
      diditSessionKind: null,
    };
  }
  if (!DECIDED_STATUSES.has(status)) {
    return { diditSessionId: sessionId, diditSessionStatus: status, diditSessionKind: 'estimate' };
  }

  const age = extractEstimatedAge(decision);

  // Didit's in-flow ID fallback ("Additional verification for ages within a
  // range"): estimates in the borderline band (e.g. 13–22) are asked for an
  // ID + face match inside the same session. When that ran, the document age
  // decides — never the estimate.
  if (hasIdCheck(decision)) {
    const docAge = extractDocumentAge(decision);
    if (status === 'Approved' && docAge !== null && docAge >= MIN_AGE_YEARS) {
      logger.info(`[didit] session ${sessionId}: estimate + ID fallback Approved, verified`);
      return {
        isVerifiedAdult: true,
        ageVerificationSource: 'didit',
        ageVerificationStep: null,
        diditSessionId: sessionId,
        diditSessionStatus: 'Approved',
        diditSessionKind: 'estimate',
      };
    }
    // The user already tried an ID in this flow and it didn't prove 18+.
    // Retry on the ID-only workflow; the gate shows "couldn't verify".
    logger.info(
      `[didit] session ${sessionId}: ID fallback ${status} (docAge=${docAge}), ID retry required`
    );
    return {
      ageVerificationStep: 'id_required',
      diditSessionId: sessionId,
      diditSessionStatus: 'Declined',
      diditSessionKind: 'estimate',
    };
  }

  // Selfie only. The workflow's own approve threshold is the auto-pass age
  // (Didit console: "APPROVED >= 23"), so Approved means 23+. The ISO/IEC
  // 27566-1 template may return only that decision, not the number; when a
  // number does come back it must agree.
  const passed = status === 'Approved' && (age === null || age >= env.didit.autoPassAge);
  if (passed) {
    logger.info(`[didit] session ${sessionId}: estimate Approved (age=${age}), verified`);
    return {
      isVerifiedAdult: true,
      ageVerificationSource: 'didit_estimate',
      ageVerificationStep: null,
      diditSessionId: sessionId,
      diditSessionStatus: 'Approved',
      diditSessionKind: 'estimate',
    };
  }

  // Estimated under 18 (Didit console: "DECLINED < 18"): declined outright,
  // no ID step and no retry.
  if (status === 'Declined' && isUnderageDecline(decision, age)) {
    logger.info(`[didit] session ${sessionId}: estimate under 18 (age=${age}), blocked`);
    return {
      ageVerificationStep: 'underage',
      diditSessionId: sessionId,
      diditSessionStatus: 'Declined',
      diditSessionKind: 'estimate',
    };
  }

  // Under the auto-pass age with no in-flow fallback (or the fallback is
  // switched off), or a selfie Didit couldn't estimate at all (failed
  // liveness, no face). The ID-only workflow makes the final call. The
  // estimate session is done with; clear it so the gate starts fresh on the
  // ID step.
  logger.info(
    `[didit] session ${sessionId}: estimate ${status} (age=${age}, warnings=${collectWarningTags(decision).join(',') || 'none'}), ID required`
  );
  return {
    ageVerificationStep: 'id_required',
    diditSessionId: null,
    diditSessionStatus: null,
    diditSessionKind: null,
  };
}

/** Outcome of an ID document + selfie session. */
function idUpdate({ user, sessionId, status, decision, isCurrentSession }) {
  if (status === 'Approved') {
    const age = extractDocumentAge(decision);
    if (age !== null && age >= MIN_AGE_YEARS) {
      return {
        isVerifiedAdult: true,
        ageVerificationSource: 'didit',
        ageVerificationStep: null,
        diditSessionId: sessionId,
        diditSessionStatus: 'Approved',
        diditSessionKind: 'id',
      };
    }
    // Approved by the workflow but no document proof of 18+ — treat as a
    // decline so a misconfigured workflow can never let a minor in.
    logger.warn(
      `[didit] session ${sessionId} approved without 18+ document age (age=${age}); not verifying user ${user.id}`
    );
    return isCurrentSession
      ? { diditSessionId: sessionId, diditSessionStatus: 'Declined', diditSessionKind: 'id' }
      : {};
  }

  if (!isCurrentSession) return {};
  const update = { diditSessionId: sessionId, diditSessionStatus: status, diditSessionKind: 'id' };
  // A later Declined on that same session (e.g. a manual review reversal)
  // revokes a Didit-sourced verification.
  if (status === 'Declined' && user.isVerifiedAdult && user.ageVerificationSource === 'didit') {
    update.isVerifiedAdult = false;
    update.ageVerificationSource = 'pending';
  }
  return update;
}

/**
 * Persist a session outcome on the user, then purge decided sessions from
 * Didit so no selfie/ID images or face data outlive the check.
 */
export async function applySessionResult({ userId, sessionId, status, decision }) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    logger.warn(`[didit] session ${sessionId} references unknown user ${userId}`);
    return null;
  }

  const isCurrentSession = !user.diditSessionId || user.diditSessionId === sessionId;
  const kind = sessionKindFor(user, sessionId, decision);
  const args = { user, sessionId, status, decision, isCurrentSession };
  const update = kind === 'estimate' ? estimateUpdate(args) : idUpdate(args);

  let result = user;
  if (Object.keys(update).length > 0) {
    [result] = await db.update(users).set(update).where(eq(users.id, userId)).returning();
  }

  // Purge once decided — and selfie estimates sent to review, which we've
  // just routed to the ID step instead.
  if (DECIDED_STATUSES.has(status) || (kind === 'estimate' && status === 'In Review')) {
    await deleteSession(sessionId);
  }
  return result;
}

/** Record a consent clickwrap acceptance for the user's current step. */
export async function recordConsent(user, kind, { ipAddress, userAgent } = {}) {
  assertNotUnderage(user);
  if (kind !== currentKind(user)) {
    throw new ApiError(httpStatus.CONFLICT, 'Consent does not match the current verification step');
  }
  const { version, text } = CONSENT_TEXTS[kind];
  await db.insert(ageVerificationConsents).values({
    userId: user.id,
    kind,
    textVersion: version,
    consentText: text,
    ipAddress: ipAddress?.slice(0, 64) ?? null,
    userAgent: userAgent ?? null,
  });
}

async function hasRecentConsent(userId, kind) {
  const since = new Date(Date.now() - CONSENT_VALID_MS);
  const row = await db.query.ageVerificationConsents.findFirst({
    where: and(
      eq(ageVerificationConsents.userId, userId),
      eq(ageVerificationConsents.kind, kind),
      eq(ageVerificationConsents.textVersion, CONSENT_TEXTS[kind].version),
      gte(ageVerificationConsents.createdAt, since)
    ),
    orderBy: [desc(ageVerificationConsents.createdAt)],
  });
  return !!row;
}

/**
 * Start (or resume — Didit returns the unfinished session for the same
 * workflow + vendor_data) a hosted verification session for the user's
 * current step. Requires a fresh consent for that step.
 */
export async function createSession(user, callbackUrl) {
  assertConfigured();
  assertNotUnderage(user);

  const kind = currentKind(user);
  if (!(await hasRecentConsent(user.id, kind))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Please accept the consent before starting verification');
  }

  const body = {
    workflow_id: workflowFor(kind),
    vendor_data: user.id,
    metadata: { purpose: 'age_verification', step: kind },
  };

  let session;
  try {
    session = await diditRequest(
      'POST',
      '/v3/session/',
      callbackUrl ? { ...body, callback: callbackUrl } : body
    );
  } catch (err) {
    if (!callbackUrl || !isCallbackRejected(err)) throw err;
    // Don't block verification over the return URL: start the session
    // without one. Didit then shows its own completion page and the user
    // returns to the app themselves ("I already finished verifying" on the
    // web gate / status polling picks up the result). Add this origin to the
    // Didit console's allowed domains to get the automatic redirect back.
    logger.warn(
      `[didit] callback ${callbackUrl} not allow-listed in Didit; creating session without it`
    );
    session = await diditRequest('POST', '/v3/session/', body);
  }

  await db
    .update(users)
    .set({
      diditSessionId: session.session_id,
      diditSessionStatus: session.status || 'Not Started',
      diditSessionKind: kind,
    })
    .where(eq(users.id, user.id));

  return { sessionId: session.session_id, url: session.url, status: session.status, kind };
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

  let decision;
  try {
    decision = await getDecision(user.diditSessionId);
  } catch (err) {
    if (isSessionGone(err)) return user; // already applied and purged
    throw err;
  }
  if (!decision?.status) return user;
  if (decision.vendor_data && decision.vendor_data !== user.id) {
    logger.error(`[didit] session ${user.diditSessionId} vendor_data mismatch for user ${user.id}`);
    return user;
  }
  return (
    (await applySessionResult({
      userId: user.id,
      sessionId: user.diditSessionId,
      status: decision.status,
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
  KINDS,
  CONSENT_TEXTS,
  currentKind,
  isUnderage,
  recordConsent,
  createSession,
  getDecision,
  deleteSession,
  refreshUserStatus,
  applySessionResult,
  verifyWebhook,
  isSessionGone,
  extractVerifiedAge,
  extractDocumentAge,
  extractEstimatedAge,
};
