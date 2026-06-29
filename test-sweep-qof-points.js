// Medicus Suite — Sweep QOF points-at-risk prioritiser tests
// Run with: node test-sweep-qof-points.js
//
// Imports sweep-core.js as an ES module (same dynamic-import technique as
// test-sweep-core.js). Covers:
//   - isCvdQofIndicator: explicit CVD-prevention classification (codes, not prefix)
//   - summariseQofPointsAtRisk: totals, CVD subtotal, patient ranking, indicator
//     aggregation, action-needed filter, error/no-qof skipping, points fallback

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

  const sweepCorePath = new URL('side-panel/modules/sweep/sweep-core.js', `file://${path.resolve(__dirname)}/`).href;
  const mod = await import(sweepCorePath);
  const { summariseQofPointsAtRisk, isCvdQofIndicator } = mod;

  function qof(code, name, status, points) {
    return { type: 'qof-indicator', indicatorCode: code, indicatorName: name, status, points };
  }

  // ── 1. CVD classification ────────────────────────────────────────────────
  console.log('\n--- isCvdQofIndicator ---');
  for (const c of [
    'HYP010',
    'HYP011',
    'CHD005',
    'STIA007',
    'CD001',
    'CHOL003',
    'CHOL004',
    'AF008',
    'DM036',
    'DM034',
    'DM035',
    'DM006',
  ]) {
    check(isCvdQofIndicator(c) === true, `${c} classed as CVD-prevention`);
  }
  for (const c of ['DM020', 'DM021', 'DM014', 'DM037', 'AST007', 'COPD010', 'MH011', 'SMOK002', '']) {
    check(isCvdQofIndicator(c) === false, `${c || '(empty)'} NOT classed as CVD-prevention`);
  }

  // ── 2. Totals, CVD subtotal, ranking, aggregation ────────────────────────
  console.log('\n--- summariseQofPointsAtRisk: core aggregation ---');
  const results = [
    {
      uuid: 'a',
      name: 'Alice',
      time: '2026-06-29T09:00:00',
      chips: [qof('HYP010', 'BP control', 'not_met', 38), qof('DM020', 'HbA1c', 'not_met', 17)],
    },
    {
      uuid: 'b',
      name: 'Bob',
      time: '2026-06-29T09:30:00',
      chips: [qof('CHOL004', 'LDL target', 'not_met', 44)],
    },
    {
      uuid: 'c',
      name: 'Carol',
      time: null,
      chips: [qof('HYP010', 'BP control', 'achieved', 38)], // achieved → not action-needed
    },
    { uuid: 'd', name: 'Dan', time: null, error: 'read failed', chips: null }, // error → skipped
    {
      uuid: 'e',
      name: 'Eve',
      time: null,
      chips: [{ type: 'drug-monitoring', drugName: 'methotrexate', status: 'overdue' }], // not qof
    },
  ];
  const s = summariseQofPointsAtRisk(results);
  check(s.totalPoints === 99, `totalPoints = 99 (38+17+44), got ${s.totalPoints}`);
  check(s.cvdPoints === 82, `cvdPoints = 82 (38 HYP + 44 CHOL, not DM020), got ${s.cvdPoints}`);
  check(s.patientCount === 2, `patientCount = 2 (Alice, Bob), got ${s.patientCount}`);
  check(s.byPatient[0].name === 'Alice' && s.byPatient[0].points === 55, 'Alice ranked first with 55 points');
  check(s.byPatient[0].cvdPoints === 38, 'Alice CVD subtotal = 38 (HYP only)');
  check(s.byPatient[1].name === 'Bob' && s.byPatient[1].points === 44, 'Bob second with 44 points');
  check(!s.byPatient.some((p) => p.name === 'Carol'), 'Carol (achieved only) excluded');
  check(!s.byPatient.some((p) => p.name === 'Eve'), 'Eve (no qof chips) excluded');

  // byIndicator sorted by total points desc: CHOL004(44), HYP010(38), DM020(17)
  check(s.byIndicator[0].code === 'CHOL004' && s.byIndicator[0].totalPoints === 44, 'byIndicator[0] = CHOL004 (44)');
  check(s.byIndicator[0].isCvd === true, 'CHOL004 flagged isCvd');
  check(s.byIndicator.find((i) => i.code === 'HYP010')?.patientCount === 1, 'HYP010 aggregated across 1 patient');

  // ── 3. Points fallback: map overrides null chip points ───────────────────
  console.log('\n--- points source: map override + chip fallback ---');
  const noPointResults = [{ uuid: 'x', name: 'X', time: null, chips: [qof('CHOL004', 'LDL target', 'not_met', null)] }];
  const withMap = summariseQofPointsAtRisk(noPointResults, { CHOL004: 44 });
  check(withMap.totalPoints === 44, 'pointsByCode map supplies points when chip.points is null');
  const noMap = summariseQofPointsAtRisk(noPointResults);
  check(noMap.totalPoints === 0, 'null chip.points and no map → 0 points (gap still listed)');
  check(noMap.patientCount === 1, 'patient with an unweighted gap still appears');

  // ── 4. Empty / null input ────────────────────────────────────────────────
  console.log('\n--- empty input ---');
  const empty = summariseQofPointsAtRisk([]);
  check(
    empty.totalPoints === 0 && empty.patientCount === 0 && empty.byPatient.length === 0,
    'empty list → zeroed summary'
  );
  const nul = summariseQofPointsAtRisk(null);
  check(nul.totalPoints === 0 && nul.byIndicator.length === 0, 'null input → zeroed summary');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
