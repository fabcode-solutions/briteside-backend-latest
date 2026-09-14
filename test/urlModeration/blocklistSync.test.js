import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CATEGORY } from '../../src/services/urlModeration/types.js';

const FAKE_SOURCES = [
  { id: 'fake-adult', url: 'https://fake/adult.txt', category: CATEGORY.ADULT, parser: 'hosts', minDomains: 2 },
  {
    id: 'fake-gambling',
    url: 'https://fake/gambling.txt',
    category: CATEGORY.GAMBLING,
    parser: 'plainList',
    minDomains: 2,
  },
  {
    id: 'fake-flaky',
    url: 'https://fake/flaky.txt',
    category: CATEGORY.SCAM,
    parser: 'hosts',
    minDomains: 1000, // deliberately unreachable by the small fixture below
  },
];

vi.mock('../../src/services/urlModeration/sources.config.js', () => ({ SOURCES: FAKE_SOURCES }));

// Imported after the mock is registered so blocklistSync picks up FAKE_SOURCES.
const { buildSnapshot } = await import('../../src/services/urlModeration/blocklistSync.js');
const { publish, getSnapshot } = await import('../../src/services/urlModeration/blocklistManager.js');

function hostsText(domains) {
  return domains.map(d => `0.0.0.0 ${d}`).join('\n');
}

beforeEach(() => {
  publish(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildSnapshot', () => {
  it('merges multiple sources with correct per-domain categories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url === 'https://fake/adult.txt') {
          return { ok: true, text: async () => hostsText(['siteA.com', 'siteB.com']) };
        }
        if (url === 'https://fake/gambling.txt') {
          return { ok: true, text: async () => 'siteC.com\nsiteD.com' };
        }
        // flaky source: below its own minDomains threshold
        return { ok: true, text: async () => hostsText(['siteE.com']) };
      })
    );

    const snapshot = await buildSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot.domainMap.get('sitea.com')).toBeTruthy();
    expect(snapshot.domainMap.get('sitec.com')).toBeTruthy();
    // the flaky source stayed below minDomains, so its domain is absent
    expect(snapshot.domainMap.has('sitee.com')).toBe(false);

    const flakyStat = snapshot.sourceStats.find(s => s.id === 'fake-flaky');
    expect(flakyStat.ok).toBe(false);
  });

  it('keeps the previous snapshot when every source fails (blocklist update failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );

    const snapshot = await buildSnapshot();
    expect(snapshot).toBeNull();
  });

  it('rejects a corrupted/empty download instead of replacing a known-good snapshot', async () => {
    // First, a healthy build to establish a "known good" baseline.
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url === 'https://fake/adult.txt') {
          return { ok: true, text: async () => hostsText(Array.from({ length: 50 }, (_, i) => `adult${i}.com`)) };
        }
        if (url === 'https://fake/gambling.txt') {
          return { ok: true, text: async () => Array.from({ length: 50 }, (_, i) => `gamble${i}.com`).join('\n') };
        }
        return { ok: false, status: 500 };
      })
    );
    const goodSnapshot = await buildSnapshot();
    expect(goodSnapshot).not.toBeNull();
    publish(goodSnapshot);

    // Now simulate a corrupted/truncated response — far fewer domains than before.
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url === 'https://fake/adult.txt') return { ok: true, text: async () => hostsText(['onlyone.com']) };
        if (url === 'https://fake/gambling.txt') return { ok: true, text: async () => 'onlytwo.com' };
        return { ok: false, status: 500 };
      })
    );
    const corrupted = await buildSnapshot();
    expect(corrupted).toBeNull();
    // previous snapshot must still be the one in effect
    expect(getSnapshot()).toBe(goodSnapshot);
  });

  it('handles concurrent builds without producing a partially-merged map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url === 'https://fake/adult.txt') return { ok: true, text: async () => hostsText(['x.com', 'y.com']) };
        if (url === 'https://fake/gambling.txt') return { ok: true, text: async () => 'z.com\nw.com' };
        return { ok: false, status: 500 };
      })
    );

    const [a, b] = await Promise.all([buildSnapshot(), buildSnapshot()]);
    // Each concurrent build produces its own complete, independent Map —
    // never a map with only some sources merged in.
    for (const snap of [a, b]) {
      expect(snap.domainMap.has('x.com')).toBe(true);
      expect(snap.domainMap.has('z.com')).toBe(true);
    }
  });
});
