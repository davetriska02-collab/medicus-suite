// Medicus Suite — smoking-status derivation + display line tests
// Run with: node test-smoking-status.js
//
// Pins the Practice-panel ruling of 2026-07-16 (see
// docs/appraisal/PRACTICE-smoking-flag-2026-07-16.md and
// shared/smoking-status.js): conservative bucketing (never a confident guess
// from an ambiguous term), most-recent-wins with a conflict flag, recency
// always derivable, and honest absence wording bounded to the extension's own
// data window ("no entry in the last 13 months", never "not recorded").

'use strict';

const SS = require('./shared/smoking-status.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const NOW = '2026-07-14T09:00:00Z';
const derive = (obs) => SS.deriveSmokingStatus(obs, NOW);

console.log('--- classify: conservative bucketing ---');
check(SS.classify('Never smoked') === 'never', 'never smoked → never');
check(SS.classify('Lifelong non-smoker') === 'never', 'lifelong non-smoker → never');
check(SS.classify('Ex-smoker') === 'ex', 'ex-smoker → ex');
check(SS.classify('Former smoker') === 'ex', 'former smoker → ex');
check(SS.classify('Stopped smoking') === 'ex', 'stopped smoking → ex');
check(SS.classify('Current smoker') === 'current', 'current smoker → current');
check(SS.classify('Cigarette smoker') === 'current', 'cigarette smoker → current');
check(SS.classify('Smokes 10 cigarettes per day') === 'current', 'smokes N/day → current');
check(SS.classify('Smoker') === 'current', 'bare "smoker" → current');
check(SS.classify('Ex-smoker') !== 'current', 'ex-smoker can NEVER fall through to current (order pin)');
// The pharmacist ruling: ambiguous terms are NEVER confidently bucketed.
check(SS.classify('Smoking cessation advice given') === null, 'cessation ADVICE → unclear, not ex');
check(SS.classify('Nicotine dependence') === null, 'nicotine dependence (diagnosis) → unclear');
check(SS.classify('Tobacco use') === null, 'bare tobacco use → unclear');
check(SS.classify('Referred to smoking cessation service') === null, 'cessation referral → unclear');
check(SS.classify('') === null, 'empty → null');

console.log('\n--- deriveSmokingStatus: presence, recency, most-recent-wins ---');
{
  const r = derive([
    { name: 'HbA1c', date: '2026-05-02', value: '51' },
    { name: 'Smoking status', date: '2025-11-06', value: 'Ex-smoker' },
  ]);
  check(!!r, 'a smoking observation among others is found');
  check(r.bucket === 'ex', 'value text drives the bucket (name alone is generic)');
  check(r.date === '2025-11-06', 'date carried through');
  check(r.monthsAgo === 8, `monthsAgo computed from now (got ${r.monthsAgo})`);
  check(/Smoking status: Ex-smoker/.test(r.term), 'verbatim term = name + value');
  check(r.conflict === false, 'single entry → no conflict');
  check(r.entries === 1, 'entry count = 1');
}
{
  const r = derive([
    { name: 'Smoking status', date: '2024-01-10', value: 'Current smoker' },
    { name: 'Smoking status', date: '2025-11-06', value: 'Ex-smoker' },
  ]);
  check(r.bucket === 'ex', 'most recent entry wins the headline');
  check(r.conflict === true, 'disagreeing buckets in window → conflict flagged');
  check(r.entries === 2, 'both entries counted');
}
{
  const r = derive([
    { name: 'Smoking status', date: '2025-01-10', value: 'Ex-smoker' },
    { name: 'Smoking status', date: '2025-11-06', value: 'Ex-smoker' },
  ]);
  check(r.conflict === false, 'agreeing buckets → no conflict');
}
{
  const r = derive([{ name: 'Never smoked tobacco', date: '2025-09-01', value: '' }]);
  check(r.bucket === 'never', 'status carried in the NAME alone still classifies');
}
{
  const r = derive([{ name: 'Smoking cessation advice', date: '2026-06-01', value: 'given' }]);
  check(!!r && r.bucket === null, 'ambiguous-only entries → present but bucket null (unclear)');
}

console.log('\n--- deriveSmokingStatus: absence + robustness ---');
check(derive([]) === null, 'no observations → null (honest-absence line)');
check(derive([{ name: 'HbA1c', date: '2026-05-02', value: '51' }]) === null, 'no smoking-related obs → null');
check(derive(null) === null, 'null observations → null, never throws');
check(derive([null, { name: 'Smoking status', value: 'Ex-smoker' }]).bucket === 'ex', 'null entries skipped');
{
  const r = derive([{ name: 'Smoking status', value: 'Ex-smoker' }]); // undated
  check(r.bucket === 'ex' && r.date === null && r.monthsAgo === null, 'undated entry: no fabricated recency');
}

console.log('\n--- formatSmokingLine: the banner line + tooltip ---');
{
  const line = SS.formatSmokingLine(derive([{ name: 'Smoking status', date: '2025-11-06', value: 'Ex-smoker' }]));
  check(/^Smoking: Ex-smoker · Nov 2025 \(8 mo ago\)$/.test(line.text), `recorded line format (got "${line.text}")`);
  check(/Smoking status: Ex-smoker/.test(line.title), 'tooltip carries the verbatim source term');
  check(/13 months/.test(line.title), 'tooltip carries the window honesty caveat');
  check(/verify/i.test(line.title), 'tooltip tells the user to verify in the record');
}
{
  const line = SS.formatSmokingLine(null);
  check(
    line.text === 'Smoking: no entry in the last 13 months — check record',
    `absence line is honestly bounded (got "${line.text}")`
  );
  check(/not "never recorded"/.test(line.title), 'absence tooltip explicitly rejects the "never recorded" misread');
  check(!/no data/i.test(line.text), 'absence line never says the ambiguous "NO DATA"');
}
{
  const line = SS.formatSmokingLine(
    derive([
      { name: 'Smoking status', date: '2024-01-10', value: 'Current smoker' },
      { name: 'Smoking status', date: '2025-11-06', value: 'Never smoked' },
    ])
  );
  check(/multiple entries/.test(line.text), 'conflict → "multiple entries" visible in the line itself');
  check(/DISAGREE/.test(line.title), 'conflict tooltip warns the entries disagree');
}
{
  const line = SS.formatSmokingLine(derive([{ name: 'Nicotine dependence', date: '2026-06-01', value: '' }]));
  check(/^Smoking: unclear — see record/.test(line.text), 'ambiguous entry renders "unclear", never a guess');
}
{
  const line = SS.formatSmokingLine(derive([{ name: 'Smoking status', date: '2026-07-01', value: 'Current smoker' }]));
  check(/\(this month\)/.test(line.text), 'sub-month recency reads "this month"');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
