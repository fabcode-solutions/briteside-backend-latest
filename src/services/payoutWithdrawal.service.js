/**
 * src/services/payoutWithdrawal.service.js
 *
 * Phase 2 of the paymentsnew.pdf payout architecture (see PAYMENTS_ARCHITECTURE.md
 * §5, Phase 2): "manual on-demand withdrawal reuses requestCashout's existing
 * stripe.payouts.create() call, adapted to debit the ledger's availableCents
 * instead of the current live-Stripe-balance computation."
 *
 * Distinct from talentEarnings.service.js's requestCashout: that method is
 * talent-role-scoped (talent_session + priority_message + shop net earnings
 * only, recorded into the role-scoped talent_payouts table). This withdrawal
 * draws from the NEW per-user ledger's availableCents bucket instead, which
 * is fed by all 5 flows regardless of role — so a pure shop seller with no
 * talent profile can withdraw too. It intentionally does not touch
 * talent_payouts; the ledger's own payoutLedgerEntries is this withdrawal's
 * audit trail.
 */

import ApiError from '../utils/api-error.js';
import { cronLogger as logger } from '../config/logger.js';
import { PayoutLedgerService } from './payoutLedger.service.js';
import { StripeConnectService } from './stripeConnect.service.js';

/**
 * Withdraws up to the creator's current ledger Available balance, standard
 * (free, 2-3 business day ACH) payout — separate from the scheduled 1st/15th
 * sweep. StripeConnectService.requestPayout independently re-checks the
 * REAL Stripe Connect balance before creating the payout, so this is
 * defense-in-depth: the ledger gates it first, Stripe gates it again.
 */
export async function requestLedgerWithdrawal(userId, amountCents) {
  if (!amountCents || amountCents < 100) {
    throw new ApiError(400, 'Minimum withdrawal is $1.00');
  }

  const ledger = await PayoutLedgerService.getOrCreateLedger(userId);
  if (ledger.disputeFrozen) {
    throw new ApiError(403, 'Withdrawals are paused while a payment dispute on your account is under review.');
  }
  if (amountCents > ledger.availableCents) {
    throw new ApiError(
      400,
      `Insufficient available balance. Available: ${ledger.availableCents} cents`
    );
  }

  const payout = await StripeConnectService.requestPayout(userId, amountCents, 'standard', {
    source: 'ledger_manual_withdrawal',
  });

  // debitAvailable does the actual balance mutation (a SQL-level decrement,
  // not a blind set from the pre-payout snapshot above) plus the audit entry
  // — it's the only place availableCents should ever decrease.
  await PayoutLedgerService.debitAvailable(userId, amountCents, {
    sourceType: 'manual_withdrawal',
    sourceId: null,
    reason: 'manual_withdrawal',
    metadata: { payoutId: payout.id },
  }).catch(err =>
    logger.error('[PayoutWithdrawal] ledger debit failed', {
      userId,
      payoutId: payout.id,
      error: err.message,
    })
  );

  return { id: payout.id, amountCents, status: payout.status };
}
