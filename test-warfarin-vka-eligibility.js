// Medicus Suite — warfarin-vka INR eligibility (Companion false-positive)
// Run with: node test-warfarin-vka-eligibility.js
//
// Ros / Dave report (2026-09): Companion flagged INR on a patient who had not
// had warfarin since December 2025 and did not have it on repeats.
// Cause: evaluateDrugRule name-matches anything in data.medications;
// normaliseMedications includes acuteMedicationsLastTwelveMonths, so a Dec
// 2025 acute stays "current" until ~Dec 2026.
// Fix: rule.drug.issuedWithinDays (180) — current repeats always count;
// acute / OTC only count when lastIssueDate is within the window.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const normalisers = require(path.join(__dirname, 'engine', 'normalisers.js'));
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

const NOW = '2026-09-08T00:00:00.000Z';
const warfarinVka = (drugRules.rules || []).find((r) => r.id === 'warfarin-vka');
const mtxRule = (drugRules.rules || []).find((r) => r.id === 'methotrexate-maintenance');

check(!!warfarinVka, 'shipped warfarin-vka rule exists');
check(warfarinVka && warfarinVka.drug.issuedWithinDays === 180, 'warfarin-vka issuedWithinDays is 180');
check(
  !!mtxRule && mtxRule.drug.issuedWithinDays == null,
  'methotrexate has no issuedWithinDays (other rules unchanged)'
);

function chipsFor(meds, obs) {
  return engine.evaluatePatient(meds, obs || [], [warfarinVka], { now: NOW, problems: [] });
}

function inrChip(meds, obs) {
  return chipsFor(meds, obs).find((c) => c.ruleId === 'warfarin-vka');
}

const noInr = [];
const oldInr = [{ name: 'INR', date: '2025-06-01', value: '2.4' }];

console.log('\n--- Ros report: Dec 2025 acute, off repeats, no INR ---');
{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Acute',
        startDate: '2024-03-01',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!chip, 'Dec 2025 acute warfarin does NOT raise an INR chip in Sep 2026');
}

{
  const data = {
    medications: [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Acute',
        lastIssueDate: '2025-12-15',
      },
    ],
    observations: oldInr,
    problems: [],
    _trace: [],
  };
  const out = engine.evaluateDrugRule(warfarinVka, data, NOW);
  check(out.length === 0, 'evaluateDrugRule returns no chips for stale acute');
  check(
    data._trace[0] && data._trace[0].skipReason === 'issue-window',
    'trace skipReason is issue-window (not no-drug-match)'
  );
}

console.log('\n--- still on a current repeat: keep flagging ---');
{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Repeat',
        startDate: '2019-01-01',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!!chip, 'current-repeat warfarin still raises an INR chip even if last issued Dec 2025');
  check(chip && chip.status === 'no_data', `repeat + no INR is no_data (got ${chip && chip.status})`);
}

{
  const chip = inrChip(
    [
      {
        name: 'Marevan 5mg tablets',
        source: 'Repeat dispensing',
        lastIssueDate: '2025-01-01',
      },
    ],
    oldInr
  );
  check(!!chip, 'repeat-dispensing Marevan with a stale last issue still chips');
}

console.log('\n--- recent acute (initiation / discharge): keep flagging ---');
{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 1mg tablets',
        source: 'Acute',
        lastIssueDate: '2026-08-20',
      },
    ],
    noInr
  );
  check(!!chip, 'acute last issued 19 days ago still raises INR (initiation / discharge)');
}

{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Acute',
        lastIssueDate: '2026-03-15',
      },
    ],
    noInr
  );
  check(!!chip, 'acute last issued 177 days ago (inside 180d) still chips');
}

{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Acute',
        lastIssueDate: '2026-03-10',
      },
    ],
    noInr
  );
  check(!chip, 'acute last issued 182 days ago (just outside 180d) does NOT chip');
}

console.log('\n--- fail-open / elsewhere ---');
{
  const chip = inrChip([{ name: 'Warfarin 3mg tablets', source: 'Acute' }], noInr);
  check(!!chip, 'acute with no lastIssueDate fails OPEN (still chips)');
}

{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Prescribed elsewhere',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!!chip, 'prescribed-elsewhere warfarin still chips (clinic dates are not on the GP record)');
}

{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Medications Prescribed Elsewhere',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!!chip, 'DOM heading "Medications Prescribed Elsewhere" counts as elsewhere');
}

{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        source: 'Acute Prescriptions (Last 12 months)',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!chip, 'DOM heading "Acute Prescriptions (Last 12 months)" is gated like Acute');
}

console.log('\n--- current repeat + stale acute of the same VTM: keep the repeat ---');
{
  const chip = inrChip(
    [
      {
        name: 'Warfarin 3mg tablets',
        vtm: 'Warfarin',
        source: 'Acute',
        lastIssueDate: '2025-12-15',
      },
      {
        name: 'Warfarin 3mg tablets',
        vtm: 'Warfarin',
        source: 'Repeat',
        lastIssueDate: '2025-12-15',
      },
    ],
    noInr
  );
  check(!!chip, 'stale acute + current repeat of the same VTM still chips (window runs before VTM dedup)');
}

console.log('\n--- helper + other rules unchanged ---');
{
  const staleAcute = { name: 'Warfarin 3mg', source: 'Acute', lastIssueDate: '2025-12-15' };
  check(
    engine.medMeetsIssueWindow(staleAcute, warfarinVka, NOW) === false,
    'medMeetsIssueWindow is false for Dec 2025 acute vs warfarin-vka'
  );
  check(
    engine.medMeetsIssueWindow(staleAcute, mtxRule, NOW) === true,
    'medMeetsIssueWindow is true when the rule has no issuedWithinDays'
  );
}

{
  const chips = engine.evaluatePatient(
    [
      {
        name: 'Methotrexate 10mg tablets',
        source: 'Acute',
        lastIssueDate: '2025-12-15',
      },
    ],
    [],
    [mtxRule],
    { now: NOW, problems: [] }
  );
  const chip = chips.find((c) => c.ruleId === 'methotrexate-maintenance');
  check(!!chip, 'methotrexate acute from Dec 2025 still chips (no issuedWithinDays on that rule)');
}

console.log('\n--- normaliser lastIssueDate (latest issue, not first-ever) ---');
{
  const raw = {
    acuteMedicationsLastTwelveMonths: [
      {
        description: 'Warfarin 3mg tablets',
        vtmProductName: 'Warfarin',
        medicationIssueHistory: {
          data: [
            { startDate: { year: '2025', month: '12', day: '15' }, endDate: { year: '2026', month: '01', day: '12' } },
            { startDate: { year: '2025', month: '09', day: '01' }, endDate: { year: '2025', month: '09', day: '29' } },
          ],
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(raw);
  check(meds.length === 1 && meds[0].source === 'Acute', 'acute bucket normalises as source Acute');
  check(meds[0].startDate === '2025-09-01', `startDate is earliest issue (got ${meds[0].startDate})`);
  check(meds[0].lastIssueDate === '2025-12-15', `lastIssueDate is latest issue (got ${meds[0].lastIssueDate})`);

  const history = normalisers.normaliseMedicationHistory({
    items: {
      Warfarin: {
        prescriptionIssues: [
          { issueDate: '2018-04-01', prescriptionStatus: 'discontinued' },
          { issueDate: '2025-12-15', prescriptionStatus: 'authorised' },
        ],
      },
    },
  });
  const withHistory = normalisers.normaliseMedications(raw, history);
  check(withHistory[0].startDate === '2018-04-01', 'medication-history still overwrites startDate to first-ever');
  check(
    withHistory[0].lastIssueDate === '2025-12-15',
    `lastIssueDate is NOT overwritten by first-ever history (got ${withHistory[0].lastIssueDate})`
  );

  const chip = inrChip(withHistory, noInr);
  check(!chip, 'normalised Dec 2025 acute does not raise INR after the window is applied');
}

{
  const rawRepeat = {
    currentRepeatPrescribingMedications: [
      {
        description: 'Warfarin 3mg tablets',
        medicationIssueHistory: {
          data: [{ startDate: { year: '2025', month: '12', day: '15' } }],
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(rawRepeat);
  check(meds[0].source === 'Repeat' && meds[0].lastIssueDate === '2025-12-15', 'repeat lastIssueDate parsed');
  check(!!inrChip(meds, noInr), 'normalised current-repeat warfarin still chips');
}

{
  const rawDisc = {
    discontinuedRepeatMedications: [
      {
        description: 'Warfarin 3mg tablets',
        medicationIssueHistory: {
          data: [{ startDate: { year: '2025', month: '12', day: '15' } }],
        },
      },
    ],
  };
  const meds = normalisers.normaliseMedications(rawDisc);
  check(meds.length === 0, 'discontinued repeats are still excluded from the medication list');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
