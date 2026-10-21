import { normalizeStateToAbbr } from './usStates.js';

// Source: briteside-frontend/TAX_STRATEGY.md §2.1/§2.2, derived from
// Eventbrite's public tax compliance disclosures — NOT yet reviewed by a tax
// attorney/CPA for Briteside's own obligations (see TAX_STRATEGY.md §5). Do
// not treat this as legally authoritative until that review happens.
//
// Ported from briteside-frontend/src/lib/tax/eventTaxJurisdictions.ts. This
// MUST be the server-side source of truth — checkout tax calculation happens
// here, not from a client-supplied "this state is a facilitator state" flag,
// since a buyer or organizer could otherwise tamper with the request to
// avoid tax entirely. Keep in sync with the frontend copy by hand (it's used
// there only for organizer-facing UI copy, never as the checkout authority).

/** States (+ DC) where Briteside is legally required to be the Marketplace Facilitator for ticket sales — organizers cannot opt out. */
export const EVENT_MPF_STATES = new Set([
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IA',
  'KS',
  'KY',
  'LA',
  'MN',
  'MO',
  'NE',
  'NV',
  'NJ',
  'NM',
  'NC',
  'ND',
  'OK',
  'RI',
  'TN',
  'TX',
  'UT',
  'VT',
  'WA',
  'WV',
  'WI',
  'WY',
]);

/** States with sales tax where Briteside does NOT act as facilitator — liability shifts to the organizer via the Tax Tool. IL/OH/VA also have municipality-level carve-outs below. */
export const EVENT_NON_FACILITATOR_STATES = new Set([
  'AL',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'IL',
  'IN',
  'ME',
  'MD',
  'MA',
  'MI',
  'MS',
  'NY',
  'OH',
  'PA',
  'SC',
  'SD',
  'VA',
]);

/** States with no statewide sales tax (NOMAD). Alaska still allows local borough taxes, not modeled here since none appear in the source doc's municipality list. */
export const EVENT_NOMAD_STATES = new Set(['AK', 'DE', 'MT', 'NH', 'OR']);

/** Both source docs are US-sales-tax-only (no VAT/GST or international mention anywhere — confirmed, not assumed). A non-US country must never fall through to a state-name coincidence. */
const US_COUNTRY_NAMES = new Set(['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA']);

function isUsCountry(country) {
  if (!country) return true; // no country supplied — caller didn't have one to check; fall back to state-only matching
  return US_COUNTRY_NAMES.has(String(country).trim().toUpperCase());
}

/** Municipalities where Briteside is the facilitator for a local excise even though the state itself isn't. */
export const EVENT_MPF_MUNICIPALITIES = [
  { state: 'IL', city: 'Chicago', taxName: 'Chicago Amusement Tax' },
  { state: 'IL', city: 'Cook County', taxName: 'Cook County Amusement Tax' },
  { state: 'OH', city: 'Cincinnati', taxName: 'Cincinnati Admissions Excise' },
  { state: 'VA', city: 'Norfolk', taxName: 'Norfolk Admissions Tax' },
  { state: 'VA', city: 'Roanoke', taxName: 'Roanoke Admissions Tax' },
];

/**
 * Determines whether Briteside is the Marketplace Facilitator for a
 * ticketed event at the given venue location (TAX_STRATEGY.md §2.1/§2.2).
 * Returns 'unknown' rather than throwing for unrecognized/non-US input, so
 * checkout can fail toward charging no tax instead of crashing or guessing.
 *
 * @param {string|null|undefined} state
 * @param {string|null|undefined} [city]
 * @param {string|null|undefined} [country] - full name or code; non-US short-circuits to 'unknown' regardless of state
 * @returns {{ status: 'facilitator'|'organizer'|'no-sales-tax'|'unknown', municipality?: { state: string, city: string, taxName: string } }}
 */
export function getEventTaxStatus(state, city, country) {
  if (!isUsCountry(country)) return { status: 'unknown' };

  const abbr = normalizeStateToAbbr(state);
  if (!abbr) return { status: 'unknown' };

  if (city) {
    const municipality = EVENT_MPF_MUNICIPALITIES.find(
      m => m.state === abbr && m.city.toLowerCase() === String(city).trim().toLowerCase()
    );
    if (municipality) return { status: 'facilitator', municipality };
  }

  if (EVENT_MPF_STATES.has(abbr)) return { status: 'facilitator' };
  if (EVENT_NON_FACILITATOR_STATES.has(abbr)) return { status: 'organizer' };
  if (EVENT_NOMAD_STATES.has(abbr)) return { status: 'no-sales-tax' };

  return { status: 'unknown' };
}

/**
 * Stripe product tax codes for ticketed events (TAX_STRATEGY.md §2.3) —
 * distinct from the Briteside Plus codes in plusProductTaxCodes.js.
 *
 * `BUSINESS_CONFERENCE` exists in the spec but there is currently no signal
 * anywhere on the event model to reliably distinguish a business conference
 * from a general ticketed event (no `eventCategory: 'conference'` flag, no
 * category taxonomy mapping to it). Guessing a heuristic here risks
 * mis-taxing real events, so every event is tagged SPECTATOR_ADMISSIONS for
 * now. Revisit once there's an explicit product/category signal to split on.
 */
export const EVENT_TAX_CODES = {
  SPECTATOR_ADMISSIONS: 'txcd_50010003',
  BUSINESS_CONFERENCE: 'txcd_50013001',
};
