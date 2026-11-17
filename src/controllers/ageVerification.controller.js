import httpStatus from 'http-status';
import { eq } from 'drizzle-orm';

import env from '../config/config.js';
import logger from '../config/logger.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import ApiError from '../utils/api-error.js';
import { catchAsync } from '../utils/catch-async.js';
import { DiditService } from '../services/didit.service.js';

const toStatus = user => {
  const underage = DiditService.isUnderage(user) && !user.isVerifiedAdult;
  const step = underage ? 'underage' : DiditService.currentKind(user);
  return {
    isVerifiedAdult: !!user.isVerifiedAdult,
    ageVerificationSource: user.ageVerificationSource ?? null,
    status: user.diditSessionStatus ?? null,
    // 'estimate' (selfie age check) | 'id' (ID document + selfie) |
    // 'underage' (selfie estimated under 18 — blocked, nothing to start)
    step,
    // Clickwrap the gate must show (and the user accept) before this step.
    consent: underage ? null : { kind: step, ...DiditService.CONSENT_TEXTS[step] },
    configured: env.didit.configured,
  };
};

async function loadUser(id) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/**
 * Where Didit sends the browser after the hosted flow. Built from the
 * request's Origin (already vetted by the CORS allow-list) so staging/local
 * frontends come back to themselves; falls back to FRONTEND_URL.
 * Kept as the bare origin + "/" so it matches the Redirect URL allow-list
 * in the Didit console exactly; Didit appends ?verificationSessionId=…,
 * which the web gate uses to start polling.
 */
function callbackUrlFor(req) {
  const base = req.headers.origin || process.env.FRONTEND_URL;
  if (!base) return undefined;
  try {
    return `${new URL(base).origin}/`;
  } catch {
    return undefined;
  }
}

// POST /api/age-verification/consent  { kind: 'estimate' | 'id' }
export const giveConsent = catchAsync(async (req, res) => {
  const user = await loadUser(req.user.id);
  if (user.isVerifiedAdult) {
    return res.json({ success: true, data: toStatus(user) });
  }

  const { kind } = req.body ?? {};
  if (!DiditService.KINDS.includes(kind)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid consent kind');
  }

  await DiditService.recordConsent(user, kind, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(httpStatus.CREATED).json({ success: true, data: toStatus(user) });
});

// POST /api/age-verification/session
export const startSession = catchAsync(async (req, res) => {
  const user = await loadUser(req.user.id);
  if (user.isVerifiedAdult) {
    return res.json({ success: true, data: { ...toStatus(user), url: null } });
  }

  const session = await DiditService.createSession(user, callbackUrlFor(req));
  res.status(httpStatus.CREATED).json({
    success: true,
    data: { url: session.url, status: session.status, step: session.kind, isVerifiedAdult: false },
  });
});

// GET /api/age-verification/status
export const getStatus = catchAsync(async (req, res) => {
  let user = await loadUser(req.user.id);
  try {
    user = await DiditService.refreshUserStatus(user);
  } catch (err) {
    // Provider hiccup — report the last known status rather than failing the gate.
    logger.warn(`[didit] status refresh failed for ${user.id}: ${err.message}`);
  }
  res.json({ success: true, data: toStatus(user) });
});

// POST /api/webhooks/didit  (raw body, no auth)
export const diditWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

  if (!DiditService.verifyWebhook(rawBody, req.headers)) {
    return res.status(httpStatus.UNAUTHORIZED).json({ error: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(httpStatus.BAD_REQUEST).json({ error: 'Invalid JSON' });
  }

  const { webhook_type: type, session_id: sessionId, vendor_data: userId } = event;
  if (type !== 'status.updated' || !sessionId || !userId) {
    return res.status(httpStatus.OK).json({ received: true, ignored: true });
  }

  try {
    // Re-fetch rather than trusting the payload: delivery order isn't
    // guaranteed, and the fetched decision is always the current state.
    let decision;
    try {
      decision = await DiditService.getDecision(sessionId);
    } catch (err) {
      // We purge sessions once decided, so a later webhook for the same
      // session finds nothing — its result is already applied.
      if (DiditService.isSessionGone(err)) {
        return res.status(httpStatus.OK).json({ received: true, ignored: true });
      }
      throw err;
    }
    if (decision?.vendor_data && decision.vendor_data !== userId) {
      logger.error(`[didit] webhook vendor_data mismatch for session ${sessionId}`);
      return res.status(httpStatus.OK).json({ received: true, ignored: true });
    }
    await DiditService.applySessionResult({
      userId,
      sessionId,
      status: decision?.status ?? event.status,
      decision: decision ?? event.decision,
    });
  } catch (err) {
    logger.error(`[didit] webhook processing failed for session ${sessionId}: ${err.message}`);
    // 5xx so Didit retries.
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Processing failed' });
  }

  res.status(httpStatus.OK).json({ received: true });
};
