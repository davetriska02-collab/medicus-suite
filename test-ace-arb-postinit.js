// Medicus Suite — ACE-I/ARB post-initiation U&E rule tests
// Run with: node test-ace-arb-postinit.js
//
// Verifies the NICE NG136 post-initiation U&E check on the real `ace-arb` rule
// (rules/drug-rules.json), evaluated through the real engine. The new engine
// `postInitiationDays` mechanism makes a MISSING U&E after starting an ACE-I/ARB
// actionable, while never crying wolf on an established patient whose start date
// is not visible. A fixed `now` keeps every age deterministic.

'use strict';
const path = require('path');
const engine = require('./engine/rules-engine.js');
const drugRules = require(path.join(__dirname, 'rules', 'drug-rules.json'));

const aceArb = (drugRules.rules || []).find((r) => r.id === 'ace-arb');
const NOW = '2026-06-29T12:00:00';

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

// Evaluate a single patient against ONLY the ace-arb rule, returning the chip
// and its post-initiation U&E test evaluation.
function evalAce({ startDate, observations }) {
  const meds = [{ name: 'Ramipril 5mg capsules', startDate: startDate || null }];
  const chips = engine.evaluatePatient(meds, observations || [], [aceArb], { now: NOW });
  const chip = chips.find((c) => c.ruleId === 'ace-arb');
  const postInit = chip ? (chip.tests || []).find((t) => t.postInitiation === true) : null;
  return { chip, postInit };
}

function ue(date) {
  return { name: 'U&E', date, value: 'Na 140' };
}
function bp(date) {
  return { name: 'Blood pressure', date, value: '128/78' };
}

console.log('\n--- rule wiring ---');
check(!!aceArb, 'ace-arb rule exists in drug-rules.json');
check(
  (aceArb.tests || []).some((t) => t.postInitiationDays != null),
  'ace-arb carries a post-initiation U&E test'
);

// 1. Recently started (10d ago), no U&E since → within grace → not actionable.
console.log('\n--- started 10 days ago, no U&E → recently_initiated (neutral) ---');
{
  const { postInit } = evalAce({ startDate: '2026-06-19' });
  check(postInit && postInit.status === 'recently_initiated', `post-init status recently_initiated (got ${postInit?.status})`);
}

// 2. Started 17d ago, no U&E since → due_soon (amber).
console.log('\n--- started 17 days ago, no U&E → due_soon (amber) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-06-12' });
  check(postInit && postInit.status === 'due_soon', `post-init status due_soon (got ${postInit?.status})`);
  check(chip.status === 'due_soon', `chip surfaces as due_soon (got ${chip.status})`);
}

// 3. Started 30d ago, no U&E since → overdue (red). THE core safety case.
console.log('\n--- started 30 days ago, no U&E → overdue (red) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30' });
  check(postInit && postInit.status === 'overdue', `post-init status overdue (got ${postInit?.status})`);
  check(chip.status === 'overdue', `chip surfaces as overdue (got ${chip.status})`);
}

// 4. Started 30d ago, U&E + BP recorded 5d ago (after start) → requirement met.
console.log('\n--- started 30 days ago, U&E recorded since start → in_date (met) ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30', observations: [ue('2026-06-24'), bp('2026-06-24')] });
  check(postInit && postInit.status === 'in_date', `post-init status in_date (got ${postInit?.status})`);
  check(chip.status === 'in_date', `chip clear (in_date) — no false alert (got ${chip.status})`);
}

// 5. Baseline U&E BEFORE start, none since → overdue. NG136's exact gap: the
//    annual interval is satisfied by the baseline, but the post-init recheck is
//    missing. The post-init test must catch what the annual test misses.
console.log('\n--- baseline U&E before start, none since → post-init overdue, annual in_date ---');
{
  const { chip, postInit } = evalAce({ startDate: '2026-05-30', observations: [ue('2026-05-25'), bp('2026-06-24')] });
  check(postInit && postInit.status === 'overdue', `post-init status overdue despite a pre-start U&E (got ${postInit?.status})`);
  const annual = (chip.tests || []).find((t) => !t.postInitiation && t.name === 'U&E');
  check(annual && annual.status === 'in_date', 'annual U&E reads in_date off the baseline (proves post-init adds coverage)');
  check(chip.status === 'overdue', `chip overall overdue (got ${chip.status})`);
}

// 6. Unknown start date (established patient) → NEVER fires the post-init check.
console.log('\n--- no start date → post-init neutral, no false alert ---');
{
  const { chip, postInit } = evalAce({ startDate: null, observations: [ue('2026-03-21'), bp('2026-03-21')] });
  check(postInit && postInit.status === 'no_data', `post-init status no_data without a start date (got ${postInit?.status})`);
  check(chip.status !== 'overdue' && chip.status !== 'due_soon', `no post-init alert when start date unknown (chip ${chip.status})`);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
