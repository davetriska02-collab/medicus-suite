// Medicus Suite — Trends renal A-staging of "<X" ACR reports
// Run with: node test-trends-acr-below-limit.js
//
// Guards the v3.264.20 fix: a lab ACR reported as "<3" (the standard
// below-detection report, mg/mmol) parses to the numeric limit 3 — the
// comparator is stripped by parseObservationValue and survives only in
// rawValue — so aStage(3) staged it A2 ("3–30") when the true value is below
// 3 and therefore A1 (normal). buildRenalModel must now read the comparator
// out of rawValue and stage "<3" as A1, WITHOUT weakening any other boundary:
// a plain 3.0 is still A2, and an ambiguous "<10" keeps the limit's stage.
//
// buildRenalModel lives inside an ES module that imports browser-context
// dependencies, so — like test-trends-bp-merge.js — the functions are
// extracted from source and evaluated with stubs, rather than imported.

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

// ── extract buildRenalModel + its dependencies from trends.js source ─────────
const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');

const pieces = {
  ACR_NAMES: trendsSrc.match(/const ACR_NAMES = \[[^\]]*\];/),
  EGFR_NAMES: trendsSrc.match(/const EGFR_NAMES = \[[^\]]*\];/),
  KDIGO: trendsSrc.match(/const KDIGO = \{[\s\S]*?\n\};/),
  gStage: trendsSrc.match(/function gStage\([\s\S]*?\n\}/),
  aStage: trendsSrc.match(/function aStage\([\s\S]*?\n\}/),
  isBelowLimit: trendsSrc.match(/function isBelowLimit\([\s\S]*?\n\}/),
  collectSeriesPoints: trendsSrc.match(/function collectSeriesPoints\([\s\S]*?\n\}/),
  buildRenalModel: trendsSrc.match(/function buildRenalModel\([\s\S]*?\n\}/),
};
Object.entries(pieces).forEach(([name, m]) => check(!!m, `${name} extracted from trends.js`));
if (Object.values(pieces).some((m) => !m)) {
  console.error('FATAL: source extraction failed — cannot continue');
  process.exitCode = 1;
  return;
}

const buildRenalModel = new Function(
  `'use strict';\n${Object.values(pieces)
    .map((m) => m[0])
    .join('\n')}\nreturn buildRenalModel;`
)();

// observationHistory contract: history points newest-first, numeric `value`
// with the comparator stripped, original string preserved in `rawValue`.
function acrRow(points) {
  return { name: 'Albumin creatinine ratio', code: null, group: null, unit: 'mg/mmol', history: points };
}
const pt = (date, rawValue, value) => ({ date, value, rawValue, isAbove: false, isBelow: false, source: 'test' });

console.log('\n--- "<3" latest ACR stages A1, not A2 ---');
{
  const m = buildRenalModel({
    observationHistory: [acrRow([pt('2026-06-01', '<3', 3), pt('2026-01-10', '5.2', 5.2)])],
  });
  check(m.latestAcr === 3, `latest numeric value is the stripped limit 3 (got ${m.latestAcr})`);
  check(m.latestAcrBelow === true, 'latestAcrBelow carries the "<" comparator from rawValue');
  check(m.as === 'A1', `"<3" stages A1 (got ${m.as}) — an ACR below 3 mg/mmol is normal`);
}

console.log('\n--- plain 3.0 still stages A2 (boundary unchanged) ---');
{
  const m = buildRenalModel({
    observationHistory: [acrRow([pt('2026-06-01', '3', 3)])],
  });
  check(m.as === 'A2', `a measured 3.0 is still A2 (got ${m.as})`);
  check(m.latestAcrBelow === false, 'no comparator → latestAcrBelow false');
}

console.log('\n--- ambiguous "<10" keeps the limit stage A2 ---');
{
  const m = buildRenalModel({
    observationHistory: [acrRow([pt('2026-06-01', '<10', 10)])],
  });
  check(m.as === 'A2', `"<10" could be A1 or A2 — the unproven lower stage is never claimed (got ${m.as})`);
}

console.log('\n--- category-crossing banner sees the true previous stage ---');
{
  // prev "<3" is A1; latest 8 is A2 → the crossing banner must fire.
  // Before the fix prev staged A2, so A1→A2 progression was invisible.
  const m = buildRenalModel({
    observationHistory: [acrRow([pt('2026-06-01', '8', 8), pt('2026-01-10', '<3', 3)])],
  });
  check(m.as === 'A2', `latest 8 stages A2 (got ${m.as})`);
  check(m.crossingFlag === true, 'crossing A1→A2 from a "<3" baseline now flags');
}
{
  // prev 2.9 (A1) → latest "<3" (A1): no crossing.
  const m = buildRenalModel({
    observationHistory: [acrRow([pt('2026-06-01', '<3', 3), pt('2026-01-10', '2.9', 2.9)])],
  });
  check(m.crossingFlag === false, 'A1 → "<3" (still A1) does not flag a crossing');
}

console.log('\n--- KDIGO cell combines G-stage with the corrected A-stage ---');
{
  const m = buildRenalModel({
    observationHistory: [
      acrRow([pt('2026-06-01', '<3', 3)]),
      { name: 'eGFR', code: null, group: null, unit: 'mL/min/1.73m²', history: [pt('2026-06-01', '50', 50)] },
    ],
  });
  check(m.gs === 'G3a' && m.as === 'A1', `eGFR 50 + ACR "<3" → G3aA1 (got ${m.gs}${m.as})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
