import 'dotenv/config';
import { syncExternalEvents } from '../src/services/externalEvents/externalEventSync.service.js';

// Usage: node scripts/sync-external-events.js [--source=ticketmaster|venunite] [--max-pages=N]
// --max-pages limits VenuNite paging for a test run (e.g. on the 1,000-row trial).
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const sources = arg('source')?.split(',');
const maxPages = arg('max-pages') ? Number(arg('max-pages')) : undefined;

try {
  const summary = await syncExternalEvents({ sources, maxPages });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (error) {
  console.error('External event sync failed:', error);
  process.exit(1);
}
