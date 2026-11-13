import 'dotenv/config';
import pg from 'pg';

// Replaces VenuNite links on upcoming imported events (and their sessions)
// with the page where the event is actually hosted:
//   venunite.com/api/tickets/go?…&url=<host>  → <host>
//   venunite.com/events/<slug>               → where VenuNite's ticket
//                                               redirect for <slug> leads
// Links that don't resolve to a non-VenuNite site are left unchanged.
//
// Usage:
//   node scripts/fix-venunite-links.js [--dry-run]            (DATABASE_URL from .env)
//   node scripts/fix-venunite-links.js --production [--dry-run]
//     --production reads the database credentials from AWS Secrets Manager
//     (USE_AWS_SECRETS + NODE_ENV=production in .env), ignoring a local DATABASE_URL.

const dryRun = process.argv.includes('--dry-run');
const production = process.argv.includes('--production');

if (production) {
  delete process.env.DATABASE_URL;
  const { loadSecrets } = await import('../src/config/secrets.js');
  await loadSecrets();
}
if (!process.env.DATABASE_URL) {
  console.error('No DATABASE_URL — check .env / AWS Secrets Manager settings');
  process.exit(1);
}
const dbHost = new URL(process.env.DATABASE_URL).hostname;
console.log(`Database: ${dbHost}${dryRun ? ' (dry run — nothing will be saved)' : ''}`);

const isVenunite = url => {
  try {
    return /(^|\.)venunite\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

const slugCache = new Map();
async function resolveSlug(slug) {
  if (!slugCache.has(slug)) {
    slugCache.set(
      slug,
      (async () => {
        try {
          const res = await fetch(
            `https://venunite.com/api/tickets/go?event=${encodeURIComponent(slug)}&placement=blocking_cta`,
            {
              redirect: 'manual',
              signal: AbortSignal.timeout(15000),
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BritesideBot/1.0)' },
            }
          );
          const location = res.headers.get('location');
          await res.body?.cancel().catch(() => {});
          return location && /^https?:\/\//i.test(location) && !isVenunite(location) ? location : null;
        } catch {
          return null;
        }
      })()
    );
  }
  return slugCache.get(slug);
}

// VenuNite drops some requests under load — try a slug again before giving up.
async function resolveSlugWithRetry(slug) {
  const first = await resolveSlug(slug);
  if (first) return first;
  slugCache.delete(slug);
  await new Promise(r => setTimeout(r, 1500));
  return resolveSlug(slug);
}

/** Host page for a VenuNite link, or null when it can't be determined. */
async function hostUrlFor(url) {
  if (!url || !isVenunite(url)) return null;
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/api/tickets/go')) {
    const target = parsed.searchParams.get('url');
    if (target && /^https?:\/\//i.test(target) && !isVenunite(target)) return target;
    const slug = parsed.searchParams.get('event');
    return slug ? resolveSlugWithRetry(slug) : null;
  }
  const m = parsed.pathname.match(/^\/events\/([^/?#]+)/);
  return m ? resolveSlugWithRetry(m[1]) : null;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: dbHost === 'localhost' ? false : { rejectUnauthorized: false },
});
await client.connect();

const events = (
  await client.query(`
    SELECT id, title, external_url FROM events
    WHERE source = 'venunite' AND end_date >= now() AND external_url ILIKE '%venunite.com%'`)
).rows;
const sessions = (
  await client.query(`
    SELECT s.id, s.external_url, e.external_url AS event_url FROM event_schedules s
    JOIN events e ON e.id = s.event_id
    WHERE e.source = 'venunite' AND e.end_date >= now() AND s.external_url ILIKE '%venunite.com%'`)
).rows;
console.log(`To check: ${events.length} events, ${sessions.length} sessions with VenuNite links`);

const stats = { eventsFixed: 0, sessionsFixed: 0, unresolved: 0 };
const examples = [];

await pool(events, 4, async row => {
  const host = await hostUrlFor(row.external_url);
  if (!host) return void stats.unresolved++;
  stats.eventsFixed++;
  if (examples.length < 5) examples.push(`${row.title} → ${host}`);
  if (!dryRun) {
    await client.query('UPDATE events SET external_url = $1, updated_at = now() WHERE id = $2', [
      host,
      row.id,
    ]);
  }
});
await pool(sessions, 4, async row => {
  // A date VenuNite has no ticket link for falls back to the event's own host page.
  const host =
    (await hostUrlFor(row.external_url)) ||
    (row.event_url && !isVenunite(row.event_url) ? row.event_url : null);
  if (!host) return void stats.unresolved++;
  stats.sessionsFixed++;
  if (!dryRun) {
    await client.query(
      'UPDATE event_schedules SET external_url = $1, updated_at = now() WHERE id = $2',
      [host, row.id]
    );
  }
});

await client.end();
console.log(examples.map(e => `  ${e}`).join('\n'));
console.log(JSON.stringify({ database: dbHost, dryRun, ...stats }, null, 2));
process.exit(0);
