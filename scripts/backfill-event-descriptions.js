import 'dotenv/config';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { events } from '../src/db/schema/index.js';
import {
  cleanDescription,
  createDescriptionFetcher,
  mayBeIncomplete,
} from '../src/services/externalEvents/pageDescription.js';

// One-off / on-demand: give imported events whose description is missing, the
// generic "X at Y. Tickets are sold by …" line, a cut-off excerpt ("[…]") or a
// one-line summary the full description from their listing page. The scheduled sync does the
// same gradually (a capped number of pages per run); this does it all at once.
//
// Usage: node scripts/backfill-event-descriptions.js [--limit=N] [--dry-run] [--clean-only]
//   --clean-only  only tidy descriptions already saved (button labels, repeated
//                 paragraphs, "\n" text) — no pages are fetched.

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const limit = Number(arg('limit') ?? 5000);
const dryRun = process.argv.includes('--dry-run');
const cleanOnly = process.argv.includes('--clean-only');
const GENERATED = /^[^\n]+ at [^\n]+\. Tickets are sold by [^\n]+\.$/;

const rows = await db
  .select({
    id: events.id,
    title: events.title,
    description: events.description,
    externalUrl: events.externalUrl,
  })
  .from(events)
  .where(
    and(
      // Ticketmaster pages are never fetched (terms of use).
      inArray(events.source, ['venunite']),
      isNotNull(events.externalUrl),
      eq(events.eventStatus, 'published'),
      gte(events.endDate, new Date())
    )
  );

const todo = rows.filter(r => {
  const text = cleanDescription(r.description);
  if (cleanOnly) return !!text && text !== r.description;
  return !text || GENERATED.test(text) || mayBeIncomplete(text) || text !== r.description;
});
console.log(`${rows.length} upcoming imported events, ${todo.length} need a better description`);

const fetchDescription = createDescriptionFetcher({ concurrency: 8, limit });
let updated = 0;
let cleanedOnly = 0;

await Promise.all(
  todo.map(async row => {
    const current = cleanDescription(row.description);
    const fromPage = cleanOnly ? null : await fetchDescription(row.externalUrl, row.title);
    let next = current;
    if (fromPage && (!current || GENERATED.test(current) || fromPage.length > current.length)) {
      next = fromPage;
    }
    if (!next || next === row.description) return;
    if (next === current) cleanedOnly++;
    else updated++;
    if (!dryRun) {
      await db.update(events).set({ description: next, updatedAt: new Date() }).where(eq(events.id, row.id));
    }
  })
);

console.log(
  JSON.stringify(
    { dryRun, pagesFetched: fetchDescription.counts.fetched, found: fetchDescription.counts.found, updatedFromPage: updated, cleanedOnly },
    null,
    2
  )
);
process.exit(0);
