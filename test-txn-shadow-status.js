// Medicus Suite — shared/txn-shadow-summary.js unit tests
// Run with: node --test test-txn-shadow-status.js
//
// Pins the pure helper content-scripts/sentinel.js's crossover-safety glue
// (computeApiShadowStatus) is built on: summariseShadow() wraps
// shared/shadow-compare.js's diffChips() into a parity/divergence verdict,
// and buildStatusSuffix() produces the exact status-line strings appended
// after "Mode: X / <dataSource>".

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TxnShadowSummary = require('./shared/txn-shadow-summary.js');
const { summariseShadow, buildStatusSuffix } = TxnShadowSummary;

function chip(ruleId, status) {
  return { ruleId, status, type: 'drug-monitoring' };
}

test('summariseShadow: identical chip sets on both feeds -> parity', () => {
  const displayedChips = [chip('r1', 'overdue'), chip('r2', 'achieved')];
  const shadowChips = [chip('r1', 'overdue'), chip('r2', 'achieved')];
  assert.deepEqual(summariseShadow({ displayedChips, shadowChips }), { parity: true });
});

test('summariseShadow: empty on both feeds -> parity (no chips is still no differences)', () => {
  assert.deepEqual(summariseShadow({ displayedChips: [], shadowChips: [] }), { parity: true });
  assert.deepEqual(summariseShadow({}), { parity: true });
});

test('summariseShadow: a chip missing under the shadow (API) feed is reported as `missing`', () => {
  const displayedChips = [chip('r1', 'overdue'), chip('r2', 'achieved')];
  const shadowChips = [chip('r2', 'achieved')];
  const r = summariseShadow({ displayedChips, shadowChips });
  assert.equal(r.parity, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].key, 'r1');
  assert.equal(r.added.length, 0);
  assert.equal(r.severityChange.length, 0);
  assert.equal(r.count, 1);
  assert.equal(r.safe, false, 'dropping an overdue alert is a safety regression');
});

test('summariseShadow: a chip present ONLY under the shadow feed is reported as `added`', () => {
  const displayedChips = [chip('r1', 'achieved')];
  const shadowChips = [chip('r1', 'achieved'), chip('r2', 'overdue')];
  const r = summariseShadow({ displayedChips, shadowChips });
  assert.equal(r.parity, false);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].key, 'r2');
  assert.equal(r.missing.length, 0);
  assert.equal(r.count, 1);
});

test('summariseShadow: same rule, different status under the two feeds -> severityChange', () => {
  const displayedChips = [chip('r1', 'due_soon')];
  const shadowChips = [chip('r1', 'overdue')];
  const r = summariseShadow({ displayedChips, shadowChips });
  assert.equal(r.parity, false);
  assert.equal(r.severityChange.length, 1);
  assert.equal(r.severityChange[0].from, 'due_soon');
  assert.equal(r.severityChange[0].to, 'overdue');
  assert.equal(r.count, 1);
});

test('summariseShadow: a status flip that is a pure escalation (no dropped alert) is still reported, safe stays true', () => {
  // achieved -> overdue under the shadow feed is an escalation (more urgent),
  // not a regression — shadow-compare's `safe` should stay true.
  const displayedChips = [chip('r1', 'achieved')];
  const shadowChips = [chip('r1', 'overdue')];
  const r = summariseShadow({ displayedChips, shadowChips });
  assert.equal(r.parity, false);
  assert.equal(r.safe, true, 'an escalation-only divergence is not a safety regression');
});

test('buildStatusSuffix: exact status-line suffix strings', () => {
  assert.equal(buildStatusSuffix({ kind: 'parity' }), ' · API shadow: parity');
  assert.equal(buildStatusSuffix({ kind: 'divergence', count: 1 }), ' · API shadow: 1 difference(s)');
  assert.equal(buildStatusSuffix({ kind: 'divergence', count: 3 }), ' · API shadow: 3 difference(s)');
  assert.equal(buildStatusSuffix({ kind: 'unavailable' }), ' · API shadow: unavailable');
  assert.equal(buildStatusSuffix({ kind: 'error' }), ' · API shadow: error');
  assert.equal(buildStatusSuffix({ kind: 'fallback' }), ' · API feed unavailable — using session data');
});

test('buildStatusSuffix: unknown/missing kind appends nothing', () => {
  assert.equal(buildStatusSuffix({}), '');
  assert.equal(buildStatusSuffix(null), '');
  assert.equal(buildStatusSuffix({ kind: 'nonsense' }), '');
});

test('summariseShadow -> buildStatusSuffix: end-to-end divergence count feeds the suffix', () => {
  const displayedChips = [chip('r1', 'overdue'), chip('r2', 'achieved')];
  const shadowChips = [chip('r2', 'achieved'), chip('r3', 'due_soon')]; // r1 missing, r3 added
  const r = summariseShadow({ displayedChips, shadowChips });
  assert.equal(r.count, 2);
  assert.equal(
    buildStatusSuffix(r.parity ? { kind: 'parity' } : { kind: 'divergence', count: r.count }),
    ' · API shadow: 2 difference(s)'
  );
});
