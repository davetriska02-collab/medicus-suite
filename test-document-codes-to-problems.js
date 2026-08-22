// Medicus Suite — document-codes-to-problems ("Add as problem?" widget) tests
// Run with: node test-document-codes-to-problems.js
//
// Live Medicus and the DOM it injects into aren't available here, so only
// the pure logic is exercised: extracting note-type coded entries from a
// task-overview payload, deriving an onset date from the document (or
// investigation-result) date, the text-preview derivation, the exact-code
// duplicate check, the allergy-code check, the create-problem payload
// shape, and the investigation-page slug/copy gates — all modelled on the
// real values confirmed in
// docs/learnings-document-problem-creation-api.md (2026-08-12 captures)
// plus the investigation-report date fields already confirmed in
// engine/normalisers.js.

'use strict';

const fs = require('fs');
const path = require('path');
const {
  todayISO,
  clampToToday,
  sanitizeOnsetDate,
  documentDateSource,
  isoDatePrefix,
  firstInvestigationResultDate,
  onsetDateSource,
  isInvestigationTaskSlug,
  isCodesToProblemsTaskSlug,
  patientIdFromOverview,
  extractInboundDocument,
  extractCodedNoteEntries,
  derivePreviewText,
  mergeActedState,
  problemAlreadyExists,
  annotateExistingProblemFlags,
  isAllergyRelatedCode,
  buildCreateProblemPayload,
  markSameBatchDuplicates,
  isFileDocumentButtonLabel,
  isFileResultsButtonLabel,
  isHostFileButtonLabel,
  surfaceNoun,
  emptyStateCopy,
  rectsOverlap,
  isBackdropRect,
  defaultPanelPosition,
  nudgeClearOf,
} = require('./content-scripts/document-codes-to-problems.js');

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

console.log('--- documentDateSource: prefer documentDate, fall back to recordDate ---');
{
  check(
    documentDateSource({ documentDate: '2026-07-19', recordDate: '2026-07-20' }) === '2026-07-19',
    'documentDate wins when both are present'
  );
  check(
    documentDateSource({ documentDate: null, recordDate: '2026-07-20' }) === '2026-07-20',
    'falls back to recordDate when documentDate is null — the real capture had no documentDate'
  );
  check(documentDateSource({ documentDate: null, recordDate: null }) === null, 'null when neither is set');
  check(documentDateSource(null) === null, 'null inboundDocument -> null, never throws');
  check(documentDateSource(undefined) === null, 'undefined inboundDocument -> null, never throws');
}

console.log('--- investigation slugs: same family as lab-file-button FILING_URL_RE ---');
{
  check(isInvestigationTaskSlug('investigation_result') === true, 'investigation_result (queue-smoke slug)');
  check(
    isInvestigationTaskSlug('review_investigation_results_task') === true,
    'review_investigation_results_task (rota/condor slug)'
  );
  check(
    isInvestigationTaskSlug('review-investigation-report') === true,
    'review-investigation-report (api-client example slug)'
  );
  check(isInvestigationTaskSlug('document') === false, 'document is NOT an investigation slug');
  check(isInvestigationTaskSlug('medical_patient_request_task') === false, 'triage request is not an investigation');
  check(isInvestigationTaskSlug('prescription_request_task_routine') === false, 'routine Rx is not an investigation');
  check(isInvestigationTaskSlug('') === false, 'empty slug -> false');
  check(isInvestigationTaskSlug(null) === false, 'null slug -> false, never throws');
  check(isCodesToProblemsTaskSlug('document') === true, 'document is a codes-to-problems surface');
  check(isCodesToProblemsTaskSlug('investigation_result') === true, 'investigation_result is a codes-to-problems surface');
  check(isCodesToProblemsTaskSlug('medical_patient_request_task') === false, 'a triage request is not this widget');
  check(surfaceNoun('document') === 'document', 'surfaceNoun on a document slug');
  check(surfaceNoun('investigation_result') === 'investigation', 'surfaceNoun on an investigation slug');
  check(surfaceNoun(null) === 'document', 'null slug falls back to document (never throws)');
  check(/Code as/.test(emptyStateCopy('investigation_result')), 'investigation empty copy names the Code as field');
  check(/Codes & actions/.test(emptyStateCopy('document')), 'document empty copy still names Codes & actions');
  check(
    !/document/.test(emptyStateCopy('review-investigation-report')),
    'investigation empty copy does not say "document"'
  );
}

console.log('--- isoDatePrefix / firstInvestigationResultDate / onsetDateSource ---');
{
  check(isoDatePrefix('2026-01-09 08:26:00') === '2026-01-09', 'specimenCollectionDate datetime -> YYYY-MM-DD');
  check(isoDatePrefix('2026-03-15T10:00:00Z') === '2026-03-15', 'issuedDateTime ISO -> YYYY-MM-DD');
  check(isoDatePrefix('2026-07-20') === '2026-07-20', 'already a full ISO date passes through');
  check(isoDatePrefix('09 Jan 26, 08:26') === null, 'formattedSpecimenCollectionDate display string is refused');
  check(isoDatePrefix('2015') === null, 'year-only partial -> null');
  check(isoDatePrefix(null) === null, 'null -> null, never throws');
  check(isoDatePrefix('') === null, 'empty -> null');

  const report = {
    investigationGroups: [
      {
        results: [
          { description: 'WBC', specimenCollectionDate: '2026-01-09 08:26:00', issuedDateTime: null },
          { description: 'RDW', specimenCollectionDate: '2026-01-09 08:26:00', issuedDateTime: null },
        ],
      },
    ],
    ungroupedResults: [],
  };
  check(
    firstInvestigationResultDate(report) === '2026-01-09',
    'first grouped result specimenCollectionDate wins (shared specimen date)'
  );
  check(
    firstInvestigationResultDate({
      investigationGroups: [{ results: [{ description: 'PSA', specimenCollectionDate: null, issuedDateTime: '2026-03-15T10:00:00Z' }] }],
    }) === '2026-03-15',
    'falls back to issuedDateTime when specimenCollectionDate is null — the confirmed PSA shape'
  );
  check(
    firstInvestigationResultDate({
      investigationGroups: [],
      ungroupedResults: [{ description: 'XR', specimenCollectionDate: '2026-07-28 00:00:00' }],
    }) === '2026-07-28',
    'ungroupedResults are walked when groups are empty'
  );
  check(firstInvestigationResultDate(null) === null, 'null report -> null');
  check(firstInvestigationResultDate({}) === null, 'empty report -> null');
  check(
    firstInvestigationResultDate({
      investigationGroups: [{ results: [{ description: 'X', formattedSpecimenCollectionDate: '09 Jan 26, 08:26' }] }],
    }) === null,
    'formattedSpecimenCollectionDate alone is never used — display string, not a write value'
  );

  check(
    onsetDateSource({ data: { inboundDocument: { documentDate: '2026-07-19', recordDate: '2026-07-20' } } }) ===
      '2026-07-19',
    'document overview: documentDate still wins'
  );
  check(
    onsetDateSource({
      data: {
        investigationReport: {
          investigationGroups: [{ results: [{ specimenCollectionDate: '2026-01-09 08:26:00' }] }],
        },
      },
    }) === '2026-01-09',
    'investigation overview: specimen date is the onset source'
  );
  check(
    onsetDateSource({
      data: {
        inboundDocument: { documentDate: '2026-07-19' },
        investigationReport: {
          investigationGroups: [{ results: [{ specimenCollectionDate: '2026-01-09 08:26:00' }] }],
        },
      },
    }) === '2026-07-19',
    'if both were somehow present, the document date still wins (never a guessed merge)'
  );
  check(onsetDateSource({}) === null, 'empty overview -> null');
  check(onsetDateSource(null) === null, 'null overview -> null, never throws');
}

console.log('--- clampToToday: onset date can never be in the future ---');
{
  check(clampToToday('2026-07-20', '2026-08-12') === '2026-07-20', 'a past date passes through unchanged');
  check(clampToToday('2026-09-01', '2026-08-12') === '2026-08-12', 'a future date is clamped to today');
  check(clampToToday('2026-08-12', '2026-08-12') === '2026-08-12', "today's own date passes through unchanged");
  check(clampToToday(null, '2026-08-12') === null, 'null date -> null, never throws');
  check(typeof todayISO() === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayISO()), 'todayISO returns YYYY-MM-DD');
}

console.log('--- sanitizeOnsetDate: only a genuine full ISO date is ever sent as onsetDate ---');
{
  check(
    sanitizeOnsetDate('2026-07-20', '2026-08-12') === '2026-07-20',
    'a genuine full ISO date passes through (clamped as normal)'
  );
  check(
    sanitizeOnsetDate('2015', '2026-08-12') === null,
    'a year-only partial date (a real GP2GP-scanned-letter shape) -> null, never forwarded — this is the exact live 400 fix'
  );
  check(sanitizeOnsetDate('2015-03', '2026-08-12') === null, 'a year-month partial date -> null, never forwarded');
  check(sanitizeOnsetDate('20 Jul 2026', '2026-08-12') === null, 'a UK display string -> null, never forwarded');
  check(sanitizeOnsetDate('', '2026-08-12') === null, 'empty string -> null');
  check(sanitizeOnsetDate(null, '2026-08-12') === null, 'null -> null, never throws');
  check(sanitizeOnsetDate(undefined, '2026-08-12') === null, 'undefined -> null, never throws');
  check(
    sanitizeOnsetDate('2026-09-01', '2026-08-12') === '2026-08-12',
    'a full ISO date that is still clamped to today when in the future'
  );
}

console.log('--- patientIdFromOverview: same 4-way fallback as document-file-inline.js ---');
{
  check(
    patientIdFromOverview({ data: { patient: { id: 'p1' } } }) === 'p1',
    'data.data.patient.id (confirmed real shape for document tasks)'
  );
  check(patientIdFromOverview({ data: { patientId: 'p2' } }) === 'p2', 'data.data.patientId fallback');
  check(patientIdFromOverview({ patient: { id: 'p3' } }) === 'p3', 'data.patient.id fallback');
  check(patientIdFromOverview({ patientId: 'p4' }) === 'p4', 'data.patientId fallback');
  check(patientIdFromOverview({}) === null, 'no shape matches -> null');
  check(patientIdFromOverview(null) === null, 'null -> null, never throws');
}

console.log('--- extractInboundDocument / extractCodedNoteEntries: real capture shape ---');
{
  const realOverview = {
    data: {
      patient: { id: '01924260-6af1-73e5-a6da-3c1b058b28e8', displayName: 'Mrs Test Patient', deceased: false },
      inboundDocument: {
        id: '019f7f9f-e522-706f-bc63-2ed8f5f9ec45',
        typeLabel: 'Discharge letter',
        documentDate: null,
        recordDate: '2026-07-20',
        createdDate: '2026-07-20 14:03:33',
      },
      codesAndActions: [
        {
          code: 'Inflammatory bowel disease',
          id: '019ff7db-23df-7000-a11b-0087449ffe98',
          type: 'note',
          text: 'Inflammatory bowel disease',
          isMarkedIncorrect: false,
          isFinalised: false,
          disabled: false,
        },
        {
          code: 'Shared care prescribing',
          id: '019ff7db-54a5-7000-8c03-d5d49e9cbbbc',
          type: 'note',
          text: 'Shared care prescribing: Octasa',
          isMarkedIncorrect: false,
          isFinalised: false,
          disabled: false,
        },
        // A non-"note" codesAndActions entry (defensive fixture — never
        // observed live, but the shape is plausible from the options list)
        // must be excluded: no edit-note/change-note write path behind it.
        { code: 'Some allergy', id: 'allergy-1', type: 'allergy', text: 'Some allergy' },
        // A marked-incorrect / disabled note must also be excluded.
        {
          code: 'Struck through entry',
          id: 'struck-1',
          type: 'note',
          text: 'Struck through entry',
          isMarkedIncorrect: true,
        },
        { code: 'Disabled entry', id: 'disabled-1', type: 'note', text: 'Disabled entry', disabled: true },
        // A plain free-text note added via Medicus's own "Note" action (one
        // of codesAndActionsOptions) has no SNOMED code at all — confirmed
        // live 2026-08-13 this rendered as a blank-looking checkbox with no
        // label, and can't become a Problem anyway (create-problem requires
        // a non-null code). Must be excluded. `code` shape unconfirmed live
        // (empty string vs null vs omitted) — cover all three.
        { code: '', id: 'free-text-empty', type: 'note', text: 'Some free text with no code' },
        { code: null, id: 'free-text-null', type: 'note', text: 'Some free text with no code' },
        { id: 'free-text-omitted', type: 'note', text: 'Some free text with no code' },
      ],
    },
  };

  const doc = extractInboundDocument(realOverview);
  check(doc && doc.recordDate === '2026-07-20', 'extractInboundDocument reads data.inboundDocument');
  check(extractInboundDocument({}) === null, 'missing inboundDocument -> null');
  check(extractInboundDocument(null) === null, 'null overview -> null, never throws');

  const entries = extractCodedNoteEntries(realOverview);
  check(entries.length === 2, 'only the two real note-type, non-struck, non-disabled, CODED entries survive');
  check(
    entries.every((e) => e.id !== 'free-text-empty' && e.id !== 'free-text-null' && e.id !== 'free-text-omitted'),
    "free-text notes (no code, in any of the 3 plausible shapes) are excluded — they can't become a Problem"
  );
  check(entries[0].id === '019ff7db-23df-7000-a11b-0087449ffe98', 'first entry id matches the real capture');
  check(entries[0].code === 'Inflammatory bowel disease', 'first entry code matches the real capture');
  check(entries[1].text === 'Shared care prescribing: Octasa', 'second entry text preserves the note-text suffix');
  check(
    extractCodedNoteEntries({}) instanceof Array && extractCodedNoteEntries({}).length === 0,
    'no codesAndActions -> []'
  );
  check(extractCodedNoteEntries(null).length === 0, 'null overview -> [], never throws');
}

console.log('--- extractCodedNoteEntries: investigation overview with the same codesAndActions shape ---');
{
  const invOverview = {
    data: {
      patient: { id: 'p-inv-1', displayName: 'Mrs Elizabeth Avis' },
      investigationReport: {
        investigationGroups: [{ results: [{ specimenCollectionDate: '2026-07-28 00:00:00' }] }],
        ungroupedResults: [],
      },
      codesAndActions: [
        {
          code: 'Osteoarthritis of knee',
          id: 'note-oa-1',
          type: 'note',
          text: 'Osteoarthritis of knee',
          isMarkedIncorrect: false,
          disabled: false,
        },
        { code: 'Some observation', id: 'obs-1', type: 'observation', text: 'Some observation' },
      ],
    },
  };
  const invEntries = extractCodedNoteEntries(invOverview);
  check(invEntries.length === 1, 'investigation codesAndActions: only the note-type coded entry survives');
  check(invEntries[0].code === 'Osteoarthritis of knee', 'knee OA code is offered — the screenshot case');
  check(patientIdFromOverview(invOverview) === 'p-inv-1', 'patientIdFromOverview still reads data.patient.id on an investigation payload');
  check(extractInboundDocument(invOverview) === null, 'no inboundDocument on an investigation overview -> null');
  check(onsetDateSource(invOverview) === '2026-07-28', 'onsetDateSource reads the XR specimen date from the same payload');
}

console.log('--- derivePreviewText: "{code}: {noteText}" vs bare "{code}" ---');
{
  check(
    derivePreviewText({ code: 'Shared care prescribing', text: 'Shared care prescribing: Octasa' }) === 'Octasa',
    'strips the "{code}: " prefix to recover the free-text suffix'
  );
  check(
    derivePreviewText({ code: 'Inflammatory bowel disease', text: 'Inflammatory bowel disease' }) === null,
    'no colon-suffix -> null (no free text beyond the code itself)'
  );
  check(
    derivePreviewText({ code: 'X', text: 'X: contains: extra: colons' }) === 'contains: extra: colons',
    'only strips the FIRST "{code}: " prefix — further colons in the free text are preserved'
  );
  check(derivePreviewText({ code: '', text: '' }) === null, 'empty code/text -> null, never throws');
}

console.log('--- mergeActedState: a refresh must not un-convert an already-added row ---');
{
  const fresh = [
    { id: 'e1', code: 'Inflammatory bowel disease', text: 'Inflammatory bowel disease' },
    { id: 'e2', code: 'Shared care prescribing', text: 'Shared care prescribing: Octasa' },
    {
      id: 'e3',
      code: 'A brand-new code added since the last load',
      text: 'A brand-new code added since the last load',
    },
  ];
  const prior = [
    {
      id: 'e1',
      acted: true,
      appliedDescription: 'Inflammatory bowel disease',
      appliedOnsetDate: '2026-07-20',
      appliedEpisode: null,
    },
    { id: 'e2', acted: false, checked: true }, // was checked but not yet submitted — should NOT carry the checked flag across
  ];
  const merged = mergeActedState(fresh, prior);
  check(merged.length === 3, 'all 3 fresh entries survive the merge');
  check(merged[0].acted === true, 'e1 keeps its acted=true from the prior state');
  check(merged[0].appliedDescription === 'Inflammatory bowel disease', 'e1 keeps its appliedDescription');
  check(merged[0].appliedOnsetDate === '2026-07-20', 'e1 keeps its appliedOnsetDate');
  check(merged[0].checked === false, 'an acted row is never re-checked by a merge');
  check(merged[1].acted === false, 'e2 (not yet acted) starts fresh as acted=false');
  check(
    merged[1].checked === false,
    "e2's prior checked=true is NOT carried across — a refresh is a clean slate for unconverted rows"
  );
  check(merged[2].acted === false && merged[2].appliedDescription === null, 'a genuinely new entry (e3) starts blank');
  check(
    merged[1].existsWarning === null && merged[2].existsWarning === null,
    'a not-yet-acted entry starts with existsWarning: null (not yet checked) — a refresh never carries a stale flag across, it gets recomputed fresh'
  );
  check(
    merged[0].existsWarning === false,
    "an acted entry gets existsWarning: false, not null — no flag needed, it already shows as added (matches annotateExistingProblemFlags' own shape)"
  );
  check(mergeActedState([], []).length === 0, 'empty fresh list -> empty result');
  check(
    mergeActedState(fresh, []).every((e) => e.acted === false),
    'no prior entries at all -> everything starts fresh (first load)'
  );
  check(mergeActedState(null, null).length === 0, 'null inputs -> [], never throws');
}

console.log("--- problemAlreadyExists: mirrors Medicus's own checkProblemExists ---");
{
  const existingProblems = [
    {
      label: 'Ascaridiasis (Onset 01 Jan 2000)',
      value: { description: 'Ascaridiasis', descriptionId: '481892013', conceptId: '2435008' },
    },
    {
      label: 'Atrial fibrillation (Onset 07 Aug 2010)',
      value: { description: 'Atrial fibrillation', descriptionId: '82343012', conceptId: '49436004' },
    },
  ];
  check(problemAlreadyExists(existingProblems, '2435008') === true, 'exact conceptId match -> true');
  check(problemAlreadyExists(existingProblems, '24526004') === false, 'no match -> false');
  check(problemAlreadyExists(existingProblems, null) === false, 'null conceptId -> false, never throws');
  check(problemAlreadyExists(null, '2435008') === false, 'null existingProblems -> false, never throws');
  check(
    problemAlreadyExists([{ label: 'no value field' }], '2435008') === false,
    'malformed entry -> skipped, not thrown'
  );
}

console.log('--- annotateExistingProblemFlags: refresh-time "already a problem?" flag (2026-08-19 request) ---');
{
  const existingProblems = [
    { label: 'Ascaridiasis (Onset 01 Jan 2000)', value: { description: 'Ascaridiasis', conceptId: '2435008' } },
  ];
  const entries = [
    { id: 'e1', code: 'Ascaridiasis', acted: false },
    { id: 'e2', code: 'Atrial fibrillation', acted: false },
    { id: 'e3', code: 'Note fetch failed for this one', acted: false },
    { id: 'e4', code: 'Already added earlier', acted: true, appliedDescription: 'Already added earlier' },
  ];
  const noteDetailsById = {
    e1: { noteSNOMEDct: { conceptId: '2435008', description: 'Ascaridiasis' } },
    e2: { noteSNOMEDct: { conceptId: '49436004', description: 'Atrial fibrillation' } },
    e3: null, // per-entry note/edit-note fetch failed — fetchExistingProblemFlags stores null, never throws
  };
  const flagged = annotateExistingProblemFlags(entries, noteDetailsById, existingProblems);
  check(
    flagged.find((e) => e.id === 'e1').existsWarning === true,
    'a conceptId matching an existing problem is flagged true'
  );
  check(flagged.find((e) => e.id === 'e2').existsWarning === false, 'a conceptId with no match is flagged false');
  check(
    flagged.find((e) => e.id === 'e3').existsWarning === false,
    'a failed per-entry note-detail lookup (null) reads as false, never true or thrown — advance notice only, never a false positive'
  );
  check(
    flagged.find((e) => e.id === 'e4').existsWarning === false,
    'an already-acted entry always gets existsWarning: false — no flag needed, it already shows as added'
  );
  check(JSON.stringify(annotateExistingProblemFlags([], {}, [])) === '[]', 'empty entries -> [], never throws');
  check(JSON.stringify(annotateExistingProblemFlags(null, null, null)) === '[]', 'null inputs -> [], never throws');
  check(
    entries.find((e) => e.id === 'e1').existsWarning === undefined,
    'the input entries array is never mutated — same discipline as mergeActedState'
  );
}

console.log("--- isAllergyRelatedCode: mirrors Medicus's own checkIsAllergyRelated ---");
{
  const results = [{ label: 'Penicillin allergy' }, { label: 'Latex allergy' }];
  check(isAllergyRelatedCode('Penicillin allergy', results) === true, 'exact label match -> true');
  check(isAllergyRelatedCode('Inflammatory bowel disease', results) === false, 'no match -> false');
  check(isAllergyRelatedCode(null, results) === false, 'null description -> false, never throws');
  check(isAllergyRelatedCode('Penicillin allergy', null) === false, 'null results -> false, never throws');
}

console.log('--- buildCreateProblemPayload: matches the real POST /clinical/problem/create-problem capture ---');
{
  const payload = buildCreateProblemPayload({
    patientId: '01924260-6af1-73e5-a6da-3c1b058b28e8',
    code: { conceptId: '415522008', description: 'Shared care prescribing', descriptionId: '2534089011' },
    noteText: 'Octasa',
    onsetDate: null,
    recordDate: '2026-08-12',
    recordedByStaff: '0192351f-fd7f-725c-a267-2120c486b6be',
    isSubsequentEpisode: false,
  });
  check(payload.patientId === '01924260-6af1-73e5-a6da-3c1b058b28e8', 'patientId passed through');
  check(payload.problemCodeId === '415522008', 'problemCodeId from code.conceptId');
  check(payload.problemCodeDescription === 'Shared care prescribing', 'problemCodeDescription from code.description');
  check(payload.problemCodeDescriptionId === '2534089011', 'problemCodeDescriptionId from code.descriptionId');
  check(payload.significance === 'major', 'significance defaults to major, matching the real capture');
  check(payload.onsetDate === null, 'onsetDate passed through as given');
  check(
    payload.automaticallySetToEndedOnDate === null,
    'automaticallySetToEndedOnDate is always null (major-significance shape)'
  );
  check(payload.episode === null, 'episode is null when isSubsequentEpisode is falsy');
  check(
    payload.additionalInformation === 'Octasa',
    'additionalInformation from noteText — the "same information in" mapping'
  );
  check(payload.hiddenFromPatientFacingServices === false, 'hiddenFromPatientFacingServices defaults false');
  check(payload.confidentialFromThirdParties === false, 'confidentialFromThirdParties defaults false');
  check(payload.problemStatus === 'active', 'problemStatus defaults active');
  check(payload.recordDate === '2026-08-12', 'recordDate passed through (today, distinct from onsetDate)');
  check(payload.recordedByOrganisation === null, 'recordedByOrganisation always null — matches the real capture');
  check(payload.recordedByPractitioner === null, 'recordedByPractitioner always null — matches the real capture');
  check(payload.recordedByStaff === '0192351f-fd7f-725c-a267-2120c486b6be', 'recordedByStaff passed through');
  check(payload.contextId === null, 'contextId always null — no structural document link exists to set');
  check(payload.contextType === null, 'contextType always null — no structural document link exists to set');

  const withOnsetAndEpisode = buildCreateProblemPayload({
    patientId: 'p1',
    code: { conceptId: 'c1', description: 'D1', descriptionId: 'd1' },
    noteText: null,
    onsetDate: '2026-07-20',
    recordDate: '2026-08-12',
    recordedByStaff: 's1',
    isSubsequentEpisode: true,
  });
  check(
    withOnsetAndEpisode.onsetDate === '2026-07-20',
    'onsetDate carried through when provided (the document-date derivation)'
  );
  check(withOnsetAndEpisode.episode === 'subsequent', 'episode is "subsequent" when isSubsequentEpisode is truthy');
  check(
    withOnsetAndEpisode.additionalInformation === null,
    'null noteText -> null additionalInformation, never "null" string'
  );

  const emptyPayload = buildCreateProblemPayload({});
  check(emptyPayload.problemCodeId === undefined, 'missing code -> problemCodeId undefined, never throws');
  check(emptyPayload.patientId === undefined, 'missing patientId -> undefined, never throws');
  check(
    emptyPayload.contextId === null && emptyPayload.contextType === null,
    'context fields still null on an empty call'
  );
}

console.log('\n--- markSameBatchDuplicates: same-code entries within ONE submit batch (2026-08-19 review) ---');
{
  const rows = [
    { id: 'a', _resolvedCode: { conceptId: '111' } },
    { id: 'b', _resolvedCode: { conceptId: '222' } },
    { id: 'c', _resolvedCode: { conceptId: '111' } },
    { id: 'd', _resolvedCode: { conceptId: '111' } },
    { id: 'e', _resolvedCode: {} },
    { id: 'f' },
  ];
  markSameBatchDuplicates(rows);
  check(rows[0]._dupInBatch === false, 'first occurrence of a conceptId is NOT a duplicate');
  check(rows[1]._dupInBatch === false, 'a different conceptId is NOT a duplicate');
  check(
    rows[2]._dupInBatch === true && rows[3]._dupInBatch === true,
    'every occurrence AFTER the first of the same conceptId is flagged — both would otherwise write as fresh first-episode problems'
  );
  check(
    rows[4]._dupInBatch === undefined && rows[5]._dupInBatch === undefined,
    'rows without a resolved conceptId are left untouched, never throw'
  );
  check(JSON.stringify(markSameBatchDuplicates([])) === '[]', 'empty rows -> [], never throws');
  check(markSameBatchDuplicates(null) === null, 'null rows -> returned as-is, never throws');
}

console.log('\n--- panel placement: File document is not covered ---');
{
  check(isFileDocumentButtonLabel('File document') === true, 'File document matches');
  check(isFileDocumentButtonLabel('File') === true, 'File matches');
  check(isFileDocumentButtonLabel('Filed document') === true, 'Filed document matches');
  check(isFileDocumentButtonLabel('File this document') === true, 'File this document matches');
  check(isFileDocumentButtonLabel('Save as document') === true, 'Save as document (the document-file chip) matches');
  check(isFileDocumentButtonLabel('✓ Saved as document') === true, 'Saved as document chip matches');
  check(isFileDocumentButtonLabel('Document file') === true, 'Document file matches');
  check(isFileDocumentButtonLabel('File all normal') === false, 'lab-file "File all normal" is not this button');
  check(isFileDocumentButtonLabel('File results') === false, 'File results is not a document-file label');
  check(isFileDocumentButtonLabel('') === false, 'empty label is not a match');

  check(isFileResultsButtonLabel('File results') === true, 'File results matches (investigation filing footer)');
  check(isFileResultsButtonLabel('Filed results') === true, 'Filed results matches');
  check(isFileResultsButtonLabel('File result') === true, 'File result (singular) matches');
  check(isFileResultsButtonLabel('Review & file all normal') === true, 'lab-file ready-state label matches');
  check(isFileResultsButtonLabel('File all normal…') === true, 'lab-file confirm-state label matches');
  check(isFileResultsButtonLabel('File document') === false, 'File document is not a results-file label');
  check(isFileResultsButtonLabel('') === false, 'empty results label is not a match');
  check(isHostFileButtonLabel('File document') === true, 'host matcher covers File document');
  check(isHostFileButtonLabel('File results') === true, 'host matcher covers File results');
  check(isHostFileButtonLabel('Save as document') === true, 'host matcher covers Save as document');
  check(isHostFileButtonLabel('More actions') === false, 'More actions is not a File control');

  const vp = { width: 1280, height: 800 };
  const size = { width: 340, height: 280 };
  const def = defaultPanelPosition(size, vp, 20);
  check(def.top === 72, 'default dock is below the app header, not the bottom of the page');
  check(def.left === 1280 - 340 - 20, 'default dock is right-aligned with a 20px gutter');

  check(
    rectsOverlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 20, width: 10, height: 10 }, 8) === false,
    'separated rects do not overlap'
  );
  check(
    rectsOverlap({ left: 900, top: 700, width: 340, height: 80 }, { left: 1100, top: 740, width: 120, height: 36 }, 8) ===
      true,
    'bottom-right panel overlapping a File button is detected'
  );

  const fileBtn = { left: 1100, top: 740, width: 140, height: 36 };
  const overlapping = { left: 920, top: 520, width: 340, height: 280 };
  const nudged = nudgeClearOf(overlapping, [fileBtn], vp, 12);
  check(
    !rectsOverlap(
      { left: nudged.left, top: nudged.top, width: 340, height: 280 },
      fileBtn,
      12
    ),
    'nudge moves the panel off the File document button'
  );
  check(nudged.top < 740, 'nudge prefers staying off the bottom action, not dropping onto it');
}

console.log('\n--- overlay obstacles: the investigation "Code as" slideover must not be covered ---');
{
  const vp = { width: 1280, height: 800 };
  // The Code as slideover: full height, right-hand ~third of the viewport.
  const slideover = { left: 860, top: 0, width: 420, height: 800 };
  check(isBackdropRect(slideover, vp) === false, 'a right-hand slideover is a REAL obstacle, not a backdrop');
  check(
    isBackdropRect({ left: 0, top: 0, width: 1280, height: 800 }, vp) === true,
    'a full-viewport dialog wrapper/backdrop is skipped (or every dialog would shove the panel to the corner)'
  );
  check(
    isBackdropRect({ left: 0, top: 0, width: 1200, height: 780 }, vp) === true,
    'near-full-viewport (>=90% both axes) still reads as backdrop'
  );
  check(
    isBackdropRect({ left: 340, top: 150, width: 600, height: 500 }, vp) === false,
    'a centred modal card is a real obstacle'
  );
  check(isBackdropRect(null, vp) === true, 'null rect -> backdrop (never an obstacle), never throws');
  check(isBackdropRect({ left: 0, top: 0, width: 0, height: 0 }, vp) === true, 'zero-size rect -> never an obstacle');

  // The default top-right dock overlaps the slideover — the nudge must move
  // the panel clear of it (left of the slideover), not leave it covering the
  // Code as field.
  const dock = defaultPanelPosition({ width: 340, height: 280 }, vp, 20);
  check(
    rectsOverlap({ left: dock.left, top: dock.top, width: 340, height: 280 }, slideover, 12) === true,
    'sanity: the default top-right dock DOES overlap an open right-hand slideover'
  );
  const moved = nudgeClearOf({ left: dock.left, top: dock.top, width: 340, height: 280 }, [slideover], vp, 12);
  check(
    !rectsOverlap({ left: moved.left, top: moved.top, width: 340, height: 280 }, slideover, 12),
    'nudge moves the panel clear of the slideover — Code as field and its patient banner stay visible'
  );
  check(moved.left < slideover.left, 'panel lands to the LEFT of the slideover, still on screen');
}

console.log('\n--- wiring: draggable header, not a bottom-right cover ---');
{
  const js = fs.readFileSync(path.join(__dirname, 'content-scripts/document-codes-to-problems.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts/document-codes-to-problems.css'), 'utf8');
  check(/function enableDrag\(el\)/.test(js), 'enableDrag is wired');
  check(/POS_KEY = 'ms-dcp-pos'/.test(js), 'drag position is remembered');
  check(/ms-dcp-grip/.test(js) && /\.ms-dcp-grip \{/.test(css), 'header has a drag grip');
  check(/top:\s*72px/.test(css), 'CSS default is top-right (72px)');
  check(/bottom:\s*auto/.test(css), 'CSS default is bottom: auto, not pinned to the page foot');
  check(!/bottom:\s*20px/.test(css), 'CSS no longer uses bottom: 20px (that covered File document)');
  check(/\.ms-df-chip/.test(js), 'nudge treats the Save as document chip as an obstacle');
  check(/\.chlf-card/.test(js), 'nudge treats the lab-file card as an obstacle on investigation pages');
  check(
    /\[role="dialog"\], \[aria-modal="true"\]/.test(js),
    'nudge collects Medicus overlays (the Code as slideover) as obstacles — same selector family as task-inline.js'
  );
  check(/isBackdropRect\(ov\.getBoundingClientRect\(\), vp\)/.test(js), 'full-viewport dialog wrappers are skipped');
  check(
    /\/tasks\/data\/' \+ encodeURIComponent\(typeSlug\) \+ '\/overview\//.test(js),
    'overview fetch uses the live typeSlug, not a hardcoded document path'
  );
  check(
    !js.includes("apiFetch('/tasks/data/document/overview/"),
    'the v3.235.0 hardcoded /tasks/data/document/overview/ fetch is gone'
  );
  check(/isCodesToProblemsTaskSlug\(info\.typeSlug\)/.test(js), 'inject gate accepts document OR investigation slugs');
  check(!/info\.typeSlug !== 'document'/.test(js), 'inject/submit no longer hard-require typeSlug === document');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
