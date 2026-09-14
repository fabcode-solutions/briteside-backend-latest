import { SOURCES } from './sources.config.js';
import { PARSERS } from './parsers.js';
import { addCategory } from './types.js';
import { getSnapshot } from './blocklistManager.js';
import logger from '../../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'urlModeration', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'urlModeration', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'urlModeration', ...meta }),
};

const FETCH_TIMEOUT_MS = 45000;
// If the merged total drops below this fraction of the last known-good total,
// treat the whole build as suspect and keep serving the previous snapshot.
const MIN_RETAINED_FRACTION = 0.5;

async function fetchRemoteSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLocalSource(source) {
  // Cache-bust the dynamic import so a hand-edited file is picked up on the
  // next sync cycle without requiring a process restart.
  const mod = await import(`../../../${source.file}?v=${Date.now()}`);
  return mod.default;
}

async function loadOneSource(source) {
  const parse = PARSERS[source.parser];
  if (!parse) throw new Error(`Unknown parser "${source.parser}" for source "${source.id}"`);

  const raw = source.local ? await loadLocalSource(source) : await fetchRemoteSource(source);
  const domains = parse(raw);
  return domains;
}

/**
 * Fetches + parses every configured source and merges them into a single
 * snapshot. Never throws for an individual source failure — those are
 * recorded in sourceStats and the source is simply left out of this build.
 * Only aborts (returns null) if the aggregate result looks corrupted/empty
 * compared to the last known-good snapshot.
 */
export async function buildSnapshot() {
  const previous = getSnapshot();
  const domainMap = new Map();
  const keywordMap = new Map();
  const sourceStats = [];
  let succeededCount = 0;

  const results = await Promise.allSettled(SOURCES.map(loadOneSource));

  results.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === 'rejected') {
      log.error('Source failed', { source: source.id, error: result.reason?.message });
      sourceStats.push({ id: source.id, ok: false, count: 0, error: result.reason?.message });
      return;
    }

    const domains = result.value;
    if (!Array.isArray(domains) || domains.length < (source.minDomains || 0)) {
      log.warn('Source below minimum expected size, skipping this cycle', {
        source: source.id,
        count: domains?.length ?? 0,
        minDomains: source.minDomains,
      });
      sourceStats.push({ id: source.id, ok: false, count: domains?.length ?? 0, error: 'below_min_domains' });
      return;
    }

    const targetMap = source.parser === 'keywordList' ? keywordMap : domainMap;
    for (const domain of domains) {
      targetMap.set(domain, addCategory(targetMap.get(domain), source.category));
    }
    succeededCount += 1;
    sourceStats.push({ id: source.id, ok: true, count: domains.length });
  });

  if (succeededCount === 0) {
    log.error('All blocklist sources failed — keeping previous snapshot', {});
    return null;
  }

  const total = domainMap.size + keywordMap.size;
  if (previous && total < previous.domainMap.size * MIN_RETAINED_FRACTION) {
    log.error('New snapshot looks corrupted (too small vs previous) — keeping previous snapshot', {
      previousSize: previous.domainMap.size,
      newSize: total,
    });
    return null;
  }

  const snapshot = {
    domainMap,
    keywordMap,
    version: new Date().toISOString(),
    builtAt: new Date(),
    sourceStats,
  };

  log.info('Snapshot built', {
    version: snapshot.version,
    domainCount: domainMap.size,
    keywordCount: keywordMap.size,
    sources: sourceStats,
  });

  return snapshot;
}
