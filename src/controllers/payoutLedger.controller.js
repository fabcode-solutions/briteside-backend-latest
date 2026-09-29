import { catchAsync } from '../utils/catch-async.js';
import { PayoutLedgerService } from '../services/payoutLedger.service.js';
import { requestLedgerWithdrawal } from '../services/payoutWithdrawal.service.js';
import {
  computeEarlyPayoutEligibility,
  checkInstantPayoutEligibility,
  claimEarlyPayout,
} from '../services/earlyPayout.service.js';
import ApiError from '../utils/api-error.js';

// ─── LEDGER (Phase 1/2 of the payout architecture — see PAYMENTS_ARCHITECTURE.md) ──
//
// Distinct from the existing /me/wallet endpoints in talentEarnings.controller.js,
// which read the connected account's LIVE Stripe balance. These read the new
// Pending/Available/Reserve ledger instead — the phased-release bucket model
// that Stripe balance alone doesn't expose.

export const getLedger = catchAsync(async (req, res) => {
  const ledger = await PayoutLedgerService.getOrCreateLedger(req.user.id);
  res.json({ success: true, data: ledger });
});

export const setPayoutSchedule = catchAsync(async (req, res) => {
  const { mode } = req.body;
  if (mode !== 'auto' && mode !== 'manual') {
    throw new ApiError(400, "mode must be 'auto' or 'manual'");
  }
  const data = await PayoutLedgerService.setPayoutSchedule(req.user.id, mode);
  res.json({ success: true, data });
});

export const requestWithdrawal = catchAsync(async (req, res) => {
  const { amountCents } = req.body;
  const data = await requestLedgerWithdrawal(req.user.id, amountCents);
  res.status(201).json({ success: true, data });
});

// ─── EARLY PAYOUT (Phase 3) ─────────────────────────────────────────────────

export const getEarlyPayoutEligibility = catchAsync(async (req, res) => {
  const [eligibility, instantEligibility] = await Promise.all([
    computeEarlyPayoutEligibility(req.user.id),
    checkInstantPayoutEligibility(req.user.id),
  ]);
  res.json({ success: true, data: { ...eligibility, instant: instantEligibility } });
});

export const claimEarlyPayoutHandler = catchAsync(async (req, res) => {
  const data = await claimEarlyPayout(req.user.id);
  res.status(201).json({ success: true, data });
});
