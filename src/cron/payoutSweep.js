/**
 * src/cron/payoutSweep.js
 *
 * Phase 2 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md
 * §5, Phase 2): on the 1st and 15th of each month, sweep every 'auto'-mode
 * creator's ledger Available balance out to their bank, standard ACH,
 * skipping anyone below the floor (their balance just rolls to next cycle).
 *
 * Scheduled directly via cron ("0 2 1,15 * *" in cronJobs.js) rather than
 * Stripe's own `monthly_payout_days` — see PAYMENTS_ARCHITECTURE.md §4 for
 * why: that Balance Settings field also requires `interval: "monthly"`,
 * which conflicts with the `interval: "manual"` this whole ledger depends on
 * (Stripe would then try to auto-payout the RAW Connect balance itself,
 * racing this sweep and the Day 7/14/21 release logic underneath it).
 */

import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { creatorPayoutLedgers } from '../db/schema/stripeConnect.js';
import { cronLogger as logger } from '../config/logger.js';
import { PayoutLedgerService } from '../services/payoutLedger.service.js';
import { StripeConnectService } from '../services/stripeConnect.service.js';

// Doc range was "$25-50" without pinning an exact figure; $25 is the more
// creator-friendly end of that range (less of their money held past a
// sweep date just for being a few dollars short).
export const SWEEP_MINIMUM_FLOOR_CENTS = 2500;

export async function runPayoutSweep(force = false) {
  const ledgers = await db.query.creatorPayoutLedgers.findMany({
    where: and(
      eq(creatorPayoutLedgers.payoutSchedule, 'auto'),
      eq(creatorPayoutLedgers.disputeFrozen, false),
      gte(creatorPayoutLedgers.availableCents, SWEEP_MINIMUM_FLOOR_CENTS)
    ),
  });

  logger.info('[Cron] PayoutSweep: candidates found', { count: ledgers.length, force });

  let swept = 0;
  let skipped = 0;

  for (const ledger of ledgers) {
    try {
      // requestPayout independently re-verifies against the real Stripe
      // Connect balance and throws if payouts aren't enabled — same
      // defense-in-depth as the on-demand withdrawal path.
      const payout = await StripeConnectService.requestPayout(
        ledger.userId,
        ledger.availableCents,
        'standard',
        { source: 'scheduled_sweep' }
      );

      await PayoutLedgerService.debitAvailable(ledger.userId, ledger.availableCents, {
        sourceType: 'sweep',
        sourceId: null,
        reason: 'sweep_1st_15th',
        metadata: { payoutId: payout.id },
      });

      swept++;
      logger.info('[Cron] PayoutSweep: swept', {
        userId: ledger.userId,
        amountUsd: (ledger.availableCents / 100).toFixed(2),
        payoutId: payout.id,
      });
    } catch (err) {
      skipped++;
      logger.error('[Cron] PayoutSweep: sweep failed', {
        userId: ledger.userId,
        error: err.message,
      });
    }
  }

  return { swept, skipped, candidates: ledgers.length };
}
