import { describe, it, expect } from 'vitest';
import { normalizeHostname, candidateSuffixes } from '../../src/services/urlModeration/normalizer.js';

describe('normalizeHostname', () => {
  it('lowercases uppercase domains', () => {
    expect(normalizeHostname('EXAMPLE.COM').hostname).toBe('example.com');
  });

  it('strips a trailing dot', () => {
    expect(normalizeHostname('example.com.').hostname).toBe('example.com');
  });

  it('resolves the registrable domain (eTLD+1) for a subdomain', () => {
    const result = normalizeHostname('a.b.example.com');
    expect(result.registrableDomain).toBe('example.com');
  });

  it('handles multi-part TLDs correctly (co.uk)', () => {
    const result = normalizeHostname('shop.example.co.uk');
    expect(result.registrableDomain).toBe('example.co.uk');
  });

  it('flags IP literals instead of returning a registrable domain', () => {
    const result = normalizeHostname('127.0.0.1');
    expect(result.isIp).toBe(true);
    expect(result.registrableDomain).toBeNull();
  });

  it('returns null for empty/invalid input', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
  });

  it('strips control characters and whitespace defensively', () => {
    const result = normalizeHostname('exa\r\nmple.com');
    expect(result.hostname).toBe('example.com');
  });
});

describe('candidateSuffixes', () => {
  it('walks from full hostname down to the registrable domain, inclusive', () => {
    const normalized = normalizeHostname('a.b.example.com');
    expect(candidateSuffixes(normalized)).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
  });

  it('never walks past the registrable domain into a bare public suffix', () => {
    const normalized = normalizeHostname('example.co.uk');
    expect(candidateSuffixes(normalized)).toEqual(['example.co.uk']);
  });
});
