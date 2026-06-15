// Medicus Suite — End-to-end pipeline integration test
// Run with: node test-pipeline-e2e.js
//
// WHY THIS TEST EXISTS
// Unit tests for the normaliser and the rules engine each run against hand-built
// fixtures. This test closes the seam between them: it feeds RAW Medicus-API-shaped
// input (the shape the content script actually receives) into normalisers.js, then
// feeds the normaliser OUTPUT (not a hand-built equivalent) into evaluatePatient,
// then renders the resulting chip through renderDrugChip. A field rename at the
// normaliser→engine boundary — e.g. "name" becomes "drugName" — would pass every
// unit test but silently drop a real monitoring alert. These assertions pin that
// contract so the breakage appears here instead of in a missed chip in production.
//
// DRUG CHOSEN: methotrexate (rule id: "methotrexate-maintenance")
// Rationale: the most extensively regression-guarded drug in the suite
// (test-drug-brand-coverage.js, test-alert-builder.js). Its three required tests
// (FBC / U&E / LFT) and 84-day interval are stable and well-documented in the BNF
// shared-care guideline. Any rename of these tests in the rule would be caught by
// the brand-coverage test, making them a reliable stable anchor here too.

'use strict';

const path = require('path');
const normalisers = require(path.join(__dirname, 'engine', 'normalisers.js'));
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const chipRenderer = require(path.join(__dirname, 'shared', 'chip-renderer.js'));
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// Compute ISO dates relative to now so the test never rots on a fixed date.
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Build a data-key name in the "dataYYYYMMDD" format that normaliseObservations
// expects from the Medicus investigation-dashboard API response.
function dataKey(isoDate) {
  return 'data' + isoDate.replace(/-/g, '');
}

// ── RAW API INPUT SHAPES ──────────────────────────────────────────────────────
//
// These mirror what the Medicus API actually returns (the shape the content
// script receives before any normalisation). Deliberately omit fields that are
// not needed for the assertions so the test remains focused.

// Medication regimen: patient on Methotrexate 10mg tablets (a repeat prescription).
// normaliseMedications() reads: description (→ med.name), source bucket, medicationIssueHistory.
const RAW_REGIMEN_MTX = {
  currentRepeatPrescribingMedications: [
    {
      description: 'Methotrexate 10mg tablets',
      dosageInstructions: 'Once weekly',
      quantityAndUnit: '4 tablet',
      status: 'active',
      id: 'med-001',
      medicationIssueHistory: {
        data: [
          { issueDate: daysAgoIso(365) },
          { issueDate: daysAgoIso(280) },
          { issueDate: daysAgoIso(196) },
          { issueDate: daysAgoIso(112) },
        ],
      },
    },
  ],
};

// Medication regimen for NEGATIVE control: patient on amlodipine only (no DMARDs).
const RAW_REGIMEN_AMLODIPINE = {
  currentRepeatPrescribingMedications: [
    {
      description: 'Amlodipine 5mg tablets',
      dosageInstructions: '1 daily',
      status: 'active',
      id: 'med-002',
    },
  ],
};

// Investigation dashboard: blood tests are OVERDUE (last done ~120 days ago,
// interval is 84 days). normaliseObservations() reads dataYYYYMMDD keys,
// investigationType (→ obs.name), investigationGroup (→ obs.group).
const OVERDUE_DATE = daysAgoIso(120); // 120d ago, interval is 84d → overdue
const RAW_DASHBOARD_OVERDUE = {
  rowData: [
    {
      investigationType: 'Full blood count',
      investigationGroup: 'FBC',
      unit: null,
      [dataKey(OVERDUE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
    {
      investigationType: 'U&Es (Urea and electrolytes)',
      investigationGroup: 'U&Es',
      unit: null,
      [dataKey(OVERDUE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
    {
      investigationType: 'Liver function tests',
      investigationGroup: 'LFTs',
      unit: null,
      [dataKey(OVERDUE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
  ],
};

// Investigation dashboard: blood tests are IN DATE (last done ~20 days ago).
const INDATE_DATE = daysAgoIso(20);
const RAW_DASHBOARD_INDATE = {
  rowData: [
    {
      investigationType: 'Full blood count',
      investigationGroup: 'FBC',
      unit: null,
      [dataKey(INDATE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
    {
      investigationType: 'U&Es (Urea and electrolytes)',
      investigationGroup: 'U&Es',
      unit: null,
      [dataKey(INDATE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
    {
      investigationType: 'Liver function tests',
      investigationGroup: 'LFTs',
      unit: null,
      [dataKey(INDATE_DATE)]: { result: 'Normal', isAboveReferenceRange: false, isBelowReferenceRange: false },
    },
  ],
};

// ── PHASE 1: NORMALISATION ────────────────────────────────────────────────────
//
// Run the REAL normalisers against the raw API shapes.  The test must NOT
// hand-build these objects — that is the whole point of the integration seam.

console.log('\n--- Phase 1: normalisers produce correct contract fields ---');

const normMeds = normalisers.normaliseMedications(RAW_REGIMEN_MTX);
const normObs = normalisers.normaliseObservations(RAW_DASHBOARD_OVERDUE);

// CONTRACT FIELD: medications must carry a "name" field (not "drugName", not
// "description"). The rules engine's drugMatchesRule() reads med.name.
// If the normaliser renames this field the rules engine silently drops the drug.
check(Array.isArray(normMeds) && normMeds.length > 0, 'normaliseMedications returns a non-empty array');

const mtxMed = normMeds[0];
check(
  typeof mtxMed.name === 'string' && mtxMed.name.length > 0,
  'normalised medication has a non-empty "name" field (CONTRACT: rules engine reads med.name)'
);
check(
  mtxMed.name.toLowerCase().includes('methotrexate'),
  `normalised med.name contains "methotrexate" (got "${mtxMed.name}")`
);

// CONTRACT FIELD: observations must carry a "name" field and a "date" field
// (ISO string). findLatestObservation() in the rules engine reads obs.name and
// obs.date. If either field is renamed or obs.date is not an ISO string the
// daysBetween() call returns null and the chip silently becomes "no_data" even
// when data exists.
const fbcObs = normObs.find((o) => o.name && o.name.toLowerCase().includes('full blood count'));
check(fbcObs != null, 'normaliseObservations returns an entry for "Full blood count"');
check(
  typeof (fbcObs && fbcObs.name) === 'string',
  'normalised observation has a "name" field (CONTRACT: rules engine reads obs.name)'
);
check(
  typeof (fbcObs && fbcObs.date) === 'string' && /^\d{4}-\d{2}-\d{2}/.test((fbcObs || {}).date || ''),
  'normalised observation has a "date" field in ISO format (CONTRACT: rules engine reads obs.date for daysBetween())'
);
check(
  (fbcObs || {}).date === OVERDUE_DATE,
  `obs.date matches the source data-key date (got "${(fbcObs || {}).date}", expected "${OVERDUE_DATE}")`
);

// The normaliser also emits group-aggregate observations (e.g. "FBC", "U&Es").
// These are what drug-monitoring rules with match terms like "u&e" actually hit
// when the row-level investigationType doesn't contain that substring directly.
const groupAggs = normObs.filter((o) => o.source === 'API:investigation-dashboard (group aggregate)');
check(
  groupAggs.length > 0,
  'normaliseObservations emits group-aggregate observations (needed for U&E / LFT panel matching)'
);

// ── PHASE 2: RULES ENGINE (POSITIVE — overdue) ───────────────────────────────
//
// Feed the normaliser output into the real evaluatePatient with the real bundled
// rules. MUST NOT feed hand-built medications/observations here.

console.log('\n--- Phase 2a: evaluatePatient fires overdue chip for MTX + overdue bloods ---');

const normObsOverdue = normalisers.normaliseObservations(RAW_DASHBOARD_OVERDUE);
const normObsHistOverdue = normalisers.normaliseObservationHistory(RAW_DASHBOARD_OVERDUE);

const chips = engine.evaluatePatient(normMeds, normObsOverdue, drugRules.rules, {
  now: new Date().toISOString(),
  problems: [],
  patientContext: { ageYears: 62, sex: 'female' },
  observationHistory: normObsHistOverdue,
});

const mtxChip = chips.find((c) => c.ruleId === 'methotrexate-maintenance');

check(mtxChip != null, 'evaluatePatient fires a chip with ruleId "methotrexate-maintenance"');
check(mtxChip && mtxChip.type === 'drug-monitoring', 'chip type is "drug-monitoring"');
check(
  mtxChip && (mtxChip.status === 'overdue' || mtxChip.status === 'stale'),
  `chip status is overdue/stale when bloods are ${120}d old vs 84d interval (got "${(mtxChip || {}).status}")`
);

// Confirm the drug name threaded through from the normaliser output (not hard-coded).
check(
  mtxChip && typeof mtxChip.drugName === 'string' && mtxChip.drugName.toLowerCase().includes('methotrexate'),
  `chip.drugName is "${(mtxChip || {}).drugName}" (derived from normaliser, not hard-coded)`
);

// The chip must contain test evaluations — so the seam from the observation
// normaliser through to the engine's findLatestObservation is confirmed live.
check(
  Array.isArray(mtxChip && mtxChip.tests) && mtxChip.tests.length > 0,
  'chip.tests is non-empty (engine resolved observations from normaliser output)'
);

// chip.tests entries are spread from rule.tests, so they carry a "name" field
// (the human-readable test name, e.g. "FBC"), not "testName".
const fbcTest = mtxChip && mtxChip.tests ? mtxChip.tests.find((t) => t.name === 'FBC') : null;
check(fbcTest != null, 'chip.tests contains an "FBC" entry (t.name field threaded through from rule definition)');
check(
  fbcTest && (fbcTest.status === 'overdue' || fbcTest.status === 'stale'),
  `FBC test status is overdue/stale (got "${(fbcTest || {}).status}")`
);
check(fbcTest && fbcTest.latestObs != null, 'FBC test has a latestObs (observation was matched, not no_data)');
check(
  fbcTest && fbcTest.latestObs && fbcTest.latestObs.date === OVERDUE_DATE,
  `FBC latestObs.date is the normalised date "${OVERDUE_DATE}" (full round-trip data provenance)`
);

// ── PHASE 2b: RULES ENGINE (POSITIVE — in date) ──────────────────────────────
//
// Same drug, same rules, but with in-date bloods. Verifies the pipeline can also
// stay silent correctly — a symmetry check that the seam is directionally correct.

console.log('\n--- Phase 2b: evaluatePatient returns in_date chip for MTX + recent bloods ---');

const normObsIndate = normalisers.normaliseObservations(RAW_DASHBOARD_INDATE);
const normObsHistIndate = normalisers.normaliseObservationHistory(RAW_DASHBOARD_INDATE);

const chipsIndate = engine.evaluatePatient(normMeds, normObsIndate, drugRules.rules, {
  now: new Date().toISOString(),
  problems: [],
  patientContext: { ageYears: 62, sex: 'female' },
  observationHistory: normObsHistIndate,
});

const mtxChipIndate = chipsIndate.find((c) => c.ruleId === 'methotrexate-maintenance');
check(
  mtxChipIndate != null,
  'chip fires for MTX even when bloods are in date (rule always emits a chip for on-drug patients)'
);
check(
  mtxChipIndate && mtxChipIndate.status === 'in_date',
  `status is "in_date" when all three tests were done ${20}d ago (got "${(mtxChipIndate || {}).status}")`
);

// ── PHASE 3: NEGATIVE CONTROL ─────────────────────────────────────────────────
//
// Patient on amlodipine only (no DMARD). No methotrexate chip must fire.
// Also verifies the normalised medication shape is the real discriminator — if
// it were broken (e.g. empty name), the engine would silently produce no chip
// for ANY drug, and this test would still pass. The Phase 1 name assertions
// above are what guard that case.

console.log('\n--- Phase 3: negative control — no MTX chip when patient is not on the drug ---');

const normMedsAml = normalisers.normaliseMedications(RAW_REGIMEN_AMLODIPINE);
check(
  normMedsAml.length > 0 && normMedsAml[0].name.toLowerCase().includes('amlodipine'),
  'amlodipine medication normalises correctly (negative control set up)'
);

const chipsNeg = engine.evaluatePatient(normMedsAml, normObsOverdue, drugRules.rules, {
  now: new Date().toISOString(),
  problems: [],
  patientContext: { ageYears: 62, sex: 'female' },
  observationHistory: normObsHistOverdue,
});

const mtxChipNeg = chipsNeg.find((c) => c.ruleId === 'methotrexate-maintenance');
check(mtxChipNeg == null, 'no "methotrexate-maintenance" chip fires for a patient on amlodipine only');

// ── PHASE 4: CHIP RENDERER ────────────────────────────────────────────────────
//
// Pass the overdue chip (produced by the real pipeline) through renderDrugChip
// and assert the HTML contains the drug name and expected status label.

console.log('\n--- Phase 4: renderDrugChip produces expected HTML from pipeline output ---');

check(mtxChip != null, 'chip from Phase 2a is available for rendering');

if (mtxChip) {
  const html = chipRenderer.renderDrugChip(mtxChip);
  check(typeof html === 'string' && html.length > 0, 'renderDrugChip returns a non-empty HTML string');
  check(html.toLowerCase().includes('methotrexate'), 'rendered HTML contains the drug name "methotrexate"');
  // The status badge must read "OVERDUE" or "SEVERELY OVERDUE" for an overdue chip.
  const hasOverdueLabel = html.includes('OVERDUE') || html.includes('SEVERELY OVERDUE');
  check(hasOverdueLabel, 'rendered HTML contains the overdue status label ("OVERDUE" or "SEVERELY OVERDUE")');
  // The chip must reference "FBC" — the test name threaded all the way through.
  check(html.includes('FBC'), 'rendered HTML contains "FBC" (test name threaded end-to-end to renderer)');
  // Colour class: overdue/stale → sent-chip-red
  check(html.includes('sent-chip-red'), 'rendered HTML carries the red colour class for an overdue chip');
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
