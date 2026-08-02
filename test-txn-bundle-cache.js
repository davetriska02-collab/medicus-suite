// Medicus Suite — Transactional patient-bundle cache tests
// Run with: node --test test-txn-bundle-cache.js
//
// Pins the contract of shared/txn-bundle-cache.js: TTL expiry, LRU-by-insertion
// eviction, clear(), and value identity (no cloning) so callers can rely on the
// cache being a plain pass-through store, not a serialiser.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createBundleCache } = require('./shared/txn-bundle-cache.js');

test('get on a fresh cache is a miss', () => {
  const cache = createBundleCache({});
  assert.equal(cache.get('missing'), undefined);
  assert.equal(cache.size(), 0);
});

test('set then get returns the same value (hit)', () => {
  const cache = createBundleCache({});
  const value = { patient: 'p1' };
  cache.set('key1', value);
  assert.strictEqual(cache.get('key1'), value); // identity, not a clone
  assert.equal(cache.size(), 1);
});

test('entries expire after ttlMs, using the injected clock, and are removed on read', () => {
  let time = 1000;
  const cache = createBundleCache({ ttlMs: 60000, now: () => time });
  cache.set('key1', { a: 1 });
  assert.notEqual(cache.get('key1'), undefined);

  time += 59999; // just under ttl
  assert.notEqual(cache.get('key1'), undefined);

  time += 2; // now past ttl (>= expiresAt)
  assert.equal(cache.get('key1'), undefined);
  assert.equal(cache.size(), 0); // expired entry was deleted on read
});

test('maxEntries evicts the oldest entry first', () => {
  const cache = createBundleCache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3); // should evict 'a', the oldest

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size(), 2);
});

test('clear() empties the cache', () => {
  const cache = createBundleCache({});
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), undefined);
});

test('re-setting an existing key refreshes its TTL and its position for eviction', () => {
  let time = 0;
  const cache = createBundleCache({ ttlMs: 1000, maxEntries: 2, now: () => time });
  cache.set('a', 1);
  time += 10;
  cache.set('b', 2);
  time += 10;
  cache.set('a', 'updated'); // 'a' is now the newest, 'b' is the oldest

  cache.set('c', 3); // must evict 'b', not 'a'
  assert.equal(cache.get('b'), undefined);
  assert.strictEqual(cache.get('a'), 'updated');
  assert.equal(cache.get('c'), 3);
});
