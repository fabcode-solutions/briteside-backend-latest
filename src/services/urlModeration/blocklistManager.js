// Holds the current in-memory snapshot and swaps it atomically. Every
// request-path read goes through getSnapshot() / getDomainMap() — never
// through the sync/build machinery directly.

// snapshot shape: { domainMap: Map<fullDomain, bitmask>, keywordMap: Map<bareLabel, bitmask>,
//                   version, builtAt, sourceStats }
let current = null;
let previous = null; // kept only for diagnostics/rollback visibility

export function publish(snapshot) {
  previous = current;
  current = snapshot;
}

export function getSnapshot() {
  return current;
}

export function getDomainMap() {
  return current ? current.domainMap : null;
}

export function getKeywordMap() {
  return current ? current.keywordMap : null;
}

export function getPreviousSnapshot() {
  return previous;
}

export function getStats() {
  if (!current) return { ready: false };
  return {
    ready: true,
    version: current.version,
    builtAt: current.builtAt,
    domainCount: current.domainMap.size,
    keywordCount: current.keywordMap.size,
    sourceStats: current.sourceStats,
  };
}
