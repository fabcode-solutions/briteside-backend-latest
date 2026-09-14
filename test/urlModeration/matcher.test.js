import { describe, it, expect, beforeEach } from 'vitest';
import { matchHostname, __setAllowlistForTests } from '../../src/services/urlModeration/matcher.js';
import { publish } from '../../src/services/urlModeration/blocklistManager.js';
import { CATEGORY, addCategory } from '../../src/services/urlModeration/types.js';

function fixtureSnapshot() {
  const domainMap = new Map();
  domainMap.set('blockedadult.com', addCategory(0, CATEGORY.ADULT));
  domainMap.set('blockedgambling.com', addCategory(0, CATEGORY.GAMBLING));
  domainMap.set('blockedphish.com', addCategory(0, CATEGORY.PHISHING));
  domainMap.set('multicat.com', addCategory(addCategory(0, CATEGORY.ADULT), CATEGORY.GAMBLING));
  domainMap.set('example.co.uk', addCategory(0, CATEGORY.SCAM));

  const keywordMap = new Map();
  keywordMap.set('pornhub', addCategory(0, CATEGORY.ADULT));

  return { domainMap, keywordMap, version: 'test', builtAt: new Date(), sourceStats: [] };
}

describe('matchHostname', () => {
  beforeEach(() => {
    publish(fixtureSnapshot());
    __setAllowlistForTests([]);
  });

  it('allows a normal, unlisted domain', () => {
    expect(matchHostname('google.com').blocked).toBe(false);
  });

  it('blocks a listed adult domain', () => {
    const result = matchHostname('blockedadult.com');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('ADULT');
  });

  it('blocks a listed gambling domain', () => {
    const result = matchHostname('blockedgambling.com');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('GAMBLING');
  });

  it('blocks a listed phishing domain', () => {
    const result = matchHostname('blockedphish.com');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('PHISHING');
  });

  it('matches regardless of case', () => {
    expect(matchHostname('BlockedAdult.COM').blocked).toBe(true);
  });

  it('blocks a subdomain of a blocked registrable domain', () => {
    expect(matchHostname('sub.blockedadult.com').blocked).toBe(true);
  });

  it('blocks a www.-prefixed blocked domain', () => {
    expect(matchHostname('www.blockedadult.com').blocked).toBe(true);
  });

  it('reports every category a domain belongs to', () => {
    const result = matchHostname('multicat.com');
    expect(result.categories.sort()).toEqual(['ADULT', 'GAMBLING']);
  });

  it('correctly matches a multi-part TLD (co.uk) without over- or under-matching', () => {
    expect(matchHostname('example.co.uk').blocked).toBe(true);
    expect(matchHostname('notexample.co.uk').blocked).toBe(false);
  });

  it('matches a curated keyword against any TLD via exact label match', () => {
    expect(matchHostname('pornhub.com').blocked).toBe(true);
    expect(matchHostname('m.pornhub.org').blocked).toBe(true);
  });

  it('does not false-positive a keyword as a substring of an unrelated label', () => {
    // "pornhub" must match the whole label, not appear inside a longer one
    expect(matchHostname('notpornhubatall.com').blocked).toBe(false);
  });

  it('lets an explicit allowlist entry override a match', () => {
    __setAllowlistForTests(['blockedadult.com']);
    expect(matchHostname('blockedadult.com').blocked).toBe(false);
  });

  it('does not throw and returns unblocked for IP-literal hosts', () => {
    expect(matchHostname('127.0.0.1').blocked).toBe(false);
  });
});
