// Medicus Suite — Sentinel side-panel state tests
// Run with: node test-sentinel-panel-state.js
//
// vm-extracts the pure classifySnapshot(snapshot) helper from
// side-panel/modules/sentinel/sentinel.js and asserts the side panel surfaces a
// degraded extraction and an invalidated (stale) snapshot as something OTHER
// than the benign "no chips" all-clear (H-005 / wrong-patient guard). Same
// Layer-2 pattern as test-extraction-health.js.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'sentinel', 'sentinel.js'), 'utf8');
const m = src.match(/function classifySnapshot\(snapshot\) \{[\s\S]*?\n\}/);
check(!!m, 'classifySnapshot extracted from side-panel sentinel module');

let classify = null;
if (m) {
  const sandbox = {};
  vm.runInNewContext(m[0] + '\nthis.classifySnapshot = classifySnapshot;', sandbox);
  classify = sandbox.classifySnapshot;
  check(typeof classify === 'function', 'helper is callable');
}

console.log('\n--- must NOT read as a benign all-clear ---');
check(classify({ degraded: true, chips: [], patientContext: { patientName: 'Smith, John' } }) === 'degraded',
  'degraded extraction (patient identified, nothing extracted) → degraded, not data');
check(classify({ unavailable: true, chips: null }) === 'unavailable',
  'invalidated snapshot (navigating / failed extraction) → unavailable, not data');
check(classify({ degraded: true, unavailable: true, chips: null }) === 'unavailable',
  'an invalidated snapshot is never treated as real data even if degraded is set');

console.log('\n--- genuine states ---');
check(classify({ chips: [{ status: 'overdue' }], patientContext: {} }) === 'data',
  'real chips → data');
check(classify({ chips: [], degraded: false }) === 'data',
  'genuinely empty (extraction healthy, no matched rules) → data (panel shows "no chips")');
check(classify({ chips: [{ status: 'overdue' }], degraded: false, modules: { medications: 3, observations: 0, problems: 1, demographics: true } }) === 'data',
  'per-module breakdown on a healthy snapshot does not change classification (informational only, not an alarm)');
check(classify({ degraded: true, chips: [], modules: { medications: 0, observations: 0, problems: 0, demographics: false } }) === 'degraded',
  'a degraded snapshot is still degraded even though it now also carries a (zeroed) modules breakdown');
check(classify({ chips: null }) === 'no-chips', 'no snapshot chips yet → no-chips');
check(classify(null) === 'no-chips', 'null snapshot → no-chips (no crash)');
check(classify(undefined) === 'no-chips', 'undefined snapshot → no-chips (no crash)');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
