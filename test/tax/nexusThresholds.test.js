import { describe, it, expect } from 'vitest';
import { getNexusThreshold, DEFAULT_NEXUS_THRESHOLD } from '../../src/lib/tax/nexusThresholds.js';

describe('getNexusThreshold', () => {
  it('returns the default $100k threshold for a normal state', () => {
    expect(getNexusThreshold('Florida')).toBe(DEFAULT_NEXUS_THRESHOLD);
  });

  it('returns the $500k override for CA, NY, TX', () => {
    expect(getNexusThreshold('California')).toBe(500_000);
    expect(getNexusThreshold('NY')).toBe(500_000);
    expect(getNexusThreshold('tx')).toBe(500_000);
  });

  it('throws on an unrecognized state rather than silently defaulting', () => {
    expect(() => getNexusThreshold('Narnia')).toThrow();
  });
});
