// Medicus Suite — problem-description-cleanup ("Fix description" for outdated
// SNOMED problem codes, plus the coding-specificity/laterality extension)
// tests
// Run with: node test-problem-description-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: detecting a legacy bracket/NOS-style description, stripping the
// legacy markers for a search query, filtering search results down to
// same-concept alternatives (the safety rule — never re-code to a different
// concept), building the full edit-problem POST payload (a full replace,
// not a partial patch — see docs/learnings-problem-description-cleanup.md),
// detecting a laterality hint in free text, and filtering search results down
// to genuine DESCENDANTS of the current concept matching that laterality (see
// shared/coding-specificity.js).

'use strict';

const {
  looksOutdated,
  stripLegacyMarkers,
  sameConceptAlternatives,
  buildEditProblemPayload,
  unwrapOptionValue,
  buildChangeNotePayload,
  apiErrorMessage,
  findOutdatedProblems,
  detectLateralityHint,
  descriptionAlreadySpecifiesLaterality,
  descendantAlternatives,
  crossConceptAlternatives,
  detectPathologyHint,
  detectAnatomicalSiteHint,
  ANATOMICAL_SITE_HINT_WORDS,
  descriptionAlreadyMentionsHint,
  hintExpandedAlternatives,
  significantWords,
  parseConceptRetirement,
  buildConceptUrl,
  recordPreference,
  resolvePreference,
  confirmedReplacementAlternative,
  confirmedReplacementAlternatives,
  groupCandidatesByConcept,
  normalizedSearchResults,
  findLegacyReadCodeOrigin,
  descendantSearchTargetConceptId,
  stripGenericAdditionalInfoLines,
  literalTextsFromEntries,
  patternEntriesFromEntries,
  findPatternMatch,
  removeMatchedSpan,
  severityCorrectionNeeded,
  computeAdditionalInfoFindings,
  stripAllKnownGenericText,
  codeQualityConcernExists,
  formatJournalDate,
  journalMatchDateLabel,
  resolveJournalSyncTargets,
} = require('./content-scripts/problem-description-cleanup.js');
const genericAdditionalInfoText = require('./rules/generic-additional-info-text.json');
const MSProblemTextLinking = require('./shared/problem-text-linking.js');
// computeAdditionalInfoFindings's linkSuggestion action reads
// window.MSProblemTextLinking at call time (browser classic-script global) —
// stubbed here so the matching logic is exercised for real rather than
// silently no-op'd because `window` doesn't exist in Node. Safe: this file's
// own browser-boot section (bottom of problem-description-cleanup.js) has
// already returned via `module.exports` above by the time this runs.
global.window = { MSProblemTextLinking: MSProblemTextLinking };

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

console.log('--- looksOutdated ---');
check(looksOutdated('[X]Attention deficit disorder') === true, '"[X]" prefix -> outdated');
check(looksOutdated('[D]Some old code') === true, '"[D]" prefix -> outdated');
check(looksOutdated('[M]Some old code') === true, '"[M]" prefix -> outdated');
check(looksOutdated('Fracture of radius NOS') === true, 'trailing "NOS" -> outdated');
check(looksOutdated('[X]Depression NOS') === true, 'both prefix AND suffix -> outdated');
check(looksOutdated('Diabetic complication NEC') === true, 'trailing "NEC" -> outdated');
check(looksOutdated('[X]Heroin addiction NEC') === true, 'both prefix AND "NEC" suffix -> outdated');
check(looksOutdated('Attention deficit disorder') === false, 'plain modern description -> not outdated');
check(looksOutdated('Nostalgia for the 90s') === false, '"Nos" mid-word never false-positives (word boundary)');
check(looksOutdated('Connect the dots') === false, '"NEC" mid-word never false-positives (word boundary)');
check(looksOutdated('') === false, 'empty string -> not outdated');
check(looksOutdated(null) === false, 'null -> not outdated, never throws');
check(looksOutdated(undefined) === false, 'undefined -> not outdated, never throws');
check(looksOutdated('H/O Stroke') === true, '"H/O " (space) prefix -> outdated (2026-07-25)');
check(looksOutdated('H/O: Stroke') === true, '"H/O: " (colon + space) prefix -> outdated (found live 2026-07-25)');
check(looksOutdated('H/O:Stroke') === true, '"H/O:" (colon, no following space) prefix -> outdated');
check(looksOutdated('h/o stroke') === true, '"h/o" prefix is case-insensitive');
check(looksOutdated('h/o:  Myocardial infarction') === true, '"h/o:" case-insensitive with extra space after colon');
check(
  looksOutdated('H/O  Myocardial infarction') === true,
  '"H/O " prefix with extra internal whitespace still matches'
);
check(looksOutdated('Historical stroke') === false, '"Historical" never false-positives as "H/O" (not the same token)');
check(
  looksOutdated('Something H/O else mid-string') === false,
  '"H/O" only recognised as a leading prefix, not mid-string'
);
check(
  looksOutdated('H/OStroke') === false,
  '"H/O" with no separator (no space, no colon) at all is NOT recognised — avoids guessing at an unseen shape'
);

console.log('--- stripLegacyMarkers ---');
check(stripLegacyMarkers('[X]Attention deficit disorder') === 'Attention deficit disorder', 'strips "[X]" prefix');
check(stripLegacyMarkers('Fracture of radius NOS') === 'Fracture of radius', 'strips trailing "NOS"');
check(stripLegacyMarkers('[X]Depression NOS') === 'Depression', 'strips BOTH prefix and suffix');
check(stripLegacyMarkers('Diabetic complication NEC') === 'Diabetic complication', 'strips trailing "NEC"');
check(stripLegacyMarkers('Attention deficit disorder') === 'Attention deficit disorder', 'no markers -> unchanged');
check(stripLegacyMarkers(null) === '', 'null -> empty string, never throws');
check(
  stripLegacyMarkers('Lower uterine segment caesarean section (LSCS) NEC') ===
    'Lower uterine segment caesarean section',
  'strips a trailing bracketed abbreviation ("(LSCS)") once the "NEC" suffix exposes it (real LSCS case, 2026-07-23)'
);
check(stripLegacyMarkers('H/O Stroke') === 'Stroke', 'strips "H/O " (space) prefix (2026-07-25)');
check(stripLegacyMarkers('H/O: Stroke') === 'Stroke', 'strips "H/O: " (colon + space) prefix');
check(stripLegacyMarkers('H/O:Stroke') === 'Stroke', 'strips "H/O:" (colon, no following space) prefix');
check(stripLegacyMarkers('h/o Myocardial infarction') === 'Myocardial infarction', 'strips "h/o" case-insensitively');

console.log('--- sameConceptAlternatives: the safety rule ---');
const searchResults = [
  {
    label: 'Attention deficit disorder',
    value: { description: 'Attention deficit disorder', conceptId: '35253001', descriptionId: '486108019' },
  },
  {
    label: 'ADD - Attention deficit disorder',
    value: { description: 'ADD - Attention deficit disorder', conceptId: '35253001', descriptionId: '486104017' },
  },
  {
    label: 'Attention deficit disorder without hyperactivity',
    value: {
      description: 'Attention deficit disorder without hyperactivity',
      conceptId: '35253001',
      descriptionId: '486107012',
    },
  },
  {
    label: 'Child attention deficit disorder',
    value: { description: 'Child attention deficit disorder', conceptId: '192127007', descriptionId: '295618015' },
  },
  {
    label: 'Adult attention deficit hyperactivity disorder',
    value: {
      description: 'Adult attention deficit hyperactivity disorder',
      conceptId: '444613000',
      descriptionId: null,
    },
  },
];
const alts = sameConceptAlternatives(searchResults, '35253001', '[X]Attention deficit disorder');
check(alts.length === 3, 'only the 3 results sharing the CURRENT conceptId survive (got ' + alts.length + ')');
check(
  alts.every((a) => a.conceptId === '35253001'),
  'every surviving alternative has the SAME conceptId — never a different concept'
);
check(
  !alts.some((a) => a.conceptId === '192127007' || a.conceptId === '444613000'),
  'different-concept results (child ADD, adult ADHD) are excluded, not just deprioritised'
);
check(
  sameConceptAlternatives(searchResults, '35253001', 'Attention deficit disorder').length === 2,
  'the alternative matching the CURRENT description text is excluded (nothing to offer)'
);
check(sameConceptAlternatives(searchResults, null, 'x').length === 0, 'null conceptId -> empty, never throws');
check(sameConceptAlternatives(null, '35253001', 'x').length === 0, 'null results -> empty, never throws');
check(
  sameConceptAlternatives(
    [{ value: { description: 'a', conceptId: '1' } }, { value: { description: 'b', conceptId: '1' } }],
    '1',
    'x'
  ).length === 2,
  'entries with no descriptionId are deduped by description text instead, not dropped'
);

console.log('--- buildEditProblemPayload: full replace, not a partial patch ---');
const prefill = {
  onsetDate: null,
  contextId: null,
  contextType: null,
  significance: 'major',
  episode: null,
  additionalInformation: 'adult ( provisional diagnosis )',
  hiddenFromPatientFacingServices: false,
  confidentialFromThirdParties: false,
  endDate: null,
  reasonEnded: null,
  recordDate: '2019-06-27',
  recordedAtAnotherOrganisation: true,
  recordedByOrganisation: {
    organisationName: 'The Park Road Surgery',
    organisationIdentifierType: null,
    organisationIdentifierValue: null,
  },
  recordedByPractitioner: 'Mrs Sarah Elliott',
  recordedByStaff: null,
  problemCode: {
    label: '[X]Attention deficit disorder',
    value: { conceptId: '35253001', description: '[X]Attention deficit disorder', descriptionId: null },
  },
};
const newCode = { description: 'Attention deficit disorder', conceptId: '35253001', descriptionId: '486108019' };
const payload = buildEditProblemPayload(prefill, newCode);
check(payload.problemCode === newCode, 'problemCode is swapped to the chosen alternative');
check(payload.significance === 'major', 'significance carried through unchanged');
check(
  payload.additionalInformation === 'adult ( provisional diagnosis )',
  'additionalInformation carried through unchanged'
);
check(payload.recordDate === '2019-06-27', 'recordDate carried through unchanged');
check(
  payload.recordedByOrganisation === prefill.recordedByOrganisation &&
    payload.recordedByPractitioner === 'Mrs Sarah Elliott',
  'recordedAtAnotherOrganisation=true -> sends recordedByOrganisation + recordedByPractitioner'
);
check(!('recordedByStaff' in payload), 'recordedAtAnotherOrganisation=true -> recordedByStaff NOT sent');

const localPrefill = Object.assign({}, prefill, {
  recordedAtAnotherOrganisation: false,
  recordedByStaff: 'staff-uuid-123',
});
const localPayload = buildEditProblemPayload(localPrefill, newCode);
check(
  localPayload.recordedByStaff === 'staff-uuid-123',
  'recordedAtAnotherOrganisation=false -> sends recordedByStaff'
);
check(
  !('recordedByOrganisation' in localPayload),
  'recordedAtAnotherOrganisation=false -> recordedByOrganisation NOT sent'
);
check(
  !('recordedByPractitioner' in localPayload),
  'recordedAtAnotherOrganisation=false -> recordedByPractitioner NOT sent'
);

const emptyPayload = buildEditProblemPayload(null, newCode);
check(
  emptyPayload.problemCode === newCode && emptyPayload.significance === null,
  'null prefill -> safe defaults, never throws'
);

console.log(
  '--- buildEditProblemPayload: unwraps a UI-select-shaped recordedByOrganisation (real 2026-07-26 400, author-less GP2GP import) ---'
);
{
  const wrappedOrgPrefill = Object.assign({}, prefill, {
    recordedByOrganisation: {
      label: 'Park Road Surgery',
      value: {
        organisationName: 'Park Road Surgery',
        organisationIdentifierType: 'nhs-england-ods-code',
        organisationIdentifierValue: 'H84002',
      },
    },
  });
  const wrappedPayload = buildEditProblemPayload(wrappedOrgPrefill, newCode);
  check(
    wrappedPayload.recordedByOrganisation.organisationName === 'Park Road Surgery' &&
      wrappedPayload.recordedByOrganisation.organisationIdentifierValue === 'H84002' &&
      !('label' in wrappedPayload.recordedByOrganisation) &&
      !('value' in wrappedPayload.recordedByOrganisation),
    'wrapped {label, value:{organisationName,...}} shape is unwrapped to the inner object'
  );
  check(
    payload.recordedByOrganisation.organisationName === 'The Park Road Surgery',
    'the ORIGINAL already-unwrapped shape (organisationName directly) still passes through unchanged'
  );
  const nullOrgPayload = buildEditProblemPayload(Object.assign({}, prefill, { recordedByOrganisation: null }), newCode);
  check(nullOrgPayload.recordedByOrganisation === null, 'null recordedByOrganisation -> null, never throws');
}

console.log('--- buildEditProblemPayload: overrideAdditionalInformation (2026-07-25 generic-text cleanup) ---');
{
  const originalCode = { conceptId: '359609001', description: 'Acute nonsupp. otitis media R', descriptionId: null };
  const payloadWithOverride = buildEditProblemPayload(prefill, originalCode, 'ear');
  check(
    payloadWithOverride.additionalInformation === 'ear',
    'overrideAdditionalInformation replaces the prefill value entirely (got "' +
      payloadWithOverride.additionalInformation +
      '")'
  );
  check(
    payloadWithOverride.problemCode === originalCode,
    'problemCode is passed through as given — this apply path changes additionalInformation, never the code'
  );
  check(
    buildEditProblemPayload(prefill, newCode).additionalInformation === 'adult ( provisional diagnosis )',
    'omitting the third argument entirely preserves the original 2-arg behaviour — every existing caller is unaffected'
  );
  check(
    buildEditProblemPayload(prefill, newCode, '').additionalInformation === '',
    'an explicit empty string override is respected (all generic lines removed, nothing left) — not treated as "no override"'
  );
}

console.log(
  '--- buildChangeNotePayload: POST /clinical/note/change-note (confirmed live via 3 HAR captures, 2026-08-13) ---'
);
{
  // Modelled on the real "editing additional details" capture — a note
  // nested inside a consultation (contextType present on the GET, but
  // confirmed NOT part of the POST body at all).
  const nestedNotePrefill = {
    noteId: '0192dcca-b742-7000-95f9-864602e9e715',
    note: 'classic visual symptoms with subsequent headache',
    noteSNOMEDct: { conceptId: '4473006', description: 'Migraine with aura', descriptionId: '7595017' },
    isDraft: false,
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    isMarkedAsIncorrect: false,
    allowEditLinkedProblems: false,
    patientId: '01924260-6af1-73e5-a6da-3c1b058b28e8',
    recordDate: '2024-10-30',
    recordedAtAnotherOrganisation: false,
    recordedByOrganisation: null,
    recordedByPractitioner: 'Dr Nicholas Grundy',
    recordedByStaff: '0192351f-fd7f-725c-a267-2120c486b6be',
    linkedProblemIds: [],
    linkableProblems: [{ value: 'p1', label: 'Something (2020 - )', conceptId: '999' }],
    contextType: 'consultation-topic-heading',
    contextId: '0192dcca-b267-72fc-934b-530318585171',
    flagOnPatientBanner: false,
    staff: [{ label: 'Someone', value: 'x' }],
    flags: [],
    linkedClinicalCase: { options: [], defaultClinicalCaseId: null, requiresClinicalCase: false },
  };
  const sameConceptRelabel = { description: 'Classical migraine', conceptId: '4473006', descriptionId: '7596016' };
  const payload = buildChangeNotePayload(nestedNotePrefill, sameConceptRelabel);

  check(
    JSON.stringify(payload) ===
      JSON.stringify({
        noteId: '0192dcca-b742-7000-95f9-864602e9e715',
        note: 'classic visual symptoms with subsequent headache',
        noteSNOMEDct: sameConceptRelabel,
        hiddenFromPatientFacingServices: false,
        confidentialFromThirdParties: false,
        flagOnPatientBanner: false,
        recordedByOrganisation: null,
        recordedByPractitioner: 'Dr Nicholas Grundy',
        recordedByStaff: '0192351f-fd7f-725c-a267-2120c486b6be',
        recordDate: '2024-10-30',
        flags: [],
        clinicalCaseId: null,
        linkedProblemIds: [],
      }),
    'exact field-for-field match against the real confirmed POST body shape'
  );
  check(
    !('contextType' in payload) && !('contextId' in payload) && !('patientId' in payload),
    'contextType/contextId/patientId are GET-only fields — confirmed NOT part of the POST (this is a writable-SUBSET replace, not a full round-trip)'
  );
  check(
    !('linkableProblems' in payload) && !('staff' in payload) && !('isDraft' in payload),
    'UI-only prefill fields (linkableProblems, staff, isDraft, …) are never resent'
  );

  const differentConceptCode = { description: 'Obesity', conceptId: '414916001', descriptionId: 'abc123' };
  check(
    buildChangeNotePayload(nestedNotePrefill, differentConceptCode).noteSNOMEDct === differentConceptCode,
    "newCode is passed through as-is, including a DIFFERENT conceptId — deliberately NOT constrained to a same-concept relabel the way buildEditProblemPayload is (this write syncs to the problem's current code, whatever it is)"
  );

  // Modelled on the real "orphan note" capture — no consultation context at
  // all (contextType/contextId both null on the GET).
  const orphanNotePrefill = Object.assign({}, nestedNotePrefill, {
    noteId: '01998559-2f40-7019-8e69-8a08408ac820',
    hiddenFromPatientFacingServices: true,
    allowEditLinkedProblems: true,
    contextType: null,
    contextId: null,
  });
  const orphanPayload = buildChangeNotePayload(orphanNotePrefill, sameConceptRelabel);
  check(
    orphanPayload.hiddenFromPatientFacingServices === true && !('contextType' in orphanPayload),
    'orphan note (no consultation) produces the IDENTICAL payload shape as the nested case — confirmed live, no special-casing needed'
  );

  console.log('--- buildChangeNotePayload: defensive against missing fields ---');
  check(
    JSON.stringify(buildChangeNotePayload(null, sameConceptRelabel).flags) === '[]',
    'null prefill -> [] flags, never throws'
  );
  check(
    buildChangeNotePayload({}, sameConceptRelabel).clinicalCaseId === null,
    'missing linkedClinicalCase -> clinicalCaseId null, never throws'
  );
  check(
    buildChangeNotePayload({ linkedClinicalCase: { defaultClinicalCaseId: 'case-1' } }, sameConceptRelabel)
      .clinicalCaseId === 'case-1',
    'clinicalCaseId derived from linkedClinicalCase.defaultClinicalCaseId when present'
  );
  check(
    JSON.stringify(buildChangeNotePayload({ linkedProblemIds: undefined }, sameConceptRelabel).linkedProblemIds) ===
      '[]',
    'missing linkedProblemIds -> [], never throws'
  );
}

console.log('--- findOutdatedProblems ---');
const summaryProblems = [
  { id: 'p1', problemCodeDescription: 'Attention deficit disorder' },
  { id: 'p2', problemCodeDescription: '[X]Depression NOS' },
  { id: 'p3', problemCodeDescription: 'Torticollis - symptom' },
  { id: 'p4', problemCodeDescription: 'Fracture of radius NOS' },
  { id: 'p5', problemCodeDescription: 'Glandular fever' },
  { id: 'p6', problemCodeDescription: 'H/O Stroke' },
];
const outdated = findOutdatedProblems(summaryProblems);
check(outdated.length === 3, 'flags exactly the 3 legacy-style entries (got ' + outdated.length + ')');
check(
  outdated.map((p) => p.id).join(',') === 'p2,p4,p6',
  'flags the right ones (p2 "[X]Depression NOS", p4 "Fracture of radius NOS", p6 "H/O Stroke")'
);
check(findOutdatedProblems(null).length === 0, 'null problems -> empty, never throws');
check(findOutdatedProblems([]).length === 0, 'empty problems -> empty');

console.log('--- detectLateralityHint ---');
check(detectLateralityHint('rt distal end') === 'right', '"rt" shorthand -> right');
check(detectLateralityHint('Right sided, provisional') === 'right', '"Right" word -> right');
check(detectLateralityHint('lt wrist') === 'left', '"lt" shorthand -> left');
check(detectLateralityHint('left-sided weakness') === 'left', '"left" word -> left');
check(detectLateralityHint('bilat symptoms') === 'bilateral', '"bilat" shorthand -> bilateral');
check(detectLateralityHint('bilateral involvement') === 'bilateral', '"bilateral" word -> bilateral');
check(detectLateralityHint('rt and lt') === null, 'both right AND left, no "bilateral" -> ambiguous, null');
check(detectLateralityHint('adult (provisional diagnosis)') === null, 'no laterality mention -> null');
check(detectLateralityHint('Nostalgia for the 90s') === null, '"lt"/"rt" never match mid-word (word boundary)');
check(detectLateralityHint('') === null, 'empty string -> null');
check(detectLateralityHint(null) === null, 'null -> null, never throws');
check(detectLateralityHint(undefined) === null, 'undefined -> null, never throws');

console.log('--- descriptionAlreadySpecifiesLaterality ---');
check(
  descriptionAlreadySpecifiesLaterality('Fracture of right radius', 'right') === true,
  'description already says "right" -> true'
);
check(
  descriptionAlreadySpecifiesLaterality('Fracture of radius', 'right') === false,
  'description has no laterality -> false'
);
check(
  descriptionAlreadySpecifiesLaterality('Fracture of left radius', 'right') === false,
  'description specifies the OTHER laterality -> false (still worth suggesting the correct one)'
);
check(descriptionAlreadySpecifiesLaterality(null, 'right') === false, 'null description -> false, never throws');
check(descriptionAlreadySpecifiesLaterality('Fracture of right radius', null) === false, 'null laterality -> false');

console.log('--- descendantAlternatives: the descendant safety rule ---');
// Real conceptIds/parentConceptIds from a live capture (2026-07-23) of
// GET .../search/description/constrained?...&outputParentConceptIds=1&query=fracture+of+radius
// against a real patient's "Fracture of radius NOS" problem (conceptId 12676007).
const CURRENT_CONCEPT_ID = '12676007'; // "Fracture of radius"
const lateralityResults = [
  {
    label: 'Fracture of radius',
    value: {
      description: 'Fracture of radius',
      conceptId: '12676007',
      descriptionId: '21770014',
      parentConceptIds: ['65966004', '429353004', '404684003'],
    },
  },
  {
    label: 'Fracture of right radius',
    value: {
      description: 'Fracture of right radius',
      conceptId: '446461000124103',
      descriptionId: '676041000124111',
      parentConceptIds: ['12676007', '1303391006', '65966004', '404684003'],
    },
  },
  {
    label: 'Fracture of left radius',
    value: {
      description: 'Fracture of left radius',
      conceptId: '12960001000004104',
      descriptionId: '676021000124116',
      parentConceptIds: ['12676007', '1303390007', '65966004', '404684003'],
    },
  },
  {
    // Real descendant (ancestry matches) but no laterality mentioned — must
    // be excluded from a "right" search: ancestry alone is not enough.
    label: 'Open fracture of radius',
    value: {
      description: 'Open fracture of radius',
      conceptId: '42945005',
      descriptionId: '71662011',
      parentConceptIds: ['91296001', '12676007', '65966004', '404684003'],
    },
  },
  {
    // Synthetic: matches the laterality TEXT but is NOT a real descendant
    // (no 12676007 in its ancestry) — proves text matching alone is not
    // enough either; this is the case that guarantees "never a lateral or
    // unrelated recode".
    label: 'Fracture of right femur',
    value: {
      description: 'Fracture of right femur',
      conceptId: '999999001',
      descriptionId: '999999011',
      parentConceptIds: ['71341001', '404684003'],
    },
  },
];
const rightDescendants = descendantAlternatives(lateralityResults, CURRENT_CONCEPT_ID, 'right');
check(
  rightDescendants.length === 1,
  'only the TRUE descendant matching "right" survives (got ' + rightDescendants.length + ')'
);
check(
  rightDescendants[0] && rightDescendants[0].conceptId === '446461000124103',
  'surfaces "Fracture of right radius", not the unrelated femur concept'
);
const leftDescendants = descendantAlternatives(lateralityResults, CURRENT_CONCEPT_ID, 'left');
check(
  leftDescendants.length === 1 && leftDescendants[0].conceptId === '12960001000004104',
  '"left" search surfaces "Fracture of left radius" only'
);
check(
  descendantAlternatives(lateralityResults, CURRENT_CONCEPT_ID, 'bilateral').length === 0,
  'no bilateral descendant present -> empty, not a false positive'
);
check(
  descendantAlternatives(lateralityResults, '999999001', 'right').length === 0,
  'a concept with no matching descendants in the list -> empty'
);
check(descendantAlternatives(null, CURRENT_CONCEPT_ID, 'right').length === 0, 'null results -> empty, never throws');
check(descendantAlternatives(lateralityResults, null, 'right').length === 0, 'null conceptId -> empty, never throws');
check(
  descendantAlternatives(lateralityResults, CURRENT_CONCEPT_ID, null).length === 0,
  'null laterality -> empty, never throws'
);

console.log('--- descendantAlternatives: word-mismatch regression (real "knee replacement NEC" case) ---');
// Real bug found live 2026-07-23: "Primary total knee replacement NEC"
// (609588000) returned ZERO raw search results for the query built from its
// own (stripped) legacy text — Medicus's search requires every query word
// present in a result, and the real modern descendants below don't contain
// "Primary" anywhere. The fix (in problem-description-cleanup.js's
// openPanel, not unit-testable — DOM/fetch-dependent) is to ALSO run a
// narrowed search (constrainingParentConcepts=<own conceptId>, query=<just
// the laterality word>) and concat its results in before filtering. This
// test proves descendantAlternatives correctly extracts the real candidates
// from that concat, using the ACTUAL captured response shape (two synonyms
// per concept, real parentConceptIds).
const KNEE_CONCEPT_ID = '609588000'; // "Primary total knee replacement NEC"
const kneeNarrowedResults = [
  {
    label: 'Total replacement of left knee joint',
    value: {
      description: 'Total replacement of left knee joint',
      conceptId: '443681002',
      descriptionId: '2839250012',
      parentConceptIds: ['609588000', '1240412000', '392238003', '71388002'],
    },
  },
  {
    label: 'Total prosthetic arthroplasty of left knee',
    value: {
      description: 'Total prosthetic arthroplasty of left knee',
      conceptId: '443681002',
      descriptionId: '2839249012',
      parentConceptIds: ['609588000', '1240412000', '392238003', '71388002'],
    },
  },
  {
    label: 'Total replacement of right knee joint',
    value: {
      description: 'Total replacement of right knee joint',
      conceptId: '443682009',
      descriptionId: '2839251011',
      parentConceptIds: ['609588000', '1240411007', '392238003', '71388002'],
    },
  },
  {
    label: 'Total prosthetic arthroplasty of right knee joint',
    value: {
      description: 'Total prosthetic arthroplasty of right knee joint',
      conceptId: '443682009',
      descriptionId: '5472683013',
      parentConceptIds: ['609588000', '1240411007', '392238003', '71388002'],
    },
  },
];
// The broad free-text query returned [] in real life (the whole point of
// this regression) — combinedResults is just [].concat(kneeNarrowedResults),
// mirroring exactly what openPanel now does.
const kneeCombined = [].concat(kneeNarrowedResults);
const kneeLeft = descendantAlternatives(kneeCombined, KNEE_CONCEPT_ID, 'left');
check(
  kneeLeft.length === 2 && kneeLeft.every((a) => a.conceptId === '443681002'),
  '"left" surfaces both synonyms of the left-knee descendant, none of the right (got ' + kneeLeft.length + ')'
);
const kneeRight = descendantAlternatives(kneeCombined, KNEE_CONCEPT_ID, 'right');
check(
  kneeRight.length === 2 && kneeRight.every((a) => a.conceptId === '443682009'),
  '"right" surfaces both synonyms of the right-knee descendant, none of the left (got ' + kneeRight.length + ')'
);

console.log('--- crossConceptAlternatives: cross-concept text match (flagged, not hierarchy-proven) ---');
// Real-world motivating example: "[X]Heroin addiction" (75544000) has no
// same-concept alternative — the modern term lives under a genuinely
// different concept, 231477003 "Heroin addiction". Structure mirrors the
// searchDescriptions() results shape used throughout this file.
const heroinResults = [
  {
    label: '[X]Heroin addiction',
    value: { description: '[X]Heroin addiction', conceptId: '75544000', descriptionId: null },
  },
  {
    // Different concept, IDENTICAL text once "[X]"/NOS/NEC markers are
    // stripped — this is the case crossConceptAlternatives exists for.
    label: 'Heroin addiction',
    value: { description: 'Heroin addiction', conceptId: '231477003', descriptionId: '486201013' },
  },
  {
    // Different concept, DIFFERENT text — proves this is an exact-text
    // match, not a fuzzy/clinical-relatedness match (this is the real
    // "Opioid dependence" case explicitly called out as OUT OF SCOPE).
    label: 'Heroin dependence',
    value: { description: 'Heroin dependence', conceptId: '65460005', descriptionId: '112233014' },
  },
];
const crossConcept = crossConceptAlternatives(heroinResults, '75544000', '[X]Heroin addiction');
check(
  crossConcept.length === 1,
  'only the exact-text DIFFERENT-concept match survives (got ' + crossConcept.length + ')'
);
check(
  crossConcept[0] && crossConcept[0].conceptId === '231477003',
  'surfaces "Heroin addiction" (231477003), not "Heroin dependence" (different text)'
);
check(
  crossConceptAlternatives(heroinResults, '75544000', '[X]Heroin addiction').every((a) => a.conceptId !== '75544000'),
  'never includes the CURRENT concept itself'
);
check(
  crossConceptAlternatives(
    [{ value: { description: 'Fracture of radius', conceptId: '1' } }],
    '2',
    'Fracture of radius NOS'
  ).length === 1,
  'case/whitespace-insensitive match against the stripped current description'
);
check(crossConceptAlternatives(null, '75544000', 'x').length === 0, 'null results -> empty, never throws');
check(crossConceptAlternatives(heroinResults, null, 'x').length === 0, 'null conceptId -> empty, never throws');
check(
  crossConceptAlternatives(heroinResults, '75544000', null).length === 0,
  'null current description -> empty, never throws'
);
check(
  crossConceptAlternatives(
    [
      {
        value: { description: 'Heroin addiction', conceptId: '231477003', descriptionId: null },
      },
      {
        value: { description: 'Heroin addiction', conceptId: '231477003', descriptionId: null },
      },
    ],
    '75544000',
    '[X]Heroin addiction'
  ).length === 1,
  'dedupes repeated identical results for the same concept'
);

console.log('--- crossConceptAlternatives: real "LSCS" retired-concept case (trailing-abbreviation strip) ---');
// Real capture (2026-07-23): 398307005 "Lower uterine segment caesarean
// section (LSCS) NEC" is a RETIRED SNOMED concept (confirmed via the SNOMED
// CT browser — no parents or children). Its real active replacement,
// 788180009, has a synonym worded EXACTLY like the current description once
// both the "NEC" suffix AND the trailing "(LSCS)" abbreviation are stripped.
const lscsResults = [
  {
    label: 'Lower uterine segment caesarean section',
    value: {
      description: 'Lower uterine segment caesarean section',
      conceptId: '788180009',
      descriptionId: '3779485018',
    },
  },
  {
    label: 'LSCS - lower segment caesarean section',
    value: {
      description: 'LSCS - lower segment caesarean section',
      conceptId: '788180009',
      descriptionId: '3779488016',
    },
  },
];
const lscsCrossConcept = crossConceptAlternatives(
  lscsResults,
  '398307005',
  'Lower uterine segment caesarean section (LSCS) NEC'
);
check(
  lscsCrossConcept.length === 1,
  'only the exact-text match survives once "(LSCS)" is stripped by stripLegacyMarkers upstream (got ' +
    lscsCrossConcept.length +
    ')'
);
check(
  lscsCrossConcept[0] && lscsCrossConcept[0].conceptId === '788180009',
  'surfaces 788180009, the real active replacement for the retired 398307005'
);

console.log('--- detectPathologyHint ---');
check(detectPathologyHint('-tear') === 'tear', '"-tear" shorthand -> "tear" (no leading-dash requirement)');
check(detectPathologyHint('query tear') === 'tear', '"tear" without a leading dash still matches');
check(detectPathologyHint('valvular disease suspected') === 'valvular', '"valvular" matches');
check(detectPathologyHint('possible sprain') === 'sprain', '"sprain" matches');
check(
  detectPathologyHint('tear. seen 2019, unrelated old note about sprain') === 'tear',
  'only the FIRST sentence/clause is scanned — a later "sprain" past the first "." is ignored'
);
check(detectPathologyHint('rt distal end') === null, 'laterality-only text -> null (no pathology word)');
check(detectPathologyHint('Nostalgia for the 90s') === null, 'no word-boundary false positive');
check(detectPathologyHint('') === null, 'empty string -> null');
check(detectPathologyHint(null) === null, 'null -> null, never throws');
check(detectPathologyHint(undefined) === null, 'undefined -> null, never throws');

console.log('--- descriptionAlreadyMentionsHint ---');
check(
  descriptionAlreadyMentionsHint('Rotator cuff tear', 'tear') === true,
  'description already mentions the hint word -> true'
);
check(
  descriptionAlreadyMentionsHint('Rotator cuff', 'tear') === false,
  'description does not mention the hint word -> false'
);
check(descriptionAlreadyMentionsHint(null, 'tear') === false, 'null description -> false, never throws');
check(descriptionAlreadyMentionsHint('Rotator cuff', null) === false, 'null hint word -> false');

console.log('--- hintExpandedAlternatives: real "[SO]Rotator cuff"/"-tear" case ---');
// Real conceptIds from a live capture (2026-07-23): 7885001 "[SO]Rotator
// cuff" is a SNOMED BODY STRUCTURE concept (confirmed separately via a
// constrainingParentConcepts=123037004 query), so it can never appear in
// this disorder-hierarchy search — that's the whole point of this category.
// This is the response shape from querying "Rotator cuff tear" (the base
// description + the "-tear" hint) against the disorder/procedure hierarchies.
const ROTATOR_CUFF_STRUCTURE_ID = '7885001';
const rotatorCuffTearResults = [
  {
    label: 'Rotator cuff tear',
    value: { description: 'Rotator cuff tear', conceptId: '926335004', descriptionId: null },
  },
  {
    label: 'Traumatic rotator cuff tear',
    value: { description: 'Traumatic rotator cuff tear', conceptId: '698299009', descriptionId: null },
  },
  {
    label: 'Rotator cuff repair',
    value: { description: 'Rotator cuff repair', conceptId: '56060000', descriptionId: null },
  },
];
const hintExpanded = hintExpandedAlternatives(rotatorCuffTearResults, ROTATOR_CUFF_STRUCTURE_ID, 'tear');
check(hintExpanded.length === 2, 'only results actually containing "tear" survive (got ' + hintExpanded.length + ')');
check(
  hintExpanded.some((a) => a.conceptId === '926335004'),
  'surfaces "Rotator cuff tear" (926335004), the real motivating target'
);
check(
  !hintExpanded.some((a) => a.conceptId === '56060000'),
  '"Rotator cuff repair" excluded — no "tear" in its description'
);
check(
  !hintExpanded.some((a) => a.conceptId === ROTATOR_CUFF_STRUCTURE_ID),
  'never includes the current (body-structure) concept itself'
);
check(
  hintExpandedAlternatives(null, ROTATOR_CUFF_STRUCTURE_ID, 'tear').length === 0,
  'null results -> empty, never throws'
);
check(
  hintExpandedAlternatives(rotatorCuffTearResults, null, 'tear').length === 0,
  'null conceptId -> empty, never throws'
);
check(
  hintExpandedAlternatives(rotatorCuffTearResults, ROTATOR_CUFF_STRUCTURE_ID, null).length === 0,
  'null hint word -> empty, never throws'
);

console.log('--- detectAnatomicalSiteHint (returns an ARRAY of every match, not just the first) ---');
// Real regression case (found live, 2026-07-26): "descending" precedes "colon" in
// ANATOMICAL_SITE_HINT_WORDS, so a single-match design (list-order-first, mirroring
// detectPathologyHint) picked "descending" and never tried "colon" — but the real
// target concept's own SNOMED wording is "...of colon", which never contains
// "descending" at all, so the one search that would have worked never ran. Every
// matched word must survive, in list order, so "colon" isn't shadowed.
const tubularAdenomaSiteHints = detectAnatomicalSiteHint('Descending colon and sigmoid colon - removed.');
check(
  tubularAdenomaSiteHints.includes('descending') &&
    tubularAdenomaSiteHints.includes('sigmoid') &&
    tubularAdenomaSiteHints.includes('colon'),
  'finds ALL THREE site words ("descending", "sigmoid", "colon"), not just the first by list order (got ' +
    JSON.stringify(tubularAdenomaSiteHints) +
    ')'
);
check(detectAnatomicalSiteHint('sigmoid colon polyp').includes('sigmoid'), 'finds "sigmoid"');
check(detectAnatomicalSiteHint('resection of caecum').includes('caecum'), 'British spelling "caecum" matches');
check(detectAnatomicalSiteHint('resection of cecum').includes('cecum'), 'American spelling "cecum" also matches');
check(
  !detectAnatomicalSiteHint('colon. seen later, unrelated note about sigmoid').includes('sigmoid'),
  'only the FIRST sentence/clause is scanned, same discipline as detectPathologyHint — a later "sigmoid" past the first "." is ignored'
);
check(detectAnatomicalSiteHint('rt distal end').length === 0, 'laterality-only text -> empty array (no site word)');
check(detectAnatomicalSiteHint('').length === 0, 'empty string -> empty array');
check(detectAnatomicalSiteHint(null).length === 0, 'null -> empty array, never throws');
check(detectAnatomicalSiteHint(undefined).length === 0, 'undefined -> empty array, never throws');
check(
  Array.isArray(ANATOMICAL_SITE_HINT_WORDS) && ANATOMICAL_SITE_HINT_WORDS.length > 0,
  'word list is exported and non-empty'
);

console.log('--- hintExpandedAlternatives: array hintWords (real "[M]Tubular adenoma NOS"/colon case, 2026-07-26) ---');
// Real conceptIds (live-verified via the public NHS termbrowser API, 2026-07-26):
// 443897009 "[M]Tubular adenoma NOS" is a RETIRED morphologic-abnormality-axis
// concept (REPLACED BY 1156654007, also morphology-axis) with NO IS-A path to
// the disorder-axis "Tubular adenoma of colon" family — so descendantAlternatives'
// hierarchy proof can never reach 444898006 "Tubular adenomatous polyp of colon".
// This is the response shape from querying "Tubular adenoma colon" (base
// description + the "colon" site hint).
const TUBULAR_ADENOMA_RETIRED_ID = '443897009';
const tubularAdenomaColonResults = [
  {
    label: 'Tubular adenomatous polyp of colon',
    value: { description: 'Tubular adenomatous polyp of colon', conceptId: '444898006', descriptionId: null },
  },
  {
    label: 'Tubular adenoma',
    value: { description: 'Tubular adenoma', conceptId: '444408007', descriptionId: null },
  },
];
const tubularHintExpanded = hintExpandedAlternatives(tubularAdenomaColonResults, TUBULAR_ADENOMA_RETIRED_ID, [
  'colon',
  'sigmoid',
]);
check(
  tubularHintExpanded.some((a) => a.conceptId === '444898006'),
  'surfaces 444898006 (matches "colon", one of two hint words) even though "sigmoid" never matched anything'
);
check(
  !tubularHintExpanded.some((a) => a.conceptId === '444408007'),
  '"Tubular adenoma" (444408007) excluded — its own description contains neither "colon" nor "sigmoid"'
);
check(
  hintExpandedAlternatives(rotatorCuffTearResults, ROTATOR_CUFF_STRUCTURE_ID, ['tear']).length === 2,
  'array form with ONE word still matches the original single-string behaviour'
);
check(
  hintExpandedAlternatives(rotatorCuffTearResults, ROTATOR_CUFF_STRUCTURE_ID, []).length === 0,
  'empty array -> empty, never throws'
);
check(
  hintExpandedAlternatives(rotatorCuffTearResults, ROTATOR_CUFF_STRUCTURE_ID, [null, undefined]).length === 0,
  'array of only null/undefined -> empty (filtered out), never throws'
);

console.log('--- significantWords ---');
check(
  significantWords('resection of uterine fibroid.').join(',') === 'resection,uterine,fibroid',
  'strips stop-words ("of"), keeps content words in order (got ' +
    significantWords('resection of uterine fibroid.') +
    ')'
);
check(
  significantWords('laparoscopy, laparoscopic myomectomy.').join(',') === 'laparoscopy,laparoscopic,myomectomy',
  'punctuation is not a word boundary problem'
);
check(
  significantWords('& resection of fibroid.').join(',') === 'resection,fibroid',
  '"&" and short/stop words excluded'
);
check(
  significantWords('tear. seen 2019, unrelated note about fibroid').join(',') ===
    'tear,seen,unrelated,note,about,fibroid',
  'scans the WHOLE field, not just the first clause — words after the "." are included too (fixed 2026-07-23 regression)'
);
check(
  significantWords('& laparoscopy. resection of fibroid.').join(',') === 'laparoscopy,resection,fibroid',
  'real regression case: "resection of fibroid" (the clinically relevant part) is in the SECOND sentence and must not be dropped'
);
check(significantWords('').length === 0, 'empty string -> empty array');
check(significantWords(null).length === 0, 'null -> empty array, never throws');
check(significantWords(undefined).length === 0, 'undefined -> empty array, never throws');
check(
  significantWords('rt distal end').join(',') === 'distal,end',
  '2-letter words ("rt") are excluded by the length>=3 floor, not treated as stop-words'
);

console.log(
  '--- descendantAlternatives: GENERALISED to arbitrary hint words (real "Hysteroscopy NEC"/"fibroid" case) ---'
);
// Real conceptIds from a live capture (2026-07-23): 233545006 "Hysteroscopy
// NEC" has additionalInformation like "resection of uterine fibroid" and a
// confirmed genuine descendant, 84064003 "Hysteroscopy with removal of
// uterine fibroid" (three synonyms captured, all sharing 233545006 in their
// parentConceptIds).
const HYSTEROSCOPY_CONCEPT_ID = '233545006';
const fibroidResults = [
  {
    label: 'Hysteroscopy with removal of uterine myoma',
    value: {
      description: 'Hysteroscopy with removal of uterine myoma',
      conceptId: '84064003',
      descriptionId: '5498827013',
      parentConceptIds: ['233545006', '71388002'],
    },
  },
  {
    label: 'Hysteroscopy with removal of uterine fibroid',
    value: {
      description: 'Hysteroscopy with removal of uterine fibroid',
      conceptId: '84064003',
      descriptionId: '5498828015',
      parentConceptIds: ['233545006', '71388002'],
    },
  },
  {
    // Real descendant (ancestry matches) but doesn't mention "fibroid" — must
    // be excluded from a "fibroid"-only search: ancestry alone isn't enough.
    label: 'Hysteroscopic myomectomy',
    value: {
      description: 'Hysteroscopic myomectomy',
      conceptId: '1290534002',
      descriptionId: '9999999001',
      parentConceptIds: ['233545006', '71388002'],
    },
  },
  {
    // Matches the word "fibroid" but is NOT a real descendant (no 233545006
    // in its ancestry) — proves text matching alone is not enough either.
    label: 'Uterine fibroid',
    value: {
      description: 'Uterine fibroid',
      conceptId: '95315005',
      descriptionId: '9999999002',
      parentConceptIds: ['64572001'],
    },
  },
];
const fibroidDescendants = descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, [
  'resection',
  'uterine',
  'fibroid',
]);
check(
  fibroidDescendants.length === 2,
  'only the true descendants mentioning one of the hint words survive (got ' + fibroidDescendants.length + ')'
);
check(
  fibroidDescendants.every((a) => a.conceptId === '84064003'),
  'both surfaced synonyms belong to 84064003, the real motivating target'
);
check(
  !fibroidDescendants.some((a) => a.conceptId === '95315005'),
  '"Uterine fibroid" (text match, no ancestry) excluded'
);
check(
  !fibroidDescendants.some((a) => a.conceptId === '1290534002'),
  '"Hysteroscopic myomectomy" (real descendant, no "fibroid" text) excluded — this is an accepted scope limit, not a bug'
);
check(
  descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, 'fibroid').length === 1,
  'a single string still works exactly as before — backward compatible with the laterality call shape (only the synonym literally saying "fibroid" matches, not the "myoma" one)'
);
check(
  descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, []).length === 0,
  'empty hint-word array -> empty, never throws'
);
check(
  descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, null).length === 0,
  'null hint words -> empty, never throws (still matches the original single-arg contract)'
);

console.log('--- descendantAlternatives: matchScore ranking (not just filtering) ---');
// Same fibroidResults/hint words as above: "...removal of uterine fibroid"
// matches 2 of 3 hint words (uterine, fibroid) = 67%; "...removal of uterine
// myoma" matches only 1 of 3 (uterine) = 33%.
const scored = descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, ['resection', 'uterine', 'fibroid']);
check(
  scored[0] && scored[0].description === 'Hysteroscopy with removal of uterine fibroid' && scored[0].matchScore === 67,
  'the 2-of-3-word match ("fibroid" synonym, 67%) is ranked FIRST (got ' +
    (scored[0] && scored[0].matchScore) +
    '%, "' +
    (scored[0] && scored[0].description) +
    '")'
);
check(
  scored[1] && scored[1].description === 'Hysteroscopy with removal of uterine myoma' && scored[1].matchScore === 33,
  'the 1-of-3-word match ("myoma" synonym, 33%) is ranked SECOND (got ' +
    (scored[1] && scored[1].matchScore) +
    '%, "' +
    (scored[1] && scored[1].description) +
    '")'
);
check(
  descendantAlternatives(fibroidResults, HYSTEROSCOPY_CONCEPT_ID, 'fibroid')[0].matchScore === 100,
  'a single matching hint word -> 100% (only one word to match, and it matched)'
);

console.log('--- confirmedReplacementAlternative: SNOMED-confirmed replacement, matched by conceptId only ---');
{
  const results = [
    {
      label: 'Lower uterine segment cesarean section',
      value: { description: 'Lower uterine segment cesarean section', conceptId: '788180009', descriptionId: '999' },
    },
    { label: 'Something else', value: { description: 'Something else', conceptId: '111', descriptionId: '222' } },
  ];
  check(
    confirmedReplacementAlternative(results, '788180009').conceptId === '788180009',
    'finds the result matching the confirmed replacement conceptId'
  );
  check(
    confirmedReplacementAlternative(results, '788180009').description === 'Lower uterine segment cesarean section',
    'description passed through from the matching result'
  );
  check(
    confirmedReplacementAlternative(results, '788180009').descriptionId === '999',
    'descriptionId passed through — this is what makes it POST-able to Medicus, unlike raw termbrowser data'
  );
  check(
    confirmedReplacementAlternative(results, '999999999') === null,
    "replacement conceptId not present in Medicus's own search results -> null, never guessed"
  );
  check(confirmedReplacementAlternative([], '788180009') === null, 'empty results -> null');
  check(confirmedReplacementAlternative(null, '788180009') === null, 'null results -> null, never throws');
  check(confirmedReplacementAlternative(results, null) === null, 'null replacementConceptId -> null, never throws');
  check(
    confirmedReplacementAlternative([{ conceptId: '788180009' }], '788180009') === null,
    'a result with no `value` wrapper is not matched (this is not the sameConceptAlternatives shape) — defensive, not a crash'
  );
}

console.log(
  '--- confirmedReplacementAlternatives (plural): returns EVERY synonym, not just the first (real 2026-07-28 "Pompholyx of hand"/"Chiropompholyx" case) ---'
);
{
  // Real live-confirmed shape: 402222007 "Pompholyx of hand" ALSO carries
  // the synonym "Chiropompholyx" — confirmedReplacementAlternative (singular)
  // would have arbitrarily returned whichever of these came first in Medicus's
  // own bare-SCTID search response; confirmedReplacementAlternatives must
  // keep BOTH.
  const pompholyxResults = [
    { label: 'Chiropompholyx', value: { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' } },
    {
      label: 'Pompholyx of hand',
      value: { description: 'Pompholyx of hand', conceptId: '402222007', descriptionId: '2' },
    },
    { label: 'Something else', value: { description: 'Something else', conceptId: '111', descriptionId: '3' } },
  ];
  const matches = confirmedReplacementAlternatives(pompholyxResults, '402222007');
  check(matches.length === 2, 'BOTH synonyms of the target concept are kept (got ' + matches.length + ')');
  check(
    matches.some((m) => m.description === 'Chiropompholyx' && m.descriptionId === '1'),
    'the eponymous synonym is present'
  );
  check(
    matches.some((m) => m.description === 'Pompholyx of hand' && m.descriptionId === '2'),
    'the plain-English synonym is ALSO present, not silently dropped'
  );
  check(
    !matches.some((m) => m.conceptId === '111'),
    'a result for a DIFFERENT concept is excluded, same discipline as the singular function'
  );
  check(confirmedReplacementAlternatives([], '402222007').length === 0, 'empty results -> empty array, never throws');
  check(confirmedReplacementAlternatives(null, '402222007').length === 0, 'null results -> empty array, never throws');
  check(
    confirmedReplacementAlternatives(pompholyxResults, null).length === 0,
    'null replacementConceptId -> empty array, never throws'
  );
  const dupedResults = [
    { label: 'Chiropompholyx', value: { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' } },
    { label: 'Chiropompholyx', value: { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' } },
  ];
  check(
    confirmedReplacementAlternatives(dupedResults, '402222007').length === 1,
    'the same descriptionId referenced twice is deduped, not listed twice'
  );
}

console.log(
  '--- groupCandidatesByConcept: one group per SNOMED code, not one per synonym (2026-07-28 user request) ---'
);
{
  // Real shape: 402222007 "Pompholyx of hand" has two synonyms; 201201000
  // "Pompholyx of foot" has one. Should collapse to exactly 2 groups, not 3
  // separate lozenges.
  const items = [
    { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' },
    { description: 'Pompholyx of hand', conceptId: '402222007', descriptionId: '2' },
    { description: 'Podopompholyx', conceptId: '201201000', descriptionId: '3' },
  ];
  const groups = groupCandidatesByConcept(items);
  check(groups.length === 2, 'one group per DISTINCT conceptId (got ' + groups.length + ')');
  check(groups[0].conceptId === '402222007', 'first group is the first-seen conceptId, order preserved');
  check(groups[0].options.length === 2, 'the hand group keeps BOTH synonyms (got ' + groups[0].options.length + ')');
  check(
    groups[0].options.some((o) => o.description === 'Chiropompholyx') &&
      groups[0].options.some((o) => o.description === 'Pompholyx of hand'),
    'both wordings are present, neither silently dropped'
  );
  check(groups[1].conceptId === '201201000', 'second group is the foot concept');
  check(groups[1].options.length === 1, 'the foot group has exactly its one synonym');
  check(groups[0].bestScore === null, 'no matchScore field on the input -> bestScore stays null');

  const dupedOptionItems = [
    { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' },
    { description: 'Chiropompholyx', conceptId: '402222007', descriptionId: '1' },
  ];
  check(
    groupCandidatesByConcept(dupedOptionItems)[0].options.length === 1,
    'the same descriptionId within one group is deduped, not listed twice'
  );

  const noDescriptionIdItems = [
    { description: 'Same text', conceptId: '999', descriptionId: null },
    { description: 'Same text', conceptId: '999', descriptionId: null },
    { description: 'Different text', conceptId: '999', descriptionId: null },
  ];
  const noIdGroups = groupCandidatesByConcept(noDescriptionIdItems);
  check(
    noIdGroups[0].options.length === 2,
    'entries with no descriptionId are deduped by description text instead (got ' + noIdGroups[0].options.length + ')'
  );

  const scoredItems = [
    { description: 'Fracture of right radius', conceptId: '1', descriptionId: 'a', matchScore: 50 },
    { description: 'Fracture of distal radius, right side', conceptId: '1', descriptionId: 'b', matchScore: 100 },
    { description: 'Fracture of left radius', conceptId: '2', descriptionId: 'c', matchScore: 20 },
  ];
  const scoredGroups = groupCandidatesByConcept(scoredItems);
  check(
    scoredGroups[0].conceptId === '1' && scoredGroups[0].bestScore === 100,
    "a group's bestScore is the MAX across its own synonyms, not the first one seen (got " +
      (scoredGroups[0] && scoredGroups[0].bestScore) +
      ')'
  );
  check(
    scoredGroups[0].bestScore >= scoredGroups[1].bestScore,
    'groups are re-sorted by bestScore descending once any group carries a score'
  );

  check(groupCandidatesByConcept([]).length === 0, 'empty input -> empty array');
  check(groupCandidatesByConcept(null).length === 0, 'null input -> empty array, never throws');
  check(
    groupCandidatesByConcept([null, { description: 'x' }, { conceptId: '1', description: 'y', descriptionId: 'd' }])
      .length === 1,
    'entries with no conceptId (or null entries) are skipped, not crashed on'
  );
}

console.log('--- re-exported shared/snomed-retirement.js functions work through this file too ---');
{
  const retired = parseConceptRetirement({ active: false, memberships: [] });
  check(retired.active === false, 'parseConceptRetirement is re-exported and callable');
  const url = buildConceptUrl(
    { baseUrl: 'https://termbrowser.nhs.uk/sct-browser-api/snomed', edition: 'uk-edition', release: 'v1' },
    '123'
  );
  check(
    url === 'https://termbrowser.nhs.uk/sct-browser-api/snomed/uk-edition/v1/concepts/123',
    'buildConceptUrl is re-exported and callable'
  );
  check(
    Array.isArray(retired.possiblyEquivalentTo),
    'parseConceptRetirement re-export also carries possiblyEquivalentTo (full coverage in test-snomed-retirement.js)'
  );
  check(
    Array.isArray(retired.partiallyEquivalentTo),
    'parseConceptRetirement re-export also carries partiallyEquivalentTo (full coverage in test-snomed-retirement.js)'
  );
}

console.log('--- re-exported shared/preferred-descriptions.js functions work through this file too ---');
{
  const entry = recordPreference(
    null,
    'd1',
    { description: 'Fracture of radius', descriptionId: 'd1' },
    '2026-07-28T10:00:00Z'
  );
  check(entry.tally.d1.count === 1, 'recordPreference is re-exported and callable');
  const resolved = resolvePreference(entry);
  check(
    resolved && resolved.key === 'd1',
    'resolvePreference is re-exported and callable (full coverage in test-preferred-descriptions.js)'
  );
}

console.log('--- normalizedSearchResults: unfiltered manual-search results, deduped ---');
{
  const results = [
    { label: 'UTI', value: { description: 'Urinary tract infection', conceptId: '68566005', descriptionId: '111' } },
    {
      label: 'UTIs',
      value: { description: 'Urinary tract infectious disease', conceptId: '431956005', descriptionId: '222' },
    },
    // Duplicate descriptionId — should be deduped, not doubled.
    {
      label: 'UTI dup',
      value: { description: 'Urinary tract infection', conceptId: '68566005', descriptionId: '111' },
    },
  ];
  const normalized = normalizedSearchResults(results);
  check(normalized.length === 2, 'duplicate descriptionId deduped (got ' + normalized.length + ')');
  check(
    normalized.some((a) => a.conceptId === '68566005') && normalized.some((a) => a.conceptId === '431956005'),
    'spans MULTIPLE different concepts — deliberately unfiltered, unlike every other alternatives function here'
  );
  check(
    normalizedSearchResults([
      { value: { conceptId: '1', description: 'a' } },
      { value: { conceptId: '1', description: 'a' } },
    ]).length === 1,
    'entries with no descriptionId are deduped by conceptId+description instead, not doubled'
  );
  check(
    normalizedSearchResults([{ value: { description: 'no concept id' } }]).length === 0,
    'a result with no conceptId is skipped'
  );
  check(normalizedSearchResults([]).length === 0, 'empty results -> empty');
  check(normalizedSearchResults(null).length === 0, 'null results -> empty, never throws');
}

console.log('--- findLegacyReadCodeOrigin: structural Read-code-origin detection (real 2026-07-25 example) ---');
{
  // Real capture: 359609001 "Acute nonsupp. otitis media R", originally
  // Read v2 F510.00 "Acute non suppurative otitis media" — the concept can
  // be perfectly current/active; this detects the LEGACY TEXT origin, not
  // retirement.
  const originalCodes = [{ codeSystem: 'read-v2', code: 'F510.00', description: 'Acute non suppurative otitis media' }];
  const result = findLegacyReadCodeOrigin(originalCodes);
  check(!!result, 'a read-v2 originalCodes entry is detected');
  check(result.code === 'F510.00', 'the original Read code is passed through');
  check(result.description === 'Acute non suppurative otitis media', 'the original Read description is passed through');
  check(
    findLegacyReadCodeOrigin([{ codeSystem: 'snomed-ct', code: '123', description: 'x' }]) === null,
    'a NON-read-v2 codeSystem is not flagged — only the confirmed "read-v2" value is recognised'
  );
  check(findLegacyReadCodeOrigin([]) === null, 'empty originalCodes -> null');
  check(findLegacyReadCodeOrigin(null) === null, 'null originalCodes -> null, never throws');
  check(findLegacyReadCodeOrigin(undefined) === null, 'undefined originalCodes -> null, never throws');
  check(
    findLegacyReadCodeOrigin([
      { codeSystem: 'ctv3', code: 'x', description: 'y' },
      { codeSystem: 'read-v2', code: 'F510.00', description: 'Acute non suppurative otitis media' },
    ]).code === 'F510.00',
    'finds the read-v2 entry even when it is not the first item in the array'
  );
}

console.log(
  '--- descendantSearchTargetConceptId: retired-concept pivot to the confirmed replacement (2026-07-29, 179304004 investigation) ---'
);
{
  check(
    descendantSearchTargetConceptId({ replacement: { conceptId: '307815000' } }, '179304004') === '307815000',
    "a confirmed replacement is preferred over the problem's own (retired) conceptId"
  );
  check(
    descendantSearchTargetConceptId(null, '179304004') === '179304004',
    "no retiredInfo at all (active concept, or never scanned) -> falls back to the problem's own conceptId"
  );
  check(
    descendantSearchTargetConceptId({ replacement: null }, '179304004') === '179304004',
    "retired with NO confirmed replacement -> falls back to the problem's own conceptId, same as before this fix"
  );
  check(
    descendantSearchTargetConceptId({}, '179304004') === '179304004',
    'retiredInfo present but no `replacement` key at all -> falls back, never throws'
  );
  check(
    descendantSearchTargetConceptId({ replacement: { conceptId: '307815000' } }, null) === '307815000',
    'a confirmed replacement is used even if currentConceptId is somehow missing'
  );
  check(descendantSearchTargetConceptId(null, null) === null, 'nothing at all to fall back to -> null, never throws');
}

console.log('--- rules/generic-additional-info-text.json: the imported list itself ---');
{
  check(Array.isArray(genericAdditionalInfoText.entries), 'entries is an array');
  check(genericAdditionalInfoText.entries.length > 0, 'at least one entry is configured');
  check(
    genericAdditionalInfoText.entries.some((e) => e.text === 'Active Problem, Significant'),
    '"Active Problem, Significant" is present (added 2026-07-25)'
  );
  check(
    genericAdditionalInfoText.entries.some((e) => e.text === 'Active Problem, Not Significant (Minor)'),
    '"Active Problem, Not Significant (Minor)" is present (added 2026-07-29)'
  );
  check(
    genericAdditionalInfoText.entries.some((e) => e.text === 'Unspecified Significance: Defaulted to Minor'),
    '"Unspecified Significance: Defaulted to Minor" is present (added 2026-07-26)'
  );
  check(
    genericAdditionalInfoText.entries.some((e) => e.text === 'Problem severity: Minor'),
    '"Problem severity: Minor" is present (added 2026-07-26)'
  );
}

console.log('--- stripGenericAdditionalInfoLines: real 2026-07-26 example (Read-v2 "Infantile eczema" problem) ---');
{
  const genericTexts = literalTextsFromEntries(genericAdditionalInfoText.entries);
  const result = stripGenericAdditionalInfoLines(
    'Unspecified Significance: Defaulted to Minor\nProblem severity: Minor',
    genericTexts
  );
  check(result.cleaned === '', 'both lines are pure boilerplate -> cleaned is empty');
  check(
    result.removed.length === 2 &&
      result.removed.includes('Unspecified Significance: Defaulted to Minor') &&
      result.removed.includes('Problem severity: Minor'),
    'both generic lines are reported as removed (got ' + JSON.stringify(result.removed) + ')'
  );
}

console.log('--- stripGenericAdditionalInfoLines: real 2026-07-25 example ("ear\\nActive Problem, Significant") ---');
{
  const genericTexts = literalTextsFromEntries(genericAdditionalInfoText.entries);
  const result = stripGenericAdditionalInfoLines('ear\nActive Problem, Significant', genericTexts);
  check(result.cleaned === 'ear', 'the genuine free-text line survives, the generic line is stripped');
  check(
    result.removed.length === 1 && result.removed[0] === 'Active Problem, Significant',
    'the removed generic line is reported (got ' + JSON.stringify(result.removed) + ')'
  );
  check(
    stripGenericAdditionalInfoLines('EAR', genericTexts).cleaned === 'EAR',
    'a line that does NOT match the generic list is never touched'
  );
  check(
    stripGenericAdditionalInfoLines('active problem, significant', genericTexts).removed.length === 1,
    'matching is case-insensitive'
  );
  check(
    stripGenericAdditionalInfoLines('  Active Problem, Significant  ', genericTexts).removed.length === 1,
    'matching trims surrounding whitespace on each line before comparing'
  );
  check(
    stripGenericAdditionalInfoLines('Active Problem, Significant', genericTexts).cleaned === '',
    'a field that is ENTIRELY generic text -> cleaned is empty, not left dangling'
  );
  check(
    stripGenericAdditionalInfoLines(null, genericTexts).cleaned === '' &&
      stripGenericAdditionalInfoLines(null, genericTexts).removed.length === 0,
    'null additionalInformation -> empty cleaned, no removals, never throws'
  );
  check(
    stripGenericAdditionalInfoLines('ear\nActive Problem, Significant', null).removed.length === 0,
    'null genericTexts -> nothing removed, never throws (fails to "leave it alone", not "strip everything")'
  );
  check(
    stripGenericAdditionalInfoLines('topic A\nActive Problem, Significant\nActive Problem, Significant', genericTexts)
      .removed.length === 2,
    'multiple matching lines are all reported, not just the first'
  );
}

console.log(
  '--- rules/generic-additional-info-text.json: "Problem severity: Major" and the consolidated pattern entry (2026-07-29) ---'
);
{
  check(
    genericAdditionalInfoText.entries.some((e) => e.kind !== 'pattern' && e.text === 'Problem severity: Major'),
    '"Problem severity: Major" is present as a literal entry (added 2026-07-29)'
  );
  const patternEntry = genericAdditionalInfoText.entries.find((e) => e.kind === 'pattern');
  check(!!patternEntry, 'a kind:"pattern" entry is present — ALL junk-detection text lives in this one file now');
  check(
    !!(patternEntry && patternEntry.action && patternEntry.action.type === 'severityCorrection'),
    'the pattern entry carries an action flag identifying it as more than plain noise'
  );
  check(
    typeof (patternEntry && patternEntry.pattern) === 'string',
    'the pattern entry stores its regex source as data, not hardcoded'
  );
}

console.log('--- literalTextsFromEntries / patternEntriesFromEntries: splitting the unified entries list ---');
{
  const literals = literalTextsFromEntries(genericAdditionalInfoText.entries);
  const patterns = patternEntriesFromEntries(genericAdditionalInfoText.entries);
  check(
    literals.includes('Active Problem, Significant') && literals.includes('Problem severity: Major'),
    'literalTextsFromEntries returns every literal-kind text, unaffected by the pattern entry mixed in'
  );
  check(
    !literals.some((t) => t === undefined),
    'the pattern entry (no `.text` field) never leaks an undefined into the literal list'
  );
  check(
    patterns.length === 5 &&
      patterns.some((p) => p.id === 'severityDefaultingContradiction') &&
      patterns.some((p) => p.id === 'sourceSystemPriorityValue') &&
      patterns.some((p) => p.id === 'groupedWithReference') &&
      patterns.some((p) => p.id === 'episodicitySuffix') &&
      patterns.some((p) => p.id === 'gp2gpProblemNotesPrefix'),
    'all five configured pattern entries are returned (got ' + patterns.map((p) => p.id).join(', ') + ')'
  );
  check(literalTextsFromEntries(null).length === 0, 'null entries -> empty literal list, never throws');
  check(patternEntriesFromEntries(null).length === 0, 'null entries -> empty pattern list, never throws');
}

console.log(
  '--- episodicitySuffix / gp2gpProblemNotesPrefix (2026-08-14, REAL journal-note capture that motivated adding these) ---'
);
{
  // The exact real journal note text (entryId 019dde9e-42b1-7194-8964-
  // 289e4da0ea7c) whose ENTIRE body was this wrapper and nothing else —
  // the case that surfaced these two rules were missing at all.
  const realNoteText = '{Episodicity : code=255217005, displayName=First}';
  const suffixOnly = computeAdditionalInfoFindings(realNoteText, null, genericAdditionalInfoText.entries, []);
  check(
    !!suffixOnly.genericAdditionalInfo && suffixOnly.genericAdditionalInfo.removed.includes(realNoteText),
    'REAL CASE: the exact captured note text is now recognised and offered for removal'
  );
  check(
    suffixOnly.genericAdditionalInfo.cleaned === '',
    'a note whose ENTIRE body is the wrapper cleans down to empty'
  );

  const prefixOnly = computeAdditionalInfoFindings(
    'Problem Info: Problem Notes: patient reports improvement',
    null,
    genericAdditionalInfoText.entries,
    []
  );
  check(
    prefixOnly.genericAdditionalInfo.cleaned === 'patient reports improvement',
    'the prefix wrapper strips on its own, leaving genuine free text intact'
  );

  const both = computeAdditionalInfoFindings(
    'Problem Info: Problem Notes: genuine clinical content {Episodicity : code=1, displayName=First}',
    null,
    genericAdditionalInfoText.entries,
    []
  );
  check(
    both.genericAdditionalInfo.cleaned === 'genuine clinical content' &&
      both.genericAdditionalInfo.removed.length === 2,
    'prefix AND suffix both present -> both stripped independently, genuine text between them survives'
  );

  const neither = computeAdditionalInfoFindings(
    'just a genuine clinical note',
    null,
    genericAdditionalInfoText.entries,
    []
  );
  check(neither.genericAdditionalInfo === null, 'text with neither wrapper -> nothing flagged, left untouched');
}

console.log(
  '--- stripAllKnownGenericText (2026-08-14, REAL bug: computeAdditionalInfoFindings silently discarded this exact case) ---'
);
{
  // The exact real journal note text (entryId 019f5b57-dd67-71b8-9ea3-
  // ef7e8d7633aa) that exposed the bug: computeAdditionalInfoFindings(' PRIORITY=1', null, ...)
  // finds the pattern, but because currentSignificance is null (a journal
  // note has no significance field), sourceSystemPriorityValue's
  // reviewSeverity action ALWAYS reads as a contradiction needing
  // correction — routing into severityContradiction and returning
  // genericAdditionalInfo: null, discarding a genuine, removable match.
  const realNoteText = ' PRIORITY=1';
  const viaComputeFindings = computeAdditionalInfoFindings(realNoteText, null, genericAdditionalInfoText.entries, []);
  check(
    viaComputeFindings.genericAdditionalInfo === null && !!viaComputeFindings.severityContradiction,
    'REGRESSION DOCUMENTED: computeAdditionalInfoFindings genuinely returns genericAdditionalInfo: null for this exact text when currentSignificance is null — confirms stripAllKnownGenericText exists for a real reason, not a hypothetical one'
  );

  const stripped = stripAllKnownGenericText(realNoteText, genericAdditionalInfoText.entries);
  check(
    stripped.removed.includes('PRIORITY=1') && stripped.cleaned === '',
    'FIX: stripAllKnownGenericText correctly strips the exact same text, unaffected by the severity-comparison side effect'
  );

  const bothFragments = stripAllKnownGenericText(
    ' PRIORITY=1 Active Problem, Significant',
    genericAdditionalInfoText.entries
  );
  check(
    bothFragments.removed.length === 2 && bothFragments.cleaned === '',
    'a problem-style text with BOTH fragments still strips both, same as before — this function is a superset, not a narrower replacement'
  );

  check(
    JSON.stringify(
      stripAllKnownGenericText('genuine clinical text, nothing generic', genericAdditionalInfoText.entries)
    ) === JSON.stringify({ cleaned: 'genuine clinical text, nothing generic', removed: [] }),
    'no known generic text -> cleaned unchanged, removed empty (not merely falsy)'
  );
  check(
    JSON.stringify(stripAllKnownGenericText(null, genericAdditionalInfoText.entries)) ===
      JSON.stringify({ cleaned: '', removed: [] }),
    'null text -> empty result, never throws'
  );
  check(
    JSON.stringify(stripAllKnownGenericText('PRIORITY=1', null)) ===
      JSON.stringify({ cleaned: 'PRIORITY=1', removed: [] }),
    'null entries -> nothing matched, never throws'
  );
}

console.log(
  '--- findPatternMatch: real 2026-07-29 example (HAR capture, "Chronic kidney disease stage 3") — BOTH confirmed layouts ---'
);
{
  const patternEntry = patternEntriesFromEntries(genericAdditionalInfoText.entries)[0];
  const newlineJoined = findPatternMatch(
    'Unspecified Significance: Defaulted to Minor\nProblem severity: Major',
    patternEntry
  );
  check(
    newlineJoined && newlineJoined.groups[0] === 'Minor' && newlineJoined.groups[1] === 'Major',
    'newline-joined layout matches, both values captured (got ' + JSON.stringify(newlineJoined) + ')'
  );
  const spaceJoined = findPatternMatch(
    'Unspecified Significance: Defaulted to Minor Problem severity: Minor',
    patternEntry
  );
  check(
    spaceJoined && spaceJoined.groups[0] === 'Minor' && spaceJoined.groups[1] === 'Minor',
    'space-joined, single-line layout ALSO matches (2026-07-29 variant, no newline at all) — got ' +
      JSON.stringify(spaceJoined)
  );
  const noPrefix = findPatternMatch('Defaulted to Minor\nProblem severity: Minor', patternEntry);
  check(
    noPrefix &&
      noPrefix.groups[0] === 'Minor' &&
      noPrefix.groups[1] === 'Minor' &&
      noPrefix.raw === 'Defaulted to Minor\nProblem severity: Minor',
    'the leading "Unspecified Significance: " prefix is OPTIONAL (2026-07-29, real patient, previously not flagging) — got ' +
      JSON.stringify(noPrefix)
  );
  const prefixedRaw = findPatternMatch(
    'Unspecified Significance: Defaulted to Minor\nProblem severity: Major',
    patternEntry
  );
  check(
    prefixedRaw.raw === 'Unspecified Significance: Defaulted to Minor\nProblem severity: Major',
    'when the prefix IS present, the matched span still includes it (greedy optional group) — no dangling prefix left in `cleaned`'
  );
  check(
    findPatternMatch('Problem severity: Major', patternEntry) === null,
    'the severity fragment ALONE (no defaulting fragment) never fires — only the confirmed combination'
  );
  check(
    findPatternMatch('Unspecified Significance: Defaulted to Minor', patternEntry) === null,
    'the defaulting fragment ALONE (no severity fragment) never fires either'
  );
  check(findPatternMatch(null, patternEntry) === null, 'null text -> null, never throws');
  check(findPatternMatch('anything', null) === null, 'null entry -> null, never throws');
  check(
    findPatternMatch('Unspecified Significance: Defaulted to Minor\nProblem severity: Major', {
      pattern: '(',
    }) === null,
    'a malformed regex source -> null, never throws'
  );
}

console.log('--- removeMatchedSpan ---');
{
  check(
    removeMatchedSpan('Unspecified Significance: Defaulted to Minor\nProblem severity: Major', 'x') ===
      'Unspecified Significance: Defaulted to Minor\nProblem severity: Major',
    'a substring not present in the text is left completely untouched'
  );
  check(
    removeMatchedSpan(
      'ear\nUnspecified Significance: Defaulted to Minor\nProblem severity: Major\nfollow up needed',
      'Unspecified Significance: Defaulted to Minor\nProblem severity: Major'
    ) === 'ear\nfollow up needed',
    'genuine free-text lines before AND after the matched span both survive, no stray blank line left behind'
  );
  check(
    removeMatchedSpan(
      'Unspecified Significance: Defaulted to Minor Problem severity: Minor',
      'Unspecified Significance: Defaulted to Minor Problem severity: Minor'
    ) === '',
    'removing a span that is the ENTIRE field -> empty, not left dangling'
  );
  check(removeMatchedSpan(null, 'x') === '', 'null text -> empty string, never throws');
  check(removeMatchedSpan('ear', null) === 'ear', 'null/empty raw -> text returned unchanged');
}

console.log('--- severityCorrectionNeeded ---');
{
  check(
    severityCorrectionNeeded('major', 'minor') === 'major',
    'stated severity differs from current -> returns the corrected value'
  );
  check(
    severityCorrectionNeeded('minor', 'minor') === null,
    'stated severity matches current -> null, nothing to correct'
  );
  check(
    severityCorrectionNeeded('major', 'Minor') === 'major',
    "comparison is case-insensitive (edit-problem's own casing vs slideover/overview's capitalised casing)"
  );
  check(severityCorrectionNeeded(null, 'minor') === null, 'null stated severity -> null, never throws');
}

console.log(
  '--- computeAdditionalInfoFindings: mismatch (newline-joined, real 2026-07-29 example) supersedes the plain strip ---'
);
{
  const findings = computeAdditionalInfoFindings(
    'Unspecified Significance: Defaulted to Minor\nProblem severity: Major',
    'minor',
    genericAdditionalInfoText.entries
  );
  check(
    findings.severityContradiction &&
      findings.severityContradiction.stated === 'major' &&
      findings.severityContradiction.current === 'minor' &&
      findings.severityContradiction.cleaned === '',
    'mismatch found, both boilerplate fragments already removed from `cleaned` (got ' + JSON.stringify(findings) + ')'
  );
  check(
    findings.genericAdditionalInfo === null,
    'the plain generic-strip offer is suppressed when a mismatch supersedes it'
  );
}

console.log(
  '--- computeAdditionalInfoFindings: no mismatch, SPACE-JOINED single-line variant (2026-07-29) still gets stripped ---'
);
{
  const findings = computeAdditionalInfoFindings(
    'Unspecified Significance: Defaulted to Minor Problem severity: Minor',
    'minor',
    genericAdditionalInfoText.entries
  );
  check(findings.severityContradiction === null, 'no mismatch -> no severity contradiction offered');
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === '',
    'the space-joined layout is still recognised and stripped as boilerplate, not left untouched just because it is one line (got ' +
      JSON.stringify(findings) +
      ')'
  );
}

console.log(
  '--- computeAdditionalInfoFindings: NO PREFIX variant (2026-07-29, real patient — previously not flagging at all) ---'
);
{
  const findings = computeAdditionalInfoFindings(
    'Defaulted to Minor\nProblem severity: Minor',
    'minor',
    genericAdditionalInfoText.entries
  );
  check(
    findings.severityContradiction === null,
    'values agree -> no severity contradiction, same as the prefixed sibling'
  );
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === '',
    "the no-prefix layout is now recognised and fully stripped, where it previously wasn't flagged at all (got " +
      JSON.stringify(findings) +
      ')'
  );
}
{
  const findings = computeAdditionalInfoFindings(
    'Defaulted to Minor\nProblem severity: Major',
    'minor',
    genericAdditionalInfoText.entries
  );
  check(
    findings.severityContradiction &&
      findings.severityContradiction.stated === 'major' &&
      findings.severityContradiction.source === 'severityDefaultingContradiction' &&
      findings.severityContradiction.cleaned === '',
    'the no-prefix layout ALSO drives the severity-correction action on a genuine mismatch, same as the prefixed sibling (got ' +
      JSON.stringify(findings.severityContradiction) +
      ')'
  );
}
{
  const findings = computeAdditionalInfoFindings('Defaulted to Minor', 'minor', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction === null &&
      findings.genericAdditionalInfo &&
      findings.genericAdditionalInfo.cleaned === '',
    'a solo, unpaired "Defaulted to Minor" line (no "Problem severity:" sibling) is still caught by its own standalone literal entry'
  );
}

console.log(
  '--- computeAdditionalInfoFindings: real 2026-07-29 example — TWO boilerplate layers plus genuine clinical text mixed onto one line ---'
);
{
  // Real motivating example: a record apparently passed through more than
  // one GP EPR/GP2GP transfer, layering the severity-defaulting boilerplate
  // AND a separate "Active Problem, Not Significant (Minor)" line onto the
  // same field — with genuine clinical free text ("grade 1 with small
  // erosion at GOJ") sharing a line with the "Problem severity: Minor"
  // boilerplate prefix.
  const findings = computeAdditionalInfoFindings(
    'Defaulted to Minor\nProblem severity: Minor grade 1 with small erosion at GOJ\nActive Problem, Not Significant (Minor)',
    'minor',
    genericAdditionalInfoText.entries
  );
  check(
    findings.severityContradiction === null,
    'both severity values agree (Minor/Minor) -> no contradiction, same as any other agreeing pair'
  );
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === 'grade 1 with small erosion at GOJ',
    'BOTH boilerplate lines are stripped, and the genuine clinical text sharing a line with one of them survives intact (got ' +
      JSON.stringify(findings.genericAdditionalInfo) +
      ')'
  );
  check(
    findings.genericAdditionalInfo.removed.some((r) => r.indexOf('Defaulted to Minor') !== -1) &&
      findings.genericAdditionalInfo.removed.includes('Active Problem, Not Significant (Minor)'),
    'both distinct boilerplate fragments are individually reported as removed (got ' +
      JSON.stringify(findings.genericAdditionalInfo.removed) +
      ')'
  );
}

console.log(
  '--- findPatternMatch: sourceSystemPriorityValue ("PRIORITY=n" with no confirmed severity mapping, 2026-07-29) ---'
);
{
  const patternEntry = patternEntriesFromEntries(genericAdditionalInfoText.entries).find(
    (p) => p.id === 'sourceSystemPriorityValue'
  );
  const single = findPatternMatch('PRIORITY=7', patternEntry);
  check(
    single && single.groups[0] === '7',
    'a single-digit priority value is captured (got ' + JSON.stringify(single) + ')'
  );
  const spaced = findPatternMatch('PRIORITY = 3', patternEntry);
  check(spaced && spaced.groups[0] === '3', 'whitespace around "=" is tolerated');
  const multiDigit = findPatternMatch('PRIORITY=12', patternEntry);
  check(
    multiDigit && multiDigit.groups[0] === '12',
    'a multi-digit value is captured too — the pattern is not restricted to the single 1-9 digit observed so far'
  );
  check(findPatternMatch('no priority here', patternEntry) === null, 'text with no PRIORITY=n at all -> null');
}

console.log(
  '--- computeAdditionalInfoFindings: "PRIORITY=1" IS a confirmed mapping (practice-confirmed convention, 2026-07-29) — auto-suggests Major ---'
);
{
  const findings = computeAdditionalInfoFindings('PRIORITY=1', 'minor', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction &&
      findings.severityContradiction.stated === 'major' &&
      findings.severityContradiction.current === 'minor' &&
      findings.severityContradiction.source === 'sourceSystemPriorityValue' &&
      findings.severityContradiction.cleaned === '',
    'PRIORITY=1 with stored significance "minor" -> a correction to Major is offered, tagged with its source (got ' +
      JSON.stringify(findings.severityContradiction) +
      ')'
  );
  check(
    findings.genericAdditionalInfo === null,
    'the plain generic-strip offer is suppressed when the mapped correction supersedes it, same as severityDefaultingContradiction'
  );
  check(
    findings.severityReviewNote === null,
    'no separate review note when the value IS mapped — the correction action covers it entirely'
  );
}
{
  const findings = computeAdditionalInfoFindings('PRIORITY=1', 'major', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction === null,
    'PRIORITY=1 already agreeing with stored significance "major" -> no correction needed, nothing to contradict'
  );
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === '',
    'falls through to the ordinary plain strip when the mapped value already matches — same as any other agreeing boilerplate'
  );
}

console.log(
  '--- computeAdditionalInfoFindings: source-system PRIORITY=n coexists with the plain strip, never a guessed correction (any OTHER, unmapped value) ---'
);
{
  const findings = computeAdditionalInfoFindings('PRIORITY=7', 'minor', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction === null,
    'NO automatic correction is ever attempted for an unmapped priority value, unlike severityDefaultingContradiction'
  );
  check(
    findings.severityReviewNote &&
      findings.severityReviewNote.priorityValue === '7' &&
      findings.severityReviewNote.current === 'minor',
    'an informational review note is offered instead, carrying the captured value and the current significance (got ' +
      JSON.stringify(findings.severityReviewNote) +
      ')'
  );
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === '',
    'the raw "PRIORITY=n" text is STILL offered for removal via the ordinary plain-strip path, coexisting with the review note (got ' +
      JSON.stringify(findings.genericAdditionalInfo) +
      ')'
  );
}
{
  const findings = computeAdditionalInfoFindings('ear\nPRIORITY=4', 'major', genericAdditionalInfoText.entries);
  check(
    findings.severityReviewNote && findings.severityReviewNote.priorityValue === '4',
    'the review note fires even when genuine free text shares the field'
  );
  check(
    findings.genericAdditionalInfo && findings.genericAdditionalInfo.cleaned === 'ear',
    'the genuine free-text line survives, only the PRIORITY=n fragment is offered for removal'
  );
}
{
  const findings = computeAdditionalInfoFindings('ear', 'minor', genericAdditionalInfoText.entries);
  check(
    findings.severityReviewNote === null,
    'no PRIORITY=n text at all -> no review note, same "nothing flagged" result as before this entry existed'
  );
}

console.log('--- computeAdditionalInfoFindings: genuine free text, other edge cases ---');
{
  const findings = computeAdditionalInfoFindings('ear', 'minor', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction === null && findings.genericAdditionalInfo === null,
    'genuine free text with no boilerplate and no contradiction -> nothing flagged'
  );
}
{
  // A solo/unpaired fragment (no matching sibling) is still caught by the
  // literal entries even though the pattern entry requires both fragments.
  const findings = computeAdditionalInfoFindings('Problem severity: Major', 'major', genericAdditionalInfoText.entries);
  check(
    findings.severityContradiction === null &&
      findings.genericAdditionalInfo &&
      findings.genericAdditionalInfo.cleaned === '',
    'a solo "Problem severity: Major" line with no paired defaulting line -> plain literal strip, no correction attempted'
  );
}

console.log('--- computeAdditionalInfoFindings: linkSuggestion action (2026-08-09, "(Grouped with X)") ---');
{
  // Synthetic entry — the real rules/generic-additional-info-text.json entry
  // is pending Nick's verbatim confirmation of the exact live text (this
  // codebase's own "confirm before adding" discipline — see that file's
  // header). Exercising the CODE PATH here does not require the shipped
  // entry to exist yet; the feature is entirely inert in production until
  // that entry is actually added (patternEntriesFromEntries never sees it).
  const linkEntries = [
    {
      kind: 'pattern',
      id: 'groupedWithReference',
      pattern: '\\(Grouped with ([^)]+)\\)',
      flags: 'i',
      action: { type: 'linkSuggestion', capturesProblemName: 1 },
    },
  ];
  const otherProblems = [
    { id: 'p2', description: 'Anxiety with depression' },
    { id: 'p3', description: 'Type 2 diabetes mellitus' },
  ];

  const exactFindings = computeAdditionalInfoFindings(
    '(Grouped with Anxiety with depression)',
    'minor',
    linkEntries,
    otherProblems
  );
  check(
    !!exactFindings.linkSuggestion && exactFindings.linkSuggestion.problemName === 'Anxiety with depression',
    'captures the referenced problem name from the parenthesised text'
  );
  check(
    !!exactFindings.linkSuggestion.match &&
      exactFindings.linkSuggestion.match.problemId === 'p2' &&
      exactFindings.linkSuggestion.match.confidence === 'exact',
    'resolves to the exact matching problem on the record'
  );
  check(
    exactFindings.linkSuggestion.cleaned === '',
    'the boilerplate text is removed from `cleaned` regardless of match outcome'
  );
  check(
    exactFindings.genericAdditionalInfo === null,
    'linkSuggestion does not ALSO produce a redundant plain generic-strip offer for the same text'
  );

  const noMatchFindings = computeAdditionalInfoFindings(
    '(Grouped with Some unrelated condition)',
    'minor',
    linkEntries,
    otherProblems
  );
  check(
    !!noMatchFindings.linkSuggestion && noMatchFindings.linkSuggestion.match === null,
    'no candidate on the record -> match is null (informational only), never a guessed link'
  );
  check(
    !!noMatchFindings.genericAdditionalInfo,
    'an UNMATCHED linkSuggestion coexists with the plain strip offer (same as reviewSeverity) — there is no confident action to supersede it with'
  );

  const noOtherProblemsFindings = computeAdditionalInfoFindings(
    '(Grouped with Anxiety with depression)',
    'minor',
    linkEntries
    // otherProblems omitted entirely — existing callers that haven't been
    // updated must still work, degrading to "no match" rather than throwing.
  );
  check(
    !!noOtherProblemsFindings.linkSuggestion && noOtherProblemsFindings.linkSuggestion.match === null,
    'otherProblems omitted -> degrades to no-match, never throws (backward compatible with any caller not yet passing it)'
  );

  const genuineTextFindings = computeAdditionalInfoFindings(
    'Patient reports ongoing symptoms.',
    'minor',
    linkEntries,
    otherProblems
  );
  check(
    genuineTextFindings.linkSuggestion === null,
    'no "(Grouped with X)" text present -> linkSuggestion stays null, genuine free text untouched'
  );
}

console.log(
  '--- codeQualityConcernExists: distinguishes "code itself needs review" from "flagged only for text housekeeping" (2026-07-29) ---'
);
{
  check(
    codeQualityConcernExists({ currentDescription: 'Oesophagitis', retiredInfo: null, legacyReadCode: null }) === false,
    'a plain, current, non-retired description with no legacy-code signal -> no code-quality concern (the real motivating case: a problem flagged only for junk import text)'
  );
  check(
    codeQualityConcernExists({ currentDescription: '[X]Depression NOS', retiredInfo: null, legacyReadCode: null }) ===
      true,
    'a looksOutdated()-flagged description ("[X]...NOS") -> genuine code-quality concern, even with no retirement/legacy-code signal'
  );
  check(
    codeQualityConcernExists({
      currentDescription: 'Oesophagitis',
      retiredInfo: { inactivationReason: null },
      legacyReadCode: null,
    }) === true,
    'retiredInfo present -> genuine code-quality concern, regardless of description text'
  );
  check(
    codeQualityConcernExists({
      currentDescription: 'Oesophagitis',
      retiredInfo: null,
      legacyReadCode: { code: 'X', description: 'Y' },
    }) === true,
    'legacyReadCode present -> genuine code-quality concern, regardless of description text'
  );
  check(codeQualityConcernExists({}) === false, 'an empty state object -> no concern, never throws');
  check(codeQualityConcernExists(null) === false, 'null -> no concern, never throws');
}

console.log('--- unwrapOptionValue + episode round-trip: the real 2026-07-27 "API 400" case ---');
{
  // The GET prefill returns select-backed fields as the SELECTED OPTION
  // OBJECT; the POST contract takes the bare value. First seen live
  // 2026-07-27 on an EMIS-imported problem with episode
  // {value:"subsequent",label:"Subsequent"} — the first non-null episode
  // ever captured — where round-tripping the whole object was rejected
  // with a 400.
  check(
    unwrapOptionValue({ value: 'subsequent', label: 'Subsequent' }) === 'subsequent',
    'an option object {value,label} unwraps to its value'
  );
  check(unwrapOptionValue('major') === 'major', 'a plain string passes through untouched');
  check(unwrapOptionValue(null) === null, 'null passes through untouched');
  check(
    unwrapOptionValue({ value: 'x' }) !== 'x' && typeof unwrapOptionValue({ value: 'x' }) === 'object',
    'an object with value but NO label is NOT unwrapped (strict option shape only)'
  );
  {
    const org = { organisationName: 'The Park Road Surgery', organisationIdentifierType: null };
    check(unwrapOptionValue(org) === org, 'a real object field (recordedByOrganisation shape) is never mangled');
  }

  // The full payload, built from the pseudonymised real prefill that 400'd.
  const prefill = {
    onsetDate: '2015-03-10',
    contextId: null,
    contextType: null,
    significance: 'major',
    episode: { value: 'subsequent', label: 'Subsequent' },
    additionalInformation: 'monitoring\nLast review: 20 Oct 2021',
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    endDate: null,
    reasonEnded: null,
    recordDate: '2015-03-10',
    recordedAtAnotherOrganisation: true,
    recordedByOrganisation: null,
    recordedByPractitioner: 'Dr A Smith',
  };
  const newCode = { description: 'Angiomyolipoma', conceptId: '999999999', descriptionId: '111111111' };
  const payload = buildEditProblemPayload(prefill, newCode);
  check(payload.episode === 'subsequent', 'episode option object is flattened to its bare value in the POST body');
  check(payload.significance === 'major', 'significance (already a plain string) is unchanged');
  check(payload.recordedByOrganisation === null, 'a null recordedByOrganisation round-trips as null, not dropped');
  check(payload.recordedByPractitioner === 'Dr A Smith', 'recordedByPractitioner round-trips untouched');
  check(payload.problemCode === newCode, 'problemCode is the chosen suggestion');
  check(
    payload.additionalInformation === 'monitoring\nLast review: 20 Oct 2021',
    'multi-line additionalInformation round-trips untouched'
  );

  // recordedByStaff branch: staff options are {value,label}, so a prefill
  // that returns the selected one as an option object must flatten too.
  const localPrefill = {
    recordedAtAnotherOrganisation: false,
    recordedByStaff: { value: 'staff-uuid-1', label: 'Dr B Jones' },
  };
  const localPayload = buildEditProblemPayload(localPrefill, newCode);
  check(
    localPayload.recordedByStaff === 'staff-uuid-1',
    'recordedByStaff option object is flattened to its bare value'
  );
  const localPlain = buildEditProblemPayload(
    { recordedAtAnotherOrganisation: false, recordedByStaff: 'plain' },
    newCode
  );
  check(localPlain.recordedByStaff === 'plain', 'a plain recordedByStaff value is unchanged');
}

console.log('--- apiErrorMessage: non-2xx responses surface the server reason, never just the status ---');
{
  // The live "API 400" round (2026-07-27): an edit-problem apply was
  // rejected and the discarded response body was the only thing that could
  // have said why. These pin the extraction rules.
  check(apiErrorMessage(400, '') === 'API 400', 'no body -> bare status, unchanged from the old behaviour');
  check(apiErrorMessage(400, null) === 'API 400', 'null body -> bare status, never throws');
  check(
    apiErrorMessage(400, '{"message":"onsetDate must not be in the future"}') ===
      'API 400 — onsetDate must not be in the future',
    'a JSON body with .message surfaces the message'
  );
  check(
    apiErrorMessage(400, '{"error":"Bad Request"}') === 'API 400 — Bad Request',
    'a JSON body with .error surfaces the error string'
  );
  check(
    apiErrorMessage(422, '{"errors":{"recordedByStaff":"is required"}}') ===
      'API 422 — {"recordedByStaff":"is required"}',
    'a JSON body with an .errors object surfaces the per-field errors'
  );
  check(
    apiErrorMessage(400, '{"unexpected":"shape"}') === 'API 400 — {"unexpected":"shape"}',
    'an unrecognised JSON shape falls back to the whole (stringified) object'
  );
  check(
    apiErrorMessage(500, 'Internal Server Error') === 'API 500 — Internal Server Error',
    'a non-JSON body is used as-is'
  );
  check(
    apiErrorMessage(400, '  {"message":"x"}  ') === 'API 400 — x',
    'surrounding whitespace is trimmed before parsing'
  );
  {
    const long = 'a'.repeat(500);
    const msg = apiErrorMessage(400, long);
    check(msg.length <= 'API 400 — '.length + 221, `a long body is truncated (got length ${msg.length})`);
    check(msg.endsWith('…'), 'truncation is marked with an ellipsis');
  }
  check(
    apiErrorMessage(400, 'line1\n   line2\t\tline3') === 'API 400 — line1 line2 line3',
    'internal whitespace/newlines are collapsed for the inline panel'
  );
}

console.log('\n--- v3.227.1 review-fix source locks (two-step confirm / retry survival / empty-string strip) ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'problem-description-cleanup.js'), 'utf8');
  // Finding 5: the three relationship-creating buttons arm a confirm step;
  // only the confirm button commits. (The PR's own CHANGELOG claimed this
  // discipline existed — now it does.)
  check(src.includes('linkSuggestionPending'), 'relationship buttons arm a pending choice instead of committing');
  check(
    src.includes('ms-pdc-link-confirm-btn') && src.includes('ms-pdc-link-cancel-btn'),
    'the confirm step renders explicit Confirm and Cancel controls'
  );
  check(
    /relationship === 'alreadyRelated' \|\| relationship === 'leaveAsIs'/.test(src),
    'only the text-only actions stay single-click; every relationship write goes through the confirm'
  );
  // Finding 9: a failed TEXT-ONLY strip keeps the suggestion offered so the
  // retry button still exists, and a missing prefill code is a visible
  // failure rather than a silently-vanishing suggestion.
  check(
    src.includes('keep the suggestion so the button is still there to retry'),
    'text-only strip failure keeps st.linkSuggestion for retry'
  );
  check(
    src.includes('the import text was not removed. Try again.'),
    'a missing prefill code on a text-only action reads as a failure, never as success'
  );
  // Finding 4: the cleaned-value selection must accept a legitimate empty
  // string — an || chain here silently no-ops the strip when the whole
  // additionalInformation was boilerplate.
  const stripIdx = src.indexOf('async function stripGenericAdditionalInfoText');
  const stripBody = src.slice(stripIdx, stripIdx + 2200);
  check(
    stripBody.includes('f.cleaned != null'),
    'stripGenericAdditionalInfoText picks the first finding with cleaned != null'
  );
  check(
    !/var cleaned =\s*\(findings\.severityContradiction && findings\.severityContradiction\.cleaned\) \|\|/.test(
      stripBody
    ),
    'the falsy || chain over cleaned values is gone'
  );
}

console.log('\n--- H-061: journal-entry date labelling (formatJournalDate / journalMatchDateLabel) ---');
{
  check(formatJournalDate('2025-03-12') === '12 Mar 2025', 'an ISO date renders as a plain-English day/month/year');
  check(formatJournalDate('2025-03-01') === '1 Mar 2025', 'a leading zero on the day is dropped');
  check(
    formatJournalDate('Thu 02 Jul 2026') === 'Thu 02 Jul 2026',
    'an unparseable raw day-group title passes through verbatim, never reformatted on a guess'
  );
  check(formatJournalDate(null) === '', 'a missing date formats to empty, never "null"');

  // The whole point of H-061: a day-group heading date and a note's own
  // verified recordDate must NEVER be presented with the same words — the
  // heading can sit 12+ days from the note's true date, so labelling it as
  // the note's date would manufacture exactly the false confidence this
  // fix exists to remove.
  check(
    journalMatchDateLabel({ tier: 'verified-date-exact-text', date: '2025-03-12' }) ===
      "dated 12 Mar 2025 (the note's own recorded date)",
    'a verified-date tier is labelled "dated …" — the note\'s own recorded date'
  );
  check(
    journalMatchDateLabel({ tier: 'verified-date-partial-text', date: '2025-03-12' }) ===
      "dated 12 Mar 2025 (the note's own recorded date)",
    'the partial-text verified tier is labelled the same way'
  );
  check(
    journalMatchDateLabel({ tier: 'date-exact-text', date: '2025-03-12' }) ===
      "listed under 12 Mar 2025 (journal day heading, not the note's own date)",
    'a day-group date is labelled "listed under …" and says it is NOT the note\'s own date'
  );
  check(
    journalMatchDateLabel({ tier: 'linked', date: '2025-03-12' }) ===
      "listed under 12 Mar 2025 (journal day heading, not the note's own date)",
    'the structural "linked" tier carries a day-group date too, and is labelled as such'
  );
  check(
    journalMatchDateLabel({ tier: 'fuzzy-code-text-partial', date: '2025-03-12' }).indexOf('listed under') === 0,
    'the ±30-day fuzzy tier — the one most implicated in a false match — is never presented as a verified date'
  );
  check(
    journalMatchDateLabel({ tier: 'linked', date: '2025-03-12', dateConfirmed: true, confirmedDate: '2025-03-01' }) ===
      "dated 1 Mar 2025 (the note's own recorded date)",
    'applyDateConfirmation\'s confirmedDate is a genuinely fetched recordDate -> "dated …", and it wins over m.date'
  );
  check(journalMatchDateLabel({ tier: 'linked' }) === 'date unknown', 'a match with no date says so out loud');
  check(journalMatchDateLabel(null) === 'date unknown', 'a missing match object says "date unknown", never throws');
  check(
    journalMatchDateLabel({ tier: 'linked' }).length > 0,
    'the no-date case is a visible line, not an omitted one (absence must be visible in the dialog)'
  );
}

console.log('\n--- H-061: resolveJournalSyncTargets (which matches an AUTOMATIC prompt may target) ---');
{
  const alerts = [];
  const prevAlert = global.window.alert;
  global.window.alert = (msg) => alerts.push(msg);
  const noMatch = () => 'NO-MATCH-MESSAGE';
  const ambiguous = (n) => `AMBIGUOUS-${n}`;

  check(
    resolveJournalSyncTargets({ journalMatches: null }, noMatch, ambiguous) === null && alerts.length === 0,
    'a null journalMatches (check never ran/failed) targets nothing and says nothing — genuinely unknown'
  );
  check(
    resolveJournalSyncTargets({}, noMatch, ambiguous) === null && alerts.length === 0,
    'a missing journalMatches behaves the same way'
  );

  check(
    resolveJournalSyncTargets({ journalMatches: [] }, noMatch, ambiguous) === null &&
      alerts[alerts.length - 1] === 'NO-MATCH-MESSAGE',
    'zero matches targets nothing and explains why'
  );

  const single = [{ entryId: 'a', tier: 'fuzzy-code-text-partial', date: '2025-03-12' }];
  const singleTargets = resolveJournalSyncTargets({ journalMatches: single }, noMatch, ambiguous);
  check(
    Array.isArray(singleTargets) && singleTargets.length === 1 && singleTargets[0].entryId === 'a',
    'a single match is prompted for (the confirm() gate is what protects a low-confidence tier here)'
  );

  const mixed = [
    { entryId: 'a', tier: 'date-exact-text', date: '2025-03-12' },
    { entryId: 'b', tier: 'linked', date: '2025-03-12', dateConfirmed: true, confirmedDate: '2025-03-12' },
    { entryId: 'c', tier: 'date-partial-text', date: '2025-03-12' },
  ];
  const narrowed = resolveJournalSyncTargets({ journalMatches: mixed }, noMatch, ambiguous);
  check(
    Array.isArray(narrowed) && narrowed.length === 1 && narrowed[0].entryId === 'b',
    'several matches with exactly ONE date-confirmed narrows to that one — never a dialog per candidate'
  );

  const alertsBefore = alerts.length;
  const unconfirmed = [
    { entryId: 'a', tier: 'linked-exact-text', date: '2025-03-12' },
    { entryId: 'b', tier: 'linked-exact-text', date: '2025-06-01' },
  ];
  check(
    resolveJournalSyncTargets({ journalMatches: unconfirmed }, noMatch, ambiguous) === null &&
      alerts.length === alertsBefore + 1 &&
      alerts[alerts.length - 1] === 'AMBIGUOUS-2',
    'several matches with NONE date-confirmed refuses to guess — alerts with the count and writes nothing'
  );

  const bothConfirmed = [
    { entryId: 'a', tier: 'linked', dateConfirmed: true, confirmedDate: '2025-03-12' },
    { entryId: 'b', tier: 'linked', dateConfirmed: true, confirmedDate: '2025-03-12' },
    { entryId: 'c', tier: 'linked' },
  ];
  const twoConfirmed = resolveJournalSyncTargets({ journalMatches: bothConfirmed }, noMatch, ambiguous);
  check(
    twoConfirmed.length === 2 && twoConfirmed.every((m) => m.dateConfirmed),
    'only the date-confirmed matches are targeted when more than one is confirmed'
  );

  global.window.alert = prevAlert;
}

console.log('\n--- H-061 source locks: journal write/undo paths (confirm gate, fresh prefill, dated dialog) ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'problem-description-cleanup.js'), 'utf8');
  // Slices one function's body out of the content script — these four are
  // DOM/network-bound (fetch + window.confirm + renderPanel), so they're
  // pinned by source lock rather than executed, the same technique the
  // v3.227.1 review-fix block above uses.
  const fnBody = (name) => {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) return '';
    const end = src.indexOf('\n  }\n', start);
    return end === -1 ? '' : src.slice(start, end);
  };

  // The exact label strings Fix A introduced — pinned verbatim so the
  // day-group/verified distinction can't silently regress into one shared
  // wording (which is the misread H-061 is about).
  check(
    src.includes("'dated ' + formatJournalDate(verified) + \" (the note's own recorded date)\""),
    'the verified-date label reads "dated <date> (the note\'s own recorded date)"'
  );
  check(
    src.includes("'listed under ' + formatJournalDate(m.date) + \" (journal day heading, not the note's own date)\""),
    'the day-group label reads "listed under <date> (journal day heading, not the note\'s own date)"'
  );
  check(src.includes("return 'date unknown';"), 'a dateless match yields the literal "date unknown"');

  const writePaths = [
    'applyToJournal',
    'undoJournalCodeSync',
    'undoJournalTextSync',
    'applyGenericAdditionalInfoToJournal',
  ];
  writePaths.forEach((name) => {
    const body = fnBody(name);
    check(body.length > 0, `${name}: source located`);
    const confirmAt = body.indexOf('window.confirm(');
    const postAt = body.indexOf('await postChangeNote(');
    const prefillAt = body.indexOf('await fetchEditNoteForm(entryId)');
    check(confirmAt !== -1 && postAt !== -1 && confirmAt < postAt, `${name}: the POST is confirm()-gated`);
    check(body.includes('if (!confirmed) return;'), `${name}: a declined confirm() returns without writing anything`);
    check(
      prefillAt !== -1 && prefillAt < postAt,
      `${name}: fetches a FRESH edit-note prefill before POSTing (never a cached one)`
    );
    check(
      body.indexOf('journalMatchDateLabel(') !== -1 && body.indexOf('journalMatchDateLabel(') < postAt,
      `${name}: the confirm() dialog names the entry's date (H-061)`
    );
    check(body.includes("'Journal entry ' +"), `${name}: the date line is introduced as "Journal entry <label>"`);
  });

  // Undo is only reachable once a write actually succeeded: the previous
  // state is captured AFTER the POST resolves (a failed write changed
  // nothing, so there is nothing to undo), and both undo paths bail unless
  // the forward write is flagged saved.
  const applyBody = fnBody('applyToJournal');
  check(
    applyBody.indexOf('jst.prevCode = notePrefill.noteSNOMEDct') > applyBody.indexOf('await postChangeNote('),
    'applyToJournal captures the pre-write code only AFTER the POST succeeded'
  );
  const infoBody = fnBody('applyGenericAdditionalInfoToJournal');
  check(
    infoBody.indexOf('jst.prevNote =') > infoBody.indexOf('await postChangeNote('),
    'applyGenericAdditionalInfoToJournal captures the pre-strip text only AFTER the POST succeeded'
  );
  check(
    fnBody('undoJournalCodeSync').includes('!jst.saved'),
    'undoJournalCodeSync refuses to run unless the forward sync is flagged saved'
  );
  check(
    fnBody('undoJournalTextSync').includes('!jst.saved'),
    'undoJournalTextSync refuses to run unless the forward cleanup is flagged saved'
  );
  check(
    src.includes('jst && jst.saved') && src.includes('data-undo-kind="code"'),
    'the Undo control is only rendered on a saved sync'
  );

  // An all-boilerplate note legitimately leaves '' behind — the restore
  // guards must be != null, never truthiness, or that note can never be
  // put back.
  check(
    fnBody('undoJournalTextSync').includes('jst.prevNote == null'),
    'undoJournalTextSync allows an empty-string restore (!= null, not truthiness)'
  );
  check(
    infoBody.includes("jst.prevNote = notePrefill.note != null ? notePrefill.note : ''"),
    "the pre-strip text is normalised to '' rather than left null, so an all-boilerplate note stays restorable"
  );
  check(
    src.includes('infoJst.prevNote != null'),
    'the text-undo button renders on prevNote != null, so an empty-string previous state still offers Undo'
  );

  // The panel row shows the same honest date phrase, so the clinician sees
  // it before ever reaching a confirm().
  check(
    src.includes('var dateLabel = journalMatchDateLabel(m);') &&
      src.includes('esc(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1))'),
    'the journal match row renders the same labelled date, escaped for the DOM'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
