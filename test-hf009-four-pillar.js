// Medicus Suite — HF009 four-pillar therapy + DM037 observation-bundle tests
// Run with: node test-hf009-four-pillar.js
//
// Loads the real qof-hf009 and qof-dm037 rules from rules/qof-rules.json
// and exercises them through the engine.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const qofRules = require(path.join(__dirname, 'rules', 'qof-rules.json'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const NOW = '2026-06-10';

// Fetch real rules from the JSON file.
const hf009 = qofRules.rules.find((r) => r.id === 'qof-hf009');
const dm037 = qofRules.rules.find((r) => r.id === 'qof-dm037');
const hfReg = qofRules.rules.find((r) => r.id === 'qof-reg-hf');
const dmReg = qofRules.rules.find((r) => r.id === 'qof-reg-dm');

// ── Preconditions ─────────────────────────────────────────────────────────────
console.log('\n--- rule preconditions ---');
assert(!!hf009, 'qof-hf009 rule found in qof-rules.json');
assert(!!dm037, 'qof-dm037 rule found in qof-rules.json');
assert(!!hfReg, 'qof-reg-hf register rule found');
assert(!!dmReg, 'qof-reg-dm register rule found');
assert(hf009 && hf009.enabled === true, 'qof-hf009 enabled === true');
assert(dm037 && dm037.enabled === true, 'qof-dm037 enabled === true');

// Build _registerLookup helpers.
function hfLookup() {
  return { HF: hfReg };
}
function dmLookup() {
  return { DM: dmReg };
}

// Helper: medication object.
function med(name) {
  return { name };
}

// Helper: make an observation dated within QOF year (after 1 Apr 2026).
function recentObs(name, value) {
  return { name, code: null, date: '2026-05-01', value: value || '1' };
}

// Helper: make an observation outside QOF year (before 1 Apr 2026).
function oldObs(name, value) {
  return { name, code: null, date: '2025-12-01', value: value || '1' };
}

// Base data for HF register patient with HFrEF.
function hfRefData(meds) {
  return {
    medications: meds,
    observations: [],
    problems: [
      { label: 'Heart failure with reduced ejection fraction', status: 'active', codedDate: '2020-01-01' },
      { label: 'Heart failure', status: 'active', codedDate: '2020-01-01' },
    ],
    patientContext: null,
    _registerLookup: hfLookup(),
  };
}

// ── HF009: enabled flag + basic evaluation ────────────────────────────────────
console.log('\n--- HF009: four-pillar medication-all-of ---');

// All four pillars present → achieved
{
  const meds = [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg'), med('dapagliflozin 10mg')];
  const chips = engine.evaluateQofIndicatorRule(hf009, hfRefData(meds), NOW);
  assert(chips.length === 1, 'HF009: chip produced when all four pillars present');
  assert(chips[0].status === 'achieved', 'HF009: all four pillars → achieved');
  assert(chips[0].valueText === '4/4 classes', `HF009: valueText '4/4 classes' (got: ${chips[0]?.valueText})`);
}

// Entresto (sacubitril) satisfies RAAS group
{
  const meds = [
    med('sacubitril/valsartan (Entresto)'),
    med('bisoprolol 2.5mg'),
    med('eplerenone 25mg'),
    med('empagliflozin 10mg'),
  ];
  const chips = engine.evaluateQofIndicatorRule(hf009, hfRefData(meds), NOW);
  assert(chips.length === 1, 'HF009: chip produced with Entresto');
  assert(chips[0].status === 'achieved', 'HF009: Entresto satisfies RAAS group → achieved');
}

// Missing SGLT2i → not_met, valueText contains 'missing: SGLT2i'
{
  const meds = [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg')];
  const chips = engine.evaluateQofIndicatorRule(hf009, hfRefData(meds), NOW);
  assert(chips.length === 1, 'HF009: chip produced when SGLT2i missing');
  assert(chips[0].status === 'not_met', 'HF009: missing SGLT2i → not_met');
  assert(
    chips[0].valueText && chips[0].valueText.includes('missing: SGLT2i'),
    `HF009: valueText contains 'missing: SGLT2i' (got: ${chips[0]?.valueText})`
  );
}

// On HF register but no HFrEF problem → no chip
{
  const data = {
    medications: [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg'), med('dapagliflozin 10mg')],
    observations: [],
    problems: [
      // Only HFpEF — no HFrEF synonym
      { label: 'Heart failure', status: 'active', codedDate: '2020-01-01' },
    ],
    patientContext: null,
    _registerLookup: hfLookup(),
  };
  const chips = engine.evaluateQofIndicatorRule(hf009, data, NOW);
  assert(chips.length === 0, 'HF009: no chip when no HFrEF problem (only generic HF)');
}

// Problem "No evidence of reduced ejection fraction" → negation-aware → no chip
{
  const data = {
    medications: [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg'), med('dapagliflozin 10mg')],
    observations: [],
    problems: [
      { label: 'No evidence of reduced ejection fraction', status: 'active', codedDate: '2023-01-01' },
      { label: 'Heart failure', status: 'active', codedDate: '2020-01-01' },
    ],
    patientContext: null,
    _registerLookup: hfLookup(),
  };
  const chips = engine.evaluateQofIndicatorRule(hf009, data, NOW);
  assert(chips.length === 0, 'HF009: no chip when HFrEF problem is negated');
}

// Empty medications array → no_data
{
  const chips = engine.evaluateQofIndicatorRule(hf009, hfRefData([]), NOW);
  assert(chips.length === 1, 'HF009: chip produced with empty medication array');
  assert(chips[0].status === 'no_data', 'HF009: empty medications → no_data');
}

// Not on HF register → no chip
{
  const data = {
    medications: [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg'), med('dapagliflozin 10mg')],
    observations: [],
    problems: [{ label: 'Heart failure with reduced ejection fraction', status: 'active', codedDate: '2020-01-01' }],
    patientContext: null,
    _registerLookup: {}, // no register rules
  };
  const chips = engine.evaluateQofIndicatorRule(hf009, data, NOW);
  assert(chips.length === 0, 'HF009: no chip when not on HF register');
}

// Evidence context: allOfResults populated
{
  const meds = [med('ramipril 5mg'), med('bisoprolol 2.5mg'), med('spironolactone 25mg'), med('dapagliflozin 10mg')];
  const chips = engine.evaluateQofIndicatorRule(hf009, hfRefData(meds), NOW);
  const ev = chips[0]?.evidence;
  assert(ev && ev.facts && ev.facts.some((f) => f.label === 'RAAS'), 'HF009: evidence facts include RAAS group');
  assert(ev && ev.facts && ev.facts.some((f) => f.label === 'SGLT2i'), 'HF009: evidence facts include SGLT2i group');
}

// ── DM037: observation-bundle ─────────────────────────────────────────────────
console.log('\n--- DM037: observation-bundle (8 care processes) ---');

// Build 8 in-window observations (after QOF year start 1 Apr 2026).
function dm037Data(obs) {
  return {
    medications: [],
    observations: obs,
    problems: [{ label: 'Type 2 diabetes mellitus', status: 'active', codedDate: '2010-01-01' }],
    patientContext: null,
    _registerLookup: dmLookup(),
  };
}

const ALL_8 = [
  recentObs('Body Mass Index'),
  recentObs('Blood pressure'),
  recentObs('HbA1c'),
  recentObs('Cholesterol'),
  recentObs('Smoking status'),
  recentObs('Diabetic foot examination'),
  recentObs('ACR'),
  recentObs('eGFR'),
];

// 8/8 in-window → achieved
{
  const chips = engine.evaluateQofIndicatorRule(dm037, dm037Data(ALL_8), NOW);
  assert(chips.length === 1, 'DM037: chip produced with 8 in-window observations');
  assert(chips[0].status === 'achieved', 'DM037: 8/8 → achieved');
  assert(
    chips[0].valueText === '8/8 care processes',
    `DM037: valueText '8/8 care processes' (got: ${chips[0]?.valueText})`
  );
}

// 7/8 → not_met
{
  const obs7 = ALL_8.slice(0, 7); // drop last (eGFR)
  const chips = engine.evaluateQofIndicatorRule(dm037, dm037Data(obs7), NOW);
  assert(chips.length === 1, 'DM037: chip produced with 7 observations');
  assert(chips[0].status === 'not_met', 'DM037: 7/8 → not_met');
  assert(
    chips[0].valueText === '7/8 care processes',
    `DM037: valueText '7/8 care processes' (got: ${chips[0]?.valueText})`
  );
}

// 0/8 → no_data
{
  const chips = engine.evaluateQofIndicatorRule(dm037, dm037Data([]), NOW);
  assert(chips.length === 1, 'DM037: chip produced with no observations');
  assert(chips[0].status === 'no_data', 'DM037: 0/8 → no_data');
}

// Observation dated before QOF year floor (before 1 Apr 2026) does NOT count.
{
  // 7 in-window + 1 old → should be 7/8 not_met
  const obs7plus1old = [...ALL_8.slice(0, 7), oldObs('eGFR')];
  const chips = engine.evaluateQofIndicatorRule(dm037, dm037Data(obs7plus1old), NOW);
  assert(chips.length === 1, 'DM037: chip with 7 in-window + 1 old');
  assert(chips[0].status === 'not_met', 'DM037: old observation outside QOF year does not count → not_met');
  assert(
    chips[0].valueText === '7/8 care processes',
    `DM037: valueText '7/8 care processes' when one obs pre-QOF-year (got: ${chips[0]?.valueText})`
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
