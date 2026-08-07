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
  manualChildOptions,
  buildDuplicateGroups,
  pickEarliestCopyId,
  buildMarkIncorrectPayload,
  removableDuplicateIds,
  buildSignificancePayload,
  resolveSignificanceOption,
  apiErrorMessage,
  resultContainsConceptId,
  parseCareRecordPath,
  parseTaskOverviewPath,
  parseSummaryBridgeAttr,
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

console.log('--- manualChildOptions: the manual builder is looser, except the cycle guard ---');
{
  const problems = [
    { id: 'an1', description: 'Anorexia nervosa' },
    { id: 'an2', description: 'Anorexia nervosa' },
    { id: 'brady', description: 'Bradycardia' },
    { id: 'dep', description: 'Depression' },
  ];
  const opts = manualChildOptions('an1', problems, {});
  check(opts.length === 3, 'every other problem is a candidate child — no SNOMED gate');
  check(!opts.some((o) => o.id === 'an1'), 'the parent itself is never a child option');
  check(
    opts.some((o) => o.id === 'an2'),
    "a same-code problem IS offered manually (duplicate-vs-hierarchy is the clinician's call here)"
  );
  // Cycle guard stays hard: dep is already under brady, brady under an1 —
  // nesting an1 (or brady) under dep would loop, so neither is a candidate.
  const map = { dep: 'brady', brady: 'an1' };
  const depOpts = manualChildOptions('dep', problems, map);
  check(
    !depOpts.some((o) => o.id === 'an1') && !depOpts.some((o) => o.id === 'brady'),
    'ancestors in the LINK graph are cycle-filtered out of the child list'
  );
  check(
    depOpts.some((o) => o.id === 'an2'),
    'unrelated problems still offered'
  );
  // A problem that already has a parent is still offered as a CHILD (that's a
  // re-parent — annotated in the UI and called out at confirm, not blocked).
  check(
    manualChildOptions('an2', problems, map).some((o) => o.id === 'brady'),
    'an already-parented problem is still offered (re-parent, annotated)'
  );
  check(manualChildOptions(null, problems, {}).length === 0, 'no parent chosen -> no options');
  check(manualChildOptions('x', null, {}).length === 0, 'null problems -> empty, never throws');
}

console.log('--- duplicate-merge helpers ---');
{
  const problems = [
    { id: 'b-newer', description: 'Anorexia nervosa' },
    { id: 'a-older', description: 'Anorexia nervosa' },
    { id: 'brady', description: 'Bradycardia' },
    { id: 'nocode', description: 'Mystery entry' },
  ];
  const info = {
    'b-newer': { conceptId: 'AN' },
    'a-older': { conceptId: 'AN' },
    brady: { conceptId: 'BR' },
    nocode: { conceptId: null },
  };
  const groups = buildDuplicateGroups(problems, info);
  check(groups.length === 1, 'only same-conceptId sets of 2+ group');
  check(groups[0].conceptId === 'AN' && groups[0].entries.length === 2, 'the duplicate pair is the group');
  check(buildDuplicateGroups(null, null).length === 0, 'null inputs -> empty, never throws');

  check(
    pickEarliestCopyId([{ id: 'b-newer' }, { id: 'a-older' }]) === 'a-older',
    'earliest copy (smallest UUIDv7 id) is the default keeper'
  );
  check(pickEarliestCopyId([]) === null, 'no entries -> null keeper');

  const payload = buildMarkIncorrectPayload('prob-1', '  Duplicate entry  ');
  check(
    payload.problemId === 'prob-1' && payload.reason === 'Duplicate entry' && payload.isConfirmedRemoval === true,
    'the confirmed mark-incorrect-and-hidden body: id, trimmed reason, isConfirmedRemoval'
  );
  check(
    Object.keys(payload).sort().join(',') === 'isConfirmedRemoval,problemId,reason',
    'exactly the three confirmed fields'
  );
  check(buildMarkIncorrectPayload('prob-1', '   ') === null, 'a blank reason never reaches the record');
  check(buildMarkIncorrectPayload(null, 'x') === null, 'a missing id never reaches the record');

  const entries = [
    { id: 'keep', hasChildren: false },
    { id: 'plain', hasChildren: false },
    { id: 'parent-copy', hasChildren: true },
  ];
  const removable = removableDuplicateIds(entries, 'keep');
  check(removable.length === 1 && removable[0] === 'plain', 'keeper and copies with children are never removable');
  check(removableDuplicateIds(entries, 'plain').join(',') === 'keep', 'keeper choice flips what is removable');
  check(removableDuplicateIds(null, 'x').length === 0, 'null entries -> empty, never throws');
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

console.log('--- significance re-grade: the edit-problem full-replace discipline ---');
{
  const prefill = {
    onsetDate: '2016-03-01',
    contextId: null,
    contextType: null,
    significance: { value: 'minor', label: 'Minor' },
    episode: { value: 'first', label: 'First' },
    problemCode: { conceptId: '59621000', description: 'Essential hypertension', descriptionId: 'd1' },
    additionalInformation: 'clinic BP series',
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    endDate: null,
    reasonEnded: null,
    recordDate: '2016-03-02',
    recordedAtAnotherOrganisation: false,
    recordedByStaff: { value: 'staff-1', label: 'Dr T' },
    significances: [
      { value: 'major', label: 'Major' },
      { value: 'minor', label: 'Minor' },
      { value: 'unknown-significance', label: 'Unknown Significance' },
    ],
  };
  const payload = buildSignificancePayload(prefill, 'major');
  check(payload.significance === 'major', 'significance is the ONLY changed field');
  check(payload.problemCode.conceptId === '59621000', 'problemCode passes through unchanged (never re-codes)');
  check(payload.episode === 'first', 'option-object episode unwrapped to its bare value (the 2026-07-27 400 trap)');
  check(payload.recordedByStaff === 'staff-1', 'recordedByStaff option unwrapped');
  check(payload.additionalInformation === 'clinic BP series', 'additionalInformation resent unchanged');
  check(
    Object.keys(payload).sort().join(',') ===
      'additionalInformation,confidentialFromThirdParties,contextId,contextType,endDate,episode,' +
        'hiddenFromPatientFacingServices,onsetDate,problemCode,reasonEnded,recordDate,recordedByStaff,significance',
    'exactly the confirmed full-replace key set, local-staff branch'
  );

  const orgPrefill = Object.assign({}, prefill, {
    recordedAtAnotherOrganisation: true,
    recordedByOrganisation: {
      label: 'Park Road Surgery',
      value: {
        organisationName: 'Park Road Surgery',
        organisationIdentifierType: null,
        organisationIdentifierValue: null,
      },
    },
    recordedByPractitioner: 'Mrs Sarah Elliott',
  });
  const orgPayload = buildSignificancePayload(orgPrefill, 'major');
  check(
    orgPayload.recordedByOrganisation.organisationName === 'Park Road Surgery' &&
      !('label' in orgPayload.recordedByOrganisation),
    'wrapped recordedByOrganisation unwrapped (the 2026-07-26 400 trap); org branch fields present'
  );
  check(!('recordedByStaff' in orgPayload), 'org branch never carries recordedByStaff');
  check(
    buildSignificancePayload(prefill, null) === null,
    'a missing significance value refuses outright — never posted'
  );
  check(buildSignificancePayload(prefill, '') === null, 'empty value refuses too');

  const opts = prefill.significances;
  check(resolveSignificanceOption(opts, 'major') === 'major', "'major' resolved from the form's own options");
  check(
    resolveSignificanceOption(opts, 'unknown') === 'unknown-significance',
    "'unknown' matches the unknown-significance option by prefix — never an invented enum"
  );
  check(resolveSignificanceOption(opts, 'minor') === 'minor', "'minor' resolved");
  check(resolveSignificanceOption([], 'major') === null, 'a form offering no options -> null (per-row refusal)');
  check(resolveSignificanceOption(null, 'major') === null, 'null options -> null, never throws');
  check(resolveSignificanceOption(opts, null) === null, 'null target -> null, never throws');
}

console.log('--- parseSummaryBridgeAttr: the page-world bridge context source ---');
{
  check(
    parseSummaryBridgeAttr('123e4567-e89b-12d3-a456-426614174000|1754200000000') ===
      '123e4567-e89b-12d3-a456-426614174000',
    'well-formed attribute -> patientId'
  );
  check(
    parseSummaryBridgeAttr('123e4567-e89b-12d3-a456-426614174000') === '123e4567-e89b-12d3-a456-426614174000',
    'timestampless value still parses'
  );
  check(parseSummaryBridgeAttr('not-a-uuid|123') === null, 'malformed id -> null (strict full-UUID check)');
  check(
    parseSummaryBridgeAttr('') === null && parseSummaryBridgeAttr(null) === null,
    'empty/null -> null, never throws'
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
