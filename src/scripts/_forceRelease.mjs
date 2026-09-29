// Usage: node src/scripts/_forceRelease.mjs
// Runs the FULL reserve-release pass with force=true, bypassing the
// 14/21-day cutoff so you can watch a test transaction release immediately
// instead of waiting real days. Safe to run repeatedly — every flow's
// release functions are idempotent (gated by standardReleasedAt/
// reserveReleasedAt already being set).
import { loadSecrets } from '../config/secrets.js';
await loadSecrets();
const { runReserveRelease } = await import('../cron/reserveRelease.js');

const result = await runReserveRelease(true);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
