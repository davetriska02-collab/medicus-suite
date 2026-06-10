// Medicus Suite — Rule Currency Tests
// Run with: node test-rule-currency.js
//
// Tests the assessRuleCurrency() helper and then runs a live check against
// the actual bundled rule files with today's date. The live check is
// INTENTIONALLY a CI failure when the bundled rules go genuinely stale.
// If it fails: run The Keeper skill or update the relevant rule file's
// lastUpdated date and specVersion after reviewing the source guidance.

'use strict';

const path = require('path');
const { assessRuleCurrency } = require(path.join(__dirname, 'shared', 'rule-currency.js'));

// Load real rule files for the live check at the end.
const drugRules  = require(path.join(__dirname, 'rules', 'drug-rules.json'));
const qofRules   = require(path.join(__dirname, 'rules', 'qof-rules.json'));
const vaxRules   = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));
const alertLib   = require(path.join(__dirname, 'rules', 'alert-library.json'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// Helper: build a minimal file descriptor
function mkFile(id, lastUpdated, specVersion) {
  return { id, lastUpdated, specVersion: specVersion || null };
}

// ── Fresh files → green ───────────────────────────────────────────────────────
console.log('\n--- fresh files → green ---');
{
  const today = '2026-06-10';
  const files = [
    mkFile('drug',    '2026-06-04', 'Sentinel drug rules - June 2026 review'),
    mkFile('qof',     '2026-06-04', 'QOF 2026/27'),
    mkFile('vaccine', '2026-06-09', 'JCVI/UKHSA 2025/26 season'),
    mkFile('alert',   '2026-06-04', 'PINCER/NICE prescribing-safety alert library v1.1'),
  ];
  const result = assessRuleCurrency(files, today);
  check(result.overall === 'green', `overall green (got: ${result.overall})`);
  check(result.warnings.length === 0, `no warnings (got: ${result.warnings.join('; ')})`);
  result.files.forEach(f => {
    check(f.level === 'green', `${f.id}: green`);
  });
}

// ── lastUpdated 400 days old → amber ─────────────────────────────────────────
console.log('\n--- lastUpdated 400 days old → amber ---');
{
  const today = '2026-06-10';
  // 400 days before 2026-06-10 = approx 2025-05-06
  const files = [mkFile('drug', '2025-05-06', 'some spec')];
  const result = assessRuleCurrency(files, today);
  check(result.overall === 'amber', `overall amber for 400d old file`);
  check(result.files[0].level === 'amber', `drug: amber`);
  check(result.files[0].ageDays > 365, `ageDays > 365 (got: ${result.files[0].ageDays})`);
}

// ── missing lastUpdated → amber ───────────────────────────────────────────────
console.log('\n--- missing lastUpdated → amber ---');
{
  const today = '2026-06-10';
  const files = [mkFile('drug', null, 'some spec')];
  const result = assessRuleCurrency(files, today);
  check(result.overall === 'amber', `overall amber for missing lastUpdated`);
  check(result.files[0].level === 'amber', `drug: amber`);
  check(result.files[0].ageDays === null, `ageDays null`);
}

// ── unparseable lastUpdated → amber ───────────────────────────────────────────
console.log('\n--- unparseable lastUpdated → amber ---');
{
  const today = '2026-06-10';
  const files = [mkFile('drug', 'not-a-date', 'some spec')];
  const result = assessRuleCurrency(files, today);
  check(result.overall === 'amber', `overall amber for unparseable lastUpdated`);
  check(result.files[0].level === 'amber', `drug: amber (unparseable)`);
}

// ── QOF year mismatch (today 2027-05-01 vs "QOF 2026/27") → amber + warning ──
console.log('\n--- QOF year mismatch → amber + warning ---');
{
  const today = '2027-05-01';
  const files = [
    mkFile('drug',    '2027-04-15', 'Sentinel drug rules'),
    mkFile('qof',     '2027-03-01', 'QOF 2026/27'),
    mkFile('vaccine', '2027-04-15', 'JCVI/UKHSA 2026/27 season'),
    mkFile('alert',   '2027-04-15', 'PINCER v1.1'),
  ];
  const result = assessRuleCurrency(files, today);
  check(result.overall === 'amber', `overall amber (QOF mismatch)`);
  const qofFile = result.files.find(f => f.id === 'qof');
  check(qofFile && qofFile.level === 'amber', `qof: amber`);
  check(result.warnings.some(w => /QOF year mismatch/i.test(w) || /2026\/27/i.test(w)),
    `warning mentions QOF year mismatch (got: ${result.warnings.join('; ')})`);
}

// ── QOF in-year (today 2026-06-10, "QOF 2026/27") → no QOF warning ──────────
console.log('\n--- QOF in-year → no QOF warning ---');
{
  const today = '2026-06-10';
  const files = [mkFile('qof', '2026-06-04', 'QOF 2026/27')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'green', `qof: green when in-year`);
  check(result.warnings.length === 0, `no warnings for in-year QOF`);
}

// ── QOF boundary: exactly on 1 April of end year → amber ─────────────────────
console.log('\n--- QOF boundary: 1 April of end year → amber ---');
{
  const today = '2027-04-01';
  const files = [mkFile('qof', '2027-03-15', 'QOF 2026/27')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'amber', `qof: amber on 1 Apr of end year`);
}

// ── QOF boundary: 31 March of end year → green (last day of the year) ────────
console.log('\n--- QOF boundary: 31 March of end year → green ---');
{
  const today = '2027-03-31';
  const files = [mkFile('qof', '2027-03-15', 'QOF 2026/27')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'green', `qof: green on 31 Mar (still in-year)`);
}

// ── Vaccine season stale (today 2026-10-01 vs "2025/26 season") → amber ──────
console.log('\n--- vaccine season stale → amber ---');
{
  const today = '2026-10-01';
  const files = [mkFile('vaccine', '2026-06-09', 'JCVI/UKHSA 2025/26 season')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'amber', `vaccine: amber when season ended`);
  check(result.warnings.some(w => /2025\/26/i.test(w) || /season/i.test(w)),
    `warning mentions season (got: ${result.warnings.join('; ')})`);
}

// ── Vaccine season boundary: exactly 2026-09-01 → amber ──────────────────────
console.log('\n--- vaccine season boundary: 2026-09-01 → amber ---');
{
  const today = '2026-09-01';
  const files = [mkFile('vaccine', '2026-06-09', 'JCVI/UKHSA 2025/26 season')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'amber', `vaccine: amber on 2026-09-01 (cutoff)`);
}

// ── Vaccine not yet stale (today 2026-08-31) → green ─────────────────────────
console.log('\n--- vaccine season not yet stale → green ---');
{
  const today = '2026-08-31';
  const files = [mkFile('vaccine', '2026-06-09', 'JCVI/UKHSA 2025/26 season')];
  const result = assessRuleCurrency(files, today);
  check(result.files[0].level === 'green', `vaccine: green on 2026-08-31 (before cutoff)`);
}

// ── Unparseable specVersion → amber, not crash ────────────────────────────────
console.log('\n--- unparseable specVersion → amber not crash ---');
{
  const today = '2026-06-10';
  const files = [
    mkFile('qof',     '2026-06-04', 'TOTALLY UNPARSEABLE SPEC VERSION!!!'),
    mkFile('vaccine', '2026-06-09', 'ALSO UNPARSEABLE'),
  ];
  let threw = false;
  let result;
  try { result = assessRuleCurrency(files, today); }
  catch (e) { threw = true; }
  check(!threw, 'assessRuleCurrency does not throw on unparseable specVersion');
  if (!threw) {
    check(result.files[0].level === 'amber', `qof: amber for unparseable specVersion`);
    check(result.files[1].level === 'amber', `vaccine: amber for unparseable specVersion`);
  }
}

// ── Empty files array ─────────────────────────────────────────────────────────
console.log('\n--- empty files array → amber ---');
{
  const result = assessRuleCurrency([], '2026-06-10');
  check(result.overall === 'amber', `overall amber for empty files array`);
}

// ── LIVE CHECK against real bundled rule files with today's date ───────────────
// This check is intentional: CI should fail when the bundled rules go genuinely stale.
// If this assertion fails:
//   1. Run The Keeper skill to refresh stale rules from source guidance, OR
//   2. If the rules are still clinically accurate but the date hasn't been updated,
//      update lastUpdated in the relevant file AND update the specVersion if the
//      guidance version has changed.
console.log('\n--- LIVE CHECK: bundled rule files vs today ---');
{
  const today = new Date().toISOString().slice(0, 10);
  const files = [
    { id: 'drug',    lastUpdated: drugRules.lastUpdated,  specVersion: drugRules.specVersion },
    { id: 'qof',     lastUpdated: qofRules.lastUpdated,   specVersion: qofRules.specVersion },
    { id: 'vaccine', lastUpdated: vaxRules.lastUpdated,   specVersion: vaxRules.specVersion },
    { id: 'alert',   lastUpdated: alertLib.lastUpdated,   specVersion: alertLib.specVersion },
  ];
  const result = assessRuleCurrency(files, today);
  if (result.overall !== 'green') {
    console.error('\n  LIVE CHECK FAILED — bundled rule files are stale or have a version mismatch.');
    console.error('  What to do: run The Keeper skill (or update the stale rule file manually).');
    console.error('  Warnings:');
    result.warnings.forEach(w => console.error(`    - ${w}`));
    result.files.filter(f => f.level === 'amber').forEach(f => {
      console.error(`    File "${f.id}": lastUpdated=${f.lastUpdated}, ageDays=${f.ageDays}, specVersion=${f.specVersion}`);
    });
  }
  check(result.overall === 'green', `LIVE: all bundled rule files green today (${today})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}
