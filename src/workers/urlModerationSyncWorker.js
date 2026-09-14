// Rebuilds the URL-moderation blocklist from all configured sources and
// publishes it to S3. Scheduled via pg-boss's schedule(), which guarantees a
// single job per cron tick cluster-wide — no separate leader-election needed,
// every API instance can safely call initUrlModerationSyncWorker().
import { getBoss } from '../lib/pgboss.js';
import { runLeaderSync } from '../services/urlModeration/scheduler.js';
import logger from '../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'urlModerationSyncWorker', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'urlModerationSyncWorker', ...meta }),
};

const QUEUE = 'url-moderation-sync';
const CRON = process.env.URL_MODERATION_SYNC_CRON || '0 * * * *'; // hourly by default

export async function initUrlModerationSyncWorker() {
  const boss = getBoss();

  await boss.createQueue(QUEUE);
  await boss.schedule(QUEUE, CRON);

  await boss.work(QUEUE, { teamSize: 1 }, async jobs => {
    for (const job of jobs) {
      try {
        await runLeaderSync();
        log.info('Blocklist sync completed', { jobId: job.id });
      } catch (err) {
        log.error('Blocklist sync failed', { jobId: job.id, error: err.message, stack: err.stack });
        throw err; // let pg-boss retry per its default policy
      }
    }
  });

  log.info('Worker registered', { queue: QUEUE, cron: CRON });
}
