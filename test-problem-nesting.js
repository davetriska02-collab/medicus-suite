// Medicus Suite — problem-nesting ("Nest problems?" on the Clinical Summary)
// tests
// Run with: node test-problem-nesting.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: the update-parent-problem POST payload (three fields, confirmed
// via the 2026-08-03 live capture — see docs/learnings-problem-nesting-api.md),
// conceptId resolution from a slideover overview, the cycle guard, the
// suggestion builder's safety rules (no re-parenting, no identical-concept
// pairs, cycle-filtered options, pairHits-driven), and the page-shape parsers
// shared with the other split-page-capable widgets.

'use strict';

const {
  buildUpdateParentProblemPayload,
  resolveOverviewConceptId,
  wouldCreateCycle,
  buildNestingSuggestions,
  manualParentOptions,
  apiErrorMessage,
  resultContainsConceptId,
  parseCareRecordPath,
  parseTaskOverviewPath,
  extractPatientIdFromTaskOverview,
} = require('./content-scripts/problem-nesting.js');

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

console.log('--- buildUpdateParentProblemPayload: the confirmed three-field contract ---');
{
  const payload = buildUpdateParentProblemPayload('pat-1', 'child-1', 'parent-1');
  check(payload.patientId === 'pat-1', 'patientId passed through');
  check(payload.problemId === 'child-1', 'problemId passed through');
  check(payload.parentProblemId === 'parent-1', 'parentProblemId passed through');
  check(
    Object.keys(payload).sort().join(',') === 'parentProblemId,patientId,problemId',
    'exactly the three confirmed fields, nothing extra — NOT a full-record replace'
  );
}

console.log('--- resolveOverviewConceptId ---');
{
  check(
    resolveOverviewConceptId({ problemCode: { conceptId: '68566005' } }) === '68566005',
    'problemCode.conceptId resolved'
  );
  check(resolveOverviewConceptId({ problemCode: { conceptId: 12345 } }) === '12345', 'numeric conceptId stringified');
  check(resolveOverviewConceptId({ problemCode: {} }) === null, 'missing conceptId -> null');
  check(resolveOverviewConceptId(null) === null, 'null overview -> null, never throws');
}

console.log('--- wouldCreateCycle: the loop guard ---');
{
  check(wouldCreateCycle('a', 'a', {}) === true, 'self-parenting is always a cycle');
  check(wouldCreateCycle('a', 'b', {}) === false, 'unlinked pair -> no cycle');
  check(wouldCreateCycle('a', 'b', { b: 'a' }) === true, 'direct loop: b already child of a');
  check(wouldCreateCycle('a', 'c', { c: 'b', b: 'a' }) === true, 'transitive loop via the parent chain');
  check(wouldCreateCycle('a', 'c', { c: 'b', b: 'd' }) === false, 'chain ending elsewhere -> no cycle');
  check(
    wouldCreateCycle('a', 'b', { b: 'c', c: 'b' }) === false,
    'a pre-existing loop in server data terminates (visited guard), never hangs'
  );
  check(wouldCreateCycle(null, 'b', {}) === false, 'null child -> false, never throws');
}

console.log('--- buildNestingSuggestions: the safety rules ---');
{
  // stent (child concept C1) under angioplasty (parent concept P1) — the
  // real captured example shape.
  const problems = [
    { id: 'angio', description: 'Percutaneous balloon coronary angioplasty' },
    { id: 'stent', description: 'Insertion of coronary artery stent' },
    { id: 'htn', description: 'Essential hypertension' },
  ];
  const info = {
    angio: { conceptId: 'P1', parentProblemId: null },
    stent: { conceptId: 'C1', parentProblemId: null },
    htn: { conceptId: 'H1', parentProblemId: null },
  };
  const hits = new Set(['C1|P1']);
  const out = buildNestingSuggestions(problems, info, hits);
  check(out.length === 1, 'exactly one suggestion from one pair hit');
  check(out[0].childId === 'stent', 'the DESCENDANT is the child');
  check(
    out[0].parentOptions.length === 1 && out[0].parentOptions[0].id === 'angio',
    'the ancestor is the parent option'
  );

  // A child that already has a parent is never re-parented by suggestion.
  const infoParented = Object.assign({}, info, { stent: { conceptId: 'C1', parentProblemId: 'somewhere' } });
  check(
    buildNestingSuggestions(problems, infoParented, hits).length === 0,
    'an already-parented child gets no suggestion'
  );

  // Identical concepts are duplicates, not hierarchy — never paired even if
  // a (bogus) pair hit claims otherwise.
  const dupProblems = [
    { id: 'a', description: 'Asthma' },
    { id: 'b', description: 'Asthma' },
  ];
  const dupInfo = { a: { conceptId: 'X', parentProblemId: null }, b: { conceptId: 'X', parentProblemId: null } };
  check(
    buildNestingSuggestions(dupProblems, dupInfo, new Set(['X|X'])).length === 0,
    'identical-concept pairs are never suggested'
  );

  // No pair hit -> no suggestion, whatever the concepts are.
  check(buildNestingSuggestions(problems, info, new Set()).length === 0, 'no pair hits -> no suggestions');

  // A problem with no resolved conceptId can be neither child nor parent.
  const infoNoConcept = Object.assign({}, info, { stent: { conceptId: null, parentProblemId: null } });
  check(
    buildNestingSuggestions(problems, infoNoConcept, hits).length === 0,
    'a child with no resolved conceptId is skipped'
  );

  // Cycle-creating options are filtered: if angio is already (somehow) a
  // descendant of stent in the LINK graph, stent->angio must not be offered.
  const infoCycle = {
    angio: { conceptId: 'P1', parentProblemId: 'stent' },
    stent: { conceptId: 'C1', parentProblemId: null },
    htn: { conceptId: 'H1', parentProblemId: null },
  };
  check(
    buildNestingSuggestions(problems, infoCycle, hits).length === 0,
    'an option that would create a loop is dropped'
  );

  check(buildNestingSuggestions(null, null, null).length === 0, 'null inputs -> empty, never throws');
}

console.log('--- manualParentOptions: the manual builder is looser, except the cycle guard ---');
{
  const problems = [
    { id: 'an1', description: 'Anorexia nervosa' },
    { id: 'an2', description: 'Anorexia nervosa' },
    { id: 'brady', description: 'Bradycardia' },
    { id: 'dep', description: 'Depression' },
  ];
  const opts = manualParentOptions('brady', problems, {});
  check(opts.length === 3, 'every other problem is a candidate parent — no SNOMED gate');
  check(!opts.some((o) => o.id === 'brady'), 'the child itself is never a parent option');
  check(
    manualParentOptions('an1', problems, {}).some((o) => o.id === 'an2'),
    "a same-code problem IS offered manually (duplicate-vs-hierarchy is the clinician's call here)"
  );
  // Cycle guard stays hard: dep is already under brady, brady under an1 —
  // an1 must not be offered brady or dep as a parent.
  const map = { dep: 'brady', brady: 'an1' };
  const an1opts = manualParentOptions('an1', problems, map);
  check(
    !an1opts.some((o) => o.id === 'brady') && !an1opts.some((o) => o.id === 'dep'),
    'descendants in the LINK graph are cycle-filtered out'
  );
  check(
    an1opts.some((o) => o.id === 'an2'),
    'unrelated problems still offered'
  );
  // A problem that already has a parent is still a valid PARENT option
  // (multi-level hierarchy is confirmed).
  check(
    manualParentOptions('an2', problems, map).some((o) => o.id === 'brady'),
    'an already-parented problem can still BE a parent (multi-level)'
  );
  check(manualParentOptions(null, problems, {}).length === 0, 'no child chosen -> no options');
  check(manualParentOptions('x', null, {}).length === 0, 'null problems -> empty, never throws');
}

console.log('--- resultContainsConceptId (descendant-search reader) ---');
{
  const results = [{ label: 'x', value: { conceptId: '123' } }, { conceptId: '456' }];
  check(resultContainsConceptId(results, '123') === true, 'wrapped {value:{conceptId}} shape read');
  check(resultContainsConceptId(results, '456') === true, 'bare {conceptId} shape tolerated');
  check(resultContainsConceptId(results, '789') === false, 'absent concept -> false');
  check(resultContainsConceptId(null, '123') === false, 'null results -> false, never throws');
}

console.log('--- apiErrorMessage ---');
{
  check(apiErrorMessage(400, '') === 'API 400', 'no body -> bare status');
  check(
    apiErrorMessage(400, '{"message":"parentProblemId is invalid"}') === 'API 400 — parentProblemId is invalid',
    'a JSON body with .message surfaces the message'
  );
}

console.log('--- page-shape parsing: care-record vs task-overview ("split") page ---');
{
  const rec = parseCareRecordPath('/ab12/patient/patient/care-record/123e4567-e89b-12d3-a456-426614174000');
  check(rec && rec.patientId === '123e4567-e89b-12d3-a456-426614174000', 'care-record: patientId parsed');
  const task = parseTaskOverviewPath('/ab12/tasks/data/patient-request/overview/123e4567-e89b-12d3-a456-426614174000');
  check(task && task.taskUuid === '123e4567-e89b-12d3-a456-426614174000', 'task-overview: taskUuid parsed');
  check(
    parseCareRecordPath(null) === null && parseTaskOverviewPath(null) === null,
    'null pathname -> null, never throws'
  );
  check(
    extractPatientIdFromTaskOverview({ data: { patient: { id: 'p1' } } }) === 'p1',
    'task-overview patient id fallback chain'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
