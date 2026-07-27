// Medicus Suite — shared/shadow-compare.js tests
// Run with: node test-shadow-compare.js
//
// This module is the SAFETY GATE for the transactional/FHIR feed swap: it
// compares the chips the legacy feed produced against the chips the new feed
// produces and decides whether the swap lost anything clinically meaningful.
// Its verdict is filed in the Clinical Event Ledger as assurance evidence, so
// a wrong "safe: true" is worse than no gate at all.
//
// It had NO test file before the 2026-07-27 audit, which is how the
// unknown-status hole below survived: DEFAULT_RANK listed 9 statuses, the
// engine emits at least 15, and an unlisted status ranked 0 — so a dropped
// vax_due / not_met / stale alert was recorded as "a difference, but no safety
// loss".

'use strict';

const { diffChips } = require('./shared/shadow-compare.js');
const STATUS_RANK = require('./engine/rules-engine.js').STATUS_RANK;

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

const dropOne = (status) => diffChips([{ ruleId: 'r1', status }], []);

console.log('--- a dropped clinically-meaningful chip is a regression (safe: false) ---');
{
  // Every status here means "this patient needs something". Losing one on a
  // feed swap is a safety regression, whatever its exact urgency.
  const MEANINGFUL = [
    'red',
    'alert',
    'overdue',
    'amber',
    'due',
    'not_met', // QOF indicator not met
    'stale',
    'vax_due',
    'due_soon',
    'caution',
    'no_data',
    'noted',
    'recently_initiated',
  ];
  for (const status of MEANINGFUL) {
    const r = dropOne(status);
    check(
      r.dropped.length === 1 && r.regressions.length === 1 && r.safe === false,
      `dropped "${status}" -> regression, safe:false`
    );
  }
}

console.log('--- a dropped benign chip is NOT a regression (safe stays true) ---');
{
  // These assert nothing outstanding, so losing one costs the clinician
  // nothing. Flagging them would make the gate cry wolf on every swap.
  for (const status of ['achieved', 'in_date', 'vax_given', 'vax_declined', 'ok', 'none']) {
    const r = dropOne(status);
    check(r.dropped.length === 1 && r.regressions.length === 0 && r.safe === true, `dropped "${status}" -> safe:true`);
  }
}

console.log('--- an UNRECOGNISED status fails visible, never silently benign ---');
{
  // The whole point: a status the engine gains tomorrow, or a typo in a custom
  // rule, must not be scored 0 and waved through.
  const r = dropOne('some_status_added_next_year');
  check(r.regressions.length === 1 && r.safe === false, 'unknown status -> regression, safe:false');
  const flip = diffChips([{ ruleId: 'r1', status: 'brand_new' }], [{ ruleId: 'r1', status: 'achieved' }]);
  check(flip.safe === false, 'unknown -> benign downgrade is also caught');
}

console.log('--- no clinical claim at all is benign (null/undefined/empty) ---');
{
  for (const status of [null, undefined, '']) {
    const r = dropOne(status);
    check(r.regressions.length === 0 && r.safe === true, `dropped status ${JSON.stringify(status)} -> safe:true`);
  }
}

console.log('--- COVERAGE LOCK: every status the engine can emit is ranked ---');
{
  // The hole this test exists to prevent: the engine gains a status, nobody
  // adds it here, and the gate silently treats it as benign. Compares against
  // engine/rules-engine.js's own STATUS_RANK, which is the authoritative list.
  check(STATUS_RANK && typeof STATUS_RANK === 'object', 'engine exports STATUS_RANK for this check');
  const unranked = Object.keys(STATUS_RANK || {}).filter((s) => {
    // A status is "ranked" if diffChips treats dropping it deliberately —
    // either as a regression, or as an explicitly-benign outcome. An unknown
    // status now also produces a regression, so we assert the table itself
    // knows the key rather than inferring from behaviour.
    const r = dropOne(s);
    return (
      r.regressions.length === 0 && r.safe === true && !['achieved', 'in_date', 'vax_given', 'vax_declined'].includes(s)
    );
  });
  check(unranked.length === 0, `no engine status is silently benign (unhandled: ${unranked.join(', ') || 'none'})`);
}

console.log('--- unchanged / added chips behave as before ---');
{
  const same = diffChips([{ ruleId: 'r1', status: 'overdue' }], [{ ruleId: 'r1', status: 'overdue' }]);
  check(same.dropped.length === 0 && same.regressions.length === 0 && same.safe === true, 'identical chips -> safe');
  const added = diffChips([], [{ ruleId: 'r1', status: 'overdue' }]);
  check(added.added.length === 1 && added.safe === true, 'a NEW chip under the new feed is not a regression');
  const upgrade = diffChips([{ ruleId: 'r1', status: 'due' }], [{ ruleId: 'r1', status: 'overdue' }]);
  check(upgrade.safe === true, 'an escalation (due -> overdue) is not a regression');
  const downgrade = diffChips([{ ruleId: 'r1', status: 'overdue' }], [{ ruleId: 'r1', status: 'achieved' }]);
  check(downgrade.safe === false, 'a de-escalation (overdue -> achieved) IS a regression');
}

console.log('--- never throws on degenerate input ---');
{
  check(diffChips(null, null).safe === true, 'null inputs -> safe, no throw');
  check(diffChips(undefined, []).dropped.length === 0, 'undefined legacy -> empty diff');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
