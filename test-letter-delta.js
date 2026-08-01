// Medicus Suite — Document Coder delta engine tests
// Run with: node test-letter-delta.js
//
// Guards engine/letter-delta.js — the candidate-vs-coded-record verdicts.
// Cardinal safety property: a wrong 'probable-match' hides a new diagnosis
// behind "already coded" (nothing downstream catches it), so matching is
// high-precision and everything uncertain is 'possibly-new' with the nearest
// miss shown. Qualifier and status conflicts must NEVER collapse into a
// plain match — the CKD-stage and resolved-AKI panel war stories.
// All data synthetic; no NHS numbers.

'use strict';

const path = require('path');
const D = require(path.join(__dirname, 'engine', 'letter-delta.js'));

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
function cand(term, extra) {
  return Object.assign({ term, sourceSentence: term, status: 'active', offered: true, laterality: null }, extra);
}
function one(c, problems) {
  return D.assessCandidate(c, problems);
}

console.log('--- CKD stage change is a conflict, never a match (QOF lead war story) ---');
{
  const v = one(cand('CKD stage 3b', { sourceSentence: 'CKD stage 3b (eGFR 42, deterioration from stage 3a)' }), [
    { description: 'Chronic kidney disease stage 3a', status: 'active' },
  ]);
  check(v.verdict === 'qualifier-conflict', `verdict qualifier-conflict (got ${v.verdict})`);
  check(
    v.conflict && v.conflict.kind === 'stage' && v.conflict.letter === '3b' && v.conflict.record === '3a',
    'stage detail letter=3b record=3a'
  );
}

console.log('--- variant wording still matches (insulin-treated suffix) ---');
{
  const v = one(cand('Type 2 diabetes mellitus'), [
    { description: 'Type 2 diabetes mellitus - insulin treated', status: 'active' },
  ]);
  check(v.verdict === 'probable-match', `containment match (got ${v.verdict})`);
  check(!!v.matchedProblem, 'matched problem is returned for the human to confirm');
}

console.log('--- GP2GP token-order variant matches ---');
{
  const v = one(cand('Type 2 diabetes mellitus'), [{ description: 'Diabetes mellitus type 2', status: 'active' }]);
  check(v.verdict === 'probable-match', `token-set equality match (got ${v.verdict})`);
}

console.log('--- acronym expansion: letter says AF, record spells it out ---');
{
  const v = one(cand('AF'), [{ description: 'Atrial fibrillation', status: 'active' }]);
  check(v.verdict === 'probable-match', `AF matches Atrial fibrillation (got ${v.verdict})`);
}

console.log('--- resolved-in-letter vs active-in-record is a status conflict (senior coder war story) ---');
{
  const v = one(cand('AKI', { status: 'resolved' }), [{ description: 'Acute kidney injury', status: 'active' }]);
  check(
    v.verdict === 'status-conflict' && v.conflict.kind === 'letter-resolved-record-active',
    'letter-resolved vs record-active flagged'
  );
}

console.log('--- active-in-letter vs resolved-in-record flags possible recurrence ---');
{
  const v = one(cand('Depression'), [{ description: 'Depression', status: 'resolved' }]);
  check(
    v.verdict === 'status-conflict' && v.conflict.kind === 'letter-active-record-inactive',
    'possible recurrence flagged, not silently matched'
  );
}

console.log('--- laterality conflict ---');
{
  const v = one(cand('Fracture of radius', { laterality: 'right', sourceSentence: 'Fracture of right radius' }), [
    { description: 'Fracture of left radius', status: 'active' },
  ]);
  check(
    v.verdict === 'qualifier-conflict' && v.conflict.kind === 'laterality',
    'right-vs-left is a conflict, never a match'
  );
}

console.log('--- laterality only on one side still matches (record unlateralised) ---');
{
  const v = one(cand('Fracture of radius', { laterality: 'right', sourceSentence: 'Fracture of right radius' }), [
    { description: 'Fracture of radius', status: 'active' },
  ]);
  check(
    v.verdict === 'probable-match',
    `unlateralised record matches (got ${v.verdict}) — refinement is the coding stage's job`
  );
}

console.log('--- genuinely new diagnosis is possibly-new with nearest miss ---');
{
  const v = one(cand('Atrial fibrillation'), [
    { description: 'Type 2 diabetes mellitus', status: 'active' },
    { description: 'Hypertension', status: 'active' },
  ]);
  check(v.verdict === 'possibly-new' && !v.matchedProblem, 'no fabricated match');
}

console.log('--- unrelated conditions never match on stray tokens ---');
{
  const v = one(cand('Gout'), [{ description: 'Dermatitis', status: 'active' }]);
  check(v.verdict === 'possibly-new', 'gout vs dermatitis is possibly-new');
  const v2 = one(cand('Chronic pain'), [{ description: 'Chronic obstructive pulmonary disease', status: 'active' }]);
  check(v2.verdict === 'possibly-new', `"chronic" alone is not a match (got ${v2.verdict})`);
}

console.log('--- Red-team: containment must not cross disease boundaries ---');
{
  // These three failed before the qualifier-lexicon guard: naive containment
  // matched the shorter term inside a DIFFERENT disease, hiding a new dx.
  const wrongMatchProbes = [
    ['Hypertension', 'Pulmonary hypertension'],
    ['Diabetes', 'Diabetes insipidus'],
    ['Anaemia', 'Iron deficiency anaemia'],
  ];
  for (const [a, b] of wrongMatchProbes) {
    const v = one(cand(a), [{ description: b, status: 'active' }]);
    check(v.verdict === 'possibly-new', `"${a}" never matches "${b}" (got ${v.verdict})`);
  }
  // …while pure severity/management qualifiers still match:
  const okProbes = [
    ['Asthma', 'Asthma - mild'],
    ['Heart failure', 'Heart failure with preserved ejection fraction'],
  ];
  for (const [a, b] of okProbes) {
    const v = one(cand(a), [{ description: b, status: 'active' }]);
    check(v.verdict === 'probable-match', `"${a}" still matches "${b}" (got ${v.verdict})`);
  }
}

console.log('--- computeDelta annotates every candidate, asserts nothing globally ---');
{
  const out = D.computeDelta(
    [cand('Atrial fibrillation'), cand('Type 2 diabetes mellitus')],
    [{ description: 'Type 2 diabetes mellitus', status: 'active' }]
  );
  check(out.length === 2, 'one verdict per candidate');
  check(
    out.every((o) => o.verdict && o.candidate),
    'each row carries verdict + candidate'
  );
  const src = require('fs').readFileSync(path.join(__dirname, 'engine', 'letter-delta.js'), 'utf8');
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(
    !/fully (?:coded|reconciled)|all clear|nothing to do/i.test(code),
    'no completion/all-clear language in delta engine code'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
