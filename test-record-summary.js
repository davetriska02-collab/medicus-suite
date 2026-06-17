// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// test-record-summary.js — unit tests for buildRecordSummaryText()
//
// Runs under `node --test` (Node.js built-in test runner).
// Does NOT require a browser: buildRecordSummaryText is a pure function and
// window.ACBScores / window.StoppStart are deliberately absent in this env,
// so those score blocks are simply omitted — that is the correct behaviour.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Module import shim ────────────────────────────────────────────────────────
// record.js is an ES module with a bare import at the top.  We use a dynamic
// import() so this CommonJS harness can pull the named export.  We also need
// to stub the chrome global that the module's top-level closes over (the import
// itself never calls chrome, but the module registers listeners at definition
// time when init() is called — we never call init() here, so the stub just
// needs to exist to avoid a ReferenceError at parse time).
globalThis.chrome = {
  runtime: { onMessage: { addListener() {}, removeListener() {} } },
  tabs: { onActivated: null, onUpdated: null },
};

// The import path must be file:// for Node ESM.
const MODULE_URL = new URL('./side-panel/modules/record/record.js', `file://${process.cwd()}/`).href;

// ── Fixture ───────────────────────────────────────────────────────────────────

const FIXTURE_STAMP = '09:41';

const FIXTURE_MODEL = {
  patientContext: {
    patientName: 'Joan Smith',
    ageYears: 78,
    sex: 'Female',
    dob: '1948-03-12',
    nhsNumber: '9000000009',
    namedGP: 'Dr A. Patel',
    isDeceased: false,
    testPatient: false,
  },
  medications: [
    { name: 'Methotrexate 10mg tablets', dosage: '10mg once weekly', isOverDue: false, isReviewOverDue: true },
    { name: 'Folic acid 5mg tablets', dosage: '5mg once weekly', isOverDue: true, isReviewOverDue: false },
    { name: 'Ramipril 5mg capsules', dosage: '5mg once daily', isOverDue: false, isReviewOverDue: false },
  ],
  problems: [
    { label: 'Rheumatoid arthritis', codedDate: '2012-06-01', significance: 'Major' },
    { label: 'Hypertension', codedDate: '2019-01-15', significance: '' },
  ],
  pastProblems: [{ label: 'Appendicitis', codedDate: '1995-04-20' }],
  observations: [
    { name: 'eGFR', rawValue: '58', value: '58 mL/min/1.73m²', date: '2026-05-10', isAbove: false, isBelow: false },
    { name: 'Haemoglobin', rawValue: '102', value: '102 g/L', date: '2026-05-10', isAbove: false, isBelow: true },
    { name: 'ALT', rawValue: '32', value: '32 U/L', date: '2026-05-10', isAbove: false, isBelow: false },
  ],
  apiErrors: {},
};

const FIXTURE_CHIPS = [
  { type: 'drug-monitoring', label: 'MTX bloods overdue', severity: 'overdue' },
  { type: 'qof-register', label: 'RA register', severity: 'ok' },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildRecordSummaryText', async () => {
  // Load the ES module once.
  let buildRecordSummaryText;
  try {
    const mod = await import(MODULE_URL);
    buildRecordSummaryText = mod.buildRecordSummaryText;
  } catch (e) {
    // If the import itself fails (e.g. syntax error), surface it loudly.
    it('module imports without error', () => {
      assert.fail(`Failed to import record.js: ${e.message}\n${e.stack}`);
    });
    return;
  }

  it('module exports buildRecordSummaryText', () => {
    assert.equal(typeof buildRecordSummaryText, 'function');
  });

  it('output contains the "as at" stamp', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes(`as at ${FIXTURE_STAMP}`), `Expected "as at ${FIXTURE_STAMP}" in:\n${text}`);
  });

  it('output starts with the header line (stamp on first line)', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    const firstLine = text.split('\n')[0];
    assert.ok(firstLine.includes(FIXTURE_STAMP), `First line should contain stamp, got: "${firstLine}"`);
  });

  it('output ends with the verbatim caveat', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    const caveat = 'Live snapshot, not a complete record. Verify against the patient record before acting.';
    assert.ok(
      text.trimEnd().endsWith(caveat),
      `Expected text to end with caveat.\nGot last 120 chars:\n${text.slice(-120)}`
    );
  });

  it('output contains patient name', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Joan Smith'), 'Expected patient name in output');
  });

  it('output contains a medication with its dose', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Methotrexate 10mg tablets'), 'Expected med name in output');
    assert.ok(text.includes('10mg once weekly'), 'Expected med dose in output');
  });

  it('output flags overdue medication', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('[OVERDUE]'), 'Expected [OVERDUE] flag for folic acid');
  });

  it('output flags review-due medication', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('[REVIEW DUE]'), 'Expected [REVIEW DUE] flag for methotrexate');
  });

  it('output contains active problem', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Rheumatoid arthritis'), 'Expected active problem in output');
    assert.ok(text.includes('Hypertension'), 'Expected second active problem in output');
  });

  it('output contains the gap-marker line for allergies', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Allergies & adverse reactions — not shown'), 'Expected allergy gap marker in output');
  });

  it('output contains the gap-marker line for immunisations', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Immunisations — not shown'), 'Expected immunisations gap marker in output');
  });

  it('output contains the gap-marker line for consultation history', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Consultation history — not shown'), 'Expected consultation history gap marker');
  });

  it('output contains a recent result with flag', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('Haemoglobin'), 'Expected result name in output');
    assert.ok(text.includes('[LOW]'), 'Expected [LOW] flag for below-range result');
  });

  it('output contains past problem count note', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('1 past/inactive problem'), 'Expected past problem count line');
  });

  it('output includes live chip summary when chips provided', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(text.includes('Live monitoring & QOF'), 'Expected live monitoring line when chips provided');
    assert.ok(
      text.includes('need attention') || text.includes('all up to date'),
      'Expected monitoring status in output'
    );
  });

  it('output does NOT contain an "impression" section (no fabrication)', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(!/\bimpression\b/i.test(text), `Output must not contain an "impression" section — found in:\n${text}`);
  });

  it('output does NOT contain a "plan" section (no fabrication)', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(!/^PLAN\b/im.test(text), `Output must not contain a "PLAN" section — found in:\n${text}`);
  });

  it('output does NOT contain a "summary" or "assessment" section header (no fabrication)', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(
      !/^(ASSESSMENT|CLINICAL SUMMARY)\b/im.test(text),
      `Output must not contain fabricated section headers — found in:\n${text}`
    );
  });

  it('produces stable output — same input same string (deterministic)', () => {
    const a = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    const b = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.equal(a, b, 'buildRecordSummaryText must be deterministic for identical inputs');
  });

  it('handles empty model gracefully (no throw)', () => {
    assert.doesNotThrow(() => buildRecordSummaryText({}, null, '00:00'));
  });

  it('empty-model output still carries the caveat', () => {
    const text = buildRecordSummaryText({}, null, '00:00');
    const caveat = 'Live snapshot, not a complete record. Verify against the patient record before acting.';
    assert.ok(text.includes(caveat), 'Caveat must be present even for empty model');
  });

  it('empty-model output still carries the "as at" stamp', () => {
    const text = buildRecordSummaryText({}, null, '00:00');
    assert.ok(text.includes('as at 00:00'), 'Stamp must be present even for empty model');
  });

  it('output does not contain HTML tags (plain-text only)', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(!/<[a-z]/i.test(text), `Output must not contain HTML tags; found in:\n${text.slice(0, 300)}`);
  });

  it('output does not contain HTML entities like &amp; or &lt;', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_STAMP);
    assert.ok(!/&amp;|&lt;|&gt;|&quot;|&#39;/.test(text), 'Output must not contain HTML entities');
  });

  it('NHS number is formatted with spaces', () => {
    const text = buildRecordSummaryText(FIXTURE_MODEL, null, FIXTURE_STAMP);
    assert.ok(text.includes('NHS 900 000 000'), 'Expected formatted NHS number with spaces');
  });
});
