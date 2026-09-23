import { eq, and, inArray, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { PriorityMessageService } from '../services/priorityMessage.service.js';

async function findTargetPayment(args) {
  if (args.paymentId) {
    return db.query.priorityMessagePayments.findFirst({
      where: eq(priorityMessagePayments.id, args.paymentId),
    });
  }

  if (args.conversationId) {
    return db.query.priorityMessagePayments.findFirst({
      where: and(
        eq(priorityMessagePayments.conversationId, args.conversationId),
        inArray(priorityMessagePayments.status, ['paid', 'partial'])
      ),
      orderBy: (p, { desc }) => [desc(p.paidAt)],
    });
  }

  if (args.senderId && args.talentUserId) {
    return db.query.priorityMessagePayments.findFirst({
      where: and(
        eq(priorityMessagePayments.senderId, args.senderId),
        eq(priorityMessagePayments.talentUserId, args.talentUserId),
        inArray(priorityMessagePayments.status, ['paid', 'partial'])
      ),
      orderBy: (p, { desc }) => [desc(p.paidAt)],
    });
  }

  return null;
}

function parseArgs(argv) {
  const args = {};
  if (argv[0] && !argv[0].startsWith('--')) {
    args.paymentId = argv[0];
    return args;
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--conversation') args.conversationId = argv[++i];
    if (argv[i] === '--sender') args.senderId = argv[++i];
    if (argv[i] === '--talent') args.talentUserId = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.paymentId && !args.conversationId && !(args.senderId && args.talentUserId)) {
    console.error(
      'Usage:\n' +
        '  node scripts/testExpirePriorityMessage.js <paymentId>\n' +
        '  node scripts/testExpirePriorityMessage.js --conversation <conversationId>\n' +
        '  node scripts/testExpirePriorityMessage.js --sender <senderId> --talent <talentUserId>'
    );
    process.exit(1);
  }

  const payment = await findTargetPayment(args);

  if (!payment) {
    console.error('No matching payment found (must be status "paid" or "partial").');
    process.exit(1);
  }

  if (!['paid', 'partial'].includes(payment.status)) {
    console.error(`Payment ${payment.id} has status "${payment.status}" — not eligible for expiry (needs "paid" or "partial").`);
    process.exit(1);
  }

  console.log(`Target payment: ${payment.id}`);
  console.log(`  status: ${payment.status}`);
  console.log(`  paidAt: ${payment.paidAt}`);
  console.log(`  stripePaymentIntent: ${payment.stripePaymentIntent || '(none)'}`);

  if (!payment.stripePaymentIntent) {
    console.warn(
      '  ⚠ No stripePaymentIntent on this payment — processExpiredRefunds() will skip the ' +
        'Stripe refund call and leave status unchanged (see its own guard). If you need to see ' +
        'a status change, use a payment created through a real (even test-mode) Stripe Checkout.'
    );
  }

  // Backdate paidAt to 49h ago — 1h past the 48h cutoff used in processExpiredRefunds().
  const backdatedPaidAt = new Date(Date.now() - 49 * 60 * 60 * 1000);

  await db
    .update(priorityMessagePayments)
    .set({ paidAt: backdatedPaidAt, updatedAt: new Date() })
    .where(eq(priorityMessagePayments.id, payment.id));

  console.log(`Backdated paidAt -> ${backdatedPaidAt.toISOString()}`);
  console.log('Running PriorityMessageService.processExpiredRefunds()...');

  await PriorityMessageService.processExpiredRefunds();

  const updated = await db.query.priorityMessagePayments.findFirst({
    where: eq(priorityMessagePayments.id, payment.id),
  });

  console.log('Result:');
  console.log(`  status: ${updated.status}`);
  console.log(`  refundedAt: ${updated.refundedAt}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});