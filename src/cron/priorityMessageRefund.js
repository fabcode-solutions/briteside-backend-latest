import cron from 'node-cron';
import { PriorityMessageService } from '../services/priorityMessage.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Runs every 30 minutes.
 * Checks for unresponded priority messages past 48h and issues refunds.
 */
export function startPriorityMessageRefundCron() {
  cron.schedule('*/30 * * * *', async () => {
    logger.info('[Cron] Running priority message refund check');
    try {
      await PriorityMessageService.processExpiredRefunds();
    } catch (err) {
      logger.error('[Cron] Priority message refund check failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  logger.info('[Cron] Priority message refund job scheduled (every 30 min)');
}
