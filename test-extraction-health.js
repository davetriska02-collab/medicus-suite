// Medicus Suite — extraction-health (silent-failure detection) tests
// Run with: node test-extraction-health.js
//
// vm-extracts the pure assessExtractionHealth(data) helper from
// content-scripts/sentinel.js and asserts it distinguishes a genuine "no matched
// rules" result from a likely Medicus DOM/API extraction failure that must NOT
// read as an "all clear" (H-005). Same Layer-2 pattern as test-monitoring-chip.js.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');
const m = src.match(/function assessExtractionHealth\(data\) \{[\s\S]*?\n  \}/);
check(!!m, 'assessExtractionHealth extracted from sentinel.js');

let assess = null;
if (m) {
  const sandbox = {};
  vm.runInNewContext(m[0] + '\nthis.assessExtractionHealth = assessExtractionHealth;', sandbox);
  assess = sandbox.assessExtractionHealth;
  check(typeof assess === 'function', 'helper is callable');
}

const pc = (over) => ({ patientName: 'Smith, John', dob: '1980-01-01', dobRaw: '01/01/1980', ageYears: 46, sex: 'male', nhsNumber: '1234567890', ...over });

console.log('\n--- degraded (likely DOM/API drift) ---');
check(assess({ mode: 'live', patientContext: { patientName: 'Smith, John' }, medications: [], observations: [], problems: [] }).degraded === true,
  'patient identified but NOTHING extracted (no clinical, no demographics) → degraded');
check(typeof assess({ mode: 'live', patientContext: { patientId: 'abc' }, medications: [], observations: [], problems: [] }).reason === 'string',
  'degraded result carries a reason for the banner');

console.log('\n--- NOT degraded (genuine / not-applicable) ---');
check(assess({ mode: 'live', patientContext: pc(), medications: [], observations: [], problems: [] }).degraded === false,
  'identified patient with demographics but no matched rules → genuine "no alerts" (a sparse record still has demographics)');
check(assess({ mode: 'live', patientContext: pc({ patientName: null }), medications: [{ name: 'x' }], observations: [], problems: [] }).degraded === false,
  'some clinical data extracted → not degraded');
check(assess({ mode: 'live', patientContext: { ageYears: 50 }, medications: [], observations: [], problems: [] }).degraded === false,
  'no patient identified (not a patient view) → not degraded');
check(assess({ mode: 'mock', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).degraded === false,
  'mock mode is never flagged degraded');
check(assess(null).degraded === false, 'null data → not degraded (no crash)');
check(assess({ mode: 'live', patientContext: { patientName: 'X', sex: 'female' }, medications: [], observations: [], problems: [] }).degraded === false,
  'identity + at least one demographic field present → genuine empty, not degraded');

console.log('\n--- per-module breakdown (informational; never an alarm on its own) ---');
const mods = assess({ mode: 'live', patientContext: pc(), medications: [{ name: 'a' }, { name: 'b' }], observations: [{ name: 'o' }], problems: [] }).modules;
check(mods && mods.medications === 2 && mods.observations === 1 && mods.problems === 0,
  'modules carries exact per-extractor counts');
check(mods && mods.demographics === true, 'modules.demographics reflects whether any demographic field was extracted');
check(assess({ mode: 'live', patientContext: pc(), medications: [{ name: 'a' }], observations: [], problems: [] }).degraded === false,
  'a zero count in one module (obs/problems empty) is NOT degraded while other data extracted — per-module zeros never alarm on their own');
check(assess({ mode: 'live', patientContext: pc(), medications: [], observations: [], problems: [] }).modules?.medications === 0,
  'modules present even on a sparse-but-genuine record (demographics carry it)');
check(assess({ mode: 'live', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).modules?.medications === 0,
  'degraded result still carries a modules breakdown (all zeros) for the panel');
check(assess({ mode: 'mock', patientContext: { patientName: 'X' }, medications: [], observations: [], problems: [] }).modules === null,
  'non-live / not-a-patient-view returns modules:null (nothing to show)');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
