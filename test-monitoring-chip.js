// Medicus Suite — Triage Lens "Monitoring due" overlay chip tests
// Run with: node test-monitoring-chip.js
//
// Two layers:
//   1. Real engine path — require the actual rules-engine and prove that the
//      drug-monitoring data path the overlay depends on behaves correctly:
//      methotrexate on repeat + no recent FBC -> a drug-monitoring chip with
//      status 'overdue'; the same with a recent in-interval FBC -> 'in_date'.
//   2. Overlay filter/format — vm-extract the pure selectMonitoringDue() helper
//      from content.js and assert it picks only the action-needed
//      drug-monitoring chips, sets level red/amber correctly, returns null when
//      none, and formats item lines as "name — detail".

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ============================================================
// LAYER 1 — real rules-engine drug-monitoring path
// ============================================================
console.log('Layer 1: rules-engine drug-monitoring path');

const engine = require('./engine/rules-engine.js');
check(typeof engine.evaluatePatient === 'function', 'rules-engine exports evaluatePatient');

// A minimal but valid drug-monitoring rule matching the engine's schema
// (type / drug.match / tests[].{match,intervalDays,dueSoonDays}).
const mtxRule = {
  type: 'drug-monitoring',
  enabled: true,
  id: 'test-methotrexate',
  drugClass: 'DMARD',
  drug: { match: ['methotrexate'] },
  tests: [
    { name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 84, dueSoonDays: 14 }
  ]
};

const meds = [{ name: 'Methotrexate 10mg tablets', startDate: '2022-01-01' }];
const NOW = '2026-05-29T00:00:00.000Z';

// (a) No recent FBC — last FBC was ~2 years ago, well past the 84d interval
//     and past 2x (168d) -> 'stale'; use a date just past the interval to get
//     'overdue' specifically per the spec.
const obsOverdue = [{ name: 'FBC', code: '26604007', date: '2026-02-01', value: 'normal' }];
const chipsOverdue = engine.evaluatePatient(meds, obsOverdue, [mtxRule], { now: NOW, problems: [] });
const mtxOverdue = chipsOverdue.find(c => c.type === 'drug-monitoring' && c.ruleId === 'test-methotrexate');
check(!!mtxOverdue, 'overdue case: a drug-monitoring chip is produced for methotrexate');
check(mtxOverdue && mtxOverdue.status === 'overdue',
  `overdue case: status is 'overdue' (got '${mtxOverdue && mtxOverdue.status}')`);

// (b) Recent in-interval FBC — dated within the last 84 days -> 'in_date'.
const obsInDate = [{ name: 'FBC', code: '26604007', date: '2026-05-01', value: 'normal' }];
const chipsInDate = engine.evaluatePatient(meds, obsInDate, [mtxRule], { now: NOW, problems: [] });
const mtxInDate = chipsInDate.find(c => c.type === 'drug-monitoring' && c.ruleId === 'test-methotrexate');
check(!!mtxInDate, 'in-date case: a drug-monitoring chip is produced for methotrexate');
check(mtxInDate && mtxInDate.status === 'in_date',
  `in-date case: status is 'in_date', NOT overdue (got '${mtxInDate && mtxInDate.status}')`);

// ============================================================
// LAYER 2 — pure selectMonitoringDue() helper from content.js
// ============================================================
console.log('Layer 2: selectMonitoringDue() filter/format');

const src = fs.readFileSync(
  path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// Extract the standalone function source. It is written as a top-level
// `function selectMonitoringDue(chips) { ... }` in the IIFE so it can be
// lifted out and evaluated in isolation here.
const fnMatch = src.match(/function selectMonitoringDue\(chips\) \{[\s\S]*?\n  \}/);
check(!!fnMatch, 'selectMonitoringDue function found in content.js');

let selectMonitoringDue = null;
if (fnMatch) {
  const sandbox = {};
  vm.runInNewContext(fnMatch[0] + '\nthis.selectMonitoringDue = selectMonitoringDue;', sandbox);
  selectMonitoringDue = sandbox.selectMonitoringDue;
  check(typeof selectMonitoringDue === 'function', 'selectMonitoringDue extracted and callable');
}

if (selectMonitoringDue) {
  // Mixed set: one overdue drug-monitoring, one due_soon, one in_date (ignored),
  // one no_data (NOW SURFACED as red — high-risk drug with no recognised
  // monitoring), and a non-drug-monitoring chip (ignored).
  const mixed = [
    { type: 'drug-monitoring', drugName: 'Methotrexate', status: 'overdue', evidence: { summary: 'Methotrexate — overdue' } },
    { type: 'drug-monitoring', drugName: 'Lithium', status: 'due_soon', detail: 'Lithium level — due in 10d' },
    { type: 'drug-monitoring', drugName: 'Atorvastatin', status: 'in_date', evidence: { summary: 'in date' } },
    { type: 'drug-monitoring', drugName: 'Ramipril', status: 'no_data', evidence: { summary: 'no data' } },
    { type: 'qof-indicator', indicatorName: 'BP', status: 'overdue' }
  ];
  const r = selectMonitoringDue(mixed);
  check(r && r.count === 3, `picks overdue/stale/due_soon + no_data drug-monitoring (count=3, got ${r && r.count})`);
  check(r && r.level === 'red', `level is red when any overdue (got '${r && r.level}')`);
  check(r && r.items.length === 3, 'three items returned');
  // Item line formatting "name — detail" (detail falls back to evidence.summary).
  const line0 = r && r.items[0] && `${r.items[0].name} — ${r.items[0].detail}`;
  check(line0 === 'Methotrexate — Methotrexate — overdue',
    `item formats as "name — detail" using evidence.summary (got "${line0}")`);
  const line1 = r && r.items[1] && `${r.items[1].name} — ${r.items[1].detail}`;
  check(line1 === 'Lithium — Lithium level — due in 10d',
    `item formats as "name — detail" using flat detail (got "${line1}")`);

  // no_data: detail names the specific missing tests, not a blanket "no bloods".
  const noDataChip = [
    { type: 'drug-monitoring', drugName: 'Leflunomide', status: 'no_data', tests: [
      { name: 'FBC', status: 'in_date' }, { name: 'U&E', status: 'in_date' },
      { name: 'LFT', status: 'in_date' }, { name: 'BP', status: 'no_data' },
      { name: 'Weight', status: 'no_data' }
    ] }
  ];
  const rnd = selectMonitoringDue(noDataChip);
  check(rnd && rnd.level === 'red', `no_data on a high-risk drug is red (got '${rnd && rnd.level}')`);
  check(rnd && rnd.items[0].detail === 'no recent BP, Weight',
    `no_data detail names only the missing tests (got "${rnd && rnd.items[0].detail}")`);
  // no_data with no per-test breakdown falls back to a generic honest message.
  const noDataBare = [{ type: 'drug-monitoring', drugName: 'Leflunomide', status: 'no_data' }];
  const rnb = selectMonitoringDue(noDataBare);
  check(rnb && rnb.items[0].detail === 'no monitoring on record',
    `bare no_data falls back to "no monitoring on record" (got "${rnb && rnb.items[0].detail}")`);

  // Amber when only due_soon present.
  const amberOnly = [
    { type: 'drug-monitoring', drugName: 'Lithium', status: 'due_soon', detail: 'due soon' }
  ];
  const ra = selectMonitoringDue(amberOnly);
  check(ra && ra.level === 'amber', `level is amber when only due_soon (got '${ra && ra.level}')`);

  // stale counts as red.
  const staleSet = [
    { type: 'drug-monitoring', drugName: 'Methotrexate', status: 'stale', detail: 'severely overdue' }
  ];
  const rs = selectMonitoringDue(staleSet);
  check(rs && rs.level === 'red', `level is red when stale present (got '${rs && rs.level}')`);

  // null when nothing action-needed (in_date + non-drug-monitoring only).
  const noneSet = [
    { type: 'drug-monitoring', drugName: 'Atorvastatin', status: 'in_date' },
    { type: 'qof-indicator', status: 'overdue' }
  ];
  check(selectMonitoringDue(noneSet) === null, 'returns null when no action-needed drug-monitoring');
  check(selectMonitoringDue([]) === null, 'returns null for empty array');
  check(selectMonitoringDue(null) === null, 'returns null for non-array input');
}

// ============================================================
// NULL-DATE REGRESSION (Task 1a / 1d)
// A drug-monitoring observation whose date cannot be parsed must surface as
// 'no_data', never as 'in_date'. Previously the null > x comparison silently
// fell through to 'in_date', masking a missing-monitoring situation.
// ============================================================
console.log('Layer 3: null-date guard — garbage obs.date → no_data');

const obsGarbageDate = [{ name: 'FBC', code: '26604007', date: 'not-a-date', value: 'normal' }];
const chipsGarbage = engine.evaluatePatient(meds, obsGarbageDate, [mtxRule], { now: NOW, problems: [] });
const mtxGarbage = chipsGarbage.find(c => c.type === 'drug-monitoring' && c.ruleId === 'test-methotrexate');
check(!!mtxGarbage, 'garbage-date case: a drug-monitoring chip is still produced');
check(mtxGarbage && mtxGarbage.status === 'no_data',
  `garbage-date case: status is 'no_data', not 'in_date' (got '${mtxGarbage && mtxGarbage.status}')`);

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
