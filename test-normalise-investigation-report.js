// test-normalise-investigation-report.js — unit tests for normaliseInvestigationReport
// Run with: node test-normalise-investigation-report.js
'use strict';

const { normaliseInvestigationReport } = require('./engine/normalisers.js');

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

// Normal WBC: value 4.6, range 4–11
const wbcResult = {
  description: 'WBC',
  resultValue: '4.6',
  resultUnit: '× 10⁹/L',
  resultComparator: null,
  referenceRanges: [{ lowerReferenceLimit: '4', upperReferenceLimit: '11', description: null }],
  isAboveReferenceRange: false,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: null,
  formattedSpecimenCollectionDate: '09 Jan 26, 08:26',
  specimenCollectionDate: '2026-01-09 08:26:00',
  issuedDateTime: null,
  previousResults: [],
};

// Above RDW (urgent): 16.7, range 11–15
const rdwResult = {
  description: 'RDW',
  resultValue: '16.7',
  resultUnit: '%',
  resultComparator: null,
  referenceRanges: [{ lowerReferenceLimit: '11', upperReferenceLimit: '15', description: null }],
  isAboveReferenceRange: true,
  isBelowReferenceRange: false,
  requiresUrgentReview: true,
  interpretation: 'Above reference range',
  formattedSpecimenCollectionDate: '09 Jan 26, 08:26',
  specimenCollectionDate: '2026-01-09 08:26:00',
  issuedDateTime: null,
  previousResults: [],
};

// A result with a previousResult above its parent range (range 4–11; prev value 12.3)
const wbcWithHistory = {
  description: 'WBC',
  resultValue: '4.6',
  resultUnit: '× 10⁹/L',
  resultComparator: null,
  referenceRanges: [{ lowerReferenceLimit: '4', upperReferenceLimit: '11', description: null }],
  isAboveReferenceRange: false,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: null,
  formattedSpecimenCollectionDate: '09 Jan 26, 08:26',
  specimenCollectionDate: '2026-01-09 08:26:00',
  issuedDateTime: null,
  previousResults: [
    {
      result: '12.3',
      specimenCollectionDate: '2026-01-02 10:00:00',
      formattedSpecimenCollectionDate: '02 Jan 26, 10:00',
      id: 'prev-1',
      resultType: null,
      resultStatus: null,
    },
    {
      result: '4.8',
      specimenCollectionDate: '2025-12-15 09:00:00',
      formattedSpecimenCollectionDate: '15 Dec 25, 09:00',
      id: 'prev-2',
      resultType: null,
      resultStatus: null,
    },
  ],
};

// A result with a <-prefixed comparator value
const comparatorResult = {
  description: 'PSA',
  resultValue: '<0.1',
  resultUnit: 'ng/mL',
  resultComparator: '<',
  referenceRanges: [{ lowerReferenceLimit: '0', upperReferenceLimit: '4', description: null }],
  isAboveReferenceRange: false,
  isBelowReferenceRange: false,
  requiresUrgentReview: false,
  interpretation: null,
  formattedSpecimenCollectionDate: null,
  specimenCollectionDate: null,
  issuedDateTime: '2026-03-15T10:00:00Z',
  previousResults: [],
};

function makePayload(groups, ungrouped, isMatchedToPatient, patientId) {
  return {
    data: {
      patient: { id: patientId || 'patient-uuid-123' },
      investigationReport: {
        isMatchedToPatient: isMatchedToPatient !== false,
        investigationGroups: groups || [],
        ungroupedResults: ungrouped || [],
      },
    },
  };
}

// ── Basic shape and patientUuid ───────────────────────────────────────────────
console.log('\n--- Basic shape and patientUuid ---');
{
  const payload = makePayload([{ results: [wbcResult] }], [], true, 'uuid-abc');
  const out = normaliseInvestigationReport(payload);
  assert(out.patientUuid === 'uuid-abc', 'patientUuid extracted from data.patient.id');
  assert(out.unmatched === false, 'matched patient → unmatched false');
  assert(Array.isArray(out.results), 'results is an array');
  assert(out.results.length === 1, 'one result from one group');
}

// ── Unmatched flag passthrough ────────────────────────────────────────────────
console.log('\n--- Unmatched flag ---');
{
  const payload = makePayload([], [], false);
  const out = normaliseInvestigationReport(payload);
  assert(out.unmatched === true, 'isMatchedToPatient false → unmatched true');
}

// ── Normal WBC result shape ───────────────────────────────────────────────────
console.log('\n--- Normal WBC result fields ---');
{
  const out = normaliseInvestigationReport(makePayload([{ results: [wbcResult] }], []));
  const r = out.results[0];
  assert(r.name === 'WBC', 'name is WBC');
  assert(r.value === 4.6, 'value is numeric 4.6');
  assert(r.rawValue === '4.6', 'rawValue preserved as string');
  assert(r.unit === '× 10⁹/L', 'unit correct');
  assert(r.comparator === null, 'comparator null');
  assert(r.low === 4, 'low ref limit parsed to 4');
  assert(r.high === 11, 'high ref limit parsed to 11');
  assert(r.isAbove === false, 'isAbove false');
  assert(r.isBelow === false, 'isBelow false');
  assert(r.urgent === false, 'urgent false');
  assert(r.interpretation === null, 'interpretation null');
  assert(r.date === '2026-01-09', 'date normalised to YYYY-MM-DD');
  assert(Array.isArray(r.history), 'history is array');
  assert(r.history.length === 0, 'history empty when previousResults is []');
}

// ── Urgent / above RDW ────────────────────────────────────────────────────────
console.log('\n--- Urgent above RDW result ---');
{
  const out = normaliseInvestigationReport(makePayload([{ results: [rdwResult] }], []));
  const r = out.results[0];
  assert(r.name === 'RDW', 'name is RDW');
  assert(r.value === 16.7, 'value is 16.7');
  assert(r.isAbove === true, 'isAbove true');
  assert(r.urgent === true, 'urgent true');
  assert(r.interpretation === 'Above reference range', 'interpretation preserved');
  assert(r.low === 11, 'low ref 11');
  assert(r.high === 15, 'high ref 15');
}

// ── ungroupedResults included ─────────────────────────────────────────────────
console.log('\n--- ungroupedResults included ---');
{
  const out = normaliseInvestigationReport(makePayload([{ results: [wbcResult] }], [rdwResult]));
  assert(out.results.length === 2, 'grouped + ungrouped = 2 results total');
  const names = out.results.map((r) => r.name);
  assert(names.includes('WBC'), 'WBC from group present');
  assert(names.includes('RDW'), 'RDW from ungroupedResults present');
}

// ── Empty groups and arrays ───────────────────────────────────────────────────
console.log('\n--- Empty groups and arrays ---');
{
  const out = normaliseInvestigationReport(makePayload([], []));
  assert(out.results.length === 0, 'empty groups → empty results');
}
{
  const out = normaliseInvestigationReport(makePayload([{ results: [] }], []));
  assert(out.results.length === 0, 'group with empty results → empty results');
}
{
  const out = normaliseInvestigationReport(null);
  assert(out.patientUuid === null, 'null payload → safe shape, patientUuid null');
  assert(out.results.length === 0, 'null payload → empty results');
}
{
  const out = normaliseInvestigationReport({});
  assert(out.results.length === 0, 'empty object → empty results');
}

// ── resultComparator present and <-prefixed value parses ─────────────────────
console.log('\n--- resultComparator and <-prefixed value ---');
{
  const out = normaliseInvestigationReport(makePayload([], [comparatorResult]));
  const r = out.results[0];
  assert(r.comparator === '<', 'comparator is <');
  assert(r.rawValue === '<0.1', 'rawValue keeps < prefix');
  assert(r.value === 0.1, 'numeric value strips < → 0.1');
  assert(r.date === '2026-03-15', 'issuedDateTime fallback date parsed');
}

// ── History flag derivation ───────────────────────────────────────────────────
console.log('\n--- History flag derivation ---');
{
  const out = normaliseInvestigationReport(makePayload([{ results: [wbcWithHistory] }], []));
  const r = out.results[0];
  assert(r.history.length === 2, 'two history entries');
  // Newest-first: 2026-01-02 before 2025-12-15
  assert(r.history[0].date === '2026-01-02', 'newest history entry first');
  assert(r.history[0].value === 12.3, 'history value 12.3 parsed');
  assert(r.history[0].flag === 'above', 'prev value 12.3 > high 11 → flag above');
  assert(r.history[1].date === '2025-12-15', 'older history entry second');
  assert(r.history[1].value === 4.8, 'history value 4.8 parsed');
  assert(r.history[1].flag === 'normal', 'prev value 4.8 within 4–11 → flag normal');
}

// ── patientId fallback (data.patientId) ──────────────────────────────────────
console.log('\n--- patientId fallback ---');
{
  const payload = {
    data: {
      patientId: 'fallback-id',
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [],
        ungroupedResults: [],
      },
    },
  };
  const out = normaliseInvestigationReport(payload);
  assert(out.patientUuid === 'fallback-id', 'data.patientId used when data.patient absent');
}

// ── Date format: "DD Mon YY, HH:MM" ──────────────────────────────────────────
console.log('\n--- Date format DD Mon YY HH:MM ---');
{
  const result = {
    ...wbcResult,
    formattedSpecimenCollectionDate: '11 Jun 26, 14:30',
    specimenCollectionDate: null,
  };
  const out = normaliseInvestigationReport(makePayload([{ results: [result] }], []));
  assert(out.results[0].date === '2026-06-11', 'DD Mon YY format → 2026-06-11');
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
