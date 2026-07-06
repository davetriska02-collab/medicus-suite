// Medicus Suite — Submissions core logic tests
// Run with: node test-submissions-core.js
// Dynamic-imports submissions-core.js (ES module).

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
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

  const corePath = new URL('side-panel/modules/submissions/submissions-core.js', `file://${path.resolve(__dirname)}/`)
    .href;

  const { DEFAULT_SUB_THRESHOLDS, ragLevel, getRagLevel, extractTaskArray, taskDateISO, windowTaskList } = await import(
    corePath
  );

  // ── defaults ─────────────────────────────────────────────────────────────────
  console.log('--- DEFAULT_SUB_THRESHOLDS ---');
  check(DEFAULT_SUB_THRESHOLDS.medical.enabled === false, 'medical disabled by default');
  check(DEFAULT_SUB_THRESHOLDS.admin.enabled === false, 'admin disabled by default');
  check(DEFAULT_SUB_THRESHOLDS.medical.amber === 30 && DEFAULT_SUB_THRESHOLDS.medical.red === 60, 'medical 30/60');

  // ── ragLevel ─────────────────────────────────────────────────────────────────
  console.log('\n--- ragLevel ---');
  const t = { amber: 30, red: 60, enabled: true };
  check(ragLevel(0, t) === null, 'below amber → null');
  check(ragLevel(29, t) === null, 'just below amber → null');
  check(ragLevel(30, t) === 'amber', 'at amber threshold → amber');
  check(ragLevel(59, t) === 'amber', 'between amber and red → amber');
  check(ragLevel(60, t) === 'red', 'at red threshold → red');
  check(ragLevel(1000, t) === 'red', 'far above red → red');

  // disabled / missing
  check(ragLevel(100, { amber: 30, red: 60, enabled: false }) === null, 'disabled threshold → null even when high');
  check(ragLevel(100, null) === null, 'null threshold → null');
  check(ragLevel(100, undefined) === null, 'undefined threshold → null');

  // missing red/amber bounds default to Infinity (never trips)
  check(ragLevel(1000, { enabled: true }) === null, 'no amber/red bounds → never trips');
  check(ragLevel(1000, { amber: 30, enabled: true }) === 'amber', 'amber only (no red) → amber, never red');

  // ── getRagLevel (key lookup) ─────────────────────────────────────────────────
  console.log('\n--- getRagLevel ---');
  const thresholds = {
    medical: { amber: 30, red: 60, enabled: true },
    admin: { amber: 20, red: 40, enabled: false },
  };
  check(getRagLevel('medical', 65, thresholds) === 'red', 'medical 65 → red');
  check(getRagLevel('admin', 65, thresholds) === null, 'admin disabled → null regardless of count');
  check(getRagLevel('investigation', 999, thresholds) === null, 'unknown key → null (no threshold)');
  check(getRagLevel('medical', 10, null) === null, 'null thresholds map → null');

  // ── extractTaskArray (envelope tolerance) ────────────────────────────────────
  console.log('\n--- extractTaskArray ---');
  const t1 = [{ id: 1 }];
  check(extractTaskArray({ tasks: t1 }).length === 1, 'tasks key');
  check(extractTaskArray({ data: t1 }).length === 1, 'data key');
  check(extractTaskArray({ results: t1 }).length === 1, 'results key');
  check(extractTaskArray({ rows: t1 }).length === 1, 'rows key');
  check(extractTaskArray(t1).length === 1, 'bare array body');
  check(extractTaskArray({ tasks: 'nope' }).length === 0, 'non-array tasks → []');
  check(extractTaskArray(null).length === 0, 'null body → []');
  check(extractTaskArray({}).length === 0, 'empty object → []');

  // ── taskDateISO ──────────────────────────────────────────────────────────────
  console.log('\n--- taskDateISO ---');
  check(taskDateISO('2026-07-06T08:30:00Z') === '2026-07-06', 'ISO datetime → date');
  check(taskDateISO('2026-07-06') === '2026-07-06', 'bare ISO date');
  check(taskDateISO('06 Jul 2026 08:30') === '2026-07-06', 'legacy DD Mon YYYY');
  check(taskDateISO('garbage') === null, 'garbage → null');
  check(taskDateISO(null) === null, 'null → null');
  check(taskDateISO(42) === null, 'non-string → null');

  // ── windowTaskList ───────────────────────────────────────────────────────────
  console.log('\n--- windowTaskList ---');
  const D = '2026-07-06';
  const mk = (dates) => ({ tasks: dates.map((d, i) => ({ id: i, createdAt: d })) });

  // Healthy response: everything in-window → passthrough, no flags
  let w = windowTaskList(mk(['2026-07-06T08:00:00Z', '2026-07-06T09:00:00Z']), D, D);
  check(w.tasks.length === 2 && !w.filterIgnored && w.dropped === 0, 'in-window response passes through');

  // Boundary tolerance: a ±1-day task (timezone skew) must NOT trip the alarm
  w = windowTaskList(mk(['2026-07-05T23:30:00Z', '2026-07-06T08:00:00Z']), D, D);
  check(!w.filterIgnored, 'previous-day boundary task (UTC skew) does not trip filterIgnored');
  check(w.tasks.length === 2, 'boundary-tolerant response is not re-windowed');

  // Filter ignored: clearly-out-of-window tasks trip the alarm AND get windowed out
  w = windowTaskList(mk(['2026-06-01T10:00:00Z', '2026-07-06T08:00:00Z', '2026-07-04T10:00:00Z']), D, D);
  check(w.filterIgnored === true, 'far-outside task trips filterIgnored');
  check(w.tasks.length === 1 && w.tasks[0].createdAt.startsWith('2026-07-06'), 'ignored filter → strict re-window');
  check(w.dropped === 2, 'dropped counts the excluded tasks');

  // When re-windowing, unparseable dates are dropped (invisible to charts anyway)
  w = windowTaskList(mk(['2026-06-01T10:00:00Z', 'garbage', '2026-07-06T08:00:00Z']), D, D);
  check(w.tasks.length === 1, 'unparseable createdAt dropped when filter ignored');

  // Range mode windows to [start, end]
  w = windowTaskList(mk(['2026-06-01T10:00:00Z', '2026-07-02T10:00:00Z', '2026-07-04T10:00:00Z']), '2026-07-01', D);
  check(w.filterIgnored && w.tasks.length === 2, 'range window keeps in-range, drops far-outside');

  // Truncation detection via server-side totals
  w = windowTaskList({ tasks: [{ id: 1, createdAt: '2026-07-06T08:00:00Z' }], totalCount: 40 }, D, D);
  check(w.truncated === true && w.serverTotal === 40, 'totalCount > returned rows → truncated');
  w = windowTaskList({ tasks: t1.map(() => ({ createdAt: '2026-07-06T08:00:00Z' })), totalCount: 1 }, D, D);
  check(w.truncated === false, 'totalCount == returned rows → not truncated');
  w = windowTaskList({ tasks: [], meta: { total: 12 } }, D, D);
  check(w.truncated === true && w.serverTotal === 12, 'meta.total honoured');

  // Envelope rename tolerated end-to-end
  w = windowTaskList({ data: [{ createdAt: '2026-07-06T08:00:00Z' }] }, D, D);
  check(w.tasks.length === 1, 'data-envelope response still counted');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
