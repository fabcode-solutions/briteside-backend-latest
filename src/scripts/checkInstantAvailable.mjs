// Checks whether a creator's Connect account currently has money eligible
// for an Instant Payout — the exact thing that was showing net_available
// missing/0 right after a fresh release. Run this again later (an hour,
// a day) on the same account to see if it's just settlement time, or
// something actually broken.
//
// Usage: node src/scripts/checkInstantAvailable.mjs <userId> [--local]
//   --local forces the local Postgres DB instead of loading AWS secrets.

const userId = process.argv[2];
if (!userId) {
  console.log('Usage: node src/scripts/checkInstantAvailable.mjs <userId> [--local]');
  process.exit(1);
}

if (process.argv.includes('--local')) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
} else {
  const { loadSecrets } = await import('../config/secrets.js');
  await loadSecrets();
}

const { db } = await import('../db/index.js');
const { stripeConnectAccounts } = await import('../db/schema/index.js');
const { eq } = await import('drizzle-orm');
const { checkInstantPayoutEligibility } = await import('../services/earlyPayout.service.js');
const config = (await import('../config/config.js')).default;
const Stripe = (await import('stripe')).default;
const stripe = new Stripe(config.stripe.secretKey);

const account = await db.query.stripeConnectAccounts.findFirst({ where: eq(stripeConnectAccounts.userId, userId) });
if (!account) {
  console.log('No Connect account on file for this userId.');
  process.exit(0);
}
console.log('Connect account:', account.stripeAccountId, '| payoutsEnabled:', account.payoutsEnabled);

const eligibility = await checkInstantPayoutEligibility(userId);
console.log('Eligibility:', eligibility);
if (!eligibility.eligible) process.exit(0);

const balance = await stripe.balance.retrieve(
  { expand: ['instant_available.net_available'] },
  { stripeAccount: account.stripeAccountId }
);
const usd = (balance.instant_available ?? []).find(b => b.currency === 'usd');
console.log('instant_available (usd):', usd);

const netEntry = (usd?.net_available ?? []).find(n => n.destination === eligibility.externalAccountId);
const netAvailableCents = netEntry?.amount ?? 0;

if (netAvailableCents > 0) {
  console.log(`\n✅ READY: $${(netAvailableCents / 100).toFixed(2)} is instantly payable right now.`);
} else {
  console.log('\n⏳ NOT YET: no net_available amount showing. Either still settling, or something is actually blocking it — check back later, or investigate further if this persists for a long time (e.g. a full day) with real aged money in the balance.');
}
process.exit(0);
