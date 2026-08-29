// Medicus Suite — ACE-I/ARB post-initiation U&E rule tests
// Run with: node test-ace-arb-postinit.js
//
// Verifies the NICE NG136 post-initiation U&E check on the real `ace-arb` rule
// (rules/drug-rules.json), evaluated through the real engine. The new engine
// `postInitiationDays` mechanism makes a MISSING U&E after starting an ACE-I/ARB
// actionable, while never crying wolf on an established patient whose start date
// is not visible. A fixed `now` keeps every age deterministic.

'use strict';
const path = require('path');
const engine = require('./engine/rules-engine.js');
const normalisers = require('./engine/normalisers.js');
const chipRenderer = require('./shared/chip-renderer.js');
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

const aceArb = (drugRules.rules || []).find((r) => r.id === 'ace-arb');
const NOW = '2026-06-29T12:00:00';

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// Evaluate a single patient against ONLY the ace-arb rule, returning the chip
// and its post-initiation U&E test evaluation.
function evalAce({ startDate, observations }) {
  const meds = [{ name: 'Ramipril 5mg capsules', startDate: startDate || null }];
  const chips = engine.evaluatePatient(meds, observations || [], [aceArb], { now: NOW });
  const chip = chips.find((c) => c.ruleId === 'ace-arb');
  const postInit = chip ? (chip.tests || []).find((t) => t.postInitiation === true) : null;
  return { chip, postInit };
}

function ue(date) {
  return { name: 'U&E', date, value: 'Na 140' };
}
function bp(date) {
  return { name: 'Blood pressure', date, value: '128/78' };
}

console.log('\n--- rule wiring ---');
check(!!aceArb, 'ace-arb rule exists in drug-rules.json');
check(
  (aceArb.tests || []).some((t) => t.postInitiationDays != null),
  'ace-arb carries a post-initiation U&E test'
);

// 1. Recently started (10d ago), no U&E since → within grace → not actionable.
console.log('\n--- started 10 days ago, no U&E → recently_initiated (neutral) ---');
{
  const { postInit } = evalAce({ startDate: '2026-06-19' });
  check(postInit && postInit.status === 'recently_initiated', `post-init status recently_initiated (got ${postInit?.status})`);
}

// 2. Started 17d ago, no U&E since → due_soon (amber).
console.log('\n--- started 17 days ago, no U&E → due_soon (amber) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-06-12' });
  check(postInit && postInit.status === 'due_soon', `post-init status due_soon (got ${postInit?.status})`);
  check(chip.status === 'due_soon', `chip surfaces as due_soon (got ${chip.status})`);
}

// 3. Started 30d ago, no U&E since → overdue (red). THE core safety case.
console.log('\n--- started 30 days ago, no U&E → overdue (red) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30' });
  check(postInit && postInit.status === 'overdue', `post-init status overdue (got ${postInit?.status})`);
  check(chip.status === 'overdue', `chip surfaces as overdue (got ${chip.status})`);
}

// 4. Started 30d ago, U&E + BP recorded 5d ago (after start) → requirement met.
console.log('\n--- started 30 days ago, U&E recorded since start → in_date (met) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30', observations: [ue('2026-06-24'), bp('2026-06-24')] });
  check(postInit && postInit.status === 'in_date', `post-init status in_date (got ${postInit?.status})`);
  check(chip.status === 'in_date', `chip clear (in_date) — no false alert (got ${chip.status})`);
}

// 5. Baseline U&E BEFORE start, none since → overdue. NG136's exact gap: the
//    annual interval is satisfied by the baseline, but the post-init recheck is
//    missing. The post-init test must catch what the annual test misses.
console.log('\n--- baseline U&E before start, none since → post-init overdue, annual in_date ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30', observations: [ue('2026-05-25'), bp('2026-06-24')] });
  check(postInit && postInit.status === 'overdue', `post-init status overdue despite a pre-start U&E (got ${postInit?.status})`);
  const annual = (chip.tests || []).find((t) => !t.postInitiation && t.name === 'U&E');
  check(annual && annual.status === 'in_date', 'annual U&E reads in_date off the baseline (proves post-init adds coverage)');
  check(chip.status === 'overdue', `chip overall overdue (got ${chip.status})`);
}

// 6. Unknown start date (established patient) → NEVER fires the post-init check.
console.log('\n--- no start date → post-init neutral, no false alert ---');
{
  const { chip, postInit } = evalAce({ startDate: null, observations: [ue('2026-03-21'), bp('2026-03-21')] });
  check(postInit && postInit.status === 'no_data', `post-init status no_data without a start date (got ${postInit?.status})`);
  check(chip.status !== 'overdue' && chip.status !== 'due_soon', `no post-init alert when start date unknown (chip ${chip.status})`);
}

// 7. REGRESSION (2026-08-29 real-patient report): medicationIssueHistory
//    entries carry a structured { year, month, day } startDate on the real
//    API (confirmed via HAR captures in shared/repeat-authorisation.js), NOT
//    a flat issueDate/date string. Before the fix, normaliseMedications()
//    only ever matched i.issueDate/i.date, so every med with real issue
//    history silently got startDate=null — the post-init check then always
//    read 'no_data', never firing (or clearing) for ANY real patient
//    regardless of how long ago they actually started or how many U&Es
//    they've had since. This drives the raw regimen shape through the real
//    normaliser (not a hand-built { startDate } fixture) to pin the fix.
console.log('\n--- real API shape: structured medicationIssueHistory startDate is read correctly ---');
{
  const rawRegimen = {
    currentRepeatPrescribingMedications: [
      {
        description: 'Ramipril 5mg capsules',
        status: 'active',
        id: 'med-ramipril-1',
        medicationIssueHistory: {
          data: [
            // Deliberately out of order — the derivation must not assume array order.
            { startDate: { year: '2022', month: '02', day: '20' }, endDate: { year: '2022', month: '03', day: '20' } },
            { startDate: { year: '2021', month: '11', day: '01' }, endDate: { year: '2021', month: '12', day: '01' } },
          ],
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(rawRegimen);
  check(meds.length === 1 && meds[0].startDate === '2021-11-01', `startDate parsed as earliest issue (got ${meds[0] && meds[0].startDate})`);

  const chips = engine.evaluatePatient(meds, [ue('2022-02-23')], [aceArb], { now: NOW });
  const chip = chips.find((c) => c.ruleId === 'ace-arb');
  const postInit = chip ? (chip.tests || []).find((t) => t.postInitiation === true) : null;
  check(postInit && postInit.status === 'in_date', `post-init reads real start date and clears on a later U&E (got ${postInit?.status})`);
}

// 7b. REGRESSION (2026-08-29 real-patient report, part 2): medicationIssueHistory
// on the regimen endpoint is ALSO capped to a rolling ~12-month window server-side
// (its own response carries a `range: {startDate, endDate}` proving this) — so
// "earliest visible issue" from case 7 above is only ever the CURRENT repeat
// batch's start, never the drug's true clinical start. A real patient on ramipril
// since 2013 read as "started 16 Sep 2025" off medicationIssueHistory alone. The
// separate medication-history endpoint (items.<substance>.prescriptionIssues[])
// has the full history back to the real first issue and must win when available.
console.log('\n--- real API shape: medicationIssueHistory is batch-scoped; medication-history gives the true start ---');
{
  const rawRegimen = {
    currentRepeatDispensingMedications: [
      {
        description: 'Ramipril 5mg capsules',
        status: 'active',
        id: 'med-ramipril-2',
        vtmProductName: 'Ramipril',
        medicationIssueHistory: {
          // Only the current ~12-month batch is visible here — matches the real
          // HAR shape exactly (range.startDate proves the endpoint itself capped it).
          data: [{ startDate: { year: '2025', month: '09', day: '16' }, endDate: { year: '2025', month: '10', day: '14' } }],
          range: { startDate: '2025-08-29', endDate: '2026-12-23' },
        },
      },
    ],
  };
  const medsWithoutHistory = normalisers.normaliseMedications(rawRegimen);
  check(
    medsWithoutHistory[0].startDate === '2025-09-16',
    `without medication-history, falls back to the batch-scoped date (got ${medsWithoutHistory[0].startDate})`
  );

  const medicationHistory = normalisers.normaliseMedicationHistory({
    items: {
      Ramipril: {
        prescriptionIssues: [
          { issueDate: '2026-11-25', prescriptionStatus: 'authorised' },
          { issueDate: '2013-10-04', prescriptionStatus: 'discontinued' }, // true first-ever issue
          { issueDate: '2025-09-16', prescriptionStatus: 'authorised' },
        ],
      },
    },
  });
  const medsWithHistory = normalisers.normaliseMedications(rawRegimen, medicationHistory);
  check(
    medsWithHistory[0].startDate === '2013-10-04',
    `medication-history overrides with the TRUE first-ever issue (got ${medsWithHistory[0].startDate})`
  );

  const chips = engine.evaluatePatient(medsWithHistory, [ue('2014-01-15')], [aceArb], { now: NOW });
  const postInit = (chips.find((c) => c.ruleId === 'ace-arb').tests || []).find((t) => t.postInitiation === true);
  check(postInit.startDate === '2013-10-04', `post-init test carries the true start date through (got ${postInit.startDate})`);
}

// 8. WHY-text: the post-initiation line must show the start date the engine
// actually read plus the earliest qualifying result since it, instead of the
// generic "interval 365d → due ..." arithmetic that made no sense for a
// one-off post-initiation check and was the only thing visible to a
// clinician trying to diagnose case 7's original bug report.
console.log('\n--- WHY text: shows start date + first-since-start reassurance ---');
{
  const { trace } = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2021-11-01' }],
    [ue('2022-02-23'), ue('2026-07-15')],
    [aceArb],
    { now: NOW, trace: true }
  );
  const entry = trace.entries.find((e) => e.ruleId === 'ace-arb');
  const why = chipRenderer.buildPlainExplanation(entry);
  check(
    why.includes('start date 1 Nov 2021') && why.includes('next U&E 23 Feb 2022') && why.includes('repeated 2 times since'),
    `WHY text names start date + first U&E + repeat count (got: ${why})`
  );
}

console.log('\n--- WHY text: single late test (not yet repeated) reads distinctly from 2+ ---');
{
  const { trace } = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2021-11-01' }],
    [ue('2022-02-23')],
    [aceArb],
    { now: NOW, trace: true }
  );
  const entry = trace.entries.find((e) => e.ruleId === 'ace-arb');
  const why = chipRenderer.buildPlainExplanation(entry);
  check(why.includes('not yet repeated'), `WHY text flags a single late test as not yet repeated (got: ${why})`);
}

console.log('\n--- WHY text: no start date visible reads plainly, not as a silent gap ---');
{
  const { trace } = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: null }],
    [ue('2026-03-21')],
    [aceArb],
    { now: NOW, trace: true }
  );
  const entry = trace.entries.find((e) => e.ruleId === 'ace-arb');
  const why = chipRenderer.buildPlainExplanation(entry);
  check(why.includes('start date not visible in record'), `WHY text states start date is unknown (got: ${why})`);
}

// 9. REGRESSION (2026-08-29 real-patient report, part 3): data.observations
// carries only the LATEST result per investigation type (normaliseObservations
// picks the single most recent dataYYYYMMDD cell) — it is NOT a history. A
// real patient started 31 Aug 2021 with U&Es on 23 Mar 2022, 13 Apr 2023 and
// 10 Jan 2025 read the WHY text as "next U&E 10 Jan 2025 (not yet repeated)"
// — the code only ever saw the single latest result and had no way to find
// the two earlier ones or count them. The full point series lives in
// data.observationHistory (normaliseObservationHistory), which was fetched
// all along but never consulted for this specific "earliest qualifying
// result since start" computation. Reproduces the exact shape the two
// normalisers actually produce: one latest-only entry in `observations`, the
// full series in `observationHistory`.
console.log('\n--- data.observations is latest-only; earliest-since-start must come from data.observationHistory ---');
{
  const meds = [{ name: 'Ramipril 5mg capsules', startDate: '2021-08-31' }];
  const observations = [ue('2025-01-10')]; // what normaliseObservations would actually produce: latest only
  // Real HAR shape (102-invresultsdashboard.har): "U&E" is never a literal
  // investigationType — it's four separate analyte rows (Sodium, Potassium,
  // Urea, Creatinine) sharing one investigationGroup, all with the IDENTICAL
  // date set. This must match via the group field (not just name) AND
  // de-duplicate by date, or a 4-analyte panel either matches nothing or
  // reads as "repeated 4x" for what is really one result per date.
  const ueDates = ['2025-01-10', '2023-04-13', '2022-03-23', '2021-07-07', '2021-01-11'];
  const observationHistory = ['Sodium', 'Potassium', 'Urea', 'Creatinine'].map((name) => ({
    name,
    code: null,
    group: 'U&Es (Urea and electrolytes)',
    unit: 'mmol/L',
    history: ueDates.map((date) => ({ date, value: 140, rawValue: '140' })),
  }));
  const { trace } = engine.evaluatePatient(meds, observations, [aceArb], { now: NOW, trace: true, observationHistory });
  const entry = trace.entries.find((e) => e.ruleId === 'ace-arb');
  const why = chipRenderer.buildPlainExplanation(entry);
  check(
    why.includes('next U&E 23 Mar 2022') && why.includes('repeated 3 times since'),
    `WHY text finds the EARLIEST since-start result (2022, not 2025) and the correct de-duplicated count (3, not 12) (got: ${why})`
  );
  check(!why.includes('not yet repeated'), `no longer misreports a well-monitored patient as "not yet repeated" (got: ${why})`);
}

console.log('\n--- signing/sweep must not fail-closed on best-effort medicationHistory ---');
{
  const fs = require('fs');
  const signing = fs.readFileSync(path.join(__dirname, 'side-panel/modules/signing/signing.js'), 'utf8');
  const sweep = fs.readFileSync(path.join(__dirname, 'side-panel/modules/sweep/sweep.js'), 'utf8');
  check(
    /k !== 'clinicalSummary' && k !== 'medicationHistory'/.test(signing),
    'signing evaluatePatient treats medicationHistory as best-effort (same as clinicalSummary)'
  );
  check(
    /k !== 'clinicalSummary' && k !== 'medicationHistory'/.test(sweep),
    'sweep evaluatePatient treats medicationHistory as best-effort (same as clinicalSummary)'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
