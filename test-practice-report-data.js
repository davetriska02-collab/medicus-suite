// Medicus Suite — Practice Report data-layer tests
// Run with: node test-practice-report-data.js
//
// Covers the PURE helpers in side-panel/modules/condor/report/report-data.js
// (range resolution, date iteration, demand bucketing, series summary, period
// comparison, snapshot pruning, snapshot-row build). The I/O fetchers are not
// unit-tested here (they require a live credentialed Medicus session).

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

  const modPath = new URL(
    'side-panel/modules/condor/report/report-data.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const m = await import(modPath);

  // ── resolveRange ────────────────────────────────────────────────────────────
  console.log('--- resolveRange ---');
  const today = '2026-06-16';
  let r = m.resolveRange('today', { today });
  check(r.start === today && r.end === today && r.days === 1, 'today → single day');
  r = m.resolveRange('7d', { today });
  check(r.start === '2026-06-10' && r.end === today && r.days === 7, '7d → start is today-6, 7 days inclusive');
  r = m.resolveRange('30d', { today });
  check(r.start === '2026-05-18' && r.end === today && r.days === 30, '30d → start is today-29, 30 days');
  r = m.resolveRange('custom', { today, start: '2026-06-01', end: '2026-06-16' });
  check(r.start === '2026-06-01' && r.end === '2026-06-16' && r.days === 16, 'custom → honours start/end, 16 days');
  r = m.resolveRange('nonsense', { today });
  check(r.preset === 'today', 'unknown preset → falls back to today');

  // ── daySpan / iterateDates ────────────────────────────────────────────────
  console.log('\n--- daySpan / iterateDates ---');
  check(m.daySpan('2026-06-16', '2026-06-16') === 1, 'daySpan same day = 1');
  check(m.daySpan('2026-06-10', '2026-06-16') === 7, 'daySpan inclusive = 7');
  const dates = m.iterateDates('2026-06-14', '2026-06-16');
  check(dates.length === 3 && dates[0] === '2026-06-14' && dates[2] === '2026-06-16', 'iterateDates inclusive list');
  const monthCross = m.iterateDates('2026-05-30', '2026-06-02');
  check(
    monthCross.join(',') === '2026-05-30,2026-05-31,2026-06-01,2026-06-02',
    'iterateDates crosses month boundary correctly'
  );
  check(m.iterateDates('2026-01-01', '2026-12-31').length <= 92, 'iterateDates caps runaway ranges');

  // ── previousRange ────────────────────────────────────────────────────────────
  console.log('\n--- previousRange ---');
  const prev = m.previousRange('2026-06-10', '2026-06-16'); // 7 days
  check(prev.end === '2026-06-09' && prev.start === '2026-06-03' && prev.days === 7, 'previous window is the 7 days before');

  // ── bucketDemandByDay ────────────────────────────────────────────────────────
  console.log('\n--- bucketDemandByDay ---');
  const tasks = [
    { type: 'medical', createdAt: '2026-06-14T09:00:00' },
    { type: 'medical', createdAt: '2026-06-14T11:00:00' },
    { type: 'admin', createdAt: '2026-06-15T10:00:00' },
    { type: 'rxRoutine', createdAt: '2026-06-16T08:30:00' },
    { type: 'medical', createdAt: '2026-06-20T08:30:00' }, // outside range — ignored
    { type: 'unknownType', createdAt: '2026-06-15T08:30:00' }, // unknown — ignored
    { type: 'medical' }, // no createdAt — ignored
  ];
  const byDay = m.bucketDemandByDay(tasks, '2026-06-14', '2026-06-16');
  check(byDay.length === 3, 'one row per day in range');
  check(byDay[0].medical === 2 && byDay[0].all === 2, 'day 1 counts both medical');
  check(byDay[1].admin === 1 && byDay[1].all === 1, 'day 2 counts admin, ignores unknown type');
  check(byDay[2].rxRoutine === 1 && byDay[2].all === 1, 'day 3 counts rxRoutine');
  const total = byDay.reduce((s, d) => s + d.all, 0);
  check(total === 4, 'out-of-range and unknown/no-date tasks excluded (4 counted)');

  // ── summariseSeries ────────────────────────────────────────────────────────
  console.log('\n--- summariseSeries ---');
  const sum = m.summariseSeries(byDay);
  check(sum.totals.all === 4 && sum.totals.medical === 2, 'totals across the series');
  check(sum.peak.date === '2026-06-14' && sum.peak.value === 2, 'peak day identified');
  check(sum.dailyMean === Math.round((4 / 3) * 10) / 10, 'daily mean computed over day count');

  // ── comparePct ────────────────────────────────────────────────────────────
  console.log('\n--- comparePct ---');
  check(m.comparePct(120, 100).pct === 20 && m.comparePct(120, 100).direction === 'up', '+20% up');
  check(m.comparePct(80, 100).pct === -20 && m.comparePct(80, 100).direction === 'down', '-20% down');
  check(m.comparePct(100, 100).direction === 'flat', 'equal → flat');
  check(m.comparePct(5, 0).pct === null && m.comparePct(5, 0).direction === 'up', 'up from zero → pct null, up');
  check(m.comparePct(0, 0).direction === 'flat', 'zero vs zero → flat');

  // ── pruneSnapshots ────────────────────────────────────────────────────────
  console.log('\n--- pruneSnapshots ---');
  const snaps = [
    { date: '2026-06-16', ppi: 30 },
    { date: '2026-06-16', ppi: 35 }, // dup date — latest wins
    { date: '2026-06-10', ppi: 40 },
    { date: '2026-01-01', ppi: 99 }, // older than keepDays — dropped
  ];
  const pruned = m.pruneSnapshots(snaps, 90, '2026-06-16');
  check(pruned.length === 2, 'duplicates collapsed and stale dropped');
  check(pruned[pruned.length - 1].date === '2026-06-16' && pruned[pruned.length - 1].ppi === 35, 'latest dup wins, sorted ascending');
  check(!pruned.some((s) => s.date === '2026-01-01'), 'stale snapshot pruned by keepDays');

  // ── buildSnapshotRow ────────────────────────────────────────────────────────
  console.log('\n--- buildSnapshotRow ---');
  const live = {
    submissions: { totals: { all: 151 } },
    slots: { totalRemaining: 50 },
    waitingRoom: { arrivedCount: 4 },
    requestMonitor: { urgentCount: 2, byAgeBucket: { gt8h: 1 } },
  };
  const rowFull = m.buildSnapshotRow(live, { ppi: 67, band: 'AMBER' }, '2026-06-16');
  check(rowFull.date === '2026-06-16' && rowFull.ppi === 67 && rowFull.band === 'AMBER', 'snapshot carries date + PPI + band');
  check(rowFull.demand === 151 && rowFull.slotsRemaining === 50 && rowFull.urgent === 2 && rowFull.tasksGt8h === 1, 'snapshot reuses live fields');
  const rowSparse = m.buildSnapshotRow({ requestMonitor: { unavailable: true } }, null, '2026-06-16');
  check(rowSparse.date === '2026-06-16' && !('ppi' in rowSparse) && !('urgent' in rowSparse), 'omits fields it cannot derive (no fabrication)');

  console.log(`\n${passed} passed, ${failed} failed`);
})();
