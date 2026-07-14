// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Transactional patient-bundle cache
//
// Short-TTL, in-memory cache for txnFetchPatientBundle results. Live testing
// against Medicus's staging environment showed every patient view triggering
// a full care-record + demographics round trip through the proxy; this cache
// lets a handful of consecutive views of the same patient reuse one result.
//
// Dependency-free and tiny on purpose — no persistence, no cross-worker
// sharing. The service worker owns the single instance and is responsible for
// keying it (tenant + environment + patient) and for clearing it when config
// that affects the result changes (see service-worker.js).

(function (global) {
  'use strict';

  // createBundleCache({ ttlMs, maxEntries, now }) -> { get, set, clear, size }
  //   ttlMs      — how long an entry stays fresh (default 60s)
  //   maxEntries — oldest entry is evicted once this would be exceeded
  //   now        — injectable clock, () => epoch ms, defaults to Date.now
  function createBundleCache({ ttlMs = 60000, maxEntries = 50, now = Date.now } = {}) {
    const store = new Map(); // key -> { value, expiresAt }

    function get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    }

    function set(key, value) {
      // Re-inserting an existing key should still count as "newest" for
      // eviction purposes, so drop it first and let the Map re-append it.
      store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlMs });
      while (store.size > maxEntries) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
    }

    function clear() {
      store.clear();
    }

    function size() {
      return store.size;
    }

    return { get, set, clear, size };
  }

  const api = { createBundleCache };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnBundleCache = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
