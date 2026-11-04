import 'dotenv/config';
import env from '../src/config/config.js';
import { fetchVenuniteMcpEvents } from '../src/services/externalEvents/venuniteMcp.client.js';
import { syncExternalEvents } from '../src/services/externalEvents/externalEventSync.service.js';

// Evaluates VenuNite through its free MCP server (VENUNITE_MCP_API_KEY).
// Their terms allow free MCP for product evaluation only — don't schedule this
// or point it at production; a live feed needs the paid REST plan.
//
// Usage: node scripts/test-venunite-mcp.js [--state=CT] [--days=14] [--max-pages=30] [--import]
//   default   fetch and print what would be imported; nothing is written
//   --import  run the fetched events through the normal sync into the database
// Each page is one search (max 20 events, at least one per day searched) out of
// the free key's 500 calls/day.
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const stateCode = (arg('state') || env.externalEvents.states[0]).toUpperCase();
const days = Number(arg('days') || 14);
const maxPages = Number(arg('max-pages') || 30);
const shouldImport = process.argv.includes('--import');

const apiKey = env.externalEvents.venuniteMcpApiKey;
if (!apiKey) {
  console.error('Set VENUNITE_MCP_API_KEY in .env first.');
  process.exit(1);
}

try {
  if (shouldImport) {
    const summary = await syncExternalEvents({ sources: ['venunite-mcp'], maxPages });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const from = new Date();
    const to = new Date(from.getTime() + days * 86400000);
    const { events } = await fetchVenuniteMcpEvents({ apiKey, stateCode, from, to, maxPages });
    const inState = events.filter(e => e.venue.stateCode?.toUpperCase() === stateCode);

    console.table(
      inState.map(e => ({
        start: e.startDate.toISOString().slice(0, 16).replace('T', ' '),
        title: e.title.slice(0, 45),
        venue: `${e.venue.name.slice(0, 25)}, ${e.venue.city}`,
        price: e.isFree ? 'Free' : e.priceMin ?? '?',
        image: e.imageUrl ? 'yes' : 'no',
      }))
    );
    console.log(
      `${inState.length} ${stateCode} events (${events.length - inState.length} out-of-state skipped)` +
        ` from ${maxPages} page(s) max. Dry run — re-run with --import to write them.`
    );
  }
  process.exit(0);
} catch (error) {
  console.error('VenuNite MCP test failed:', error);
  process.exit(1);
}
