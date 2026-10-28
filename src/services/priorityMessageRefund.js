/**
 * Amounts for the 72h no-reply refund of a Stripe-paid priority message
 * batch (PriorityMessageService.processExpiredRefunds). Pure, so the money
 * math is unit-testable without Stripe or the DB.
 *
 * amountCents already includes the attachment fees (99¢ each) and the
 * platform fee. Nothing answered → everything not already refunded goes back
 * (a moderation refund may have returned some attachments). Partly answered
 * → only the unanswered share of the message price; the talent keeps the
 * attachments.
 *
 * reserveCutCents is how much of the talent's held cut to drop: all of it on
 * a full refund (Infinity — callers cap at the current reserve), otherwise
 * the unanswered share of the talent's message earnings (baseCents minus
 * attachments; the platform fee was never theirs).
 */
export function computeExpiredRefund({
  amountCents,
  baseCents,
  attachments,
  totalItems,
  unrepliedItems,
}) {
  const attachmentCents = attachments.reduce((sum, a) => sum + a.priceCents, 0);
  const refundedAttachmentCents = attachments
    .filter(a => a.status === 'refunded')
    .reduce((sum, a) => sum + a.priceCents, 0);
  const isFullRefund = unrepliedItems === totalItems;
  const ratio = unrepliedItems / totalItems;

  if (isFullRefund) {
    return {
      isFullRefund,
      refundCents: Math.max(0, amountCents - refundedAttachmentCents),
      reserveCutCents: Infinity,
    };
  }
  return {
    isFullRefund,
    refundCents: Math.max(0, Math.round((amountCents - attachmentCents) * ratio)),
    reserveCutCents: Math.max(0, Math.round(((baseCents ?? 0) - attachmentCents) * ratio)),
  };
}
