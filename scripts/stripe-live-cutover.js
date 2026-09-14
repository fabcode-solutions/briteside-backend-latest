import 'dotenv/config';
import { Pool } from 'pg';
import { loadSecrets } from '../src/config/secrets.js';

/**
 * One-time cleanup for the Stripe account cutover (test Account A → live Account B).
 *
 * Every Stripe ID in the database was created on the old test account, so it returns
 * `resource_missing` against the new account's key. The rows carrying those IDs are
 * dead weight — but the real problem is the cached flags and stored counters, which
 * keep asserting state that no longer exists anywhere: sellers marked chargesEnabled
 * who have not onboarded, subscriptions marked active that will never renew, and
 * counters like quantity_sold that were only ever incremented by test purchases.
 *
 * Full rationale, impact analysis and cutover order: docs/stripe-live-cutover.md
 *
 * Usage — prefer the npm scripts. They set NODE_ENV=production via cross-env, and
 * loadSecrets() skips DB credentials without it (secrets.js:55-57), so the bare
 * `node scripts/...` form silently connects to the local .env database instead of RDS:
 *
 *   npm run stripe:cutover          # dry run — row counts + FK impact
 *   npm run stripe:cutover:apply    # delete + reset inside one transaction
 *
 * Direct invocation, for a deliberately local run:
 *   node scripts/stripe-live-cutover.js --local   # .env DB creds, skip Secrets Manager
 *
 * Whichever form you use, check the "Target DB host:" line before trusting the result.
 */

const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local');

// Ordered by foreign-key dependency — children before parents. Two ordering rules
// are load-bearing and not obvious:
//   1. user_subscriptions before subscription_plans. The FK declares no onDelete, so
//      it defaults to NO ACTION and deleting plans first aborts the transaction.
//   2. event_attendees before orders. Its order_id is SET NULL, so the rows would
//      otherwise survive as registered/checked-in attendees on real events.
// guest_orders needs no companions here — guest_order_items and
// guest_purchased_tickets both cascade from it.
const DELETES = [
  { table: 'subscription_audit_logs', note: 'audit trail of test subscriptions' },
  { table: 'user_subscriptions', note: 'incl. comped grants — see doc §8' },
  { table: 'subscription_plans', note: 'cascades → subscription_features' },
  { table: 'group_subscriptions', note: '' },
  { table: 'group_course_enrollments', note: '' },
  { table: 'shop_orders', note: 'cascades → shop_refund_requests' },
  { table: 'event_attendees', note: 'order_id is SET NULL — must delete explicitly' },
  { table: 'orders', note: 'cascades → order_items, refunds' },
  { table: 'purchased_tickets', note: 'test QR codes would still scan valid' },
  { table: 'purchased_merchandise', note: '' },
  { table: 'guest_orders', note: '' },
  { table: 'talent_issues', note: '' },
  { table: 'talent_sessions', note: 'CASCADES → talent_reviews (content loss, doc §2.1)' },
  { table: 'priority_message_items', note: '' },
  { table: 'priority_message_payments', note: '' },
  { table: 'user_spends', note: '' },
  { table: 'talent_payouts', note: '' },
  { table: 'organizer_payouts', note: '' },
  { table: 'group_payouts', note: '' },
  { table: 'stripe_customers', note: 'recreated lazily by getOrCreateStripeCustomer' },
  { table: 'stripe_connect_accounts', note: 'recreated by sweepMissingConnectAccounts cron' },
];

// group_members is deliberately absent. Deleting group_subscriptions leaves test
// subscribers as free members of paid groups because membership is service-managed
// with no DB cascade — accepted, since those are test accounts (doc §8).

const RESETS = [
  {
    label: 'organizers.stripe_account_id + rating',
    sql: `UPDATE organizers SET stripe_account_id = NULL, rating = '0'
          WHERE stripe_account_id IS NOT NULL OR rating <> '0'`,
  },
  {
    label: 'group_subscription_tiers Stripe catalog IDs',
    sql: `UPDATE group_subscription_tiers SET stripe_product_id = NULL, stripe_price_id = NULL
          WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL`,
  },
  {
    label: 'group_courses Stripe catalog IDs',
    sql: `UPDATE group_courses SET stripe_product_id = NULL, stripe_price_id = NULL
          WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL`,
  },
  // Stored counters, not computed from rows — deleting the rows does not update them.
  {
    label: 'event_tickets.quantity_sold',
    sql: `UPDATE event_tickets SET quantity_sold = 0 WHERE quantity_sold <> 0`,
  },
  {
    label: 'talent_profiles.rating + review_count',
    sql: `UPDATE talent_profiles SET rating = '0.00', review_count = 0
          WHERE rating <> '0.00' OR review_count <> 0`,
  },
];

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = encodeURIComponent(process.env.POSTGRESQL_USER);
  const pass = encodeURIComponent(process.env.POSTGRESQL_PASSWORD);
  return `postgresql://${user}:${pass}@${process.env.POSTGRESQL_HOST}:${process.env.POSTGRESQL_PORT || 5432}/${process.env.POSTGRESQL_DB_NAME || 'postgres'}?sslmode=no-verify`;
}

/**
 * Guards against a table name in DELETES/RESETS that doesn't exist — a Drizzle
 * export name is not always the SQL table name (eventAttendees → event_attendees),
 * so a typo here would otherwise surface as a mid-loop 42P01 after some tables had
 * already been counted or emptied.
 */
async function getMissingTables(client, tables) {
  const { rows } = await client.query(
    `SELECT t.name
       FROM unnest($1::text[]) AS t(name)
       LEFT JOIN information_schema.tables it
         ON it.table_schema = 'public'
        AND it.table_name = t.name
        AND it.table_type = 'BASE TABLE'
      WHERE it.table_name IS NULL`,
    [tables]
  );
  return rows.map(r => r.name);
}

/**
 * Every FK pointing at a table we are about to empty, from a table we are NOT
 * emptying. The delete rule decides whether that is fatal, collateral, or benign:
 *   NO ACTION / RESTRICT → the DELETE aborts the whole transaction
 *   CASCADE              → those rows are silently destroyed too
 *   SET NULL             → rows survive with a broken link
 * Reported so a later schema change can't quietly add a landmine to this list.
 */
async function getInboundForeignKeys(client, targets) {
  const { rows } = await client.query(
    `SELECT tc.table_name   AS child_table,
            kcu.column_name AS child_column,
            ccu.table_name  AS parent_table,
            rc.delete_rule  AS delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_schema = 'public'
        AND ccu.table_name = ANY($1)
      ORDER BY rc.delete_rule, tc.table_name`,
    [targets]
  );
  const targetSet = new Set(targets);
  return rows.filter(r => !targetSet.has(r.child_table));
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY — DESTRUCTIVE' : 'DRY RUN'}`);
  console.log('');

  if (LOCAL) {
    console.log('Local mode: skipping Secrets Manager, using .env DB credentials\n');
  } else {
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

  try {
    const targets = DELETES.map(d => d.table);
    const resetTables = RESETS.map(
      r =>
        r.sql
          .split(/UPDATE\s+/i)[1]
          .trim()
          .split(/\s+/)[0]
    );

    // ── Preflight: every named table must exist ──────────────────────────────
    const missing = await getMissingTables(client, [...targets, ...resetTables]);
    if (missing.length) {
      console.error('Tables named in this script do not exist in the database:');
      for (const t of missing) console.error(`  ${t}`);
      console.error('\nFix the table names before running. Nothing was changed.');
      process.exitCode = 1;
      return;
    }

    // ── FK impact ────────────────────────────────────────────────────────────
    const inbound = await getInboundForeignKeys(client, targets);
    const blocking = inbound.filter(r => ['NO ACTION', 'RESTRICT'].includes(r.delete_rule));
    const cascading = inbound.filter(r => r.delete_rule === 'CASCADE');

    if (cascading.length) {
      console.log('Cascade collateral — these rows are destroyed too:');
      for (const r of cascading) {
        console.log(`  ${r.child_table}.${r.child_column} → ${r.parent_table}`);
      }
      console.log('');
    }

    if (blocking.length) {
      console.log('BLOCKING foreign keys — the delete will fail on these:');
      for (const r of blocking) {
        console.log(`  ${r.child_table}.${r.child_column} → ${r.parent_table} (${r.delete_rule})`);
      }
      console.log('\nAdd these tables to DELETES (children first) before applying.\n');
      if (APPLY) {
        console.error('Refusing to apply while blocking foreign keys exist.');
        process.exitCode = 1;
        return;
      }
    }

    // ── Deletes ──────────────────────────────────────────────────────────────
    if (APPLY) await client.query('BEGIN');

    let totalDeleted = 0;
    console.log(APPLY ? 'Deleting:' : 'Rows that would be deleted:');
    for (const { table, note } of DELETES) {
      const n = APPLY
        ? (await client.query(`DELETE FROM "${table}"`)).rowCount
        : Number((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
      totalDeleted += n;
      const suffix = note ? `  — ${note}` : '';
      console.log(`  ${String(n).padStart(7)}  ${table}${suffix}`);
    }

    // ── Resets ───────────────────────────────────────────────────────────────
    let totalReset = 0;
    console.log(APPLY ? '\nResetting:' : '\nRows that would be reset:');
    for (const { label, sql } of RESETS) {
      let n;
      if (APPLY) {
        n = (await client.query(sql)).rowCount;
      } else {
        // Reuse the UPDATE's own table and WHERE clause so the dry-run count
        // cannot drift from what --apply would actually touch.
        const table = sql
          .split(/UPDATE\s+/i)[1]
          .trim()
          .split(/\s+/)[0];
        const where = sql.slice(sql.search(/\bWHERE\b/i));
        n = Number((await client.query(`SELECT count(*) FROM "${table}" ${where}`)).rows[0].count);
      }
      totalReset += n;
      console.log(`  ${String(n).padStart(7)}  ${label}`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\nCommitted. ${totalDeleted} rows deleted, ${totalReset} rows reset.`);
      console.log('\nNext: re-run scripts/seed-subscription-plans.js against live,');
      console.log('then let sweepMissingConnectAccounts recreate the Connect accounts.');
    } else {
      console.log(`\nDry run. ${totalDeleted} rows would be deleted, ${totalReset} reset.`);
      console.log('Re-run with --apply to perform it. Take a DB snapshot first.');
    }
  } catch (err) {
    if (APPLY) {
      await client.query('ROLLBACK');
      console.error('\nRolled back — no changes were made.');
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
