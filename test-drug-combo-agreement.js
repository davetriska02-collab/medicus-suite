// Medicus Suite — single-drug vs drug-combo matching agreement test
// Run with: node test-drug-combo-agreement.js
//
// Fix-proof for the latent silent miss where evaluateDrugComboRule used a bare
// .toLowerCase() while single-drug matching (drugMatchesRule → normaliseDrugString)
// folds '-'/'_' to spaces and collapses whitespace. The two paths disagreed on
// any drug where the rule term and the prescription string differ in hyphen-vs-
// space — so a hyphenated interaction drug (co-trimoxazole, co-amilofruse, …)
// could match its single-drug monitoring rule but SILENTLY NOT match a drug-combo
// interaction set. No error, just a missing alert (a patient-safety-class miss).
//
// This pins the invariant: for the same match term + prescription string, the
// single-drug matcher and the combo-set matcher must AGREE. The hyphen↔space
// cases below FAIL on the pre-fix code and PASS once both paths share
// normaliseDrugString.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));

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

// Does a single-set drug-combo rule with this match term fire for this med?
function comboFires(term, medName) {
  const rule = {
    type: 'drug-combo',
    enabled: true,
    label: 'test-combo',
    drugSets: [{ name: 'Set', match: [term] }],
    sex: 'any',
  };
  const data = { medications: [{ name: medName }], patientContext: {}, problems: [] };
  return engine.evaluateDrugComboRule(rule, data).length > 0;
}

// Does single-drug matching with this match term fire for this med?
function singleFires(term, medName) {
  return engine.drugMatchesRule(medName, { drug: { match: [term] } });
}

// [ ruleTerm, prescriptionString ] — must match in BOTH paths.
// The hyphen↔space pairs are the discriminating regression cases.
const SHOULD_MATCH = [
  // hyphenated rule term vs spaced prescription (and vice versa)
  ['co-trimoxazole', 'Co trimoxazole 480mg tablets'],
  ['co trimoxazole', 'Co-trimoxazole 480mg tablets'],
  ['co-amilofruse', 'Co amilofruse 2.5mg/20mg tablets'],
  ['co-careldopa', 'Co-careldopa 25mg/100mg tablets'],
  ['neo-mercazole', 'neo mercazole 20mg'],
  // plain (non-hyphen) controls — must still agree
  ['ibuprofen', 'Ibuprofen 400mg tablets'],
  ['warfarin', 'Warfarin 3mg tablets'],
  ['lithium', 'Lithium carbonate 250mg modified-release tablets'],
];

console.log('--- single-drug and combo matching agree (positive) ---');
for (const [term, med] of SHOULD_MATCH) {
  const s = singleFires(term, med);
  const c = comboFires(term, med);
  check(s === true, `single-drug rule "${term}" fires for "${med}"`);
  check(c === true, `drug-combo set  "${term}" fires for "${med}"`);
  check(s === c, `MATCHERS AGREE for "${term}" / "${med}" (single=${s}, combo=${c})`);
}

// Negative controls: must NOT match in either path, and must agree.
const SHOULD_NOT_MATCH = [
  ['co-trimoxazole', 'Trimethoprim 200mg tablets'], // co-trimoxazole term must not catch plain trimethoprim
  ['warfarin', 'Apixaban 5mg tablets'],
  ['ibuprofen', 'Paracetamol 500mg tablets'],
];

console.log('\n--- single-drug and combo matching agree (negative) ---');
for (const [term, med] of SHOULD_NOT_MATCH) {
  const s = singleFires(term, med);
  const c = comboFires(term, med);
  check(s === false, `single-drug rule "${term}" does NOT fire for "${med}"`);
  check(c === false, `drug-combo set  "${term}" does NOT fire for "${med}"`);
  check(s === c, `MATCHERS AGREE (no-match) for "${term}" / "${med}"`);
}

// Exclude parity: an exclude term must suppress in both paths.
console.log('\n--- exclude folding agrees ---');
{
  const term = 'lithium';
  const med = 'Lithium-Med shampoo';
  const single = engine.drugMatchesRule(med, { drug: { match: [term], exclude: ['shampoo'] } });
  const comboRule = {
    type: 'drug-combo',
    enabled: true,
    label: 'x',
    drugSets: [{ name: 'S', match: [term], exclude: ['shampoo'] }],
    sex: 'any',
  };
  const combo =
    engine.evaluateDrugComboRule(comboRule, { medications: [{ name: med }], patientContext: {}, problems: [] }).length >
    0;
  check(single === false, 'single-drug exclude "shampoo" suppresses lithium shampoo');
  check(combo === false, 'drug-combo  exclude "shampoo" suppresses lithium shampoo');
  check(single === combo, 'exclude matchers agree');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
