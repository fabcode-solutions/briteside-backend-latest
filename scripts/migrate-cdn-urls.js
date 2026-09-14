import 'dotenv/config';
import { Pool } from 'pg';
import { loadSecrets } from '../src/config/secrets.js';

/**
 * One-time migration: rewrite stored S3 media URLs to CDN URLs across ALL tables.
 *
 * Discovers every text / varchar / text-array / json / jsonb column in the public
 * schema and replaces the S3 base URL with CDN_BASE_URL. Only strings containing
 * the exact S3 domain are touched, so external URLs (YouTube, Stripe, etc.) are safe.
 *
 * Usage:
 *   node scripts/migrate-cdn-urls.js           # dry run — prints match counts only
 *   node scripts/migrate-cdn-urls.js --apply   # perform updates inside a transaction
 */

const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local'); // skip Secrets Manager, use .env DB creds only

const BUCKET = 'gokyro-images-prod';
const REGION = process.env.AWS_REGION || 'us-east-1';
const CDN_BASE = (process.env.CDN_BASE_URL || 'https://assets.briteside.app').replace(/\/+$/, '');

if (!BUCKET) {
  console.error('AWS_S3_BUCKET is not set');
  process.exit(1);
}
if (!CDN_BASE) {
  console.error('CDN_BASE_URL is not set');
  process.exit(1);
}

// All URL styles that may exist in old rows (S3 variants + raw CloudFront domain)
const OLD_BASES = [
  `https://${BUCKET}.s3.${REGION}.amazonaws.com`,
  `https://${BUCKET}.s3.amazonaws.com`,
  `https://s3.${REGION}.amazonaws.com/${BUCKET}`,
  'https://d3nbmwgi9gont3.cloudfront.net',
];

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = encodeURIComponent(process.env.POSTGRESQL_USER);
  const pass = encodeURIComponent(process.env.POSTGRESQL_PASSWORD);
  return `postgresql://${user}:${pass}@${process.env.POSTGRESQL_HOST}:${process.env.POSTGRESQL_PORT || 5432}/${process.env.POSTGRESQL_DB_NAME || 'postgres'}?sslmode=no-verify`;
}

async function getCandidateColumns(client) {
  const { rows } = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.is_generated = 'NEVER'
      AND (
        c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar'))
      )
    ORDER BY c.table_name, c.column_name
  `);
  return rows;
}

// Single query per column handling all OLD_BASES at once.
// Params: $1..$N = old bases, $N+1 = CDN base.
function queriesFor(col) {
  const t = `"${col.table_name}"`;
  const c = `"${col.column_name}"`;
  const n = OLD_BASES.length;
  const cdnParam = `$${n + 1}`;
  const likeAny = expr =>
    `(${OLD_BASES.map((_, i) => `${expr} LIKE '%' || $${i + 1} || '%'`).join(' OR ')})`;
  const replaceAll = expr =>
    OLD_BASES.reduce((acc, _, i) => `replace(${acc}, $${i + 1}, ${cdnParam})`, expr);

  if (col.data_type === 'ARRAY') {
    return {
      count: `SELECT count(*) FROM ${t} WHERE ${likeAny(`array_to_string(${c}, ',')`)}`,
      update: `UPDATE ${t}
               SET ${c} = (SELECT array_agg(${replaceAll('x')} ORDER BY ord)
                           FROM unnest(${c}) WITH ORDINALITY AS u(x, ord))
               WHERE ${likeAny(`array_to_string(${c}, ',')`)}`,
    };
  }
  if (col.data_type === 'json' || col.data_type === 'jsonb') {
    const cast = col.data_type;
    return {
      count: `SELECT count(*) FROM ${t} WHERE ${likeAny(`${c}::text`)}`,
      update: `UPDATE ${t} SET ${c} = ${replaceAll(`${c}::text`)}::${cast} WHERE ${likeAny(`${c}::text`)}`,
    };
  }
  return {
    count: `SELECT count(*) FROM ${t} WHERE ${likeAny(c)}`,
    update: `UPDATE ${t} SET ${c} = ${replaceAll(c)} WHERE ${likeAny(c)}`,
  };
}

// Run tasks with limited concurrency
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`CDN base: ${CDN_BASE}`);
  OLD_BASES.forEach(b => console.log(`Old base: ${b}`));
  console.log('');

  if (LOCAL) {
    console.log('Local mode: skipping Secrets Manager, using .env DB credentials\n');
  } else {
    // Prod: pull RDS credentials from AWS Secrets Manager (requires USE_AWS_SECRETS=true)
    await loadSecrets();
  }

  const connectionString = buildConnectionString();
  try {
    console.log(`Target DB host: ${new URL(connectionString).hostname}\n`);
  } catch {
    console.log('Target DB host: <unparseable connection string>\n');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  let totalMatched = 0;
  let totalUpdated = 0;

  try {
    const columns = await getCandidateColumns(client);
    console.log(`Scanning ${columns.length} candidate columns...\n`);

    const params = [...OLD_BASES];

    if (APPLY) {
      // Updates run serially inside one transaction; UPDATE rowCount doubles as the match count
      await client.query('BEGIN');
      for (const col of columns) {
        const res = await client.query(queriesFor(col).update, [...params, CDN_BASE]);
        if (res.rowCount > 0) {
          totalUpdated += res.rowCount;
          totalMatched += res.rowCount;
          console.log(
            `${col.table_name}.${col.column_name} [${col.data_type}]: updated ${res.rowCount} row(s)`
          );
        }
      }
    } else {
      // Dry run: read-only counts, parallel across pool connections
      const counts = await mapLimit(columns, 8, async col => {
        const {
          rows: [{ count }],
        } = await pool.query(queriesFor(col).count, params);
        return Number(count);
      });
      columns.forEach((col, idx) => {
        if (counts[idx] > 0) {
          totalMatched += counts[idx];
          console.log(
            `${col.table_name}.${col.column_name} [${col.data_type}]: ${counts[idx]} row(s) match`
          );
        }
      });
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\nDone. Matched: ${totalMatched}, updated: ${totalUpdated}. COMMITTED.`);
    } else {
      console.log(`\nDry run complete. Total rows matching: ${totalMatched}.`);
      console.log('Re-run with --apply to perform the migration.');
    }
  } catch (err) {
    if (APPLY) await client.query('ROLLBACK').catch(() => {});
    console.error('\nMigration failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
