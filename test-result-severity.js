// test-result-severity.js — unit tests for evaluateReportSeverity
// Run with: node test-result-severity.js
'use strict';

const { evaluateReportSeverity } = require('./engine/result-severity.js');

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

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Normal WBC: in-range, not urgent
const wbcNormal = {
  name: 'WBC',
  value: 4.6,
  rawValue: '4.6',
  comparator: null,
  unit: '× 10⁹/L',
  low: 4,
  high: 11,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-01-09',
  history: [],
};

// Above RDW, urgent
const rdwUrgent = {
  name: 'RDW',
  value: 16.7,
  rawValue: '16.7',
  comparator: null,
  unit: '%',
  low: 11,
  high: 15,
  isAbove: true,
  isBelow: false,
  urgent: true,
  interpretation: 'Above reference range',
  date: '2026-01-09',
  history: [],
};

// Above MCV, non-urgent
const mcvAbove = {
  name: 'MCV',
  value: 102,
  rawValue: '102',
  comparator: null,
  unit: 'fL',
  low: 80,
  high: 100,
  isAbove: true,
  isBelow: false,
  urgent: false,
  interpretation: 'Above reference range',
  date: '2026-01-09',
  history: [],
};

// Below sodium, non-urgent
const sodiumBelow = {
  name: 'Sodium',
  value: 129,
  rawValue: '129',
  comparator: null,
  unit: 'mmol/L',
  low: 133,
  high: 146,
  isAbove: false,
  isBelow: true,
  urgent: false,
  interpretation: 'Below reference range',
  date: '2026-01-09',
  history: [],
};

function makeReport(results, unmatched) {
  return {
    patientUuid: 'patient-uuid-123',
    unmatched: !!unmatched,
    results: results || [],
  };
}

// ── Urgent → red ──────────────────────────────────────────────────────────────
console.log('\n--- Urgent result → red ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, rdwUrgent]));
  assert(out.level === 'red', 'urgent result → level red');
  assert(out.urgentCount === 1, 'urgentCount is 1');
  assert(out.abnormalCount === 1, 'abnormalCount includes the above+urgent RDW');
  assert(out.top !== null, 'top is not null');
  assert(out.top.name === 'RDW', 'top is the urgent result');
  assert(out.top.value === 16.7, 'top value correct');
  assert(out.top.unit === '%', 'top unit correct');
  assert(
    out.misprioritised === true,
    'red + no priorityDisplay → misprioritised true (missing priority not high/urgent/immediate)'
  );
}

// ── Above/below → amber ───────────────────────────────────────────────────────
console.log('\n--- Abnormal (non-urgent) → amber ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, mcvAbove]));
  assert(out.level === 'amber', 'above-range non-urgent → level amber');
  assert(out.urgentCount === 0, 'urgentCount 0');
  assert(out.abnormalCount === 1, 'abnormalCount 1 (MCV above)');
  assert(out.top !== null, 'top is the first abnormal result');
  assert(out.top.name === 'MCV', 'top is MCV');
  assert(out.misprioritised === false, 'amber → misprioritised always false');
}
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, sodiumBelow]));
  assert(out.level === 'amber', 'below-range non-urgent → level amber');
  assert(out.top.name === 'Sodium', 'top is Sodium (first abnormal)');
}

// ── All in range → none ───────────────────────────────────────────────────────
console.log('\n--- All in range → none ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal]));
  assert(out.level === 'none', 'all-in-range → level none');
  assert(out.urgentCount === 0, 'urgentCount 0');
  assert(out.abnormalCount === 0, 'abnormalCount 0');
  assert(out.top === null, 'top null when no abnormal/urgent result');
  assert(out.misprioritised === false, 'none → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([]));
  assert(out.level === 'none', 'empty results → level none');
  assert(out.top === null, 'empty results → top null');
}

// ── ungroupedResults included (via normaliser fixture piped through severity) ─
console.log('\n--- ungroupedResults path via report fixture ---');
{
  // Simulate a report built from both grouped + ungrouped by the normaliser:
  // two results in the array (one normal, one urgent); the severity engine
  // doesn't care how they got into report.results, just that both are counted.
  const report = makeReport([wbcNormal, rdwUrgent]);
  const out = evaluateReportSeverity(report);
  assert(out.urgentCount === 1, 'urgent result counted (ungrouped path)');
  assert(out.abnormalCount === 1, 'abnormal result counted (ungrouped path)');
}

// ── misprioritised: red + "Routine" → true ───────────────────────────────────
console.log('\n--- misprioritised: red + Routine ---');
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Routine' });
  assert(out.level === 'red', 'red level');
  assert(out.misprioritised === true, 'red + Routine → misprioritised true');
}

// ── misprioritised: red + "High" → false ─────────────────────────────────────
console.log('\n--- misprioritised: red + High ---');
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'High' });
  assert(out.misprioritised === false, 'red + High → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Urgent' });
  assert(out.misprioritised === false, 'red + Urgent → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Immediate' });
  assert(out.misprioritised === false, 'red + Immediate → misprioritised false');
}
{
  // Case-insensitive check
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'HIGH' });
  assert(out.misprioritised === false, 'red + HIGH (uppercase) → misprioritised false');
}

// ── misprioritised: amber → always false ─────────────────────────────────────
console.log('\n--- misprioritised: amber always false ---');
{
  const out = evaluateReportSeverity(makeReport([mcvAbove]), { priorityDisplay: 'Routine' });
  assert(out.level === 'amber', 'level amber');
  assert(out.misprioritised === false, 'amber + Routine → misprioritised false');
}

// ── unmatched passthrough ─────────────────────────────────────────────────────
console.log('\n--- unmatched passthrough ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal], true));
  assert(out.unmatched === true, 'unmatched true passes through');
}
{
  const out = evaluateReportSeverity(makeReport([wbcNormal], false));
  assert(out.unmatched === false, 'unmatched false passes through');
}

// ── Urgent beats abnormal for top selection ───────────────────────────────────
console.log('\n--- top selection: urgent beats first abnormal ---');
{
  // mcvAbove comes first in array (non-urgent above), rdwUrgent second
  const out = evaluateReportSeverity(makeReport([mcvAbove, rdwUrgent]));
  assert(out.top.name === 'RDW', 'urgent RDW is top even though MCV is first in array');
}

// ── Garbage / null input → safe shape ────────────────────────────────────────
console.log('\n--- Garbage / null input ---');
{
  const out = evaluateReportSeverity(null);
  assert(out.level === 'none', 'null report → level none');
  assert(out.urgentCount === 0, 'null report → urgentCount 0');
  assert(out.abnormalCount === 0, 'null report → abnormalCount 0');
  assert(out.top === null, 'null report → top null');
  assert(out.misprioritised === false, 'null report → misprioritised false');
  assert(out.unmatched === false, 'null report → unmatched false');
}
{
  const out = evaluateReportSeverity({});
  assert(out.level === 'none', 'empty object → level none');
}
{
  const out = evaluateReportSeverity(makeReport([null, undefined, 'garbage']));
  assert(out.level === 'none', 'garbage result entries → skipped, level none');
}

// ── thresholds opt passed but not yet acted on ────────────────────────────────
console.log('\n--- thresholds opt accepted (extension point) ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { thresholds: { Sodium: { red: 125 } } });
  assert(out.level === 'none', 'thresholds passed but not acted on → none for in-range result');
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
