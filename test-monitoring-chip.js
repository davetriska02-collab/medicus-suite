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
// LAYER 4 — computeMonitoringChip() throw contract (item 1.1 leg C,
// TRIAGE-LENS-2026-07-02.md). vm-extract the REAL function from content.js so
// the actual control flow (which branch throws vs returns null) is under
// test, not a re-implementation. Its free-variable dependencies (pageType,
// findSystemChip, loadMonitoringRules, selectMonitoringDue, log, window) are
// stubbed/controlled per scenario — this is testing "does a could-not-
// evaluate path throw" and "does a definitive-clear path return null",
// not the config/engine machinery those helpers own (covered elsewhere).
// ============================================================
console.log('Layer 4: computeMonitoringChip() — could-not-evaluate throws, definitive-clear returns null');

const cmcMatch = src.match(/const computeMonitoringChip = async \(\) => \{[\s\S]*?\n {2}\};/);
check(!!cmcMatch, 'computeMonitoringChip function found in content.js');

function makeMonitoringSandbox(overrides) {
  const sandbox = {
    console,
    log: () => {},
    pageType: () => 'record',
    findSystemChip: () => ({ enabled: true }),
    loadMonitoringRules: async () => [{ id: 'r1' }],
    // Deliberately NOT the real selectMonitoringDue — a marker so assertions
    // can tell "the success path was reached and returned this" apart from
    // "a could-not-evaluate path threw before ever reaching selection".
    selectMonitoringDue: (chips) => ({ __selected: true, chips }),
    window: {
      SentinelDataFetcher: { fetchPatientData: async () => ({ medications: [{ name: 'Methotrexate' }] }) },
      SentinelRules: { evaluatePatient: () => [{ type: 'drug-monitoring', status: 'overdue' }] },
      // No SentinelEvalCache — keeps computeMonitoringChip on the
      // non-cached path (the cache branch references monitoringToken/
      // _monEvalCache, which this harness deliberately doesn't stub).
    },
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    cmcMatch[0] + '\nthis.computeMonitoringChip = computeMonitoringChip;',
    sandbox,
    { filename: 'monitoring-chip-extract.js' }
  );
  return sandbox;
}

async function expectThrows(overrides, label) {
  const sandbox = makeMonitoringSandbox(overrides);
  try {
    const r = await sandbox.computeMonitoringChip();
    check(false, `${label}: threw (got a resolved value instead: ${JSON.stringify(r)})`);
  } catch (e) {
    check(true, `${label}: threw (preserves any existing chip via runMonitoringChip's catch)`);
  }
}

async function expectResolves(overrides, expected, label) {
  const sandbox = makeMonitoringSandbox(overrides);
  try {
    const r = await sandbox.computeMonitoringChip();
    check(
      expected === undefined ? true : (expected === null ? r === null : JSON.stringify(r) === JSON.stringify(expected)),
      `${label}: resolved (got ${JSON.stringify(r)})`
    );
  } catch (e) {
    check(false, `${label}: resolved, did not throw (threw: ${e && e.message})`);
  }
}

// ============================================================
// LAYER 5 — runMonitoringChip() preserve-on-throw / clear-on-null contract
// (item 1.1 leg C). vm-extract the REAL runMonitoringChip so its actual
// .then()/.catch() wiring is under test. computeMonitoringChip itself is
// STUBBED here (Layer 4 already proves its own throw/return contract against
// the real function) so this layer isolates runMonitoringChip's side of the
// contract: does a throw leave the existing chip alone, does a definitive
// null clear it, and does a patient/page token change reset state regardless.
// ============================================================
console.log('Layer 5: runMonitoringChip() — preserves on throw, clears on definitive null, resets on token change');

const rmcMatch = src.match(/const runMonitoringChip = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!rmcMatch, 'runMonitoringChip function found in content.js');

function makeRunMonitoringSandbox(tokenVal, computeImpl) {
  const calls = { injected: [], cleared: 0, removed: 0, invalidated: 0 };
  const sandbox = {
    console,
    log: () => {},
    monitoringToken: () => tokenVal,
    computeMonitoringChip: computeImpl,
    injectMonitoringChip: (result) => { calls.injected.push(result); },
    clearMonitoringDynActions: () => { calls.cleared++; },
    removeMonitoringChipEl: () => { calls.removed++; },
    _lastMonitoring: null,
    _monEvalCache: { invalidate: () => { calls.invalidated++; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    rmcMatch[0] + '\nthis.runMonitoringChip = runMonitoringChip;\n' +
    'this.__getLastMonitoring = () => _lastMonitoring;',
    sandbox,
    { filename: 'run-monitoring-chip-extract.js' }
  );
  sandbox.__calls = calls;
  return sandbox;
}

// Give a just-kicked-off runMonitoringChip's internal promise chain a tick to
// settle before asserting (its .then()/.catch() resolve on a microtask).
const settle = () => new Promise((r) => setTimeout(r, 0));

if (cmcMatch) {
  (async () => {
    // ---- could-not-evaluate paths: every one throws ----
    await expectThrows(
      { loadMonitoringRules: async () => [] },
      'rules-load failure (empty rules array)'
    );
    await expectThrows(
      {
        window: {
          SentinelDataFetcher: { fetchPatientData: async () => { throw new Error('network down'); } },
          SentinelRules: { evaluatePatient: () => [] },
        },
      },
      'fetchPatientData throws'
    );
    await expectThrows(
      {
        window: {
          SentinelDataFetcher: { fetchPatientData: async () => ({ error: true }) },
          SentinelRules: { evaluatePatient: () => [] },
        },
      },
      'data.error true'
    );
    await expectThrows(
      {
        window: {
          SentinelDataFetcher: { fetchPatientData: async () => null },
          SentinelRules: { evaluatePatient: () => [] },
        },
      },
      'missing patient data (fetchPatientData resolves null)'
    );
    await expectThrows(
      {
        window: {
          SentinelDataFetcher: {
            fetchPatientData: async () => ({
              medications: [],
              debug: { dataFetchFailed: { medications: true } },
            }),
          },
          SentinelRules: { evaluatePatient: () => [] },
        },
      },
      'medications fetch failed (dataFetchFailed.medications) — the pre-existing throw branch'
    );
    await expectThrows(
      {
        window: {
          SentinelDataFetcher: { fetchPatientData: async () => ({ medications: [{ name: 'Methotrexate' }] }) },
          SentinelRules: {
            evaluatePatient: () => { throw new Error('engine blew up'); },
          },
        },
      },
      'evaluatePatient throws'
    );

    // ---- definitive-clear path: returns null, does NOT throw ----
    await expectResolves(
      {
        window: {
          SentinelDataFetcher: { fetchPatientData: async () => ({ medications: [] }) },
          SentinelRules: { evaluatePatient: () => [] },
        },
      },
      null,
      'confirmed no medications (not a fetch failure) — definitive clear, returns null'
    );

    // ---- success path: resolves via selectMonitoringDue, does NOT throw ----
    await expectResolves(undefined, { __selected: true, chips: [{ type: 'drug-monitoring', status: 'overdue' }] },
      'successful evaluation resolves via selectMonitoringDue');

    // ================================================
    // Layer 5 scenarios
    // ================================================
    if (rmcMatch) {
      // (a) First call: computeMonitoringChip resolves with a real result —
      //     injected, and _lastMonitoring records it.
      {
        const sandbox = makeRunMonitoringSandbox('record|/patient/1', async () => ({ level: 'red', count: 1, items: [] }));
        sandbox.runMonitoringChip();
        await settle();
        check(sandbox.__calls.injected.length === 1, 'first call, real result: injectMonitoringChip called once');
        const last = sandbox.__getLastMonitoring();
        check(!!last && last.token === 'record|/patient/1' && !!last.result, '_lastMonitoring records the result for this token');
      }

      // (b) Definitive clear (computeMonitoringChip resolves null): the
      //     existing chip/note IS cleared — this is the one legitimate
      //     "nothing due now" case.
      {
        const sandbox = makeRunMonitoringSandbox('record|/patient/2', async () => null);
        sandbox.runMonitoringChip();
        await settle();
        check(sandbox.__calls.injected.length === 0, 'definitive clear: injectMonitoringChip NOT called');
        check(sandbox.__calls.cleared === 1 && sandbox.__calls.removed === 1,
          'definitive clear: clearMonitoringDynActions + removeMonitoringChipEl ARE called (this is the one real clear case)');
        const last = sandbox.__getLastMonitoring();
        check(!!last && last.result === null, '_lastMonitoring records the definitive-null result');
      }

      // (c) Could-not-evaluate (computeMonitoringChip REJECTS/throws): the
      //     existing chip must be PRESERVED — neither injectMonitoringChip nor
      //     the clear path fires; _lastMonitoring is left exactly as it was
      //     before this call (whatever a prior successful run set it to).
      {
        const sandbox = makeRunMonitoringSandbox('record|/patient/3', async () => { throw new Error('rules failed to load'); });
        // Seed _lastMonitoring as if a PRIOR successful pass had already
        // painted a real chip for this same token — the state a preserving
        // catch must leave completely alone.
        vm.runInContext("_lastMonitoring = { token: 'record|/patient/3', result: { level: 'amber', count: 1, items: [] } };", sandbox);
        sandbox.runMonitoringChip();
        await settle();
        check(sandbox.__calls.injected.length === 1,
          'could-not-evaluate: injectMonitoringChip called exactly once — the SYNCHRONOUS re-paint-from-cache at the top of runMonitoringChip (not a new result from the rejected compute)');
        check(sandbox.__calls.cleared === 0 && sandbox.__calls.removed === 0,
          'could-not-evaluate: the .catch() path never calls clearMonitoringDynActions/removeMonitoringChipEl — the chip is preserved, not cleared');
        const last = sandbox.__getLastMonitoring();
        check(
          !!last && last.token === 'record|/patient/3' && last.result && last.result.level === 'amber',
          '_lastMonitoring is untouched by the throw — still the seeded prior result, not overwritten or nulled'
        );
      }

      // (d) Token change (different patient/page): _lastMonitoring is reset
      //     and clearMonitoringDynActions runs SYNCHRONOUSLY up front,
      //     regardless of whether the subsequent compute throws — a preserved
      //     chip can never leak across a patient change.
      {
        const sandbox = makeRunMonitoringSandbox('record|/patient/5', async () => { throw new Error('still broken'); });
        vm.runInContext("_lastMonitoring = { token: 'record|/patient/4', result: { level: 'red', count: 2, items: [] } };", sandbox);
        sandbox.runMonitoringChip();
        // These assertions are on the SYNCHRONOUS portion of runMonitoringChip
        // (the token-change guard runs before the first `await`), so no settle() needed yet.
        check(sandbox.__calls.cleared === 1, 'token change: clearMonitoringDynActions runs synchronously up front');
        check(sandbox.__calls.invalidated === 1, 'token change: _monEvalCache.invalidate() runs synchronously up front');
        check(sandbox.__calls.injected.length === 0, 'token change: no re-paint-from-cache — the old token\'s chip is not this patient\'s');
        await settle();
        const last = sandbox.__getLastMonitoring();
        check(
          last === null,
          `token change + could-not-evaluate: _lastMonitoring ends up null — the stale patient-4 chip can never leak onto patient-5 (got ${JSON.stringify(last)})`
        );
      }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })();
} else {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
