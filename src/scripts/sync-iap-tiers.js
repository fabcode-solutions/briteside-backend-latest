import 'dotenv/config';
/**
 * src/scripts/sync-iap-tiers.js
 *
 * Creates / completes the shared "Pay in App" price tiers on the App Store
 * and Google Play (IapCatalogService). The server also does this on its own
 * at start-up and daily (cron/iapCatalogSync.js) — this runs it by hand.
 *
 *   npm run iap:sync-tiers                    # everything
 *   npm run iap:sync-tiers -- --dry-run       # only report what's missing
 *   npm run iap:sync-tiers -- --only 1299     # just the $12.99 tier
 *   npm run iap:sync-tiers -- --only 999,1299
 */
import { loadSecrets } from '../config/secrets.js';

await loadSecrets();

const { IapCatalogService } = await import('../services/iapCatalog.service.js');
const { IAP_TIER_CENTS } = await import('../services/iapTiers.js');

const arg = name => {
  const i = process.argv.findIndex(a => a === name || a.startsWith(`${name}=`));
  if (i === -1) return undefined;
  return process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1];
};

const dryRun = process.argv.includes('--dry-run');
const only = arg('--only');
const onlyCents = only
  ? String(only)
      .split(',')
      .map(v => Number(v.trim()))
      .filter(Boolean)
  : null;
if (onlyCents?.some(c => !IAP_TIER_CENTS.includes(c))) {
  console.error(`--only must list tier cents from iapTiers.js (e.g. 999, 1299, 19999)`);
  process.exit(1);
}

console.log(
  `${dryRun ? 'Dry run — ' : ''}syncing ${onlyCents?.length ?? IAP_TIER_CENTS.length} price tier(s) with Apple and Google…\n`
);
const result = await IapCatalogService.sync({ onlyCents, dryRun, log: msg => console.log(msg) });
console.log('\nResult:', JSON.stringify(result));
const failed = (result.apple?.failed ?? 0) + (result.google?.failed ?? 0);
process.exit(failed ? 1 : 0);
