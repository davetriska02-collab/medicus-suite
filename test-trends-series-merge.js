// Medicus Suite — Trends non-BP series safe multi-row merge regression tests
// Run with: node test-trends-series-merge.js
//
// Guards the v3.264.20 fix: the non-BP series builders (seriesFor for
// HbA1c/cholesterol/weight, buildRenalModel's ACR/eGFR rows) used
// history.find() — FIRST name-matching observationHistory row only — so a
// reading recorded under a second display name was silently dropped, the
// same defect buildBpModel fixed for BP in v3.264.3. Unlike BP (where
// parseBp gates what merges), blindly merging every matching row would draw
// one line across two value scales (HbA1c mmol/mol + %, or a unit-less
// journal group), so collectSeriesPoints applies a safe de-duplication only:
//   - the FIRST matching row stays authoritative (labels the series, wins
//     same-date collisions — dashboard rows precede journal groups);
//   - extra rows fold in ONLY when their unit is IDENTICAL to the first
//     row's; unit-less or different-unit rows contribute nothing.
//
// Extraction-with-stubs technique as in test-trends-bp-merge.js.

'use strict';
const fs = require('fs');
const path = require('path');

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

// ── extract seriesFor + helpers from trends.js source ────────────────────────
const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');

const pieces = {
  OBS_METRICS: trendsSrc.match(/const OBS_METRICS = \[[\s\S]*?\n\];/),
  isBelowLimit: trendsSrc.match(/function isBelowLimit\([\s\S]*?\n\}/),
  collectSeriesPoints: trendsSrc.match(/function collectSeriesPoints\([\s\S]*?\n\}/),
  seriesFor: trendsSrc.match(/function seriesFor\([\s\S]*?\n\}/),
};
Object.entries(pieces).forEach(([name, m]) => check(!!m, `${name} extracted from trends.js`));
if (Object.values(pieces).some((m) => !m)) {
  console.error('FATAL: source extraction failed — cannot continue');
  process.exitCode = 1;
  return;
}

const { seriesFor, OBS_METRICS, collectSeriesPoints } = new Function(
  `'use strict';\n${Object.values(pieces)
    .map((m) => m[0])
    .join('\n')}\nreturn { seriesFor, OBS_METRICS, collectSeriesPoints };`
)();

const HBA1C = OBS_METRICS.find((m) => m.key === 'hba1c');
const WEIGHT = OBS_METRICS.find((m) => m.key === 'weight');

function row(name, unit, points) {
  return { name, code: null, group: null, unit, history: points };
}
const pt = (date, value, rawValue) => ({
  date,
  value,
  rawValue: rawValue == null ? String(value) : rawValue,
  isAbove: false,
  isBelow: false,
  source: 'test',
});

console.log('\n--- same-unit second row merges (the dropped-reading fix) ---');
{
  const { pts, unit } = seriesFor(HBA1C, {
    observationHistory: [
      row('HbA1c', 'mmol/mol', [pt('2026-01-05', 58)]),
      row('Haemoglobin A1c level', 'mmol/mol', [pt('2026-06-01', 61)]),
    ],
  });
  check(pts.length === 2, `both same-unit rows contribute (got ${pts.length} points)`);
  check(pts[pts.length - 1].value === 61, "the second display name's newer reading is now the latest");
  check(unit === 'mmol/mol', "unit stays the first row's");
  check(
    pts.every((p, i) => i === 0 || pts[i - 1].date <= p.date),
    'points stay oldest-first (chart contract unchanged)'
  );
}

console.log('\n--- different-unit second row is EXCLUDED (no multi-scale plot) ---');
{
  const { pts, unit } = seriesFor(HBA1C, {
    observationHistory: [
      row('HbA1c', 'mmol/mol', [pt('2026-01-05', 58)]),
      row('HbA1c (DCCT)', '%', [pt('2026-06-01', 7.4)]),
    ],
  });
  check(pts.length === 1 && pts[0].value === 58, 'a %-unit row never merges into a mmol/mol series');
  check(unit === 'mmol/mol', 'series unit is untouched by the rejected row');
}

console.log('\n--- unit-less second row is EXCLUDED (journal groups stay out) ---');
{
  const { pts } = seriesFor(WEIGHT, {
    observationHistory: [
      row('Weight', 'kg', [pt('2026-01-05', 80)]),
      row('O/E - weight', null, [pt('2026-06-01', 12)]), // journal-created group, scale unverifiable
    ],
  });
  check(pts.length === 1 && pts[0].value === 80, 'a unit-less extra row contributes nothing');
}

console.log('\n--- unit-less FIRST row never gains extra rows ---');
{
  const { pts } = collectSeriesPoints(
    [row('Weight', null, [pt('2026-01-05', 80)]), row('Body weight', 'kg', [pt('2026-06-01', 81)])],
    (o) => /weight/i.test(o.name)
  );
  check(pts.length === 1 && pts[0].value === 80, "no merge when the first row's unit is unknown");
}

console.log('\n--- same-date collision: FIRST (dashboard) row wins ---');
{
  const { pts } = seriesFor(HBA1C, {
    observationHistory: [
      row('HbA1c', 'mmol/mol', [pt('2026-06-01', 58)]),
      row('Haemoglobin A1c level', 'mmol/mol', [pt('2026-06-01', 99), pt('2026-07-01', 60)]),
    ],
  });
  check(pts.length === 2, `same-date readings de-dupe to one (got ${pts.length})`);
  check(pts[0].value === 58, "on a date collision the first row's reading is kept");
  check(pts[1].value === 60, "the extra row's new date still contributes");
}

console.log('\n--- single-row behaviour unchanged (regression) ---');
{
  const { pts, unit } = seriesFor(HBA1C, {
    observationHistory: [row('HbA1c', 'mmol/mol', [pt('2026-06-01', 61), pt('2026-01-05', 58)])],
  });
  check(pts.length === 2 && pts[0].value === 58 && pts[1].value === 61, 'newest-first history renders oldest-first');
  check(unit === 'mmol/mol', 'row unit still reported');
}
{
  const { pts, unit } = seriesFor(HBA1C, { observationHistory: [] });
  check(pts.length === 0 && unit === HBA1C.unit, 'no matching row → empty series with the metric default unit');
}

console.log('\n--- non-numeric points still filtered ---');
{
  const { pts } = seriesFor(HBA1C, {
    observationHistory: [
      row('HbA1c', 'mmol/mol', [pt('2026-06-01', NaN, 'Insufficient sample'), pt('2026-01-05', 58)]),
    ],
  });
  check(pts.length === 1 && pts[0].value === 58, 'NaN values never reach the chart');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
