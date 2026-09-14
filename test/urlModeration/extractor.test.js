import { describe, it, expect } from 'vitest';
import { extractUrls } from '../../src/services/urlModeration/extractor.js';

describe('extractUrls', () => {
  it('extracts a plain https URL', () => {
    const [result] = extractUrls('check this out https://example.com/page');
    expect(result.hostname).toBe('example.com');
  });

  it('extracts a www.-prefixed bare domain', () => {
    const [result] = extractUrls('go to www.example.com now');
    expect(result.hostname).toBe('www.example.com');
  });

  it('extracts a bare domain with a path and no scheme', () => {
    const [result] = extractUrls('example.com/some/path');
    expect(result.hostname).toBe('example.com');
  });

  it('extracts multiple URLs from the same text', () => {
    const results = extractUrls('see https://a.com and http://b.com and www.c.com');
    expect(results.map(r => r.hostname)).toEqual(['a.com', 'b.com', 'www.c.com']);
  });

  it('keeps the hostname when the URL has a port, query string, and fragment', () => {
    const [result] = extractUrls('https://example.com:8443/path?x=1&y=2#section');
    expect(result.hostname).toBe('example.com');
  });

  it('does not throw on a malformed "URL"', () => {
    expect(() => extractUrls('http://[not-valid')).not.toThrow();
  });

  it('handles a very long URL without hanging or throwing', () => {
    const longPath = 'a'.repeat(5000);
    const start = Date.now();
    expect(() => extractUrls(`https://example.com/${longPath}`)).not.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('finds a URL nested inside a stringified object (scanText use case)', () => {
    const results = extractUrls({ label: 'click me', url: 'https://example.com' });
    expect(results.some(r => r.hostname === 'example.com')).toBe(true);
  });

  it('returns an empty array for null/undefined/empty content', () => {
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
    expect(extractUrls('')).toEqual([]);
  });
});
