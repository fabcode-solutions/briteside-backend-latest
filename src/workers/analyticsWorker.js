import { getBoss } from '../lib/pgboss.js';
import { ANALYTICS_TRACK_QUEUE, insertTrackBatch } from '../services/analyticsIngest.service.js';
import logger from '../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'analyticsWorker', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'analyticsWorker', ...meta }),
};

async function processJob(job) {
  if (!job.data) {
    log.error('Job has no data — likely a stale job from before queue was created', {
      jobId: job.id,
    });
    return;
  }

  try {
    await insertTrackBatch(job.data);
  } catch (err) {
    log.error('Job failed', { jobId: job.id, error: err.message, stack: err.stack });
    throw err;
  }
}

export async function initAnalyticsWorker() {
  const boss = getBoss();

  // pg-boss v10+ requires queue to exist before workers can subscribe
  await boss.createQueue(ANALYTICS_TRACK_QUEUE);

  // pg-boss v12 passes an array of jobs to the handler — process each independently
  await boss.work(ANALYTICS_TRACK_QUEUE, { teamSize: 10 }, async jobs => {
    await Promise.allSettled(jobs.map(job => processJob(job)));
  });

  log.info('Worker registered', { queue: ANALYTICS_TRACK_QUEUE });
}
