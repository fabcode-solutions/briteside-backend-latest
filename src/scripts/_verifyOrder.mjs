// Usage: node src/scripts/_verifyOrder.mjs <shopOrderId>
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();
const { db } = await import('../db/index.js');
const { shopOrders, creatorPayoutLedgers, payoutLedgerEntries } = await import('../db/schema/index.js');
const { eq } = await import('drizzle-orm');

const orderId = process.argv[2];
const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
console.log('Order:', {
  status: order.status,
  reserveAmountCents: order.reserveAmountCents,
  standardReleasedAt: order.standardReleasedAt,
  reserveReleasedAt: order.reserveReleasedAt,
  sellerId: order.sellerId,
});

const ledger = await db.query.creatorPayoutLedgers.findFirst({ where: eq(creatorPayoutLedgers.userId, order.sellerId) });
console.log('Seller ledger:', ledger);

const entries = await db.query.payoutLedgerEntries.findMany({ where: eq(payoutLedgerEntries.sourceId, orderId) });
console.log('Ledger entries for this order:', entries.map(e => ({ bucket: e.bucket, amountCents: e.amountCents, reason: e.reason })));
process.exit(0);
