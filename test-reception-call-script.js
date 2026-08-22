// Medicus Suite — reception call-script layout tests
// Run with: node test-reception-call-script.js

'use strict';

const fs = require('fs');
const path = require('path');

(async () => {
  let passed = 0;
  let failed = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }

  const corePath = new URL(
    'side-panel/modules/reception/reception-call-script.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const {
    CALL_MAIN_QUESTION_IDS,
    splitRedFlags,
    mainQuestions,
    moreQuestions,
    mainClosingIds,
    moreClosingQuestions,
    showDurationRow,
    ownWordsLabel,
    generateAllowed,
    applyAmalgamAnswers,
  } = await import(corePath);

  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'reception-pathways.json'), 'utf8'));

  console.log('--- every bundled pathway has a call-script map ---');
  for (const p of doc.pathways) {
    check(!!CALL_MAIN_QUESTION_IDS[p.id], `${p.id} is in CALL_MAIN_QUESTION_IDS`);
    const mainIds = new Set((CALL_MAIN_QUESTION_IDS[p.id] || []).concat(['duration']));
    const known = new Set((p.questions || []).map((q) => q.id));
    for (const id of CALL_MAIN_QUESTION_IDS[p.id] || []) {
      check(known.has(id), `${p.id} main question "${id}" exists on the pathway`);
    }
    const more = moreQuestions(p);
    const accounted = new Set([...mainQuestions(p).map((q) => q.id), ...more.map((q) => q.id)]);
    if ((p.questions || []).some((q) => q.id === 'duration')) accounted.add('duration');
    for (const q of p.questions || []) {
      check(accounted.has(q.id), `${p.id} question "${q.id}" is on the call path or in More`);
    }
    const { emergency, duty } = splitRedFlags(p.redFlags);
    check(emergency.length + duty.length === (p.redFlags || []).length, `${p.id} every red flag is 999 or duty`);
    check(emergency.length >= 1, `${p.id} has at least one emergency amalgam item`);
  }

  console.log('\n--- caller / age are not on the call path ---');
  check(!mainClosingIds({ id: 'sore-throat' }).includes('caller'), 'caller is not a main closing question');
  check(
    moreClosingQuestions({ id: 'sore-throat' }, doc.closingQuestions).some((q) => q.id === 'caller'),
    'caller still exists under More (JSON kept)'
  );
  for (const p of doc.pathways) {
    check(!mainQuestions(p).some((q) => q.id === 'age'), `${p.id} does not put age on the main path`);
  }

  console.log('\n--- mental-health specials ---');
  const mh = doc.pathways.find((p) => p.id === 'mental-health');
  check(showDurationRow(mh) === false, 'mental-health has no duration row');
  check(/happening today/i.test(ownWordsLabel(mh)), 'mental-health own-words label is today');
  check(JSON.stringify(mainClosingIds(mh)) === JSON.stringify(['contact']), 'mental-health closing is contact only');

  console.log('\n--- amalgam answers ---');
  const flags = [
    { id: 'a', escalate: '999' },
    { id: 'b', escalate: '999' },
  ];
  let ans = applyAmalgamAnswers({}, flags, { noneChecked: true, checkedIds: [] });
  check(ans.a === 'no' && ans.b === 'no', 'None of these writes no/no');
  ans = applyAmalgamAnswers({}, flags, { noneChecked: false, checkedIds: ['a'] });
  check(ans.a === 'yes' && ans.b === 'no', 'one tick is yes; the rest of the list are no');
  ans = applyAmalgamAnswers({}, flags, { noneChecked: false, checkedIds: [] });
  check(ans.a === undefined && ans.b === undefined, 'empty list stays unanswered');

  console.log('\n--- generateAllowed stop-on-999 ---');
  const mixed = [
    { id: 'e1', ask: 'Emergency?', escalate: '999' },
    { id: 'd1', ask: 'Duty?', escalate: 'duty' },
  ];
  let g = generateAllowed(mixed, { e1: 'yes' });
  check(g.ok === true && g.stop999 === true, '999 yes allows generate with duty unanswered');
  check(g.unanswered.includes('d1'), 'duty flag remains unanswered (NOT ASKED), not forged no');
  g = generateAllowed(mixed, {});
  check(g.ok === false && g.stop999 === false, 'empty lists block generate');
  g = generateAllowed(mixed, { e1: 'no', d1: 'no' });
  check(g.ok === true && g.stop999 === false, 'all-no allows generate');
  g = generateAllowed(mixed, { e1: 'no', d1: 'yes' });
  check(g.ok === true && g.stop999 === false, 'duty yes with 999 answered no allows generate');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
