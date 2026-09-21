// Medicus Suite — in-memory API cache bound
// Run with: node test-cache-bound.js
//
// shared/medicus-api.js and engine/api-client.js used to drop an expired entry
// only when that same key was read again, so every other payload stayed for
// the life of the page. boundMap drops expired siblings on any read/write and
// caps what remains. A miss is a refetch, not an empty clinical result.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

function extractFn(src) {
  const token = 'function boundMap(';
  const at = src.indexOf(token);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return '';
}

function dedent(s) {
  const lines = s.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const min = Math.min.apply(null, indents);
  return lines.map((l) => (l.trim() ? l.slice(min) : '')).join('\n');
}

function remember(bound, store, key, at, opts) {
  const timeKey = opts.timeKey || 'at';
  const entry = { payload: key };
  entry[timeKey] = at;
  store.set(key, entry);
  bound(store, {
    now: opts.now,
    ttlMs: opts.ttlMs,
    maxEntries: opts.maxEntries,
    timeKey,
  });
}

(async () => {
  const { boundMap } = await import('./shared/cache-bound.js');
  const apiClient = require('./engine/api-client.js');
  const copies = [
    ['shared/cache-bound.js', boundMap],
    ['engine/api-client.js', apiClient.boundMap],
  ];

  const cacheSrc = fs.readFileSync(path.join(__dirname, 'shared/cache-bound.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'engine/api-client.js'), 'utf8');
  const medicusSrc = fs.readFileSync(path.join(__dirname, 'shared/medicus-api.js'), 'utf8');

  check(typeof boundMap === 'function', 'cache-bound.js exports boundMap');
  check(typeof apiClient.boundMap === 'function', 'api-client.js exports the same helper');
  check(
    dedent(extractFn(cacheSrc)) === dedent(extractFn(clientSrc)),
    'the classic-script copy of boundMap matches shared/cache-bound.js'
  );

  check(/SCHEDULE_CACHE_MAX = 160/.test(medicusSrc), 'scheduling cache caps at 160');
  check(/boundMap\(_cache,/.test(medicusSrc), 'scheduling cache is bounded on access');
  check(/timeKey: 'fetchedAt'/.test(medicusSrc), 'scheduling cache timestamps are fetchedAt');
  check(/PATIENT_CACHE_MAX = 240/.test(clientSrc), 'patient payload cache caps at 240');
  check(/ID_CACHE_MAX = 400/.test(clientSrc), 'id maps cap at 400');
  check(/boundMap\(CACHE,/.test(clientSrc), 'patient payload cache is bounded on access');
  check(/readIdCache\(ENCOUNTER_PATIENT_CACHE/.test(clientSrc), 'encounter id cache is read through the bound');
  check(/readIdCache\(TASK_PATIENT_CACHE/.test(clientSrc), 'task id cache is read through the bound');
  check(/writeIdCache\(ENCOUNTER_PATIENT_CACHE/.test(clientSrc), 'encounter id cache is written through the bound');
  check(/writeIdCache\(TASK_PATIENT_CACHE/.test(clientSrc), 'task id cache is written through the bound');

  for (const [label, bound] of copies) {
    console.log('\n--- ' + label + ' ---');

    const store = new Map();
    remember(bound, store, 'old', 1_000, { now: 1_000, ttlMs: 60_000, maxEntries: 10 });
    remember(bound, store, 'fresh', 50_000, { now: 70_000, ttlMs: 60_000, maxEntries: 10 });
    check(!store.has('old'), label + ': an unread expired entry is dropped when another key is written');
    check(store.has('fresh'), label + ': the fresh entry stays');
    check(store.get('fresh').payload === 'fresh', label + ': stored value is not replaced');

    const boundary = new Map();
    boundary.set('edge', { at: 0, payload: 'edge' });
    bound(boundary, { now: 60_000, ttlMs: 60_000, maxEntries: 10 });
    check(!boundary.has('edge'), label + ': age equal to ttl is a miss');

    const under = new Map();
    under.set('keep', { at: 10, payload: 'keep' });
    bound(under, { now: 10 + 59_999, ttlMs: 60_000, maxEntries: 10 });
    check(under.has('keep'), label + ': one millisecond inside ttl is kept');

    const capped = new Map();
    remember(bound, capped, 'a', 1, { now: 1, ttlMs: 1_000_000, maxEntries: 2 });
    remember(bound, capped, 'b', 2, { now: 2, ttlMs: 1_000_000, maxEntries: 2 });
    remember(bound, capped, 'c', 3, { now: 3, ttlMs: 1_000_000, maxEntries: 2 });
    check(!capped.has('a') && capped.has('b') && capped.has('c'), label + ': over the cap, the oldest timestamp goes');

    const refreshed = new Map();
    remember(bound, refreshed, 'a', 1, { now: 1, ttlMs: 1_000_000, maxEntries: 2 });
    remember(bound, refreshed, 'b', 2, { now: 2, ttlMs: 1_000_000, maxEntries: 2 });
    remember(bound, refreshed, 'a', 5, { now: 5, ttlMs: 1_000_000, maxEntries: 2 });
    remember(bound, refreshed, 'c', 6, { now: 6, ttlMs: 1_000_000, maxEntries: 2 });
    check(
      !refreshed.has('b') && refreshed.get('a').at === 5 && refreshed.has('c'),
      label + ': rewriting a key refreshes its timestamp so the other one is evicted'
    );

    const junk = new Map();
    junk.set('bare', { payload: 'no time' });
    junk.set('ok', { at: 5, payload: 'ok' });
    bound(junk, { now: 5, ttlMs: 60_000, maxEntries: 10 });
    check(!junk.has('bare') && junk.has('ok'), label + ': an entry with no timestamp is dropped when ttl is set');
  }

  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
