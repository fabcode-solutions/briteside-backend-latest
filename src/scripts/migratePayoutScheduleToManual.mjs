// One-time migration: switches every existing Stripe Connect account's payout
// schedule to `interval: 'manual'`, matching what new accounts now get at
// creation time (see stripeConnect.service.js#createAccount). Without this,
// Stripe's own default automatic payout schedule keeps paying out a
// connected account's Connect balance on its own timetable the moment
// reserveRelease.js transfers money into it — bypassing the new
// Pending/Available/Reserve ledger and its scheduled 1st/15th sweep entirely
// (see PAYMENTS_ARCHITECTURE.md §1.4, Phase 0).
//
// Safe to run more than once — setting an account already on 'manual' back
// to 'manual' is a no-op. Existing sellers are NOT stranded by this: the
// existing manual Cash Out flow (requestCashout -> stripe.payouts.create)
// works identically whether an account's schedule is 'automatic' or
// 'manual', so a seller can still pull their balance immediately at any
// time, before the new scheduled sweep cron exists.
//
// Usage:
//   NODE_ENV=production USE_AWS_SECRETS=true node src/scripts/migratePayoutScheduleToManual.mjs --dry-run
//   NODE_ENV=production USE_AWS_SECRETS=true node src/scripts/migratePayoutScheduleToManual.mjs
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();

const { db } = await import('../db/index.js');
const { stripeConnectAccounts } = await import('../db/schema/stripeConnect.js');
const config = (await import('../config/config.js')).default;
const Stripe = (await import('stripe')).default;

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!config.stripe?.secretKey) {
    throw new Error('STRIPE_SECRET_KEY missing — aborting.');
  }
  const stripe = new Stripe(config.stripe.secretKey);

  const accounts = await db.query.stripeConnectAccounts.findMany({
    columns: { id: true, userId: true, stripeAccountId: true },
  });

  console.log(`Found ${accounts.length} Connect account(s).${dryRun ? ' (dry run — no changes will be made)' : ''}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      if (dryRun) {
        const current = await stripe.accounts.retrieve(account.stripeAccountId);
        const interval = current.settings?.payouts?.schedule?.interval ?? '(default/unset)';
        console.log(`[dry-run] ${account.stripeAccountId} (user ${account.userId}): current interval = ${interval}`);
        continue;
      }

      await stripe.accounts.update(account.stripeAccountId, {
        settings: {
          payouts: {
            schedule: { interval: 'manual' },
          },
        },
      });
      updated++;
      console.log(`[ok] ${account.stripeAccountId} (user ${account.userId}) -> manual`);
    } catch (err) {
      failed++;
      console.error(`[FAILED] ${account.stripeAccountId} (user ${account.userId}): ${err.message}`);
    }
  }

  console.log(
    dryRun
      ? `Dry run complete. ${accounts.length} account(s) inspected.`
      : `Done. Updated: ${updated}, Failed: ${failed}, Skipped: ${skipped}, Total: ${accounts.length}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
