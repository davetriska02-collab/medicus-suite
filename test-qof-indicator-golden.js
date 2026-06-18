// Medicus Suite — evaluateQofIndicatorRule golden-snapshot regression test
// Run with:        node test-qof-indicator-golden.js
// Regenerate gold: UPDATE=1 node test-qof-indicator-golden.js
//
// evaluateQofIndicatorRule is the largest function in the engine and handles
// every QOF/indicator check kind. This test pins its EXACT chip output across a
// battery of fixtures that exercise each check kind and each outcome branch
// (achieved / not_met / overdue / no_data / alert / suppressed). The serialized
// output is committed as test-fixtures/qof-indicator-golden.json.
//
// Purpose: behaviour-preserving refactors of this function (e.g. extracting the
// per-kind branches into a dispatch table) must leave chip output byte-identical.
// A green `node --test` is NOT sufficient proof on its own — this golden diff is.
// If a change to this function is INTENTIONAL, eyeball the diff and regenerate
// with UPDATE=1; otherwise a non-empty diff is a regression.

'use strict';

const fs = require('fs');
const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));

const NOW = '2026-06-18T12:00:00.000Z'; // deterministic; QOF year floor = 2026-04-01
const IN_WINDOW = '2026-05-01'; // after the QOF-year floor
const OUT_WINDOW = '2026-02-01'; // before the QOF-year floor
const recent = (d) => d; // alias for readability

// Each fixture: a rule + the patient data it sees. Kept minimal but exercising
// the branch noted in `name`.
const FIXTURES = [];
const add = (name, rule, data) => FIXTURES.push({ name, rule, data });

const ctx = (over = {}) => ({ patientName: 'T', ageYears: 60, sex: 'female', ...over });
const baseData = (over = {}) => ({
  patientContext: ctx(),
  problems: [],
  medications: [],
  observations: [],
  observationHistory: [],
  ...over,
});

// ── observation-alert ──────────────────────────────────────────────────────
const alertRule = (over = {}) => ({
  id: 'alert-k',
  indicatorCode: 'K',
  indicatorName: 'Potassium',
  check: {
    kind: 'observation-alert',
    observation: ['potassium'],
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    withinDays: 365,
  },
  ...over,
});
add('alert: red', alertRule(), baseData({ observations: [{ name: 'Potassium', value: '6.5', date: IN_WINDOW }] }));
add('alert: amber', alertRule(), baseData({ observations: [{ name: 'Potassium', value: '5.7', date: IN_WINDOW }] }));
add(
  'alert: safe → no chip',
  alertRule(),
  baseData({ observations: [{ name: 'Potassium', value: '4.0', date: IN_WINDOW }] })
);
add(
  'alert: stale → no chip',
  alertRule(),
  baseData({ observations: [{ name: 'Potassium', value: '6.5', date: '2024-01-01' }] })
);
add(
  'alert: bad date → no chip',
  alertRule(),
  baseData({ observations: [{ name: 'Potassium', value: '6.5', date: 'not-a-date' }] })
);
add('alert: missing obs → no chip', alertRule(), baseData());

// ── observation-threshold ───────────────────────────────────────────────────
const thrRule = (over = {}) => ({
  id: 'thr-hba1c',
  indicatorCode: 'DM',
  indicatorName: 'HbA1c',
  check: { kind: 'observation-threshold', observation: ['hba1c'], operator: '<=', threshold: 58, unit: 'mmol/mol' },
  ...over,
});
add('threshold: achieved', thrRule(), baseData({ observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }] }));
add('threshold: not_met', thrRule(), baseData({ observations: [{ name: 'HbA1c', value: '70', date: IN_WINDOW }] }));
add(
  'threshold: overdue (out of window)',
  thrRule(),
  baseData({ observations: [{ name: 'HbA1c', value: '50', date: OUT_WINDOW }] })
);
add(
  'threshold: no_data (unparseable value)',
  thrRule(),
  baseData({ observations: [{ name: 'HbA1c', value: 'pending', date: IN_WINDOW }] })
);
add(
  'threshold: BP achieved',
  thrRule({
    id: 'thr-bp',
    check: {
      kind: 'observation-threshold',
      observation: ['blood pressure'],
      thresholdSystolic: 140,
      thresholdDiastolic: 90,
    },
  }),
  baseData({ observations: [{ name: 'Blood pressure', value: '130/80', date: IN_WINDOW }] })
);
add(
  'threshold: BP not_met',
  thrRule({
    id: 'thr-bp',
    check: {
      kind: 'observation-threshold',
      observation: ['blood pressure'],
      thresholdSystolic: 140,
      thresholdDiastolic: 90,
    },
  }),
  baseData({ observations: [{ name: 'Blood pressure', value: '150/95', date: IN_WINDOW }] })
);

// ── medication-present ──────────────────────────────────────────────────────
const medRule = (over = {}) => ({
  id: 'med-acei',
  indicatorCode: 'M',
  indicatorName: 'ACEi',
  check: { kind: 'medication-present', medicationMatch: ['ramipril'], medicationExclude: [] },
  ...over,
});
add('med-present: achieved', medRule(), baseData({ medications: [{ name: 'Ramipril 5mg capsules' }] }));
add('med-present: not_met', medRule(), baseData({ medications: [{ name: 'Atorvastatin 40mg' }] }));
add(
  'med-present: excluded',
  medRule({ check: { kind: 'medication-present', medicationMatch: ['ramipril'], medicationExclude: ['ramipril'] } }),
  baseData({ medications: [{ name: 'Ramipril 5mg capsules' }] })
);

// ── observation-recent ──────────────────────────────────────────────────────
const recRule = (over = {}) => ({
  id: 'rec-smoking',
  indicatorCode: 'SMOK',
  indicatorName: 'Smoking status',
  check: { kind: 'observation-recent', observation: ['smoking'] },
  ...over,
});
add(
  'recent: achieved',
  recRule(),
  baseData({ observations: [{ name: 'Smoking status', value: 'Non-smoker', date: IN_WINDOW }] })
);
add(
  'recent: overdue',
  recRule(),
  baseData({ observations: [{ name: 'Smoking status', value: 'Non-smoker', date: OUT_WINDOW }] })
);
add('recent: no_data', recRule(), baseData());

// ── observation-bundle ──────────────────────────────────────────────────────
const bundleRule = (over = {}) => ({
  id: 'bundle-dm',
  indicatorCode: 'DM037',
  indicatorName: 'Care processes',
  check: {
    kind: 'observation-bundle',
    observations: [['hba1c'], ['blood pressure'], ['cholesterol']],
    requireAll: true,
  },
  ...over,
});
const bundleObs = (which) =>
  [
    which.includes('a') && { name: 'HbA1c', value: '50', date: IN_WINDOW },
    which.includes('b') && { name: 'Blood pressure', value: '130/80', date: IN_WINDOW },
    which.includes('c') && { name: 'Cholesterol', value: '4.2', date: IN_WINDOW },
  ].filter(Boolean);
add('bundle: all met', bundleRule(), baseData({ observations: bundleObs('abc') }));
add('bundle: partial → not_met', bundleRule(), baseData({ observations: bundleObs('ab') }));
add('bundle: none → no_data', bundleRule(), baseData({ observations: [] }));
add(
  'bundle: not requireAll, some → achieved',
  bundleRule({
    check: {
      kind: 'observation-bundle',
      observations: [['hba1c'], ['blood pressure'], ['cholesterol']],
      requireAll: false,
    },
  }),
  baseData({ observations: bundleObs('a') })
);

// ── medication-all-of ───────────────────────────────────────────────────────
const allOfRule = (over = {}) => ({
  id: 'hf-pillars',
  indicatorCode: 'HF009',
  indicatorName: 'Four pillars',
  check: {
    kind: 'medication-all-of',
    groups: [
      { name: 'ACEi/ARB', match: ['ramipril', 'losartan'] },
      { name: 'Beta-blocker', match: ['bisoprolol'] },
      { name: 'MRA', match: ['spironolactone'] },
    ],
  },
  ...over,
});
add(
  'all-of: all → achieved',
  allOfRule(),
  baseData({ medications: [{ name: 'Ramipril 5mg' }, { name: 'Bisoprolol 5mg' }, { name: 'Spironolactone 25mg' }] })
);
add(
  'all-of: partial → not_met',
  allOfRule(),
  baseData({ medications: [{ name: 'Ramipril 5mg' }, { name: 'Bisoprolol 5mg' }] })
);
add('all-of: empty meds → no_data', allOfRule(), baseData({ medications: [] }));

// ── observation-trend ───────────────────────────────────────────────────────
const trendRule = (over = {}) => ({
  id: 'trend-creat',
  indicatorCode: 'CREAT',
  indicatorName: 'Creatinine trend',
  check: {
    kind: 'observation-trend',
    observation: ['creatinine'],
    direction: 'rising',
    minPoints: 2,
    withinMonths: 24,
    minDelta: 0,
  },
  ...over,
});
const hist = (vals) => [
  {
    name: 'Creatinine',
    unit: 'umol/L',
    history: vals.map((v, i) => ({ date: `2026-0${6 - i}-01`, value: v })), // newest-first
  },
];
add('trend: rising fires → not_met', trendRule(), baseData({ observationHistory: hist([120, 100, 90]) }));
add('trend: falling (rising rule) → achieved', trendRule(), baseData({ observationHistory: hist([90, 100, 120]) }));
add('trend: insufficient points → no_data', trendRule(), baseData({ observationHistory: hist([120]) }));
add(
  'trend: falling rule fires → not_met',
  trendRule({
    check: {
      kind: 'observation-trend',
      observation: ['egfr'],
      direction: 'falling',
      minPoints: 2,
      withinMonths: 24,
      minDelta: 0,
    },
  }),
  baseData({
    observationHistory: [
      {
        name: 'eGFR',
        unit: 'ml/min',
        history: [
          { date: '2026-06-01', value: 50 },
          { date: '2026-04-01', value: 80 },
        ],
      },
    ],
  })
);

// ── preconditions (Steps 1–3) ───────────────────────────────────────────────
add(
  'precondition: not on required register → suppressed',
  thrRule({ requiresRegister: 'dm-register' }),
  baseData({
    observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }],
    _registerLookup: { 'dm-register': { registerName: 'Diabetes', match: ['diabetes'] } },
  })
);
add(
  'precondition: on register → evaluates',
  thrRule({ requiresRegister: 'dm-register' }),
  baseData({
    problems: [{ label: 'Type 2 diabetes mellitus', codedDate: '2019-01-01' }],
    observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }],
    _registerLookup: { 'dm-register': { registerName: 'Diabetes', match: ['diabetes'] } },
  })
);
add(
  'precondition: null age fail-open (still evaluates)',
  thrRule({ ageRange: { min: 40 } }),
  baseData({ patientContext: ctx({ ageYears: null }), observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }] })
);
add(
  'precondition: sex mismatch → suppressed',
  thrRule({ sex: 'male' }),
  baseData({ observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }] })
);
add(
  'precondition: requiresProblem unmet → suppressed',
  thrRule({ requiresProblem: ['heart failure'] }),
  baseData({ observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }] })
);
add(
  'precondition: excludeIfProblem hit → suppressed',
  thrRule({ excludeIfProblem: ['frailty'] }),
  baseData({
    problems: [{ label: 'Moderate frailty' }],
    observations: [{ name: 'HbA1c', value: '50', date: IN_WINDOW }],
  })
);

// ── Run all fixtures and serialize ──────────────────────────────────────────
// Deep-sort object keys so serialization is stable regardless of insertion order.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .reduce((o, k) => {
        o[k] = sortKeys(v[k]);
        return o;
      }, {});
  }
  return v;
}

const actual = {};
for (const f of FIXTURES) {
  const chips = engine.evaluateQofIndicatorRule(f.rule, f.data, NOW);
  actual[f.name] = sortKeys(chips);
}
const actualStr = JSON.stringify(actual, null, 2);

const goldenPath = path.join(__dirname, 'test-fixtures', 'qof-indicator-golden.json');

if (process.env.UPDATE === '1') {
  fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
  fs.writeFileSync(goldenPath, actualStr + '\n');
  console.log(`Golden updated: ${goldenPath} (${FIXTURES.length} fixtures)`);
  process.exit(0);
}

if (!fs.existsSync(goldenPath)) {
  console.error(`FAIL  golden snapshot missing. Generate it with: UPDATE=1 node test-qof-indicator-golden.js`);
  process.exit(1);
}

const goldenStr = fs.readFileSync(goldenPath, 'utf8').replace(/\n$/, '');
if (actualStr === goldenStr) {
  console.log(`  OK  evaluateQofIndicatorRule output matches golden across ${FIXTURES.length} fixtures`);
  console.log(`\nQOF indicator golden: 1 passed, 0 failed`);
  process.exit(0);
}

// Diff: find the first differing fixture for a readable failure message.
const golden = JSON.parse(goldenStr);
let firstDiff = null;
for (const f of FIXTURES) {
  if (JSON.stringify(actual[f.name]) !== JSON.stringify(golden[f.name])) {
    firstDiff = f.name;
    break;
  }
}
console.error('  FAIL  evaluateQofIndicatorRule output drifted from golden snapshot');
if (firstDiff) {
  console.error(`        first differing fixture: "${firstDiff}"`);
  console.error(`        golden: ${JSON.stringify(golden[firstDiff])}`);
  console.error(`        actual: ${JSON.stringify(actual[firstDiff])}`);
}
console.error(`\n        If this change is intentional, regenerate: UPDATE=1 node test-qof-indicator-golden.js`);
console.log(`\nQOF indicator golden: 0 passed, 1 failed`);
process.exit(1);
