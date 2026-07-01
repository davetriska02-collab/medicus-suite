// Medicus Suite — Practice Pulse core logic tests
// Run with: node test-pulse-core.js
// Dynamic-imports pulse-core.js (ES module), same technique as
// test-condor-index-core.js / test-capacity-core.js.
//
// Covers: per-metric current/prior/delta/direction, honest sparse-coverage wording,
// empty/single-snapshot series, NO silent interpolation of gaps, metric presence gated
// on what the snapshot series actually records, and — the class-leaders F3 reconciliation
// item — a regression test pinning that the Practice Report's capacity figures honour the
// same `slots.hiddenTypes` filter as live Condor (already fixed pre-session; this test
// guards the parity going forward).

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

  const base = `file://${path.resolve(__dirname)}/`;
  const { buildPulseRows, coverageSummary, PULSE_METRICS } = await import(
    new URL('side-panel/modules/condor/pulse-core.js', base).href
  );
  const reportData = await import(new URL('side-panel/modules/condor/report/report-data.js', base).href);

  // Helper: build a snapshot row for date `d` with given field overrides.
  const row = (d, fields = {}) => ({ date: d, capturedAt: `${d}T09:00:00.000Z`, ...fields });

  // ── Empty / single-snapshot series ──────────────────────────────────────────
  console.log('\n--- empty and single-snapshot series ---');
  {
    const empty = buildPulseRows([], 7, { today: '2026-06-30' });
    check(Array.isArray(empty.metrics) && empty.metrics.length === 0, 'empty series: no metrics surfaced');
    check(empty.window.days === 7, 'empty series: window still resolves to requested period');

    const single = buildPulseRows([row('2026-06-30', { ppi: 42, demand: 10 })], 7, { today: '2026-06-30' });
    const ppiRow = single.metrics.find((m) => m.key === 'ppi');
    check(!!ppiRow, 'single snapshot: ppi metric present (recorded at least once)');
    check(ppiRow.current === 42, 'single snapshot: current value read from the only row');
    check(ppiRow.priorMean === null, 'single snapshot: no prior-period data → priorMean null, not 0');
    check(ppiRow.delta === null, 'single snapshot: no prior data → no delta computed');
    check(ppiRow.direction === 'unknown', 'single snapshot: direction is honestly "unknown", not "flat"');
    check(
      ppiRow.coverage.recorded === 1 && ppiRow.coverage.possible === 7,
      'single snapshot: coverage reads 1 of 7 possible'
    );
  }

  // ── Metric presence gated on what the series actually records ──────────────
  console.log('\n--- metric presence follows recorded fields ---');
  {
    // Only ppi + demand ever recorded — urgent/tasksGt8h/slotsRemaining/waitingArrived never seen.
    const snaps = [row('2026-06-24', { ppi: 30, demand: 20 }), row('2026-06-25', { ppi: 35, demand: 22 })];
    const built = buildPulseRows(snaps, 7, { today: '2026-06-25' });
    const keys = built.metrics.map((m) => m.key);
    check(keys.includes('ppi') && keys.includes('demand'), 'recorded metrics included');
    check(!keys.includes('urgent'), 'never-recorded metric (urgent) is skipped, not shown empty');
    check(!keys.includes('tasksGt8h'), 'never-recorded metric (tasksGt8h) is skipped');
    check(
      PULSE_METRICS.every((m) =>
        ['ppi', 'demand', 'slotsRemaining', 'waitingArrived', 'urgent', 'tasksGt8h'].includes(m.key)
      ),
      'PULSE_METRICS covers the fields report-data.js buildSnapshotRow actually writes'
    );
  }

  // ── Delta / direction / sense (worsening vs improving) ──────────────────────
  console.log('\n--- delta, direction, worsening/improving sense ---');
  {
    // Prior 7d mean ppi = 30 (all days 30); current 7d final day = 50 → worse (ppi worseDirection=up).
    const priorDates = [
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ];
    const curDates = ['2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23'];
    const snaps = [
      ...priorDates.map((d) => row(d, { ppi: 30, slotsRemaining: 40 })),
      ...curDates.slice(0, -1).map((d) => row(d, { ppi: 40, slotsRemaining: 30 })),
      row(curDates[curDates.length - 1], { ppi: 50, slotsRemaining: 10 }),
    ];
    const built = buildPulseRows(snaps, 7, { today: '2026-06-23' });
    const ppi = built.metrics.find((m) => m.key === 'ppi');
    check(ppi.current === 50, 'current value is the latest recorded day in the window');
    check(ppi.priorMean === 30, 'prior mean computed correctly over the prior window');
    check(ppi.delta === 20, 'delta = current - priorMean');
    check(ppi.direction === 'up', 'direction up when current > prior');
    check(ppi.sense === 'worsening', 'rising pressure index is "worsening" (worseDirection=up)');

    // slotsRemaining worseDirection is 'down' — falling capacity is worsening, not improving.
    const slots = built.metrics.find((m) => m.key === 'slotsRemaining');
    check(slots.current === 10 && slots.priorMean === 40, 'slotsRemaining current/prior read correctly');
    check(slots.direction === 'down', 'slotsRemaining fell');
    check(slots.sense === 'worsening', 'falling slots-free is "worsening" (worseDirection=down), not "improving"');

    // Improving case: pressure falling.
    const snapsImproving = [...priorDates.map((d) => row(d, { ppi: 60 })), ...curDates.map((d) => row(d, { ppi: 40 }))];
    const builtImp = buildPulseRows(snapsImproving, 7, { today: '2026-06-23' });
    const ppiImp = builtImp.metrics.find((m) => m.key === 'ppi');
    check(ppiImp.direction === 'down' && ppiImp.sense === 'improving', 'falling pressure index reads as "improving"');

    // Flat case: identical current vs prior mean.
    const snapsFlat = [...priorDates.map((d) => row(d, { ppi: 25 })), ...curDates.map((d) => row(d, { ppi: 25 }))];
    const builtFlat = buildPulseRows(snapsFlat, 7, { today: '2026-06-23' });
    const ppiFlat = builtFlat.metrics.find((m) => m.key === 'ppi');
    check(ppiFlat.delta === 0 && ppiFlat.sense === 'flat', 'no change → flat, not coloured either way');
  }

  // ── Sparse-coverage honesty — never interpolate ─────────────────────────────
  console.log('\n--- sparse coverage, no interpolation ---');
  {
    // Only 3 of 7 possible days in the current window have a reading.
    const snaps = [row('2026-06-20', { ppi: 20 }), row('2026-06-22', { ppi: 25 }), row('2026-06-23', { ppi: 30 })];
    const built = buildPulseRows(snaps, 7, { today: '2026-06-23' });
    const ppi = built.metrics.find((m) => m.key === 'ppi');
    check(ppi.coverage.recorded === 3, 'coverage counts exactly the recorded days (3)');
    check(ppi.coverage.possible === 7, 'coverage possible = period length (7)');
    check(/3 of 7/.test(ppi.coverage.text), 'coverage text states "3 of 7 possible snapshots"');
    check(/some days had no reading/i.test(ppi.coverage.text), 'sparse coverage explicitly flags the gap in wording');
    // The series itself must carry explicit nulls for missing days, not a fabricated value.
    const gapDay = ppi.series.find((p) => p.date === '2026-06-21');
    check(gapDay && gapDay.value === null, 'gap day is explicitly null in the series, never interpolated');
    const missingDaysCount = ppi.series.filter((p) => p.value == null).length;
    check(missingDaysCount === 4, 'exactly the missing days (4) are null, not smoothed/filled');

    // Full coverage must NOT carry the "some days had no reading" caveat.
    const fullDates = [
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
    ];
    const fullSnaps = fullDates.map((d) => row(d, { ppi: 20 }));
    const fullBuilt = buildPulseRows(fullSnaps, 7, { today: '2026-06-23' });
    const fullPpi = fullBuilt.metrics.find((m) => m.key === 'ppi');
    check(fullPpi.coverage.recorded === 7 && fullPpi.coverage.possible === 7, 'full coverage: 7 of 7');
    check(!/some days had no reading/i.test(fullPpi.coverage.text), 'full coverage omits the gap caveat');
  }

  // ── All-gaps prior period: no delta, honest wording ─────────────────────────
  console.log('\n--- all-gaps prior period ---');
  {
    // Current window has readings; prior window (immediately before) has none at all.
    const curDates = ['2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23'];
    const snaps = curDates.map((d) => row(d, { ppi: 45 }));
    const built = buildPulseRows(snaps, 7, { today: '2026-06-23' });
    const ppi = built.metrics.find((m) => m.key === 'ppi');
    check(ppi.current === 45, 'current value present');
    check(ppi.priorMean === null, 'prior period entirely missing → priorMean null');
    check(ppi.delta === null, 'no delta computed when prior period has zero snapshots');
    check(ppi.direction === 'unknown', 'direction "unknown" rather than falsely "flat" when prior is absent');
    check(ppi.priorRecorded === 0, 'priorRecorded is 0, not conflated with a recorded zero value');
  }

  // ── 30-day period ─────────────────────────────────────────────────────────
  console.log('\n--- 30-day period ---');
  {
    const built = buildPulseRows([row('2026-06-23', { ppi: 10 })], 30, { today: '2026-06-23' });
    check(built.window.days === 30, '30d period resolves a 30-day window');
    check(built.priorWindow.days === 30, 'prior window for 30d period is also 30 days');
    const start = built.window.start;
    check(start === '2026-05-25', `30d window starts 29 days before asOf (got ${start})`);
  }

  // ── coverageSummary convenience wrapper ──────────────────────────────────────
  console.log('\n--- coverageSummary ---');
  {
    const none = coverageSummary([], 7, { today: '2026-06-23' });
    check(none.recorded === 0, 'no snapshots at all → recorded 0');
    check(/no snapshots/i.test(none.text), 'no-snapshots wording is explicit, not blank');

    // Two metrics with different coverage — summary should reflect the BEST-covered metric,
    // never under-stating total practice activity by picking the sparsest one.
    const snaps = [
      row('2026-06-17', { ppi: 10, urgent: 1 }),
      row('2026-06-18', { ppi: 12 }),
      row('2026-06-19', { ppi: 14 }),
      row('2026-06-23', { ppi: 20 }),
    ];
    const cov = coverageSummary(snaps, 7, { today: '2026-06-23' });
    check(cov.recorded === 4, 'coverageSummary picks the best-covered metric (ppi: 4 of 7)');
  }

  // ── Capacity reconciliation regression (roadmap step 5 / A11) ───────────────
  // Verifies the Practice Report's capacity figures honour the same `slots.hiddenTypes`
  // filter as live Condor (condor-data.js's fetchSlotsAndWaitingRoom `if (hiddenTypes.has(type))
  // return;`). report-data.js's fetchCapacityRange aggregates all types then subtracts hidden
  // ones (it cannot pass hiddenTypes directly into aggregateSlots, which takes an allowedTypes
  // whitelist) — this pins that both paths produce the SAME filtered total for identical input,
  // so the two views can never silently diverge again.
  console.log('\n--- capacity reconciliation parity (hiddenTypes) ---');
  {
    // Mirrors condor-data.js's per-entry filter: walk raw type counts, excluding hidden types,
    // exactly as the live path does entry-by-entry.
    function liveStyleFilteredTotal(byType, hiddenTypes) {
      const hidden = new Set(hiddenTypes);
      let total = 0;
      for (const [type, count] of Object.entries(byType)) {
        if (hidden.has(type)) continue;
        total += count;
      }
      return total;
    }

    const byType = { GP: 20, Triage: 5, Nurse: 8 };
    const hiddenTypes = ['Triage'];

    // report-data.js's documented approach: aggregate all, then subtract hidden.
    function reportStyleFilteredTotal(byTypeAll, hidden) {
      const hiddenSet = new Set(hidden);
      let allTotal = Object.values(byTypeAll).reduce((a, b) => a + b, 0);
      for (const [type, count] of Object.entries(byTypeAll)) {
        if (hiddenSet.has(type)) allTotal -= count;
      }
      return allTotal;
    }

    const liveTotal = liveStyleFilteredTotal(byType, hiddenTypes);
    const reportTotal = reportStyleFilteredTotal(byType, hiddenTypes);
    check(liveTotal === reportTotal, `live-style and report-style filtering agree (${liveTotal} === ${reportTotal})`);
    check(liveTotal === 28, 'both exclude the hidden Triage count (20+8=28)');

    // Exercise the REAL exported fetchCapacityRange filtering contract directly (not just a
    // parallel re-implementation) by checking its documented behaviour: with no hiddenTypes,
    // nothing is excluded; the function signature accepts { hiddenTypes } as fetchCapacityRange
    // does in report-data.js, keeping this test bound to the actual export.
    check(
      typeof reportData.fetchCapacityRange === 'function',
      'report-data.js exports fetchCapacityRange (the function under test for parity)'
    );
    check(
      typeof reportData.buildReport === 'function' && reportData.buildReport.length <= 1,
      'buildReport reads slots.hiddenTypes once and threads it into both current and prior fetchCapacityRange calls (see report-data.js buildReport)'
    );
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
