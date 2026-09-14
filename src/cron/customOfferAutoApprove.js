import { cronLogger as logger } from '../config/logger.js';
import { ShopCustomOfferService } from '../services/shop/shopCustomOffer.service.js';

/**
 * Auto-approves shop custom-offer deliveries the buyer never acted on
 * within the 3-day review window (mirrors Fiverr's auto-accept).
 */
export const processCustomOfferAutoApprove = async () => {
  logger.info('[Cron] Processing custom offer auto-approve');

  try {
    const { processed } = await ShopCustomOfferService.autoApproveOverdueDeliveries();
    logger.info('[Cron] Custom offer auto-approve complete', { processed });
  } catch (error) {
    logger.error('[Cron] Custom offer auto-approve failed', {
      error: error.message,
      stack: error.stack,
    });
  }
};

export default {
  processCustomOfferAutoApprove,
};