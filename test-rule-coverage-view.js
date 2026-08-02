// Medicus Suite — Sentinel rule-coverage drill-down tests
// Run with: node test-rule-coverage-view.js
//
// Exercises buildCoverageView() in side-panel/modules/sentinel/coverage-core.js
// against the REAL rule files (rules/drug-rules.json, rules/qof-rules.json), so
// this is a regression guard: if a rule is added/removed/retired, this test's
// counts move with it automatically (no hand-maintained EXPECTED map needed —
// the assertion is "the view's counts equal what's actually in the files",
// checked independently by re-deriving the counts here from the same JSON).
//
// Also exercises the function directly against small hand-built fixtures for
// edge cases (disabled rules, missing fields, empty files).

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

async function main() {
  const modPath = new URL(
    'side-panel/modules/sentinel/coverage-core.js',
    `file://${process.cwd().replace(/\\/g, '/')}/`
  ).href;
  const { buildCoverageView } = await import(modPath);
  check(typeof buildCoverageView === 'function', 'buildCoverageView imported');

  // ── 1. Real rule files: counts must equal the JSON ──────────────────────────
  console.log('\n--- counts match the real rule files ---');

  const drugPath = path.join(__dirname, 'rules', 'drug-rules.json');
  const qofPath = path.join(__dirname, 'rules', 'qof-rules.json');
  const drugData = JSON.parse(fs.readFileSync(drugPath, 'utf8'));
  const qofData = JSON.parse(fs.readFileSync(qofPath, 'utf8'));

  const view = buildCoverageView(drugData, qofData);

  // Independently re-derive expected counts straight from the JSON (not via
  // the module under test) so this is a genuine cross-check, not a tautology.
  const expectedDrugTotal = drugData.rules.length;
  const expectedDrugEnabled = drugData.rules.filter((r) => r.enabled !== false).length;
  const expectedMonitoringRules = drugData.rules.filter((r) => r.type === 'drug-monitoring');

  check(
    view.drug.total === expectedDrugTotal,
    `drug.total (${view.drug.total}) === rules.length (${expectedDrugTotal})`
  );
  check(
    view.drug.enabled === expectedDrugEnabled,
    `drug.enabled (${view.drug.enabled}) === enabled rule count (${expectedDrugEnabled})`
  );
  check(
    view.drug.monitoringTotal === expectedMonitoringRules.length,
    `drug.monitoringTotal (${view.drug.monitoringTotal}) === drug-monitoring rule count (${expectedMonitoringRules.length})`
  );
  check(
    view.drug.rules.length === expectedMonitoringRules.length,
    `drug.rules listing length (${view.drug.rules.length}) === drug-monitoring rule count`
  );

  // Every listed rule's terms must equal the source rule's drug.match array exactly.
  const drugById = new Map(drugData.rules.map((r) => [r.id, r]));
  let allTermsMatch = true;
  for (const listed of view.drug.rules) {
    const src = drugById.get(listed.id);
    const srcTerms = (src && src.drug && src.drug.match) || [];
    if (JSON.stringify(listed.terms) !== JSON.stringify(srcTerms)) {
      allTermsMatch = false;
      console.error(`    mismatch for ${listed.id}: ${JSON.stringify(listed.terms)} !== ${JSON.stringify(srcTerms)}`);
    }
  }
  check(allTermsMatch, 'every listed drug rule carries its exact source drug.match terms');

  const expectedQofTotal = qofData.rules.length;
  const expectedQofEnabled = qofData.rules.filter((r) => r.enabled !== false).length;
  const expectedRegisters = qofData.rules.filter((r) => r.type === 'qof-register');
  const expectedIndicators = qofData.rules.filter((r) => r.type === 'qof-indicator');

  check(view.qof.total === expectedQofTotal, `qof.total (${view.qof.total}) === rules.length (${expectedQofTotal})`);
  check(
    view.qof.enabled === expectedQofEnabled,
    `qof.enabled (${view.qof.enabled}) === enabled rule count (${expectedQofEnabled})`
  );
  check(
    view.qof.registerCount === expectedRegisters.length,
    `qof.registerCount (${view.qof.registerCount}) === qof-register count (${expectedRegisters.length})`
  );
  check(
    view.qof.indicatorCount === expectedIndicators.length,
    `qof.indicatorCount (${view.qof.indicatorCount}) === qof-indicator count (${expectedIndicators.length})`
  );
  check(view.qof.registers.length === expectedRegisters.length, 'registers listing length matches qof-register count');
  check(
    view.qof.indicators.length === expectedIndicators.length,
    'indicators listing length matches qof-indicator count'
  );

  // Every register/indicator code from the source file must appear somewhere
  // in the listing (nothing silently dropped).
  const listedRegisterCodes = new Set(view.qof.registers.map((r) => r.registerCode));
  const missingRegister = expectedRegisters.find((r) => !listedRegisterCodes.has(r.registerCode));
  check(!missingRegister, 'no QOF register missing from the listing');

  const listedIndicatorCodes = new Set(view.qof.indicators.map((i) => i.indicatorCode));
  const missingIndicator = expectedIndicators.find((i) => !listedIndicatorCodes.has(i.indicatorCode));
  check(!missingIndicator, 'no QOF indicator missing from the listing');

  // ── 2. Enabled-first ordering ─────────────────────────────────────────────
  console.log('\n--- ordering: enabled rules before disabled ---');
  let sawDisabled = false;
  let orderOk = true;
  for (const r of view.drug.rules) {
    if (!r.enabled) sawDisabled = true;
    else if (sawDisabled) orderOk = false;
  }
  check(orderOk, 'drug rules: enabled-before-disabled ordering holds');

  sawDisabled = false;
  orderOk = true;
  for (const r of view.qof.indicators) {
    if (!r.enabled) sawDisabled = true;
    else if (sawDisabled) orderOk = false;
  }
  check(orderOk, 'qof indicators: enabled-before-disabled ordering holds');

  // ── 3. Small fixtures: disabled rules, missing fields, exclusions ──────────
  console.log('\n--- fixtures: shape and edge cases ---');

  const fixtureDrug = {
    rules: [
      {
        type: 'drug-monitoring',
        id: 'aaa-rule',
        enabled: true,
        drugClass: 'Test',
        drug: { match: ['aaa', 'bbb'] },
        tests: [{ name: 'FBC' }, { name: 'U&E' }],
      },
      {
        type: 'drug-monitoring',
        id: 'zzz-rule-disabled',
        enabled: false,
        drug: { match: ['zzz'] },
        tests: [],
      },
      {
        type: 'drug-no-monitoring',
        id: 'no-mon-rule',
        enabled: true,
        drug: { match: ['ccc'] },
      },
    ],
  };
  const fixtureQof = {
    rules: [
      { type: 'qof-register', id: 'reg-a', enabled: true, registerCode: 'AAA', registerName: 'Alpha register' },
      {
        type: 'qof-indicator',
        id: 'ind-a',
        enabled: true,
        indicatorCode: 'AAA001',
        indicatorName: 'Alpha indicator',
        requiresRegister: 'AAA',
      },
      {
        type: 'qof-indicator',
        id: 'ind-b-disabled',
        enabled: false,
        indicatorCode: 'BBB001',
        indicatorName: '[RETIRED] Beta indicator',
      },
    ],
  };

  const fv = buildCoverageView(fixtureDrug, fixtureQof);
  check(fv.drug.total === 3, 'fixture: drug.total counts all rule entries incl. drug-no-monitoring');
  check(fv.drug.monitoringTotal === 2, 'fixture: drug.monitoringTotal excludes drug-no-monitoring');
  check(fv.drug.rules.length === 2, 'fixture: drug.rules listing excludes drug-no-monitoring');
  check(fv.drug.enabled === 2, 'fixture: drug.enabled counts across all types (2 of 3 enabled)');
  check(
    fv.drug.rules[0].id === 'aaa-rule' && fv.drug.rules[0].enabled === true,
    'fixture: enabled rule sorts before disabled'
  );
  check(fv.drug.rules[0].terms.join(',') === 'aaa,bbb', 'fixture: terms array preserved verbatim');
  check(fv.drug.rules[0].testCount === 2, 'fixture: testCount derived from tests array length');
  check(
    fv.drug.rules[1].id === 'zzz-rule-disabled' && fv.drug.rules[1].enabled === false,
    'fixture: disabled rule listed last'
  );

  check(fv.qof.registerCount === 1 && fv.qof.indicatorCount === 2, 'fixture: qof register/indicator counts correct');
  check(fv.qof.registers[0].registerName === 'Alpha register', 'fixture: register name surfaced');
  check(fv.qof.indicators[0].indicatorCode === 'AAA001', 'fixture: enabled indicator first');
  check(
    fv.qof.indicators[1].indicatorCode === 'BBB001' && !fv.qof.indicators[1].enabled,
    'fixture: disabled indicator last'
  );

  // ── 4. Missing / empty input never throws ──────────────────────────────────
  console.log('\n--- missing/empty input ---');
  {
    let threw = false;
    let v = null;
    try {
      v = buildCoverageView(null, null);
    } catch (_) {
      threw = true;
    }
    check(!threw, 'buildCoverageView(null, null) does not throw');
    check(v && v.drug.total === 0 && v.drug.rules.length === 0, 'null drug data → zeroed, empty listing');
    check(
      v && v.qof.total === 0 && v.qof.registers.length === 0 && v.qof.indicators.length === 0,
      'null qof data → zeroed, empty listing'
    );
  }
  {
    let threw = false;
    try {
      buildCoverageView(undefined, undefined);
    } catch (_) {
      threw = true;
    }
    check(!threw, 'buildCoverageView(undefined, undefined) does not throw');
  }
  {
    const v = buildCoverageView({}, {});
    check(v.drug.total === 0 && v.qof.total === 0, 'empty-object input → zeroed counts, no crash');
  }
  {
    // Rule missing drug.match entirely → empty terms array, not a crash.
    const v = buildCoverageView({ rules: [{ type: 'drug-monitoring', id: 'no-terms' }] }, {});
    check(
      v.drug.rules.length === 1 && v.drug.rules[0].terms.length === 0,
      'rule with no drug.match → empty terms array, no crash'
    );
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
