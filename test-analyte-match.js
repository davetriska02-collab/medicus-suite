// test-analyte-match.js — direct unit tests for the shared analyte match/exclude/
// specimen gate in engine/result-severity.js (analyteMatches, collapseWs, specimenAllows).
//
// Until v-next this logic was triplicated (computeTextOutcome, computeRuleSev,
// computeComboOutcome's inner analyteMatches) — see plan item TRIAGE-LENS-2026-07-02
// #0.5. This file pins the unified helper directly, independent of
// evaluateReportSeverity's report-level plumbing, so the match/exclude/specimen
// contract is guarded even if a future caller stops exercising it via a report.
//
// Run with: node test-analyte-match.js
'use strict';

const { analyteMatches, collapseWs, specimenAllows } = require('./engine/result-severity.js');

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

// ── analyteMatches: exported and callable ──────────────────────────────────────
console.log('\n--- exports present ---');
{
  assert(typeof analyteMatches === 'function', 'analyteMatches exported as a function');
  assert(typeof collapseWs === 'function', 'collapseWs exported as a function');
  assert(typeof specimenAllows === 'function', 'specimenAllows exported as a function');
}

// ── match: case-insensitive substring ──────────────────────────────────────────
console.log('\n--- match: case-insensitive substring ---');
{
  const analyte = { match: ['potassium'] };
  assert(analyteMatches(analyte, { name: 'Potassium' }) === true, 'exact-case name matches');
  assert(analyteMatches(analyte, { name: 'POTASSIUM' }) === true, 'uppercase name matches (case-insensitive)');
  assert(analyteMatches(analyte, { name: 'Serum Potassium' }) === true, 'substring within a longer name matches');
  assert(analyteMatches(analyte, { name: 'potASSium' }) === true, 'mixed-case name matches');
  assert(analyteMatches(analyte, { name: 'Sodium' }) === false, 'unrelated name does not match');
}
{
  // The rule-side match term itself can be any case too.
  const analyte = { match: ['POTASSIUM'] };
  assert(analyteMatches(analyte, { name: 'potassium' }) === true, 'uppercase match term still hits lowercase name');
}
{
  // Multiple match terms — any() semantics.
  const analyte = { match: ['lithium', 'li level'] };
  assert(analyteMatches(analyte, { name: 'Li Level' }) === true, 'second match term in the list still hits');
}

// ── match: guards ───────────────────────────────────────────────────────────────
console.log('\n--- match: guard clauses ---');
{
  assert(analyteMatches(null, { name: 'Potassium' }) === false, 'null analyte → false');
  assert(analyteMatches({}, { name: 'Potassium' }) === false, 'analyte with no match array → false');
  assert(analyteMatches({ match: [] }, { name: 'Potassium' }) === false, 'empty match array → false');
  assert(
    analyteMatches({ match: ['potassium'] }, { name: 123 }) === false,
    'non-string result.name → treated as empty name, no match'
  );
  assert(
    analyteMatches({ match: ['potassium'] }, {}) === false,
    'missing result.name → treated as empty name, no match'
  );
}

// ── exclude: drops a look-alike analyte ──────────────────────────────────────────
console.log('\n--- exclude: drops matched-but-excluded names ---');
{
  const analyte = { match: ['platelet'], exclude: ['mean platelet volume'] };
  assert(analyteMatches(analyte, { name: 'Platelets' }) === true, 'genuine platelet count still matches');
  assert(
    analyteMatches(analyte, { name: 'Mean platelet volume' }) === false,
    'MPV excluded despite matching "platelet"'
  );
  assert(analyteMatches(analyte, { name: 'MEAN PLATELET VOLUME' }) === false, 'exclude is case-insensitive too');
}
{
  // Exclude with no match hit at all is a no-op (never reached) — still false via match gate.
  const analyte = { match: ['haemoglobin'], exclude: ['a1c'] };
  assert(analyteMatches(analyte, { name: 'Haemoglobin A1c' }) === false, 'HbA1c excluded from haemoglobin rule');
  assert(analyteMatches(analyte, { name: 'Haemoglobin' }) === true, 'plain haemoglobin still matches (no exclude hit)');
}
{
  // exclude absent / not an array → no effect
  const analyte = { match: ['sodium'], exclude: 'not-an-array' };
  assert(
    analyteMatches(analyte, { name: 'Sodium' }) === true,
    'malformed exclude (non-array) is ignored, match still fires'
  );
}

// ── specimen: fail-open when header absent ──────────────────────────────────────
console.log('\n--- specimen: fail-open gate ---');
{
  const analyte = { match: ['culture'], specimen: ['throat swab'] };
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: undefined }) === true,
    'specimen scoping present but result carries no specimen header → fail-open, rule applies'
  );
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: null }) === true,
    'null specimen on result → fail-open, rule applies'
  );
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: '' }) === true,
    'empty-string specimen on result → fail-open, rule applies'
  );
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: '   ' }) === true,
    'whitespace-only specimen on result → treated as absent → fail-open'
  );
}

// ── specimen: narrows when both sides present ────────────────────────────────────
console.log('\n--- specimen: substring narrowing when both sides present ---');
{
  const analyte = { match: ['culture'], specimen: ['throat swab'] };
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: 'THROAT SWAB' }) === true,
    'matching specimen header (case-insensitive) → rule applies'
  );
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: 'Throat swab sample, right tonsil' }) === true,
    'specimen header containing the scoped term as a substring → rule applies'
  );
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: 'MSU - mid stream urine' }) === false,
    'non-matching specimen header → rule does NOT apply'
  );
}
{
  // Multiple specimen scope terms — any() semantics, same as match.
  const analyte = { match: ['culture'], specimen: ['throat swab', 'ear swab'] };
  assert(
    analyteMatches(analyte, { name: 'Culture', specimen: 'Ear swab, left' }) === true,
    'second specimen scope term in the list still hits'
  );
}

// ── specimen: no analyte.specimen at all is a pure no-op ────────────────────────
console.log('\n--- specimen: absent analyte.specimen never gates ---');
{
  const analyte = { match: ['sodium'] };
  assert(
    analyteMatches(analyte, { name: 'Sodium', specimen: 'anything at all' }) === true,
    'no analyte.specimen configured → specimen on the result is irrelevant'
  );
}

// ── specimenAllows directly (the sub-helper analyteMatches delegates to) ────────
console.log('\n--- specimenAllows: direct checks ---');
{
  assert(specimenAllows({}, { specimen: 'throat swab' }) === true, 'no specimen scope on analyte → always allows');
  assert(
    specimenAllows({ specimen: ['throat swab'] }, { specimen: 'Throat Swab' }) === true,
    'case-insensitive specimen match allows'
  );
  assert(specimenAllows({ specimen: ['throat swab'] }, { specimen: 'MSU' }) === false, 'non-matching specimen blocks');
  assert(specimenAllows({ specimen: ['throat swab'] }, {}) === true, 'absent result.specimen → fail-open allows');
}

// ── collapseWs: whitespace normalisation ─────────────────────────────────────────
console.log('\n--- collapseWs: whitespace collapse ---');
{
  assert(collapseWs('no evidence\nof dysplasia') === 'no evidence of dysplasia', 'newline collapses to single space');
  assert(collapseWs('a\t\tb') === 'a b', 'tabs collapse to single space');
  assert(collapseWs('a   b') === 'a b', 'multiple spaces collapse to single space');
  assert(collapseWs('already normal') === 'already normal', 'already-normalised text is unchanged');
  assert(collapseWs(123) === '123', 'non-string input is coerced via String() rather than throwing');
}

// ── combined: excludes still respected under a fail-open specimen scope ─────────
console.log('\n--- combined: exclude + specimen interplay ---');
{
  const analyte = { match: ['culture'], exclude: ['blood'], specimen: ['throat swab'] };
  assert(
    analyteMatches(analyte, { name: 'Blood culture', specimen: 'Throat swab' }) === false,
    'exclude still drops the result even when the specimen header would otherwise allow it'
  );
  assert(
    analyteMatches(analyte, { name: 'Throat culture', specimen: undefined }) === true,
    'non-excluded name with absent specimen → match + fail-open specimen both pass'
  );
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
