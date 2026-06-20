// Medicus Suite — alert-library clinical-content coverage test
// Run with: node test-alert-library-coverage.js
//
// Sibling of test-drug-brand-coverage.js, for rules/alert-library.json. That file
// carries the 13 PINCER prescribing-safety alerts, the MHRA valproate/isotretinoin
// Pregnancy-Prevention alerts, NICE lithium monitoring, the QTc-combination alert,
// recurrent-UTI/falls event-counts and the rising-PSA trend. Until now those 23
// entries had only STRUCTURAL (schema) checks and a date-based currency check —
// nothing pinned the actual CLINICAL VALUES. An edit that downgraded a red alert
// to amber, lengthened a monitoring interval, or dropped a drug from a set would
// pass every test and silently weaken a patient-safety alert.
//
// This pins, per libId: the rule type, the severity, monitoring-test intervals,
// representative drug-set membership, and the safety-critical demographic gates —
// and fires the highest-stakes combos through the real engine. When you
// legitimately change a value here, update EXPECTED in the same commit (the diff
// is then the clinician-reviewable record of the change).

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const lib = require(path.join(__dirname, 'rules', 'alert-library.json'));

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

const entries = lib.library || [];
const byId = (id) => (entries.find((e) => e.libId === id) || {}).rule;

// Collect every match term across a drug-combo rule's drugSets (lower-cased).
function comboTerms(rule) {
  return (rule.drugSets || []).flatMap((s) => (s.match || []).map((m) => String(m).toLowerCase()));
}
// intervalDays for a monitoring test whose name contains `nameSub`.
function testInterval(rule, nameSub) {
  const t = (rule.tests || []).find((x) =>
    String(x.name || '')
      .toLowerCase()
      .includes(nameSub.toLowerCase())
  );
  return t ? t.intervalDays : undefined;
}

// EXPECTED clinical content, keyed by libId.
//   type      — rule.type (always pinned)
//   severity  — rule.severity (combo / event-count / composite)
//   terms     — drug terms that MUST be present in the drugSets (combo)
//   drugTerms — terms that MUST be in drug.match (drug-monitoring)
//   intervals — { testNameSubstring: intervalDays } (drug-monitoring)
//   age/sex   — safety-critical demographic gates
//   count/op  — event-count threshold + operator
const EXPECTED = {
  'pincer-1': { type: 'drug-combo', severity: 'red', terms: ['ibuprofen', 'naproxen', 'diclofenac'], ageMin: 65 },
  'pincer-2': { type: 'drug-combo', severity: 'red', terms: ['warfarin', 'apixaban', 'ibuprofen', 'naproxen'] },
  'pincer-3': { type: 'drug-combo', severity: 'red', terms: ['aspirin 75', 'ibuprofen'] },
  'pincer-4': { type: 'drug-combo', severity: 'red', terms: ['ramipril', 'losartan', 'ibuprofen'] },
  'pincer-5': { type: 'drug-combo', severity: 'red', terms: ['bisoprolol', 'verapamil', 'diltiazem'] },
  'pincer-6': { type: 'drug-combo', severity: 'red', terms: ['ibuprofen', 'naproxen'] },
  'pincer-7': { type: 'drug-monitoring', drugTerms: ['warfarin'], intervals: { inr: 90 } },
  'pincer-8': {
    type: 'drug-combo',
    severity: 'amber',
    terms: ['aspirin 75', 'clopidogrel', 'ticagrelor', 'prasugrel'],
  },
  'pincer-9': { type: 'drug-monitoring', drugTerms: ['metformin'], intervals: { 'u&e': 365 } },
  'pincer-10': { type: 'drug-monitoring', drugTerms: ['furosemide', 'bumetanide'], intervals: { 'u&e': 180 } },
  'pincer-11': { type: 'drug-monitoring', drugTerms: ['amiodarone'], intervals: { tft: 180, lft: 180 } },
  'pincer-12': { type: 'drug-combo', severity: 'red', terms: ['lithium', 'ibuprofen'] },
  'pincer-13': { type: 'drug-combo', severity: 'red', terms: ['warfarin', 'apixaban', 'clopidogrel'], ageMin: 75 },
  'mhra-valproate-ppg': {
    type: 'drug-combo',
    severity: 'red',
    terms: ['sodium valproate', 'valproic acid', 'valproate', 'epilim', 'depakote'],
    ageMin: 12,
    ageMax: 55,
    sex: 'F',
  },
  'nice-lithium-monitoring': {
    type: 'drug-monitoring',
    drugTerms: ['lithium'],
    intervals: { 'lithium level': 90, 'u&e': 180, tft: 180, calcium: 180 },
  },
  'mhra-sglt2-dka': {
    type: 'drug-combo',
    severity: 'info',
    terms: ['dapagliflozin', 'empagliflozin', 'canagliflozin'],
  },
  'mhra-glp1-acute-pancreatitis': {
    type: 'drug-combo',
    severity: 'amber',
    terms: ['semaglutide', 'tirzepatide', 'dulaglutide', 'liraglutide'],
  },
  'mhra-isotretinoin-ppg': {
    type: 'drug-combo',
    severity: 'amber',
    terms: ['isotretinoin', 'roaccutane'],
    ageMin: 12,
    ageMax: 55,
    sex: 'F',
  },
  'prescribing-qtc-combination': {
    type: 'drug-combo',
    severity: 'amber',
    terms: ['amiodarone', 'citalopram', 'haloperidol'],
  },
  'event-count-1': { type: 'event-count', severity: 'amber', count: 3, op: '>=', sex: 'F', ageMax: 65 },
  'event-count-2': { type: 'event-count', severity: 'amber', count: 2, op: '>=', ageMin: 65 },
  'composite-1': { type: 'composite', severity: 'red' },
  'trend-1': { type: 'qof-indicator', sex: 'M', ageMin: 40 },
};

for (const [id, exp] of Object.entries(EXPECTED)) {
  console.log(`\n--- ${id} ---`);
  const rule = byId(id);
  check(!!rule, `entry "${id}" exists in alert-library.json`);
  if (!rule) continue;

  check(rule.type === exp.type, `${id} type === "${exp.type}" (got "${rule.type}")`);

  if (exp.severity != null) {
    check(rule.severity === exp.severity, `${id} severity === "${exp.severity}" (got "${rule.severity}")`);
  }

  if (exp.terms) {
    const terms = comboTerms(rule);
    for (const t of exp.terms) {
      check(terms.includes(t), `${id} drugSets contain "${t}"`);
    }
  }

  if (exp.drugTerms) {
    const dm = (rule.drug && rule.drug.match ? rule.drug.match : []).map((m) => String(m).toLowerCase());
    for (const t of exp.drugTerms) {
      check(dm.includes(t), `${id} drug.match contains "${t}"`);
    }
  }

  if (exp.intervals) {
    for (const [nameSub, days] of Object.entries(exp.intervals)) {
      check(
        testInterval(rule, nameSub) === days,
        `${id} "${nameSub}" interval === ${days}d (got ${testInterval(rule, nameSub)})`
      );
    }
  }

  if (exp.ageMin != null) check((rule.ageRange || {}).min === exp.ageMin, `${id} ageRange.min === ${exp.ageMin}`);
  if (exp.ageMax != null) check((rule.ageRange || {}).max === exp.ageMax, `${id} ageRange.max === ${exp.ageMax}`);
  if (exp.sex != null) check(rule.sex === exp.sex, `${id} sex === "${exp.sex}"`);
  if (exp.count != null) check(rule.countThreshold === exp.count, `${id} countThreshold === ${exp.count}`);
  if (exp.op != null) check(rule.operator === exp.op, `${id} operator === "${exp.op}"`);
}

// === END-TO-END FIRING (highest-stakes combos, through the real engine) ===
// Proves the rule actually fires for a representative patient — guarding both the
// rule content and the matching pipeline (incl. the shared drug normaliser).
console.log('\n--- end-to-end firing (real engine) ---');
function comboFires(libId, meds, ctx, problems) {
  const rule = byId(libId);
  if (!rule) return false;
  return (
    engine.evaluateDrugComboRule(rule, {
      medications: meds.map((n) => ({ name: n })),
      patientContext: ctx || {},
      problems: (problems || []).map((l) => ({ label: l })),
    }).length > 0
  );
}

check(
  comboFires('pincer-2', ['Warfarin 3mg tablets', 'Naproxen 500mg tablets'], {}),
  'pincer-2 fires: warfarin + naproxen'
);
check(comboFires('pincer-12', ['Lithium carbonate 250mg', 'Ibuprofen 400mg'], {}), 'pincer-12 fires: lithium + NSAID');
check(comboFires('pincer-5', ['Bisoprolol 5mg', 'Diltiazem 120mg'], {}), 'pincer-5 fires: beta-blocker + diltiazem');
check(
  comboFires('mhra-valproate-ppg', ['Epilim 500mg tablets'], { ageYears: 30, sex: 'F' }),
  'valproate PPP fires: Epilim in a 30yo female'
);
check(
  !comboFires('mhra-valproate-ppg', ['Epilim 500mg tablets'], { ageYears: 30, sex: 'M' }),
  'valproate PPP does NOT fire for a male (sex gate holds)'
);
check(comboFires('pincer-6', ['Ibuprofen 400mg'], {}, ['Heart failure']), 'pincer-6 fires: NSAID + HF problem');
check(!comboFires('pincer-6', ['Ibuprofen 400mg'], {}, []), 'pincer-6 does NOT fire without HF problem');

// === INVERSE COVERAGE: every library entry has an EXPECTED entry ===
console.log('\n--- inverse coverage: every alert-library entry is pinned ---');
for (const e of entries) {
  check(Object.prototype.hasOwnProperty.call(EXPECTED, e.libId), `library entry "${e.libId}" has an EXPECTED pin`);
}
console.log(`(${entries.length} library entries audited)`);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
