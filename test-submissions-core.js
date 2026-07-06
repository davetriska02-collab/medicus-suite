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

  const {
    DEFAULT_SUB_THRESHOLDS,
    ragLevel,
    getRagLevel,
    extractTaskArray,
    taskDateISO,
    windowTaskList,
    taskHour,
    emptyLedger,
    normaliseLedger,
    touchLedgerDay,
    mergeTasksIntoLedger,
    compactLedger,
    ledgerSeriesForDay,
    ledgerCountsForDays,
    ledgerDayWatched,
  } = await import(corePath);

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

  // ── day ledger ───────────────────────────────────────────────────────────────
  console.log('\n--- day ledger ---');
  const TODAY = '2026-07-06';
  const task = (id, iso) => ({ id, createdAt: iso });

  check(taskHour('2026-07-06T09:30:00Z') === 9, 'taskHour ISO');
  check(taskHour('06 Jul 2026 14:05') === 14, 'taskHour legacy');
  check(taskHour('garbage') === null, 'taskHour garbage → null');

  // Merge is idempotent per ID and survives task disappearance (completion)
  let led = emptyLedger();
  touchLedgerDay(led, TODAY);
  mergeTasksIntoLedger(led, 'medical', [task('a', '2026-07-06T08:10:00Z'), task('b', '2026-07-06T09:00:00Z')], TODAY);
  mergeTasksIntoLedger(led, 'medical', [task('b', '2026-07-06T09:00:00Z'), task('c', '2026-07-06T10:00:00Z')], TODAY);
  let s = ledgerSeriesForDay(led, TODAY, ['medical']);
  check(s.medical.total === 3, 'ledger remembers completed task a → count 3, not 2');
  check(s.medical.hourly[8] === 1 && s.medical.hourly[9] === 1 && s.medical.hourly[10] === 1, 'hourly buckets');
  check(s.medical.cumulative[23] === 3, 'cumulative reaches total');
  check(ledgerDayWatched(led, TODAY) === true, 'touched day is watched');
  check(ledgerDayWatched(led, '2026-07-05') === false, 'untouched day is not watched');

  // Duplicate merge does not double-count
  mergeTasksIntoLedger(led, 'medical', [task('a', '2026-07-06T08:10:00Z')], TODAY);
  check(ledgerSeriesForDay(led, TODAY, ['medical']).medical.total === 3, 'idempotent per task ID');

  // Tasks without id/date are skipped
  mergeTasksIntoLedger(led, 'medical', [{ createdAt: '2026-07-06T08:00:00Z' }, task('d', null)], TODAY);
  check(ledgerSeriesForDay(led, TODAY, ['medical']).medical.total === 3, 'no-id / no-date tasks skipped');

  // Compaction: past days become {n, hourly} with IDs discarded
  mergeTasksIntoLedger(led, 'admin', [task('x', '2026-07-05T11:00:00Z')], TODAY);
  compactLedger(led, TODAY);
  check(led.days['2026-07-05'].admin.n === 1 && !led.days['2026-07-05'].admin.ids, 'past day compacted, IDs gone');
  check(led.days[TODAY].medical.ids, 'today stays in ids-form');
  s = ledgerSeriesForDay(led, '2026-07-05', ['admin']);
  check(s.admin.total === 1 && s.admin.hourly[11] === 1, 'compacted day still renders counts + hourly');

  // Merging into a compacted day can only correct upward
  mergeTasksIntoLedger(led, 'admin', [task('x', '2026-07-05T11:00:00Z')], TODAY);
  check(led.days['2026-07-05'].admin.n === 1, 'compacted merge with fewer/equal rows is a no-op');
  mergeTasksIntoLedger(led, 'admin', [task('x', '2026-07-05T11:00:00Z'), task('y', '2026-07-05T12:00:00Z')], TODAY);
  check(led.days['2026-07-05'].admin.n === 2, 'compacted merge corrects upward when live view shows more');

  // Retention: days beyond SUB_LEDGER_RETAIN_DAYS are dropped
  led.days['2020-01-01'] = { medical: { n: 5, hourly: new Array(24).fill(0) } };
  compactLedger(led, TODAY);
  check(!led.days['2020-01-01'], 'ancient day dropped by retention');

  // ledgerCountsForDays zero-fills missing days/categories
  const counts = ledgerCountsForDays(led, ['2026-07-05', '2026-07-04'], ['admin', 'medical']);
  check(counts['2026-07-05'].admin === 2 && counts['2026-07-05'].medical === 0, 'counts for known day');
  check(counts['2026-07-04'].admin === 0, 'unknown day zero-filled');

  // normaliseLedger drops garbage, keeps valid structure
  const dirty = {
    days: {
      '2026-07-06': { watched: true, medical: { ids: { u1: 8, u2: 99 } }, junk: 'nope' },
      'not-a-date': { medical: { ids: {} } },
      '2026-07-05': { admin: { n: 3.7, hourly: ['x', 2] } },
    },
  };
  const clean = normaliseLedger(dirty);
  check(clean.days['2026-07-06'].medical.ids.u1 === 8, 'valid id/hour kept');
  check(clean.days['2026-07-06'].medical.ids.u2 === 0, 'out-of-range hour clamped to 0');
  check(!clean.days['not-a-date'], 'bad date key dropped');
  check(clean.days['2026-07-05'].admin.n === 3, 'fractional n floored');
  check(
    clean.days['2026-07-05'].admin.hourly[0] === 0 && clean.days['2026-07-05'].admin.hourly[1] === 2,
    'bad hourly cell zeroed, good kept'
  );
  check(normaliseLedger(null).days && Object.keys(normaliseLedger(null).days).length === 0, 'null → empty ledger');
  check(normaliseLedger('junk').v === 1, 'non-object → empty ledger');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
