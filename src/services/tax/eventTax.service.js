import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import config from '../../config/config.js';
import { db } from '../../db/index.js';
import { venues } from '../../db/schema/venues.js';
import { getEventTaxStatus, EVENT_TAX_CODES } from '../../lib/tax/eventTaxJurisdictions.js';
import { normalizeStateToAbbr } from '../../lib/tax/usStates.js';

// Event ticketing tax — TAX_STRATEGY.md §2, NOT reviewed by a tax
// attorney/CPA. Jurisdiction status is always derived server-side from the
// venue (src/lib/tax/eventTaxJurisdictions.js); never trust a client-supplied
// "this state is a facilitator state" flag.
//
// CORRECTED (was previously documented as a limitation — it no longer is):
// this used to pass only the venue's address as `customer_details.address`,
// on the belief that Stripe's Tax Calculation API had no real
// venue/performance-location concept. Stripe has since shipped exactly that
// (see docs.stripe.com/tax/tax-for-tickets) — live testing confirmed
// `txcd_50013001` (business conference) outright REJECTS a calculation with
// a 400 unless a `performance_location` is supplied, and the error only
// offers two ways to do it: a Tax Location id, or (per the error text) an
// inline address — but Stripe's own API reference for
// `line_items.performance_location` documents it as a plain string "tax
// location ID" only, created ahead of time via `POST /v1/tax/locations`
// (type: performance) and reused across transactions for the same site —
// see `_getOrCreatePerformanceLocation` below. `customer_details.address`
// is still sent alongside it (harmless, and still the fallback if location
// creation itself fails).
// For virtual events (no venue to anchor to), TAX_STRATEGY.md §2.4 already
// calls for buyer-billing-address sourcing, which maps directly onto
// Checkout's native `automatic_tax` (collected live during the hosted
// session) — see `_virtualAutomaticTax` below.
//
// Similarly, TAX_STRATEGY.md §2.3 describes the organizer's manual
// ratePercent as something "fed straight into the Stripe Tax Calculation as
// the rate." Stripe's Tax Calculation API has no parameter anywhere to force
// an arbitrary flat rate — rates are always derived from registrations/
// nexus. Since Briteside has no nexus in these organizer-collect states by
// definition (that's WHY the organizer is the one entering a rate), routing
// this through Stripe Tax isn't applicable here anyway. This computes the
// manual line item directly instead, which is the only real way to add a
// specific flat-rate charge Stripe didn't itself calculate.

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
}

export class EventTaxService {
  /**
   * @param {object} params
   * @param {{id?: string, address?: string, city?: string|null, state?: string|null, country?: string|null, countryCode?: string|null, postalCode?: string|null, stripeTaxLocationId?: string|null}|null} params.venue
   *   `id`/`stripeTaxLocationId` are optional — when present, lets the
   *   in-person facilitator branch reuse (or cache) a Stripe Tax Location
   *   instead of creating one fresh. See `_getOrCreatePerformanceLocation`.
   * @param {string} params.eventMode - 'in_person' | 'virtual'
   * @param {number} params.subtotalCents - the taxable "Buyer Total" (ticket subtotal + any passed-on platform fee — see TAX_STRATEGY.md §2.1; the caller in payment.service.js already adds the platform fee in before passing this).
   * @param {object|null} params.organizerTax - the event's persisted `tax` opt-in object, or null.
   * @param {boolean} [params.isBusinessConference] - Eventtax.pdf calls out
   *   two distinct Stripe product tax codes and warns "we need to make sure
   *   we apply the right product code" — applying the wrong one risks
   *   Stripe treating a taxable entertainment ticket as exempt, or vice
   *   versa. True selects the business-conference code; the caller (see
   *   payment.service.js) derives this from the event's seeded "Business"
   *   category, the only signal this app models for the distinction.
   * @returns {Promise<{
   *   jurisdictionStatus: 'facilitator'|'organizer'|'no-sales-tax'|'unknown',
   *   amountCents: number,
   *   absorbed: boolean,
   *   taxName: string|null,
   *   taxCode: string,
   *   automaticTax: { enabled: true } | null,
   * }>}
   *   `automaticTax` is non-null only for virtual facilitator-jurisdiction
   *   events — the caller should spread it onto the Checkout Session params
   *   (and must NOT also add `amountCents` as a manual line item in that
   *   case; Stripe computes it live). For every other branch, `amountCents`
   *   is the exact amount to add as an explicit line item (0 means no tax
   *   line at all).
   */
  static async computeTax({ venue, eventMode, subtotalCents, organizerTax, isBusinessConference = false }) {
    const taxCode = isBusinessConference
      ? EVENT_TAX_CODES.BUSINESS_CONFERENCE
      : EVENT_TAX_CODES.SPECTATOR_ADMISSIONS;
    const { status: jurisdictionStatus } = getEventTaxStatus(
      venue?.state,
      venue?.city,
      venue?.country || venue?.countryCode
    );

    const none = {
      jurisdictionStatus,
      amountCents: 0,
      absorbed: false,
      taxName: null,
      taxCode,
      automaticTax: null,
    };

    if (jurisdictionStatus === 'no-sales-tax' || jurisdictionStatus === 'unknown') {
      // Fail toward $0 — an unresolved venue/state must never be treated as
      // taxable just because we couldn't classify it.
      return none;
    }

    if (jurisdictionStatus === 'facilitator') {
      if (eventMode === 'virtual' || !venue?.address) {
        // No venue to anchor to — source from the buyer's billing address,
        // collected live by Checkout itself (TAX_STRATEGY.md §2.4).
        return { ...none, automaticTax: { enabled: true } };
      }
      const amountCents = await EventTaxService._calculateFacilitatorInPersonTax({
        venue,
        subtotalCents,
        taxCode,
      });
      return { ...none, amountCents };
    }

    // jurisdictionStatus === 'organizer' — only taxed if the organizer
    // explicitly opted in via the Tax Tool (TAX_STRATEGY.md §2.2).
    if (!organizerTax?.collectionEnabled) return none;

    // Mirrors Eventbrite's own hard requirement (TAX_STRATEGY.md §2.3/source
    // doc p.5): without a registration/TIN on file, "Eventbrite will not add
    // any tax line item... tickets will sell as tax-free." The frontend's
    // zod schema already blocks saving an event in this state, but checkout
    // must not rely on that alone — a stale event saved before this
    // validation existed, or any other write path, could still have
    // collectionEnabled:true with no registrationId.
    if (!organizerTax.registrationId?.trim()) return none;

    const ratePercent = Number(organizerTax.ratePercent);
    if (!Number.isFinite(ratePercent) || ratePercent <= 0) return none;

    const amountCents = Math.round(subtotalCents * (ratePercent / 100));
    return {
      ...none,
      amountCents,
      absorbed: !!organizerTax.absorbed,
      taxName: organizerTax.name || 'Tax',
    };
  }

  /**
   * Returns a reusable Stripe Tax Location (type: performance) id for this
   * venue, creating one if it doesn't have one cached yet. Stripe's own
   * guidance (docs.stripe.com/tax/tax-for-tickets) is to create one location
   * per physical site and reuse it across every calculation for it, rather
   * than minting a fresh one per ticket sale.
   *
   * Required for `txcd_50013001` (confirmed via a live 400 otherwise) and
   * documented as "required, optional, or not supported" depending on tax
   * code in general — supplying it whenever available is always safe.
   *
   * Falls back to null (not an error) on any failure — same fail-toward-$0
   * posture as the rest of this file. The caller's own address-based
   * calculation still proceeds without it; for a code that strictly
   * requires it, that calculation will itself then fail and correctly fall
   * back to $0 via the existing catch block below, rather than this
   * function throwing and blocking the sale.
   */
  static async _getOrCreatePerformanceLocation(venue) {
    if (venue?.stripeTaxLocationId) return venue.stripeTaxLocationId;
    if (!stripe) return null;

    try {
      const location = await stripe.tax.locations.create({
        type: 'performance',
        address: {
          line1: venue.address || undefined,
          city: venue.city || undefined,
          state: normalizeStateToAbbr(venue.state) || undefined,
          postal_code: venue.postalCode || undefined,
          country: venue.countryCode || 'US',
        },
      });
      if (venue?.id) {
        await db
          .update(venues)
          .set({ stripeTaxLocationId: location.id })
          .where(eq(venues.id, venue.id));
      }
      return location.id;
    } catch (err) {
      console.error('[EventTax] failed to create performance tax location, continuing without one:', err.message);
      return null;
    }
  }

  /**
   * Pre-checkout Stripe Tax Calculation anchored to the venue's address and
   * (when available) a cached performance Tax Location — see
   * `_getOrCreatePerformanceLocation`. Briteside is the liable party by
   * definition in a facilitator jurisdiction, so no `stripe_account`/
   * liability override is passed — this uses Briteside's own platform Tax
   * Settings/registrations. Falls toward $0 (not an error) if Stripe isn't
   * configured, the venue's state can't be normalized, or the calculation
   * call itself fails — a broken tax lookup must never block a sale or
   * guess a nonzero amount.
   */
  static async _calculateFacilitatorInPersonTax({ venue, subtotalCents, taxCode }) {
    if (!stripe || subtotalCents <= 0) return 0;

    const stateAbbr = normalizeStateToAbbr(venue.state);
    if (!stateAbbr) return 0;

    const performanceLocation = await EventTaxService._getOrCreatePerformanceLocation(venue);

    try {
      const calculation = await stripe.tax.calculations.create({
        currency: 'usd',
        line_items: [
          {
            amount: subtotalCents,
            reference: 'event_tickets',
            tax_code: taxCode,
            tax_behavior: 'exclusive',
            ...(performanceLocation ? { performance_location: performanceLocation } : {}),
          },
        ],
        customer_details: {
          address: {
            country: venue.countryCode || 'US',
            state: stateAbbr,
            city: venue.city || undefined,
            postal_code: venue.postalCode || undefined,
          },
          // Neither a real "billing" nor "shipping" address — this is the
          // venue's address standing in for Stripe Tax's address sourcing.
          // 'billing' is used since there is no third option; see the
          // module-level comment. Kept alongside performance_location —
          // harmless, and still the only input if location creation failed.
          address_source: 'billing',
        },
      });
      return calculation.tax_amount_exclusive ?? 0;
    } catch (err) {
      console.error('[EventTax] facilitator tax calculation failed, charging $0 tax:', err.message);
      return 0;
    }
  }
}
