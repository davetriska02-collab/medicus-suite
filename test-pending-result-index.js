// Medicus Suite — B2 pending-result cross-link index lifecycle tests
// Run with: node test-pending-result-index.js
//
// The index (shared/pending-result-index.js) is a patientUuid→worst-severity
// projection of the taskUuid-keyed result-triage cache. Its ONE safety-critical
// property: an index entry is a POINTER to a live source severity entry and MUST
// die with it — never serve a chip from an entry whose source is gone. content.js
// calls set()/drop()/clear() at every source-mutation point; these tests pin the
// pure module's half of that contract (correct worst-severity, escalate-only, and
// "dies with source / never serves stale"), plus a small harness that models the
// content.js pendingIndexSync hook against a simulated _queueResultCache so the
// four teardown paths are exercised end-to-end.

'use strict';

const PRI = require('./shared/pending-result-index.js');

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

// ============================================================
// 1 — basic set / query / worst-severity
// ============================================================
console.log('1: set / query / worst-severity');
{
  const ix = PRI.create();
  ix.set(T1, P1, 'amber', 1000);
  let q = ix.query(P1);
  check(q && q.worstSev === 'amber', 'single amber → worstSev amber');
  check(q && q.count === 1 && q.taskUuids[0] === T1, 'query carries the source taskUuid');
  check(q && q.gradedTs === 1000, 'query carries gradedTs');

  // A second, worse (red) result for the SAME patient wins the worst-severity.
  ix.set(T2, P1, 'red', 2000);
  q = ix.query(P1);
  check(q && q.worstSev === 'red', 'amber + red for one patient → worstSev red');
  check(q && q.count === 2, 'both tasks tracked for the patient');
  check(q && q.gradedTs === 2000, 'gradedTs is the most-recent of the patient bucket');

  check(ix.query(P2) === null, 'a patient with no entry → null (escalate-only, no "clear" chip)');
  check(ix.query(null) === null, 'null patient → null');
}

// ============================================================
// 2 — escalate-only: anything that is not red/amber is a DROP
// ============================================================
console.log('2: escalate-only');
{
  const ix = PRI.create();
  ix.set(T1, P1, 'amber', 1000);
  check(ix.has(T1), 'amber indexed');
  // Re-grade to a non-escalation severity → the entry must disappear.
  ix.set(T1, P1, 'none', 1500);
  check(!ix.has(T1) && ix.query(P1) === null, "re-grade to 'none' drops the entry");

  ix.set(T2, P1, null, 1600);
  check(!ix.has(T2), 'null severity is never indexed');
  ix.set(T3, null, 'red', 1700);
  check(!ix.has(T3), 'red with no patientUuid is never indexed (nothing to cross-link)');
}

// ============================================================
// 3 — DIES WITH SOURCE: drop kills it; query never serves the ghost
// ============================================================
console.log('3: dies with source / never serves stale');
{
  const ix = PRI.create();
  ix.set(T1, P1, 'red', 1000);
  ix.set(T2, P1, 'amber', 1100); // same patient, two sources
  check(ix.query(P1).count === 2, 'two sources for the patient');

  // Source T1 dies (e.g. TTL prune of its _queueResultCache entry).
  ix.drop(T1);
  const q = ix.query(P1);
  check(q && q.count === 1 && q.taskUuids[0] === T2, 'after dropping T1, only T2 remains');
  check(q && q.worstSev === 'amber', 'worst-severity recomputed to the surviving entry (amber, not the dead red)');

  // Last source dies → patient must no longer match AT ALL (no ghost bucket).
  ix.drop(T2);
  check(ix.query(P1) === null, 'after the last source dies, the patient serves nothing');
  check(ix.size() === 0, 'index fully drained');

  // Dropping an already-absent task is a harmless no-op (every teardown path is safe).
  ix.drop(T1);
  ix.drop('deadbeef-0000-0000-0000-000000000000');
  check(ix.size() === 0, 'dropping absent tasks is idempotent');
}

// ============================================================
// 4 — patient re-resolution: a task that moves patient leaves the old bucket
// ============================================================
console.log('4: task re-resolves to a different patient');
{
  const ix = PRI.create();
  ix.set(T1, P1, 'red', 1000);
  check(ix.query(P1).count === 1, 'T1 under P1');
  // Same task, re-resolved to P2 (identity correction) — old patient must not still match it.
  ix.set(T1, P2, 'red', 2000);
  check(ix.query(P1) === null, 'old patient P1 no longer matches the re-resolved task');
  check(ix.query(P2) && ix.query(P2).count === 1, 'new patient P2 now owns the task');
  check(ix.size() === 1, 'no duplicate task entry after re-resolution');
}

// ============================================================
// 5 — clear() (config-invalidation hook: every source severity wiped at once)
// ============================================================
console.log('5: clear');
{
  const ix = PRI.create();
  ix.set(T1, P1, 'red', 1000);
  ix.set(T2, P2, 'amber', 1000);
  ix.clear();
  check(ix.size() === 0 && ix.query(P1) === null && ix.query(P2) === null, 'clear() drains everything');
}

// ============================================================
// 6 — formatAge (data-age label the chip MUST always carry)
// ============================================================
console.log('6: formatAge');
{
  check(PRI.formatAge(0) === '<1m', '0ms → <1m');
  check(PRI.formatAge(30 * 1000) === '<1m', '30s → <1m');
  check(PRI.formatAge(5 * 60 * 1000) === '5m', '5min → 5m');
  check(PRI.formatAge(59 * 60 * 1000) === '59m', '59min → 59m');
  check(PRI.formatAge(3 * 3600 * 1000) === '3h', '3h → 3h');
  check(PRI.formatAge(2 * 86400 * 1000) === '2d', '2d → 2d');
  check(PRI.formatAge(-5) === '', 'negative → empty (never a misleading label)');
  check(PRI.formatAge('x') === '', 'non-number → empty');
  check(PRI.formatAge(NaN) === '', 'NaN → empty');
}

// ============================================================
// 7 — END-TO-END: model content.js's pendingIndexSync against a simulated cache
//     so the four teardown paths are proven to keep index ⊆ live-source.
// ============================================================
console.log('7: pendingIndexSync harness — index never outlives its source entry');
{
  const ix = PRI.create();
  const cache = new Map(); // simulated _queueResultCache: taskUuid -> entry

  // Faithful port of content.js pendingIndexSync(taskUuid).
  function pendingIndexSync(taskUuid) {
    const entry = cache.get(taskUuid);
    const sev = entry && entry.sev;
    const level = sev && typeof sev === 'object' && (sev.level === 'red' || sev.level === 'amber') ? sev.level : null;
    const patientUuid = entry && entry.patientUuid;
    if (entry && !entry.error && level && patientUuid) {
      ix.set(taskUuid, patientUuid, level, entry.gradedTs || entry.ts || 1);
    } else {
      ix.drop(taskUuid);
    }
  }

  // (a) A result grades red on the results queue → cache entry + sync → indexed.
  cache.set(T1, { sev: { level: 'red' }, patientUuid: P1, gradedTs: 1000, error: false });
  pendingIndexSync(T1);
  check(ix.query(P1) && ix.query(P1).worstSev === 'red', '(a) graded red → cross-linkable for P1');

  // (b) priorityDisplay invalidation: bridge deletes sev + patientUuid, then drop.
  const e = cache.get(T1);
  delete e.sev;
  delete e.patientUuid;
  ix.drop(T1); // content.js drops explicitly on this path
  check(ix.query(P1) === null, '(b) priorityDisplay invalidation → index entry dies with the cleared sev');

  // (c) re-grade to error → sync must drop (never a chip from a failed check).
  cache.set(T2, { sev: { level: 'amber' }, patientUuid: P2, gradedTs: 2000, error: false });
  pendingIndexSync(T2);
  check(ix.has(T2), '(c) amber graded → indexed');
  cache.get(T2).error = true;
  cache.get(T2).sev = null;
  pendingIndexSync(T2);
  check(!ix.has(T2) && ix.query(P2) === null, '(c) re-grade to error → dropped');

  // (d) TTL prune: cache entry deleted, content.js drops → index must follow.
  cache.set(T3, { sev: { level: 'red' }, patientUuid: P1, gradedTs: 3000, error: false });
  pendingIndexSync(T3);
  check(ix.has(T3), '(d) graded → indexed');
  cache.delete(T3);
  ix.drop(T3); // runQueue prune hook
  check(!ix.has(T3) && ix.query(P1) === null, '(d) TTL prune → index entry dies with the deleted source');

  // Invariant (the whole point of B2): nothing in the index lacks a live,
  // red/amber, non-error source entry in the simulated cache.
  let invariantHolds = true;
  [T1, T2, T3].forEach((tid) => {
    if (ix.has(tid)) {
      const src = cache.get(tid);
      const ok = src && !src.error && src.sev && (src.sev.level === 'red' || src.sev.level === 'amber');
      if (!ok) invariantHolds = false;
    }
  });
  check(invariantHolds, 'invariant: no index entry outlives a live red/amber source');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
