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
    numericResult({
      name: 'Hb',
      value: 41,
      rawValue: '41',
      unit: 'g/L',
      low: 120,
      high: 160,
      isBelow: true,
      text: '41',
    }),
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
    numericResult({
      name: 'Serum urate',
      value: 720,
      rawValue: '720',
      unit: 'umol/L',
      low: null,
      high: null,
      text: '720',
    }),
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
    numericResult({
      name: 'eGFR',
      value: 75,
      rawValue: '75',
      unit: 'nmol/L',
      low: 90,
      high: 120,
      isBelow: true,
      text: '75',
    }),
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
  const profile = {
    paramsOverrideLabFlags: true,
    parameters: [{ analyte: 'egfr', low: 60, high: 200, unit: 'mL/min/1.73m2' }],
  };
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
check(
  SEV.outsideOwnRange({ value: 5, rawValue: '<5', comparator: '<', low: 1, high: 10 }) === false,
  '"<5" below-censored inside range stays clean'
);
check(
  SEV.outsideOwnRange({ value: 5.3, comparator: '>', low: 3.5, high: 5.3 }) === true,
  '">5.3" touching the high bound is out of range'
);
check(
  SEV.outsideOwnRange({ value: 4, comparator: '<', low: 3.5, high: 5.3 }) === false,
  '"<4" never fires the above-range arm'
);
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

// ── 2026-08-23 review fixes ──────────────────────────────────────────────────
console.log('\n--- 2026-08-23 review fixes: parameter matching, migration, unjudgeable rows ---');
{
  // A — a SHORT parameter must not capture a DIFFERENT, longer-named analyte.
  const params = [{ analyte: 'albumin', low: 35, high: 50 }];
  check(LF.findParamFor('Microalbumin', params) === null, 'albumin parameter does NOT capture Microalbumin');
  check(!!LF.findParamFor('Serum albumin', params), 'albumin parameter still matches Serum albumin');

  // …and the lab's own HIGH flag must survive, with the override on.
  const flagged = {
    results: [{ name: 'Microalbumin', value: 40, unit: 'mg/L', low: null, high: null, isAbove: true, text: '' }],
  };
  const prof = { parameters: params, paramsOverrideLabFlags: true };
  check(
    LF.applyParamOverrides(flagged, prof).results[0].isAbove === true,
    'lab HIGH flag on Microalbumin is NOT cleared by an albumin parameter'
  );
  check(
    LF.profileParamBlockers(flagged, prof).length > 0,
    'a lab-flagged Microalbumin with no parameter of its own still blocks'
  );

  // A — most specific wins, not first-listed.
  const two = [
    { analyte: 'hb', low: 130, high: 170 },
    { analyte: 'hba1c', low: 20, high: 47 },
  ];
  const won = LF.findParamFor('HbA1c (IFCC)', two);
  check(won && won.analyte === 'hba1c', 'HbA1c (IFCC) resolves to the hba1c parameter, not hb');
  check(LF.findParamFor('Hb', two).analyte === 'hb', 'a bare Hb result still resolves to the hb parameter');
  // A short code must never capture a longer analyte at all.
  check(
    LF.findParamFor('HbA1c (IFCC)', [{ analyte: 'hb', low: 130, high: 170 }]) === null,
    'hb alone does not capture HbA1c'
  );
  // Real-world glued names still match (4+ char terms may match a token prefix).
  check(
    !!LF.findParamFor('eGFRcreat (CKD-EPI)/1.73 m*2', [{ analyte: 'egfr', low: 60 }]),
    'egfr still matches eGFRcreat'
  );

  // A — an unresolved tie blocks instead of silently picking one range.
  const tie = [
    { analyte: 'free t4', low: 12, high: 22 },
    { analyte: 'tsh', low: 0.3, high: 4.2 },
  ];
  check(!!LF.findParamAmbiguity('Free T4 / TSH', tie), 'two unrelated parameters on one result name are ambiguous');
  check(
    LF.profileParamBlockers({ results: [{ name: 'Free T4 / TSH', value: 3, unit: null }] }, { parameters: tie }).some(
      (r) => /more than one of your parameters/.test(r)
    ),
    'an ambiguous parameter match BLOCKS'
  );
  check(
    LF.findParamAmbiguity('Adjusted calcium', [
      { analyte: 'calcium', low: 2.2, high: 2.6 },
      { analyte: 'adjusted calcium', low: 2.2, high: 2.6 },
    ]) === null,
    'a more specific refinement of the same analyte is not a tie'
  );
}
{
  // B — the fail-closed default must reach profiles already saved in the field.
  const legacy = { id: 'p1', name: 'U&E', requireRangeForAll: false };
  check(
    LF.migrateStoredProfile(legacy).requireRangeForAll === true,
    'a pre-schema stored profile is upgraded to fail-closed'
  );
  check(
    LF.migrateStoredProfile({ id: 'p1', lfSchema: LF.LF_SCHEMA, requireRangeForAll: false }).requireRangeForAll ===
      false,
    'a deliberate opt-out made AFTER the migration is honoured'
  );
  check(
    LF.sanitiseProfile({ id: 'p', name: 'n' }).lfSchema === LF.LF_SCHEMA,
    'a freshly saved profile carries the schema marker'
  );
  const migrated = LF.migrateStoredProfiles([legacy, null]);
  check(migrated.length === 2 && migrated[0].requireRangeForAll === true, 'migrateStoredProfiles maps the whole list');
}
{
  // D — a row the suite could not read at all must never grade normal.
  const unreadable = {
    results: [
      { name: 'Serum free light chains', value: NaN, rawValue: '', unit: 'mg/L', low: null, high: null, text: '' },
    ],
  };
  check(
    LF.profileParamBlockers(unreadable, { parameters: [], requireRangeForAll: false }).some((r) =>
      /no readable value/.test(r)
    ),
    'a result with no value and no text blocks even with requireRangeForAll off'
  );
  check(
    LF.profileParamBlockers({ results: [null] }, { parameters: [] }).some((r) => /could not be read at all/.test(r)),
    'a null result row blocks'
  );
  check(
    LF.profileParamBlockers(
      { results: [{ name: 'Sodium', value: 140, unit: 'mmol/L', low: 133, high: 146 }] },
      { parameters: [] }
    ).length === 0,
    'a well-formed in-range result with a lab range still files'
  );
}
{
  // E — units must be confirmable before a clinician range clears a lab flag.
  const digoxin = {
    results: [{ name: 'Digoxin', value: 1.4, unit: null, low: 0.5, high: 1.0, isAbove: true, text: '' }],
  };
  const prof = {
    parameters: [{ analyte: 'digoxin', low: 0.8, high: 2.0, unit: 'ug/L' }],
    paramsOverrideLabFlags: true,
  };
  check(
    LF.applyParamOverrides(digoxin, prof).results[0].isAbove === true,
    'a ug/L parameter does NOT clear a lab flag on a value of unknown unit'
  );
  // Both sides unitless is the ordinary eGFR case and still applies.
  const egfr = { results: [{ name: 'eGFR', value: 89, low: 90, high: 120, isBelow: true }] };
  check(
    LF.applyParamOverrides(egfr, { parameters: [{ analyte: 'egfr', low: 60 }], paramsOverrideLabFlags: true })
      .results[0].isBelow === false,
    'an unitless parameter still overrides an unitless lab flag (eGFR)'
  );
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
