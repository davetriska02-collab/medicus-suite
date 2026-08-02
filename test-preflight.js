// Medicus Suite — engine/preflight.js unit tests
// Run with: node test-preflight.js
//
// Fixtures cover the plan's required scenarios:
//   - ACB delta into a higher band
//   - a STOPP trigger introduced by the proposed drug
//   - a known interaction pair (methotrexate + trimethoprim)
//   - monitoring baseline satisfied vs missing
//   - unknown drug (honesty case)
//   - empty / garbage input
//
// Uses the REAL rule files (rules/drug-rules.json, rules/alert-library.json),
// same convention as test-drug-brand-coverage.js / test-alert-library-coverage.js,
// so a change to those files that breaks pre-flight composition fails here too.

'use strict';

const path = require('path');
const preflight = require(path.join(__dirname, 'engine', 'preflight.js'));
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));
const alertLibrary = require(path.join(__dirname, 'rules', 'alert-library.json'));

const RULE_FILES = { drugRules, alertLibrary };

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

function patient(overrides) {
  return Object.assign(
    {
      medications: [],
      problems: [],
      observations: [],
      ageYears: 60,
      sex: 'F',
    },
    overrides
  );
}

// ── runPreflightCheck is exported and is the single ledger-hook call-site ──
console.log('\n--- exports ---');
check(typeof preflight.runPreflightCheck === 'function', 'runPreflightCheck is exported');

// ── ACB delta into a higher band ────────────────────────────────────────────
console.log('\n--- ACB escalation ---');
{
  // Current: amitriptyline alone (ACB 3, already "high" band on its own).
  // Use a patient with NO current anticholinergic burden so the addition
  // demonstrably escalates the band (none -> high).
  const pc = patient({ medications: [{ name: 'Ramipril 5mg' }], ageYears: 78 });
  const result = preflight.runPreflightCheck(pc, 'Oxybutynin 5mg', RULE_FILES);
  check(!!result, 'result returned for ACB scenario');
  check(result.acb.current === 0, `ACB current = 0 (got ${result.acb.current})`);
  check(result.acb.projected === 3, `ACB projected = 3 (got ${result.acb.projected})`);
  check(result.acb.delta === 3, `ACB delta = 3 (got ${result.acb.delta})`);
  check(result.acb.currentBand === 'none', `ACB currentBand = none (got ${result.acb.currentBand})`);
  check(result.acb.band === 'high', `ACB band = high (got ${result.acb.band})`);
  check(result.acb.escalates === true, 'ACB escalates flag true');
  check(
    result.acb.perDrug.some((d) => d.matchedTerm === 'oxybutynin'),
    'ACB perDrug includes the proposed drug (oxybutynin)'
  );
}

// A second addition on top of an existing burden escalates further but does
// NOT claim a false "band change" when it stays in the same band.
{
  const pc = patient({ medications: [{ name: 'Codeine 30mg' }], ageYears: 78 }); // ACB 1 -> "some"
  const result = preflight.runPreflightCheck(pc, 'Loratadine 10mg', RULE_FILES); // ACB 1 -> still "some"
  check(result.acb.currentBand === 'some', `same-band case: currentBand = some (got ${result.acb.currentBand})`);
  check(result.acb.band === 'some', `same-band case: band = some (got ${result.acb.band})`);
  check(result.acb.escalates === false, 'same-band case: escalates = false (no band change)');
}

// ── STOPP trigger introduced by the addition ────────────────────────────────
console.log('\n--- STOPP trigger ---');
{
  // Elderly patient, no NSAID currently, no loop diuretic. Proposing an NSAID
  // with a low eGFR should introduce STOPP 1 (NSAID + eGFR <50).
  const pc = patient({
    medications: [{ name: 'Amlodipine 5mg' }],
    ageYears: 82,
    observations: [{ name: 'eGFR', rawValue: '42', value: '42 mL/min/1.73m²', date: '2026-06-01' }],
  });
  const result = preflight.runPreflightCheck(pc, 'Ibuprofen 400mg', RULE_FILES);
  const flag = result.stoppStart.find((f) => f.id === 'stopp_nsaid_ckd');
  check(!!flag, 'STOPP 1 (NSAID + eGFR<50) fires as a NEW flag from the proposed drug');
  check(flag.severity === 'red', 'STOPP 1 severity = red');
}
{
  // Sanity: a flag already true of the CURRENT regimen (patient already on an
  // NSAID) must NOT be re-reported as caused by an unrelated addition.
  const pc = patient({
    medications: [{ name: 'Ibuprofen 400mg' }],
    ageYears: 82,
    observations: [{ name: 'eGFR', rawValue: '42', value: '42 mL/min/1.73m²', date: '2026-06-01' }],
  });
  const result = preflight.runPreflightCheck(pc, 'Amlodipine 5mg', RULE_FILES);
  const flag = result.stoppStart.find((f) => f.id === 'stopp_nsaid_ckd');
  check(!flag, 'pre-existing STOPP flag is NOT re-reported as caused by an unrelated addition');
}

// ── Known interaction pair: methotrexate + trimethoprim ─────────────────────
console.log('\n--- known interaction (methotrexate + trimethoprim) ---');
{
  const pc = patient({ medications: [{ name: 'Methotrexate 10mg tablets' }], ageYears: 55 });
  const result = preflight.runPreflightCheck(pc, 'Trimethoprim 200mg', RULE_FILES);
  const hit = result.interactions.find((i) => i.ruleId === 'pincer-mtx-trimethoprim');
  check(!!hit, 'methotrexate + trimethoprim interaction fires');
  check(hit.status === 'alert', 'interaction status = alert (red severity)');
  check(result.known === true, 'drug is known (interaction present)');
}
{
  // Reverse order: trimethoprim already prescribed, methotrexate proposed.
  const pc = patient({ medications: [{ name: 'Co-trimoxazole 480mg' }], ageYears: 55 });
  const result = preflight.runPreflightCheck(pc, 'Methotrexate 10mg tablets', RULE_FILES);
  const hit = result.interactions.find((i) => i.ruleId === 'pincer-mtx-trimethoprim');
  check(!!hit, 'interaction fires regardless of which drug is "current" vs "proposed"');
}
{
  // allopurinol + azathioprine — second named interaction pair from the plan.
  const pc = patient({ medications: [{ name: 'Allopurinol 100mg' }], ageYears: 60 });
  const result = preflight.runPreflightCheck(pc, 'Azathioprine 50mg', RULE_FILES);
  const hit = result.interactions.find((i) => i.ruleId === 'alert-xoi-thiopurine-myelosuppression');
  check(!!hit, 'allopurinol + azathioprine interaction fires');
  check(hit.status === 'alert', 'allopurinol/azathioprine interaction status = alert (red)');
}
{
  // A combo interaction ALREADY present between two current drugs is not
  // re-reported when a third, unrelated drug is proposed.
  const pc = patient({
    medications: [{ name: 'Methotrexate 10mg tablets' }, { name: 'Trimethoprim 200mg' }],
    ageYears: 55,
  });
  const result = preflight.runPreflightCheck(pc, 'Paracetamol 500mg', RULE_FILES);
  const hit = result.interactions.find((i) => i.ruleId === 'pincer-mtx-trimethoprim');
  check(!hit, 'a pre-existing interaction between two CURRENT drugs is not re-reported on an unrelated addition');
}

// ── Monitoring: baseline satisfied vs missing ────────────────────────────────
console.log('\n--- monitoring baseline satisfied vs missing ---');
{
  // Recent in-range FBC/U&E/LFT already on file -> baseline satisfied (in_date).
  const pc = patient({
    observations: [
      { name: 'FBC', rawValue: '10', value: '10 x10^9/L', date: '2026-06-20' },
      { name: 'U&E', rawValue: '5', value: '5 mmol/L', date: '2026-06-20' },
      { name: 'LFT', rawValue: '30', value: '30 U/L', date: '2026-06-20' },
    ],
  });
  const result = preflight.runPreflightCheck(pc, 'Methotrexate 10mg tablets', RULE_FILES, { now: '2026-07-01' });
  const mtxRule = result.monitoring.find((m) => m.ruleId === 'methotrexate-maintenance');
  check(!!mtxRule, 'methotrexate-maintenance monitoring rule found for proposed drug');
  check(
    mtxRule.tests.every((t) => t.satisfied === true),
    'all monitoring tests report satisfied:true when a recent in-range result exists'
  );
  const fbc = mtxRule.tests.find((t) => t.name === 'FBC');
  check(
    fbc.latestResult && fbc.latestResult.date === '2026-06-20',
    'satisfied test carries the satisfying result date'
  );
}
{
  // No observations at all -> baseline missing (no_data), each test reports satisfied:false.
  const pc = patient({ observations: [] });
  const result = preflight.runPreflightCheck(pc, 'Methotrexate 10mg tablets', RULE_FILES, { now: '2026-07-01' });
  const mtxRule = result.monitoring.find((m) => m.ruleId === 'methotrexate-maintenance');
  check(!!mtxRule, 'monitoring rule found even with no observations');
  check(
    mtxRule.tests.every((t) => t.satisfied === false),
    'all monitoring tests report satisfied:false when no baseline result exists'
  );
  check(
    mtxRule.tests.every((t) => t.latestResult === null),
    'latestResult is null for every missing test'
  );
}

// ── Unknown drug — honesty case ──────────────────────────────────────────────
console.log('\n--- unknown drug ---');
{
  const pc = patient({ medications: [{ name: 'Ramipril 5mg' }], ageYears: 60 });
  const result = preflight.runPreflightCheck(pc, 'Zzznotarealdrugxyz', RULE_FILES);
  check(!!result, 'result returned for an unrecognised drug name');
  check(result.known === false, 'known = false for a drug no engine recognises');
  check(result.interactions.length === 0, 'no interactions fabricated for an unknown drug');
  check(result.monitoring.length === 0, 'no monitoring requirements fabricated for an unknown drug');
  check(result.acb.delta === 0, 'ACB delta = 0 for a drug ACB does not recognise');
  check(result.stoppStart.length === 0, 'no STOPP/START flags fabricated for an unknown drug');
}

// ── Caveat line — mandatory, exact wording ───────────────────────────────────
console.log('\n--- mandatory caveat ---');
{
  const pc = patient({});
  const result = preflight.runPreflightCheck(pc, 'Ramipril 5mg', RULE_FILES);
  check(
    result.caveat === 'Decision aid, not advice — confirm against the BNF and the full record.',
    'caveat line matches the mandatory exact wording'
  );
}

// ── Empty / garbage input ────────────────────────────────────────────────────
console.log('\n--- empty / garbage input ---');
{
  const pc = patient({});
  check(preflight.runPreflightCheck(pc, '', RULE_FILES) === null, 'empty string drug name -> null');
  check(preflight.runPreflightCheck(pc, '   ', RULE_FILES) === null, 'whitespace-only drug name -> null');
  check(preflight.runPreflightCheck(pc, null, RULE_FILES) === null, 'null drug name -> null');
  check(preflight.runPreflightCheck(pc, undefined, RULE_FILES) === null, 'undefined drug name -> null');
  check(preflight.runPreflightCheck(null, 'Ramipril', RULE_FILES) === null, 'null patientContext -> null');
  check(preflight.runPreflightCheck(undefined, 'Ramipril', RULE_FILES) === null, 'undefined patientContext -> null');
  check(preflight.runPreflightCheck('garbage', 'Ramipril', RULE_FILES) === null, 'non-object patientContext -> null');
}
{
  // Missing arrays / malformed patientContext fields must not throw.
  const weird = { medications: null, problems: undefined, observations: 'not-an-array', ageYears: 'NaN', sex: 123 };
  let result = null;
  let threw = false;
  try {
    result = preflight.runPreflightCheck(weird, 'Ramipril 5mg', RULE_FILES);
  } catch (e) {
    threw = true;
  }
  check(!threw, 'malformed patientContext fields do not throw');
  check(!!result, 'malformed-but-object patientContext still returns a result');
}
{
  // Missing ruleFiles entirely must not throw (defensive — e.g. fetch failed).
  let threw = false;
  try {
    preflight.runPreflightCheck(patient({}), 'Ramipril 5mg', {});
  } catch (e) {
    threw = true;
  }
  check(!threw, 'missing ruleFiles (empty object) does not throw');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
