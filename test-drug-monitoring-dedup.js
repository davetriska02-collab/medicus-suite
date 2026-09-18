// Medicus Suite — Drug-monitoring duplicate-regimen-record de-duplication
// Run with: node test-drug-monitoring-dedup.js
//
// A live patient can have the SAME drug appear as two separate regimen
// records — e.g. a superseded mid-course reauthorisation row that hasn't
// dropped off Medicus's own "current" bucket yet (confirmed real, not a
// reimport artifact: docs/learnings-medication-regimen-duplicates.md).
// Before this fix, evaluateDrugRule emitted one full monitoring chip per
// matched medication record, so the panel showed the same drug twice (e.g.
// "Leflunomide 20mg tablets" and a bare "Leflunomide" from the second
// record's description-less fallback name) even though there is only one
// set of tests to check. This pins the de-duplication by vtmProductName.

'use strict';
const path = require('path');
const engine = require('./engine/rules-engine.js');
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

const leflunomide = (drugRules.rules || []).find((r) => r.id === 'leflunomide-maintenance');
const NOW = '2026-08-29T12:00:00';

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

console.log('\n--- rule wiring ---');
check(!!leflunomide, 'leflunomide-maintenance rule exists in drug-rules.json');

function fbc(date) {
  return { name: 'FBC', date, value: 'normal' };
}

console.log('\n--- two regimen records, same vtmProductName → ONE chip, not two ---');
{
  const meds = [
    { name: 'Leflunomide 20mg tablets', vtm: 'Leflunomide', startDate: '2024-01-10', source: 'Repeat' },
    { name: 'Leflunomide', vtm: 'Leflunomide', startDate: '2024-01-10', source: 'Repeat' }, // superseded row, description-less fallback name
  ];
  const chips = engine.evaluatePatient(meds, [fbc('2026-07-22')], [leflunomide], { now: NOW });
  const matching = chips.filter((c) => c.ruleId === 'leflunomide-maintenance');
  check(matching.length === 1, `exactly one chip emitted for the duplicated drug (got ${matching.length})`);
  check(
    matching[0] && matching[0].drugName === 'Leflunomide 20mg tablets',
    `kept the more detailed name (got ${matching[0] && matching[0].drugName})`
  );
}

console.log('\n--- two regimen records, DIFFERENT vtmProductName → still two chips (genuinely different drugs) ---');
{
  const meds = [
    { name: 'Leflunomide 20mg tablets', vtm: 'Leflunomide', startDate: '2024-01-10', source: 'Repeat' },
    { name: 'Arava 10mg tablets', vtm: 'Arava', startDate: '2024-01-10', source: 'Repeat' },
  ];
  const chips = engine.evaluatePatient(meds, [fbc('2026-07-22')], [leflunomide], { now: NOW });
  const matching = chips.filter((c) => c.ruleId === 'leflunomide-maintenance');
  check(matching.length === 2, `distinct vtm names are NOT merged (got ${matching.length})`);
}

console.log('\n--- two regimen records, no vtmProductName on either side → left alone (no unsafe merge guess) ---');
{
  const meds = [
    { name: 'Leflunomide 20mg tablets', vtm: null, startDate: '2024-01-10', source: 'Repeat' },
    { name: 'Leflunomide 20mg tablets', vtm: null, startDate: '2024-01-10', source: 'Prescribed elsewhere' },
  ];
  const chips = engine.evaluatePatient(meds, [fbc('2026-07-22')], [leflunomide], { now: NOW });
  const matching = chips.filter((c) => c.ruleId === 'leflunomide-maintenance');
  check(matching.length === 2, `without vtmProductName on either side, both are kept (got ${matching.length})`);
}

console.log('\n--- same VTM, mismatched startDates → keep longer name AND earliest start ---');
{
  // The longer display name is often the current-batch row whose startDate
  // is the regimen endpoint's ~12-month window; the shorter fallback row
  // (or the prescribing-history join) can carry the true clinical start.
  // Dedup used to keep the longer name wholesale and drop the earlier date.
  const meds = [
    { name: 'Ramipril 5mg capsules', vtm: 'Ramipril', startDate: '2025-09-16', source: 'Repeat' },
    { name: 'Ramipril', vtm: 'Ramipril', startDate: '2013-10-04', source: 'Repeat' },
  ];
  const aceArb = (drugRules.rules || []).find((r) => r.id === 'ace-arb');
  check(!!aceArb, 'ace-arb rule exists (needed for startDate-preserving dedup)');
  const chips = engine.evaluatePatient(meds, [], [aceArb], { now: NOW });
  const matching = chips.filter((c) => c.ruleId === 'ace-arb');
  check(matching.length === 1, `exactly one ace-arb chip after VTM merge (got ${matching.length})`);
  check(
    matching[0] && matching[0].drugName === 'Ramipril 5mg capsules',
    `kept the more detailed name (got ${matching[0] && matching[0].drugName})`
  );
  const drugFact =
    matching[0] &&
    matching[0].evidence &&
    (matching[0].evidence.facts || []).find((f) => f.label === 'Drug matched');
  check(
    drugFact && drugFact.date === '2013-10-04',
    `merged chip keeps the earliest startDate, not the batch-scoped 2025 date (got ${drugFact && drugFact.date})`
  );
}

console.log('\n--- single regimen record (the common case) → unaffected ---');
{
  const meds = [{ name: 'Leflunomide 20mg tablets', vtm: 'Leflunomide', startDate: '2024-01-10', source: 'Repeat' }];
  const chips = engine.evaluatePatient(meds, [fbc('2026-07-22')], [leflunomide], { now: NOW });
  const matching = chips.filter((c) => c.ruleId === 'leflunomide-maintenance');
  check(matching.length === 1, `a normal single-record patient still gets exactly one chip (got ${matching.length})`);
}

console.log('\n--- HAR 133: one repeat (vtm) + six acute issues + prescribed-elsewhere → ONE tirzepatide chip ---');
{
  const glp1 = (drugRules.rules || []).find((r) => r.id === 'glp1-receptor-agonist');
  check(!!glp1, 'glp1-receptor-agonist rule exists');
  const acute = (date) => ({
    name: 'Tirzepatide · Solution for injection',
    vtm: null,
    startDate: date,
    lastIssueDate: date,
    source: 'Acute',
  });
  const repeat = {
    name: 'Mounjaro KwikPen 15mg/0.6ml solution for injection 2.4ml pre-filled pens (Eli Lilly and Company Ltd)',
    vtm: 'Tirzepatide',
    startDate: '2026-03-16',
    source: 'Repeat',
  };
  const meds = [
    repeat,
    acute('2026-07-15'),
    acute('2026-02-16'),
    acute('2026-01-07'),
    acute('2025-12-10'),
    acute('2025-11-12'),
    acute('2025-10-22'),
    { name: 'Semaglutide', vtm: null, startDate: null, source: 'Prescribed elsewhere' },
    { name: 'Tirzepatide', vtm: null, startDate: null, source: 'Prescribed elsewhere' },
  ];
  const chips = engine.evaluatePatient(meds, [], [glp1], { now: NOW }).filter((c) => c.ruleId === 'glp1-receptor-agonist');
  check(chips.length === 2, `tirzepatide collapses to one chip, semaglutide stays separate (got ${chips.length})`);
  const tirz = chips.find((c) => /mounjaro|tirzepatide/i.test(c.drugName));
  check(tirz && /Mounjaro/.test(tirz.drugName), `kept the detailed repeat name (got ${tirz && tirz.drugName})`);
  const fact = tirz && tirz.evidence && (tirz.evidence.facts || []).find((f) => f.label === 'Drug matched');
  check(fact && fact.date === '2025-10-22', `earliest start across the merged rows is kept (got ${fact && fact.date})`);
  check(
    chips.some((c) => /semaglutide/i.test(c.drugName)),
    'semaglutide (a different drug in the same class) is NOT merged into tirzepatide'
  );
}

console.log('\n--- acute-only history (no repeat row, no vtm anywhere) → still collapses per substance ---');
{
  const glp1 = (drugRules.rules || []).find((r) => r.id === 'glp1-receptor-agonist');
  const meds = ['2026-07-15', '2026-02-16', '2025-12-10'].map((d) => ({
    name: 'Tirzepatide · Solution for injection',
    vtm: null,
    startDate: d,
    source: 'Acute',
  }));
  const chips = engine.evaluatePatient(meds, [], [glp1], { now: NOW }).filter((c) => c.ruleId === 'glp1-receptor-agonist');
  check(chips.length === 1, `three acute issues of one substance → one chip (got ${chips.length})`);
}

console.log('\n--- different substances in acute lines are NOT merged; unrelated bare names are left alone ---');
{
  const glp1 = (drugRules.rules || []).find((r) => r.id === 'glp1-receptor-agonist');
  const meds = [
    { name: 'Tirzepatide · Solution for injection', vtm: null, startDate: '2026-01-01', source: 'Acute' },
    { name: 'Semaglutide · Solution for injection', vtm: null, startDate: '2026-01-01', source: 'Acute' },
    // bare name with no matching key anywhere: same conservative behaviour as before
    { name: 'Liraglutide', vtm: null, startDate: null, source: 'Prescribed elsewhere' },
    { name: 'Liraglutide', vtm: null, startDate: null, source: 'Prescribed elsewhere' },
  ];
  const chips = engine.evaluatePatient(meds, [], [glp1], { now: NOW }).filter((c) => c.ruleId === 'glp1-receptor-agonist');
  check(chips.length === 4, `2 distinct acute substances + 2 unmatched bare rows stay separate (got ${chips.length})`);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
