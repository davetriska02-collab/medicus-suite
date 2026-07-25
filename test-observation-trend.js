// Sentinel — observation-trend check-kind tests
// Run with:  node test-observation-trend.js
// All tests must pass before shipping.
//
// Covers evaluateQofIndicatorRule's `check.kind === 'observation-trend'` branch
// (engine/rules-engine.js). Before this file the branch had NO functional test
// coverage — only schema-validation (test-rule-schema.js) and import-rejection
// (test-import-hardening.js) referenced the kind, neither of which executes any
// evaluation logic. Two enabled shipped rules depend on it:
//   • trend-egfr-falling  (NICE NG203 — falling eGFR, minDelta 15 over 24 mo)
//   • trend-hba1c-rising  (NICE NG28/NG17 — rising HbA1c, minDelta 10 over 24 mo)
//
// A regression here is silent: the chip either stops appearing for a genuinely
// deteriorating patient, or fires on every patient with any lab movement.

'use strict';

const engine = require('./engine/rules-engine.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

const NOW = '2026-07-25T10:00:00Z';

// Days before NOW, as an ISO date string (YYYY-MM-DD).
function daysAgo(n) {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Build an observationHistory entry. `points` are given OLDEST-FIRST for
// readability, then reversed — the normaliser emits history newest-first and
// the evaluator relies on that ordering (inWindow[0] = newest).
function makeHistory(name, unit, points) {
  return {
    name,
    code: null,
    group: null,
    unit,
    history: points
      .map((p) => ({
        date: p.date,
        value: p.value,
        rawValue: String(p.value),
        isAbove: false,
        isBelow: false,
        source: 'test',
      }))
      .reverse(),
  };
}

function makeTrendRule(overrides = {}) {
  const { check: checkOverrides, ...rest } = overrides;
  return {
    id: 'trend-test',
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'TREND-TEST',
    indicatorName: 'Test trend',
    requiresRegister: null,
    sex: 'any',
    useQofYearFloor: false,
    check: {
      kind: 'observation-trend',
      observation: ['egfr'],
      direction: 'falling',
      minPoints: 3,
      withinMonths: 24,
      minDelta: 15,
      ...checkOverrides,
    },
    source: 'test',
    ...rest,
  };
}

function evaluate(observationHistory, ruleOverrides = {}) {
  const rule = makeTrendRule(ruleOverrides);
  const chips = engine.evaluateQofIndicatorRule(
    rule,
    {
      medications: [],
      observations: [],
      observationHistory,
      problems: [],
      patientContext: { ageYears: 60, sex: 'female' },
      _registerLookup: {},
    },
    NOW
  );
  return chips[0] || null;
}

// ── falling direction ─────────────────────────────────────────────────────────

console.log('\n=== direction: falling ===');
{
  // 88 → 60 over ~18 months = delta -28, beyond the -15 threshold.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 88 },
      { date: daysAgo(300), value: 74 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip !== null, 'falling eGFR beyond minDelta produces a chip');
  assert(chip && chip.status === 'not_met', 'falling eGFR beyond minDelta → status not_met (fires)');
  assert(
    chip && /88\.0 → 60\.0/.test(chip.valueText || ''),
    `valueText shows oldest → newest (got: ${chip && chip.valueText})`
  );
  assert(chip && /-28\.0/.test(chip.valueText || ''), 'valueText shows the signed delta');
  assert(chip && chip.dateText === daysAgo(30), 'dateText is the most recent reading date');
}

{
  // Falls, but only by 10 — short of the minDelta 15 threshold.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 70 },
      { date: daysAgo(300), value: 65 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip && chip.status === 'achieved', 'falling but below minDelta → achieved (does not fire)');
}

{
  // Delta exactly equals the threshold — inclusive boundary (delta <= -minDelta).
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 75 },
      { date: daysAgo(300), value: 68 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip && chip.status === 'not_met', 'delta exactly -minDelta fires (inclusive boundary)');
}

{
  // Rising values against a falling rule must not fire.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 50 },
      { date: daysAgo(300), value: 65 },
      { date: daysAgo(30), value: 80 },
    ]),
  ]);
  assert(chip && chip.status === 'achieved', 'rising values against a falling rule → achieved');
}

// ── rising direction ──────────────────────────────────────────────────────────

console.log('\n=== direction: rising ===');
{
  // HbA1c 48 → 72 = +24, beyond the +10 threshold.
  const chip = evaluate(
    [
      makeHistory('HbA1c', 'mmol/mol', [
        { date: daysAgo(600), value: 48 },
        { date: daysAgo(300), value: 58 },
        { date: daysAgo(20), value: 72 },
      ]),
    ],
    { check: { observation: ['hba1c'], direction: 'rising', minDelta: 10 } }
  );
  assert(chip && chip.status === 'not_met', 'rising HbA1c beyond minDelta → not_met (fires)');
  assert(chip && /\+24\.0/.test(chip.valueText || ''), 'rising delta is rendered with a + sign');
}

{
  const chip = evaluate(
    [
      makeHistory('HbA1c', 'mmol/mol', [
        { date: daysAgo(600), value: 48 },
        { date: daysAgo(300), value: 50 },
        { date: daysAgo(20), value: 53 },
      ]),
    ],
    { check: { observation: ['hba1c'], direction: 'rising', minDelta: 10 } }
  );
  assert(chip && chip.status === 'achieved', 'rising but below minDelta → achieved');
}

{
  // Falling values against a rising rule must not fire.
  const chip = evaluate(
    [
      makeHistory('HbA1c', 'mmol/mol', [
        { date: daysAgo(600), value: 80 },
        { date: daysAgo(300), value: 65 },
        { date: daysAgo(20), value: 50 },
      ]),
    ],
    { check: { observation: ['hba1c'], direction: 'rising', minDelta: 10 } }
  );
  assert(chip && chip.status === 'achieved', 'falling values against a rising rule → achieved');
}

// ── flat line must never fire ─────────────────────────────────────────────────

console.log('\n=== flat line (delta exactly 0) ===');
{
  const flat = [
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 60 },
      { date: daysAgo(300), value: 62 },
      { date: daysAgo(30), value: 60 },
    ]),
  ];
  // minDelta 0 means "any movement in the named direction". A flat line has no
  // movement, so the strict inequality on delta must keep it from firing in
  // EITHER direction — this is the guard the code comments call out explicitly.
  const falling = evaluate(flat, { check: { direction: 'falling', minDelta: 0 } });
  const rising = evaluate(flat, { check: { direction: 'rising', minDelta: 0 } });
  assert(falling && falling.status === 'achieved', 'flat line with minDelta 0 does not fire as falling');
  assert(rising && rising.status === 'achieved', 'flat line with minDelta 0 does not fire as rising');
}

{
  // Any movement fires when minDelta is 0.
  const chip = evaluate(
    [
      makeHistory('eGFR', 'mL/min/1.73m2', [
        { date: daysAgo(540), value: 61 },
        { date: daysAgo(300), value: 61 },
        { date: daysAgo(30), value: 60 },
      ]),
    ],
    { check: { direction: 'falling', minDelta: 0 } }
  );
  assert(chip && chip.status === 'not_met', 'minDelta 0 fires on a 1-unit fall');
}

// ── minPoints / window handling ───────────────────────────────────────────────

console.log('\n=== minPoints and window ===');
{
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(300), value: 88 },
      { date: daysAgo(30), value: 55 },
    ]),
  ]);
  assert(chip && chip.status === 'no_data', '2 points against minPoints 3 → no_data');
  assert(
    chip && /2 points in window \(need 3\)/.test(chip.valueText || ''),
    `no_data valueText states the shortfall (got: ${chip && chip.valueText})`
  );
}

{
  // Three readings exist but two fall outside the 24-month window, so only one
  // is eligible — the out-of-window points must not rescue the point count.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(1400), value: 90 },
      { date: daysAgo(1200), value: 85 },
      { date: daysAgo(30), value: 55 },
    ]),
  ]);
  assert(chip && chip.status === 'no_data', 'points older than withinMonths are excluded from the window');
  assert(chip && /1 point in window/.test(chip.valueText || ''), 'no_data valueText singularises "1 point"');
}

{
  // A steep fall that happened entirely outside the window must not fire.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(1500), value: 95 },
      { date: daysAgo(1400), value: 70 },
      { date: daysAgo(1300), value: 45 },
    ]),
  ]);
  assert(chip && chip.status === 'no_data', 'a decline entirely outside the window does not fire');
}

{
  // Widening the window brings the same readings back into scope.
  const chip = evaluate(
    [
      makeHistory('eGFR', 'mL/min/1.73m2', [
        { date: daysAgo(1500), value: 95 },
        { date: daysAgo(1400), value: 70 },
        { date: daysAgo(1300), value: 45 },
      ]),
    ],
    { check: { withinMonths: 60 } }
  );
  assert(chip && chip.status === 'not_met', 'widening withinMonths brings older readings into scope');
}

// ── observation matching ──────────────────────────────────────────────────────

console.log('\n=== observation matching ===');
{
  const chip = evaluate([makeHistory('Serum sodium', 'mmol/L', [{ date: daysAgo(30), value: 140 }])]);
  assert(chip && chip.status === 'no_data', 'no matching investigation name → no_data');
}

{
  const chip = evaluate([]);
  assert(chip && chip.status === 'no_data', 'empty observationHistory → no_data');
}

{
  const chip = evaluate(undefined);
  assert(chip && chip.status === 'no_data', 'missing observationHistory → no_data (no throw)');
}

{
  // Two entries match the search term; the evaluator must pick the one with the
  // most data points so the trend uses the richest series. The sparse entry
  // would fire (-40); the rich entry would not (-5). Picking the rich one is
  // the documented behaviour.
  const chip = evaluate([
    makeHistory('eGFR (sparse)', 'mL/min/1.73m2', [
      { date: daysAgo(400), value: 90 },
      { date: daysAgo(30), value: 50 },
    ]),
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(500), value: 62 },
      { date: daysAgo(400), value: 61 },
      { date: daysAgo(200), value: 59 },
      { date: daysAgo(30), value: 57 },
    ]),
  ]);
  assert(chip && chip.status === 'achieved', 'picks the richest matching series, not the first match');
  assert(chip && /62\.0 → 57\.0/.test(chip.valueText || ''), 'valueText comes from the richest series');
}

{
  // Matching is case-insensitive substring against each check.observation term.
  // The shipped eGFR rule lists both 'egfr' and the spelled-out name precisely
  // because 'estimated glomerular filtration rate' does NOT contain 'egfr' —
  // dropping an alias silently loses every patient whose lab reports it that way.
  const spelledOut = [
    makeHistory('ESTIMATED GLOMERULAR FILTRATION RATE', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 88 },
      { date: daysAgo(300), value: 74 },
      { date: daysAgo(30), value: 60 },
    ]),
  ];
  const withAlias = evaluate(spelledOut, {
    check: { observation: ['egfr', 'estimated glomerular filtration rate'] },
  });
  assert(withAlias && withAlias.status === 'not_met', 'observation match is case-insensitive');

  const withoutAlias = evaluate(spelledOut, { check: { observation: ['egfr'] } });
  assert(
    withoutAlias && withoutAlias.status === 'no_data',
    'a missing alias silently yields no_data — why the shipped rule lists both forms'
  );
}

// ── non-numeric values ────────────────────────────────────────────────────────

console.log('\n=== non-numeric values ===');
{
  // BP-style "120/80" and free-text results parse to NaN and must be filtered
  // out before the arithmetic — they must not be counted toward minPoints.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: NaN },
      { date: daysAgo(300), value: NaN },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip && chip.status === 'no_data', 'NaN readings are excluded from the point count');
}

{
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 88 },
      { date: daysAgo(300), value: Infinity },
      { date: daysAgo(200), value: 74 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip && chip.status === 'not_met', 'Infinity is excluded but the remaining 3 points still evaluate');
  assert(chip && /88\.0 → 60\.0/.test(chip.valueText || ''), 'Infinity does not corrupt the delta arithmetic');
}

{
  // An unparseable date must not be treated as in-window.
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: 'not-a-date', value: 88 },
      { date: daysAgo(300), value: 74 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  assert(chip && chip.status === 'no_data', 'readings with an unparseable date are excluded');
}

// ── evidence payload ──────────────────────────────────────────────────────────

console.log('\n=== evidence payload ===');
{
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(540), value: 88 },
      { date: daysAgo(300), value: 74 },
      { date: daysAgo(30), value: 60 },
    ]),
  ]);
  const ev = chip && chip.evidence;
  assert(!!ev, 'a firing trend chip carries an evidence payload');
  // buildQofIndicatorEvidence exposes the series as evidence.series; the panel
  // reads it to draw the sparkline. It must be ordered oldest→newest regardless
  // of the newest-first storage order.
  const series = ev && ev.series;
  if (series && Array.isArray(series.points)) {
    assert(series.points.length === 3, 'evidence series carries all in-window points');
    assert(series.points[0].value === 88, 'evidence series points are ordered oldest-first');
    assert(series.points[2].value === 60, 'evidence series ends on the newest reading');
    assert(series.fires === true, 'evidence series records that the trend fired');
    assert(series.delta === -28, 'evidence series carries the computed delta');
  } else {
    // If the builder stops surfacing the series the sparkline silently
    // disappears from the evidence panel.
    assert(false, 'evidence exposes a series with a points array');
  }
  // The human-readable facts list is what the clinician actually reads.
  const facts = (ev && ev.facts) || [];
  assert(
    facts.some((f) => f.label === 'Direction' && /falling/.test(f.value)),
    'evidence facts name the trend direction'
  );
  assert(
    facts.filter((f) => /^Point \d+$/.test(f.label)).length === 3,
    'evidence facts list one row per in-window reading'
  );
}

{
  // The no_data path still surfaces provenance so the clinician sees which
  // readings DO exist rather than a bare "insufficient data".
  const chip = evaluate([
    makeHistory('eGFR', 'mL/min/1.73m2', [
      { date: daysAgo(300), value: 88 },
      { date: daysAgo(30), value: 55 },
    ]),
  ]);
  const ev = chip && chip.evidence;
  const series = ev && ev.series;
  assert(!!series, 'no_data trend chip still carries provenance readings');
  assert(series && series.insufficient === true, 'no_data series is flagged insufficient');
  assert(series && series.fires === false, 'no_data series does not claim to have fired');
  assert(
    ((ev && ev.facts) || []).some((f) => f.label === 'Trend' && /not enough readings/.test(f.value)),
    'no_data evidence explains the shortfall rather than showing a bare "insufficient data"'
  );
}

// ── shipped rules wiring ──────────────────────────────────────────────────────

console.log('\n=== shipped rules ===');
{
  const qof = require('./rules/qof-rules.json');
  const all = [];
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (o.check && o.check.kind === 'observation-trend') all.push(o);
      Object.values(o).forEach(walk);
    }
  })(qof);

  assert(all.length >= 2, `qof-rules.json ships observation-trend rules (found ${all.length})`);
  all.forEach((r) => {
    assert(
      r.check.direction === 'rising' || r.check.direction === 'falling',
      `${r.id}: direction is 'rising' or 'falling' (an unknown direction never fires)`
    );
    assert(Number.isFinite(r.check.minPoints) && r.check.minPoints >= 2, `${r.id}: minPoints is a finite number >= 2`);
    assert(Number.isFinite(r.check.withinMonths) && r.check.withinMonths > 0, `${r.id}: withinMonths is positive`);
    assert(
      Number.isFinite(r.check.minDelta) && r.check.minDelta >= 0,
      `${r.id}: minDelta is a non-negative number (a negative minDelta would invert the test)`
    );
    assert(
      Array.isArray(r.check.observation) && r.check.observation.length > 0,
      `${r.id}: has at least one observation search term`
    );
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}
