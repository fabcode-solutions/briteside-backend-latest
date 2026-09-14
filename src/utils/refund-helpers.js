// Basic refund helper utilities
/**
 * Simple helpers used for refund eligibility checks
 */
export function isTicketUsed(ticket) {
  if (!ticket) return false;
  return !!ticket.isUsed || (typeof ticket.scanCount === 'number' && ticket.scanCount > 0);
}

export function isEventRefundable(event) {
  if (!event) return false;
  return !!event.isRefundable;
}

export function isWithinRefundWindow(event) {
  if (!event || !event.startDate) return false;
  const cutoffDays = typeof event.refundCutoffDays === 'number' ? event.refundCutoffDays : 3;
  const start = new Date(event.startDate).getTime();
  const now = Date.now();
  const msInDay = 24 * 60 * 60 * 1000;
  // Refund allowed if now <= startDate - cutoffDays
  return now <= start - cutoffDays * msInDay;
}

/**
 * Fetch full fee breakdown for a refund from Stripe.
 * Returns: paymentAmount, stripeProcessingFee, refundedAmount, netAmount (cents + decimal string).
 * Mirrors the breakdown shown in the Stripe dashboard.
 */
export async function fetchStripeRefundMeta(stripe, paymentIntentId, stripeRefundId) {
  try {
    const [pi, stripeRefund] = await Promise.all([
      stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      }),
      stripe.refunds.retrieve(stripeRefundId),
    ]);

    const charge = pi.latest_charge;
    const balanceTxn = charge?.balance_transaction;

    const paymentAmountCents = charge?.amount ?? 0;
    const stripeProcessingFeeCents = balanceTxn?.fee ?? 0;
    const refundedAmountCents = stripeRefund.amount;
    const netAmountCents = paymentAmountCents - stripeProcessingFeeCents - refundedAmountCents;

    return {
      paymentAmountCents,
      paymentAmount: (paymentAmountCents / 100).toFixed(2),
      stripeProcessingFeeCents,
      stripeProcessingFee: (stripeProcessingFeeCents / 100).toFixed(2),
      refundedAmountCents,
      refundedAmount: (refundedAmountCents / 100).toFixed(2),
      netAmountCents,
      netAmount: (netAmountCents / 100).toFixed(2),
      stripeChargeId: charge?.id ?? null,
      stripeBalanceTxnId: balanceTxn?.id ?? null,
      currency: stripeRefund.currency ?? 'usd',
    };
  } catch (err) {
    console.error('[fetchStripeRefundMeta] failed:', err.message);
    return null;
  }
}

export function formatRefundableResult(items) {
  // For readability in controllers
  return items.map(it => ({
    orderItemId: it.orderItemId,
    itemType: it.itemType,
    refundableIds: it.refundableIds || [],
    nonRefundableIds: it.nonRefundableIds || [],
    reasons: it.reasons || [],
  }));
}
