// Ported from briteside-frontend/src/lib/tax/usStates.ts to keep the backend's
// jurisdiction lookup (the one that actually gates tax collection at
// checkout) in lockstep with the frontend's informational copy. Keep both in
// sync by hand until these lists live in one shared place.
//
// Standard two-letter USPS abbreviations, keyed by full state/district name.
// Venue and address data elsewhere in this app may store either form, so tax
// jurisdiction lookups normalize to the abbreviation before matching against
// the lists in eventTaxJurisdictions.js / nexusThresholds.js.
export const STATE_NAME_TO_ABBR = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
};

const VALID_ABBRS = new Set(Object.values(STATE_NAME_TO_ABBR));

/** Accepts a full state name or a 2-letter abbreviation (any case/whitespace) and returns the USPS abbreviation, or null if unrecognized. */
export function normalizeStateToAbbr(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return VALID_ABBRS.has(upper) ? upper : null;
  }

  if (STATE_NAME_TO_ABBR[trimmed]) return STATE_NAME_TO_ABBR[trimmed];

  const lower = trimmed.toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    if (name.toLowerCase() === lower) return abbr;
  }
  return null;
}
