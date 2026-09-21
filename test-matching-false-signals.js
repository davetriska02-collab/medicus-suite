// Medicus Suite — cross-domain matching false-signal regression tests
// Run with: node test-matching-false-signals.js
//
// Guards three verified 2026-07-18 audit findings, all "confusable neighbour"
// substring bugs:
//   H2 — bare "statin" matched Nystatin → false MET on QOF lipid-lowering
//   H3 — negation cues scanned the whole label prefix → "History of MI;
//        heart failure" failed a heart-failure gate (alert never fired)
//   H4 — "potassium" matched "Urine potassium" → red hyperkalaemia off urine

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const qofRules = require(path.join(__dirname, 'rules', 'qof-rules.json'));
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

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

const NOW = '2026-07-18T10:00:00.000Z';

function evalOne(rule, data) {
  const chips = engine.evaluatePatient(data.medications || [], data.observations || [], [rule], {
    now: NOW,
    problems: data.problems || [],
    patientContext: data.patientContext || { ageYears: 70, sex: 'M' },
    observationHistory: data.observationHistory || [],
    _registerLookup: data._registerLookup,
  });
  return chips.find((c) => c.ruleId === rule.id || c.indicatorCode === rule.indicatorCode) || chips[0] || null;
}

console.log('\n--- H2: non-lipid "-statin" drugs must not satisfy lipid-lowering ---');
{
  const chol = qofRules.rules.find((r) => r.indicatorCode === 'CHOL003');
  assert(!!chol, 'CHOL003 rule found');
  const chdRegister = qofRules.rules.find((r) => r.type === 'qof-register' && r.registerCode === chol.requiresRegister);
  assert(!!chdRegister, `register rule for ${chol.requiresRegister} found`);
  const statusFor = (medName) => {
    const chips = engine.evaluateQofIndicatorRule(
      chol,
      {
        medications: [{ name: medName }],
        observations: [],
        problems: [{ label: 'Coronary heart disease', codedDate: '2020-01-01' }],
        patientContext: { ageYears: 70, sex: 'M' },
        _registerLookup: { [chol.requiresRegister]: chdRegister },
      },
      NOW
    );
    return chips.length ? chips[0].status : null;
  };
  assert(
    statusFor('Nystatin 100,000units/ml oral suspension') !== 'achieved',
    `nystatin only → ${statusFor('Nystatin 100,000units/ml oral suspension')} (must not be achieved)`
  );
  assert(statusFor('Sandostatin 100micrograms/1ml injection') !== 'achieved', 'sandostatin only → not achieved');
  assert(statusFor('Atorvastatin 40mg tablets') === 'achieved', 'atorvastatin → achieved (real statins still match)');
}

console.log('\n--- H3: negation is clause-bounded, not whole-prefix ---');
{
  // Direct unit checks via passesProblemFilters through a minimal combo rule.
  const rule = {
    id: 'test-hf-gate',
    type: 'drug-combo',
    enabled: true,
    severity: 'red',
    label: 'HF gate test',
    drugSets: [{ name: 'nsaid', match: ['ibuprofen'] }],
    requiresProblem: ['heart failure'],
  };
  const meds = [{ name: 'Ibuprofen 400mg tablets' }];
  const fire = (label) =>
    engine.evaluatePatient(meds, [], [rule], {
      now: NOW,
      problems: [{ label, codedDate: '2024-01-01' }],
      patientContext: { ageYears: 70 },
    }).length > 0;

  assert(fire('Heart failure'), 'plain "Heart failure" fires the gated rule');
  assert(fire('History of MI; heart failure'), '"History of MI; heart failure" fires (cue in another clause)');
  assert(
    fire('Annual review done. no concerns noted about mobility issues today; heart failure'),
    'distant cue across boundaries does not negate'
  );
  assert(!fire('No heart failure'), '"No heart failure" still negates');
  assert(!fire('Query heart failure'), '"Query heart failure" still negates');
  assert(!fire('History of heart failure'), '"History of heart failure" still negates (adjacent cue)');
  assert(!fire('no significant heart failure'), 'near cue within reach still negates');
}

console.log('\n--- H4: specimen-qualified analytes must not satisfy serum alert rules ---');
{
  const hyperK = qofRules.rules.find((r) => r.id === 'alert-hyperkalaemia');
  assert(!!hyperK, 'alert-hyperkalaemia rule found');
  const base = { patientContext: { ageYears: 70, sex: 'M' } };
  // Newer urine potassium must NOT outrank the older normal serum value.
  const mixed = evalOne(hyperK, {
    ...base,
    observations: [
      { name: 'Potassium', value: '4.2 mmol/L', date: '2026-07-01' },
      { name: 'Urine potassium', value: '38 mmol/L', date: '2026-07-10' },
    ],
  });
  assert(
    !mixed || (mixed.status !== 'alert' && mixed.status !== 'not_met'),
    `urine K newer than normal serum K → ${mixed && mixed.status} (no red alert)`
  );
  const urineOnly = evalOne(hyperK, {
    ...base,
    observations: [{ name: 'Urine potassium', value: '38 mmol/L', date: '2026-07-10' }],
  });
  assert(!urineOnly || (urineOnly.status !== 'alert' && urineOnly.status !== 'not_met'), 'urine K alone → no alert');
  const serumHigh = evalOne(hyperK, {
    ...base,
    observations: [{ name: 'Serum potassium', value: '6.2 mmol/L', date: '2026-07-10' }],
  });
  assert(
    serumHigh && (serumHigh.status === 'alert' || serumHigh.status === 'not_met'),
    `serum K 6.2 → ${serumHigh && serumHigh.status} (real alert still fires)`
  );
}

// Drug-monitoring uses the same substring matcher. A newer urine specimen must
// not headline a serum analyte, and bare "hr" must not treat prothrombin time
// as a pulse. Dates are relative to MON_NOW (2026-09-21).
const MON_NOW = '2026-09-21T10:00:00.000Z';
const RECENT = '2026-09-01';
// Older than every maintenance interval below (longest stale window is thiazide 365×2).
const OLD = '2024-01-01';

function drugRule(id) {
  return drugRules.rules.find((r) => r.id === id);
}

function monitoringRow(ruleId, testName, medName, observations) {
  const rule = drugRule(ruleId);
  const chips = engine.evaluateDrugRule(
    rule,
    {
      medications: [{ name: medName, source: 'repeat' }],
      observations,
      problems: [],
      patientContext: { ageYears: 50, sex: 'F' },
    },
    MON_NOW
  );
  const chip = chips[0];
  return (chip && chip.tests && chip.tests.find((t) => t.name === testName)) || null;
}

console.log('\n--- H4 on drug monitoring: urine must not satisfy a serum check ---');
{
  const cases = [
    ['lithium-maintenance', 'Calcium', 'Priadel 400mg tablets', 'Urine calcium', 'Corrected calcium'],
    ['lithium-maintenance', 'Calcium', 'Priadel 400mg tablets', 'Urinary calcium', 'Serum calcium'],
    ['finerenone', 'U&E (serum potassium + eGFR)', 'Kerendia 10mg tablets', 'Urine potassium', 'Serum potassium'],
    ['ciclosporin-maintenance', 'U&E', 'Neoral 100mg capsules', 'Urine creatinine', 'Serum creatinine'],
    ['ciclosporin-maintenance', 'U&E', 'Neoral 100mg capsules', 'Urine albumin:creatinine ratio', 'Creatinine'],
    ['carbamazepine-maintenance', 'U&E / Sodium', 'Tegretol 200mg tablets', 'Urinary sodium', 'Sodium'],
    ['amiodarone-maintenance', 'U&E / Creatinine', 'Amiodarone 200mg tablets', 'Urine urea', 'Urea and electrolytes'],
    ['thiazide-diuretic-ue', 'U&E (sodium/potassium/renal)', 'Indapamide 2.5mg tablets', 'Urinary sodium', 'Sodium'],
    [
      'denosumab-calcium',
      'Calcium (before each 6-monthly dose)',
      'Prolia 60mg injection',
      'Urinary calcium',
      'Adjusted calcium',
    ],
  ];
  for (const [ruleId, testName, med, urineName, serumName] of cases) {
    const urineOnly = monitoringRow(ruleId, testName, med, [{ name: urineName, value: '1', date: RECENT }]);
    assert(
      urineOnly && urineOnly.status === 'no_data',
      `${ruleId} ${testName}: "${urineName}" alone → ${urineOnly && urineOnly.status} (must be no_data)`
    );
    const mixed = monitoringRow(ruleId, testName, med, [
      { name: serumName, value: '1', date: OLD },
      { name: urineName, value: '99', date: RECENT },
    ]);
    assert(
      mixed && mixed.status !== 'in_date' && mixed.latestObs && mixed.latestObs.name === serumName,
      `${ruleId} ${testName}: newer "${urineName}" must not headline older "${serumName}" (status ${mixed && mixed.status}, obs ${mixed && mixed.latestObs && mixed.latestObs.name})`
    );
    const serum = monitoringRow(ruleId, testName, med, [{ name: serumName, value: '1', date: RECENT }]);
    assert(serum && serum.status === 'in_date', `${ruleId} ${testName}: "${serumName}" still in date`);
  }
  const digoxin = { ...drugRule('digoxin-renal-monitoring'), enabled: true };
  const digUrine = engine.evaluateDrugRule(
    digoxin,
    {
      medications: [{ name: 'Digoxin 125mcg tablets', source: 'repeat' }],
      observations: [{ name: 'Urine creatinine', value: '8 mmol/L', date: RECENT }],
      problems: [],
      patientContext: { ageYears: 70, sex: 'M' },
    },
    MON_NOW
  );
  const digRow = digUrine[0] && digUrine[0].tests.find((t) => t.name === 'U&E / eGFR');
  assert(
    digRow && digRow.status === 'no_data',
    `disabled digoxin rule, if evaluated: urine creatinine → ${digRow && digRow.status} (must be no_data)`
  );
}

console.log('\n--- pulse "hr" is a word, not a substring of prothrombin ---');
{
  const pulse = 'Pulse / heart rate';
  const med = 'Intuniv 2mg tablets';
  const ptOnly = monitoringRow('guanfacine-maintenance', pulse, med, [
    { name: 'Prothrombin time', value: '12 s', date: RECENT },
  ]);
  assert(
    ptOnly && ptOnly.status === 'no_data',
    `prothrombin time alone → ${ptOnly && ptOnly.status} (must not count as a pulse)`
  );
  const mixed = monitoringRow('guanfacine-maintenance', pulse, med, [
    { name: 'Heart rate', value: '72 bpm', date: OLD },
    { name: 'Prothrombin time', value: '12 s', date: RECENT },
  ]);
  assert(
    mixed && mixed.status !== 'in_date' && mixed.latestObs && mixed.latestObs.name === 'Heart rate',
    `newer prothrombin must not headline an old heart rate (status ${mixed && mixed.status}, obs ${mixed && mixed.latestObs && mixed.latestObs.name})`
  );
  for (const name of ['HR', 'Heart rate', 'Resting heart rate']) {
    const row = monitoringRow('guanfacine-maintenance', pulse, med, [{ name, value: '70', date: RECENT }]);
    assert(row && row.status === 'in_date', `"${name}" still counts as a pulse`);
  }
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
