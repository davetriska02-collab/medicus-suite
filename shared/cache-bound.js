// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Bound a Map of timestamped entries: drop anything at or past ttlMs, then if
// the map is still over maxEntries delete the oldest timestamps first.
//
// A deleted entry is a cache miss. Callers refetch. A miss is not a clinical
// all-clear — this helper never invents an empty result.
//
// engine/api-client.js keeps an identical copy of boundMap (that file is a
// classic content script and cannot import this ES module). test-cache-bound.js
// fails if the two copies drift.

export function boundMap(store, opts) {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const ttlMs = o.ttlMs;
  const maxEntries = o.maxEntries;
  const timeKey = o.timeKey || 'at';
  if (!store || typeof store.delete !== 'function') return store;

  if (typeof ttlMs === 'number' && ttlMs >= 0) {
    for (const [key, value] of store) {
      const at = value && value[timeKey];
      // Age >= ttl is a miss. Matches the previous `< ttl` freshness check.
      if (typeof at !== 'number' || now - at >= ttlMs) store.delete(key);
    }
  }

  if (typeof maxEntries === 'number' && maxEntries >= 0 && store.size > maxEntries) {
    const ranked = [];
    for (const [key, value] of store) {
      const at = value && typeof value[timeKey] === 'number' ? value[timeKey] : 0;
      ranked.push([at, key]);
    }
    ranked.sort((a, b) => a[0] - b[0]);
    const excess = store.size - maxEntries;
    for (let i = 0; i < excess; i++) store.delete(ranked[i][1]);
  }
  return store;
}
