// Medicus Suite — Applicability filter regression tests
// Run with: node test-applicability-filters.js
//
// Guards the v3.x fix where age/sex applicability filters failed CLOSED on
// unknown demographics, silently suppressing safety alerts (MHRA valproate)
// and age-gated QOF indicators whenever the page sex/DOB couldn't be scraped.
// The contract: filters EXCLUDE only when the patient is *positively known*
// to be out of scope; on unknown age/sex they fail OPEN (rule fires).

'use strict';

const engine = require('./engine/rules-engine.js');
const pc = require('./engine/extractors/patient-context.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── Drug-combo: MHRA valproate (sex:F, age 12–55) ─────────────────────────────
const valproate = {
  type: 'drug-combo', enabled: true, label: 'Valproate — female childbearing age',
  drugSets: [{ name: 'Valproate', match: ['sodium valproate', 'valproic acid', 'valproate'] }],
  ageRange: { min: 12, max: 55 }, sex: 'F', requiresProblem: [], excludesProblem: [],
  severity: 'red'
};
const meds = [{ name: 'Sodium valproate 200mg/5ml oral solution' }];

console.log('\n--- valproate drug-combo (sex/age gated) ---');
check(engine.evaluateDrugComboRule(valproate, { medications: meds, patientContext: { ageYears: 35, sex: null } }).length === 1,
  'fires when sex UNKNOWN (null) — the reported bug');
check(engine.evaluateDrugComboRule(valproate, { medications: meds, patientContext: { ageYears: null, sex: null } }).length === 1,
  'fires when age AND sex unknown');
check(engine.evaluateDrugComboRule(valproate, { medications: meds, patientContext: { ageYears: 35, sex: 'female' } }).length === 1,
  'fires for known female in range');
check(engine.evaluateDrugComboRule(valproate, { medications: meds, patientContext: { ageYears: 35, sex: 'male' } }).length === 0,
  'does NOT fire for known male (positively out of scope)');
check(engine.evaluateDrugComboRule(valproate, { medications: meds, patientContext: { ageYears: 70, sex: 'female' } }).length === 0,
  'does NOT fire for known female out of age range');

// ── QOF register: age-gated register ──────────────────────────────────────────
const ageGatedReg = {
  id: 'test-reg', type: 'qof-register', enabled: true, registerCode: 'X', registerName: 'Test',
  problemMatch: ['testitis'], ageRange: { min: 65 }
};
const probs = [{ label: 'Chronic testitis', codedDate: '2024-01-01' }];

console.log('\n--- age-gated QOF register ---');
check(engine.evaluateQofRegisterRule(ageGatedReg, { problems: probs, patientContext: { ageYears: null } }).length === 1,
  'fires when age unknown (was suppressed before fix)');
check(engine.evaluateQofRegisterRule(ageGatedReg, { problems: probs, patientContext: { ageYears: 70 } }).length === 1,
  'fires for known in-range age');
check(engine.evaluateQofRegisterRule(ageGatedReg, { problems: probs, patientContext: { ageYears: 40 } }).length === 0,
  'does NOT fire for known under-age patient');

// ── Bundled dementia register now exists and fires ────────────────────────────
const qof = require('./rules/qof-rules.json');
const dem = qof.rules.find(r => r.registerCode === 'DEM');
console.log('\n--- bundled dementia register ---');
check(!!dem, 'DEM register is shipped in qof-rules.json');
if (dem) {
  check(engine.evaluateQofRegisterRule(dem, {
    problems: [{ label: "Alzheimer's disease", codedDate: '2023-05-01' }],
    patientContext: { ageYears: null }
  }).length === 1, 'dementia register fires on an Alzheimer problem with unknown age');
}

// ── Patient-context extraction robustness (fake DOM) ──────────────────────────
function fakeDoc({ title = '', infoText = '', bodyText = '', sexElText = null }) {
  return {
    title,
    body: { textContent: bodyText },
    querySelector(sel) {
      if (/patient-info|patient-banner|encounter-patient-info-top/i.test(sel)) return infoText ? { textContent: infoText } : null;
      if (/sex|gender/i.test(sel)) return (sexElText != null) ? { textContent: sexElText } : null;
      return null;
    }
  };
}
const NOW = new Date('2026-05-30T12:00:00Z');

console.log('\n--- patient-context extraction fallbacks ---');
let r = pc.extract(fakeDoc({ infoText: 'NHS: 123 456 7890  DOB: 01/01/1990  Sex: Female' }), NOW);
check(r && r.sex === 'female', 'reads "Sex: Female" from patient-info text');
check(r && r.ageYears === 36, 'computes age from DOB in patient-info text');

r = pc.extract(fakeDoc({ bodyText: 'Patient details — Gender: M — (45y)' }), NOW);
check(r && r.sex === 'male', 'reads "Gender: M" from body fallback');
check(r && r.ageYears === 45, 'reads explicit "(45y)" age token when no DOB');

r = pc.extract(fakeDoc({ sexElText: 'Female, 42' }), NOW);
check(r && r.sex === 'female', 'reads female from dedicated sex element');

r = pc.extract(fakeDoc({ bodyText: 'no demographics here' }), NOW);
check(r && r.sex === null && r.ageYears === null, 'leaves sex/age null when genuinely absent (so filters fail open)');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
