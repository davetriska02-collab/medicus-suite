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

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
