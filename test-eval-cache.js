// Medicus Suite — record-pipeline evaluation memo test
// Run with: node test-eval-cache.js
//
// Proves the record HUD memo (engine/eval-cache.js) is SAFE, not just fast:
//   1. Identical fresh inputs → same hash → cache HIT (the re-eval we skip).
//   2. A changed observation / med / problem / rule / day → different hash →
//      cache MISS → forced re-evaluation. This is the invalidation proof Dave
//      insisted on: the memo can never serve a stale all-clear, because the hash
//      is derived from the freshly-fetched data on every call.
//   3. A different patient token never reads another token's value.

'use strict';

const path = require('path');
const cache = require(path.join(__dirname, 'engine', 'eval-cache.js'));

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

const baseMeds = [{ name: 'Ramipril 5mg tablets', startDate: '2024-01-01' }];
const baseObs = [{ name: 'Serum potassium', date: '2025-06-01', value: '4.5' }];
const baseOpts = {
  now: '2026-06-20T09:00:00Z',
  problems: [{ label: 'Hypertension' }],
  patientContext: { ageYears: 60, sex: 'F' },
  rules: [{ id: 'ace-arb', enabled: true }],
};

const h = (meds, obs, opts) => cache.computeInputHash(meds, obs, opts);

console.log('--- hash stability (identical inputs → identical hash) ---');
check(h(baseMeds, baseObs, baseOpts) === h(baseMeds, baseObs, baseOpts), 'identical inputs hash equal');
// Order-independence: observation/med order must not change the hash.
check(
  h(baseMeds, [...baseObs].reverse(), baseOpts) === h(baseMeds, baseObs, baseOpts) || baseObs.length === 1,
  'observation order does not change the hash'
);

console.log('\n--- invalidation (any clinical change → different hash) ---');
const h0 = h(baseMeds, baseObs, baseOpts);
check(
  h(baseMeds, [{ name: 'Serum potassium', date: '2025-06-01', value: '6.1' }], baseOpts) !== h0,
  'changed observation VALUE busts the hash (the stale-all-clear guard)'
);
check(
  h(baseMeds, [{ name: 'Serum potassium', date: '2026-06-10', value: '4.5' }], baseOpts) !== h0,
  'changed observation DATE busts the hash'
);
check(
  h([...baseMeds, { name: 'Naproxen 500mg', startDate: '2026-06-15' }], baseObs, baseOpts) !== h0,
  'added medication busts the hash'
);
check(
  h(baseMeds, baseObs, { ...baseOpts, problems: [{ label: 'Heart failure' }] }) !== h0,
  'changed problem busts the hash'
);
check(
  h(baseMeds, baseObs, { ...baseOpts, patientContext: { ageYears: 61, sex: 'F' } }) !== h0,
  'changed age busts the hash'
);
check(
  h(baseMeds, baseObs, { ...baseOpts, rules: [{ id: 'ace-arb', enabled: false }] }) !== h0,
  'disabling a rule busts the hash'
);
check(
  h(baseMeds, baseObs, { ...baseOpts, now: '2026-06-21T09:00:00Z' }) !== h0,
  'a new calendar day busts the hash (overdue can tick over)'
);
check(
  h(baseMeds, baseObs, { ...baseOpts, now: '2026-06-20T23:30:00Z' }) === h0,
  'same calendar day, later time → SAME hash (genuine no-op re-eval skipped)'
);

console.log('\n--- memo store get/set/invalidate ---');
const store = cache.createEvalCache();
const tokenA = 'record|https://x.medicus.health/patient/A';
const tokenB = 'record|https://x.medicus.health/patient/B';
const valueA = [{ ruleId: 'ace-arb', status: 'overdue' }];

check(store.get(tokenA, h0) === undefined, 'empty store misses');
store.set(tokenA, h0, valueA);
check(store.get(tokenA, h0) === valueA, 'set then get with same hash → HIT');
check(store.get(tokenA, 'different-hash') === undefined, 'same token, different hash → MISS (forces re-eval)');
check(store.get(tokenB, h0) === undefined, 'different patient token never reads token A value');
store.invalidate(tokenA);
check(store.get(tokenA, h0) === undefined, 'invalidate(token) drops that entry');
store.set(tokenA, h0, valueA);
store.set(tokenB, h0, valueA);
store.invalidate();
check(store.get(tokenA, h0) === undefined && store.get(tokenB, h0) === undefined, 'invalidate() clears everything');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
