import { describe, it, expect } from 'vitest';
import { computeExpiredRefund } from '../../src/services/priorityMessageRefund.js';

// 2 messages at $10 + 2 attachments (99¢) → base 2198, +7.5% fee 165 → 2363.
const payment = { amountCents: 2363, baseCents: 2198 };
const attachments = [
  { priceCents: 99, status: 'pending' },
  { priceCents: 99, status: 'viewed' },
];

describe('computeExpiredRefund', () => {
  it('refunds the whole charge once when nothing was answered (attachments not double-counted)', () => {
    const r = computeExpiredRefund({ ...payment, attachments, totalItems: 2, unrepliedItems: 2 });
    expect(r.isFullRefund).toBe(true);
    expect(r.refundCents).toBe(2363);
    expect(r.reserveCutCents).toBe(Infinity);
  });

  it('skips attachments a moderation refund already returned', () => {
    const r = computeExpiredRefund({
      ...payment,
      attachments: [attachments[0], { priceCents: 99, status: 'refunded' }],
      totalItems: 2,
      unrepliedItems: 2,
    });
    expect(r.refundCents).toBe(2363 - 99);
  });

  it('refunds only the unanswered share of the messages on a partial reply', () => {
    const r = computeExpiredRefund({ ...payment, attachments, totalItems: 2, unrepliedItems: 1 });
    expect(r.isFullRefund).toBe(false);
    // (2363 − 198) / 2, attachments stay with the talent
    expect(r.refundCents).toBe(1083);
    // talent loses the unanswered half of the message price only: (2198 − 198) / 2
    expect(r.reserveCutCents).toBe(1000);
    expect(r.refundCents).toBeLessThan(payment.amountCents);
  });

  it('never refunds more than was charged', () => {
    for (let unreplied = 1; unreplied <= 3; unreplied++) {
      const r = computeExpiredRefund({
        ...payment,
        attachments,
        totalItems: 3,
        unrepliedItems: unreplied,
      });
      expect(r.refundCents).toBeGreaterThanOrEqual(0);
      expect(r.refundCents).toBeLessThanOrEqual(payment.amountCents);
    }
  });
});
