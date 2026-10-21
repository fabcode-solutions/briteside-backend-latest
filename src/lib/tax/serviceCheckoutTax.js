// Shared tax-tagging helpers for Checkout-Session-based "personal/
// professional service" bookings — 1:1 video sessions (talentSession.service.js)
// and priority messages (priorityMessage.service.js). TAX_STRATEGY.md §3.1
// puts both in the same bucket as shop's 'service' listing type: exempt in
// almost all states regardless of who has nexus, tagged with
// PLUS_TAX_CODES.SERVICE_NOT_TAXABLE (txcd_20030000) so Stripe Tax's own
// exemption logic applies instead of us hard-coding "0%".
//
// Pulled out as their own small pure functions (rather than duplicated
// inline in both service files) so the automatic_tax gating condition and
// the reserve-bump math stay byte-for-byte identical in both places and are
// unit-testable without mocking Stripe/DB. NOT reviewed by a tax
// attorney/CPA, same disclaimer as everywhere else under src/lib/tax and
// src/services/tax.

import { PLUS_TAX_CODES } from './plusProductTaxCodes.js';

/** The one Stripe product tax code both service-booking flows ever use —
 *  re-exported here so callers don't need a second import from
 *  plusProductTaxCodes.js just for this one constant. */
export const SERVICE_TAX_CODE = PLUS_TAX_CODES.SERVICE_NOT_TAXABLE;

/**
 * Whether/how to enable `automatic_tax` on a service-booking Checkout
 * Session, given the liability PlusTaxLiabilityService.resolveLiability()
 * resolved for the seller (talent). Mirrors
 * ShopOrderService._createHostedOrderSession's exact conditional: only
 * enabled when a liable party was actually found — absent one (no
 * registration anywhere, lookup failure, Stripe not configured), checkout
 * fails toward charging no tax rather than enabling automatic_tax against an
 * unconfigured Tax Settings default.
 *
 * @param {{ type: 'self' } | { type: 'account', account: string } | null} liability
 * @returns {{ enabled: true, liability: object } | undefined}
 */
export function buildServiceAutomaticTax(liability) {
  return liability ? { enabled: true, liability } : undefined;
}

/**
 * When the CREATOR/TALENT is the liable party, TAX_STRATEGY.md §3.6 requires
 * the collected tax to flow into their own payout alongside their earnings
 * ("Briteside never holds the $7.50") — same rule ShopOrderService.
 * handlePaymentWebhook already applies to sellerReceiveCents. When Briteside
 * itself is liable (or no tax was collected), the base reserve is returned
 * unchanged — the tax portion already sits in Briteside's own platform
 * balance for Briteside to remit.
 *
 * @param {number} baseReserveCents
 * @param {number} taxAmountCents
 * @param {'account' | 'self' | 'none'} taxLiability
 */
export function applyTaxLiabilityToReserve(baseReserveCents, taxAmountCents, taxLiability) {
  return taxLiability === 'account' ? baseReserveCents + (taxAmountCents || 0) : baseReserveCents;
}
