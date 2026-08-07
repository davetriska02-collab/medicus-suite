// Medicus Suite — SLA breach-risk core tests (Workstream A2)
// Run with: node test-sla-breach-core.js
//
// Guards the pure computation behind the urgent-request breach-risk strip
// (shared/sla-breach-core.js): urgent detection off Medicus's own priority
// flag, the fail-visible unknown-priority path, amber/red boundary maths, and
// the oldest-age calculation. A regression here is a patient-safety miss — the
// strip either stops warning about breaching urgent requests, or (worse) shows
// a reassuring "zero urgent" when it actually could not read priority.

'use strict';

const C = require('./shared/sla-breach-core.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const H = 3600000; // one hour in ms
const NOW = Date.parse('2026-07-22T12:00:00Z');
// amber 2h, red 4h (the shipped defaults)
const OPTS = { now: NOW, amberMs: 2 * H, redMs: 4 * H };
// createdAt `hoursAgo` hours before NOW
const ago = (hours) => new Date(NOW - hours * H).toISOString();

// ── 1. Zero items → hidden 'none' ─────────────────────────────────────────────
{
  const r = C.computeBreachRisk([], OPTS);
  check(r.level === 'none', 'empty list → level none');
  check(r.visible === false, 'empty list → not visible');
  check(r.urgentCount === 0, 'empty list → urgentCount 0');
  check(r.oldestAgeMs === null, 'empty list → oldestAgeMs null');

  const rNull = C.computeBreachRisk(null, OPTS);
  check(rNull.level === 'none' && rNull.visible === false, 'null items → level none, hidden');
}

// ── 2. Urgent detection off the priority flag ─────────────────────────────────
{
  check(C.isUrgentItem({ priority: 'Urgent' }) === true, 'priority "Urgent" is urgent');
  check(C.isUrgentItem({ priorityDisplay: 'High' }) === true, 'priorityDisplay "High" is urgent');
  check(C.isUrgentItem({ priorityDisplay: 'Immediate' }) === true, 'priorityDisplay "Immediate" is urgent');
  check(C.isUrgentItem({ priority: 'urgent' }) === true, 'lower-case "urgent" is urgent (case-insensitive)');
  check(C.isUrgentItem({ priority: 'Routine' }) === false, 'priority "Routine" is not urgent');
  check(C.isUrgentItem({ priority: '' }) === false, 'empty priority is not urgent');
  check(C.isUrgentItem({}) === false, 'no priority field is not urgent');

  // A mixed queue: 2 urgent (3h and 1h old), 1 routine.
  const items = [
    { priorityDisplay: 'Urgent', createdAt: ago(3) },
    { priorityDisplay: 'Urgent', createdAt: ago(1) },
    { priorityDisplay: 'Routine', createdAt: ago(5) },
  ];
  const r = C.computeBreachRisk(items, OPTS);
  check(r.urgentCount === 2, 'mixed queue → 2 urgent counted, routine ignored');
  check(r.oldestAgeMs === 3 * H, 'mixed queue → oldest urgent age is 3h (routine 5h ignored)');
  check(r.level === 'amber' && r.visible === true, 'mixed queue oldest 3h → amber visible');
}

// ── 3. Fail-visible: priority field entirely absent ───────────────────────────
{
  // Items present but NONE carry a readable priority field (schema change).
  const items = [{ createdAt: ago(6) }, { createdAt: ago(1), priority: undefined, priorityDisplay: undefined }];
  const r = C.computeBreachRisk(items, OPTS);
  check(r.level === 'unknown', 'no readable priority on any item → level unknown');
  check(r.visible === true, 'unknown → visible (fail-visible)');
  check(r.priorityKnown === false, 'unknown → priorityKnown false');

  // An empty-string priority IS a readable (routine) field, not unknown.
  const routineOnly = [{ priorityDisplay: '', createdAt: ago(6) }];
  const r2 = C.computeBreachRisk(routineOnly, OPTS);
  check(r2.level === 'none' && r2.priorityKnown === true, 'empty-string priority is readable → none, not unknown');
}

// ── 4. Amber / red boundaries ─────────────────────────────────────────────────
{
  // Just below amber (1h59m) → below, hidden.
  const belowAmber = [{ priority: 'Urgent', createdAt: ago(2) - 0 }];
  // build precise ages via createdAt timestamps
  const at = (ms) => new Date(NOW - ms).toISOString();

  const justUnder = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(2 * H - 60000) }], OPTS);
  check(justUnder.level === 'below', 'oldest 1h59m → below');
  check(justUnder.visible === false, 'below amber → hidden');
  check(justUnder.urgentCount === 1, 'below amber still counts the urgent item');

  const exactlyAmber = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(2 * H) }], OPTS);
  check(exactlyAmber.level === 'amber', 'oldest exactly 2h (== amber) → amber (inclusive)');
  check(exactlyAmber.visible === true, 'amber → visible');

  const midAmber = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(3 * H) }], OPTS);
  check(midAmber.level === 'amber', 'oldest 3h → amber');

  const justUnderRed = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(4 * H - 60000) }], OPTS);
  check(justUnderRed.level === 'amber', 'oldest 3h59m → still amber');

  const exactlyRed = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(4 * H) }], OPTS);
  check(exactlyRed.level === 'red', 'oldest exactly 4h (== red) → red (inclusive)');
  check(exactlyRed.visible === true, 'red → visible');

  const wellPastRed = C.computeBreachRisk([{ priority: 'Urgent', createdAt: at(9 * H) }], OPTS);
  check(wellPastRed.level === 'red', 'oldest 9h → red');
  check(wellPastRed.oldestAgeMs === 9 * H, 'oldest 9h → oldestAgeMs 9h');

  // avoid unused-var lint noise
  void belowAmber;
}

// ── 5. Oldest-age maths & edge cases ──────────────────────────────────────────
{
  const at = (ms) => new Date(NOW - ms).toISOString();
  // Oldest is picked across several urgent items regardless of order.
  const items = [
    { priority: 'Urgent', createdAt: at(1 * H) },
    { priority: 'High', createdAt: at(5 * H + 12 * 60000) }, // 5h12m
    { priority: 'Urgent', createdAt: at(2 * H) },
  ];
  const r = C.computeBreachRisk(items, OPTS);
  check(r.urgentCount === 3, 'three urgent items counted');
  check(r.oldestAgeMs === 5 * H + 12 * 60000, 'oldest age is the max across urgent items (5h12m)');
  check(r.level === 'red', '5h12m oldest → red');

  // Urgent item with a missing/unparseable timestamp → conservative amber, visible.
  const noTs = C.computeBreachRisk([{ priority: 'Urgent', createdAt: 'not-a-date' }], OPTS);
  check(noTs.urgentCount === 1, 'urgent item with bad timestamp still counted');
  check(noTs.oldestAgeMs === null, 'urgent item with bad timestamp → oldestAgeMs null');
  check(noTs.level === 'amber' && noTs.visible === true, 'urgent but un-ageable → conservative amber visible');

  // Future timestamp (clock skew) is treated as un-ageable, not negative.
  const future = C.computeBreachRisk([{ priority: 'Urgent', createdAt: new Date(NOW + H).toISOString() }], OPTS);
  check(future.oldestAgeMs === null, 'future createdAt → age null (no negative age)');
}

// ── 6. itemAgeMs helper ───────────────────────────────────────────────────────
{
  check(C.itemAgeMs({ createdAt: ago(2) }, NOW) === 2 * H, 'itemAgeMs: 2h old → 2h');
  check(C.itemAgeMs({ createdAt: '' }, NOW) === null, 'itemAgeMs: empty createdAt → null');
  check(C.itemAgeMs({}, NOW) === null, 'itemAgeMs: missing createdAt → null');
}

// ── 7. formatAge ──────────────────────────────────────────────────────────────
{
  check(C.formatAge(4 * H + 12 * 60000) === '4h12m', 'formatAge 4h12m');
  check(C.formatAge(45 * 60000) === '45m', 'formatAge 45m');
  check(C.formatAge(2 * H) === '2h00m', 'formatAge 2h00m (zero-padded minutes)');
  check(C.formatAge(0) === '0m', 'formatAge 0 → 0m');
  check(C.formatAge(9 * H + 5 * 60000) === '9h05m', 'formatAge 9h05m');
  check(C.formatAge(-1) === '', 'formatAge negative → empty');
  check(C.formatAge(NaN) === '', 'formatAge NaN → empty');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
