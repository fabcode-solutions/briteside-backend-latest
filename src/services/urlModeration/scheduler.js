import { getSnapshot, publish } from './blocklistManager.js';
import { readPointer, downloadSnapshot } from './snapshotStore.js';
import { buildSnapshot } from './blocklistSync.js';
import logger from '../../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'urlModeration:scheduler', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'urlModeration:scheduler', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'urlModeration:scheduler', ...meta }),
};

/**
 * Cheap, safe to run on every instance on a short interval: checks the small
 * S3 pointer and only pulls the full snapshot when the version changed.
 * @returns {Promise<boolean>} whether a new snapshot was loaded
 */
export async function refreshFromS3IfNewer() {
  const pointer = await readPointer();
  if (!pointer) return false;

  const current = getSnapshot();
  if (current && current.version === pointer.version) return false;

  const snapshot = await downloadSnapshot(pointer.key);
  publish(snapshot);
  log.info('Loaded snapshot from S3', {
    version: snapshot.version,
    domainCount: snapshot.domainMap.size,
    keywordCount: snapshot.keywordMap.size,
  });
  return true;
}

/**
 * Runs on the elected leader only (see workers/urlModerationSyncWorker.js —
 * pg-boss's schedule() guarantees a single run cluster-wide per cron tick).
 * Fetches every source fresh, then publishes to S3 for every instance to pick up.
 */
export async function runLeaderSync() {
  const snapshot = await buildSnapshot();
  if (!snapshot) return; // buildSnapshot already logged why; keep the previous published snapshot
  const { uploadSnapshot } = await import('./snapshotStore.js');
  await uploadSnapshot(snapshot);
  publish(snapshot); // the leader also uses its own freshly-built result immediately
}

/**
 * Called once at server startup, before the process accepts traffic.
 * S3 first (fast, shared); falls back to a local build only if nothing has
 * ever been published yet (first-ever deploy) or S3 is unreachable.
 */
export async function bootstrap() {
  try {
    const loaded = await refreshFromS3IfNewer();
    if (loaded) return;
  } catch (err) {
    log.warn('S3 bootstrap load failed, falling back to a local build', { error: err.message });
  }

  if (getSnapshot()) return;

  log.info('No snapshot published yet — building locally for this instance');
  const snapshot = await buildSnapshot();
  if (!snapshot) {
    throw new Error('Unable to build an initial URL-moderation snapshot — all sources failed');
  }
  publish(snapshot);
}
