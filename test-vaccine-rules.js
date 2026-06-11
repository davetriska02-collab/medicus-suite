// Medicus Suite — Vaccine rules expansion tests
// Run with: node test-vaccine-rules.js
//
// Tests: schedule:"once" engine support; declined-before-given bug fix;
// bornOnOrAfter eligibility gate; new PPV23, shingles, RSV rules.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const vaxRules = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));

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

const NOW = '2026-06-10'; // June — mid-summer, outside any seasonal campaign

// Helpers
function patient(age, dob) {
  return { patientContext: { ageYears: age, dob: dob || null } };
}
function withProblems(base, problems) {
  return { ...base, problems, observations: [], medications: [], observationHistory: [], _registerLookup: {} };
}
function withObservations(base, observations) {
  return { ...base, observations, problems: [], medications: [], observationHistory: [], _registerLookup: {} };
}
function baseData(age, dob) {
  return {
    patientContext: { ageYears: age, dob: dob || null },
    problems: [],
    observations: [],
    medications: [],
    observationHistory: [],
    _registerLookup: {},
  };
}

// Fetch rules from file.
const fluRule = vaxRules.rules.find((r) => r.id === 'vax-flu');
const ppv23Rule = vaxRules.rules.find((r) => r.id === 'vax-pneumo-ppv23');
const shinglesRule = vaxRules.rules.find((r) => r.id === 'vax-shingles');
const rsvRule = vaxRules.rules.find((r) => r.id === 'vax-rsv');

// ── Rule presence checks ───────────────────────────────────────────────────────
console.log('\n--- rule presence ---');
assert(!!ppv23Rule, 'vax-pneumo-ppv23 rule found');
assert(!!shinglesRule, 'vax-shingles rule found');
assert(!!rsvRule, 'vax-rsv rule found');
assert(ppv23Rule?.enabled === true, 'vax-pneumo-ppv23 enabled');
assert(shinglesRule?.enabled === true, 'vax-shingles enabled');
assert(rsvRule?.enabled === true, 'vax-rsv enabled');

// ── schedule:"once" engine behaviour ─────────────────────────────────────────
console.log('\n--- schedule:once engine behaviour ---');

// Given event 3 years ago → vax_given (not re-flagged DUE)
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumococcal vaccination given', codedDate: '2023-01-15', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip produced when given 3 years ago');
  assert(chips[0].status === 'vax_given', 'PPV23: given 3 years ago → vax_given (not re-flagged)');
}

// No event ever → vax_due
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), NOW);
  assert(chips.length === 1, 'PPV23: chip when no event ever (age 70)');
  assert(chips[0].status === 'vax_due', 'PPV23: no event ever → vax_due');
}

// Declined ever → vax_declined
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumococcal vaccination declined', codedDate: '2024-03-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip when declined');
  assert(chips[0].status === 'vax_declined', 'PPV23: declined → vax_declined');
}

// PCV20 (Prevenar 20) recorded → vax_given (programme transitioned from PPV23 in 2026)
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Prevenar 20 given', codedDate: '2026-02-10', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23/PCV20: chip when PCV20 given');
  assert(chips[0].status === 'vax_given', 'PPV23/PCV20: "Prevenar 20 given" → vax_given');
}

// seasonLabel should be 'one-off' for schedule:once
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), NOW);
  assert(chips[0]?.seasonLabel === 'one-off', `PPV23: seasonLabel === 'one-off' (got: ${chips[0]?.seasonLabel})`);
}

// Fires in June (no out-of-campaign suppression for one-off rules)
{
  const juneNow = '2026-06-15';
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(70), juneNow);
  assert(chips.length === 1, 'PPV23: fires in June (no campaign suppression for once)');
}

// ── Declined-before-given regression (clinical safety fix) ───────────────────
console.log('\n--- declined-before-given regression ---');
{
  // "Influenza vaccination declined" contains "flu vaccin" — must be declined, not given.
  const data = {
    ...baseData(70),
    problems: [{ label: 'Influenza vaccination declined', codedDate: '2025-10-01', status: 'active' }],
  };
  // Use a custom rule that exactly replicates flu's stem term risk.
  const testFluRule = {
    id: 'test-flu-declined',
    type: 'vaccine',
    enabled: true,
    vaccine: 'flu',
    displayName: 'Flu vaccine',
    season: { startMonth: 9, startDay: 1, endMonth: 3, endDay: 31 },
    source: 'test',
    eligibility: { anyOf: [{ kind: 'age', ageMin: 65, label: 'Age 65+' }] },
    statusTerms: {
      given: ['influenza vaccination given', 'influenza vaccine given', 'flu vaccin', 'seasonal influenza vaccin'],
      declined: ['influenza vaccination declined', 'flu vaccine declined', 'influenza immunisation declined'],
    },
  };
  // Oct (in campaign)
  const chips = engine.evaluateVaccineRule(testFluRule, data, '2025-10-15');
  assert(chips.length === 1, 'flu declined: chip produced in campaign');
  assert(
    chips[0].status === 'vax_declined',
    `flu declined: "Influenza vaccination declined" → vax_declined, not vax_given (got: ${chips[0]?.status})`
  );
}

// Real flu rule with "Flu vaccine declined" coded label.
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Flu vaccine declined', codedDate: '2025-10-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(fluRule, data, '2025-10-15');
  assert(chips.length === 1, 'real flu rule: chip in Oct');
  assert(
    chips[0].status === 'vax_declined',
    `real flu rule: "Flu vaccine declined" → vax_declined (got: ${chips[0]?.status})`
  );
}

// ── PPV23 eligibility ─────────────────────────────────────────────────────────
console.log('\n--- PPV23 eligibility ---');

// Age 64 → no chip
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(64), NOW);
  assert(chips.length === 0, 'PPV23: age 64 → no chip');
}

// Age 65 → chip
{
  const chips = engine.evaluateVaccineRule(ppv23Rule, baseData(65), NOW);
  assert(chips.length === 1, 'PPV23: age 65 → chip');
}

// "Pneumovax 23" coded → given
{
  const data = {
    ...baseData(70),
    problems: [{ label: 'Pneumovax 23 given', codedDate: '2021-05-01', status: 'active' }],
  };
  const chips = engine.evaluateVaccineRule(ppv23Rule, data, NOW);
  assert(chips.length === 1, 'PPV23: chip with Pneumovax 23 coded');
  assert(chips[0].status === 'vax_given', 'PPV23: "Pneumovax 23 given" → vax_given');
}

// ── Shingles eligibility ──────────────────────────────────────────────────────
console.log('\n--- Shingles eligibility ---');

// Age 72 → eligible (70-79 cohort)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(72, '1953-06-01'), NOW);
  assert(chips.length === 1, 'Shingles: age 72 → eligible via 70-79 cohort');
}

// Age 69, dob 1957-01-01 (born before 1958-09-01 cutoff) → no chip
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(69, '1957-01-01'), NOW);
  assert(chips.length === 0, 'Shingles: age 69 dob 1957-01-01 → no chip (before phased cohort cutoff)');
}

// Age 66, dob 1959-06-01 (born after 1958-09-01) → eligible via phased cohort
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(66, '1959-06-01'), NOW);
  assert(chips.length === 1, 'Shingles: age 66 dob 1959-06-01 → eligible via phased cohort');
  assert(
    chips[0].eligibilityReason && chips[0].eligibilityReason.includes('phased'),
    `Shingles: eligibility label mentions 'phased' (got: ${chips[0]?.eligibilityReason})`
  );
}

// Age 66, dob missing → no chip (fail-closed bornOnOrAfter clause), but 70-79 clause doesn't apply either
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(66, null), NOW);
  assert(chips.length === 0, 'Shingles: age 66 dob missing → no chip (fail-closed)');
}

// Age 72, dob missing → still eligible via 70-79 clause (no bornOnOrAfter gate on that clause)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(72, null), NOW);
  assert(chips.length === 1, 'Shingles: age 72 dob missing → still eligible via 70-79 clause');
}

// Age 80 → no chip (outside 70-79 range and not in 65-69 range)
{
  const chips = engine.evaluateVaccineRule(shinglesRule, baseData(80, '1946-01-01'), NOW);
  assert(chips.length === 0, 'Shingles: age 80 → no chip');
}

// ── RSV eligibility ───────────────────────────────────────────────────────────
console.log('\n--- RSV eligibility ---');

// Age 74 → no chip
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(74), NOW);
  assert(chips.length === 0, 'RSV: age 74 → no chip');
}

// Age 75 → chip
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(75), NOW);
  assert(chips.length === 1, 'RSV: age 75 → chip');
  assert(chips[0].status === 'vax_due', 'RSV: age 75 no event → vax_due');
}

// Age 79 → chip (within 75+)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(79), NOW);
  assert(chips.length === 1, 'RSV: age 79 → chip');
}

// Age 80 → chip (1 April 2026 expansion removed the upper bound)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(80), NOW);
  assert(chips.length === 1, 'RSV: age 80 → chip (post-April-2026 expansion)');
  assert(chips[0].status === 'vax_due', 'RSV: age 80 no event → vax_due');
}

// Age 92 → chip (no upper age limit)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(92), NOW);
  assert(chips.length === 1, 'RSV: age 92 → chip (no upper bound)');
}

// Care-home resident aged 70 → chip (any age, post-April-2026 expansion)
{
  const data = withProblems(baseData(70), [
    { label: 'Care home resident', codedDate: '2025-02-01', status: 'active' },
  ]);
  const chips = engine.evaluateVaccineRule(rsvRule, data, NOW);
  assert(chips.length === 1, 'RSV: care-home resident age 70 → chip');
}

// Age 70, not in a care home → no chip (still below the 75 age floor)
{
  const chips = engine.evaluateVaccineRule(rsvRule, baseData(70), NOW);
  assert(chips.length === 0, 'RSV: age 70 non-care-home → no chip');
}

// ── Schema: source and notes required on new rules ───────────────────────────
console.log('\n--- new vaccine rules have non-empty source and notes ---');
[ppv23Rule, shinglesRule, rsvRule].forEach((r) => {
  if (!r) return;
  assert(typeof r.source === 'string' && r.source.trim().length > 0, `${r.id}: has non-empty source`);
  assert(typeof r.notes === 'string' && r.notes.trim().length > 0, `${r.id}: has non-empty notes`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
