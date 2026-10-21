// Stripe product tax codes for Briteside Plus (digital goods / courses /
// bookings / services sold through creator shops) — TAX_STRATEGY.md §3.1.
// Distinct from the event ticketing codes in eventTaxJurisdictions.js.
//
// NOT reviewed by a tax attorney/CPA — the "services are exempt" assumption
// in particular is explicitly flagged as provisional in TAX_STRATEGY.md §5.

/**
 * Shop listing types (src/db/schema/shop.js `shopListingTypeEnum`):
 * 'product' | 'course' | 'service' | 'link'.
 *
 * TAX_STRATEGY.md's table is keyed by concept ("Digital Downloads",
 * "Courses", "1:1 Video Bookings", "Paid Messages", "Services") rather than
 * this app's literal listingType values. The mapping below is this app's
 * best-effort alignment:
 *   - 'course'  -> digital educational material (taxable)
 *   - 'service' -> personal/professional services (not taxable) — covers
 *                  both shop "service" listings and, by the same logic,
 *                  1:1 video bookings / paid messages handled elsewhere
 *                  (talentSession / priorityMessage flows), which also use
 *                  SERVICE_NOT_TAXABLE's code for consistency if/when they
 *                  add tax-code tagging.
 *   - 'product' -> digital product (taxable) UNLESS the listing is physical
 *                  (shopProducts.isPhysical), which neither source doc
 *                  addresses at all (TAX_STRATEGY.md §4) — left untaxed
 *                  with no tax code until a product/legal decision is made.
 *   - 'link'    -> redirect/external-fulfillment listings aren't covered by
 *                  either source doc either (TAX_STRATEGY.md §4) — left
 *                  untaxed.
 */
export const PLUS_TAX_CODES = {
  DIGITAL_PRODUCT: 'txcd_10000000',
  COURSE: 'txcd_10401000',
  SERVICE_NOT_TAXABLE: 'txcd_20030000',
};

/**
 * Resolves the Stripe tax code (and taxability) for a shop listing.
 *
 * Returns `{ taxCode: string, taxable: true }` for a type Stripe should
 * actually calculate tax on, or `{ taxCode: null, taxable: false }` for
 * anything that should ride through checkout untaxed — either because
 * TAX_STRATEGY.md says it's not taxable (services), or because neither
 * source doc covers it at all (physical products, link/redirect listings,
 * talent ratings — see TODOs below). Failing toward "untaxed" here is
 * deliberate: this feature hasn't had legal review, so an unmapped product
 * type must never silently become taxable.
 *
 * @param {{ listingType: string, isPhysical?: boolean }} listing
 */
export function resolvePlusTaxCode(listing) {
  if (!listing) return { taxCode: null, taxable: false };

  switch (listing.listingType) {
    case 'course':
      return { taxCode: PLUS_TAX_CODES.COURSE, taxable: true };

    case 'service':
      // 1:1 bookings / paid messages / freelance services — TAX_STRATEGY.md
      // §3.1 marks these not taxable. Still tagged with the services tax
      // code (rather than left blank) so Stripe Tax's own exemption logic
      // applies consistently instead of us hard-coding "0%" ourselves.
      return { taxCode: PLUS_TAX_CODES.SERVICE_NOT_TAXABLE, taxable: false };

    case 'product':
      if (listing.isPhysical) {
        // TODO(tax): physical products are not covered by either source PDF
        // (TAX_STRATEGY.md §4 "Shop / redirect products"). Shipping-based
        // sales tax has different sourcing rules (ship-to address, possible
        // shipping-cost taxability) that nobody has specified yet. Leave
        // untaxed rather than guessing a code — do not add one without a
        // product/legal decision.
        return { taxCode: null, taxable: false };
      }
      return { taxCode: PLUS_TAX_CODES.DIGITAL_PRODUCT, taxable: true };

    case 'link':
      // TODO(tax): redirect/external-checkout listings aren't covered by
      // either source doc (TAX_STRATEGY.md §4). Briteside also doesn't
      // control the actual payment for these (external checkout), so there
      // is nothing for Stripe Tax to calculate against here regardless.
      return { taxCode: null, taxable: false };

    default:
      // TODO(tax): covers anything not modeled above, e.g. talent ratings —
      // not a priced product type and not addressed by either source doc.
      return { taxCode: null, taxable: false };
  }
}
