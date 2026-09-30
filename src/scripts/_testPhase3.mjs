// Usage: node src/scripts/_testPhase3.mjs
// Finds the newest still-held priority message for the test talent, backdates
// its repliedAt to 8 days ago (TEST-ONLY — simulates the Day-7 window having
// passed without waiting for real time), then exercises eligibility + claim.
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();
const { db } = await import('../db/index.js');
const { priorityMessagePayments } = await import('../db/schema/index.js');
const { and, eq, gt, isNull, desc } = await import('drizzle-orm');
const { computeEarlyPayoutEligibility, checkInstantPayoutEligibility, claimEarlyPayout } = await import(
  '../services/earlyPayout.service.js'
);

const userId = '1c8a7b84-67e3-4f8f-a88a-9f301ac3ab8a'; // change if needed

const row = await db.query.priorityMessagePayments.findFirst({
  where: and(
    eq(priorityMessagePayments.talentUserId, userId),
    eq(priorityMessagePayments.status, 'replied'),
    gt(priorityMessagePayments.reserveAmountCents, 0),
    isNull(priorityMessagePayments.standardReleasedAt)
  ),
  orderBy: desc(priorityMessagePayments.repliedAt),
});

if (!row) {
  console.log('No eligible row found. Make sure the talent has REPLIED to a fresh priority message first (status must be "replied", reserveAmountCents > 0, standardReleasedAt null).');
  process.exit(0);
}

console.log('Testing against:', row.id, 'reserveAmountCents:', row.reserveAmountCents);

const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
await db.update(priorityMessagePayments).set({ repliedAt: eightDaysAgo }).where(eq(priorityMessagePayments.id, row.id));
console.log('Backdated repliedAt to', eightDaysAgo.toISOString(), '(TEST ONLY)');

console.log('\n=== Eligibility ===');
const eligibility = await computeEarlyPayoutEligibility(userId);
console.log(eligibility);

console.log('\n=== Instant payout eligibility (needs debit card + Dashboard settings) ===');
console.log(await checkInstantPayoutEligibility(userId));

console.log('\n=== Claiming ===');
const result = await claimEarlyPayout(userId).catch(err => ({ error: err.message }));
console.log(result);

process.exit(0);
