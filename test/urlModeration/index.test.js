import { describe, it, expect, beforeEach } from 'vitest';
import { checkContentForBlockedUrls } from '../../src/services/urlModeration/index.js';
import { publish } from '../../src/services/urlModeration/blocklistManager.js';
import { CATEGORY, addCategory } from '../../src/services/urlModeration/types.js';

beforeEach(() => {
  const domainMap = new Map([['blocked.com', addCategory(0, CATEGORY.ADULT)]]);
  publish({ domainMap, keywordMap: new Map(), version: 'test', builtAt: new Date(), sourceStats: [] });
});

describe('checkContentForBlockedUrls', () => {
  it('allows content with no URLs at all', () => {
    const result = checkContentForBlockedUrls('just some plain text, no links here');
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('allows content whose only URL is not on the blocklist', () => {
    const result = checkContentForBlockedUrls('check out https://google.com');
    expect(result.allowed).toBe(true);
  });

  it('blocks content containing a single blocked URL', () => {
    const result = checkContentForBlockedUrls('visit https://blocked.com now');
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].domain).toBe('blocked.com');
    expect(result.violations[0].categories).toContain('ADULT');
  });

  it('flags every blocked URL when multiple URLs are present, ignoring the allowed ones', () => {
    const result = checkContentForBlockedUrls(
      'good link https://google.com, bad link https://blocked.com, another good https://example.org'
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].domain).toBe('blocked.com');
  });

  it('works on an object payload (e.g. buttonMeta), not just a plain string', () => {
    const result = checkContentForBlockedUrls({ label: 'Shop now', url: 'https://blocked.com' });
    expect(result.allowed).toBe(false);
  });
});
