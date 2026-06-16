// Medicus Suite — Condor request-monitor state bridge tests
// Run with: node test-condor-rm-state.js
//
// Regression guard for the v3.40.1 fix: Condor previously fetched a
// non-existent /admin/data/request-monitor endpoint; the 404 made a
// fully-configured task inbox render as "Task inbox not configured".
// Condor now reads the cached poll state the service worker writes
// (suite.requestMonitor.state) via buildRequestMonitorFromState().

'use strict';

const path = require('path');

(async () => {
  let passed = 0, failed = 0;
  function check(cond, msg) {
    if (cond) { console.log(`  OK  ${msg}`); passed++; }
    else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
  }

  const modPath = new URL(
    'side-panel/modules/condor/condor-data.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const { buildRequestMonitorFromState } = await import(modPath);

  // ── Unavailable states (configured but no usable data — must be flagged,
  //    never rendered as "not configured" and never as a clean zero) ──────────
  console.log('--- unavailable states ---');
  let r = buildRequestMonitorFromState(undefined);
  check(r.unavailable === true, 'missing state → unavailable, not a clean result');
  r = buildRequestMonitorFromState({ buckets: {}, lastPoll: null });
  check(r.unavailable === true && /no poll data/.test(r.reason), 'never-polled state → unavailable with reason');
  r = buildRequestMonitorFromState({ buckets: {}, lastPoll: Date.now(), error: 'HTTP 401' });
  check(r.unavailable === true && r.reason === 'HTTP 401', 'state.error surfaced as unavailable reason');

  // ── Usable state ─────────────────────────────────────────────────────────────
  console.log('\n--- usable state ---');
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const state = {
    lastPoll: now,
    error: null,
    buckets: {
      medNew: { count: 2, items: [
        { id: 't1', patient: 'AB', summary: 'Med request', priority: 'Urgent',  createdAt: iso(30 * 60000) },      // <1h
        { id: 't2', patient: 'CD', summary: 'Med request', priority: 'Routine', createdAt: iso(5 * 3600000) },     // 4–8h
      ]},
      adminNew: { count: 1, items: [
        { id: 't3', patient: 'EF', summary: 'Admin request', priority: 'Routine', createdAt: iso(10 * 3600000) },  // >8h
      ]},
      medReply: { count: 0, items: [] },
    },
  };
  r = buildRequestMonitorFromState(state);
  check(!r.unavailable, 'valid state → usable');
  check(r.totalCount === 3, 'items flattened across all buckets');
  check(r.urgentCount === 1, 'urgent count from priority match');
  check(r.byAgeBucket.lt1h === 1 && r.byAgeBucket.h4to8 === 1 && r.byAgeBucket.gt8h === 1, 'age buckets computed from createdAt');
  check(r.lastPoll === now, 'lastPoll carried through');

  // Empty-but-polled inbox is a CLEAN ZERO (renders "No open tasks"), not unavailable.
  r = buildRequestMonitorFromState({ lastPoll: now, error: null, buckets: { medNew: { count: 0, items: [] } } });
  check(!r.unavailable && r.totalCount === 0, 'polled empty inbox → clean zero, not unavailable');

  // ── PPI band-floor (UX fix) ──────────────────────────────────────────────────
  // The raw index weights capacity at only 20%, so a quiet morning with a low PPI
  // could read GREEN while demand has already passed available slots. The displayed
  // band must floor to AMBER (never GREEN) whenever demand >= capacity — only ever
  // raising a signal, never lowering one.
  console.log('\n--- PPI band-floor ---');
  const condorPath = new URL(
    'side-panel/modules/condor/condor.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const { computeIndex } = await import(condorPath);

  // Low pressure but demand (115) far over free slots (50): raw GREEN, floored AMBER.
  let idx = computeIndex({
    submissions: { totals: { medical: 100, admin: 15, all: 115 } },
    slots: { totalRemaining: 50 },
    waitingRoom: { arrivedCount: 0 },
    requestMonitor: null,
    capacityPreset: null,
  });
  check(idx.rawBand === 'GREEN', 'raw band is GREEN on a quiet-index, over-capacity day');
  check(idx.band === 'AMBER', 'displayed band floored to AMBER — never GREEN — when over capacity');
  check(idx.floored === true && idx.overCapacity === true, 'floored + overCapacity flags set');
  check(idx.demandCount === 115 && idx.capacityCount === 50, 'demand/capacity counts surfaced for headline');

  // No slots left with demand still arriving is also over-capacity.
  idx = computeIndex({
    submissions: { totals: { medical: 3, admin: 0, all: 3 } },
    slots: { totalRemaining: 0 },
    waitingRoom: { arrivedCount: 0 },
    requestMonitor: null,
    capacityPreset: null,
  });
  check(idx.band !== 'GREEN', 'zero free slots with open demand never reads GREEN');

  // Genuinely quiet day with spare capacity stays GREEN — the floor must not over-fire.
  idx = computeIndex({
    submissions: { totals: { medical: 5, admin: 2, all: 7 } },
    slots: { totalRemaining: 40 },
    waitingRoom: { arrivedCount: 0 },
    requestMonitor: null,
    capacityPreset: null,
  });
  check(idx.band === 'GREEN' && idx.floored === false, 'spare-capacity quiet day stays GREEN (no false floor)');

  // Numeric PPI is never altered by the floor — only the band is raised.
  idx = computeIndex({
    submissions: { totals: { medical: 100, admin: 15, all: 115 } },
    slots: { totalRemaining: 50 },
    waitingRoom: { arrivedCount: 0 },
    requestMonitor: null,
    capacityPreset: null,
  });
  check(idx.ppi < 40, 'numeric ppi left as-is (still under 40) — only the band is floored');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
