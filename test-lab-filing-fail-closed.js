// Medicus Suite — lab-filing fail-closed regression tests
// Run with: node test-lab-filing-fail-closed.js
//
// Pins the 2026-08-22 clinical-safety-audit remediations (R1a–R1e, R11) on the
// W7 all-normal filing gate. Every case here was a demonstrated FAIL-OPEN
// before the fix: an input the gate could not judge that graded fileable.
// If one of these checks starts failing, the gate has regressed toward the
// permissive direction on the one write path the whole safety case protects.

'use strict';

const LF = require('./shared/lab-filing-utils.js');
const SEV = require('./engine/result-severity.js');

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

// A minimal enabled rule set so fileabilityBlockers' no-rules blocker stays quiet.
const RULES = [
  {
    id: 'r1',
    kind: 'threshold',
    label: 'Potassium high',
    match: ['potassium'],
    unit: 'mmol/L',
    above: 6.0,
    abnormalLevel: 'red',
    enabled: true,
  },
];

function numericResult(over) {
  return Object.assign(
    {
      name: 'Total protein',
      value: 72,
      rawValue: '72',
      comparator: null,
      unit: 'g/L',
      low: 60,
      high: 80,
      isAbove: false,
      isBelow: false,
      urgent: false,
      interpretation: null,
      date: '2026-08-20',
      history: [],
      text: '72',
      specimen: null,
    },
    over
  );
}

function report(results, over) {
  return Object.assign({ results, unmatched: false, patientUuid: 'uuid-1' }, over);
}

// ── R1a: numeric result carrying an abnormal comment blocks filing ─────────────
console.log('--- R1a numeric-with-comment ---');
{
  const r = numericResult({
    text: '72 Paraprotein band detected - suggest immunofixation and clinical review',
  });
  const rep = report([r]);
  const sev = SEV.evaluateReportSeverity(rep, { priorityDisplay: '', resultRules: RULES, problems: [] });
  const blockers = LF.fileabilityBlockers(rep, sev, RULES);
  check(
    blockers.some((b) => /comment the suite cannot score/.test(b)),
    'in-range numeric with pathologist comment is NOT fileable'
  );
}
{
  const r = numericResult({ text: '72' });
  const blockers = LF.fileabilityBlockers(
    report([r]),
    SEV.evaluateReportSeverity(report([r]), { priorityDisplay: '', resultRules: RULES, problems: [] }),
    RULES
  );
  check(blockers.length === 0, 'plain numeric (text = its own value) still fileable');
}
{
  const r = numericResult({ text: '72 g/L Normal - No Action' });
  const blockers = LF.fileabilityBlockers(
    report([r]),
    SEV.evaluateReportSeverity(report([r]), { priorityDisplay: '', resultRules: RULES, problems: [] }),
    RULES
  );
  check(blockers.length === 0, 'benign "Normal - No Action" comment still fileable');
}
{
  const r = numericResult({ text: '72 repeat in 3 months' });
  const blockers = LF.fileabilityBlockers(
    report([r]),
    SEV.evaluateReportSeverity(report([r]), { priorityDisplay: '', resultRules: RULES, problems: [] }),
    RULES
  );
  check(
    blockers.some((b) => /comment the suite cannot score/.test(b)),
    'non-benign instruction ("repeat in 3 months") blocks — unknown phrases fail closed'
  );
}

// ── R1b: unidirectional parameter matching ─────────────────────────────────────
console.log('--- R1b findParamFor unidirectional ---');
check(LF.findParamFor('Hb', [{ analyte: 'hba1c', high: 47 }]) === null, "param 'hba1c' does NOT capture result 'Hb'");
check(
  LF.findParamFor('HbA1c (IFCC)', [{ analyte: 'hba1c', high: 47 }]) !== null,
  "param 'hba1c' still matches result 'HbA1c (IFCC)'"
);
check(
  LF.findParamFor('Haemoglobin', [{ analyte: 'haemoglobin', low: 120 }]) !== null,
  "param 'haemoglobin' still matches result 'Haemoglobin'"
);
{
  // The reproduced audit exploit: Hb 41 LOW + an hba1c parameter + override on.
  const rep = report([
    numericResult({ name: 'Hb', value: 41, rawValue: '41', unit: 'g/L', low: 120, high: 160, isBelow: true, text: '41' }),
  ]);
  const profile = { paramsOverrideLabFlags: true, parameters: [{ analyte: 'hba1c', high: 47, unit: 'mmol/mol' }] };
  const adj = LF.applyParamOverrides(rep, profile);
  check(adj.results[0].isBelow === true, 'Hb 41 LOW flag survives an hba1c parameter (override cannot cross-match)');
}

// ── R1c: un-ranged numeric fails closed by default ─────────────────────────────
console.log('--- R1c requireRangeForAll default ---');
{
  const clean = LF.sanitiseProfile({ name: 'x', filing: { normalOptionText: 'n', fileButtonText: 'f' } });
  check(clean.requireRangeForAll === true, 'sanitiseProfile defaults requireRangeForAll to TRUE');
  const explicitOff = LF.sanitiseProfile({
    name: 'x',
    filing: { normalOptionText: 'n', fileButtonText: 'f' },
    requireRangeForAll: false,
  });
  check(explicitOff.requireRangeForAll === false, 'explicit false is still honoured (deliberate opt-out)');
}
{
  // Stored legacy profile with the key absent entirely: gate must still require ranges.
  const rep = report([
    numericResult({ name: 'Serum urate', value: 720, rawValue: '720', unit: 'umol/L', low: null, high: null, text: '720' }),
  ]);
  const blockers = LF.profileParamBlockers(rep, { parameters: [] });
  check(
    blockers.some((b) => /no reference range/.test(b)),
    'un-ranged analyte with no parameter blocks even for a legacy profile missing the key'
  );
}

// ── R1/F7: unit mismatch is a blocker and vetoes the override ──────────────────
console.log('--- unit compatibility on parameters ---');
{
  const rep = report([
    numericResult({ name: 'Digoxin', value: 1.4, rawValue: '1.4', unit: 'nmol/L', low: null, high: null, text: '1.4' }),
  ]);
  const profile = { parameters: [{ analyte: 'digoxin', high: 2, unit: 'ug/L' }] };
  const blockers = LF.profileParamBlockers(rep, profile);
  check(
    blockers.some((b) => /units don't match/.test(b)),
    'parameter in µg/L against a value in nmol/L is a blocker, not a silent compare'
  );
}
{
  const rep = report([
    numericResult({ name: 'eGFR', value: 75, rawValue: '75', unit: 'nmol/L', low: 90, high: 120, isBelow: true, text: '75' }),
  ]);
  const profile = { paramsOverrideLabFlags: true, parameters: [{ analyte: 'egfr', low: 60, unit: 'mL/min/1.73m2' }] };
  const adj = LF.applyParamOverrides(rep, profile);
  check(adj.results[0].isBelow === true, 'unit mismatch never clears a lab flag');
}

// ── R1/F6: comparator-censored values fail closed at the bound ─────────────────
console.log('--- comparator censoring ---');
{
  const rep = report([
    numericResult({
      name: 'HbA1c (IFCC)',
      value: 47,
      rawValue: '>47',
      comparator: '>',
      unit: 'mmol/mol',
      low: null,
      high: null,
      text: '>47',
    }),
  ]);
  const profile = { parameters: [{ analyte: 'hba1c', high: 47, unit: 'mmol/mol' }] };
  const blockers = LF.profileParamBlockers(rep, profile);
  check(
    blockers.some((b) => /above your set maximum/.test(b)),
    '">47" against a set maximum of 47 blocks (true value exceeds the bound)'
  );
}
{
  const rep = report([
    numericResult({
      name: 'eGFR',
      value: 90,
      rawValue: '>90',
      comparator: '>',
      unit: 'mL/min/1.73m2',
      low: 90,
      high: 120,
      isAbove: true,
      text: '>90',
    }),
  ]);
  const profile = { paramsOverrideLabFlags: true, parameters: [{ analyte: 'egfr', low: 60, high: 200, unit: 'mL/min/1.73m2' }] };
  const adj = LF.applyParamOverrides(rep, profile);
  check(adj.results[0].isAbove === true, 'a censored value never clears a lab flag via the override');
}

// ── R1d: own-reference-range escalate-only belt ────────────────────────────────
console.log('--- outsideOwnRange belt ---');
{
  const rep = report([
    numericResult({ name: 'Potassium', value: 150, rawValue: '150', unit: 'mmol/L', low: 60, high: 80, text: '150' }),
  ]);
  const sev = SEV.evaluateReportSeverity(rep, { priorityDisplay: '', resultRules: RULES, problems: [] });
  check(sev.level !== 'none', 'value outside its OWN parsed range grades abnormal even with all lab flags absent');
  const blockers = LF.fileabilityBlockers(rep, sev, RULES);
  check(blockers.length > 0, '…and is therefore not fileable');
}
check(SEV.outsideOwnRange({ value: 70, low: 60, high: 80 }) === false, 'in-range value stays clean');
check(SEV.outsideOwnRange({ value: 5, rawValue: '<5', comparator: '<', low: 1, high: 10 }) === false, '"<5" below-censored inside range stays clean');
check(SEV.outsideOwnRange({ value: 5.3, comparator: '>', low: 3.5, high: 5.3 }) === true, '">5.3" touching the high bound is out of range');
check(SEV.outsideOwnRange({ value: 4, comparator: '<', low: 3.5, high: 5.3 }) === false, '"<4" never fires the above-range arm');
check(SEV.outsideOwnRange({ value: NaN, low: 1, high: 2 }) === false, 'non-finite value never derives a flag');

// ── R1e: evaluator crash is not "confirmed normal" ─────────────────────────────
console.log('--- evalError fail-closed ---');
{
  const blockers = LF.fileabilityBlockers(report([numericResult({})]), { level: 'none', evalError: true }, RULES);
  check(
    blockers.some((b) => /severity check failed/.test(b)),
    'severity marked evalError blocks filing even at level none'
  );
}

// ── R11: never-auto-file list fails closed on a missing patient uuid ───────────
console.log('--- suppress-list fail-closed ---');
{
  const rep = report([numericResult({})], { patientUuid: null });
  const blockers = LF.suppressedBlockers(rep, ['uuid-9']);
  check(
    blockers.some((b) => /could not confirm/.test(b)),
    'non-empty suppress list + no patient uuid blocks'
  );
  check(LF.suppressedBlockers(rep, []).length === 0, 'empty suppress list stays quiet with no uuid');
  check(
    LF.suppressedBlockers(report([numericResult({})]), ['uuid-1']).some((b) => /never auto-file/.test(b)),
    'listed patient still blocks by uuid'
  );
  check(LF.suppressedBlockers(report([numericResult({})]), ['uuid-9']).length === 0, 'unlisted patient stays quiet');
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
