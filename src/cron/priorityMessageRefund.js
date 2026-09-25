import cron from 'node-cron';
import { PriorityMessageService } from '../services/priorityMessage.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Runs every 30 minutes.
 * Checks for unresponded priority messages past 72h and issues refunds.
 */
export function startPriorityMessageRefundCron() {
  const runCheck = async () => {
    logger.info('[Cron] Running priority message refund check');
    try {
      await PriorityMessageService.processExpiredRefunds();
    } catch (err) {
      logger.error('[Cron] Priority message refund check failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  };

  cron.schedule('*/30 * * * *', runCheck);

  // node-cron's schedule only lives in this process's memory — every restart
  // resets the 30-minute countdown to zero. A payment whose 72h window
  // closes while the server is down (or was just restarted) would otherwise
  // sit unrefunded until this process survives a full uninterrupted 30
  // minutes, which on a frequently-restarting server can stretch into days.
  // Running one catch-up check immediately on startup closes that gap.
  runCheck();

  logger.info('[Cron] Priority message refund job scheduled (every 30 min, plus on startup)');
}
