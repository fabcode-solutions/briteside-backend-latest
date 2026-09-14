import { getBoss } from '../lib/pgboss.js';
import {
  MediaModerationService,
  JOB_MODERATE_MEDIA,
} from '../services/moderation/mediaModeration.service.js';
import logger from '../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'moderationWorker', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'moderationWorker', ...meta }),
};

async function processJob(job) {
  if (!job.data) {
    log.error('Job has no data — skipping', { jobId: job.id });
    return;
  }
  try {
    await MediaModerationService.runCheck(job.data);
    log.info('Moderation check submitted', {
      jobId: job.id,
      entityType: job.data.entityType,
      entityId: job.data.entityId,
    });
  } catch (err) {
    log.error('Moderation job failed', {
      jobId: job.id,
      entityType: job.data.entityType,
      entityId: job.data.entityId,
      error: err.message,
    });
    // Rethrow so pg-boss retries (retryLimit set at enqueue). After retries
    // exhaust, the row stays 'pending' — reconciliation cron picks it up.
    throw err;
  }
}

export async function initModerationWorker() {
  const boss = getBoss();

  // pg-boss v10+ requires queue to exist before workers can subscribe
  await boss.createQueue(JOB_MODERATE_MEDIA);

  // pg-boss v12 passes an array of jobs to the handler — process each independently
  await boss.work(JOB_MODERATE_MEDIA, { teamSize: 5 }, async jobs => {
    await Promise.allSettled(jobs.map(job => processJob(job)));
  });

  log.info('Worker registered', { queue: JOB_MODERATE_MEDIA });
}
