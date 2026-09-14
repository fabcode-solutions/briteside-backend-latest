import { eq } from 'drizzle-orm';
import { getBoss } from '../lib/pgboss.js';
import { db } from '../db/index.js';
import { analyticsEvents, analyticsIdentityLinks, analyticsEventDefinitions } from '../db/schema/index.js';
import logger from '../config/logger.js';

export const ANALYTICS_TRACK_QUEUE = 'analytics.track';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'analyticsIngest', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'analyticsIngest', ...meta }),
};

// Populated lazily on first flag and cached for the process lifetime — this is
// an advisory alert list, not a hot path, so a small in-memory cache is fine.
let knownEventNamesCache = null;

async function isKnownEventName(eventName) {
  if (!knownEventNamesCache) {
    const rows = await db
      .select({ eventName: analyticsEventDefinitions.eventName })
      .from(analyticsEventDefinitions);
    knownEventNamesCache = new Set(rows.map(r => r.eventName));
  }
  return knownEventNamesCache.has(eventName);
}

/**
 * Enqueues a validated track batch for async processing. Returns immediately;
 * the actual insert happens in the analyticsWorker pg-boss consumer.
 */
export async function enqueueTrackBatch({ anonymousId, sessionId, events, userId, context }) {
  const boss = getBoss();
  const now = new Date();

  const jobData = {
    anonymousId: anonymousId ?? null,
    sessionId: sessionId ?? null,
    userId: userId ?? null,
    context: context ?? null,
    receivedAt: now.toISOString(),
    events,
  };

  await boss.send(ANALYTICS_TRACK_QUEUE, jobData);

  for (const evt of events) {
    isKnownEventName(evt.eventName).then(known => {
      if (!known) {
        log.warn('Unrecognized event name', { eventName: evt.eventName, entityType: evt.entityType });
      }
    });
  }
}

/**
 * Inserts one validated track batch, idempotently on clientEventId.
 * Called from the analyticsWorker pg-boss job handler.
 */
export async function insertTrackBatch(jobData) {
  const { anonymousId, sessionId, userId, context, receivedAt, events } = jobData;

  const rows = events.map(evt => ({
    eventName: evt.eventName,
    entityType: evt.entityType,
    entityId: evt.entityId ?? null,
    userId: userId ?? null,
    anonymousId: userId ? null : (anonymousId ?? null),
    sessionId: sessionId ?? null,
    clientEventId: evt.clientEventId,
    properties: evt.properties ?? {},
    context: context ?? null,
    occurredAt: new Date(evt.occurredAt),
    receivedAt: new Date(receivedAt),
  }));

  await db.insert(analyticsEvents).values(rows).onConflictDoNothing();
}

/**
 * Upserts an anonymousId -> userId link. Called on login and on any
 * authenticated /track call that also carries a known anonymousId.
 */
export async function linkAnonymousIdentity(anonymousId, userId) {
  if (!anonymousId || !userId) return;

  await db
    .insert(analyticsIdentityLinks)
    .values({ anonymousId, userId })
    .onConflictDoNothing();
}

export async function getLinkedAnonymousIds(userId) {
  const rows = await db
    .select({ anonymousId: analyticsIdentityLinks.anonymousId })
    .from(analyticsIdentityLinks)
    .where(eq(analyticsIdentityLinks.userId, userId));
  return rows.map(r => r.anonymousId);
}
