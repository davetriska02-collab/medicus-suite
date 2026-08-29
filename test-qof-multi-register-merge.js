// Medicus Suite — QOF multi-register indicator merge
// Run with: node test-qof-multi-register-merge.js
//
// Several QOF indicators (SMOK002, CHOL003, CHOL004, CD001, CD002) apply
// across more than one disease register with an identical check/points/
// threshold — qof-rules.json models each as N separate per-register rule
// objects sharing one indicatorCode because the engine's register gate can't
// express "any of these registers" in a single rule. The rules' own notes
// already flag the consequence: "known cosmetic limitation... do not
// double-count if patient sees multiple chips" — a patient on two qualifying
// registers got two near-identical cards for the same underlying fact.
// mergeMultiRegisterQofIndicatorChips (engine/rules-engine.js) collapses
// same-indicatorCode, same-status chips into one, listing every register
// that triggered it. This pins that behaviour through the real engine and
// the real ruleset (not a hand-built rule).

'use strict';
const path = require('path');
const engine = require('./engine/rules-engine.js');
const qofRules = require(path.join(__dirname, 'rules', 'qof-rules.json')).rules;

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const chdRegister = qofRules.find((r) => r.type === 'qof-register' && r.registerCode === 'CHD');
const ckdRegister = qofRules.find((r) => r.type === 'qof-register' && r.registerCode === 'CKD');
const smok002Chd = qofRules.find((r) => r.id === 'qof-smok002-chd');
const smok002Ckd = qofRules.find((r) => r.id === 'qof-smok002-ckd');
const chol003Base = qofRules.find((r) => r.id === 'qof-chol003');
const chol003Ckd = qofRules.find((r) => r.id === 'qof-chol003-ckd');

const NOW = '2026-08-29T12:00:00';

console.log('\n--- rule wiring ---');
check(!!chdRegister && !!ckdRegister, 'CHD and CKD register rules exist');
check(!!smok002Chd && !!smok002Ckd, 'SMOK002 CHD and CKD variants exist');
check(!!chol003Base && !!chol003Ckd, 'CHOL003 base and CKD variants exist');

console.log('\n--- patient on BOTH CHD and CKD registers: SMOK002 fires once, not twice ---');
{
  const problems = [
    { label: 'Coronary heart disease', codedDate: '2019-01-01', status: 'active' },
    { label: 'Chronic kidney disease stage 3', codedDate: '2020-01-01', status: 'active' },
  ];
  const chips = engine.evaluatePatient([], [], [chdRegister, ckdRegister, smok002Chd, smok002Ckd], {
    now: NOW,
    problems,
  });
  const smok = chips.filter((c) => c.indicatorCode === 'SMOK002');
  check(smok.length === 1, `exactly one SMOK002 chip, not one per register (got ${smok.length})`);
  check(smok[0] && smok[0].status === 'no_data', `status computed once (got ${smok[0] && smok[0].status})`);
  check(
    Array.isArray(smok[0].mergedRegisters) && smok[0].mergedRegisters.length === 2,
    `mergedRegisters lists both triggering registers (got ${JSON.stringify(smok[0].mergedRegisters)})`
  );
  const labels = (smok[0].mergedRegisters || []).map((r) => r.label).sort();
  check(
    labels.join(',') === 'Chronic Kidney Disease,Coronary Heart Disease',
    `register labels are the friendly qof-register names (got ${labels.join(',')})`
  );
}

console.log('\n--- patient on CHD only: SMOK002 fires once, no mergedRegisters noise ---');
{
  const problems = [{ label: 'Coronary heart disease', codedDate: '2019-01-01', status: 'active' }];
  const chips = engine.evaluatePatient([], [], [chdRegister, ckdRegister, smok002Chd, smok002Ckd], {
    now: NOW,
    problems,
  });
  const smok = chips.filter((c) => c.indicatorCode === 'SMOK002');
  check(smok.length === 1, `single-register patient still gets exactly one chip (got ${smok.length})`);
  check(
    !smok[0].mergedRegisters,
    `no mergedRegisters field when only one register fired (got ${JSON.stringify(smok[0].mergedRegisters)})`
  );
}

console.log('\n--- CHOL003 base + CKD variant both fire for a CHD+CKD patient: merged, longer name kept ---');
{
  const problems = [
    { label: 'Coronary heart disease', codedDate: '2019-01-01', status: 'active' },
    { label: 'Chronic kidney disease stage 3', codedDate: '2020-01-01', status: 'active' },
  ];
  const chips = engine.evaluatePatient([], [], [chdRegister, ckdRegister, chol003Base, chol003Ckd], {
    now: NOW,
    problems,
  });
  const chol = chips.filter((c) => c.indicatorCode === 'CHOL003');
  check(chol.length === 1, `exactly one CHOL003 chip (got ${chol.length})`);
  check(
    chol[0] && /CVD\/CKD/.test(chol[0].indicatorName || ''),
    `kept the more general combined name (got ${chol[0] && chol[0].indicatorName})`
  );
  check(chol[0] && chol[0].points === 20, `points is a single value, not summed (got ${chol[0] && chol[0].points})`);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
