// Medicus Suite — 2WW / Faster-Diagnosis safety-net tests
// Run with: node test-referrals-safety-net.js
//
// Exercises referralAgeDays() and buildSafetyNet() in shared/referrals-api.js —
// the open-loop tracker for suspected-cancer (TwoWeekWait) referrals still
// showing Incomplete. A fixed nowISO keeps the ages deterministic.

'use strict';
const api = require('./shared/referrals-api.js');
const { referralAgeDays, buildSafetyNet } = api;

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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
