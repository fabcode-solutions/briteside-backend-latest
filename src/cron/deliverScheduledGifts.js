import { GiftCodeService } from '../services/giftCode.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Sends the gift email for any paid-for gift whose chosen delivery date has
 * arrived — this is what actually honors the "Delivery Date" field a gifter
 * picks in BookOneOnOne (finalizeNativePayment only delivers immediately
 * when no future date was requested).
 */
export const deliverScheduledGifts = async () => {
  logger.info('[Cron] Delivering scheduled gift emails');
  const { checked, sent } = await GiftCodeService.deliverScheduledGifts();
  logger.info('[Cron] Scheduled gift delivery complete', { checked, sent });
};

export default { deliverScheduledGifts };
