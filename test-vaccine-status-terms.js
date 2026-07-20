// Medicus Suite — Vaccine status-term false-GIVEN regression tests (audit C2)
// Run with: node test-vaccine-status-terms.js
//
// Guards the 2026-07-18 audit's Critical C2: negative phrasings ("refused",
// "contraindicated", "not given") substring-contain the given stems, so an
// incomplete `declined` list classifies an UNVACCINATED patient as GIVEN — a
// false all-clear. Also guards the undated-record gate: a dateless "given"
// code must not satisfy a SEASONAL window (it used to satisfy every season
// forever); one-off (schedule:"once") vaccines still accept undated records,
// since their window is all-time anyway.

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

// In-campaign date for the seasonal rules; fine for one-off rules too.
const NOW = '2025-11-10';

// An eligible-for-everything patient: 78yo (flu 65+, covid 75+, PPV23 65+,
// shingles 70-79, RSV 75-79 band).
function dataWithProblem(label, codedDate) {
  return {
    patientContext: { ageYears: 78, dob: '1947-05-01' },
    problems: [{ label, codedDate }],
    observations: [],
    medications: [],
    observationHistory: [],
    _registerLookup: {},
  };
}

function statusOf(rule, data) {
  const chips = engine.evaluateVaccineRule(rule, data, NOW);
  return chips.length ? chips[0].status : null;
}

// Build a negative phrasing from each rule's FIRST given term (the stem the
// negative phrase will contain, e.g. "seasonal influenza vaccination" →
// "seasonal influenza vaccination refused").
const NEGATIVE_SUFFIXES = ['declined', 'refused', 'contraindicated', 'not given'];

console.log('\n--- negative phrasings must never classify as GIVEN ---');
for (const rule of vaxRules.rules) {
  // Strip a trailing " given" (e.g. "influenza vaccination given") so the
  // constructed phrase matches real coded wording ("… vaccination refused").
  const stem = rule.statusTerms.given[0].replace(/ given$/, '');
  for (const suffix of NEGATIVE_SUFFIXES) {
    const label = `${stem} ${suffix}`;
    const status = statusOf(rule, dataWithProblem(label, NOW));
    assert(status !== 'vax_given', `${rule.id}: "${label}" → ${status} (must not be vax_given)`);
  }
}

console.log('\n--- undated records vs the season window ---');
for (const rule of vaxRules.rules) {
  const stem = rule.statusTerms.given[0];
  const status = statusOf(rule, dataWithProblem(stem, ''));
  if (rule.schedule === 'once') {
    // One-off window is all-time: an undated historic "given" still counts
    // (treating it as not-given would spam false DUE recalls).
    assert(status === 'vax_given', `${rule.id} (once): undated given still counts → ${status}`);
  } else {
    // Seasonal: an undated code cannot prove THIS season's jab — fail closed
    // to DUE, never to a green "given".
    assert(status !== 'vax_given', `${rule.id} (seasonal): undated given must NOT satisfy the season → ${status}`);
  }
}

console.log('\n--- sanity: real given/declined records still classify correctly ---');
{
  const flu = vaxRules.rules.find((r) => r.id === 'vax-flu');
  assert(
    statusOf(flu, dataWithProblem('Seasonal influenza vaccination', NOW)) === 'vax_given',
    'dated in-season given → vax_given'
  );
  assert(
    statusOf(flu, dataWithProblem('Influenza vaccination declined', NOW)) === 'vax_declined',
    'dated in-season declined → vax_declined'
  );
  assert(
    statusOf(flu, dataWithProblem('Seasonal influenza vaccination', '2024-10-01')) === 'vax_due',
    "LAST season's given → vax_due this season"
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
