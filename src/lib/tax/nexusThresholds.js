import { normalizeStateToAbbr } from './usStates.js';

// Source: briteside-frontend/TAX_STRATEGY.md §3.3 — ported from
// briteside-frontend/src/lib/tax/nexusThresholds.ts. These are Briteside's
// own economic-nexus thresholds for Briteside Plus — once platform-wide
// sales in a state cross this amount, Briteside must register and becomes
// the Marketplace Facilitator there. This does NOT decide whether tax is
// actually collected on a given transaction — Stripe Tax returns $0 by
// default without an active registration (TAX_STRATEGY.md §3.2). This is for
// monitoring/alerting so engineering/finance can register before the
// threshold is crossed; crossing it does not flip anything automatically.
// NOT reviewed by a tax attorney/CPA — provisional per the source doc.

export const DEFAULT_NEXUS_THRESHOLD = 100_000;

/** States with a higher-than-default economic nexus threshold. */
export const NEXUS_THRESHOLD_OVERRIDES = {
  CA: 500_000,
  NY: 500_000,
  TX: 500_000,
};

export function getNexusThreshold(state) {
  const abbr = normalizeStateToAbbr(state);
  if (!abbr) throw new Error(`Unrecognized US state for nexus threshold lookup: "${state}"`);
  return NEXUS_THRESHOLD_OVERRIDES[abbr] ?? DEFAULT_NEXUS_THRESHOLD;
}
