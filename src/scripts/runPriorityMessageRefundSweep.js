// This script runs standalone via plain `node`, not through src/server.js
// (which is what normally loads dotenv/config first) — without this import,
// every env-dependent module initialized at import time (e.g. streamClient.js
// constructing a StreamClient with an undefined API secret) throws before
// main() ever runs.
import 'dotenv/config';
import { PriorityMessageService } from '../services/priorityMessage.service.js';

/**
 * One-off sweep: finds every priority message payment still 'paid'/'partial'
 * with paidAt more than 48h ago and processes it exactly like the recurring
 * cron (src/cron/priorityMessageRefund.js) does — refunds unreplied items via
 * Stripe and marks the payment 'refunded'/'partial_refunded' accordingly.
 *
 * Use this to clear an existing backlog immediately instead of waiting for
 * the next scheduled cron tick.
 *
 * Usage: node src/scripts/runPriorityMessageRefundSweep.js
 */
async function main() {
  console.log('Running PriorityMessageService.processExpiredRefunds()...');
  await PriorityMessageService.processExpiredRefunds();
  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
