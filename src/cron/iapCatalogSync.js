import cron from 'node-cron';
import { IapCatalogService } from '../services/iapCatalog.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Keeps the shared "Pay in App" price tiers created on the App Store and
 * Google Play (IapCatalogService) — once shortly after start-up, then daily.
 * Only lists + fills gaps, so it's cheap once everything exists.
 *
 * On by default in production; elsewhere set IAP_CATALOG_SYNC=true. Set
 * IAP_CATALOG_SYNC=false to turn it off (npm run iap:sync-tiers still works).
 */
export function startIapCatalogSyncCron() {
  const flag = process.env.IAP_CATALOG_SYNC;
  const enabled = flag ? flag === 'true' : process.env.NODE_ENV === 'production';
  if (!enabled) {
    logger.info('[Cron] IAP catalog sync disabled (IAP_CATALOG_SYNC)');
    return;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await IapCatalogService.sync({ log: msg => logger.info(msg) });
      logger.info('[Cron] IAP catalog sync finished', result);
    } catch (err) {
      logger.error('[Cron] IAP catalog sync failed', { error: err.message });
    } finally {
      running = false;
    }
  };

  cron.schedule('30 3 * * *', run);
  // Delayed so it never competes with start-up work.
  setTimeout(run, 60_000);
  logger.info('[Cron] IAP catalog sync scheduled (daily 03:30, plus 1 min after start-up)');
}
