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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
