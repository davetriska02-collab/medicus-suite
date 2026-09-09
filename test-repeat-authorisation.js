// test-repeat-authorisation.js — repeat-prescribing authorisation classifier
// Run with: node test-repeat-authorisation.js
//
// Fixtures below are REAL medication-regimen items from 4 live HAR captures
// (2026-08-26, 2 patients + 2 further single-endpoint captures), each with a
// ground-truth authorisation type confirmed against Medicus's own UI by the
// developer. This is what makes the 'unclear' bucket's size an honest,
// evidenced number rather than a guess — see shared/repeat-authorisation.js
// for the full reasoning.
'use strict';

const {
  classifyAuthorisation,
  daysSupplyFor,
  describeForPill,
  classifyFromXOfY,
  daysSupplyFromDuration,
  daysSupplyFromTaskItem,
  describeForPillFromTaskItem,
  classifyFromAuthorisationMethod,
  describeForReauthorisationForm,
  doseUnitsPerDay,
  computedDaysSupply,
  computedGramDaysSupply,
  checkDaysSupply,
  daysSupplyOutliers,
  daysSuffix,
  formatDaysOutlierDelta,
  daysSupplyColourRoles,
} = require('./shared/repeat-authorisation.js');

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

function historyEntry(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-');
  const [ey, em, ed] = endDate.split('-');
  return {
    startDate: { year: sy, month: sm, day: sd },
    endDate: { year: ey, month: em, day: ed },
  };
}

// ── Confirmed FIXED (positive "N of M issued" evidence) ─────────────────────
console.log('\n--- confirmed fixed: "N of M issued" is detected and parsed ---');
{
  const r = classifyAuthorisation({ status: '4 of 6 issued 26 Aug 2026 - Supply ends 08 Sep 2026' });
  assert(r.verdict === 'fixed', 'Co-codamol 30mg/500mg (HAR 96b) -> fixed');
  assert(r.issuesUsed === 4 && r.issuesAuthorised === 6, 'parses issuesUsed=4, issuesAuthorised=6');
}
{
  const r = classifyAuthorisation({ status: '1 of 7 issued 11 Aug 2026 - Supply ends 08 Sep 2026' });
  assert(r.verdict === 'fixed', 'Amlodipine 10mg (HAR 96d) -> fixed');
  assert(r.issuesUsed === 1 && r.issuesAuthorised === 7, 'parses issuesUsed=1, issuesAuthorised=7');
}
{
  const r = classifyAuthorisation({ status: '1 of 3 issued 02 Oct 2023 - Supply ended unknown' });
  assert(r.verdict === 'fixed', 'Libra calf leg bag strap (HAR 96c) -> fixed even with "Supply ended unknown" tail');
}
{
  const r = classifyAuthorisation({ status: '2 of 6 issued 31 Jul 2026 - Supply ends 28 Aug 2026' });
  assert(r.verdict === 'fixed', 'Libra GB4 night drainage bag (HAR 96c) -> fixed');
}

// ── Confirmed UNTIL-REVIEW (genuinely 'unclear' by design — no positive
//    'review-date' verdict exists, see shared/repeat-authorisation.js) ──────
console.log("\n--- confirmed until-review: classified 'unclear' (no false 'fixed') ---");
[
  ['Apixaban 5mg (HAR 96)', 'Last issued 02 Jul 2026 - Supply ended 30 Jul 2026'],
  ['Atorvastatin 80mg (HAR 96)', 'Last issued 03 Oct 2025 - Supply ended 28 Nov 2025'],
  ['Levothyroxine 100mcg (HAR 96)', 'Last issued 05 Aug 2025 - Supply ended 02 Sep 2025'],
  ['Sertraline 50mg (HAR 96)', 'Last issued 28 Apr 2026 - Supply ended 26 May 2026'],
  ['Dapagliflozin 10mg (HAR 96b)', 'Supply ends 23 Sep 2026'],
  ['Sertraline 50mg (HAR 96d)', 'Supply ends 08 Sep 2026'],
].forEach(([label, status]) => {
  const r = classifyAuthorisation({ status });
  assert(r.verdict === 'unclear', `${label} -> unclear (never wrongly 'fixed')`);
});

// ── Confirmed FIXED-BUT-EXHAUSTED (also 'unclear' by design — this is the
//    known, accepted limitation: once N reaches M the status text is
//    indistinguishable from a genuine until-review item) ───────────────────
console.log("\n--- confirmed fixed-but-exhausted: also 'unclear' (documented limitation, not a bug) ---");
[
  ['Furosemide 20mg (HAR 96b, was "3 of 3")', 'Supply ends 22 Sep 2026'],
  ['Curion CuriFlush (HAR 96c)', 'Supply ended 09 Apr 2026'],
  ['Dermol 500 lotion (HAR 96c)', 'Supply ended 22 Jul 2026'],
  ['Atorvastatin 10mg (HAR 96d, was "4 of 4")', 'Supply ends 27 Aug 2026'],
  ['Co-codamol 8mg/500mg, empty history (HAR 96)', 'Supply ended 01 Sep 2025'],
  ['Omeprazole, never issued (HAR 96)', 'Authorised 28 Feb 2025 - Not yet issued'],
  ['GB Fix It strap, no EPS-synced history (HAR 96c)', 'Supply ended 05 Nov 2024'],
  ['Paracetamol, never issued (HAR 96c)', 'Authorised 11 Jul 2023 - Not yet issued'],
].forEach(([label, status]) => {
  const r = classifyAuthorisation({ status });
  assert(r.verdict === 'unclear', `${label} -> unclear`);
});

// ── Days supply — validated against real quantity/dose sanity checks ────────
console.log('\n--- days supply: derived from the latest issue-history entry ---');
{
  // Apixaban: 56 tablets, 1 tablet twice a day = 28 days. History confirms.
  const days = daysSupplyFor({
    medicationIssueHistory: {
      data: [historyEntry('2025-10-03', '2025-10-31'), historyEntry('2026-07-02', '2026-07-30')],
    },
  });
  assert(days === 28, 'Apixaban (HAR 96): latest entry 2026-07-02..2026-07-30 -> 28 days (picks latest, not first)');
}
{
  // Dapagliflozin: 28 tablets, 1 tablet once a day = 28 days.
  const days = daysSupplyFor({
    medicationIssueHistory: {
      data: [
        historyEntry('2026-06-10', '2026-07-08'),
        historyEntry('2026-07-07', '2026-08-04'),
        historyEntry('2026-08-05', '2026-09-02'),
        historyEntry('2026-08-26', '2026-09-23'),
      ],
    },
  });
  assert(days === 28, 'Dapagliflozin (HAR 96b): latest entry -> 28 days');
}
{
  const days = daysSupplyFor({ medicationIssueHistory: { data: [] } });
  assert(days === null, 'empty issue history -> null, not a guess');
}
{
  const days = daysSupplyFor({});
  assert(days === null, 'missing medicationIssueHistory entirely -> null');
}

// ── Pill text ────────────────────────────────────────────────────────────────
console.log('\n--- describeForPill: full pill text ---');
{
  const text = describeForPill({
    status: '4 of 6 issued 26 Aug 2026 - Supply ends 08 Sep 2026',
    quantityAndUnit: '100 tablet',
    medicationIssueHistory: { data: [historyEntry('2026-08-26', '2026-09-08')] },
  });
  assert(text === 'Fixed, 13 days', `fixed pill text exact match (no quantity — already on screen), got "${text}"`);
}
{
  const text = describeForPill({
    status: 'Supply ends 23 Sep 2026',
    quantityAndUnit: '28 tablet',
    medicationIssueHistory: { data: [historyEntry('2026-08-26', '2026-09-23')] },
  });
  assert(text === 'Unclear, 28 days', `unclear pill text exact match (no quantity), got "${text}"`);
}
{
  const text = describeForPill({ status: 'Authorised 28 Feb 2025 - Not yet issued', quantityAndUnit: '112 capsule' });
  assert(text === 'Unclear, days unknown', `no-history pill text exact match (no quantity), got "${text}"`);
}

// ── Task-overview shape (HAR 97, 2026-08-26): GET /tasks/data/
//    prescription-requests/overview/{taskUuid}, item.issueNumberAsXOfY,
//    same X<Y rule as the medication-regimen prose status but on a plain
//    "<N> of <M>" field with no trailing "issued" text ──────────────────────
console.log('\n--- classifyFromXOfY: task-overview shape ---');
{
  const r = classifyFromXOfY('4 of 6');
  assert(r.verdict === 'fixed' && r.issuesUsed === 4 && r.issuesAuthorised === 6, '"4 of 6" -> fixed, 4/6');
}
{
  // Confirmed live: BOTH Venlafaxine strengths are genuinely until-review,
  // yet show N===M here — same ambiguity as the exhausted-fixed case
  // elsewhere, just via a different field. Must stay 'unclear', never 'fixed'.
  const r = classifyFromXOfY('5 of 5');
  assert(r.verdict === 'unclear', 'Venlafaxine 37.5mg (HAR 97, genuinely until-review) "5 of 5" -> unclear, not fixed');
}
{
  const r = classifyFromXOfY('7 of 7');
  assert(r.verdict === 'unclear', 'Venlafaxine 75mg (HAR 97, genuinely until-review) "7 of 7" -> unclear, not fixed');
}
{
  // variable-repeat items (Naproxen, Omeprazole in the same capture) always
  // carry issueNumberAsXOfY: null — must never be misread as 'fixed'.
  const r = classifyFromXOfY(null);
  assert(r.verdict === 'unclear', 'null (variable-repeat item) -> unclear');
}

console.log('\n--- daysSupplyFromDuration: task-overview shape ---');
{
  assert(daysSupplyFromDuration('30 days supply') === 30, '"30 days supply" -> 30');
}
{
  assert(daysSupplyFromDuration('1 day supply') === 1, '"1 day supply" -> 1 (singular)');
}
{
  assert(daysSupplyFromDuration(null) === null, 'null duration -> null, not a guess');
}

console.log('\n--- describeForPillFromTaskItem: full pill text ---');
{
  // Real Venlafaxine 37.5mg item from HAR 97.
  const text = describeForPillFromTaskItem({
    product: 'Venlafaxine 37.5mg modified-release tablets',
    issueNumberAsXOfY: '5 of 5',
    fulfilledByPrescription: { displaySupplyDuration: '30 days supply' },
  });
  assert(text === 'Unclear, 30 days', `real Venlafaxine item -> unclear (correct — it IS until-review), got "${text}"`);
}
{
  const text = describeForPillFromTaskItem({
    product: 'Co-codamol 30mg/500mg effervescent tablets',
    issueNumberAsXOfY: '4 of 6',
    fulfilledByPrescription: { displaySupplyDuration: '13 days supply' },
  });
  assert(text === 'Fixed, 13 days', `fixed task item -> "Fixed, 13 days", got "${text}"`);
}
{
  // Real Atorvastatin item from HAR 113-non-routine-repeat-open.har
  // (2026-09-05) — a "Prescriptions for Reauthorisation" / "Repeat
  // Prescribing" item (prescriptionRequestItemsByType.
  // repeatPrescribingWithNoIssues.items[], a sibling section this pill
  // did not originally read at all). Every item here has no outstanding
  // issue left (hasOutstandingIssues: false), so issueNumberAsXOfY is
  // always null and fulfilledByPrescription is always null too — the
  // classifier correctly (if by construction, since N=M is guaranteed for
  // this whole bucket) lands 'unclear'. As of 2026-09-10 (Nick's own
  // request) this bucket NEVER has a reported figure to check against, so
  // rather than always saying "days unknown", the pill now shows the
  // computed estimate instead, clearly marked "~" and "(estimated from
  // dose)" so it's never mistaken for something Medicus itself reported.
  const text = describeForPillFromTaskItem({
    product: 'Atorvastatin 20mg tablets',
    issueNumberAsXOfY: null,
    quantityAndUnit: '56 tablet',
    dosageInstruction: 'Take 1 tablet once a day - oral',
    fulfilledByPrescription: null,
  });
  assert(
    text === 'Unclear, ~56 days (estimated from dose)',
    `real Atorvastatin "no issues left" item -> labelled estimate, got "${text}"`
  );
}
{
  // Real Evorel Conti item, HAR 116-HRT-patches.har (2026-09-09/10) — same
  // "no issues left" bucket as Atorvastatin above; 28 days confirmed
  // against Medicus's own dates elsewhere in this file.
  const text = describeForPillFromTaskItem({
    product: 'Evorel Conti patches (Theramex HQ UK Ltd)',
    issueNumberAsXOfY: null,
    quantityAndUnit: '8 patch',
    dosageInstruction:
      'ONE PATCH TO BE APPLIED TWICE A WEEK TO CLEAN, DRY HEALTHY SKIN AS SOON AS IT IS REMOVED FROM THE SCAHET FOR HRT',
    fulfilledByPrescription: null,
  });
  assert(
    text === 'Unclear, ~28 days (estimated from dose)',
    `real Evorel Conti "no issues left" item -> labelled estimate, got "${text}"`
  );
}

// ── Days-supply cross-check: doseUnitsPerDay ────────────────────────────────
// Real dosage instructions from the HAR captures — both confidently
// parseable ones (all validated: quantity ÷ this = the observed real
// days-supply) and the ones that MUST fail closed.
console.log('\n--- doseUnitsPerDay: confident cases (all real instructions) ---');
{
  assert(doseUnitsPerDay('Take 1 tablet twice a day - oral') === 2, 'Apixaban: "1 tablet twice a day" -> 2/day');
}
{
  assert(
    doseUnitsPerDay('Take 1 tablet once a day - oral') === 1,
    'Dapagliflozin/Furosemide: "1 tablet once a day" -> 1/day'
  );
}
{
  assert(doseUnitsPerDay('Take 1 tablet every morning - oral') === 1, '"every morning" -> 1/day');
}
{
  assert(doseUnitsPerDay('Take 2 capsules once a day') === 2, '"2 capsules once a day" -> 2/day');
}

console.log('\n--- doseUnitsPerDay: MUST fail closed (real instructions) ---');
{
  // THE critical case: a real drug on a real patient's repeat list, dosed
  // only on some days of a cycle. A naive parse would say 2x4=8/day; the
  // "during" disqualifier must stop that before it ever reaches a quantity
  // computation.
  const r = doseUnitsPerDay('2 tabs 4 times a day during menstruation');
  assert(r === null, 'Tranexamic acid "...during menstruation" -> null, NEVER 8/day');
}
{
  const r = doseUnitsPerDay('1-2 TABLETS UP TO FOUR TIMES DAILY');
  assert(r === null, 'Co-codamol "1-2 ... up to four times daily" -> null (range + cap, no interval to relax it)');
}
{
  // REVERSED 2026-09-10 (real HAR 119-co-codamol.har, Nick's own framing):
  // this used to assert null, on the theory that "Maximum dose" wording
  // always means genuinely variable/PRN use. Nick corrected that: "every 6
  // hours" is an unconditional, definite schedule (unlike "up to four
  // times daily" above, which has no interval and stays disqualified) —
  // the trailing "Maximum dose ... DAILY" just restates that same rate as
  // a BNF-style safety cap, and the practice explicitly permits patients
  // to use the full 4/day. Computing the worst-case (fastest exhaustion)
  // days-supply is the whole point — enforcing the reported 28-day figure
  // (which assumes half-rate use) would silently under-flag a patient who
  // legitimately uses what they were told they could.
  const r = doseUnitsPerDay('Take 1 tablet every 6 hours - oral - Maximum dose 4 doses DAILY');
  assert(
    r === 4,
    'Co-codamol "every 6 hours ... Maximum dose 4 doses DAILY" -> 4/day (interval wins over the cap wording)'
  );
  assert(
    computedDaysSupply('56 tablet', 'Take 1 tablet every 6 hours - oral - Maximum dose 4 doses DAILY') === 14,
    '56 tablets at the permitted maximum rate -> 14 days (worst case, not the reported 28)'
  );
}
{
  // End-to-end, real HAR 119-co-codamol.har shape: the reported figure (28
  // days, from Medicus's own "56 tablet (28 days supply)" issue text) is
  // now genuinely FLAGGED as a mismatch against the worst-case computed
  // figure (14 days) — this is the actual point of the relaxation, not a
  // side effect to tolerate: it surfaces exactly the "could run out twice
  // as fast as the reported figure assumes" signal Nick asked for, without
  // ever overriding or discarding the reported value itself.
  const item = {
    product: 'Co-codamol 8mg/500mg tablets',
    issueNumberAsXOfY: null,
    quantityAndUnit: '56 tablet',
    dosageInstruction: 'Take 1 tablet every 6 hours - oral - Maximum dose 4 doses DAILY',
    fulfilledByPrescription: { displaySupplyDuration: '28 days supply' },
  };
  const text = describeForPillFromTaskItem(item);
  assert(
    text === 'Unclear, 28 days, mismatch: qty/dose suggests 14 days',
    `Co-codamol task item -> reported 28 days flagged against the worst-case 14, got "${text}"`
  );
}
{
  const r = doseUnitsPerDay('Take 1 daily (total 112.5mg)');
  assert(r === null, 'Venlafaxine "Take 1 daily" (no tablet/capsule word) -> null, not assumed');
}
{
  assert(doseUnitsPerDay('') === null, 'empty string -> null');
  assert(doseUnitsPerDay(null) === null, 'null -> null');
}

// ── doseUnitsPerDay: weekly and day/hour-interval dosing (2026-09-09) ──────
// Real Evorel Conti instruction, HAR 116-HRT-patches.har — the case that
// motivated this extension. Verified against Medicus's OWN
// lastIssueDate/expectedEndDate on the same item (17 Jul -> 13 Aug 2026 =
// 28 days inclusive), not just the dose-text maths in isolation.
console.log('\n--- doseUnitsPerDay: weekly and interval dosing (HAR 116, generalised) ---');
{
  const evorelText =
    'ONE PATCH TO BE APPLIED TWICE A WEEK TO CLEAN, DRY HEALTHY SKIN AS SOON AS IT IS REMOVED FROM THE SCAHET FOR HRT';
  const perDay = doseUnitsPerDay(evorelText);
  assert(Math.abs(perDay - 2 / 7) < 1e-9, `Evorel Conti "TWICE A WEEK" -> 2/7 per day, got ${perDay}`);
  assert(
    computedDaysSupply('8 patch', evorelText) === 28,
    `Evorel Conti: 8 patches ÷ 2/7 per day -> 28 days, matches Medicus's own expectedEndDate`
  );
}
{
  // "ONE" spelled out, not a digit — confirmed live (HAR 116); other
  // word-numbers are deliberately not guessed, only "one".
  assert(doseUnitsPerDay('Apply one patch twice a week') !== null, '"one patch" (word, not digit) still parses');
  assert(doseUnitsPerDay('Take one tablet once a day') === 1, '"one tablet" (word) also works for the daily case');
}
{
  assert(doseUnitsPerDay('Take 1 tablet every 3 days') === 1 / 3, '"every 3 days" -> 1/3 per day');
}
{
  // Same underlying interval as "every 3 days", phrased in hours — both
  // must produce the identical rate.
  assert(
    doseUnitsPerDay('Take 1 tablet every 72 hours') === 1 / 3,
    '"every 72 hours" -> same 1/3 per day as "every 3 days"'
  );
}
{
  assert(
    doseUnitsPerDay('Take 1 tablet every other day') === 0.5,
    '"every other day" -> 1/2 per day, no longer a blanket disqualifier'
  );
}
{
  // A genuinely ambiguous/conditional weekly instruction must still be
  // disqualified by the OTHER guards (range, cap, PRN) — removing the old
  // blanket "weekly" disqualifier must not have widened the honest cases.
  assert(
    doseUnitsPerDay('Apply 1-2 patches up to twice a week') === null,
    'a genuinely ambiguous weekly instruction (range + cap) still fails closed'
  );
}

// ── Days-supply cross-check: computedDaysSupply (unit gate) ─────────────────
console.log('\n--- computedDaysSupply: unit gate (tablets/capsules/patches) ---');
{
  assert(
    computedDaysSupply('56 tablet', 'Take 1 tablet twice a day - oral') === 28,
    'Apixaban: 56 tablet / 2 per day -> 28'
  );
}
{
  assert(computedDaysSupply('8 patch', 'Apply one patch twice a week') === 28, '"8 patch" (singular, count 8) -> 28');
  assert(
    computedDaysSupply('8 patches', 'Apply one patch twice a week') === 28,
    '"8 patches" (plural form) parses identically'
  );
}
{
  assert(
    computedDaysSupply('28 tablet', 'Take 1 tablet once a day - oral') === 28,
    'Dapagliflozin: 28 tablet / 1 per day -> 28'
  );
}
{
  assert(
    computedDaysSupply('60 tablet', '2 tabs 4 times a day during menstruation') === null,
    'Tranexamic: dose disqualified -> null, no wrong 7.5-day guess'
  );
}
{
  // Liquids/creams/etc. deliberately excluded for now, even with an
  // otherwise-parseable-looking dose.
  assert(computedDaysSupply('100 ml', 'Take 5ml twice a day') === null, 'liquid (ml) -> null, explicitly out of scope');
  assert(computedDaysSupply('30 gram', 'Apply twice a day') === null, 'cream (gram) -> null, explicitly out of scope');
}

// ── Days-supply cross-check: checkDaysSupply + pill integration ─────────────
console.log('\n--- checkDaysSupply: agreement, disagreement, and null-when-uncertain ---');
{
  const r = checkDaysSupply(28, '56 tablet', 'Take 1 tablet twice a day - oral');
  assert(r.agrees === true, 'Apixaban: reported 28 matches computed 28 -> agrees');
}
{
  const r = checkDaysSupply(56, '60 tablet', '2 tabs 4 times a day during menstruation');
  assert(r.agrees === null, 'Tranexamic: reported 56 vs unparseable dose -> null (never a false mismatch)');
}
{
  // A genuine data-entry mismatch: someone recorded 30 days supply for a
  // pack that, on a simple twice-daily dose, only covers 28.
  const r = checkDaysSupply(30, '56 tablet', 'Take 1 tablet twice a day - oral');
  assert(r.agrees === false && r.computedDays === 28, 'fabricated mismatch: reported 30 vs computed 28 -> flagged');
}
{
  // Changed 2026-09-10 (Nick's own request): computedDays is now populated
  // here too, not just agrees:null — daysClause needs it to offer a
  // labelled estimate for items (like Evorel Conti) that never have a
  // reported figure at all. agrees itself is still correctly null — there
  // is genuinely nothing to agree or disagree with.
  const r = checkDaysSupply(null, '56 tablet', 'Take 1 tablet twice a day - oral');
  assert(r.agrees === null, 'no reported days at all -> agrees stays null, nothing to compare');
  assert(r.computedDays === 28, 'but computedDays is now populated (56 tablet / 2 per day -> 28), not null');
}
{
  const r = checkDaysSupply(null, '60 tablet', '2 tabs 4 times a day during menstruation');
  assert(
    r.agrees === null && r.computedDays === null,
    'no reported days AND an unparseable dose -> both stay null, no estimate offered either'
  );
}

console.log('\n--- pill text: mismatch suffix only appears on a genuine disagreement ---');
{
  // Real Apixaban data — reported and computed agree, no suffix.
  const text = describeForPill({
    status: 'Last issued 02 Jul 2026 - Supply ended 30 Jul 2026',
    quantityAndUnit: '56 tablet',
    dosageInstructions: 'Take 1 tablet twice a day - oral',
    medicationIssueHistory: { data: [historyEntry('2025-10-03', '2025-10-31')] },
  });
  assert(text === 'Unclear, 28 days', `agreement -> no mismatch suffix, got "${text}"`);
}
{
  // Same Apixaban dates, but quantity doctored to 60 (would compute 30, not
  // 28) — this is the case that SHOULD be flagged.
  const text = describeForPill({
    status: 'Last issued 02 Jul 2026 - Supply ended 30 Jul 2026',
    quantityAndUnit: '60 tablet',
    dosageInstructions: 'Take 1 tablet twice a day - oral',
    medicationIssueHistory: { data: [historyEntry('2025-10-03', '2025-10-31')] },
  });
  assert(
    text === 'Unclear, 28 days, mismatch: qty/dose suggests 30 days',
    `genuine mismatch -> flagged in pill text, got "${text}"`
  );
}
{
  // Real Tranexamic acid data (from the live screenshot, 2026-08-26):
  // "60 tablet - 1 of 4 issued 05 May 2026 - Supply ended 30 Jun 2026",
  // reported 56 days, dose disqualified by "during menstruation". Must NOT
  // show a mismatch suffix.
  const text = describeForPill({
    status: '1 of 4 issued 05 May 2026 - Supply ended 30 Jun 2026',
    quantityAndUnit: '60 tablet',
    dosageInstructions: '2 tabs 4 times a day during menstruation',
    medicationIssueHistory: { data: [historyEntry('2026-05-05', '2026-06-30')] },
  });
  assert(text === 'Fixed, 56 days', `Tranexamic acid pill text unchanged from live-confirmed value, got "${text}"`);
  assert(!text.includes('mismatch'), `Tranexamic acid (cyclical dosing) -> no false mismatch, got "${text}"`);
}

console.log('\n--- pill text: labelled estimate when no reported figure exists at all (2026-09-10) ---');
{
  // No medicationIssueHistory at all (never issued) — but dose text IS
  // computable. Must show the estimate, not "days unknown".
  const text = describeForPill({
    status: 'Authorised 28 Feb 2025 - Not yet issued',
    quantityAndUnit: '56 tablet',
    dosageInstructions: 'Take 1 tablet twice a day - oral',
  });
  assert(
    text === 'Unclear, ~28 days (estimated from dose)',
    `describeForPill: no reported figure but a computable dose -> labelled estimate, got "${text}"`
  );
}
{
  // Same shape, but the dose text is genuinely unparseable — must still
  // fall back to "days unknown", never invent a number.
  const text = describeForPill({
    status: 'Authorised 28 Feb 2025 - Not yet issued',
    quantityAndUnit: '56 tablet',
    dosageInstructions: '1-2 tablets as needed',
  });
  assert(
    text === 'Unclear, days unknown',
    `describeForPill: no reported figure AND no computable dose -> still "days unknown", got "${text}"`
  );
}
{
  // A reported figure DOES exist and agrees with the computed one — must
  // show the plain reported figure, never the "~...estimated" wording
  // (that phrasing is reserved for the no-reported-figure case only).
  const text = describeForPill({
    status: 'Last issued 02 Jul 2026 - Supply ended 30 Jul 2026',
    quantityAndUnit: '56 tablet',
    dosageInstructions: 'Take 1 tablet twice a day - oral',
    medicationIssueHistory: { data: [historyEntry('2025-10-03', '2025-10-31')] },
  });
  assert(!text.includes('estimated'), `a real reported figure exists -> never shown as an "estimate", got "${text}"`);
}

// ── Content-script source pins: which prescriptionRequestItemsByType ───────
// sections get pilled ─────────────────────────────────────────────────────
// content-scripts/repeat-prescribing-pills.js isn't require()-able (a DOM/
// fetch-driven IIFE), so these are source-level checks — confirming the fix
// for a real gap Nick found live 2026-09-05 (Atorvastatin, a "Prescriptions
// for Reauthorisation" item, had no pill) doesn't silently regress, and that
// repeatDispensing/variableRepeat stay correctly out of scope.
console.log('\n--- content-script reads both in-scope sections, never the out-of-scope ones ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'repeat-prescribing-pills.js'), 'utf8');
  const fn = src.slice(
    src.indexOf('async function loadTaskOverviewItems'),
    src.indexOf('async function loadMedicationTabItems')
  );
  assert(
    /byType\.repeatWithAnAuthorisedIssue/.test(fn),
    'reads repeatWithAnAuthorisedIssue (an issue is currently outstanding)'
  );
  assert(
    /byType\.repeatPrescribingWithNoIssues/.test(fn),
    'reads repeatPrescribingWithNoIssues (no issue outstanding — "Prescriptions for Reauthorisation")'
  );
  assert(!/byType\.repeatDispensing/.test(fn), 'never reads repeatDispensing — out of scope per the original ask');
  assert(!/byType\.variableRepeat/.test(fn), 'never reads variableRepeat — a third, unrelated category');
  assert(/ra\.daysSupplyOutliers/.test(fn), 'wires in the cross-item outlier check');
  assert(
    /ra\.formatDaysOutlierDelta/.test(fn),
    'a flagged item gets its delta clause from the shared formatter, not built inline'
  );
  assert(
    /m\.deltaText\s*=/.test(fn) && !/m\.text\s*\+=/.test(fn),
    'the delta is kept as its own field, never appended into the plain pill text'
  );
}

console.log('\n--- content-script: pill colour, majority green / distinct outliers / no verdict ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'repeat-prescribing-pills.js'), 'utf8');
  const buildPillFn = src.slice(src.indexOf('function buildPill'), src.indexOf('function buildPill') + 1500);
  assert(!/verdict === 'fixed' \? '#/.test(src), 'the old verdict-keyed colour choice is gone');
  assert(
    /PILL_COLOUR_UNKNOWN/.test(src) && /days == null\) return PILL_COLOUR_UNKNOWN/.test(src),
    '"days unknown" gets its own neutral colour, never grouped with a real interval'
  );
  assert(
    /color:#ff6b6b/.test(buildPillFn) && /text-decoration:underline/.test(buildPillFn),
    'the outlier delta clause is both red AND underlined — never colour as the only signal'
  );
  assert(
    /buildPill\(text, colour, deltaText\)/.test(src),
    'buildPill takes an already-resolved colour, not a raw days value — the caller decides which scheme applies'
  );
  assert(
    /function colourForRole/.test(src) && /PILL_COLOUR_MAJORITY/.test(src) && /OUTLIER_PALETTE/.test(src),
    'a separate majority/outlier colour scheme exists alongside the plain per-interval fallback'
  );
  {
    const majorityHex = (/PILL_COLOUR_MAJORITY = '(#[0-9a-f]+)'/i.exec(src) || [])[1];
    const unknownHex = (/PILL_COLOUR_UNKNOWN = '(#[0-9a-f]+)'/i.exec(src) || [])[1];
    const outlierHexes = ((/OUTLIER_PALETTE = \[([^\]]+)\]/.exec(src) || [])[1] || '').match(/#[0-9a-f]+/gi) || [];
    assert(
      !!majorityHex && !!unknownHex && outlierHexes.length > 0,
      'the three colour sources are all found in source'
    );
    assert(
      !outlierHexes.includes(majorityHex) && !outlierHexes.includes(unknownHex),
      'the outlier palette is disjoint from the majority green and the unknown grey'
    );
  }
  assert(
    /ra\.daysSupplyColourRoles/.test(src),
    'loadTaskOverviewItems resolves colour roles via the shared, unit-tested function, not ad hoc logic'
  );
  const medTabFn = src.slice(
    src.indexOf('async function loadMedicationTabItems'),
    src.indexOf('async function loadItems')
  );
  assert(
    /colourForDays\(days\)/.test(medTabFn) && !/daysSupplyColourRoles/.test(medTabFn),
    'the Medication tab always uses the plain per-interval colour — no sibling items to establish a majority against'
  );
}

// ── daysSupplyOutliers: cross-item, same-task outlier check ───────────────
// Nick's own request (2026-09-08): "wait until all intervals have been
// calculated, then look at all intervals and flag where one is different."
// Deliberately requires a genuine, unambiguous majority — see the function's
// own header comment in shared/repeat-authorisation.js for why each of
// these fail-closed rules exists.
console.log('\n--- daysSupplyOutliers: cross-item, same-task check ---');
{
  const two = daysSupplyOutliers([28, 56]);
  assert(
    two.outliers.every((f) => f === false) && two.majorityDays === null,
    'only 2 known values, disagreeing -> no majority to assert, nothing flagged'
  );
}
{
  const threeWaySplit = daysSupplyOutliers([28, 56, 84]);
  assert(
    threeWaySplit.outliers.every((f) => f === false) && threeWaySplit.majorityDays === null,
    'three different values, no repeats at all -> a 3-way tie, nothing flagged'
  );
}
{
  const clear = daysSupplyOutliers([28, 28, 56]);
  assert(
    clear.outliers[0] === false && clear.outliers[1] === false && clear.outliers[2] === true,
    'clear 2-vs-1 majority -> only the lone 56 is flagged'
  );
  assert(clear.majorityDays === 28, 'majorityDays reports the actual majority value (28)');
}
{
  const largerMajority = daysSupplyOutliers([28, 56, 56, 56]);
  assert(
    largerMajority.outliers[0] === true && largerMajority.outliers.slice(1).every((f) => f === false),
    '3-vs-1 majority -> only the lone 28 is flagged'
  );
  assert(largerMajority.majorityDays === 56, 'majorityDays reports 56, not the minority value');
}
{
  const withUnknown = daysSupplyOutliers([28, 28, null, 56]);
  assert(
    withUnknown.outliers[0] === false && withUnknown.outliers[1] === false,
    'the two agreeing items are never flagged'
  );
  assert(
    withUnknown.outliers[2] === false,
    '"days unknown" (null) is never itself flagged — nothing confirmed to disagree with'
  );
  assert(withUnknown.outliers[3] === true, 'the genuine 56 outlier is still flagged even with a null in the list');
}
{
  const allAgree = daysSupplyOutliers([28, 28, 28]);
  assert(
    allAgree.outliers.every((f) => f === false),
    'all items agree -> nothing flagged'
  );
}
{
  const tiedGroups = daysSupplyOutliers([28, 28, 56, 56]);
  assert(
    tiedGroups.outliers.every((f) => f === false) && tiedGroups.majorityDays === null,
    'two evenly-sized groups (2 vs 2) -> a tie, no single majority, nothing flagged'
  );
}
{
  const allUnknown = daysSupplyOutliers([null, null, null]);
  assert(
    allUnknown.outliers.every((f) => f === false),
    'all-unknown list -> nothing to compare, nothing flagged'
  );
}
assert(daysSuffix(1) === '1 day', 'daysSuffix singular is exported and correct');
assert(daysSuffix(28) === '28 days', 'daysSuffix plural is exported and correct');
assert(
  formatDaysOutlierDelta(28, 30) === '-2 vs majority at 30 days',
  `negative delta prints its own sign, got "${formatDaysOutlierDelta(28, 30)}"`
);
assert(
  formatDaysOutlierDelta(32, 30) === '+2 vs majority at 30 days',
  `positive delta gets an explicit "+", got "${formatDaysOutlierDelta(32, 30)}"`
);
assert(
  formatDaysOutlierDelta(1, 30) === '-29 vs majority at 30 days',
  `larger negative delta, got "${formatDaysOutlierDelta(1, 30)}"`
);

console.log('\n--- daysSupplyColourRoles: majority green, distinct outliers distinct roles ---');
{
  const days = [28, 28, 56];
  const roles = daysSupplyColourRoles(days, daysSupplyOutliers(days));
  assert(
    roles[0] === 'majority' && roles[1] === 'majority',
    `both majority items get the 'majority' role, got ${JSON.stringify(roles)}`
  );
  assert(roles[2] === 'outlier:56', `the lone outlier is keyed by its OWN days value, got "${roles[2]}"`);
}
{
  // Two DIFFERENT outlier values must get two DIFFERENT roles, not lumped
  // together just because they're both "not the majority".
  const days = [28, 28, 28, 56, 84];
  const roles = daysSupplyColourRoles(days, daysSupplyOutliers(days));
  assert(
    roles[3] === 'outlier:56' && roles[4] === 'outlier:84',
    `two different outlier values get two different roles, got ${JSON.stringify([roles[3], roles[4]])}`
  );
  assert(roles[3] !== roles[4], 'the two distinct outlier roles are not equal to each other');
}
{
  const days = [28, 28, null, 56];
  const roles = daysSupplyColourRoles(days, daysSupplyOutliers(days));
  assert(roles[2] === 'unknown', '"days unknown" always gets the unknown role, regardless of majority/outlier');
}
{
  // No established majority at all (a tie, or <3 known) -> nothing to
  // single out; every role is null so the caller falls back to something
  // else rather than painting a false "majority".
  const days = [28, 56];
  const roles = daysSupplyColourRoles(days, daysSupplyOutliers(days));
  assert(
    roles.every((r) => r === null),
    `no majority established -> every role is null, got ${JSON.stringify(roles)}`
  );
}

// ── daysSupplyFromTaskItem: the extracted per-item helper ──────────────────
console.log('\n--- daysSupplyFromTaskItem matches what the pill text embeds ---');
{
  const issued = { fulfilledByPrescription: { displaySupplyDuration: '28 days supply' } };
  assert(daysSupplyFromTaskItem(issued) === 28, 'reads the reported figure when fulfilledByPrescription is populated');
  const neverIssued = { fulfilledByPrescription: null };
  assert(
    daysSupplyFromTaskItem(neverIssued) === null,
    'null fulfilledByPrescription (never issued) -> null, not a guess'
  );
}

// ── computedGramDaysSupply / gel-cream cross-check ──────────────────────────
// Fixtures use the real rules/hrt-gram-dose-factors.json file (loaded the
// same way the content script does), not a hand-rolled test fixture — so a
// change to that data file's own numbers is caught here too.
console.log('\n--- computedGramDaysSupply: gram-issued gel/cream, product-specific factor ---');
const gelDoseFactors = require('./rules/hrt-gram-dose-factors.json').products;
{
  // Real item from HAR 117-HRT-gel.har: Estradiol 0.06% gel (Oestrogel),
  // "400 gram" issued, "3 PUMPS DAILY". 1.25g/pump (rules file) -> 320
  // pumps issued -> 320/3 = 106.67 -> 107 days.
  const days = computedGramDaysSupply(
    '400 gram',
    '3 PUMPS DAILY',
    'Estradiol 0.06% transdermal gel (750microgram per actuation)',
    gelDoseFactors
  );
  assert(days === 107, `Oestrogel "400 gram" / "3 PUMPS DAILY" -> 107 days, got ${days}`);
}
{
  const days = computedGramDaysSupply('88 gram', '2 pumps daily', 'Testogel 16.2mg/g gel', gelDoseFactors);
  assert(
    days === 35,
    `Testogel "88 gram" / "2 pumps daily" -> 35 days (matches the spreadsheet's own D4), got ${days}`
  );
}
{
  const days = computedGramDaysSupply(
    '30 gram',
    '1 application twice a week',
    'Estriol 0.01% vaginal cream',
    gelDoseFactors
  );
  assert(days === 210, `Estriol cream "30 gram" / "1 application twice a week" -> 210 days, got ${days}`);
}
{
  // Nick's request 2026-09-09: "Estriol 1mg/g vaginal cream with
  // applicator", same 15g/30-dose model as the "0.01%" entry above but a
  // SEPARATE rules-file entry (different match text) — a single 15g tube
  // on a twice-weekly maintenance dose should last 105 days per his own
  // spreadsheet calculator.
  const days = computedGramDaysSupply(
    '15 gram',
    '1 application twice a week',
    'Estriol 1mg/g vaginal cream with applicator',
    gelDoseFactors
  );
  assert(
    days === 105,
    `Estriol 1mg/g cream with applicator "15 gram" / "1 application twice a week" -> 105 days, got ${days}`
  );
}
{
  // Real item from HAR 118-oestrogen-gel.har: the actual dosageInstruction
  // Medicus stores for this product is "TWICE WEEKLY LONG TERM" — no
  // "application"/"pump" word at all, unlike every other gel/cream example
  // seen so far. Nick reported this one wasn't producing a pill at all;
  // gelDosesPerDay's deliberate "assume 1 dose per use when no count word
  // is given" rule (2026-09-10) is what makes this resolve.
  const days = computedGramDaysSupply(
    '15 gram',
    'TWICE WEEKLY LONG TERM',
    'Estriol 1mg/g vaginal cream with applicator',
    gelDoseFactors
  );
  assert(
    days === 105,
    `Estriol 1mg/g cream "15 gram" / "TWICE WEEKLY LONG TERM" (no unit word) -> 105 days, got ${days}`
  );
}
{
  // The same "assume 1" default must still respect an EXPLICIT count when
  // one is given — "2 applications twice weekly" must not silently ignore
  // the "2" and fall back to 1.
  const days = computedGramDaysSupply(
    '15 gram',
    '2 applications twice weekly',
    'Estriol 1mg/g vaginal cream with applicator',
    gelDoseFactors
  );
  assert(days === 53, `explicit "2 applications" is still honoured over the default of 1, got ${days}`);
}
{
  const days = computedGramDaysSupply('400 gram', '3 pumps daily', 'Some unlisted gel', gelDoseFactors);
  assert(days === null, 'a gram-issued product with no matching factor entry -> null, never guessed');
}
{
  const days = computedGramDaysSupply('400 gram', '3 pumps daily', 'Oestrogel', []);
  assert(days === null, 'no gelDoseFactors supplied at all -> null (backward compatible, matches every old caller)');
}
{
  const days = computedGramDaysSupply('400 gram', '3 pumps as needed', 'Estradiol 0.06% gel', gelDoseFactors);
  assert(days === null, 'PRN wording disqualifies the gram path exactly like the discrete-unit path');
}
{
  // A tablet-quantity item must never fall into the gel path even when a
  // gelDoseFactors table is supplied — the two unit shapes are mutually
  // exclusive by construction (computedDaysSupply routes on quantity unit).
  const days = computedDaysSupply('56 tablets', '2 tablets twice a day', 'Estradiol 0.06% gel', gelDoseFactors);
  assert(days === 14, 'a discrete tablet quantity still uses the discrete path even with gelDoseFactors passed');
}
{
  // computedDaysSupply itself (not computedGramDaysSupply directly) also
  // reaches the gram path when the discrete pattern doesn't match.
  const days = computedDaysSupply(
    '400 gram',
    '3 PUMPS DAILY',
    'Estradiol 0.06% transdermal gel (750microgram per actuation)',
    gelDoseFactors
  );
  assert(days === 107, `computedDaysSupply falls through to the gram path -> 107 days, got ${days}`);
}
{
  // Bare "daily" (no "once"/"twice" qualifier) — added 2026-09-09,
  // confirmed live (HAR 117-HRT-gel.har "3 PUMPS DAILY"). Also exercised
  // via the ordinary tablet path so it's clear this is a shared frequency
  // fix, not something gel-specific.
  assert(
    doseUnitsPerDay('3 tablets daily') === 3,
    'bare "daily" (no once/twice) -> 1x/day, so "3 tablets daily" = 3/day'
  );
}

// ── Implied-unit word-number count (no unit word at all) ────────────────────
console.log('\n--- doseUnitsPerDay/computedDaysSupply: implied unit, bare "weekly" ---');
{
  // Real dosage text for Folic acid 5mg tablets: "Take two (10mg) weekly
  // asd" — no "tablet"/"tablets" word anywhere (the "(10mg)" is just the
  // total-strength annotation, 2 x 5mg), and a trailing typo ("asd") that
  // must not interfere either. "two" is a word-number tablet count, never
  // previously recognised without a unit word attached; "weekly" alone
  // (no "once"/"twice") is the once-a-week frequency.
  const perDay = doseUnitsPerDay('Take two (10mg) weekly asd');
  assert(
    Math.abs(perDay - 2 / 7) < 1e-9,
    `"Take two (10mg) weekly asd" -> 2/7 per day (2 tablets, once weekly), got ${perDay}`
  );
}
{
  const days = computedDaysSupply('28 tablet', 'Take two (10mg) weekly asd');
  assert(days === 98, `Folic acid "28 tablet" / "Take two (10mg) weekly asd" -> 98 days (28 * 7/2), got ${days}`);
}
{
  // The unit-word-present case must still take priority over the implied
  // fallback — never silently prefer the weaker inference when the
  // stronger, explicit match is available.
  const perDay = doseUnitsPerDay('2 tablets weekly');
  assert(perDay === 2 / 7, `explicit "2 tablets weekly" still resolves via the normal path, got ${perDay}`);
}
{
  // If the unit word DOES appear anywhere in the text, the implied-count
  // fallback must never kick in even for an unrelated "take two" phrase —
  // guards against silently overriding a case that should have matched
  // (or correctly failed) via the explicit path instead.
  const perDay = doseUnitsPerDay('take two tablets as needed');
  assert(perDay === null, 'PRN wording still disqualifies even with "take two" present, no false implied-count guess');
}
{
  // Only "one"/"two" are recognised — no speculative extension to
  // "three"/"four" etc. without real evidence.
  const perDay = doseUnitsPerDay('Take three (15mg) weekly');
  assert(perDay === null, 'unrecognised word-number ("three") with no unit word -> null, not guessed');
}

// ── Inhalers: dose-issued quantity, "puff" dosage wording ───────────────────
console.log('\n--- computedDaysSupply: inhalers, quantityAndUnit in "dose", dosageInstruction in "puffs" ---');
{
  // Confident preventer-inhaler-style instruction: fixed count, fixed
  // frequency, no PRN/range/cap wording.
  const days = computedDaysSupply('200 dose', '2 puffs twice a day');
  assert(days === 50, `"200 dose" / "2 puffs twice a day" -> 50 days (1 puff = 1 dose), got ${days}`);
}
{
  assert(
    doseUnitsPerDay('one puff twice daily') === 2,
    '"one puff" (word) also works for inhalers, same as tablets/patches'
  );
}
{
  // Real reliever-inhaler instruction Nick gave — deliberately variable
  // dosing (a RANGE of puffs, "up to" a cap, PRN wording all three at
  // once) — must still return null, never a guessed number.
  const days = computedDaysSupply('200 dose', '1 TO 2 PUFFS UP TO FOUR TIMES DAILY AS REQUIRED');
  assert(
    days === null,
    'range + "up to" + "as required" all disqualify -> null, never a guessed reliever-inhaler figure'
  );
}
{
  // The word-form range ("1 TO 2") alone, isolated from "up to"/"as
  // required", must ALSO disqualify on its own — same discipline as the
  // existing numeric-hyphen range disqualifier ("1-2").
  const perDay = doseUnitsPerDay('take 1 to 2 tablets twice a day');
  assert(perDay === null, 'a word-form range ("1 to 2") disqualifies on its own, same as "1-2"');
}
{
  // The existing numeric-hyphen range disqualifier must still work
  // unchanged alongside the new word-form one.
  const perDay = doseUnitsPerDay('take 1-2 tablets twice a day');
  assert(perDay === null, 'the pre-existing numeric-hyphen range disqualifier ("1-2") is unaffected');
}

console.log('\n--- describeForPillFromTaskItem: inhaler item end to end ---');
{
  const item = {
    product: 'Beclometasone 100micrograms/dose inhaler',
    issueNumberAsXOfY: null,
    quantityAndUnit: '200 dose',
    dosageInstruction: '2 PUFFS TWICE A DAY',
    fulfilledByPrescription: null,
  };
  const text = describeForPillFromTaskItem(item);
  assert(
    text === 'Unclear, ~50 days (estimated from dose)',
    `preventer inhaler task item -> "Unclear, ~50 days (estimated from dose)", got "${text}"`
  );
}
{
  const item = {
    product: 'Salbutamol 100micrograms/dose inhaler',
    issueNumberAsXOfY: null,
    quantityAndUnit: '200 dose',
    dosageInstruction: '1 TO 2 PUFFS UP TO FOUR TIMES DAILY AS REQUIRED',
    fulfilledByPrescription: null,
  };
  const text = describeForPillFromTaskItem(item);
  assert(
    text === 'Unclear, days unknown',
    `reliever inhaler (PRN/range) task item -> "Unclear, days unknown" (never a guess), got "${text}"`
  );
}

console.log('\n--- describeForPillFromTaskItem: gel item end to end (real HAR shape) ---');
{
  // fulfilledByPrescription: null (this bucket never has a reported figure
  // to check the estimate against — see daysSupplyFromTaskItem's own
  // comment), so this must land as a labelled "~N days (estimated from
  // dose)" via the gram path, never a bare "days unknown".
  const item = {
    product: 'Estradiol 0.06% transdermal gel (750microgram per actuation)',
    issueNumberAsXOfY: null,
    quantityAndUnit: '400 gram',
    dosageInstruction: '3 PUMPS DAILY',
    fulfilledByPrescription: null,
  };
  const text = describeForPillFromTaskItem(item, gelDoseFactors);
  assert(
    text === 'Unclear, ~107 days (estimated from dose)',
    `Oestrogel task item -> "Unclear, ~107 days (estimated from dose)", got "${text}"`
  );
}
{
  // Same item, but called WITHOUT gelDoseFactors (as every pre-existing
  // caller in this test file still does) -> falls back to "days unknown",
  // proving the new parameter is additive, not a behaviour change for
  // anyone who doesn't pass it.
  const item = {
    product: 'Estradiol 0.06% transdermal gel (750microgram per actuation)',
    issueNumberAsXOfY: null,
    quantityAndUnit: '400 gram',
    dosageInstruction: '3 PUMPS DAILY',
    fulfilledByPrescription: null,
  };
  const text = describeForPillFromTaskItem(item);
  assert(
    text === 'Unclear, days unknown',
    `same item with no gelDoseFactors argument -> unchanged "days unknown" fallback, got "${text}"`
  );
}
{
  // Real item from HAR 118-oestrogen-gel.har, verbatim shape (repeatPrescribingWithNoIssues):
  // this is the exact item Nick reported as "not working" — no unit word in
  // dosageInstruction at all ("TWICE WEEKLY LONG TERM").
  const item = {
    id: '01a071ce-6e97-73b5-b1f8-6fa6c160e96d',
    prescriptionType: 'repeat',
    hasOutstandingIssues: false,
    issueNumberAsXOfY: null,
    quantityAndUnit: '15 gram',
    product: 'Estriol 1mg/g vaginal cream with applicator',
    fulfilledByPrescription: null,
    dosageInstruction: 'TWICE WEEKLY LONG TERM',
    lastIssueNumberAsXOfY: '1 of 1',
  };
  const text = describeForPillFromTaskItem(item, gelDoseFactors);
  assert(
    text === 'Unclear, ~105 days (estimated from dose)',
    `Estriol cream task item (HAR 118) -> "Unclear, ~105 days (estimated from dose)", got "${text}"`
  );
}

// ── Reauthorisation-form shape (real HAR 120/121-reauthorise*.har) ─────────
console.log('\n--- classifyFromAuthorisationMethod: DIRECT enum, not inferred ---');
{
  const r = classifyFromAuthorisationMethod('review-date');
  assert(r.verdict === 'review-date', '"review-date" -> a genuine positive verdict, never "unclear" here');
}
{
  const r = classifyFromAuthorisationMethod('fixed-number-of-issues');
  assert(r.verdict === 'fixed', '"fixed-number-of-issues" -> fixed');
}
{
  const r = classifyFromAuthorisationMethod(null);
  assert(r.verdict === 'unclear', 'missing/unrecognised value -> unclear, fails closed');
}

console.log('\n--- describeForReauthorisationForm: real HAR 120/121 fixtures ---');
{
  // HAR 120-reauthorise.har, GET /clinical/data/prescription/re-authorise/{id}
  // as first opened: Apixaban 5mg tablets, genuinely until-review
  // (authorisationMethod: "review-date" is a DIRECT field here, not
  // inferred), 56 tablets, "Take 1 tablet twice a day - oral",
  // expectedDaysSupply 28 — self-consistent, no mismatch.
  const prescription = {
    productName: 'Apixaban 5mg tablets',
    authorisationMethod: 'review-date',
    expectedDaysSupply: 28,
    issueQuantity: { value: 56, snomedCtCode: { conceptId: '428673006', description: 'tablet' } },
    dosageInstruction: { dosageText: 'Take 1 tablet twice a day - oral' },
  };
  const text = describeForReauthorisationForm(prescription);
  assert(text === 'Until review date, 28 days', `HAR 120 initial state -> "Until review date, 28 days", got "${text}"`);
}
{
  // HAR 121-reauthorise2.har: Nick edited "Expected days supply" from 28
  // to 30 WITHOUT updating the 56-tablet issueQuantity (a string once
  // form-edited, unlike the number it starts as on first load — must
  // still coerce correctly). The quantity÷dose cross-check WAS removed
  // 2026-09-10, then RESTORED the same day (see describeForReauthorisationForm's
  // own comment) — this is exactly the mismatch it's meant to catch.
  const prescription = {
    productName: 'Apixaban 5mg tablets',
    authorisationMethod: 'review-date',
    expectedDaysSupply: '30',
    issueQuantity: { value: 56, snomedCtCode: { conceptId: '428673006', description: 'tablet' } },
    dosageInstruction: { dosageText: 'Take 1 tablet twice a day - oral' },
  };
  const text = describeForReauthorisationForm(prescription);
  assert(
    text === 'Until review date, 30 days, mismatch: qty/dose suggests 28 days',
    `HAR 121 edited (mismatch) -> flagged, got "${text}"`
  );
}
{
  // Real live counter-example, 2026-09-11, that proved the 2026-09-10
  // removal wrong: Estradiol 0.06% gel, dosed "3 pumps daily" as FREE
  // TEXT (not a structured dose/frequency picklist) — Medicus has no
  // mechanism to self-correct "Expected days supply" for free-text dosage
  // at all, so the reported 84 sat wrong and uncaught. The extension's own
  // computedGramDaysSupply independently derives the correct 64 (240g /
  // 1.25g per pump / 3 pumps/day, rules/hrt-gram-dose-factors.json).
  const gelDoseFactorsFixture = require('./rules/hrt-gram-dose-factors.json').products;
  const prescription = {
    productName: 'Estradiol 0.06% transdermal gel (750microgram per actuation)',
    authorisationMethod: 'review-date',
    expectedDaysSupply: 84,
    issueQuantity: { value: 240, snomedCtCode: { description: 'gram' } },
    dosageInstruction: { dosageText: '3 pumps daily', useManualDosageText: true },
  };
  const text = describeForReauthorisationForm(prescription, gelDoseFactorsFixture);
  assert(
    text === 'Until review date, 84 days, mismatch: qty/dose suggests 64 days',
    `HRT gel free-text dosage, wrong reported 84 days -> flagged against computed 64, got "${text}"`
  );
}
{
  const prescription = {
    productName: 'Apixaban 5mg tablets',
    authorisationMethod: 'fixed-number-of-issues',
    expectedDaysSupply: 28,
    issueQuantity: { value: 56, snomedCtCode: { conceptId: '428673006', description: 'tablet' } },
    dosageInstruction: { dosageText: 'Take 1 tablet twice a day - oral' },
  };
  const text = describeForReauthorisationForm(prescription);
  assert(text === 'Fixed, 28 days', `authorisationMethod "fixed-number-of-issues" -> "Fixed, 28 days", got "${text}"`);
}
{
  // No authorisationMethod at all -> falls back to "Unclear", never
  // silently mislabels as either real state.
  const prescription = {
    expectedDaysSupply: 28,
    issueQuantity: { value: 56, snomedCtCode: { conceptId: '428673006', description: 'tablet' } },
    dosageInstruction: { dosageText: 'Take 1 tablet twice a day - oral' },
  };
  const text = describeForReauthorisationForm(prescription);
  assert(text === 'Unclear, 28 days', `missing authorisationMethod -> "Unclear, 28 days", got "${text}"`);
}
{
  // No expectedDaysSupply at all -> "days unknown" (not the labelled
  // "~N days (estimated)" state — no computable quantity/dose here
  // either). "Expected days supply" is a required field on this form in
  // practice, but the classifier still fails closed if it's ever
  // genuinely absent.
  const prescription = { productName: 'Apixaban 5mg tablets', authorisationMethod: 'review-date' };
  const text = describeForReauthorisationForm(prescription);
  assert(text === 'Until review date, days unknown', `no expectedDaysSupply at all -> "days unknown", got "${text}"`);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
