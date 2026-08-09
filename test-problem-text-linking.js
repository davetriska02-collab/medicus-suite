// Medicus Suite — shared/problem-text-linking.js tests
// Run with: node test-problem-text-linking.js
//
// Matches a free-text problem-name reference (e.g. "Anxiety with depression"
// extracted from a "(Grouped with X)" GP2GP boilerplate) against candidate
// problems. Deliberately NOT fuzzy/semantic — see the file's own header for
// why (same discipline as shared/coding-specificity.js's normaliseText).

'use strict';

const {
  normaliseText,
  significantWords,
  matchProblemByName,
  extractGroupedWithReference,
} = require('./shared/problem-text-linking.js');
const genericAdditionalInfoEntries = require('./rules/generic-additional-info-text.json').entries;

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

console.log('--- normaliseText ---');
check(
  normaliseText('  Anxiety   with Depression  ') === 'anxiety with depression',
  'trims, collapses whitespace, lowercases'
);
check(normaliseText(null) === '', 'null -> empty string, never throws');
check(normaliseText(undefined) === '', 'undefined -> empty string');

console.log('\n--- significantWords: stopwords and short tokens excluded ---');
check(
  JSON.stringify(significantWords('Anxiety with depression')) === JSON.stringify(['anxiety', 'depression']),
  '"with" (stopword) dropped'
);
check(
  JSON.stringify(significantWords('Type 2 diabetes')) === JSON.stringify(['type', 'diabetes']),
  '"2" (length <= 2) dropped'
);
check(JSON.stringify(significantWords('')) === JSON.stringify([]), 'empty string -> empty array');

console.log('\n--- matchProblemByName: exact tier ---');
{
  const candidates = [
    { id: '1', description: 'Anxiety with depression' },
    { id: '2', description: 'Type 2 diabetes mellitus' },
  ];
  const m = matchProblemByName('Anxiety with depression', candidates);
  check(!!m && m.problemId === '1' && m.confidence === 'exact', 'byte-identical (after normalising) match is exact');
  const m2 = matchProblemByName('  anxiety WITH depression  ', candidates);
  check(
    !!m2 && m2.problemId === '1' && m2.confidence === 'exact',
    'case/whitespace differences still resolve to exact'
  );
}

console.log('\n--- matchProblemByName: partial tier (word-overlap, asymmetric) ---');
{
  const candidates = [{ id: '2', description: 'Mixed anxiety with depression symptoms' }];
  const m = matchProblemByName('anxiety depression', candidates);
  check(
    !!m && m.problemId === '2' && m.confidence === 'partial',
    'every significant word present in a longer candidate description -> partial match'
  );
}

console.log('\n--- matchProblemByName: no match when a significant word is missing ---');
{
  const candidates = [{ id: '1', description: 'Anxiety with depression' }];
  check(
    matchProblemByName('Anxiety with psychosis', candidates) === null,
    '"psychosis" absent from every candidate -> no match, never a guess'
  );
}

console.log('\n--- matchProblemByName: NOT fuzzy — different word forms do not match ---');
{
  // "depressive" is NOT the same token as "depression" — word-boundary
  // matching deliberately does not stem/fuzzy-match these as equivalent.
  const candidates = [{ id: '2', description: 'Mixed anxiety and depressive disorder' }];
  check(
    matchProblemByName('anxiety depression', candidates) === null,
    'a different word FORM (depressive vs depression) is correctly not treated as a match — no stemming'
  );
}

console.log('\n--- matchProblemByName: edge cases never throw ---');
{
  check(matchProblemByName('', []) === null, 'empty name -> null');
  check(matchProblemByName(null, [{ id: '1', description: 'X' }]) === null, 'null name -> null, never throws');
  check(matchProblemByName('Anxiety', null) === null, 'null candidates -> null, never throws');
  check(matchProblemByName('Anxiety', []) === null, 'empty candidates -> null');
  check(
    matchProblemByName('the of', [{ id: '1', description: 'Something' }]) === null,
    'all-stopword name -> no significant words -> null'
  );
}

console.log('\n--- matchProblemByName: regex-special characters in words are escaped safely ---');
{
  const candidates = [{ id: '1', description: 'Fracture (closed)' }];
  check(
    matchProblemByName('Fracture (closed)', candidates).confidence === 'exact',
    'parentheses in the name do not break matching or throw a regex error'
  );
}

console.log('\n--- extractGroupedWithReference: single source of truth with the real rules file ---');
{
  const found = extractGroupedWithReference('(Grouped with Anxiety with depression)', genericAdditionalInfoEntries);
  check(
    !!found && found.problemName === 'Anxiety with depression',
    'extracts the referenced name using the REAL configured rules-file entry'
  );
  check(
    extractGroupedWithReference('Nothing relevant here.', genericAdditionalInfoEntries) === null,
    'no match -> null'
  );
  check(extractGroupedWithReference(null, genericAdditionalInfoEntries) === null, 'null text -> null, never throws');
  check(extractGroupedWithReference('(Grouped with X)', []) === null, 'no linkSuggestion entry configured -> null');
  check(extractGroupedWithReference('(Grouped with X)', null) === null, 'null entries -> null, never throws');
  check(
    extractGroupedWithReference('(Grouped with X)', [
      { kind: 'pattern', id: 'bad', pattern: '(', action: { type: 'linkSuggestion' } },
    ]) === null,
    'a malformed regex source in the entry -> null, never throws'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed === 0 ? 0 : 1);
