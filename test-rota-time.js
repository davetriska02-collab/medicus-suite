// Medicus Suite — Rota time tests (ported from medicus-rota-manager)
// Run with: node test-rota-time.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { mondayOf, addDays, weekDates, dayKey, templateWeekIndex, leaveYearStart, datesInRange, diffDays } =
    await R('shared/time.js');

  /* ---- original test body, unchanged ---- */
  assert.equal(mondayOf('2026-06-10'), '2026-06-08'); // Wed -> Mon
  assert.equal(mondayOf('2026-06-08'), '2026-06-08'); // Mon -> itself
  assert.equal(mondayOf('2026-06-14'), '2026-06-08'); // Sun -> previous Mon
  assert.equal(addDays('2026-06-30', 1), '2026-07-01'); // month rollover
  assert.equal(addDays('2026-01-01', -1), '2025-12-31'); // year rollover
  assert.equal(diffDays('2026-06-08', '2026-06-15'), 7);
  assert.equal(weekDates('2026-06-08').length, 7);
  assert.equal(weekDates('2026-06-08')[6], '2026-06-14');
  assert.equal(dayKey('2026-06-08'), 'mon');
  assert.equal(dayKey('2026-06-13'), 'sat');

  // 2-week pattern: anchor week is 0, next week is 1, wraps after that.
  assert.equal(templateWeekIndex('2026-06-08', '2026-06-10', 2), 0);
  assert.equal(templateWeekIndex('2026-06-08', '2026-06-15', 2), 1);
  assert.equal(templateWeekIndex('2026-06-08', '2026-06-22', 2), 0);
  // Dates before the anchor wrap correctly (no negative index).
  assert.equal(templateWeekIndex('2026-06-08', '2026-06-01', 2), 1);
  assert.equal(templateWeekIndex('2026-06-08', '2026-06-10', 1), 0);

  // NHS leave year: April–March.
  assert.equal(leaveYearStart('2026-06-10'), '2026-04-01');
  assert.equal(leaveYearStart('2026-03-31'), '2025-04-01');
  assert.equal(leaveYearStart('2026-04-01'), '2026-04-01');

  assert.deepEqual(datesInRange('2026-06-08', '2026-06-10'), ['2026-06-08', '2026-06-09', '2026-06-10']);

  console.log('test-time: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
