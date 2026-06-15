// test-result-combo.js — engine tests for kind:'combo' composite result rules.
// A combo fires when ALL its conditions are satisfied by SOME result within the
// SAME report (each condition may be met by a DIFFERENT result row). Combos are
// ESCALATE-ONLY: a fired amber combo raises level to ≥ amber; a fired red combo
// to red. They never lower level and never affect misprioritised.
//
// Run with: node test-result-combo.js
'use strict';

const { normaliseInvestigationReport } = require('./engine/normalisers.js');
const { evaluateReportSeverity } = require('./engine/result-severity.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

// ── Raw-result fixtures (Medicus API shapes) ─────────────────────────────────

// Pus cells as a numeric microscopy result. resultValue "50" → result.value 50.
function pusCells(resultValue) {
  return {
    description: 'Pus cells',
    resultValue: resultValue,
    resultUnit: '/µL',
    resultComparator: null,
    referenceRanges: [],
    isAboveReferenceRange: false,
    isBelowReferenceRange: false,
    requiresUrgentReview: false,
    interpretation: null,
    formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
    previousResults: [],
  };
}

// Urine culture as a free-text result. resultText → result.text.
function culture(resultText) {
  return {
    description: 'Culture',
    resultValue: null,
    resultText: resultText,
    resultUnit: null,
    resultComparator: null,
    referenceRanges: [],
    isAboveReferenceRange: false,
    isBelowReferenceRange: false,
    requiresUrgentReview: false,
    interpretation: null,
    formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
    previousResults: [],
  };
}

// Build a normalised report from a list of raw results, all under a named
// specimen group header (so analyte.specimen scoping is exercised).
function buildReport(rawResults, groupName) {
  const payload = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [{ groupName: groupName || 'URINE CULTURE', results: rawResults }],
        ungroupedResults: [],
      },
    },
  };
  return normaliseInvestigationReport(payload);
}

// The sterile-pyuria combo: pus cells > 40 AND culture contains "no growth".
function sterilePyuriaCombo(overrides) {
  return Object.assign(
    {
      id: 'rule_pyuria',
      enabled: true,
      builtin: false,
      kind: 'combo',
      label: 'Sterile pyuria — review',
      level: 'amber',
      conditions: [
        {
          analyte: { match: ['pus cells', 'white cells', 'wbc'], specimen: ['urine', 'msu'] },
          comparator: 'above',
          value: 40,
        },
        {
          analyte: { match: ['culture', 'msu'], specimen: ['urine', 'msu'] },
          contains: ['no growth', 'no significant growth'],
        },
      ],
    },
    overrides
  );
}

function evalWith(report, rules, opts) {
  return evaluateReportSeverity(report, Object.assign({ resultRules: rules }, opts || {}));
}

// ── 1. Combo fires: pus > 40 AND culture "no growth" ──────────────────────────
console.log('\n--- combo fires when both conditions met ---');
{
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 1, 'comboCount === 1 (combo fired)');
  assert(res.comboTop && res.comboTop.label === 'Sterile pyuria — review', 'comboTop.label set to the rule label');
  assert(res.comboTop && res.comboTop.level === 'amber', 'comboTop.level === amber');
  assert(res.level === 'amber', 'report level raised to amber by the fired combo');
}

// ── 2. Does NOT fire when only one condition met ──────────────────────────────
console.log('\n--- combo does NOT fire when only one condition met ---');
{
  // pus high but culture grows something (no "no growth" phrase)
  const report = buildReport([pusCells('50'), culture('Escherichia coli >100,000 cfu/mL')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 0, 'comboCount === 0 (only numeric condition met)');
  assert(res.comboTop === null, 'comboTop === null');
  assert(res.level === 'none', 'level stays none (no other escalation)');
}
{
  // culture "no growth" but pus below threshold
  const report = buildReport([pusCells('10'), culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 0, 'comboCount === 0 (only text condition met)');
  assert(res.level === 'none', 'level stays none');
}

// ── 3. Does NOT fire when pus value missing / non-finite (fail-safe) ──────────
console.log('\n--- combo does NOT fire on missing / non-finite numeric value ---');
{
  // pus cells reported as a non-numeric string → result.value NaN
  const report = buildReport([pusCells('Not seen'), culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 0, 'comboCount === 0 (non-finite pus value never satisfies numeric condition)');
  assert(res.level === 'none', 'level stays none (fail-safe — no fire on missing data)');
}
{
  // pus cells row entirely absent
  const report = buildReport([culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 0, 'comboCount === 0 (no pus result at all)');
}

// ── 4. Red-level combo raises level to red ────────────────────────────────────
console.log('\n--- red-level combo raises level to red ---');
{
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo({ level: 'red' })]);
  assert(res.comboCount === 1, 'red combo fired');
  assert(res.comboTop.level === 'red', 'comboTop.level === red');
  assert(res.level === 'red', 'report level raised to red');
  // A red combo must NOT flip misprioritised (that stays tied to a genuine urgent result).
  assert(res.misprioritised === false, 'red combo does NOT set misprioritised (urgentCount is 0)');
  assert(res.urgentCount === 0, 'urgentCount remains 0 — combo is not a lab-urgent result');
}

// ── 5. Specimen scoping works (fail-open) ─────────────────────────────────────
console.log('\n--- specimen scoping ---');
{
  // Group header "BLOOD CULTURE" does not contain "urine"/"msu" → numeric condition
  // is specimen-gated out, so the combo cannot fire.
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')], 'BLOOD CULTURE');
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 0, 'combo does NOT fire when specimen header excludes the scope');
}
{
  // Fail-open: results with NO specimen header still apply (specimen gate passes).
  const payload = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [],
        ungroupedResults: [pusCells('50'), culture('No growth after 48 hours')],
      },
    },
  };
  const report = normaliseInvestigationReport(payload);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 1, 'combo fires on un-grouped results (specimen gate fail-open)');
}

// ── 6. Disabled combo is skipped ──────────────────────────────────────────────
console.log('\n--- disabled combo skipped ---');
{
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo({ enabled: false })]);
  assert(res.comboCount === 0, 'disabled combo does not fire');
  assert(res.level === 'none', 'level stays none for disabled combo');
}

// ── 7. suppressIfProblem suppresses a fired combo ─────────────────────────────
console.log('\n--- suppressIfProblem ---');
{
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')]);
  const rule = sterilePyuriaCombo({ suppressIfProblem: { match: ['interstitial cystitis'] } });
  // Problem present → suppressed
  const suppressed = evalWith(report, [rule], { problems: [{ label: 'Interstitial cystitis' }] });
  assert(suppressed.comboCount === 0, 'combo suppressed when matching problem present');
  assert(suppressed.level === 'none', 'level stays none when combo suppressed');
  // Problem absent → fail-open, fires
  const fired = evalWith(report, [rule], { problems: [] });
  assert(fired.comboCount === 1, 'combo fires (fail-open) when no matching problem present');
}

// ── 8. Combo never lowers an existing higher severity ─────────────────────────
console.log('\n--- combo is escalate-only (never lowers) ---');
{
  // A lab-urgent result already makes the report red; an amber combo must not lower it.
  const urgentRow = Object.assign(pusCells('50'), { requiresUrgentReview: true });
  const report = buildReport([urgentRow, culture('No growth after 48 hours')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.level === 'red', 'amber combo does not lower a lab-red report');
  assert(res.urgentCount === 1, 'urgent result still counted');
  assert(res.comboCount === 1, 'combo still recorded as fired even though it did not change level');
}

// ── 9. Two conditions satisfied by different rows (the core contract) ─────────
console.log('\n--- conditions satisfied by different rows ---');
{
  // pus row satisfies condition 1; culture row satisfies condition 2 — different rows.
  const report = buildReport([pusCells('41'), culture('No significant growth')]);
  const res = evalWith(report, [sterilePyuriaCombo()]);
  assert(res.comboCount === 1, 'combo fires across two different result rows');
}

// ── 10. comboCount/comboTop always present (none object too) ──────────────────
console.log('\n--- return shape ---');
{
  const res = evaluateReportSeverity(null, {});
  assert('comboCount' in res && res.comboCount === 0, 'none object has comboCount 0');
  assert('comboTop' in res && res.comboTop === null, 'none object has comboTop null');
}
{
  // No combo rules at all → fields present and zeroed; other fields intact.
  const report = buildReport([pusCells('50'), culture('No growth after 48 hours')]);
  const res = evaluateReportSeverity(report, { resultRules: [] });
  assert(res.comboCount === 0 && res.comboTop === null, 'no combo rules → comboCount 0, comboTop null');
  assert('reviewCount' in res && 'noGrowthCount' in res, 'existing return fields still present');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('Tests: ' + (passed + failed) + ' total · ' + passed + ' passed · ' + failed + ' failed');
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
