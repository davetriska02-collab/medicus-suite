// Medicus Suite — problem-junk-code-cleanup ("Bulk remove?" for
// administrative-noise problem codes) tests
// Run with: node test-problem-junk-code-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: building the combined constrainingParentConcepts value from the
// rules/non-problem-root-codes.json roots list, deciding whether a candidate
// conceptId is flagged (exact root match OR found in a descendant-search
// response), which flagged entries are safe to bulk-select (not already
// ended, no active child problems), resolving each clinical-summary problem
// to its own conceptId via the per-problem overview fetch, deduping those
// conceptIds before the (one-per-distinct-code) descendant check, and the
// end-problem POST payload shape confirmed via the real captured HAR.

'use strict';

const {
  REASON_NOT_A_PROBLEM,
  rootConceptIdsCsv,
  resultContainsConceptId,
  isFlaggedConceptId,
  buildEndProblemPayload,
  isEndable,
  withResolvedConceptIds,
  uniqueConceptIds,
} = require('./content-scripts/problem-junk-code-cleanup.js');
const nonProblemRootCodes = require('./rules/non-problem-root-codes.json');

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

console.log('--- rules/non-problem-root-codes.json: the imported roots list itself ---');
{
  check(Array.isArray(nonProblemRootCodes.roots), 'roots is an array');
  check(nonProblemRootCodes.roots.length > 0, 'at least one root is configured');
  check(
    nonProblemRootCodes.roots.every((r) => typeof r.conceptId === 'string' && r.conceptId.length > 0),
    'every root has a non-empty conceptId'
  );
  const admin = nonProblemRootCodes.roots.find((r) => r.conceptId === '14734007');
  check(!!admin && admin.description === 'Administrative procedure', '14734007 "Administrative procedure" is present');
  const iosClaim = nonProblemRootCodes.roots.find((r) => r.conceptId === '12821000000103');
  check(
    !!iosClaim && iosClaim.description === 'Item of service claim statuses',
    '12821000000103 "Item of service claim statuses" is present (added 2026-07-25)'
  );
  const regForm = nonProblemRootCodes.roots.find((r) => r.conceptId === '184063008');
  check(
    !!regForm && regForm.description === 'Patient signed reg. form',
    '184063008 "Patient signed reg. form" is present (added 2026-07-25)'
  );
  // 18 more roots added 2026-07-25 (LMP/EDD/B12-monitoring/wound-care/B12-treatment/
  // flu-vaccination/referral/medication-review/NHS-Health-Check family/admin-statuses/
  // diary-entry) -- researched via the public termbrowser API, see rules file rationale.
  const expectedNewRoots = [
    ['21840007', 'Date of last menstrual period'],
    ['161714006', 'Estimated date of delivery'],
    ['170818005', 'B12 deficiency monitoring'],
    ['243863004', 'B12 deficiency monitoring status'],
    ['225358003', 'Wound care'],
    ['709544008', 'Administration of vitamin B12'],
    ['86198006', 'Influenza vaccination'],
    ['3457005', 'Patient referral'],
    ['182836005', 'Review of medication'],
    ['314529007', 'Medication review due'],
    ['314530002', 'Medication review done'],
    ['523221000000100', 'NHS Health Check completed'],
    ['523201000000109', 'NHS Health Check indicated'],
    ['763661000000101', 'NHS Health Check annual review'],
    ['519961000000106', 'NHS Health check programme'],
    ['268565007', 'Adult health examination'],
    ['307824009', 'Administrative statuses (finding)'],
    ['1239671000000106', 'Primary care diary entry'],
  ];
  for (const [conceptId, description] of expectedNewRoots) {
    const root = nonProblemRootCodes.roots.find((r) => r.conceptId === conceptId);
    check(!!root && root.description === description, `${conceptId} "${description}" is present (added 2026-07-25)`);
  }
  check(
    nonProblemRootCodes.roots.length === 21,
    'exactly 21 roots configured (got ' + nonProblemRootCodes.roots.length + ')'
  );
}

console.log('--- rootConceptIdsCsv: combined constrainingParentConcepts value ---');
{
  check(
    rootConceptIdsCsv([{ conceptId: '1' }, { conceptId: '2' }, { conceptId: '3' }]) === '1,2,3',
    'joins every root conceptId with a comma'
  );
  check(rootConceptIdsCsv([{ conceptId: '1' }]) === '1', 'a single root -> no trailing comma');
  check(rootConceptIdsCsv([]) === '', 'empty roots list -> empty string');
  check(rootConceptIdsCsv(null) === '', 'null roots -> empty string, never throws');
  check(
    rootConceptIdsCsv([{ conceptId: '1' }, {}, { conceptId: '2' }]) === '1,2',
    'a malformed entry with no conceptId is skipped, not a crash'
  );
}

console.log('--- resultContainsConceptId: search-response membership check ---');
{
  const results = [
    { label: 'A', value: { conceptId: '111', description: 'A' } },
    { label: 'B', value: { conceptId: '222', description: 'B' } },
  ];
  check(resultContainsConceptId(results, '222') === true, 'finds a matching conceptId');
  check(resultContainsConceptId(results, '999') === false, 'no match -> false');
  check(resultContainsConceptId([], '111') === false, 'empty results -> false');
  check(resultContainsConceptId(null, '111') === false, 'null results -> false, never throws');
  check(resultContainsConceptId(results, null) === false, 'null conceptId -> false, never throws');
  check(
    resultContainsConceptId([{ conceptId: '333' }], '333') === true,
    'tolerates an already-unwrapped {conceptId} item, not just {value:{conceptId}}'
  );
}

console.log('--- isFlaggedConceptId: exact root match OR genuine descendant ---');
{
  const roots = [{ conceptId: '14734007' }, { conceptId: '999999999' }];
  check(
    isFlaggedConceptId('14734007', roots, []) === true,
    'a problem coded AS a root itself is flagged even with no descendant-search hit'
  );
  check(
    isFlaggedConceptId('12541000000107', roots, [{ value: { conceptId: '12541000000107' } }]) === true,
    'a genuine descendant (found in the search response) is flagged'
  );
  check(
    isFlaggedConceptId('308283009', roots, [{ value: { conceptId: '12541000000107' } }]) === false,
    'a conceptId absent from both the root list and the search response is NOT flagged'
  );
  check(isFlaggedConceptId(null, roots, []) === false, 'null conceptId -> not flagged, never throws');
  check(
    isFlaggedConceptId('14734007', null, []) === false,
    'null roots -> not flagged (root-match check), never throws'
  );
  check(
    isFlaggedConceptId('184063008', nonProblemRootCodes.roots, []) === true,
    'the real rules file exact-matches 184063008 ("Patient signed reg. form", found live 2026-07-25) as a root ' +
      'itself, with no descendant-search hit needed'
  );
}

console.log('--- buildEndProblemPayload: matches the confirmed clinical/problem/end-problem contract ---');
{
  const payload = buildEndProblemPayload('prob-1', '2026-07-24', REASON_NOT_A_PROBLEM);
  check(payload.problemId === 'prob-1', 'problemId passed through');
  check(payload.endDate === '2026-07-24', 'endDate passed through');
  check(payload.reason === 'not a problem', 'reason is the fixed "not a problem" string');
  check(
    Object.keys(payload).sort().join(',') === 'endDate,problemId,reason',
    'exactly the three confirmed fields, nothing extra'
  );
}

console.log('--- isEndable: which flagged entries are safe to bulk-select ---');
{
  check(isEndable({ ended: false, activeChildCount: 0 }) === true, 'not ended, no active children -> endable');
  check(isEndable({ ended: true, activeChildCount: 0 }) === false, 'already ended this session -> not endable again');
  check(
    isEndable({ ended: false, activeChildCount: 2 }) === false,
    'has active child problems -> excluded, not just warned'
  );
  check(isEndable({ ended: false }) === true, 'missing activeChildCount treated as 0, not a crash');
  check(isEndable(null) === false, 'null entry -> not endable, never throws');
}

console.log('--- withResolvedConceptIds: pairs clinical-summary problems with their per-problem conceptId ---');
{
  const problems = [
    { id: 'p1', problemCodeDescription: 'FP1001 contraception claim' },
    { id: 'p2', problemCodeDescription: 'Essential hypertension' },
    { id: 'p3', problemCodeDescription: 'Some problem whose overview fetch failed' },
  ];
  const overviews = [
    { problemCode: { conceptId: '23591000000100', description: 'FP1001 contraception claim' } },
    { problemCode: { conceptId: '38341003', description: 'Essential hypertension' } },
    null, // overview fetch failed/errored -> caught and passed through as null
  ];
  const resolved = withResolvedConceptIds(problems, overviews);
  check(resolved.length === 2, 'the problem whose overview fetch failed is dropped, not guessed');
  check(resolved[0].id === 'p1' && resolved[0].conceptId === '23591000000100', 'first problem resolved correctly');
  check(resolved[1].id === 'p2' && resolved[1].conceptId === '38341003', 'second problem resolved correctly');
  check(withResolvedConceptIds([], []).length === 0, 'empty input -> empty output');
}

console.log('--- uniqueConceptIds: dedupes before the (one-per-distinct-code) descendant check ---');
{
  const withConcept = [
    { id: 'p1', conceptId: '111' },
    { id: 'p2', conceptId: '222' },
    { id: 'p3', conceptId: '111' },
  ];
  const unique = uniqueConceptIds(withConcept);
  check(unique.length === 2, `two distinct conceptIds from three problems (got ${unique.length})`);
  check(unique.indexOf('111') !== -1 && unique.indexOf('222') !== -1, 'both distinct conceptIds present');
  check(uniqueConceptIds([]).length === 0, 'empty input -> empty output');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
