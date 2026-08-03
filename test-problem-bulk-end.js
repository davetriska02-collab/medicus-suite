// Medicus Suite — problem-bulk-end ("Bulk remove?" on the Clinical
// Summary) tests
// Run with: node test-problem-bulk-end.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: the end-problem POST payload (three fields, confirmed via the
// real captured HAR), which rows are selectable (isEndable), the
// double-layer submit guard (canSubmit — the thing that keeps an empty
// endDate/reason off the record), the ENDING/KEEPING partition behind the
// confirm step, the API error-body extraction, and the badge-scan helpers
// (ported here in the 2026-07-27 merge that retired
// problem-junk-code-cleanup.js — see problem-bulk-end.js's header): the
// combined constrainingParentConcepts value, flagged-concept decisions,
// caution-root filtering, conceptId resolution and dedupe, plus the
// regression locks on rules/non-problem-root-codes.json itself.

'use strict';

const {
  DEFAULT_REASON,
  buildEndProblemPayload,
  isEndable,
  canSubmit,
  partitionSelection,
  apiErrorMessage,
  parseCareRecordPath,
  parseTaskOverviewPath,
  extractPatientIdFromTaskOverview,
  rootConceptIdsCsv,
  resultContainsConceptId,
  isFlaggedConceptId,
  cautionRootsOf,
  withResolvedConceptIds,
  uniqueConceptIds,
} = require('./content-scripts/problem-bulk-end.js');
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

console.log('--- buildEndProblemPayload: the confirmed clinical/problem/end-problem contract ---');
{
  const payload = buildEndProblemPayload('prob-1', '2026-07-27', 'Resolved');
  check(payload.problemId === 'prob-1', 'problemId passed through');
  check(payload.endDate === '2026-07-27', 'endDate passed through');
  check(payload.reason === 'Resolved', 'reason passed through');
  check(
    Object.keys(payload).sort().join(',') === 'endDate,problemId,reason',
    'exactly the three confirmed fields, nothing extra'
  );
}

console.log('--- isEndable: which rows are selectable ---');
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

console.log('--- canSubmit: the double-layer guard (buttons AND the POST path both check this) ---');
{
  check(canSubmit(3, '2026-07-27', 'Resolved', false) === true, 'selection + date + reason + idle -> submittable');
  check(canSubmit(0, '2026-07-27', 'Resolved', false) === false, 'nothing selected -> blocked');
  check(canSubmit(3, '', 'Resolved', false) === false, 'empty endDate -> blocked (never POST endDate: "")');
  check(canSubmit(3, null, 'Resolved', false) === false, 'null endDate -> blocked, never throws');
  check(canSubmit(3, '2026-07-27', '', false) === false, 'empty reason -> blocked (never POST reason: "")');
  check(canSubmit(3, '2026-07-27', '   ', false) === false, 'whitespace-only reason -> blocked, not just non-empty');
  check(canSubmit(3, '2026-07-27', null, false) === false, 'null reason -> blocked, never throws');
  check(canSubmit(3, '2026-07-27', 'Resolved', true) === false, 'a batch already in flight -> blocked (no doubles)');
  check(DEFAULT_REASON.trim().length > 0, 'the shipped default reason itself passes the guard');
}

console.log('--- partitionSelection: the ENDING/KEEPING split behind the confirm step ---');
{
  const rows = [
    { id: 'a', description: 'Old sprain', checked: true, ended: false, activeChildCount: 0 },
    { id: 'b', description: 'Heart failure', checked: false, ended: false, activeChildCount: 0 },
    { id: 'c', description: 'Linked parent', checked: true, ended: false, activeChildCount: 2 },
    { id: 'd', description: 'Already ended', checked: false, ended: true, activeChildCount: 0 },
  ];
  const parts = partitionSelection(rows);
  check(parts.ending.length === 1 && parts.ending[0].id === 'a', 'only checked AND endable rows are in ENDING');
  check(
    parts.keeping.some((r) => r.id === 'b'),
    'an unchecked row is in KEEPING'
  );
  check(
    parts.keeping.some((r) => r.id === 'c'),
    'a checked row with linked problems stays in KEEPING — the checkbox alone cannot override the exclusion'
  );
  check(
    !parts.ending.concat(parts.keeping).some((r) => r.id === 'd'),
    'a row already ended this session appears in neither list'
  );
  check(partitionSelection(null).ending.length === 0, 'null rows -> empty partitions, never throws');
  check(partitionSelection([]).keeping.length === 0, 'empty rows -> empty partitions');
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
  const unknown = nonProblemRootCodes.roots.find((r) => r.conceptId === '261665006');
  check(!!unknown && unknown.description === 'Unknown', '261665006 "Unknown" is present (added 2026-08-02)');
  const expected20260802Roots = [
    ['33879002', 'Vaccination'],
    ['127785005', 'Imported immunisations'],
    ['171302002', 'Adult screening'],
    ['268481000', 'Child health checks'],
    ['416608005', 'Previously active medications imported via GP2GP'],
  ];
  for (const [conceptId, description] of expected20260802Roots) {
    const root = nonProblemRootCodes.roots.find((r) => r.conceptId === conceptId);
    check(!!root && root.description === description, `${conceptId} "${description}" is present (added 2026-08-02)`);
  }
  check(
    nonProblemRootCodes.roots.length === 27,
    'exactly 27 roots configured (got ' + nonProblemRootCodes.roots.length + ')'
  );
}

console.log('--- cautionRootsOf: roots whose rows "Select flagged" must never tick ---');
{
  // Regression-lock the caution set (added 2026-07-26, CSO review of the root
  // list): these categories are usually import noise but can be LIVE clinical
  // flags — an in-flight 2WW referral, an active EDD marking a current
  // pregnancy, a "Follow-up arranged" administrative status. Removing a
  // caution silently re-exposes those rows to a blanket "Select flagged"
  // sweep, so the exact set is pinned here.
  const expectedCautioned = ['3457005', '161714006', '307824009'];
  const cautioned = cautionRootsOf(nonProblemRootCodes.roots);
  check(
    cautioned.length === expectedCautioned.length,
    `exactly ${expectedCautioned.length} roots carry a caution (got ${cautioned.length})`
  );
  for (const conceptId of expectedCautioned) {
    const root = cautioned.find((r) => r.conceptId === conceptId);
    check(!!root && root.caution.length > 0, `${conceptId} carries a non-empty caution`);
  }
  check(cautionRootsOf(null).length === 0, 'null roots -> empty list, never throws');
  check(cautionRootsOf([{ conceptId: '1' }]).length === 0, 'a root without a caution is not included');
  check(
    cautionRootsOf([
      { conceptId: '1', caution: '' },
      { conceptId: '2', caution: 'x' },
    ]).length === 1,
    'an empty-string caution does not count as cautioned'
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

console.log('--- apiErrorMessage: same server-reason surfacing as problem-description-cleanup ---');
{
  check(apiErrorMessage(400, '') === 'API 400', 'no body -> bare status');
  check(
    apiErrorMessage(400, '{"message":"endDate must not be in the future"}') ===
      'API 400 — endDate must not be in the future',
    'a JSON body with .message surfaces the message'
  );
  check(
    apiErrorMessage(422, '{"errors":{"reason":"is required"}}') === 'API 422 — {"reason":"is required"}',
    'a JSON body with an .errors object surfaces the per-field errors'
  );
  check(apiErrorMessage(500, 'Internal Server Error') === 'API 500 — Internal Server Error', 'non-JSON body as-is');
  {
    const long = 'a'.repeat(500);
    check(apiErrorMessage(400, long).endsWith('…'), 'a long body is truncated with an ellipsis');
  }
}

console.log('--- page-shape parsing: care-record vs task-overview ("split") page ---');
{
  const rec = parseCareRecordPath('/ab12/patient/patient/care-record/123e4567-e89b-12d3-a456-426614174000');
  check(rec && rec.siteId === 'ab12', 'care-record: siteId parsed');
  check(rec && rec.patientId === '123e4567-e89b-12d3-a456-426614174000', 'care-record: patientId parsed');
  check(
    parseCareRecordPath('/ab12/care-record/123e4567-e89b-12d3-a456-426614174000') !== null,
    'bare /care-record/ form still matches'
  );
  check(
    parseCareRecordPath('/ab12/tasks/data/patient-request/overview/123e4567-e89b-12d3-a456-426614174000') === null,
    'a task URL never matches the care-record parser'
  );

  const task = parseTaskOverviewPath('/ab12/tasks/data/patient-request/overview/123e4567-e89b-12d3-a456-426614174000');
  check(task && task.siteId === 'ab12', 'task-overview: siteId parsed');
  check(task && task.typeSlug === 'patient-request', 'task-overview: typeSlug parsed');
  check(task && task.taskUuid === '123e4567-e89b-12d3-a456-426614174000', 'task-overview: taskUuid parsed');
  check(
    parseTaskOverviewPath('/ab12/tasks/data/patient-request/task-list') === null,
    'the queue (task-list) URL never matches — list pages have no single patient'
  );
  check(
    parseTaskOverviewPath('/ab12/patient/patient/care-record/123e4567-e89b-12d3-a456-426614174000') === null,
    'a care-record URL never matches the task parser'
  );
  check(
    parseCareRecordPath(null) === null && parseTaskOverviewPath(null) === null,
    'null pathname -> null, never throws'
  );
}

console.log('--- extractPatientIdFromTaskOverview: the task-inline fallback chain ---');
{
  check(
    extractPatientIdFromTaskOverview({ data: { patient: { id: 'p1' } } }) === 'p1',
    'data.data.patient.id preferred'
  );
  check(extractPatientIdFromTaskOverview({ data: { patientId: 'p2' } }) === 'p2', 'data.data.patientId next');
  check(extractPatientIdFromTaskOverview({ patient: { id: 'p3' } }) === 'p3', 'data.patient.id next');
  check(extractPatientIdFromTaskOverview({ patientId: 'p4' }) === 'p4', 'data.patientId last');
  check(extractPatientIdFromTaskOverview({}) === null, 'patientless task overview -> null');
  check(extractPatientIdFromTaskOverview(null) === null, 'null response -> null, never throws');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
