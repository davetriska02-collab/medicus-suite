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
function run(rule, mock) {
  return engine.evaluatePatient(mock.medications, mock.observations, [rule], {
    now: mock.now, problems: mock.problems, patientContext: mock.patientContext, observationHistory: mock.observationHistory
  });
}

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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
