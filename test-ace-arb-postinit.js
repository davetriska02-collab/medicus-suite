// Medicus Suite — provenance-gated post-initiation U&E tests
// Run with: node test-ace-arb-postinit.js
//
// ACE-I/ARB and thiazide post-initiation U&E (NICE NG136 / CKS) is restored
// behind a start-date provenance gate: it may fire only when
// startDateSource === 'medication-history' (true first-ever issue from the
// prescribing-history VTM join). A missing/failed join leaves a batch-scoped
// regimen date and MUST NOT raise the alert (the #403 false-positive class).
//
// Clinical cases drive the real normaliseMedications + normaliseMedicationHistory
// path. Hand-built { startDate } fixtures that bypass the join are used only
// to prove they are architecturally incapable of firing (the #403 process gap).
// A fixed `now` keeps every age deterministic.

'use strict';
const path = require('path');
const engine = require('./engine/rules-engine.js');
const normalisers = require('./engine/normalisers.js');
const chipRenderer = require('./shared/chip-renderer.js');
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

const shippedAceArb = (drugRules.rules || []).find((r) => r.id === 'ace-arb');
const shippedThiazide = (drugRules.rules || []).find((r) => r.id === 'thiazide-diuretic-ue');

// Synthetic copy of ace-arb including the post-init row — engine arithmetic
// coverage, independent of the shipped-rule restore.
const aceArb = {
  type: 'drug-monitoring',
  enabled: true,
  id: 'ace-arb',
  drugClass: 'ACE inhibitor / ARB',
  drug: { match: ['ramipril'] },
  tests: [
    {
      name: 'U&E',
      match: ['u&e', 'urea and electrolytes', 'renal profile'],
      intervalDays: 365,
      dueSoonDays: 30,
    },
    {
      name: 'BP',
      match: ['blood pressure', 'bp'],
      intervalDays: 365,
      dueSoonDays: 30,
    },
    {
      name: 'U&E (within ~2 weeks of starting)',
      match: ['u&e', 'urea and electrolytes', 'renal profile'],
      postInitiationDays: 21,
      postInitiationDueSoonDays: 14,
    },
  ],
};
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

function ymdParts(iso) {
  const [year, month, day] = String(iso).split('-');
  return { year, month, day };
}

// Drive the REAL normaliser + history join. This is the path #403's tests
// skipped when they passed hand-built { name, startDate } into evaluatePatient.
function medsViaNormaliser({
  description,
  vtmProductName,
  batchStart,
  historyFirstIssue,
  historyKey,
  bucket = 'currentRepeatPrescribingMedications',
}) {
  const rawRegimen = {
    [bucket]: [
      {
        description,
        status: 'active',
        id: 'med-1',
        ...(vtmProductName ? { vtmProductName } : {}),
        medicationIssueHistory: {
          data: [{ startDate: ymdParts(batchStart), endDate: ymdParts(batchStart) }],
          range: { startDate: '2025-08-29', endDate: '2026-12-23' },
        },
      },
    ],
  };
  let history = null;
  if (historyFirstIssue) {
    const key = historyKey || vtmProductName;
    if (key) {
      history = normalisers.normaliseMedicationHistory({
        items: {
          [key]: {
            prescriptionIssues: [
              { issueDate: historyFirstIssue, prescriptionStatus: 'discontinued' },
              { issueDate: batchStart, prescriptionStatus: 'authorised' },
            ],
          },
        },
      });
    }
  }
  return normalisers.normaliseMedications(rawRegimen, history);
}

function postInitOf(chips, ruleId) {
  const chip = chips.find((c) => c.ruleId === ruleId);
  const postInit = chip ? (chip.tests || []).find((t) => t.postInitiation === true) : null;
  return { chip, postInit };
}

function evalAceViaHistory({ clinicalStart, batchStart, observations, vtmProductName = 'Ramipril' }) {
  const start = clinicalStart || batchStart;
  const meds = medsViaNormaliser({
    description: 'Ramipril 5mg capsules',
    vtmProductName,
    batchStart: batchStart || start,
    historyFirstIssue: clinicalStart || start,
  });
  const chips = engine.evaluatePatient(meds, observations || [], [aceArb], { now: NOW });
  return { ...postInitOf(chips, 'ace-arb'), meds };
}

function ue(date) {
  return { name: 'U&E', date, value: 'Na 140' };
}
function bp(date) {
  return { name: 'Blood pressure', date, value: '128/78' };
}

console.log('\n--- shipped rules carry provenance-gated post-initiation U&E ---');
check(!!shippedAceArb, 'ace-arb rule exists in drug-rules.json');
check(!!shippedThiazide, 'thiazide-diuretic-ue rule exists in drug-rules.json');
{
  const shippedWithPostInit = (drugRules.rules || []).filter((r) =>
    (r.tests || []).some((t) => t.postInitiationDays != null)
  );
  const ids = shippedWithPostInit.map((r) => r.id).sort();
  check(
    ids.join(',') === 'ace-arb,thiazide-diuretic-ue',
    `shipped postInitiationDays only on ace-arb + thiazide-diuretic-ue (got ${ids.join(', ') || 'none'})`
  );
}

// ---------------------------------------------------------------------------
// Required CSO cases: real normalise / history path
// ---------------------------------------------------------------------------

console.log('\n--- history join succeeds → post-init CAN fire (true recent start, no U&E) ---');
{
  const meds = medsViaNormaliser({
    description: 'Ramipril 5mg capsules',
    vtmProductName: 'Ramipril',
    batchStart: '2026-05-30',
    historyFirstIssue: '2026-05-30',
  });
  check(meds[0].startDate === '2026-05-30', `joined startDate is the history first-ever (got ${meds[0].startDate})`);
  check(
    meds[0].startDateSource === 'medication-history',
    `provenance is medication-history (got ${meds[0].startDateSource})`
  );
  const chips = engine.evaluatePatient(meds, [], [shippedAceArb], { now: NOW });
  const { chip, postInit } = postInitOf(chips, 'ace-arb');
  check(!!postInit, 'shipped ace-arb emits a post-initiation test row');
  check(postInit && postInit.status === 'overdue', `history-joined recent start with no U&E is overdue (got ${postInit && postInit.status})`);
  check(chip && chip.status === 'overdue', `chip surfaces overdue (got ${chip && chip.status})`);
}

console.log('\n--- history join missing (no vtmProductName) → post-init must NOT fire on batch startDate ---');
{
  const history = normalisers.normaliseMedicationHistory({
    items: {
      Ramipril: {
        prescriptionIssues: [
          { issueDate: '2013-10-04', prescriptionStatus: 'discontinued' },
          { issueDate: '2025-09-16', prescriptionStatus: 'authorised' },
        ],
      },
    },
  });
  const rawRegimen = {
    currentRepeatPrescribingMedications: [
      {
        description: 'Ramipril 5mg capsules',
        status: 'active',
        id: 'med-no-vtm',
        // No vtmProductName — the join key is missing, so history cannot attach.
        medicationIssueHistory: {
          data: [{ startDate: { year: '2025', month: '09', day: '16' } }],
          range: { startDate: '2025-08-29', endDate: '2026-12-23' },
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(rawRegimen, history);
  check(meds[0].startDate === '2025-09-16', `falls back to batch-scoped start (got ${meds[0].startDate})`);
  check(
    meds[0].startDateSource === 'issue-history',
    `missing VTM join keeps issue-history provenance (got ${meds[0].startDateSource})`
  );
  const chips = engine.evaluatePatient(meds, [ue('2025-08-01'), bp('2025-08-01')], [shippedAceArb], { now: NOW });
  const { chip, postInit } = postInitOf(chips, 'ace-arb');
  check(!!chip, 'annual ace-arb chip still fires');
  check(postInit && postInit.status === 'no_data', `post-init is no_data without trusted start (got ${postInit && postInit.status})`);
  check(
    chip.status !== 'overdue' && chip.status !== 'due_soon',
    `batch-scoped start cannot raise a post-init alert (chip ${chip.status})`
  );
}

console.log('\n--- established patient with true old start → in_date, not a false positive ---');
{
  const meds = medsViaNormaliser({
    description: 'Ramipril 5mg capsules',
    vtmProductName: 'Ramipril',
    batchStart: '2025-09-16',
    historyFirstIssue: '2013-10-04',
    bucket: 'currentRepeatDispensingMedications',
  });
  check(meds[0].startDate === '2013-10-04', `true first-ever start wins (got ${meds[0].startDate})`);
  check(meds[0].startDateSource === 'medication-history', `provenance is medication-history (got ${meds[0].startDateSource})`);
  const chips = engine.evaluatePatient(meds, [ue('2014-01-15'), bp('2025-08-01')], [shippedAceArb], { now: NOW });
  const { chip, postInit } = postInitOf(chips, 'ace-arb');
  check(postInit && postInit.status === 'in_date', `old true start + later U&E is in_date (got ${postInit && postInit.status})`);
  check(postInit && postInit.startDate === '2013-10-04', `post-init carries the true start (got ${postInit && postInit.startDate})`);
  check(chip && chip.status !== 'overdue', `established patient is not a false overdue (chip ${chip && chip.status})`);
}

console.log('\n--- established thiazide: history join → in_date; missing VTM → no false post-init ---');
{
  const joined = medsViaNormaliser({
    description: 'Indapamide 2.5mg tablets',
    vtmProductName: 'Indapamide',
    batchStart: '2025-09-16',
    historyFirstIssue: '2018-03-01',
  });
  const chipsJoined = engine.evaluatePatient(joined, [ue('2018-04-01')], [shippedThiazide], { now: NOW });
  const joinedPost = postInitOf(chipsJoined, 'thiazide-diuretic-ue');
  check(joined[0].startDateSource === 'medication-history', 'thiazide history join sets medication-history');
  check(
    joinedPost.postInit && joinedPost.postInit.status === 'in_date',
    `thiazide old true start is in_date (got ${joinedPost.postInit && joinedPost.postInit.status})`
  );

  const noVtm = medsViaNormaliser({
    description: 'Indapamide 2.5mg tablets',
    batchStart: '2025-09-16',
  });
  check(noVtm[0].startDateSource === 'issue-history', `thiazide without VTM stays issue-history (got ${noVtm[0].startDateSource})`);
  const chipsNoVtm = engine.evaluatePatient(noVtm, [ue('2025-08-01')], [shippedThiazide], { now: NOW });
  const noVtmPost = postInitOf(chipsNoVtm, 'thiazide-diuretic-ue');
  check(!!noVtmPost.chip, 'shipped thiazide still fires an annual monitoring chip');
  check(
    noVtmPost.postInit && noVtmPost.postInit.status === 'no_data',
    `thiazide batch start cannot fire post-init (got ${noVtmPost.postInit && noVtmPost.postInit.status})`
  );
  check(
    noVtmPost.chip.status !== 'overdue' && noVtmPost.chip.status !== 'due_soon',
    `thiazide annual stays clear of the #403 false-positive (chip ${noVtmPost.chip.status})`
  );
}

console.log('\n--- process gap lock: hand-built meds without medication-history provenance cannot fire ---');
{
  const chips = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2026-05-30' }],
    [],
    [shippedAceArb],
    { now: NOW }
  );
  const { postInit } = postInitOf(chips, 'ace-arb');
  check(
    postInit && postInit.status === 'no_data',
    `bypass fixture with a recent startDate and no source is no_data (got ${postInit && postInit.status})`
  );
}
{
  const chips = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2026-05-30', startDateSource: 'issue-history' }],
    [],
    [shippedAceArb],
    { now: NOW }
  );
  const { postInit } = postInitOf(chips, 'ace-arb');
  check(
    postInit && postInit.status === 'no_data',
    `explicit issue-history provenance cannot fire post-init (got ${postInit && postInit.status})`
  );
}
{
  const chips = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2026-05-30', startDateSource: 'issue-date' }],
    [],
    [shippedAceArb],
    { now: NOW }
  );
  const { postInit } = postInitOf(chips, 'ace-arb');
  check(
    postInit && postInit.status === 'no_data',
    `explicit issue-date provenance cannot fire post-init (got ${postInit && postInit.status})`
  );
}

console.log('\n--- history present but VTM key mismatch → join fails, post-init must not fire ---');
{
  const meds = medsViaNormaliser({
    description: 'Ramipril 5mg capsules',
    vtmProductName: 'Ramipril',
    batchStart: '2025-09-16',
    historyFirstIssue: '2013-10-04',
    historyKey: 'Lisinopril',
  });
  check(meds[0].startDate === '2025-09-16', `mismatched VTM key keeps batch start (got ${meds[0].startDate})`);
  check(meds[0].startDateSource === 'issue-history', `mismatched VTM key stays issue-history (got ${meds[0].startDateSource})`);
  const chips = engine.evaluatePatient(meds, [ue('2025-08-01')], [shippedAceArb], { now: NOW });
  const { chip, postInit } = postInitOf(chips, 'ace-arb');
  check(postInit && postInit.status === 'no_data', `failed VTM join cannot fire post-init (got ${postInit && postInit.status})`);
  check(chip.status !== 'overdue' && chip.status !== 'due_soon', `chip not overdue on a failed join (got ${chip.status})`);
}

// ---------------------------------------------------------------------------
// Engine arithmetic — still via the real history join
// ---------------------------------------------------------------------------

console.log('\n--- started 10 days ago, no U&E → recently_initiated (neutral) ---');
{
  const { postInit } = evalAceViaHistory({ clinicalStart: '2026-06-19' });
  check(postInit && postInit.status === 'recently_initiated', `post-init status recently_initiated (got ${postInit?.status})`);
}

console.log('\n--- started 17 days ago, no U&E → due_soon (amber) ---');
{
  const { chip, postInit } = evalAceViaHistory({ clinicalStart: '2026-06-12' });
  check(postInit && postInit.status === 'due_soon', `post-init status due_soon (got ${postInit?.status})`);
  check(chip.status === 'due_soon', `chip surfaces as due_soon (got ${chip.status})`);
}

console.log('\n--- started 30 days ago, no U&E → overdue (red) ---');
{
  const { chip, postInit } = evalAceViaHistory({ clinicalStart: '2026-05-30' });
  check(postInit && postInit.status === 'overdue', `post-init status overdue (got ${postInit?.status})`);
  check(chip.status === 'overdue', `chip surfaces as overdue (got ${chip.status})`);
}

console.log('\n--- started 30 days ago, U&E recorded since start → in_date (met) ---');
{
  const { chip, postInit } = evalAceViaHistory({
    clinicalStart: '2026-05-30',
    observations: [ue('2026-06-24'), bp('2026-06-24')],
  });
  check(postInit && postInit.status === 'in_date', `post-init status in_date (got ${postInit?.status})`);
  check(chip.status === 'in_date', `chip clear (in_date) — no false alert (got ${chip.status})`);
}

console.log('\n--- baseline U&E before start, none since → post-init overdue, annual in_date ---');
{
  const { chip, postInit } = evalAceViaHistory({
    clinicalStart: '2026-05-30',
    observations: [ue('2026-05-25'), bp('2026-06-24')],
  });
  check(postInit && postInit.status === 'overdue', `post-init status overdue despite a pre-start U&E (got ${postInit?.status})`);
  const annual = (chip.tests || []).find((t) => !t.postInitiation && t.name === 'U&E');
  check(annual && annual.status === 'in_date', 'annual U&E reads in_date off the baseline (proves post-init adds coverage)');
  check(chip.status === 'overdue', `chip overall overdue (got ${chip.status})`);
}

console.log('\n--- no start date → post-init neutral, no false alert ---');
{
  const chips = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: null }],
    [ue('2026-03-21'), bp('2026-03-21')],
    [aceArb],
    { now: NOW }
  );
  const { chip, postInit } = postInitOf(chips, 'ace-arb');
  check(postInit && postInit.status === 'no_data', `post-init status no_data without a start date (got ${postInit?.status})`);
  check(chip.status !== 'overdue' && chip.status !== 'due_soon', `no post-init alert when start date unknown (chip ${chip.status})`);
}

// Structured issue-history still parses (lastIssueDate / startDate fallback).
// Without a history join the provenance is issue-history, so post-init stays
// no_data — that is the gate, not a regression of the date parser.
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
            { startDate: { year: '2022', month: '02', day: '20' }, endDate: { year: '2022', month: '03', day: '20' } },
            { startDate: { year: '2021', month: '11', day: '01' }, endDate: { year: '2021', month: '12', day: '01' } },
          ],
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(rawRegimen);
  check(meds.length === 1 && meds[0].startDate === '2021-11-01', `startDate parsed as earliest issue (got ${meds[0] && meds[0].startDate})`);
  check(meds[0].lastIssueDate === '2022-02-20', `lastIssueDate parsed as latest issue (got ${meds[0] && meds[0].lastIssueDate})`);
  check(meds[0].startDateSource === 'issue-history', `structured history provenance is issue-history (got ${meds[0].startDateSource})`);

  const chips = engine.evaluatePatient(meds, [ue('2022-02-23')], [aceArb], { now: NOW });
  const { postInit } = postInitOf(chips, 'ace-arb');
  check(
    postInit && postInit.status === 'no_data',
    `issue-history start alone cannot clear or fire post-init (got ${postInit?.status})`
  );
}

console.log('\n--- real API shape: medication-history join stamps medication-history provenance ---');
{
  const rawRegimen = {
    currentRepeatDispensingMedications: [
      {
        description: 'Ramipril 5mg capsules',
        status: 'active',
        id: 'med-ramipril-2',
        vtmProductName: 'Ramipril',
        medicationIssueHistory: {
          data: [{ startDate: { year: '2025', month: '09', day: '16' }, endDate: { year: '2025', month: '10', day: '14' } }],
          range: { startDate: '2025-08-29', endDate: '2026-12-23' },
        },
      },
    ],
  };
  const medsWithoutHistory = normalisers.normaliseMedications(rawRegimen);
  check(
    medsWithoutHistory[0].startDate === '2025-09-16' && medsWithoutHistory[0].startDateSource === 'issue-history',
    `without medication-history, batch date + issue-history (got ${medsWithoutHistory[0].startDate} / ${medsWithoutHistory[0].startDateSource})`
  );

  const medicationHistory = normalisers.normaliseMedicationHistory({
    items: {
      Ramipril: {
        prescriptionIssues: [
          { issueDate: '2026-11-25', prescriptionStatus: 'authorised' },
          { issueDate: '2013-10-04', prescriptionStatus: 'discontinued' },
          { issueDate: '2025-09-16', prescriptionStatus: 'authorised' },
        ],
      },
    },
  });
  const medsWithHistory = normalisers.normaliseMedications(rawRegimen, medicationHistory);
  check(
    medsWithHistory[0].startDate === '2013-10-04' && medsWithHistory[0].startDateSource === 'medication-history',
    `history join sets true start + medication-history (got ${medsWithHistory[0].startDate} / ${medsWithHistory[0].startDateSource})`
  );

  const chips = engine.evaluatePatient(medsWithHistory, [ue('2014-01-15')], [aceArb], { now: NOW });
  const { postInit } = postInitOf(chips, 'ace-arb');
  check(postInit.startDate === '2013-10-04', `post-init test carries the true start date through (got ${postInit.startDate})`);
  check(postInit.status === 'in_date', `trusted old start + later U&E is in_date (got ${postInit.status})`);
}

console.log('\n--- WHY text: shows start date + first-since-start reassurance ---');
{
  const { trace } = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2021-11-01', startDateSource: 'medication-history' }],
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
    [{ name: 'Ramipril 5mg capsules', startDate: '2021-11-01', startDateSource: 'medication-history' }],
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

console.log('\n--- WHY text: untrusted batch-scoped start names itself, does not invent a clinical start ---');
{
  const { trace } = engine.evaluatePatient(
    [{ name: 'Ramipril 5mg capsules', startDate: '2025-09-16', startDateSource: 'issue-history' }],
    [ue('2025-08-01')],
    [aceArb],
    { now: NOW, trace: true }
  );
  const entry = trace.entries.find((e) => e.ruleId === 'ace-arb');
  const why = chipRenderer.buildPlainExplanation(entry);
  check(
    why.includes('clinical start not confirmed (batch-scoped date only)'),
    `WHY text names untrusted provenance (got: ${why})`
  );
  check(!why.includes('start date 16 Sep 2025'), `does not present the batch date as a clinical start (got: ${why})`);
}

console.log('\n--- data.observations is latest-only; earliest-since-start must come from data.observationHistory ---');
{
  const meds = [{ name: 'Ramipril 5mg capsules', startDate: '2021-08-31', startDateSource: 'medication-history' }];
  const observations = [ue('2025-01-10')];
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
