// Flat, tiered order processing fee — charged once per order on the pre-fee subtotal.
// The entire fee is Briteside revenue; Stripe's own processing cost is a separate,
// Briteside-absorbed cost and must never be derived from or added to this table.
//
// Source table (dollars):
//   Under $20        $2
//   $20.01-$50       $3
//   $50.01-$100      $4
//   $100.01-$500     $6
//   $500.01-$1,000   $10
//   $1,000.01+       $30
const ORDER_PROCESSING_FEE_TIERS_CENTS = [
  { maxCents: 2_000, feeCents: 200 },
  { maxCents: 5_000, feeCents: 300 },
  { maxCents: 10_000, feeCents: 400 },
  { maxCents: 50_000, feeCents: 600 },
  { maxCents: 100_000, feeCents: 1_000 },
  { maxCents: Infinity, feeCents: 3_000 },
];

/**
 * @param {number} subtotalCents - order subtotal in cents, before the processing fee
 * @returns {number} flat processing fee in cents
 */
export function calculateOrderProcessingFeeCents(subtotalCents) {
  const amount = Math.max(0, Math.round(subtotalCents) || 0);
  const tier = ORDER_PROCESSING_FEE_TIERS_CENTS.find(t => amount <= t.maxCents);
  return tier.feeCents;
}

/**
 * @param {number|string} subtotal - order subtotal in dollars, before the processing fee
 * @returns {number} flat processing fee in dollars
 */
export function calculateOrderProcessingFee(subtotal) {
  const subtotalCents = Math.round((parseFloat(subtotal) || 0) * 100);
  return calculateOrderProcessingFeeCents(subtotalCents) / 100;
}
