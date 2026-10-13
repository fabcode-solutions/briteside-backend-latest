import { getBoss } from '../lib/pgboss.js';
import {
  CopyrightScanService,
  JOB_SCAN_COPYRIGHT_AUDIO,
} from '../services/copyrightScan.service.js';
import logger from '../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'copyrightScanWorker', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'copyrightScanWorker', ...meta }),
};

async function processJob(job) {
  if (!job.data) {
    log.error('Job has no data — skipping', { jobId: job.id });
    return;
  }
  try {
    await CopyrightScanService.runCheck(job.data);
    log.info('Copyright scan submitted', { jobId: job.id, mediaId: job.data.mediaId });
  } catch (err) {
    log.error('Copyright scan job failed', {
      jobId: job.id,
      mediaId: job.data.mediaId,
      error: err.message,
    });
    // Rethrow so pg-boss retries (retryLimit set at enqueue).
    throw err;
  }
}

export async function initCopyrightScanWorker() {
  const boss = getBoss();

  // pg-boss v10+ requires queue to exist before workers can subscribe
  await boss.createQueue(JOB_SCAN_COPYRIGHT_AUDIO);

  await boss.work(JOB_SCAN_COPYRIGHT_AUDIO, { teamSize: 3 }, async jobs => {
    await Promise.allSettled(jobs.map(job => processJob(job)));
  });

  log.info('Worker registered', { queue: JOB_SCAN_COPYRIGHT_AUDIO });
}
