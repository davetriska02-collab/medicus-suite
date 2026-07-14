// Medicus Suite — 2WW / Faster-Diagnosis safety-net tests
// Run with: node test-referrals-safety-net.js
//
// Exercises referralAgeDays() and buildSafetyNet() in shared/referrals-api.js —
// the open-loop tracker for suspected-cancer (TwoWeekWait) referrals still
// showing Incomplete. A fixed nowISO keeps the ages deterministic.

'use strict';
const api = require('./shared/referrals-api.js');
const { referralAgeDays, buildSafetyNet, buildChaseLetter } = api;

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

function ref(date, priority, displayStatus, given, family) {
  return {
    referralId: `${given}-${date}`,
    referralDate: date,
    referralService: 'Lower GI',
    referringClinician: 'Dr A',
    priority,
    displayStatus,
    patientGivenName: given,
    patientFamilyName: family,
  };
}

// ── referralAgeDays ───────────────────────────────────────────────────────────
console.log('\n--- referralAgeDays ---');
check(referralAgeDays('2026-06-04', NOW) === 25, '2026-06-04 → 25 days');
check(referralAgeDays('2026-06-29', NOW) === 0, 'same day → 0 days');
check(referralAgeDays(null, NOW) === null, 'null date → null');
check(referralAgeDays('not-a-date', NOW) === null, 'bad date → null');

// ── buildSafetyNet: default (TwoWeekWait only) ───────────────────────────────
console.log('\n--- buildSafetyNet: open 2WW loops ---');
const rows = [
  ref('2026-06-04', 'TwoWeekWait', 'Incomplete', 'Old', 'Overdue'), // 25d → overdue
  ref('2026-06-13', 'TwoWeekWait', 'Incomplete', 'Mid', 'Watch'), // 16d → watch
  ref('2026-06-24', 'TwoWeekWait', 'Incomplete', 'New', 'Open'), // 5d → open
  ref('2026-06-01', 'TwoWeekWait', 'Completed', 'Done', 'Completed'), // excluded (completed)
  ref('2026-06-01', 'TwoWeekWait', 'Cancelled', 'Gone', 'Cancelled'), // excluded (cancelled)
  ref('2026-06-04', 'Routine', 'Incomplete', 'Routine', 'Patient'), // excluded (not 2WW)
  ref('2026-06-04', 'Urgent', 'Incomplete', 'Urgent', 'Patient'), // excluded by default
];
const sn = buildSafetyNet(rows, { nowISO: NOW });
check(sn.counts.total === 3, `3 open 2WW loops (got ${sn.counts.total})`);
check(sn.counts.overdue === 1, '1 overdue (≥21d)');
check(sn.counts.watch === 1, '1 watch (≥14d, <21d)');
check(sn.rows[0].ageDays === 25 && sn.rows[0].severity === 'overdue', 'oldest first: 25d overdue leads');
check(sn.rows[2].ageDays === 5 && sn.rows[2].severity === 'open', 'newest (5d) last, severity open');
check(!sn.rows.some((r) => r.displayStatus === 'Completed'), 'Completed excluded');
check(!sn.rows.some((r) => r.displayStatus === 'Cancelled'), 'Cancelled excluded');
check(!sn.rows.some((r) => r.priority === 'Routine'), 'Routine excluded by default');
check(!sn.rows.some((r) => r.priority === 'Urgent'), 'Urgent excluded by default');

// ── priorities override: include Urgent ──────────────────────────────────────
console.log('\n--- priorities override ---');
const snU = buildSafetyNet(rows, { nowISO: NOW, priorities: ['TwoWeekWait', 'Urgent'] });
check(snU.counts.total === 4, 'including Urgent → 4 open loops');
check(
  snU.rows.some((r) => r.priority === 'Urgent'),
  'Urgent now present'
);

// ── custom thresholds ────────────────────────────────────────────────────────
console.log('\n--- custom thresholds ---');
const snT = buildSafetyNet(rows, { nowISO: NOW, watchDays: 4, overdueDays: 10 });
check(snT.counts.overdue === 2, 'overdueDays=10 → 25d and 16d both overdue');
check(snT.counts.watch === 1, 'watchDays=4 → 5d is watch');

// ── empty / null ─────────────────────────────────────────────────────────────
console.log('\n--- empty / null ---');
check(buildSafetyNet([], { nowISO: NOW }).counts.total === 0, 'empty → 0 rows');
check(buildSafetyNet(null, { nowISO: NOW }).rows.length === 0, 'null → 0 rows');

// ── buildChaseLetter ──────────────────────────────────────────────────────────
console.log('\n--- buildChaseLetter ---');

const HEADER =
  '(Prepared draft only — review and edit before sending. Confirm the patient and destination before use.)';

// Full row, taken straight out of buildSafetyNet so ageDays is pre-computed.
const snRow = buildSafetyNet([ref('2026-06-04', 'TwoWeekWait', 'Incomplete', 'Jane', 'Doe')], { nowISO: NOW }).rows[0];

const letterFull = buildChaseLetter(snRow, { practiceName: 'The Grove Surgery', clinicianName: 'Dr A Smith' }, NOW);
check(letterFull.includes(HEADER), 'includes the prepared-draft header verbatim');
check(letterFull.includes('The Grove Surgery'), 'includes configured practice name');
check(letterFull.includes('Dr A Smith'), 'includes configured clinician name');
check(
  letterFull.includes('Re: 2WW referral — Jane Doe, referred 2026-06-04'),
  'subject line uses 2WW label + name + referral date'
);
check(letterFull.includes('25 days'), `correct day count (25 days), got: ${letterFull.match(/\d+ days?/)}`);

// Letterhead unset → bracketed placeholders, never a real-looking empty sign-off.
const letterNoLh = buildChaseLetter(snRow, {}, NOW);
check(letterNoLh.includes('[Practice name]'), 'unset letterhead → [Practice name] placeholder');
check(letterNoLh.includes('[Clinician name]'), 'unset letterhead → [Clinician name] placeholder');
check(!letterNoLh.includes('undefined'), 'no "undefined" leaks with unset letterhead');

const letterNullLh = buildChaseLetter(snRow, null, NOW);
check(letterNullLh.includes('[Practice name]'), 'null letterhead → [Practice name] placeholder');
check(letterNullLh.includes('[Clinician name]'), 'null letterhead → [Clinician name] placeholder');

// Single-day count (singular "day").
const oneDayRow = ref('2026-06-28', 'TwoWeekWait', 'Incomplete', 'Sam', 'One');
const letterOneDay = buildChaseLetter(oneDayRow, {}, NOW);
check(letterOneDay.includes('1 day '), `singular "1 day" (no trailing s), got: ${letterOneDay.match(/\d+ days? /)}`);

// Missing referralService/referringClinician — graceful fallback text, never 'undefined'.
const bareRow = {
  referralId: 'REF-BARE-1',
  referralDate: '2026-06-04',
  priority: 'TwoWeekWait',
  displayStatus: 'Incomplete',
  patientGivenName: 'No',
  patientFamilyName: 'Service',
  // referralService and referringClinician intentionally omitted
};
const letterBare = buildChaseLetter(bareRow, {}, NOW);
check(!letterBare.includes('undefined'), 'missing referralService/referringClinician never renders "undefined"');
check(letterBare.includes('(specialty/hospital not recorded)'), 'missing referralService → placeholder text');
check(letterBare.includes('(referring clinician not recorded)'), 'missing referringClinician → placeholder text');

// Fully empty row/letterhead/now — the most defensive case.
const letterEmpty = buildChaseLetter({}, {}, NOW);
check(!letterEmpty.includes('undefined'), 'completely empty row never renders "undefined"');
check(letterEmpty.includes(HEADER), 'completely empty row still carries the prepared-draft header');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
