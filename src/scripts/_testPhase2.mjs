// Usage: node src/scripts/_testPhase2.mjs
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();
const { PayoutLedgerService } = await import('../services/payoutLedger.service.js');
const { requestLedgerWithdrawal } = await import('../services/payoutWithdrawal.service.js');
const { runPayoutSweep } = await import('../cron/payoutSweep.js');

const userId = '1c8a7b84-67e3-4f8f-a88a-9f301ac3ab8a'; // change if needed

console.log('=== 1. Current ledger ===');
console.log(await PayoutLedgerService.getOrCreateLedger(userId));

console.log('\n=== 2. Toggle to manual, run sweep — this user should be SKIPPED ===');
await PayoutLedgerService.setPayoutSchedule(userId, 'manual');
console.log(await runPayoutSweep());

console.log('\n=== 3. Toggle back to auto ===');
await PayoutLedgerService.setPayoutSchedule(userId, 'auto');

console.log('\n=== 4. Withdraw $5.00 on demand ===');
const payout = await requestLedgerWithdrawal(userId, 500);
console.log('Payout created:', payout);
console.log('Ledger after withdrawal:', await PayoutLedgerService.getOrCreateLedger(userId));

console.log('\n=== 5. Run the real sweep — should sweep whatever remains above the $25 floor ===');
console.log(await runPayoutSweep());
console.log('Ledger after sweep:', await PayoutLedgerService.getOrCreateLedger(userId));

process.exit(0);
