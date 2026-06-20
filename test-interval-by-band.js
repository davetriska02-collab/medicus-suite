// Medicus Suite — engine `intervalByBand` capability tests
// Run with: node test-interval-by-band.js
//
// Covers the OPTIONAL, escalate-only, shortest-wins interval-by-band capability
// added to engine/rules-engine.js (resolveEffectiveInterval + its wiring into
// evaluateDrugRule's per-test status computation and trace arithmetic).
//
// Hard invariant under test: effectiveInterval <= (test.intervalDays || 365)
// ALWAYS. Banding may only SHORTEN. Absent / unparseable / unit-conflicting /
// stale source values fall back to the baseline interval, never longer, and never
// suppress the chip.

'use strict';

const engine = require('./engine/rules-engine.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const NOW = '2026-06-20T00:00:00.000Z';
const resolve = engine.resolveEffectiveInterval;
check(typeof resolve === 'function', 'engine exports resolveEffectiveInterval');

// Helper: a test spec with a baseline interval and an eGFR-banded shortening.
function bandedTest(extra) {
  return Object.assign(
    {
      name: 'U&E',
      match: ['u&e', 'creatinine'],
      intervalDays: 365,
      dueSoonDays: 30,
      intervalByBand: {
        source: 'eGFR',
        unit: 'mL/min',
        bands: [
          { max: 14, intervalDays: 90 },
          { max: 29, intervalDays: 90 },
          { max: 59, intervalDays: 182 },
        ],
      },
    },
    extra || {}
  );
}

function eGFR(value, date, unit) {
  return [{ name: 'eGFR', code: null, date: date || '2026-06-01', value: String(value), unit: unit || 'mL/min' }];
}

// ============================================================
// 1. Shortest-wins / band selection
// ============================================================
console.log('1. band selection & shortest-wins');

{
  // eGFR 45 → band {max:59,intervalDays:182} → min(365,182)=182
  const r = resolve(bandedTest(), eGFR(45), NOW);
  check(r.reason === 'banded' && r.effectiveInterval === 182, `eGFR 45 → 182 (got ${r.effectiveInterval}/${r.reason})`);
  check(r.band && r.band.max === 59, `eGFR 45 selects max:59 band (got ${r.band && r.band.max})`);
  check(r.sourceValue === 45, `records source value 45 (got ${r.sourceValue})`);
}
{
  // eGFR 25 → band {max:29,intervalDays:90} → 90
  const r = resolve(bandedTest(), eGFR(25), NOW);
  check(r.effectiveInterval === 90 && r.band.max === 29, `eGFR 25 → 90 via max:29 (got ${r.effectiveInterval})`);
}
{
  // eGFR 70 → above all bands → no band matches → baseline 365
  const r = resolve(bandedTest(), eGFR(70), NOW);
  check(
    r.effectiveInterval === 365 && r.reason === 'no-band-match',
    `eGFR 70 → baseline 365, no-band-match (got ${r.effectiveInterval}/${r.reason})`
  );
}
{
  // A band whose intervalDays is LONGER than baseline must not lengthen.
  const t = bandedTest({
    intervalDays: 60,
    intervalByBand: { source: 'eGFR', bands: [{ max: 59, intervalDays: 182 }] },
  });
  const r = resolve(t, eGFR(45), NOW);
  check(
    r.effectiveInterval === 60,
    `band 182 vs baseline 60 → min wins = 60 (escalate-only) (got ${r.effectiveInterval})`
  );
}

// ============================================================
// 2. Band boundary values (max is INCLUSIVE upper bound)
// ============================================================
console.log('2. band boundaries (inclusive max)');

{
  // value === max of first band → that band
  const r = resolve(bandedTest(), eGFR(14), NOW);
  check(r.band.max === 14 && r.effectiveInterval === 90, `eGFR 14 (==max) → max:14 band (got ${r.band.max})`);
}
{
  // value just over first band's max falls into next band
  const r = resolve(bandedTest(), eGFR(15), NOW);
  check(r.band.max === 29, `eGFR 15 (>14) → max:29 band (got ${r.band.max})`);
}
{
  // value === last band's max → last band
  const r = resolve(bandedTest(), eGFR(59), NOW);
  check(r.band.max === 59 && r.effectiveInterval === 182, `eGFR 59 (==max) → max:59 band (got ${r.band.max})`);
}
{
  // value just over last band's max → no band → baseline
  const r = resolve(bandedTest(), eGFR(60), NOW);
  check(r.effectiveInterval === 365 && !r.band, `eGFR 60 (>59) → baseline, no band (got ${r.effectiveInterval})`);
}

// ============================================================
// 3. Fail-safe fallbacks → baseline (NEVER longer, NEVER suppress)
// ============================================================
console.log('3. fail-safe fallbacks → baseline');

{
  // No config at all → baseline, reason no-config
  const r = resolve({ name: 'FBC', intervalDays: 84 }, eGFR(20), NOW);
  check(r.effectiveInterval === 84 && r.reason === 'no-config', `no intervalByBand → baseline (got ${r.reason})`);
}
{
  // Missing source observation → baseline
  const r = resolve(bandedTest(), [], NOW);
  check(r.effectiveInterval === 365 && r.reason === 'no-source-obs', `missing source obs → 365 (got ${r.reason})`);
}
{
  // Unparseable value → baseline
  const obs = [{ name: 'eGFR', date: '2026-06-01', value: 'sample haemolysed', unit: 'mL/min' }];
  const r = resolve(bandedTest(), obs, NOW);
  check(r.effectiveInterval === 365 && r.reason === 'unparseable', `unparseable value → 365 (got ${r.reason})`);
}
{
  // Unit conflict (mmol/L on a mL/min-expecting band) → baseline
  const r = resolve(bandedTest(), eGFR(20, '2026-06-01', 'mmol/L'), NOW);
  check(r.effectiveInterval === 365 && r.reason === 'unit-conflict', `unit conflict → 365 (got ${r.reason})`);
}
{
  // Stale source (older than freshness window = baseline 365d) → baseline
  const r = resolve(bandedTest(), eGFR(20, '2024-01-01'), NOW);
  check(r.effectiveInterval === 365 && r.reason === 'stale', `stale source → 365 (got ${r.reason})`);
}
{
  // Explicit freshnessDays override: a 200-day-old value with a 90d window → stale
  const t = bandedTest();
  t.intervalByBand.freshnessDays = 90;
  const r = resolve(t, eGFR(20, '2025-12-01'), NOW); // ~200d old
  check(r.effectiveInterval === 365 && r.reason === 'stale', `freshnessDays override stale → 365 (got ${r.reason})`);
}
{
  // Unparseable date → treated as stale → baseline
  const obs = [{ name: 'eGFR', date: 'not-a-date', value: '20', unit: 'mL/min' }];
  const r = resolve(bandedTest(), obs, NOW);
  check(r.effectiveInterval === 365 && r.reason === 'stale', `bad date → 365 (got ${r.reason})`);
}

// ============================================================
// 4. HARD INVARIANT — property loop: effective <= baseline ALWAYS
// ============================================================
console.log('4. invariant: effectiveInterval <= baseline (random property loop)');

{
  let invariantHeld = true;
  let neverSuppressed = true;
  const reasons = new Set();
  function randInt(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  const units = ['mL/min', 'mmol/L', 'umol/L', '', null, 'mL/min/1.73m2'];
  for (let i = 0; i < 5000; i++) {
    const baseline = randInt(1, 730);
    // Random bands (1–4), random maxes and intervalDays (some longer, some shorter)
    const nbands = randInt(0, 4);
    const bands = [];
    for (let b = 0; b < nbands; b++) {
      bands.push({ max: randInt(1, 120), intervalDays: randInt(1, 1000) });
    }
    bands.sort((a, b) => a.max - b.max);
    const test = {
      name: 'T',
      intervalDays: baseline,
      intervalByBand: nbands > 0 ? { source: 'eGFR', unit: 'mL/min', bands } : undefined,
    };
    // Random observation: sometimes missing, sometimes garbage value/date/unit
    let obs = [];
    const flavour = randInt(0, 6);
    if (flavour === 0) {
      obs = []; // missing
    } else if (flavour === 1) {
      obs = [{ name: 'eGFR', date: '2026-06-10', value: 'garbage', unit: 'mL/min' }];
    } else if (flavour === 2) {
      obs = [{ name: 'eGFR', date: 'bad-date', value: String(randInt(1, 150)), unit: 'mL/min' }];
    } else {
      const daysAgo = randInt(0, 1200);
      const d = new Date(NOW);
      d.setDate(d.getDate() - daysAgo);
      obs = [
        {
          name: 'eGFR',
          date: d.toISOString().slice(0, 10),
          value: String(randInt(1, 150)),
          unit: units[randInt(0, units.length - 1)],
        },
      ];
    }
    const r = resolve(test, obs, NOW);
    reasons.add(r.reason);
    if (!(r.effectiveInterval <= (baseline || 365))) invariantHeld = false;
    // Never suppress: must always return a positive finite interval.
    if (!(typeof r.effectiveInterval === 'number' && r.effectiveInterval > 0)) neverSuppressed = false;
  }
  check(invariantHeld, 'INVARIANT held across 5000 random inputs: effectiveInterval <= baseline');
  check(neverSuppressed, 'never suppressed: always a positive finite interval across 5000 inputs');
  check(reasons.size >= 4, `exercised multiple code paths (reasons: ${[...reasons].join(',')})`);
}

// ============================================================
// 5. End-to-end via evaluatePatient: banding changes status & trace records it
// ============================================================
console.log('5. end-to-end status + trace audit');

const rule = {
  type: 'drug-monitoring',
  enabled: true,
  id: 'test-banded-ue',
  drugClass: 'ACEi',
  drug: { match: ['ramipril'] },
  tests: [bandedTest()],
};
const meds = [{ name: 'Ramipril 5mg tablets', startDate: '2020-01-01' }];

{
  // U&E done 120 days ago. Baseline 365 → in_date. But eGFR 25 bands to 90d → overdue.
  const ueDate = (() => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - 120);
    return d.toISOString().slice(0, 10);
  })();
  const obs = [
    { name: 'U&E (creatinine)', date: ueDate, value: '95', unit: 'umol/L' },
    { name: 'eGFR', date: '2026-06-01', value: '25', unit: 'mL/min' },
  ];
  const out = engine.evaluatePatient(meds, obs, [rule], { now: NOW, problems: [], trace: true });
  const chips = out.chips || out;
  const chip = chips.find((c) => c.type === 'drug-monitoring' && c.ruleId === 'test-banded-ue');
  check(!!chip, 'e2e: chip produced');
  check(
    chip && chip.status === 'overdue',
    `e2e: eGFR 25 bands 365→90 making 120d-old U&E overdue (got ${chip && chip.status})`
  );

  // Now a healthy eGFR (70): no banding → 120d within 365 → in_date.
  const obs2 = [
    { name: 'U&E (creatinine)', date: ueDate, value: '95', unit: 'umol/L' },
    { name: 'eGFR', date: '2026-06-01', value: '70', unit: 'mL/min' },
  ];
  const out2 = engine.evaluatePatient(meds, obs2, [rule], { now: NOW, problems: [] });
  const chip2 = out2.find((c) => c.type === 'drug-monitoring' && c.ruleId === 'test-banded-ue');
  check(
    chip2 && chip2.status === 'in_date',
    `e2e: eGFR 70 → baseline 365 → 120d in_date (got ${chip2 && chip2.status})`
  );
}

{
  // Trace arithmetic must record which band fired and the source value.
  const obs = [
    { name: 'U&E (creatinine)', date: '2026-06-01', value: '95', unit: 'umol/L' },
    { name: 'eGFR', date: '2026-06-01', value: '25', unit: 'mL/min' },
  ];
  const { trace } = engine.evaluatePatient(meds, obs, [rule], { now: NOW, problems: [], trace: true });
  const entry = trace.entries.find((t) => t.ruleId === 'test-banded-ue' && t.fired);
  check(!!entry && Array.isArray(entry.arithmetic), 'trace: fired entry has arithmetic block');
  const arith = entry && entry.arithmetic && entry.arithmetic[0];
  check(arith && arith.banding && arith.banding.applied === true, 'trace: banding.applied true');
  check(
    arith && arith.banding && arith.banding.sourceValue === 25,
    `trace: records source value 25 (got ${arith && arith.banding && arith.banding.sourceValue})`
  );
  check(
    arith && arith.banding && arith.banding.band && arith.banding.band.max === 29,
    'trace: records WHICH band (max:29) fired'
  );
  check(
    arith && arith.intervalDays === 90,
    `trace: arithmetic intervalDays is EFFECTIVE 90 (got ${arith && arith.intervalDays})`
  );
  check(
    arith && arith.baselineIntervalDays === 365,
    `trace: arithmetic records baseline 365 (got ${arith && arith.baselineIntervalDays})`
  );
}

{
  // No intervalByBand on a rule → trace banding is null (capability is OPTIONAL,
  // existing rules unaffected).
  const plainRule = {
    type: 'drug-monitoring',
    enabled: true,
    id: 'test-plain',
    drug: { match: ['ramipril'] },
    tests: [{ name: 'U&E', match: ['u&e'], intervalDays: 365, dueSoonDays: 30 }],
  };
  const obs = [{ name: 'U&E', date: '2026-06-01', value: 'normal' }];
  const { trace } = engine.evaluatePatient(meds, obs, [plainRule], { now: NOW, problems: [], trace: true });
  const entry = trace.entries.find((t) => t.ruleId === 'test-plain' && t.fired);
  const arith = entry && entry.arithmetic && entry.arithmetic[0];
  check(arith && arith.banding === null, 'trace: plain rule (no intervalByBand) → banding null');
  check(arith && arith.intervalDays === 365, 'trace: plain rule keeps baseline interval 365');
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
