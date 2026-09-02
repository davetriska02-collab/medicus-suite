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
  buildUpdateProblemLinksPayload,
  resolveOverviewConceptId,
  wouldCreateCycle,
  dateSortKey,
  resolveChronologyDate,
  predatesParent,
  buildOverridePairSet,
  buildNestingSuggestions,
  buildTextLinkSuggestions,
  buildUnknownSignificanceSuggestions,
  manualChildOptions,
  buildSignificancePayload,
  resolveSignificanceOption,
  apiErrorMessage,
  resultContainsConceptId,
  parseCareRecordPath,
  parseTaskOverviewPath,
  parseSummaryBridgeAttr,
  extractPatientIdFromTaskOverview,
  buildEndProblemPayload,
  hasActiveChildren,
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

console.log('--- buildUpdateProblemLinksPayload: the confirmed update-problem-links contract ---');
{
  const payload = buildUpdateProblemLinksPayload('pat-1', 'prob-1', ['a', 'b']);
  check(payload.patientId === 'pat-1', 'patientId passed through');
  check(payload.problemId === 'prob-1', 'problemId passed through');
  check(
    JSON.stringify(payload.problemIdsToLink) === JSON.stringify(['a', 'b']),
    'problemIdsToLink passed through as-is (a FULL array, never a single id — see commitFlatLink)'
  );
  check(
    Object.keys(payload).sort().join(',') === 'patientId,problemId,problemIdsToLink',
    'exactly the three confirmed fields'
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

  // Chronology sense-check (2026-08-08 request): a candidate child dated
  // BEFORE its candidate parent can't genuinely be part of it — the parent
  // condition didn't exist yet. Angioplasty (2005) can't be the parent of a
  // stent inserted in 2001.
  const infoBackwards = {
    angio: { conceptId: 'P1', parentProblemId: null, onsetDate: '1 Jan 2005' },
    stent: { conceptId: 'C1', parentProblemId: null, onsetDate: '1 Jan 2001' },
    htn: { conceptId: 'H1', parentProblemId: null },
  };
  check(
    buildNestingSuggestions(problems, infoBackwards, hits).length === 0,
    "a child dated before its candidate parent isn't suggested — can't predate the condition it's part of"
  );
  // Same date, or child dated AFTER — not excluded.
  const infoSameDay = {
    angio: { conceptId: 'P1', parentProblemId: null, onsetDate: '1 Jan 2005' },
    stent: { conceptId: 'C1', parentProblemId: null, onsetDate: '1 Jan 2005' },
    htn: { conceptId: 'H1', parentProblemId: null },
  };
  check(buildNestingSuggestions(problems, infoSameDay, hits).length === 1, 'same-day child/parent is not excluded');
  // Missing dates on either side never block a suggestion that would
  // otherwise have been offered — this is a check on positive evidence, not
  // a data-completeness requirement.
  const infoOneDated = {
    angio: { conceptId: 'P1', parentProblemId: null, onsetDate: '1 Jan 2005' },
    stent: { conceptId: 'C1', parentProblemId: null }, // no onset date at all
    htn: { conceptId: 'H1', parentProblemId: null },
  };
  check(
    buildNestingSuggestions(problems, infoOneDated, hits).length === 1,
    'a missing date on either side fails open — never blocks the suggestion'
  );

  // Practice-defined overrides (rules/problem-nesting-overrides.json,
  // 2026-08-08 request) — first entry: pseudophakia (95217000) as a child
  // of cataract (193570009), a pairing SNOMED itself doesn't recognise.
  const overrideProblems = [
    { id: 'cataract', description: 'Cataract' },
    { id: 'pseudophakia', description: 'Pseudophakia' },
  ];
  const overrideInfo = {
    cataract: { conceptId: '193570009', parentProblemId: null },
    pseudophakia: { conceptId: '95217000', parentProblemId: null },
  };
  const overridePairs = new Set(['95217000|193570009']);
  const overrideOut = buildNestingSuggestions(overrideProblems, overrideInfo, new Set(), overridePairs);
  check(
    overrideOut.length === 1 && overrideOut[0].parentOptions[0].id === 'cataract',
    'an override-only pair (no SNOMED hit at all) still suggests, via overridePairHits'
  );
  check(
    overrideOut[0].parentOptions[0].source === 'override',
    "an override-sourced option is tagged 'override', not 'snomed' — the canvas must never credit SNOMED for a pairing it never made"
  );
  check(
    buildNestingSuggestions(problems, info, hits, overridePairs).length === 1 &&
      buildNestingSuggestions(problems, info, hits, overridePairs)[0].parentOptions[0].source === 'snomed',
    'a genuine SNOMED hit is tagged snomed even when an (irrelevant) override set is also passed'
  );
  check(
    buildNestingSuggestions(problems, info, hits).length === 1,
    'omitting overridePairHits entirely still works — defaults to empty, fully backward compatible'
  );
}

console.log('--- buildTextLinkSuggestions: "(Grouped with X)" text-derived suggestions (2026-08-09) ---');
{
  const MSProblemTextLinking = require('./shared/problem-text-linking.js');
  const problems = [
    { id: 'p1', description: 'Depression, unspecified' },
    { id: 'p2', description: 'Anxiety with depression' },
    { id: 'p3', description: 'Type 2 diabetes mellitus' },
  ];
  const linkEntries = [
    {
      kind: 'pattern',
      id: 'groupedWithReference',
      pattern: '\\(Grouped with ([^)]+)\\)',
      flags: 'i',
      action: { type: 'linkSuggestion', capturesProblemName: 1 },
    },
  ];
  const info = {
    p1: { additionalInformation: '(Grouped with Anxiety with depression)' },
    p2: { additionalInformation: null },
    p3: { additionalInformation: 'Genuine free text, nothing generic here.' },
  };
  const out = buildTextLinkSuggestions(problems, info, linkEntries, MSProblemTextLinking);
  check(out.length === 1, 'exactly one problem carries a resolvable reference (got ' + out.length + ')');
  check(
    out[0].problemId === 'p1' && out[0].matchedProblemId === 'p2' && out[0].confidence === 'exact',
    "resolves p1's reference to p2, the exact-matching problem on the record"
  );
  check(
    buildTextLinkSuggestions(problems, info, linkEntries, null).length === 0,
    'no matcher injected -> empty list, never throws (defensive — the browser call site always injects one)'
  );
  check(buildTextLinkSuggestions([], {}, linkEntries, MSProblemTextLinking).length === 0, 'no problems -> empty list');
  const infoNoMatch = { p1: { additionalInformation: '(Grouped with Some unrelated condition)' } };
  check(
    buildTextLinkSuggestions([problems[0]], infoNoMatch, linkEntries, MSProblemTextLinking).length === 0,
    'a reference with no confident match on the record produces NO suggestion here (that case is informational-only, handled by problem-description-cleanup.js instead)'
  );
}

console.log('--- buildUnknownSignificanceSuggestions: "flag unknown, offer major/minor" (2026-08-09) ---');
{
  const problems = [
    { id: 'p1', description: 'Chronic kidney disease stage 3' },
    { id: 'p2', description: 'Type 2 diabetes mellitus' },
    { id: 'p3', description: 'Hypertension' },
  ];
  const info = {
    p1: { significance: 'Unknown Significance' },
    p2: { significance: 'Major' },
    p3: { significance: 'Minor' },
  };
  const out = buildUnknownSignificanceSuggestions(problems, info);
  check(out.length === 1, 'exactly one problem is currently Unknown Significance (got ' + out.length + ')');
  check(
    out[0].problemId === 'p1' && out[0].currentSignificance === 'Unknown Significance',
    'flags p1 with its current significance label carried through'
  );
  check(
    buildUnknownSignificanceSuggestions(problems, { p1: {}, p2: {}, p3: {} }).length === 3,
    'a missing significance field defaults to "Unknown" and is flagged too (Medicus itself defaults an ungraded problem this way)'
  );
  check(buildUnknownSignificanceSuggestions([], {}).length === 0, 'no problems -> empty list');
  check(buildUnknownSignificanceSuggestions(null, null).length === 0, 'null inputs -> empty list, never throws');
  check(
    buildUnknownSignificanceSuggestions(problems, {}).length === 3,
    'null infoById entries -> defaults to "Unknown" per problem, same as a missing significance field'
  );
}

console.log('--- buildOverridePairSet ---');
{
  const set = buildOverridePairSet([
    { childConceptId: '95217000', parentConceptId: '193570009' },
    { childConceptId: 'A', parentConceptId: 'B', note: 'ignored — only the two concept ids are matched' },
  ]);
  check(set instanceof Set && set.size === 2, 'one key per well-formed entry');
  check(set.has('95217000|193570009'), 'the pseudophakia/cataract pair key is built correctly');
  check(
    buildOverridePairSet([{ childConceptId: null, parentConceptId: 'B' }]).size === 0,
    'a missing concept id is skipped, never a malformed key'
  );
  check(buildOverridePairSet(null).size === 0, 'null input -> empty set, never throws');
  check(buildOverridePairSet([]).size === 0, 'empty input -> empty set');
}

console.log('--- rules/problem-nesting-overrides.json: the shipped list itself ---');
{
  const overrides = require('./rules/problem-nesting-overrides.json');
  check(Array.isArray(overrides.pairs) && overrides.pairs.length >= 2, 'at least the two known entries are present');
  const pairSet = buildOverridePairSet(overrides.pairs);
  check(
    pairSet.has('95217000|193570009'),
    'pseudophakia (95217000) as a child of cataract (193570009) is still in the shipped file'
  );
  check(
    pairSet.has('53889007|193570009'),
    'nuclear cataract (53889007) as a child of cataract (193570009) is still in the shipped file'
  );
  // 2026-08-26: practice-requested seizure/epilepsy pairs (Nick) — added
  // while separately testing a problem-description-cleanup fix.
  check(
    pairSet.has('1366066004|84757009'),
    'nocturnal epileptic seizures (1366066004) as a child of epilepsy (84757009) is in the shipped file'
  );
  check(
    pairSet.has('91175000|84757009'),
    'seizure (91175000) as a child of epilepsy (84757009) is in the shipped file'
  );
  // 2026-08-28: practice-requested diabetic-complication pairs (Nick) — all
  // three verified live against the public NHS termbrowser API this session.
  check(
    pairSet.has('390834004|44054006'),
    'background diabetic retinopathy (390834004) as a child of Type 2 diabetes mellitus (44054006) is in the shipped file'
  );
  check(
    pairSet.has('127014009|44054006'),
    'diabetic peripheral angiopathy (127014009) as a child of Type 2 diabetes mellitus (44054006) is in the shipped file'
  );
  check(
    pairSet.has('230572002|44054006'),
    'diabetic neuropathy (230572002) as a child of Type 2 diabetes mellitus (44054006) is in the shipped file'
  );
  overrides.pairs.forEach((p) => {
    check(
      typeof p.childConceptId === 'string' && typeof p.parentConceptId === 'string',
      `entry for ${p.childDescription || '?'} has both concept ids as strings, not numbers (a numeric SCTID would silently fail to match a live conceptId, which is always a string)`
    );
  });
}

console.log('--- dateSortKey / resolveChronologyDate / predatesParent ---');
{
  check(dateSortKey('1 Jan 2005') === '2005-01-01', 'single-digit day zero-padded');
  check(dateSortKey('20 Apr 2020') === '2020-04-20', 'two-digit day parsed');
  check(dateSortKey(null) === null, 'null -> null');
  check(dateSortKey('garbage') === null, 'garbage -> null, never throws');
  // recordDate comes back from slideover/overview ALREADY in ISO shape
  // (confirmed live 2026-08-08, HAR 48: "recordDate":"2025-01-15" on the
  // SAME response as "onsetDate":"20 Apr 2006") — must parse both formats,
  // or the onset-blank record-date fallback below silently goes null.
  check(dateSortKey('2025-01-15') === '2025-01-15', 'already-ISO shape (recordDate) parsed too');
  // The real bug Nick found live 2026-08-20: a partial onset date (month +
  // year only, no day — a real shape Medicus stores for an imported/
  // historic record) used to fall through the day-requiring regex and
  // return null, which silently defeated predatesParent's chronology check
  // for that problem, not just its display sort order.
  check(dateSortKey('Dec 2008') === '2008-12', 'partial "Mon YYYY" onset date parses to a YYYY-MM key, not null');
  // The real bug Nick found live 2026-08-27: a YEAR-ONLY onset date (a
  // "since 2012" prostate-cancer problem, additionalInformation confirming
  // it, no month recorded at all) sorted as fully undated — the SAME
  // failure mode the 2026-08-20 month-only fix addressed, one level less
  // specific, and not covered by that fix.
  check(dateSortKey('2012') === '2012', 'a bare year with no month parses to a YYYY key, not null');
  check(dateSortKey('12345') === null, 'a 5-digit string is not a bare year — never guessed at');

  check(
    predatesParent({ onsetDate: 'Dec 2008' }, { onsetDate: '1 Jan 2020' }) === true,
    'a partial-dated child correctly predates a later full-dated parent — the real live case this fixes'
  );
  check(
    predatesParent({ onsetDate: '1 Jan 1990' }, { onsetDate: 'Dec 2008' }) === true,
    'a partial-dated parent is also handled — the earlier full-dated child still predates it'
  );
  check(
    predatesParent({ onsetDate: '2012' }, { onsetDate: '1 Jan 2020' }) === true,
    'a year-only-dated child correctly predates a later full-dated parent'
  );
  check(
    predatesParent({ onsetDate: '1 Jan 1990' }, { onsetDate: '2012' }) === true,
    'a year-only-dated parent is also handled — the earlier full-dated child still predates it'
  );

  check(
    resolveChronologyDate({ onsetDate: '1 Jan 2020', recordDate: '1 Jan 2019' }) === '2020-01-01',
    'onset date preferred when present'
  );
  check(
    resolveChronologyDate({ onsetDate: null, recordDate: '1 Jan 2019' }) === '2019-01-01',
    'record date used when onset is blank — same fallback the canvas displays'
  );
  check(
    resolveChronologyDate({ onsetDate: null, recordDate: '2019-01-01' }) === '2019-01-01',
    'the ISO-shaped recordDate fallback resolves correctly too — the real live bug (2026-08-08): this used to silently return null'
  );
  check(resolveChronologyDate(null) === null, 'no info at all -> null, never throws');

  check(
    predatesParent({ onsetDate: '1 Jan 2001' }, { onsetDate: '1 Jan 2005' }) === true,
    'an earlier-dated child predates a later-dated parent'
  );
  check(
    predatesParent({ onsetDate: null, recordDate: '2001-01-01' }, { onsetDate: '1 Jan 2005' }) === true,
    'mixed formats across the pair (ISO recordDate fallback vs UK-style onsetDate) still compare correctly'
  );
  check(
    predatesParent({ onsetDate: '1 Jan 2005' }, { onsetDate: '1 Jan 2001' }) === false,
    'a child dated AFTER the parent does not predate it'
  );
  check(
    predatesParent({ onsetDate: '1 Jan 2005' }, { onsetDate: '1 Jan 2005' }) === false,
    'equal dates do not count as predating'
  );
  check(predatesParent({}, { onsetDate: '1 Jan 2005' }) === false, 'child date unknown -> fails open, not excluded');
  check(predatesParent({ onsetDate: '1 Jan 2005' }, {}) === false, 'parent date unknown -> fails open, not excluded');
  check(predatesParent(null, null) === false, 'null inputs -> false, never throws');
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

console.log('--- end-problem payload / hasActiveChildren ---');
{
  const ended = buildEndProblemPayload('prob-1', '2026-08-17', 'Resolved');
  check(ended.problemId === 'prob-1', 'end payload carries the problem id');
  check(ended.endDate === '2026-08-17', 'end payload carries the date');
  check(ended.reason === 'Resolved', 'end payload defaults to the Bulk remove? reason');
  check(
    Object.keys(ended).sort().join(',') === 'endDate,problemId,reason',
    'exactly the three-field Bulk remove? contract'
  );
  check(hasActiveChildren('parent', { child: 'parent' }) === true, 'a parent with a live child is flagged');
  check(hasActiveChildren('leaf', { child: 'parent' }) === false, 'a leaf is not flagged');
  check(hasActiveChildren(null, { child: 'parent' }) === false, 'null id is not a parent');
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

console.log('\n--- v3.227.1 review-fix source locks (cycle guard / scan races / children coverage) ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'problem-nesting.js'), 'utf8');
  // Finding 1: a nest commit arriving over the bridge before any scan must
  // never pass the cycle guard vacuously on an empty parent map.
  check(
    src.includes('_parentMapComplete'),
    'commitParentLink distinguishes a known-complete map from an unpopulated one'
  );
  check(
    src.includes('wouldCreateCycleAuthoritative'),
    'an authoritative fetch-walking cycle check exists for the no-scan path'
  );
  check(
    /wouldCreateCycleAuthoritative[\s\S]{0,1200}?throw new Error\(\s*'Could not verify the existing hierarchy/.test(
      src
    ),
    'the authoritative walk FAILS CLOSED when the chain cannot be verified'
  );
  // Finding 3: the late awaits in runScan (override rules, generic-info
  // rules, the per-suggestion relationship checks) must each re-check the
  // patient before touching state — especially before _scanState = 'done'.
  const doneIdx = src.indexOf("_scanState = 'done'");
  const guardBeforeDone = src.lastIndexOf('if (_lastPatientId !== scanPatientId) return', doneIdx);
  const lastAwaitBeforeDone = src.lastIndexOf('await Promise.all', doneIdx);
  check(
    doneIdx !== -1 && guardBeforeDone !== -1 && guardBeforeDone > lastAwaitBeforeDone,
    "a patient re-check sits between the final awaited batch and _scanState = 'done'"
  );
  // Finding 7: checkExistingRelationship must read childProblems off the
  // fallback overview fetch instead of defaulting children to "none" on the
  // surface that has no scan cache.
  const cerIdx = src.indexOf('async function checkExistingRelationship');
  const cerBody = src.slice(cerIdx, src.indexOf('var SIG_TARGETS'));
  check(
    cerBody.includes('childProblems'),
    'checkExistingRelationship resolves children from the overview fetch when the scan cache is empty'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
