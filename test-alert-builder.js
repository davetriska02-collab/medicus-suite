// Medicus Suite — Custom Alert Builder live-preview round-trip (Phase 1)
// Run with: node test-alert-builder.js
//
// Proves the chain the builder's engine-backed preview relies on:
//   form-shaped rule  ->  validateCustomRule passes  ->  the SAME exported
//   evaluatePatient the runtime uses fires for the documented mock-patient shape
//   (medications / observations parsed from "name | value | YYYY-MM-DD").
// This is the parity guarantee: the preview cannot diverge from production
// except via a mock-patient shape mismatch, which these assertions pin.

'use strict';

const engine = require('./engine/rules-engine.js');
const { validateCustomRule } = require('./shared/io/sentinel-io.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Replicate readMockPatient()'s row parsing (the documented "a | b | c" format)
// so the test asserts the exact shape the builder feeds the engine.
function parseMock({ meds = [], obs = [], problems = [], age = null, sex = null, now }) {
  const cols = l => l.split('|').map(x => x.trim());
  const observations = obs.map(l => { const [name, value, date] = cols(l); return { name, code: null, value, date: date || null }; });
  return {
    medications: meds.map(name => ({ name })),
    observations,
    observationHistory: observations.map(o => ({ name: o.name, testName: o.name, value: o.value, date: o.date })),
    problems: problems.map(l => { const [label, codedDate] = cols(l); return { label, codedDate: codedDate || null, status: 'active' }; }),
    patientContext: { ageYears: age, sex },
    now: now || new Date().toISOString()
  };
}
function run(rule, mock, extra) {
  return engine.evaluatePatient(mock.medications, mock.observations, [...(extra || []), rule], {
    now: mock.now, problems: mock.problems, patientContext: mock.patientContext, observationHistory: mock.observationHistory
  });
}
function fires(rule, mock, extra) { return run(rule, mock, extra).some(c => c.ruleId === rule.id); }

// A drug-monitoring rule exactly as getFormRule() in sentinel-options emits it.
const formRule = {
  id: 'custom-mtx',
  type: 'drug-monitoring',
  drug: { match: ['methotrexate'] },
  drugClass: 'DMARD',
  tests: [{ name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 84, dueSoonDays: 28 }],
  enabled: true,
};

console.log('\n--- validateCustomRule (form object) ---');
let ok = true; try { validateCustomRule(formRule); } catch (e) { ok = false; console.error('   ' + e.message); }
check(ok, 'a form-shaped drug-monitoring rule passes the shared validator');

let threw = null;
try { validateCustomRule({ ...formRule, tests: [] }); } catch (e) { threw = e.message; }
check(/tests must be a non-empty array/.test(threw || ''), 'validator rejects a rule with no tests (live-preview ⚠ message)');

console.log('\n--- engine preview parity (overdue) ---');
const NOW = '2026-05-30T12:00:00.000Z';
let mock = parseMock({ meds: ['Methotrexate 10mg tablets'], obs: [`FBC | normal | ${isoDaysAgo(84 + 60)}`], age: 60, now: NOW });
let chips = run(formRule, mock);
let fired = chips.find(c => c.ruleId === formRule.id);
check(!!fired, 'fires (chip.ruleId matches) for a patient on the drug — the preview match key');
check(fired && fired.status === 'overdue', `status is overdue when FBC is ${84 + 60}d old (got ${fired && fired.status})`);
check(!!(fired && fired.evidence && fired.evidence.summary), 'chip carries evidence.summary for the preview body');

console.log('\n--- engine preview parity (in date) ---');
mock = parseMock({ meds: ['Methotrexate 10mg'], obs: ['FBC | normal | ' + isoDaysAgo(20)], age: 60, now: NOW });
fired = run(formRule, mock).find(c => c.ruleId === formRule.id);
check(fired && fired.status === 'in_date', `status is in_date when FBC is recent (got ${fired && fired.status})`);

console.log('\n--- no match (drug absent) ---');
mock = parseMock({ meds: ['Amlodipine 5mg'], obs: [], age: 60, now: NOW });
check(run(formRule, mock).find(c => c.ruleId === formRule.id) === undefined,
  'does not fire when the drug is absent ("would not fire" branch)');

// ── drug-combo ────────────────────────────────────────────────────────────
console.log('\n--- drug-combo round-trip ---');
const dcRule = { id: 'custom-dc', type: 'drug-combo', label: 'NSAID + anticoagulant',
  drugSets: [{ name: 'NSAID', match: ['ibuprofen'] }, { name: 'Anticoagulant', match: ['warfarin'] }], severity: 'red' };
ok = true; try { validateCustomRule(dcRule); } catch (e) { ok = false; console.error('   ' + e.message); }
check(ok, 'drug-combo form object validates');
check(fires(dcRule, parseMock({ meds: ['Ibuprofen 400mg', 'Warfarin 3mg'], age: 70, now: NOW })), 'fires when both drug sets present');
check(!fires(dcRule, parseMock({ meds: ['Ibuprofen 400mg'], age: 70, now: NOW })), 'does not fire with only one drug set');

// ── event-count ───────────────────────────────────────────────────────────
console.log('\n--- event-count round-trip ---');
const ecRule = { id: 'custom-ec', type: 'event-count', label: '>=3 UTIs / yr', sourceKind: 'problems',
  match: ['urinary tract infection'], windowMonths: 12, countThreshold: 3, operator: '>=', severity: 'amber' };
ok = true; try { validateCustomRule(ecRule); } catch (e) { ok = false; console.error('   ' + e.message); }
check(ok, 'event-count form object validates');
const utis = parseMock({ problems: [`urinary tract infection | ${isoDaysAgo(20)}`, `urinary tract infection | ${isoDaysAgo(120)}`, `urinary tract infection | ${isoDaysAgo(200)}`], now: NOW });
check(fires(ecRule, utis), 'fires at 3 events within the window (>=3)');
check(!fires(ecRule, parseMock({ problems: [`urinary tract infection | ${isoDaysAgo(20)}`], now: NOW })), 'does not fire at 1 event');

// ── qof-indicator (observation-threshold) ─────────────────────────────────
console.log('\n--- qof-indicator round-trip ---');
const ciRule = { id: 'custom-ci', type: 'qof-indicator', indicatorCode: 'X01', indicatorName: 'HbA1c control',
  check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '>=' } };
ok = true; try { validateCustomRule(ciRule); } catch (e) { ok = false; console.error('   ' + e.message); }
check(ok, 'qof-indicator form object validates');
check(fires(ciRule, parseMock({ obs: [`HbA1c | 64 | ${isoDaysAgo(30)}`], age: 60, now: NOW })), 'fires when HbA1c 64 crosses the >=58 threshold');

// ── composite (children passed as extra rules) ────────────────────────────
console.log('\n--- composite round-trip ---');
const cmRule = { id: 'custom-cm', type: 'composite', label: 'NSAID+AC AND recurrent UTI',
  operator: 'AND', ruleIds: ['custom-dc', 'custom-ec'], severity: 'red' };
ok = true; try { validateCustomRule(cmRule); } catch (e) { ok = false; console.error('   ' + e.message); }
check(ok, 'composite form object validates');
const bothMock = parseMock({
  meds: ['Ibuprofen 400mg', 'Warfarin 3mg'],
  problems: [`urinary tract infection | ${isoDaysAgo(20)}`, `urinary tract infection | ${isoDaysAgo(120)}`, `urinary tract infection | ${isoDaysAgo(200)}`],
  age: 70, now: NOW
});
check(fires(cmRule, bothMock, [dcRule, ecRule]), 'AND-composite fires when both children fire (extraRules wired like cmExtraRules)');
const oneMock = parseMock({ meds: ['Ibuprofen 400mg', 'Warfarin 3mg'], age: 70, now: NOW });
check(!fires(cmRule, oneMock, [dcRule, ecRule]), 'AND-composite does not fire when only one child fires');

// ── observation-alert: garbage date must produce no chip (Task 1b / 1d) ────────
console.log('\n--- observation-alert: garbage obs.date → no chip ---');
const alertRule = {
  id: 'custom-alert-test',
  type: 'qof-indicator',
  indicatorCode: 'TEST01',
  indicatorName: 'Potassium alert',
  check: {
    kind: 'observation-alert',
    observation: ['potassium'],
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    withinDays: 365,
  },
};
// Dangerous value (above red threshold) but with an unparseable date.
// Must return no chip — the invalid date is treated as a missing/stale result.
const garbageDateMock = parseMock({
  obs: ['Potassium | 6.5 | not-a-date'],
  age: 60,
  now: NOW,
});
const alertChips = run(alertRule, garbageDateMock);
check(alertChips.filter(c => c.ruleId === alertRule.id).length === 0,
  'observation-alert with garbage date and dangerous value produces no chip');

// Sanity check: the same value with a valid date DOES produce a chip.
const validDateMock = parseMock({
  obs: [`Potassium | 6.5 | ${isoDaysAgo(10)}`],
  age: 60,
  now: NOW,
});
const alertChipsValid = run(alertRule, validDateMock);
check(alertChipsValid.filter(c => c.ruleId === alertRule.id).length === 1,
  'observation-alert with valid date and dangerous value produces a chip (sanity check)');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
