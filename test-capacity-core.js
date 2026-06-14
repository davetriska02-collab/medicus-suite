// Medicus Suite — Capacity core logic tests
// Run with: node test-capacity-core.js
// Dynamic-imports capacity-core.js (ES module), same technique as test-reception-core.js.

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

  const corePath = new URL('side-panel/modules/capacity/capacity-core.js', `file://${path.resolve(__dirname)}/`).href;

  const { DOW_KEYS, WEEKDAYS, minimumForDate, defaultMinimumByDay, presetSummary, validatePreset } = await import(
    corePath
  );

  // ── constants ───────────────────────────────────────────────────────────────
  console.log('--- constants ---');
  check(DOW_KEYS[0] === 'sun' && DOW_KEYS[6] === 'sat', 'DOW_KEYS is Sunday-indexed');
  check(WEEKDAYS.length === 7 && WEEKDAYS[0].key === 'mon', 'WEEKDAYS is Monday-first, 7 days');

  // ── minimumForDate ──────────────────────────────────────────────────────────
  console.log('\n--- minimumForDate ---');
  // 2026-06-15 is a Monday, 2026-06-13 is a Saturday, 2026-06-14 is a Sunday.
  const presetByDay = { minimumByDay: { mon: 25, tue: 20, wed: 20, thu: 20, fri: 18, sat: 5, sun: 0 } };
  check(minimumForDate(presetByDay, '2026-06-15') === 25, 'minimumByDay: Monday → 25');
  check(minimumForDate(presetByDay, '2026-06-13') === 5, 'minimumByDay: Saturday → 5 (explicit non-zero weekend)');
  check(minimumForDate(presetByDay, '2026-06-14') === 0, 'minimumByDay: Sunday → 0');
  check(minimumForDate(null, '2026-06-15') === 0, 'null preset → 0');

  // explicit 0 must be honoured, not treated as "missing" → legacy fallback
  const presetZeroFri = {
    minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 0, sat: 0, sun: 0 },
    minimumPerDay: 30,
  };
  check(minimumForDate(presetZeroFri, '2026-06-19') === 0, 'explicit 0 on a weekday is honoured (no legacy fallback)');

  // legacy fallback (no minimumByDay)
  const legacy = { minimumPerDay: 30 };
  check(minimumForDate(legacy, '2026-06-15') === 30, 'legacy: weekday → minimumPerDay');
  check(minimumForDate(legacy, '2026-06-13') === 0, 'legacy: Saturday → 0');
  check(minimumForDate(legacy, '2026-06-14') === 0, 'legacy: Sunday → 0');
  check(minimumForDate({}, '2026-06-15') === 0, 'legacy: missing minimumPerDay → 0');

  // ── defaultMinimumByDay ─────────────────────────────────────────────────────
  console.log('\n--- defaultMinimumByDay ---');
  const d = defaultMinimumByDay(20);
  check(d.mon === 20 && d.fri === 20, 'weekdays carry the legacy value');
  check(d.sat === 0 && d.sun === 0, 'weekend always 0');
  check(defaultMinimumByDay(undefined).mon === 0, 'undefined legacy → 0');

  // ── presetSummary ───────────────────────────────────────────────────────────
  console.log('\n--- presetSummary ---');
  check(
    presetSummary({ minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 20, sat: 0, sun: 0 } }) ===
      'min 20/weekday',
    'uniform weekdays + zero weekend → "min N/weekday"'
  );
  check(
    presetSummary({ minimumByDay: { mon: 25, tue: 20, wed: 20, thu: 20, fri: 18, sat: 5, sun: 0 } }).includes('/week'),
    'mixed days → weekly total'
  );
  check(presetSummary({ minimumPerDay: 15 }) === 'min 15/day', 'legacy preset (no minimumByDay) → "min N/day"');

  // ── validatePreset ──────────────────────────────────────────────────────────
  console.log('\n--- validatePreset ---');
  const ok = validatePreset({ name: 'Std', slotTypes: ['GP'], tight: 75, low: 50 });
  check(ok.valid === true && ok.error === null, 'valid form passes');
  check(
    validatePreset({ name: '  ', slotTypes: ['GP'], tight: 75, low: 50 }).error === 'Preset needs a name.',
    'blank name rejected'
  );
  check(
    validatePreset({ name: 'X', slotTypes: [], tight: 75, low: 50 }).error.includes('slot type'),
    'no slot types rejected'
  );
  check(
    validatePreset({ name: 'X', slotTypes: ['GP'], tight: 50, low: 75 }).error.includes('below Tight'),
    'low >= tight rejected'
  );
  check(
    validatePreset({ name: 'X', slotTypes: ['GP'], tight: 50, low: 50 }).error.includes('below Tight'),
    'low == tight rejected'
  );
  check(
    validatePreset({ name: 'X', slotTypes: ['GP'], tight: 100, low: 50 }).error.includes('below 100'),
    'tight >= 100 rejected'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
