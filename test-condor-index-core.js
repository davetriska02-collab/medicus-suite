// Medicus Suite — Condor Pressure Index core logic tests
// Run with: node test-condor-index-core.js
// Dynamic-imports condor-index-core.js (ES module), same technique as
// test-capacity-core.js / test-referrals-filters.js.
//
// Covers: default-formula parity with the pre-item-8 hard-coded condor.js
// computeIndex(), config normalisation/clamping, isCustomConfig, and — the
// HARD SAFETY RULE from the top-10 plan — a regression proof that no
// weighting/threshold configuration (however extreme) can ever produce a
// GREEN band while capacity is over limit.

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

  const corePath = new URL('side-panel/modules/condor/condor-index-core.js', `file://${path.resolve(__dirname)}/`).href;

  const { computeIndex, normaliseIndexConfig, isCustomConfig, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } = await import(
    corePath
  );

  // ── Default formula parity — matches the historical hard-coded condor.js math ──
  console.log('\n--- default formula parity ---');
  {
    // arrivedCount 5 → scoreA 50; queue 20 → scoreB 50; urgent 2 → scoreC 40;
    // minimum 30, remaining 20 → deficit 10 → scoreD ~33.33
    // ppi = round(50*0.3 + 50*0.25 + 40*0.25 + 33.33*0.2) = round(15+12.5+10+6.67) = round(44.17) = 44
    const data = {
      waitingRoom: { arrivedCount: 5 },
      submissions: { totals: { medical: 12, admin: 8 } },
      requestMonitor: { urgentCount: 2 },
      slots: { totalRemaining: 20 },
      capacityPreset: { minimum: 30 },
    };
    const idx = computeIndex(data);
    check(idx.ppi === 44, `default-weight ppi computes as expected (got ${idx.ppi})`);
    check(idx.band === 'AMBER', `44 → AMBER band (got ${idx.band})`);
    check(idx.demandCount === 20, 'demandCount = medical+admin');
    check(idx.isCustom === false, 'no config supplied → isCustom false');
  }

  // ── Band thresholds (defaults: <40 GREEN, 40-69 AMBER, >=70 RED) ─────────────
  console.log('\n--- band thresholds (defaults) ---');
  {
    const zero = { waitingRoom: { arrivedCount: 0 }, submissions: { totals: { medical: 0, admin: 0 } } };
    check(computeIndex(zero).band === 'GREEN', 'all-zero → GREEN');
    const busy = {
      waitingRoom: { arrivedCount: 10 },
      submissions: { totals: { medical: 40, admin: 0 } },
      requestMonitor: { urgentCount: 5 },
      slots: { totalRemaining: 0 },
      capacityPreset: { minimum: 10 },
    };
    check(computeIndex(busy).ppi === 100, 'all streams maxed → ppi 100');
    check(computeIndex(busy).band === 'RED', 'ppi 100 → RED');
  }

  // ── normaliseIndexConfig ──────────────────────────────────────────────────
  console.log('\n--- normaliseIndexConfig ---');
  check(
    JSON.stringify(normaliseIndexConfig(undefined).weights) === JSON.stringify(DEFAULT_WEIGHTS),
    'undefined config → default weights'
  );
  check(
    JSON.stringify(normaliseIndexConfig(null).thresholds) === JSON.stringify(DEFAULT_THRESHOLDS),
    'null config → default thresholds'
  );
  {
    const n = normaliseIndexConfig({ weights: { waitingRoom: 5, queue: -1 } });
    check(n.weights.waitingRoom === 1, 'weight clamped to max 1 (got 5)');
    check(n.weights.queue === 0, 'weight clamped to min 0 (got -1)');
    check(n.weights.urgent === DEFAULT_WEIGHTS.urgent, 'omitted weight falls back to default');
  }
  {
    const n = normaliseIndexConfig({ thresholds: { amber: 500, red: -20 } });
    // amber clamped to 99, red clamped to 1 → amber(99) < red(1) is false → both fall back to defaults
    check(
      n.thresholds.amber === DEFAULT_THRESHOLDS.amber && n.thresholds.red === DEFAULT_THRESHOLDS.red,
      'inverted amber/red after clamping falls back to full default pair'
    );
  }
  {
    const n = normaliseIndexConfig({ thresholds: { amber: 30, red: 80 } });
    check(n.thresholds.amber === 30 && n.thresholds.red === 80, 'valid custom thresholds pass through unchanged');
  }
  check(
    normaliseIndexConfig('garbage').weights.queue === DEFAULT_WEIGHTS.queue,
    'non-object config → all defaults, no throw'
  );
  check(
    normaliseIndexConfig({ weights: 'x', thresholds: 5 }).weights.urgent === DEFAULT_WEIGHTS.urgent,
    'non-object weights/thresholds sub-fields → defaults, no throw'
  );

  // ── isCustomConfig ────────────────────────────────────────────────────────
  console.log('\n--- isCustomConfig ---');
  check(isCustomConfig(null) === false, 'null → not custom');
  check(isCustomConfig({}) === false, 'empty object → normalises to defaults → not custom');
  check(isCustomConfig({ weights: { waitingRoom: 0.3 } }) === false, 'value equal to default → not custom');
  check(isCustomConfig({ weights: { waitingRoom: 0.5 } }) === true, 'changed weight → custom');
  check(isCustomConfig({ thresholds: { amber: 35, red: 70 } }) === true, 'changed threshold → custom');

  // ── Custom weights/thresholds change the numeric ppi/band as expected ────────
  console.log('\n--- custom weights change the score ---');
  {
    const data = {
      waitingRoom: { arrivedCount: 10 }, // scoreA=100
      submissions: { totals: { medical: 0, admin: 0 } }, // scoreB=0
      requestMonitor: { urgentCount: 0 }, // scoreC=0
      slots: { totalRemaining: 100 },
      capacityPreset: { minimum: 0 }, // scoreD=0
    };
    const defaultIdx = computeIndex(data); // ppi = round(100*0.3) = 30
    check(defaultIdx.ppi === 30, `default weighting: WR-only load → ppi 30 (got ${defaultIdx.ppi})`);
    const heavyWr = computeIndex(data, { weights: { waitingRoom: 1, queue: 0, urgent: 0, capacity: 0 } });
    check(heavyWr.ppi === 100, `WR weight 1.0 → ppi 100 (got ${heavyWr.ppi})`);
    check(heavyWr.isCustom === true, 'custom weight config → isCustom true');
  }
  {
    // Custom, TIGHTER amber threshold moves the band earlier.
    const data = { waitingRoom: { arrivedCount: 4 } }; // scoreA=40 → ppi=round(40*0.3)=12
    const idx = computeIndex(data);
    check(idx.band === 'GREEN', `ppi 12 with default amber(40) → GREEN (got ${idx.band})`);
    const tight = computeIndex(data, { thresholds: { amber: 10, red: 20 } });
    check(tight.band === 'AMBER', `same ppi with amber threshold lowered to 10 → AMBER (got ${tight.band})`);
  }

  // ── HARD SAFETY RULE: capacity floor cannot be defeated by any config ────────
  console.log('\n--- SAFETY FLOOR: never GREEN while over capacity (regression) ---');
  {
    // Over-capacity data: queue 100 vs remaining 10 → ratio 10 → 'over'.
    const overCapData = {
      waitingRoom: { arrivedCount: 0 },
      submissions: { totals: { medical: 60, admin: 40 } },
      requestMonitor: { urgentCount: 0 },
      slots: { totalRemaining: 10 },
      capacityPreset: { minimum: 50 },
    };
    check(computeIndex(overCapData).overCapacity === true, 'sanity: fixture is genuinely over capacity');

    // Fuzz sweep: every combination of extreme weights (driving ppi as low as
    // possible) crossed with extreme thresholds (pushing the GREEN cutoff as
    // high as possible) — the adversarial search for a config that defeats
    // the floor. NONE of the 0 (queue/urgent/capacity) weighted-out combos
    // plus a maximal amber threshold may ever yield a GREEN band here.
    const weightExtremes = [
      { waitingRoom: 0, queue: 0, urgent: 0, capacity: 0 }, // ppi forced to 0
      { waitingRoom: 1, queue: 0, urgent: 0, capacity: 0 },
      { waitingRoom: 0, queue: 1, urgent: 0, capacity: 0 },
      { waitingRoom: 0, queue: 0, urgent: 1, capacity: 0 },
      { waitingRoom: 0, queue: 0, urgent: 0, capacity: 1 },
    ];
    const thresholdExtremes = [
      { amber: 99, red: undefined }, // amber clamped high; red falls back (99 not < 99 default red 70 → both reset)
      { amber: 90, red: 95 },
      { amber: 1, red: 2 },
      DEFAULT_THRESHOLDS,
    ];

    let sweepCount = 0;
    let violations = 0;
    for (const w of weightExtremes) {
      for (const t of thresholdExtremes) {
        sweepCount++;
        const idx = computeIndex(overCapData, { weights: w, thresholds: t });
        if (idx.band === 'GREEN') violations++;
      }
    }
    check(sweepCount === weightExtremes.length * thresholdExtremes.length, `sweep ran all ${sweepCount} configs`);
    check(violations === 0, `NO config in the sweep produced GREEN while over capacity (${violations} violations)`);
  }
  {
    // Directly confirm the floor RAISES (never lowers): a config that would
    // naturally compute GREEN (ppi=0, all weights 0) still floors to AMBER
    // when the fixture is over capacity.
    const overCapData = {
      submissions: { totals: { medical: 60, admin: 40 } },
      slots: { totalRemaining: 10 },
    };
    const idx = computeIndex(overCapData, { weights: { waitingRoom: 0, queue: 0, urgent: 0, capacity: 0 } });
    check(idx.ppi === 0, `contrived config → raw ppi 0 (got ${idx.ppi})`);
    check(idx.rawBand === 'GREEN', 'rawBand (pre-floor) is GREEN as expected');
    check(idx.band === 'AMBER', `floored band is AMBER, never GREEN (got ${idx.band})`);
    check(idx.floored === true, 'floored flag set');
  }
  {
    // Not-over-capacity control: the floor must NOT fire when capacity is fine
    // (proves the floor is conditional on overCapacity, not a blanket ban on GREEN).
    const okData = {
      waitingRoom: { arrivedCount: 0 },
      submissions: { totals: { medical: 2, admin: 1 } },
      slots: { totalRemaining: 50 },
    };
    const idx = computeIndex(okData);
    check(idx.overCapacity === false, 'sanity: fixture is within capacity');
    check(idx.band === 'GREEN', `within capacity → GREEN allowed (got ${idx.band})`);
    check(idx.floored === false, 'floored flag false when not over capacity');
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
