import { describe, it, expect } from 'vitest';
import {
  getEventTaxStatus,
  EVENT_MPF_STATES,
  EVENT_NON_FACILITATOR_STATES,
  EVENT_NOMAD_STATES,
  EVENT_MPF_MUNICIPALITIES,
} from '../../src/lib/tax/eventTaxJurisdictions.js';

describe('getEventTaxStatus', () => {
  it('classifies a Marketplace Facilitator state as facilitator', () => {
    expect(getEventTaxStatus('Florida')).toEqual({ status: 'facilitator' });
    expect(getEventTaxStatus('TX')).toEqual({ status: 'facilitator' });
  });

  it('classifies a non-facilitator state (organizer Tax Tool) as organizer', () => {
    expect(getEventTaxStatus('California')).toEqual({ status: 'organizer' });
    expect(getEventTaxStatus('al')).toEqual({ status: 'organizer' });
  });

  it('classifies a NOMAD state as no-sales-tax', () => {
    expect(getEventTaxStatus('Oregon')).toEqual({ status: 'no-sales-tax' });
    expect(getEventTaxStatus('DE')).toEqual({ status: 'no-sales-tax' });
  });

  it('returns unknown for unrecognized or missing input rather than guessing', () => {
    expect(getEventTaxStatus(null)).toEqual({ status: 'unknown' });
    expect(getEventTaxStatus(undefined)).toEqual({ status: 'unknown' });
    expect(getEventTaxStatus('Narnia')).toEqual({ status: 'unknown' });
    expect(getEventTaxStatus('')).toEqual({ status: 'unknown' });
  });

  it('upgrades a non-facilitator state to facilitator for a carve-out municipality', () => {
    // Illinois is a non-facilitator state statewide, but Chicago/Cook County
    // amusement tax makes Briteside the facilitator for those specific cities.
    const result = getEventTaxStatus('IL', 'Chicago');
    expect(result.status).toBe('facilitator');
    expect(result.municipality).toEqual({
      state: 'IL',
      city: 'Chicago',
      taxName: 'Chicago Amusement Tax',
    });
  });

  it('does not upgrade a non-carve-out city in an otherwise non-facilitator state', () => {
    expect(getEventTaxStatus('IL', 'Springfield')).toEqual({ status: 'organizer' });
  });

  it('municipality city match is case/whitespace insensitive', () => {
    expect(getEventTaxStatus('VA', '  norfolk  ').status).toBe('facilitator');
  });

  it('every municipality carve-out state is itself a non-facilitator state', () => {
    // Sanity check on the source lists themselves — a facilitator *state*
    // doesn't need a municipality carve-out; the carve-outs only make sense
    // for states that are otherwise organizer-collect.
    for (const m of EVENT_MPF_MUNICIPALITIES) {
      expect(EVENT_NON_FACILITATOR_STATES.has(m.state)).toBe(true);
      expect(EVENT_MPF_STATES.has(m.state)).toBe(false);
    }
  });

  it('the three jurisdiction sets never overlap', () => {
    for (const s of EVENT_MPF_STATES) {
      expect(EVENT_NON_FACILITATOR_STATES.has(s)).toBe(false);
      expect(EVENT_NOMAD_STATES.has(s)).toBe(false);
    }
    for (const s of EVENT_NON_FACILITATOR_STATES) {
      expect(EVENT_NOMAD_STATES.has(s)).toBe(false);
    }
  });

  it('is US-only — a non-US country short-circuits to unknown regardless of a matching state name', () => {
    // Both source docs are entirely US-sales-tax-focused (confirmed, not
    // assumed — see TAX_STRATEGY.md). A non-US venue must never be taxed
    // just because its state/province string happens to match a US state.
    expect(getEventTaxStatus('Texas', null, 'Canada')).toEqual({ status: 'unknown' });
    expect(getEventTaxStatus('TX', null, 'CA')).toEqual({ status: 'unknown' }); // 'CA' as a country code (Canada), not the state
  });

  it('treats a missing country as US, same as before this parameter existed', () => {
    expect(getEventTaxStatus('Florida')).toEqual({ status: 'facilitator' });
    expect(getEventTaxStatus('Florida', null, 'US')).toEqual({ status: 'facilitator' });
    expect(getEventTaxStatus('Florida', null, 'United States')).toEqual({ status: 'facilitator' });
    expect(getEventTaxStatus('Florida', null, '  united states of america  ')).toEqual({
      status: 'facilitator',
    });
  });
});
