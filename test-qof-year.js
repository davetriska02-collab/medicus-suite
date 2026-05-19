// Sentinel — QOF Year Boundary Smoke Tests
// Run with:  node test-qof-year.js
// All tests must pass before shipping.

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

function makeQofIndicatorRule(overrides = {}) {
  return {
    id: 'qof-test-bp',
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'HYP007',
    indicatorName: 'Hypertension BP ≤140/80',
    requiresRegister: null,
    check: {
      kind: 'observation-threshold',
      observation: ['blood pressure', 'bp'],
      thresholdSystolic: 140,
      thresholdDiastolic: 80,
      withinDays: 365,
    },
    points: 14,
    source: 'QOF 2025/26',
    ...overrides,
  };
}

function makeObs(dateIso, value) {
  return { name: 'Blood pressure', code: null, date: dateIso, value };
}

function evaluate(obsDate, value, nowIso, ruleOverrides = {}) {
  const rule = makeQofIndicatorRule(ruleOverrides);
  const chips = engine.evaluateQofIndicatorRule(
    rule,
    {
      medications: [],
      observations: [makeObs(obsDate, value)],
      problems: [],
      patientContext: null,
      _registerLookup: {},
    },
    nowIso,
  );
  return chips[0] || null;
}

// ── QOF year boundary logic ───────────────────────────────────────────────────

console.log('\n=== qofYearStart() ===');
{
  // 15 January 2026 → QOF year 2025/26 → start = 1 Apr 2025
  const jan = engine.qofYearStart('2026-01-15T10:00:00Z');
  assert(jan.toISOString().startsWith('2025-04-01'), '15 Jan 2026 → QOF start 1 Apr 2025');

  // 1 April 2026 → new QOF year 2026/27 → start = 1 Apr 2026
  const apr1 = engine.qofYearStart('2026-04-01T00:00:00Z');
  assert(apr1.toISOString().startsWith('2026-04-01'), '1 Apr 2026 → QOF start 1 Apr 2026');

  // 31 March 2026 → still in 2025/26 → start = 1 Apr 2025
  const mar31 = engine.qofYearStart('2026-03-31T23:59:59Z');
  assert(mar31.toISOString().startsWith('2025-04-01'), '31 Mar 2026 → QOF start 1 Apr 2025');

  // 2 April 2026 → 2026/27 started 2 days ago → start = 1 Apr 2026
  const apr2 = engine.qofYearStart('2026-04-02T12:00:00Z');
  assert(apr2.toISOString().startsWith('2026-04-01'), '2 Apr 2026 → QOF start 1 Apr 2026');
}

console.log('\n=== qofYearLabel() ===');
{
  assert(engine.qofYearLabel('2026-01-15T00:00:00Z') === '2025/26', '15 Jan 2026 → label 2025/26');
  assert(engine.qofYearLabel('2026-04-01T00:00:00Z') === '2026/27', '1 Apr 2026 → label 2026/27');
  assert(engine.qofYearLabel('2025-03-31T00:00:00Z') === '2024/25', '31 Mar 2025 → label 2024/25');
}

console.log('\n=== observation-threshold: QOF year boundary ===');
{
  // Today = 15 Jan 2026 (QOF year 2025/26, started 1 Apr 2025)
  const NOW = '2026-01-15T12:00:00Z';

  // BP recorded 1 May 2025 — WITHIN current QOF year → should achieve/not_met
  const withinYear = evaluate('2025-05-01', '138/78', NOW);
  assert(withinYear !== null, 'chip returned for obs within QOF year');
  assert(withinYear.status === 'achieved', 'BP 138/78 in QOF year → achieved');
  assert(withinYear.qofYear === '2025/26', 'chip carries qofYear label');
  assert(withinYear.qofYearStart === '2025-04-01', 'chip carries qofYearStart date');

  // BP recorded 31 March 2025 — ONE DAY before QOF year → overdue
  const beforeYear = evaluate('2025-03-31', '138/78', NOW);
  assert(beforeYear !== null, 'chip returned for obs before QOF year');
  assert(beforeYear.status === 'overdue', 'BP on 31 Mar 2025 → overdue (outside QOF year)');

  // BP recorded exactly 1 April 2025 — first day of QOF year → should count
  const firstDay = evaluate('2025-04-01', '145/88', NOW);
  assert(firstDay !== null, 'chip returned for obs on first day of QOF year');
  assert(firstDay.status === 'not_met', 'BP 145/88 on 1 Apr 2025 → not_met (in year but above threshold)');

  // BP recorded last year (2024-05-01) — previous QOF year → overdue even though <365d ago from NOW
  // (This is THE key fix: rolling 365d from Jan 2026 would include May 2025 — but QOF year started Apr 2025
  //  so May 2025 IS in the current year. Let's test with a date that rolling would pass but QOF year fails.)
  // 15 Jan 2025 — within 365d of 15 Jan 2026, but BEFORE 1 Apr 2025 QOF start → overdue
  const rollingWouldPass = evaluate('2025-01-15', '138/78', NOW);
  assert(rollingWouldPass !== null, 'chip returned for obs at 15 Jan 2025');
  assert(rollingWouldPass.status === 'overdue', '15 Jan 2025 result: within 365d rolling but outside QOF year → overdue');
}

console.log('\n=== observation-threshold: new QOF year just started ===');
{
  // Today = 5 April 2026 (QOF year 2026/27, started 1 Apr 2026)
  const NOW = '2026-04-05T12:00:00Z';

  // BP done 2 April 2026 — 3 days into new year → counts
  const newYearObs = evaluate('2026-04-02', '136/80', NOW);
  assert(newYearObs !== null, 'chip returned for obs 3d into new QOF year');
  assert(newYearObs.status === 'achieved', 'BP done 3d into new year → achieved');
  assert(newYearObs.qofYear === '2026/27', 'chip shows new QOF year label');

  // BP done 31 March 2026 — last day of old year → overdue in new year
  const oldYearObs = evaluate('2026-03-31', '136/80', NOW);
  assert(oldYearObs.status === 'overdue', 'BP on 31 Mar 2026 → overdue once new year starts 1 Apr 2026');
}

console.log('\n=== observation-recent: QOF year boundary ===');
{
  const NOW = '2026-01-15T12:00:00Z'; // QOF year 2025/26

  const recentRule = makeQofIndicatorRule({
    id: 'qof-test-hba1c',
    indicatorCode: 'DM020',
    indicatorName: 'HbA1c in last 12m',
    check: {
      kind: 'observation-recent',
      observation: ['hba1c', 'haemoglobin a1c'],
      withinDays: 365,
    },
  });

  function evalRecent(dateIso) {
    return engine.evaluateQofIndicatorRule(
      recentRule,
      {
        medications: [],
        observations: [{ name: 'HbA1c', code: null, date: dateIso, value: '52' }],
        problems: [],
        patientContext: null,
        _registerLookup: {},
      },
      NOW,
    )[0] || null;
  }

  const inYear    = evalRecent('2025-06-01');
  const beforeYear = evalRecent('2025-03-01');

  assert(inYear !== null, 'chip returned for HbA1c in QOF year');
  assert(inYear.status === 'achieved', 'HbA1c Jun 2025 → achieved (in 2025/26 year)');
  assert(beforeYear !== null, 'chip returned for HbA1c before QOF year');
  assert(beforeYear.status === 'overdue', 'HbA1c Mar 2025 → overdue (outside 2025/26 year)');
}

console.log('\n=== drug-monitoring: rolling window unchanged ===');
{
  // Drug monitoring should NOT use QOF year logic — it still uses intervalDays rolling
  const NOW = '2026-01-15T12:00:00Z';
  const drugRule = {
    id: 'drug-test-methotrexate',
    type: 'drug-monitoring',
    enabled: true,
    drug: { match: ['methotrexate'] },
    tests: [
      { name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 90, dueSoonDays: 14 }
    ],
  };

  // FBC done 1 November 2025 — 75 days ago — within 90d interval → in_date
  const chips = engine.evaluateDrugRule(
    drugRule,
    {
      medications: [{ name: 'methotrexate 10mg', startDate: '2022-01-01' }],
      observations: [{ name: 'FBC', code: null, date: '2025-11-01', value: 'normal' }],
    },
    NOW,
  );
  assert(chips.length === 1, 'drug chip returned');
  assert(chips[0].tests[0].status === 'in_date', 'FBC 75d ago for 90d interval → in_date (drug rolling window)');

  // FBC done 15 March 2025 — before QOF year start — but 305d ago and interval is 90d → overdue
  const chips2 = engine.evaluateDrugRule(
    drugRule,
    {
      medications: [{ name: 'methotrexate 10mg', startDate: '2022-01-01' }],
      observations: [{ name: 'FBC', code: null, date: '2025-03-15', value: 'normal' }],
    },
    NOW,
  );
  // 306d > 2x intervalDays (180d) → stale (not just overdue), which is still correctly flagged
  assert(chips2[0].tests[0].status === 'stale', 'FBC 306d ago for 90d interval → stale (correct rolling window — worse than overdue)');
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
