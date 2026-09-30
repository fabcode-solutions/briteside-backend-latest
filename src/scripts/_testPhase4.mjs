// Usage: node src/scripts/_testPhase4.mjs
// Simulates charge.dispute.created / .closed against a REAL row's payment
// intent, without needing an actual Stripe-triggered dispute. Tests the
// resolution logic, ledger debit/freeze, and credit-back — not the Stripe
// webhook wiring itself (use `stripe trigger charge.dispute.created` for that,
// which fires against an unmatched charge and only exercises the
// requiresManualReview fallback).
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();
const { db } = await import('../db/index.js');
const { priorityMessagePayments } = await import('../db/schema/index.js');
const { and, eq, gt, isNotNull, desc } = await import('drizzle-orm');
const { handleDisputeCreated, handleDisputeClosed } = await import('../services/paymentDispute.service.js');
const { PayoutLedgerService } = await import('../services/payoutLedger.service.js');

// A row that's ALREADY had its Standard release fire — tests the
// requiresManualReview=true path (money already partly transferred).
const row = await db.query.priorityMessagePayments.findFirst({
  where: and(eq(priorityMessagePayments.status, 'replied'), isNotNull(priorityMessagePayments.standardReleasedAt)),
  orderBy: desc(priorityMessagePayments.standardReleasedAt),
});
if (!row) {
  console.log('No suitable row found — need a priority_message_payments row with standardReleasedAt set.');
  process.exit(0);
}
console.log('Testing dispute against:', row.id, 'talentUserId:', row.talentUserId);

const fakeDispute = {
  id: `dp_test_${Date.now()}`,
  payment_intent: row.stripePaymentIntent,
  charge: `ch_test_${Date.now()}`,
  amount: 500, // $5.00 — smaller than the row's remaining reserve, on purpose
  reason: 'fraudulent',
};

console.log('\n=== 1. Dispute created ===');
const created = await handleDisputeCreated(fakeDispute);
console.log(created);

console.log('\n=== 2. Ledger should now be frozen ===');
console.log(await PayoutLedgerService.getOrCreateLedger(row.talentUserId));

console.log('\n=== 3. Dispute closed as LOST — debit stays, ledger unfreezes ===');
const lost = await handleDisputeClosed({ id: fakeDispute.id, status: 'lost' });
console.log(lost);
console.log(await PayoutLedgerService.getOrCreateLedger(row.talentUserId));

// Second dispute to test the WON path (credit-back)
const fakeDispute2 = { ...fakeDispute, id: `dp_test_won_${Date.now()}` };
console.log('\n=== 4. A second dispute, closed as WON — should credit back ===');
await handleDisputeCreated(fakeDispute2);
const ledgerFrozen = await PayoutLedgerService.getOrCreateLedger(row.talentUserId);
console.log('Frozen + debited:', ledgerFrozen);
const won = await handleDisputeClosed({ id: fakeDispute2.id, status: 'won' });
console.log(won);
console.log('After credit-back + unfreeze:', await PayoutLedgerService.getOrCreateLedger(row.talentUserId));

process.exit(0);
