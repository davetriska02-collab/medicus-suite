// Medicus Suite — Contact & task-age ledger pure-logic tests (B3 / B5)
// Run with: node test-contact-ledger.js
//
// shared/contact-ledger.js is the pure core behind two escalate-only queue
// chips: B3 repeat-contact ("3rd contact in 14d", patient-keyed contact log)
// and B5 aged-request carry-over ("carried over 4d", task-keyed first-seen log).
// content.js owns the memory mirror + debounced dirty-checked storage flush;
// this file pins the pure half: record/dedupe, windowed counting, first-seen
// carry-days, pruning/caps, sanitisation, and the ordinal presentation helper.

'use strict';

const CL = require('./shared/contact-ledger.js');

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

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const T1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const T4 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// A fixed "now" so day maths is deterministic.
const NOW = new Date('2026-07-22T09:00:00');
function daysBefore(n) {
  return CL.todayStr(new Date(NOW.getTime() - n * 86400000));
}

// ============================================================
// 1 — date/id helpers
// ============================================================
console.log('1: date/id helpers');
{
  check(CL.todayStr(NOW) === '2026-07-22', 'todayStr formats local YYYY-MM-DD');
  check(CL.dayDiff('2026-07-18', '2026-07-22') === 4, 'dayDiff counts whole days forward');
  check(CL.dayDiff('2026-07-22', '2026-07-22') === 0, 'dayDiff same day → 0');
  check(CL.dayDiff('garbage', '2026-07-22') === null, 'dayDiff rejects non-day input');
  check(CL.ordinal(1) === '1st' && CL.ordinal(2) === '2nd' && CL.ordinal(3) === '3rd', 'ordinal 1st/2nd/3rd');
  check(CL.ordinal(4) === '4th' && CL.ordinal(11) === '11th' && CL.ordinal(23) === '23rd', 'ordinal 4th/11th/23rd');
}

// ============================================================
// 2 — contact log: record, dedupe, first-seen day
// ============================================================
console.log('2: contact log record / dedupe / first-seen');
{
  const s = {};
  check(CL.recordContact(s, P1, T1, daysBefore(0)) === true, 'first contact records (changed=true)');
  check(CL.recordContact(s, P1, T1, daysBefore(0)) === false, 'same task same day → no change');
  // Re-seeing the SAME task on a LATER day must NOT move first-seen forward.
  check(CL.recordContact(s, P1, T1, daysBefore(-1)) === false, 'same task, later day → keeps first-seen, no change');
  check(s[P1].length === 1, 'still one distinct contact for the task');
  // An EARLIER day for the same task DOES move first-seen back.
  check(CL.recordContact(s, P1, T1, daysBefore(2)) === true, 'same task, earlier day → moves first-seen back');
  check(s[P1][0].d === daysBefore(2), 'first-seen day updated to the earliest');
  // Distinct tasks accumulate.
  CL.recordContact(s, P1, T2, daysBefore(1));
  check(s[P1].length === 2, 'a distinct task adds a second contact');
  // Garbage is rejected.
  check(CL.recordContact(s, 'not-a-uuid', T3, daysBefore(0)) === false, 'bad patient uuid rejected');
  check(CL.recordContact(s, P2, 'not-a-uuid', daysBefore(0)) === false, 'bad task uuid rejected');
}

// ============================================================
// 3 — countRecentContacts within the 14-day window (tier-2 threshold)
// ============================================================
console.log('3: windowed distinct-contact count');
{
  const s = {};
  CL.recordContact(s, P1, T1, daysBefore(1));
  CL.recordContact(s, P1, T2, daysBefore(6));
  CL.recordContact(s, P1, T3, daysBefore(13));
  check(CL.countRecentContacts(s, P1, NOW, 14) === 3, '3 distinct contacts within 14d → count 3 (fires tier-2)');
  // A 4th contact just OUTSIDE the window is not counted.
  CL.recordContact(s, P1, T4, daysBefore(20));
  check(CL.countRecentContacts(s, P1, NOW, 14) === 3, 'a contact 20d ago is outside the 14d window');
  check(CL.countRecentContacts(s, P2, NOW, 14) === 0, 'unknown patient → 0 (escalate-only, no chip)');
  check(CL.constants.CONTACT_MIN_COUNT === 3, 'tier-2 fires at ≥3 (documented constant)');
}

// ============================================================
// 4 — contact pruning: >28d dropped; caps enforced
// ============================================================
console.log('4: contact pruning + caps');
{
  const s = {};
  CL.recordContact(s, P1, T1, daysBefore(5)); // in-window
  CL.recordContact(s, P1, T2, daysBefore(30)); // >28d — should be pruned
  CL.pruneContacts(s, NOW);
  check(s[P1] && s[P1].length === 1, 'contact >28d pruned; in-window one kept');
  check(s[P1][0].t === T1, 'the surviving contact is the recent one');

  // A patient whose every contact ages out is removed entirely.
  const s2 = {};
  CL.recordContact(s2, P2, T3, daysBefore(40));
  CL.pruneContacts(s2, NOW);
  check(!s2[P2], 'a patient with only stale contacts is dropped');

  // Per-patient cap keeps the newest.
  const s3 = {};
  const cap = CL.constants.CONTACT_MAX_PER_PATIENT;
  for (let i = 0; i < cap + 5; i++) {
    const t = 'eeeeeeee-eeee-eeee-eeee-' + String(i).padStart(12, '0');
    CL.recordContact(s3, P1, t, daysBefore(i % 20));
  }
  CL.pruneContacts(s3, NOW);
  check(s3[P1].length <= cap, `per-patient cap enforced (≤${cap}, got ${s3[P1].length})`);
}

// ============================================================
// 5 — task-age log: firstSeen sticky, lastSeen bumps, carry-days
// ============================================================
console.log('5: task-age record / carry-days');
{
  const s = {};
  check(CL.recordTask(s, T1, 'medical_patient_request_task', daysBefore(4)) === true, 'first sight records');
  check(s[T1].f === daysBefore(4), 'firstSeen set to first sight');
  // Same-day re-sight is a no-op (dirty-check hook).
  check(CL.recordTask(s, T1, 'medical_patient_request_task', daysBefore(4)) === false, 'same-day re-sight → no change');
  // A later day bumps lastSeen but NOT firstSeen.
  check(CL.recordTask(s, T1, 'medical_patient_request_task', daysBefore(0)) === true, 'later day bumps lastSeen');
  check(s[T1].f === daysBefore(4), 'firstSeen unchanged by a later sight (the whole point of B5)');
  check(s[T1].l === daysBefore(0), 'lastSeen advanced to today');
  check(CL.taskCarriedDays(s, T1, NOW) === 4, 'carried 4 days since first seen');
  check(CL.taskCarriedDays(s, T2, NOW) === null, 'unknown task → null');
}

// ============================================================
// 6 — task pruning: not seen >14d dropped; count cap
// ============================================================
console.log('6: task pruning + cap');
{
  const s = {};
  CL.recordTask(s, T1, 'req', daysBefore(20)); // firstSeen 20d
  s[T1].l = daysBefore(16); // lastSeen 16d ago → stale (>14d)
  CL.recordTask(s, T2, 'req', daysBefore(3)); // fresh, lastSeen today
  CL.pruneTasks(s, NOW);
  check(!s[T1], 'task not seen for >14d pruned');
  check(!!s[T2], 'recently-seen task kept');
}

// ============================================================
// 7 — sanitisers reject malformed / PHI-shaped input
// ============================================================
console.log('7: sanitisers');
{
  const c = CL.sanitiseContactStore({
    [P1]: [
      { t: T1, d: '2026-07-20' },
      { t: 'bad', d: '2026-07-20' },
      { t: T2, d: 'nope' },
    ],
    'Jane Doe': [{ t: T1, d: '2026-07-20' }], // a NAME as key — rejected
    [P2]: 'not-an-array',
  });
  check(c[P1] && c[P1].length === 1 && c[P1][0].t === T1, 'contact sanitiser keeps only valid entries');
  check(!c['Jane Doe'], 'a name-shaped key is rejected (no PHI keys)');
  check(!c[P2], 'non-array patient value dropped');

  const t = CL.sanitiseTaskStore({
    [T1]: { f: '2026-07-18', l: '2026-07-22', s: 'medical_patient_request_task' },
    [T2]: { f: 'bad' }, // no valid firstSeen → dropped
    [T3]: { f: '2026-07-20', l: '2026-07-18' }, // lastSeen before firstSeen → clamped
  });
  check(t[T1] && t[T1].s === 'medical_patient_request_task', 'task sanitiser keeps valid record + slug');
  check(!t[T2], 'task with no valid firstSeen dropped');
  check(t[T3] && t[T3].l === t[T3].f, 'lastSeen < firstSeen is clamped up to firstSeen');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
