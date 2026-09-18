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

// Flat, tiered order processing fee for Paid Messages specifically — separate
// table from the general one above. Applied to the total of the paid message
// fee + the 5% platform fee (not the message fee alone).
//
// Source table (dollars):
//   Under $10        $0.50
//   $10.01-$15       $0.75
//   $15.01-$20.00    $1.00
//   $20.01-$50       $1.30
//   $50.01-$100      $2.25
//   $100.01+         $3.25
const PAID_MESSAGE_PROCESSING_FEE_TIERS_CENTS = [
  { maxCents: 1_000, feeCents: 50 },
  { maxCents: 1_500, feeCents: 75 },
  { maxCents: 2_000, feeCents: 100 },
  { maxCents: 5_000, feeCents: 130 },
  { maxCents: 10_000, feeCents: 225 },
  { maxCents: Infinity, feeCents: 325 },
];

/**
 * @param {number} baseWithPlatformFeeCents - paid message base cost + 5% platform fee, in cents
 * @returns {number} flat processing fee in cents
 */
export function calculatePaidMessageProcessingFeeCents(baseWithPlatformFeeCents) {
  const amount = Math.max(0, Math.round(baseWithPlatformFeeCents) || 0);
  const tier = PAID_MESSAGE_PROCESSING_FEE_TIERS_CENTS.find(t => amount <= t.maxCents);
  return tier.feeCents;
}

// Flat 7.5% "Platform & Service Fee" — replaces the separate 5% platform fee
// + tiered order-processing-fee split for 1:1 Video, Paid Messages, and Shop.
// One merged line, shown to the customer as a dollar amount only (no %).
// Event ticketing is NOT part of this — it keeps its own organizer-configurable
// rate (see getReserveRate/platformFeePercentage in payment.service.js).
const PLATFORM_AND_SERVICE_FEE_RATE = 0.075;

/**
 * @param {number} baseCents - the pre-fee price in cents
 * @returns {number} the merged Platform & Service Fee in cents
 */
export function calculatePlatformAndServiceFeeCents(baseCents) {
  const amount = Math.max(0, Math.round(baseCents) || 0);
  return Math.round(amount * PLATFORM_AND_SERVICE_FEE_RATE);
}
