// test-record-duplicate-parser.js — per-patient record duplicate parser unit tests
// Fixtures use synthetic placeholder clinical text (not real patient data),
// but reproduce the exact structural patterns observed in a real sample
// record review on 2026-07-01 (flat/nested dual-rendering, the GP2GP
// "Problem Info: Problem Notes: ...{Episodicity...}" wrapper, and
// "Data Transferred from other system" transfer encounters).
// Run with: node test-record-duplicate-parser.js
'use strict';

const {
  TIER,
  analyzeJournal,
  normText,
  decodeIdTimestamp,
  parseGenericDocumentTitle,
  resolveDocumentTypeLabel,
  hasQuestionnaireTemplateMismatch,
  hasPrescriptionTimingMismatch,
  isRemovableKind,
  buildRemovalRequest,
  splitWrapperText,
  isJunkRecordedBy,
  wordDiff,
  buildMergeSuggestion,
  buildDocumentFieldComparison,
  buildNoteEditUrl,
  buildNoteChangeRequest,
  resolveNoteOrganisation,
  buildNoteOverviewUrl,
  buildNoteFieldComparison,
  buildDocumentEditDetailsUrl,
  getDocumentEditValue,
  resolveDocumentOrganisation,
  buildDocumentEditOverrides,
  buildDocumentEditRequest,
  splitDocumentGroupsByFileType,
  flattenDocumentEntries,
  findDocumentLinkedDuplicates,
  sortGroupsByJournalOrder,
} = require('./engine/record-duplicate-parser.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function noteEntry(id, code, note, recordedBy, recordedByOrganisation, linkedProblems) {
  return {
    entryType: 'note',
    id,
    note,
    clinicalCodeDescription: code,
    recordedBy,
    recordedByOrganisation: recordedByOrganisation || null,
    linkedProblems: linkedProblems || [],
  };
}

function flatNoteItem(id, code, note, recordedBy, recordedByOrganisation) {
  return {
    type: 'note',
    data: {
      id,
      entryType: 'note',
      note,
      clinicalCodeDescription: code,
      recordedBy,
      recordedByOrganisation: recordedByOrganisation || null,
      linkedProblems: [],
    },
  };
}

function flatInvestigationRequestItem(id, items, requestedBy) {
  return {
    type: 'investigation-request',
    data: { id, entryType: 'investigation-request', investigationRequestItems: items, requestedBy },
  };
}

function flatPrescriptionItem(id, productName, dosageText, issueQuantity, recordedBy) {
  return {
    type: 'prescription',
    data: { id, entryType: 'prescription', productName, dosageText, issueQuantity, recordedBy },
  };
}

// Real shape, live-confirmed 2026-07-04: item.title/item.descriptionText are
// always null; the real content lives under item.data, in the same shape a
// nested document/fit-note entry exposes directly (see nestedDocumentEntry).
function flatDocumentItem(id, documentTypeLabel, title, extra) {
  return {
    type: 'document',
    id,
    title: null,
    descriptionText: null,
    data: Object.assign({ id, entryType: 'document', documentTypeLabel, title }, extra),
  };
}

function nestedDocumentEntry(id, documentTypeLabel, title, extra) {
  return Object.assign({ entryType: 'document', id, documentTypeLabel, title }, extra);
}

function problemRef(id, desc) {
  return { id, problemCodeDescription: desc };
}

// topicLinkedProblems: problems linked at consultationTopics[].linkedProblems.
// encounterLinkedProblems: problems linked at data.linkedProblems (encounter level, live-confirmed 2026-07-02).
function encounter(id, practitioner, headingsEntries, transferTopic, topicLinkedProblems, encounterLinkedProblems) {
  return {
    type: 'encounter',
    id,
    data: {
      responsiblePractitioner: practitioner,
      linkedProblems: encounterLinkedProblems || [],
      consultationTopics: [
        {
          title: transferTopic ? 'Data Transferred from other system' : 'Surgery consultation',
          linkedProblems: topicLinkedProblems || [],
          headings: [{ title: 'Diagnosis', entries: headingsEntries }],
        },
      ],
    },
  };
}

const dayGroups = [
  {
    title: 'Fri 23 Feb 2024',
    items: [
      // Group A — EXACT: flat note duplicates the nested encounter note, same recordedBy.
      flatNoteItem('flat-a', 'Hay fever - unspecified allergen', 'written info, treatment', 'Dr Test', null),
      encounter(
        'enc-a',
        'Dr Test',
        [
          noteEntry(
            'nested-a',
            'Hay fever - unspecified allergen',
            'written info, treatment',
            'Dr Test',
            'Test Surgery'
          ),
        ],
        false
      ),

      // Group B — HIGH: same normalised text, different recordedBy.
      flatNoteItem('flat-b', 'Medication review', 'Due Date: 23 Feb 2025', 'Dr Test', null),
      encounter(
        'enc-b',
        'Dr Test',
        [noteEntry('nested-b', 'Medication review', 'Due Date: 23 Feb 2025', 'Dr At Test Surgery', 'Test Surgery')],
        false
      ),

      // Group C — HIGH + GP2GP wrapper: second copy wrapped in the import signature.
      flatNoteItem('flat-c', 'Pigmented naevus', 'Multiple benign spots noted.', 'Dr Test', null),
      flatNoteItem(
        'flat-c2',
        'Pigmented naevus',
        'Problem Info: Problem Notes: Multiple benign spots noted. {Episodicity : code=255217005, displayName=First}',
        'User Previous Practice',
        null
      ),

      // Group D — REVIEW: same generic code, genuinely different content (must not over-flag).
      flatNoteItem('flat-d1', 'Had a chat to patient', 'Discussed smoking cessation.', 'Dr Test', null),
      flatNoteItem('flat-d2', 'Had a chat to patient', 'Discussed travel vaccination options.', 'Dr Test', null),

      // Control — unique, must not be grouped at all.
      flatNoteItem('flat-unique', 'Annual review', 'Routine check, no issues.', 'Dr Test', null),

      // Transfer encounter whose content IS confirmed elsewhere (duplicates group A).
      encounter(
        'enc-transfer-confirmed',
        'Dr At Test Surgery',
        [
          noteEntry(
            'nested-transfer-confirmed',
            'Hay fever - unspecified allergen',
            'written info, treatment',
            'Dr Test',
            'Test Surgery'
          ),
        ],
        true
      ),

      // Transfer encounter with unconfirmed content — label alone, no other match.
      encounter(
        'enc-transfer-unconfirmed',
        'Dr At Test Surgery',
        [
          noteEntry(
            'nested-transfer-unconfirmed',
            'Unique historic note',
            'Only appears once.',
            'Dr At Test Surgery',
            'Test Surgery'
          ),
        ],
        true
      ),
    ],
  },
];

const result = analyzeJournal(dayGroups);

console.log('\n--- Group tiering ---');
const byCode = Object.fromEntries(result.groups.map((g) => [g.code, g]));
assert(
  byCode['Hay fever - unspecified allergen'].tier === TIER.EXACT,
  'Group A (identical text + recordedBy) tiers EXACT'
);
assert(byCode['Medication review'].tier === TIER.HIGH, 'Group B (identical text, different recordedBy) tiers HIGH');
assert(byCode['Pigmented naevus'].tier === TIER.HIGH, 'Group C (GP2GP-wrapped duplicate) tiers HIGH');
assert(byCode['Pigmented naevus'].gp2gpWrapper === true, 'Group C flagged with gp2gpWrapper');
assert(
  byCode['Had a chat to patient'].tier === TIER.REVIEW,
  'Group D (same generic code, different content) tiers REVIEW, not auto-merged'
);
assert(!byCode['Annual review'], 'Unique entry does not form a candidate group');

console.log('\n--- Transfer encounter confirmation ---');
const transferByCode = Object.fromEntries(result.transferEncounters.map((t) => [t.encounterId, t]));
assert(
  transferByCode['enc-transfer-confirmed'].contentConfirmed === true,
  'Transfer encounter matching an existing duplicate group is content-confirmed'
);
assert(
  transferByCode['enc-transfer-unconfirmed'].contentConfirmed === false,
  'Transfer encounter with no matching content is NOT auto-confirmed (label alone is insufficient)'
);

console.log('\n--- Summary ---');
assert(result.summary.totalCandidateGroups === 4, 'Four candidate groups found (A, B, C, D)');
assert(result.summary.byTier.exact === 1, 'One EXACT-tier group');
assert(result.summary.byTier.high === 2, 'Two HIGH-tier groups');
assert(result.summary.byTier.review === 1, 'One REVIEW-tier group');

console.log('\n--- patientJournalRecords envelope (live-confirmed 2026-07-02) ---');
const wrappedResult = analyzeJournal({ patientJournalRecords: dayGroups });
assert(
  wrappedResult.summary.totalCandidateGroups === result.summary.totalCandidateGroups,
  'analyzeJournal({ patientJournalRecords }) matches analyzeJournal(bareArray)'
);

console.log('\n--- linkedProblems: dedup within one encounter, count across encounters ---');
const asthmaProblem = problemRef('prob-asthma', 'Asthma');
const linkedProblemsDayGroups = [
  {
    title: 'Mon 01 Jan 2024',
    items: [
      // Same problem linked at encounter level, topic level, AND entry level within
      // ONE encounter — must be counted once, not three times.
      encounter(
        'enc-p1',
        'Dr Test',
        [noteEntry('note-p1', 'Encounter one note', 'text', 'Dr Test', null, [asthmaProblem])],
        false,
        [asthmaProblem],
        [asthmaProblem]
      ),
      // A second, separate encounter linking the same problem — a genuine second
      // occurrence, must still be counted.
      encounter('enc-p2', 'Dr Test', [], false, [], [asthmaProblem]),
    ],
  },
];
const problemsResult = analyzeJournal(linkedProblemsDayGroups);
const asthmaGroup = problemsResult.groups.find((g) => g.kind === 'problem' && g.code === 'Asthma');
assert(!!asthmaGroup, 'Asthma linked-problem duplicate group found');
assert(
  asthmaGroup && asthmaGroup.entries.length === 2,
  'Multi-level linkage within one encounter dedups to 1; two separate encounters still count as 2'
);

console.log('\n--- Flat top-level investigation-request items ---');
const invReqDayGroups = [
  {
    title: 'Wed 10 Jan 2024',
    items: [
      flatInvestigationRequestItem('ir-1', ['FBC', 'U&E'], 'Dr Test'),
      flatInvestigationRequestItem('ir-2', ['FBC', 'U&E'], 'Dr Test'),
    ],
  },
];
const invReqResult = analyzeJournal(invReqDayGroups);
const invReqGroup = invReqResult.groups.find((g) => g.kind === 'investigation-request');
assert(!!invReqGroup, 'Duplicated flat investigation-request items form a candidate group');
assert(invReqGroup && invReqGroup.tier === TIER.EXACT, 'Identical flat investigation-request duplicates tier EXACT');

console.log('\n--- Flat top-level document items ---');
const docDayGroups = [
  {
    title: 'Sat 16 Aug 2025',
    items: [
      flatDocumentItem('doc-1', '2WW referral', 'Two week wait referral letter'),
      flatDocumentItem('doc-2', '2WW referral', 'Two week wait referral letter'),
      flatDocumentItem('doc-unique', 'Discharge summary', 'Routine discharge, no issues'),
    ],
  },
];
const docResult = analyzeJournal(docDayGroups);
const docGroup = docResult.groups.find((g) => g.kind === 'document');
assert(!!docGroup, 'Duplicated flat document items form a candidate group');
// Live-confirmed 2026-07-05: document-kind matches are capped at REVIEW
// regardless of text similarity — journal-payload metadata alone can't
// reliably distinguish genuinely different documents (asthma vs dizziness
// questionnaire false-positive). document was never removable anyway, so
// this only softens the displayed recommendation.
assert(docGroup && docGroup.tier === TIER.REVIEW, 'Identical flat document duplicates are capped at REVIEW, not EXACT');
assert(
  !docResult.groups.some((g) => g.kind === 'document' && g.code === 'Discharge summary'),
  'Unique document does not form a candidate group'
);

console.log('\n--- Nested document/fit-note entries (live-confirmed 2026-07-04) ---');
const nestedDocDayGroups = [
  {
    title: 'Fri 18 Jul 2025',
    items: [
      encounter('enc-doc-a', 'Dr Test', [
        nestedDocumentEntry('doc-nested-a', 'Discharge summary', 'Routine discharge'),
      ]),
      encounter('enc-doc-b', 'Dr Test', [
        nestedDocumentEntry('doc-nested-b', 'Discharge summary', 'Routine discharge'),
      ]),
    ],
  },
];
const nestedDocResult = analyzeJournal(nestedDocDayGroups);
assert(
  nestedDocResult.groups.some((g) => g.kind === 'document' && g.code === 'Discharge summary' && g.tier === TIER.REVIEW),
  'Two nested document entries in separate encounters form a candidate group, capped at REVIEW'
);

console.log('\n--- Flat + nested document dual-render (mirrors the note pattern) ---');
const dualRenderDocDayGroups = [
  {
    title: 'Wed 23 Jul 2025',
    items: [
      encounter('enc-doc-dual', 'Dr Test', [nestedDocumentEntry('doc-dual-nested', 'Referral Letter', '2WW referral')]),
      flatDocumentItem('doc-dual-flat', 'Referral Letter', '2WW referral'),
    ],
  },
];
const dualRenderDocResult = analyzeJournal(dualRenderDocDayGroups);
const dualRenderDocGroup = dualRenderDocResult.groups.find(
  (g) => g.kind === 'document' && g.code === 'Referral Letter'
);
assert(
  !!dualRenderDocGroup,
  'A flat document item and a nested document entry with matching content form a candidate group'
);
assert(
  dualRenderDocGroup && dualRenderDocGroup.tier === TIER.REVIEW,
  'Flat+nested document dual-render is capped at REVIEW, not EXACT'
);

console.log('\n--- UUIDv7 id-timestamp keeper tie-breaker (live-confirmed 2026-07-04) ---');
assert(decodeIdTimestamp('not-a-uuid') === null, 'decodeIdTimestamp returns null for a non-UUID id');
assert(
  decodeIdTimestamp('00000000-0001-7000-8000-000000000001') === 1,
  'decodeIdTimestamp decodes the leading 48-bit ms timestamp'
);

const EARLY_ID = '00000000-0001-7000-8000-000000000001';
const LATE_ID = '00000000-0002-7000-8000-000000000002';
const keeperDayGroups = [
  {
    title: 'Sat 16 Aug 2025',
    items: [
      flatDocumentItem(LATE_ID, 'Consultation report', 'Patient reviewed'),
      flatDocumentItem(EARLY_ID, 'Consultation report', 'Patient reviewed'),
    ],
  },
];
const keeperResult = analyzeJournal(keeperDayGroups);
const keeperGroup = keeperResult.groups.find((g) => g.kind === 'document' && g.code === 'Consultation report');
assert(!!keeperGroup, 'Keeper-tiebreaker fixture forms a candidate group');
assert(
  keeperGroup && keeperGroup.keeperEntryId === EARLY_ID,
  'The entry with the earlier id-embedded timestamp is marked keeper'
);
assert(
  keeperGroup && keeperGroup.entries.find((e) => e.id === EARLY_ID).isKeeper === true,
  'isKeeper flag set on the keeper entry'
);
assert(
  keeperGroup && keeperGroup.entries.find((e) => e.id === LATE_ID).isKeeper === false,
  'isKeeper flag NOT set on the later (reimport-artifact) entry'
);

console.log('\n--- parseGenericDocumentTitle / resolveDocumentTypeLabel unit checks (live-confirmed 2026-07-04) ---');
assert(
  parseGenericDocumentTitle(
    'Type: Referral letter Author Org: Kingston Hospital Custodian Org: Park Road Surgery Description: Internal to Gastro'
  ).Type === 'Referral letter',
  'parseGenericDocumentTitle extracts Type when all four segments are present'
);
assert(
  parseGenericDocumentTitle('Type: Clinical letter Custodian Org: Park Road Surgery').Type === 'Clinical letter',
  'parseGenericDocumentTitle extracts Type when only some segments are present'
);
assert(
  parseGenericDocumentTitle(
    'Custodian Org: Park Road Surgery Description: 2WW Pan London Urgent Suspected Skin Cancer Referral'
  ).Type === undefined,
  'parseGenericDocumentTitle yields no Type when the title has no Type: segment (the 2WW/SPA-referral exception)'
);
assert(
  Object.keys(parseGenericDocumentTitle('Routine discharge, no issues')).length === 0,
  'parseGenericDocumentTitle returns {} for a title that does not match the labelled shape at all'
);
assert(
  resolveDocumentTypeLabel(
    'Other digital signal',
    'Type: Clinical letter Author Org: Kingston Hospital Custodian Org: Park Road Surgery'
  ) === 'Clinical letter',
  'resolveDocumentTypeLabel recovers the real type from a genericised label'
);
assert(
  resolveDocumentTypeLabel('Referral Letter', 'anything') === 'Referral Letter',
  'resolveDocumentTypeLabel leaves a real (non-generic) documentTypeLabel unchanged'
);
assert(
  resolveDocumentTypeLabel(
    'Other digital signal',
    'Custodian Org: Park Road Surgery Description: 2WW Pan London Urgent Suspected Skin Cancer Referral'
  ) === 'Other digital signal',
  'resolveDocumentTypeLabel falls back to the literal generic label when no Type: is recoverable'
);

console.log('\n--- Genericised "Other digital signal" document matches its real-labelled original ---');
const genericLabelDayGroups = [
  {
    title: 'Sat 16 Aug 2025',
    items: [
      flatDocumentItem(
        'doc-generic-dup',
        'Other digital signal',
        'Type: Lower gastrointestinal tract endoscopy report Author Org: Kingston Hospital Custodian Org: Park Road Surgery'
      ),
      flatDocumentItem('doc-generic-original', 'Lower gastrointestinal tract endoscopy report', null, {
        organisationName: 'Kingston Hospital',
        documentAuthorDepartment: 'Endoscopy Unit',
      }),
    ],
  },
];
const genericLabelResult = analyzeJournal(genericLabelDayGroups);
const genericLabelGroup = genericLabelResult.groups.find(
  (g) => g.kind === 'document' && g.code === 'Lower gastrointestinal tract endoscopy report'
);
assert(
  !!genericLabelGroup,
  'A genericised "Other digital signal" document and its real-labelled original form a candidate group via title-recovered type'
);

console.log(
  '\n--- Generic document title with no Type: segment still groups under the literal label (2WW/SPA-referral case) ---'
);
const noTypeDayGroups = [
  {
    title: 'Tue 09 Sep 2025',
    items: [
      flatDocumentItem(
        'doc-notype-1',
        'Other digital signal',
        'Custodian Org: Park Road Surgery Description: 2WW Pan London Urgent Suspected Skin Cancer Referral'
      ),
      flatDocumentItem(
        'doc-notype-2',
        'Other digital signal',
        'Custodian Org: Park Road Surgery Description: 2WW Pan London Urgent Suspected Skin Cancer Referral'
      ),
    ],
  },
];
const noTypeResult = analyzeJournal(noTypeDayGroups);
assert(
  noTypeResult.groups.some((g) => g.kind === 'document' && g.code === 'Other digital signal'),
  'Two generic-titled documents with no recoverable Type: still group together under the literal generic label'
);

console.log('\n--- Same-consultation entries are not flagged as duplicates ---');
const sameConsultDayGroups = [
  {
    title: 'Fri 05 Jan 2024',
    items: [
      // Both notes nested in the SAME encounter — same code/author/day, but
      // one consultation legitimately mentioning it twice, not a duplicate.
      encounter('enc-same', 'Dr Test', [
        noteEntry('sc-1', 'Chest exam', 'Clear on auscultation.', 'Dr Test', 'Test Surgery'),
        noteEntry('sc-2', 'Chest exam', 'Clear on auscultation.', 'Dr Test', 'Test Surgery'),
      ]),
    ],
  },
];
const sameConsultResult = analyzeJournal(sameConsultDayGroups);
assert(
  !sameConsultResult.groups.some((g) => g.code === 'Chest exam'),
  'Two mentions within the SAME consultation do not form a duplicate group'
);

const crossConsultDayGroups = [
  {
    title: 'Fri 05 Jan 2024',
    items: [
      // Same code/author/day, but from two SEPARATE consultations — a
      // genuine candidate duplicate, must still be flagged.
      encounter('enc-cross-1', 'Dr Test', [
        noteEntry('cc-1', 'Chest exam', 'Clear on auscultation.', 'Dr Test', 'Test Surgery'),
      ]),
      encounter('enc-cross-2', 'Dr Test', [
        noteEntry('cc-2', 'Chest exam', 'Clear on auscultation.', 'Dr Test', 'Test Surgery'),
      ]),
    ],
  },
];
const crossConsultResult = analyzeJournal(crossConsultDayGroups);
assert(
  crossConsultResult.groups.some((g) => g.code === 'Chest exam' && g.tier === TIER.EXACT),
  'The same code/text/author across TWO SEPARATE consultations still forms an EXACT duplicate group'
);

console.log('\n--- GP2GP-wrapper coverage diagnostic ---');
const wrapperCoverageDayGroups = [
  {
    title: 'Mon 01 Jan 2024',
    items: [
      flatNoteItem(
        'wrap-strict',
        'Pigmented naevus',
        'Problem Info: Problem Notes: Mole on back {Episodicity : code=1, displayName=First}',
        'Dr Test',
        'Test Surgery'
      ),
      flatNoteItem(
        'wrap-nearmiss',
        'Skin tag',
        'A note mentioning Problem Info: partway through, not at the very start.',
        'Dr Test',
        'Test Surgery'
      ),
      flatNoteItem('wrap-clean', 'Sore throat', 'Nothing wrapper-like here at all.', 'Dr Test', 'Test Surgery'),
    ],
  },
];
const wrapperCoverageResult = analyzeJournal(wrapperCoverageDayGroups);
assert(
  wrapperCoverageResult.summary.gp2gpWrapperStrictMatches === 1,
  'One entry with the exact known wrapper shape counts as a strict match'
);
assert(
  wrapperCoverageResult.summary.gp2gpWrapperNearMisses === 1,
  'One entry with wrapper-like text not at the start counts as a near-miss, not a strict match'
);
assert(
  wrapperCoverageResult.gp2gpWrapperCoverage.nearMisses[0].kind === 'note' &&
    wrapperCoverageResult.gp2gpWrapperCoverage.nearMisses[0].sample.includes('Problem Info:'),
  'Near-miss entries carry enough detail (kind + text sample) to inspect manually'
);
assert(
  !wrapperCoverageResult.gp2gpWrapperCoverage.nearMisses.some(
    (nm) => nm.kind === 'note' && nm.sample.includes('Sore throat')
  ),
  'An entry with no wrapper-like text at all is neither a strict match nor a near-miss'
);

console.log('\n--- Document tier cap + questionnaire-template cross-check (live-confirmed 2026-07-05) ---');
// Reproduces the real false positive: two genuinely unrelated questionnaire-
// response documents sharing identical generic journal-payload metadata
// (same generic type label, same date, no distinguishing title) — must
// still group (so the user knows to check) but must NOT overclaim EXACT.
const genericQuestionnaireDayGroups = [
  {
    title: 'Wed 15 Oct 2025',
    items: [
      flatDocumentItem('doc-quest-1', 'Questionnaire (qualifier value)', null),
      flatDocumentItem('doc-quest-2', 'Questionnaire (qualifier value)', null),
    ],
  },
];
const genericQuestionnaireResult = analyzeJournal(genericQuestionnaireDayGroups);
const genericQuestionnaireGroup = genericQuestionnaireResult.groups.find(
  (g) => g.kind === 'document' && g.code === 'Questionnaire (qualifier value)'
);
assert(!!genericQuestionnaireGroup, 'Two generic-metadata questionnaire documents still form a candidate group');
assert(
  genericQuestionnaireGroup && genericQuestionnaireGroup.tier === TIER.REVIEW,
  'Generic-metadata questionnaire documents are capped at REVIEW, not EXACT'
);

// The pure cross-check helper: duplicate-checker.js fetches real
// questionnaireTemplateName values on-demand and passes them in here.
assert(
  hasQuestionnaireTemplateMismatch(genericQuestionnaireGroup, {
    'doc-quest-1': 'Asthma Review [PCIT]',
    'doc-quest-2': 'Triage - Dizziness [PCIT]',
  }) === true,
  'Two known, genuinely different questionnaireTemplateName values confirm the group is NOT a duplicate'
);
assert(
  hasQuestionnaireTemplateMismatch(genericQuestionnaireGroup, {
    'doc-quest-1': 'Asthma Review [PCIT]',
    'doc-quest-2': 'Asthma Review [PCIT]',
  }) === false,
  'Matching questionnaireTemplateName values do NOT confirm a mismatch'
);
assert(
  hasQuestionnaireTemplateMismatch(genericQuestionnaireGroup, { 'doc-quest-1': 'Asthma Review [PCIT]' }) === false,
  'Fewer than two known template names never confirms a mismatch (no guessing off incomplete data)'
);
assert(
  hasQuestionnaireTemplateMismatch(genericQuestionnaireGroup, {}) === false,
  'No known template names at all never confirms a mismatch'
);

console.log('\n--- Prescription issueQuantity hard exclusion (live-confirmed 2026-07-05) ---');
// Reproduces the real false positive: two acute Paracetamol issues, same
// product/dosage text, same day, but different issueQuantity (16 vs 24
// tablet) — a genuine reimport dual-render would carry the SAME quantity,
// so a mismatch here means these are two separate real issues.
const rxQuantityMismatchDayGroups = [
  {
    title: 'Tue 28 Apr 2026',
    items: [
      flatPrescriptionItem(
        'rx-quant-1',
        'Paracetamol 500mg tablets',
        'Take 1 to 2 tablets every 4 to 6 hours - as needed',
        '16 tablet',
        'Dr Hannah Garrard'
      ),
      flatPrescriptionItem(
        'rx-quant-2',
        'Paracetamol 500mg tablets',
        'Take 1 to 2 tablets every 4 to 6 hours - as needed',
        '24 tablet',
        'Dr Hannah Garrard'
      ),
    ],
  },
];
const rxQuantityMismatchResult = analyzeJournal(rxQuantityMismatchDayGroups);
assert(
  !rxQuantityMismatchResult.groups.some((g) => g.kind === 'prescription' && g.code === 'Paracetamol 500mg tablets'),
  'Same-day same-product prescriptions with different issueQuantity are excluded from candidate grouping entirely'
);
assert(
  rxQuantityMismatchResult.summary.suppressedQuantityMismatchTotal === 1,
  'The quantity-mismatch exclusion is tracked in the suppressed-quantity-mismatch diagnostic, not silently dropped'
);
assert(
  rxQuantityMismatchResult.suppressedQuantityMismatch[0].quantities.includes('16 tablet') &&
    rxQuantityMismatchResult.suppressedQuantityMismatch[0].quantities.includes('24 tablet'),
  'The suppression record carries the distinct quantities that triggered the exclusion'
);

// Control: same quantity, same day — must still group and tier normally
// (this exclusion must not over-fire on genuine same-quantity duplicates).
const rxQuantityMatchDayGroups = [
  {
    title: 'Tue 28 Apr 2026',
    items: [
      flatPrescriptionItem(
        'rx-match-1',
        'Paracetamol 500mg tablets',
        'Take 1 to 2 tablets every 4 to 6 hours - as needed',
        '16 tablet',
        'Dr Hannah Garrard'
      ),
      flatPrescriptionItem(
        'rx-match-2',
        'Paracetamol 500mg tablets',
        'Take 1 to 2 tablets every 4 to 6 hours - as needed',
        '16 tablet',
        'Dr Hannah Garrard'
      ),
    ],
  },
];
const rxQuantityMatchResult = analyzeJournal(rxQuantityMatchDayGroups);
const rxQuantityMatchGroup = rxQuantityMatchResult.groups.find(
  (g) => g.kind === 'prescription' && g.code === 'Paracetamol 500mg tablets'
);
assert(!!rxQuantityMatchGroup, 'Same-day same-product prescriptions with MATCHING issueQuantity still form a group');
assert(
  rxQuantityMatchGroup && rxQuantityMatchGroup.tier === TIER.EXACT,
  'Matching-quantity prescription duplicates still tier EXACT (exclusion did not over-fire)'
);

console.log('\n--- Prescription timing cross-check (live-confirmed 2026-07-05) ---');
assert(
  hasPrescriptionTimingMismatch(rxQuantityMatchGroup, {
    'rx-match-1': '2026-04-28 15:07:25',
    'rx-match-2': '2026-04-28 15:36:45',
  }) === true,
  'Real createdDateTime values ~29 minutes apart confirm these are separate real issues, not a duplicate'
);
assert(
  hasPrescriptionTimingMismatch(rxQuantityMatchGroup, {
    'rx-match-1': '2026-04-28 15:07:25',
    'rx-match-2': '2026-04-28 15:07:40',
  }) === false,
  'Real createdDateTime values under a minute apart do NOT confirm a mismatch (near-instant dual-render)'
);
assert(
  hasPrescriptionTimingMismatch(rxQuantityMatchGroup, { 'rx-match-1': '2026-04-28 15:07:25' }) === false,
  'Fewer than two known timestamps never confirms a mismatch (no guessing off incomplete data)'
);
assert(
  hasPrescriptionTimingMismatch(rxQuantityMatchGroup, {}) === false,
  'No known timestamps at all never confirms a mismatch'
);

console.log('\n--- Removal write-contract builder ---');
assert(isRemovableKind('problem') === true, '"problem" is a removable kind');
assert(isRemovableKind('note') === true, '"note" is a removable kind');
assert(isRemovableKind('prescription') === true, '"prescription" is a removable kind');
assert(
  isRemovableKind('communication') === false,
  '"communication" is not removable (bespoke visibility-enum contract, unhandled by the parser)'
);
assert(isRemovableKind('document') === true, '"document" is now removable (contract confirmed live 2026-07-08)');
assert(
  isRemovableKind('investigation-request') === false,
  '"investigation-request" is not removable (no confirmed write endpoint)'
);

const problemReq = buildRemovalRequest(
  'problem',
  'https://abc.api.england.medicus.health',
  'problem-1',
  'Duplicate GP2GP import'
);
assert(
  problemReq.url === 'https://abc.api.england.medicus.health/clinical/problem/mark-incorrect-and-hidden',
  'problem removal request targets the confirmed clinical/problem/mark-incorrect-and-hidden URL'
);
assert(
  problemReq.body.problemId === 'problem-1' &&
    problemReq.body.reason === 'Duplicate GP2GP import' &&
    problemReq.body.isConfirmedRemoval === true,
  'problem removal request body matches the confirmed {problemId, reason, isConfirmedRemoval} contract'
);

const noteReq = buildRemovalRequest('note', 'https://abc.api.england.medicus.health', 'note-1', 'Duplicate');
assert(
  noteReq.url === 'https://abc.api.england.medicus.health/patient/note/mark-incorrect-and-hidden' &&
    noteReq.body.noteId === 'note-1',
  'note removal request uses the confirmed patient/note/... URL and noteId field (the one outlier prefix)'
);

const prescriptionReq = buildRemovalRequest(
  'prescription',
  'https://abc.api.england.medicus.health',
  'rx-1',
  'Duplicate'
);
assert(
  prescriptionReq.url === 'https://abc.api.england.medicus.health/clinical/prescription/mark-incorrect-and-hidden' &&
    prescriptionReq.body.prescriptionId === 'rx-1',
  'prescription removal request uses the confirmed clinical/prescription/... URL and prescriptionId field'
);

const documentReq = buildRemovalRequest(
  'document',
  'https://abc.api.england.medicus.health',
  '0195245a-de5f-71da-beeb-c94533df4148',
  'Remove - duplicate GP2GP'
);
assert(
  documentReq.url === 'https://abc.api.england.medicus.health/clinical/document/mark-incorrect-and-hidden',
  'document removal targets the confirmed clinical/document/mark-incorrect-and-hidden URL (the "remove from record" action that truly hides — NOT the strike-only clinical/document/mark-incorrect)'
);
assert(
  JSON.stringify(documentReq.body) ===
    JSON.stringify({
      inboundDocumentId: '0195245a-de5f-71da-beeb-c94533df4148',
      reason: 'Remove - duplicate GP2GP',
      isConfirmedRemoval: true,
    }),
  'document removal body matches the captured POST: {inboundDocumentId, reason, isConfirmedRemoval:true} (same family as the other three, only the id field name differs)'
);

assert(
  buildRemovalRequest('communication', 'https://abc.api.england.medicus.health', 'c-1', 'Duplicate') === null,
  'buildRemovalRequest returns null for a non-removable kind rather than guessing a contract'
);
assert(
  buildRemovalRequest('problem', 'https://abc.api.england.medicus.health', 'problem-1', '') === null,
  'buildRemovalRequest returns null for a blank reason'
);
assert(
  buildRemovalRequest('problem', 'https://abc.api.england.medicus.health', 'problem-1', '   ') === null,
  'buildRemovalRequest returns null for a whitespace-only reason'
);
assert(
  buildRemovalRequest('problem', 'https://abc.api.england.medicus.health', null, 'Duplicate') === null,
  'buildRemovalRequest returns null for a missing entry id'
);
assert(
  buildRemovalRequest('problem', null, 'problem-1', 'Duplicate') === null,
  'buildRemovalRequest returns null for a missing apiBase'
);

console.log('\n--- splitWrapperText (case-preserving GP2GP wrapper split) ---');
{
  const wrapped = splitWrapperText(
    'Problem Info: Problem Notes: Right - see clinic letter {Episodicity : code=255217005, displayName=First}'
  );
  assert(wrapped.prefix.toLowerCase().startsWith('problem info:'), 'wrapped text: prefix captured verbatim');
  assert(wrapped.content.trim() === 'Right - see clinic letter', 'wrapped text: content has prefix/suffix stripped');
  assert(wrapped.suffix.toLowerCase().includes('episodicity'), 'wrapped text: suffix captured verbatim');
  assert(
    /Right/.test(wrapped.content) && !/right/.test(wrapped.content.replace(/Right/, '')),
    'wrapped text: original casing preserved in content (unlike normText)'
  );

  const plain = splitWrapperText('Just a normal note, no wrapper here.');
  assert(plain.prefix === '' && plain.suffix === '', 'plain text: no prefix/suffix detected');
  assert(plain.content === 'Just a normal note, no wrapper here.', 'plain text: content unchanged');

  const empty = splitWrapperText(null);
  assert(
    empty.prefix === '' && empty.content === '' && empty.suffix === '',
    'null input degrades to all-empty, no throw'
  );
}

console.log('\n--- isJunkRecordedBy (evidence-based junk-user list) ---');
assert(isJunkRecordedBy('User Previous Practice') === true, 'known junk-user pattern matches case-insensitively');
assert(
  isJunkRecordedBy('  user previous practice  ') === true,
  'known junk-user pattern matches with surrounding whitespace'
);
assert(isJunkRecordedBy('Dr Nicholas Grundy') === false, 'a real clinician name does not match');
assert(
  isJunkRecordedBy('User Previous Practice Nurse') === false,
  'exact match only — a superstring of the known pattern is not misflagged'
);
assert(isJunkRecordedBy(null) === false, 'null recordedBy is not junk');
assert(isJunkRecordedBy('') === false, 'empty recordedBy is not junk');

console.log('\n--- wordDiff (whitespace-tokenized LCS diff) ---');
{
  const identical = wordDiff('same text here', 'same text here');
  assert(identical.length === 1 && identical[0].op === 'equal', 'identical strings produce a single equal segment');

  const fullyDifferent = wordDiff('alpha beta', 'gamma delta');
  assert(
    fullyDifferent.every((s) => s.op !== 'equal'),
    'fully different strings produce no equal segments'
  );
  assert(
    fullyDifferent.some((s) => s.op === 'delete') && fullyDifferent.some((s) => s.op === 'insert'),
    'fully different strings produce both delete and insert segments'
  );

  // Shaped like the real "moderate exercise" finding that resolved as
  // correctly-tiered REVIEW (not a parser bug) — see project history.
  const partial = wordDiff('Enjoys walking daily', 'Enjoys moderate exercise daily');
  const insertText = partial
    .filter((s) => s.op === 'insert')
    .map((s) => s.text)
    .join(' ');
  assert(
    partial.some((s) => s.op === 'equal' && /enjoys/i.test(s.text)),
    'partial overlap: shared leading word recognised as equal'
  );
  assert(/moderate exercise/.test(insertText), 'partial overlap: the genuinely new content is captured as insert');

  const bothEmpty = wordDiff('', '');
  assert(bothEmpty.length === 0, 'two empty strings produce no segments');

  const oneEmpty = wordDiff('some text', '');
  assert(
    oneEmpty.length === 1 && oneEmpty[0].op === 'delete',
    'text vs empty produces a single delete segment covering everything'
  );
}

console.log('\n--- buildMergeSuggestion (REVIEW-tier merge draft) ---');
{
  const reviewGroup = {
    kind: 'note',
    entries: [
      {
        id: 'note-a',
        recordedBy: 'User Previous Practice',
        rawText: 'Problem Info: Problem Notes: Enjoys walking daily {Episodicity : code=1, displayName=First}',
      },
      { id: 'note-b', recordedBy: 'Dr Nicholas Grundy', rawText: 'Enjoys moderate exercise daily' },
    ],
  };
  const suggestion = buildMergeSuggestion(reviewGroup);
  assert(
    suggestion.sources.find((s) => s.entryId === 'note-a').isJunkUser === true,
    'merge suggestion flags the junk-user source entry'
  );
  assert(
    suggestion.sources.find((s) => s.entryId === 'note-b').isJunkUser === false,
    'merge suggestion does not flag the genuine clinician source entry'
  );
  assert(
    suggestion.sources.find((s) => s.entryId === 'note-a').hadWrapper === true,
    'merge suggestion flags the entry that had a GP2GP wrapper'
  );
  assert(!/problem info/i.test(suggestion.suggestedText), 'merge suggestion never includes GP2GP wrapper boilerplate');
  assert(
    /moderate exercise/.test(suggestion.suggestedText),
    'merge suggestion prefers the non-junk-user entry as reference and folds in the distinguishing content'
  );

  const emptyGroup = buildMergeSuggestion({ kind: 'note', entries: [] });
  assert(
    emptyGroup.suggestedText === '' && emptyGroup.sources.length === 0,
    'an empty group degrades to an empty suggestion, no throw'
  );
}

console.log('\n--- Note edit contract (buildNoteEditUrl / buildNoteChangeRequest) ---');
assert(
  buildNoteEditUrl('https://abc.api.england.medicus.health', 'note-1') ===
    'https://abc.api.england.medicus.health/clinical/data/note/edit-note/note-1',
  'buildNoteEditUrl targets the confirmed clinical/data/note/edit-note/{noteId} URL'
);
assert(buildNoteEditUrl(null, 'note-1') === null, 'buildNoteEditUrl returns null for a missing apiBase');
assert(
  buildNoteEditUrl('https://abc.api.england.medicus.health', null) === null,
  'buildNoteEditUrl returns null for a missing noteId'
);

const safeNoteObject = {
  noteId: 'note-1',
  note: 'Old text',
  noteSNOMEDct: { conceptId: '45352006', description: 'Muscle spasm', descriptionId: '4695177012' },
  hiddenFromPatientFacingServices: false,
  confidentialFromThirdParties: false,
  flagOnPatientBanner: false,
  recordedByOrganisation: null,
  recordedByOrganisationManual: null,
  recordedByPractitioner: 'Dr Nicholas Grundy',
  recordedByStaff: '0192351f-fd7f-725c-a267-2120c486b6be',
  recordDate: '2026-06-23',
  recordedAtAnotherOrganisation: false,
  flags: [],
  linkedProblemIds: [],
  linkedClinicalCase: { defaultClinicalCaseId: null },
};

const changeReq = buildNoteChangeRequest('https://abc.api.england.medicus.health', safeNoteObject, 'Merged text');
assert(
  changeReq.url === 'https://abc.api.england.medicus.health/clinical/note/change-note',
  'buildNoteChangeRequest targets the confirmed clinical/note/change-note URL'
);
assert(
  changeReq.body.noteId === 'note-1' &&
    changeReq.body.note === 'Merged text' &&
    changeReq.body.noteSNOMEDct.conceptId === '45352006' &&
    changeReq.body.recordedByStaff === '0192351f-fd7f-725c-a267-2120c486b6be' &&
    changeReq.body.recordDate === '2026-06-23' &&
    changeReq.body.clinicalCaseId === null,
  'buildNoteChangeRequest reproduces every other field from the fetched note unchanged'
);

// Previous-practice round-trip CONFIRMED live 2026-07-08 (real "Patient
// de-registration" note, GET + successful POST captured) — the old blanket
// refusals on recordedAtAnotherOrganisation / manual org are lifted; the
// POST carries the same 13 keys as a local note, org as the structured
// null-identifier object.
const prevPracticeNote = {
  ...safeNoteObject,
  noteId: '019c22bf-387e-7174-a33b-045ee204a256',
  note: 'by transfer of GP to GP electronic record',
  noteSNOMEDct: { conceptId: '184171009', description: 'Patient de-registration', descriptionId: null },
  recordedAtAnotherOrganisation: true,
  organisationEntry: 'manual',
  recordedByOrganisation: {
    organisationName: 'prev GP',
    organisationIdentifierType: null,
    organisationIdentifierValue: null,
  },
  recordedByOrganisationManual: 'prev GP',
  recordedByPractitioner: 'User Previous Practice',
  recordedByStaff: null,
  recordDate: '2013-11-21',
};
const prevReq = buildNoteChangeRequest(
  'https://abc.api.england.medicus.health',
  prevPracticeNote,
  'by transfer of GP to GP electronic record'
);
assert(
  JSON.stringify(prevReq.body) ===
    JSON.stringify({
      noteId: '019c22bf-387e-7174-a33b-045ee204a256',
      note: 'by transfer of GP to GP electronic record',
      noteSNOMEDct: { conceptId: '184171009', description: 'Patient de-registration', descriptionId: null },
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
      flagOnPatientBanner: false,
      recordedByOrganisation: {
        organisationName: 'prev GP',
        organisationIdentifierType: null,
        organisationIdentifierValue: null,
      },
      recordedByPractitioner: 'User Previous Practice',
      recordedByStaff: null,
      recordDate: '2013-11-21',
      flags: [],
      clinicalCaseId: null,
      linkedProblemIds: [],
    }),
  'a previous-practice note builds a body EXACTLY matching the real captured POST (recordedAtAnotherOrganisation/organisationEntry/manual are GET-only, never sent)'
);
const manualOnlyOrgNote = { ...prevPracticeNote, recordedByOrganisation: null };
assert(
  buildNoteChangeRequest('https://abc.api.england.medicus.health', manualOnlyOrgNote, 'x').body.recordedByOrganisation
    .organisationName === 'prev GP',
  'an org stored only as manual text posts as the structured null-identifier object'
);
const orglessPrevNote = { ...prevPracticeNote, recordedByOrganisation: null, recordedByOrganisationManual: null };
assert(
  buildNoteChangeRequest('https://abc.api.england.medicus.health', orglessPrevNote, 'x') === null,
  'a previous-practice note with NO org name anywhere still refuses — Medicus itself will not save that state'
);
assert(
  buildNoteChangeRequest('https://abc.api.england.medicus.health', orglessPrevNote, 'x', 'Previous GP').body
    .recordedByOrganisation.organisationName === 'Previous GP',
  'a caller-supplied organisation name (the UI prompt) unblocks it, in the confirmed manual-entry shape'
);
assert(
  resolveNoteOrganisation(prevPracticeNote, null).organisationName === 'prev GP' &&
    resolveNoteOrganisation(orglessPrevNote, '  ') === null,
  'resolveNoteOrganisation walks structured → manual → supplied and never returns a blank name'
);
assert(
  buildNoteChangeRequest('https://abc.api.england.medicus.health', safeNoteObject, 'Merged text').body
    .recordedByOrganisation === null,
  'a local note with no org still posts recordedByOrganisation: null (the June-confirmed local contract, unchanged)'
);
assert(
  buildNoteChangeRequest(
    'https://abc.api.england.medicus.health',
    { ...safeNoteObject, linkedClinicalCase: { defaultClinicalCaseId: 'case-1' } },
    'Merged text'
  ) === null,
  'buildNoteChangeRequest refuses when a real linked clinical case is present (mapping never live-tested non-null)'
);
assert(
  buildNoteChangeRequest('https://abc.api.england.medicus.health', safeNoteObject, '') === null,
  'buildNoteChangeRequest refuses a blank merged text'
);
assert(
  buildNoteChangeRequest(
    'https://abc.api.england.medicus.health',
    { ...safeNoteObject, noteId: null },
    'Merged text'
  ) === null,
  'buildNoteChangeRequest refuses a note object missing noteId'
);
assert(
  buildNoteChangeRequest(null, safeNoteObject, 'Merged text') === null,
  'buildNoteChangeRequest refuses a missing apiBase'
);

console.log('\n--- Document edit contract (buildDocumentEditDetailsUrl / buildDocumentEditRequest) ---');
{
  // Fixture mirrors the real confirmed capture (2026-07-08): GET
  // clinical/data/document/edit-details/{id} model for an Urgent Care
  // Summary Report, whose Save POSTed the exact body asserted below.
  const safeDocumentEditModel = {
    documentId: 'doc-1',
    code: {
      label: 'Urgent Care Summary Report',
      value: {
        conceptId: '312341000000104',
        description: 'Urgent Care Summary Report',
        descriptionId: '564151000000112',
      },
    },
    authoredByOrganisation: {
      label: 'Teddington Memorial Hospital',
      value: {
        organisationName: 'Teddington Memorial Hospital',
        organisationIdentifierType: 'nhs-england-ods-code',
        organisationIdentifierValue: '36LAA',
      },
    },
    manualAuthoredByOrganisation: 'Teddington Memorial Hospital',
    authoredByDepartment: null,
    authoredByPractitioner: null,
    shouldEnterAuthoredByOrganisationManually: true,
    clinicalSpecialty: null,
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    documentType: 'other',
    title: null,
    additionalInformation: null,
    patientId: 'patient-1',
    recordDate: '2026-05-07',
    documentDate: '2026-05-07',
    modelVersionHash: 'hash-1',
    authorOrganisationOption: 'other',
    selectedStaff: [],
    linkedProblems: [],
    linkedClinicalCase: { options: [], defaultClinicalCaseId: null, requiresClinicalCase: false },
    versionId: 'v-1',
    isDraft: false,
    isMarkedIncorrect: false,
  };
  const apiBase = 'https://abc.api.england.medicus.health';

  assert(
    buildDocumentEditDetailsUrl(apiBase, 'doc-1') === `${apiBase}/clinical/data/document/edit-details/doc-1`,
    'buildDocumentEditDetailsUrl targets the confirmed clinical/data/document/edit-details/{documentId} URL'
  );
  assert(buildDocumentEditDetailsUrl(null, 'doc-1') === null, 'buildDocumentEditDetailsUrl refuses a missing apiBase');
  assert(buildDocumentEditDetailsUrl(apiBase, null) === null, 'buildDocumentEditDetailsUrl refuses a missing documentId');

  const req = buildDocumentEditRequest(apiBase, safeDocumentEditModel, {});
  assert(
    req && req.url === `${apiBase}/clinical/document/edit-details` && req.method === 'POST',
    'edit request targets the confirmed POST clinical/document/edit-details URL (documentId in the body, not the URL)'
  );
  assert(req.body.documentId === 'doc-1', 'body carries the documentId');
  assert(
    req.body.code.conceptId === '312341000000104' &&
      req.body.code.description === 'Urgent Care Summary Report' &&
      req.body.code.descriptionId === '564151000000112' &&
      req.body.code.label === undefined,
    "body.code is the GET model's code.value projection (conceptId/description/descriptionId, no label wrapper)"
  );
  assert(
    req.body.authoredByOrganisation.organisationName === 'Teddington Memorial Hospital' &&
      req.body.authoredByOrganisation.organisationIdentifierType === 'nhs-england-ods-code' &&
      req.body.authoredByOrganisation.organisationIdentifierValue === '36LAA',
    "body.authoredByOrganisation is the GET model's authoredByOrganisation.value projection"
  );
  assert(req.body.modelVersionHash === 'hash-1', 'modelVersionHash is echoed back verbatim (concurrency guard)');
  assert(
    Array.isArray(req.body.linkedProblemIds) &&
      req.body.linkedProblemIds.length === 0 &&
      req.body.clinicalCaseId === null &&
      Array.isArray(req.body.selectedStaff) &&
      req.body.selectedStaff.length === 0,
    'linkedProblems posts as empty linkedProblemIds; clinicalCaseId/selectedStaff post empty (only shapes ever confirmed)'
  );
  const expectedKeys = [
    'documentId',
    'code',
    'documentDate',
    'authoredByDepartment',
    'authoredByPractitioner',
    'clinicalSpecialty',
    'authoredByOrganisation',
    'hiddenFromPatientFacingServices',
    'confidentialFromThirdParties',
    'title',
    'additionalInformation',
    'recordDate',
    'authorOrganisationOption',
    'selectedStaff',
    'linkedProblemIds',
    'clinicalCaseId',
    'modelVersionHash',
  ];
  assert(
    JSON.stringify(Object.keys(req.body)) === JSON.stringify(expectedKeys),
    'body has exactly the 17 keys of the confirmed capture, in its order — nothing extra sent, nothing dropped'
  );
  assert(
    req.body.documentType === undefined && req.body.patientId === undefined && req.body.versionId === undefined,
    'GET-model-only fields (documentType/patientId/versionId) are never posted'
  );

  const overridden = buildDocumentEditRequest(apiBase, safeDocumentEditModel, {
    title: 'NHS 111 report',
    recordDate: '2026-05-08',
  });
  assert(
    overridden && overridden.body.title === 'NHS 111 report' && overridden.body.recordDate === '2026-05-08',
    'title/recordDate overrides replace the model values in the posted body'
  );
  assert(
    overridden.body.documentDate === '2026-05-07' && overridden.body.modelVersionHash === 'hash-1',
    'un-overridden fields still come from the fetched model'
  );
  const codeOverride = buildDocumentEditRequest(apiBase, safeDocumentEditModel, {
    code: { conceptId: '25781000000108', description: 'Out of hours report', descriptionId: '2326201000000118' },
  });
  assert(
    codeOverride && codeOverride.body.code.conceptId === '25781000000108',
    'a posted-shape code override replaces the document type'
  );
  assert(
    buildDocumentEditRequest(apiBase, safeDocumentEditModel, { code: { conceptId: 'x' } }) === null,
    'a malformed code override (missing description/descriptionId) is refused, never sent partial'
  );
  assert(
    buildDocumentEditRequest(apiBase, safeDocumentEditModel, { recordDate: '08 May 2026' }) === null,
    'a display-format date override is refused — only the ISO shape ever seen in the confirmed POST is sent'
  );
  assert(
    buildDocumentEditRequest(apiBase, safeDocumentEditModel, { fileType: 'pdf' }) === null,
    'an override key outside the confirmed writable set is refused outright'
  );

  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, modelVersionHash: null }, {}) === null,
    'refuses a missing modelVersionHash — the concurrency guard is echoed, never fabricated'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, isMarkedIncorrect: true }, {}) === null,
    'refuses an already-marked-incorrect document'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, isDraft: true }, {}) === null,
    'refuses a draft document'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, authoredByPractitioner: 'staff-1' }, {}) === null,
    'refuses a non-null authoredByPractitioner (never live-tested non-null)'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, clinicalSpecialty: 'Dermatology' }, {}) === null,
    'refuses a non-null clinicalSpecialty (posted encoding never live-tested)'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, selectedStaff: [{ value: 's-1' }] }, {}) === null,
    'refuses non-empty selectedStaff (posted member shape never live-tested)'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, linkedProblems: [{ value: 'p-1' }] }, {}) === null,
    'refuses non-empty linkedProblems (GET-member to posted-id mapping never live-tested)'
  );
  assert(
    buildDocumentEditRequest(
      apiBase,
      { ...safeDocumentEditModel, linkedClinicalCase: { defaultClinicalCaseId: 'case-1' } },
      {}
    ) === null,
    'refuses a real linked clinical case (same never-live-tested discipline as the note contract)'
  );
  assert(buildDocumentEditRequest(null, safeDocumentEditModel, {}) === null, 'refuses a missing apiBase');
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, documentId: null }, {}) === null,
    'refuses a model missing documentId'
  );
  assert(
    buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, code: { label: 'x', value: null } }, {}) === null,
    'refuses a model with no readable code.value'
  );
  const manualOrgOnly = buildDocumentEditRequest(apiBase, { ...safeDocumentEditModel, authoredByOrganisation: null }, {});
  assert(
    manualOrgOnly &&
      manualOrgOnly.body.authoredByOrganisation.organisationName === 'Teddington Memorial Hospital' &&
      manualOrgOnly.body.authoredByOrganisation.organisationIdentifierValue === null,
    'a model with no structured authoredByOrganisation.value falls back to its manual org text (name with null identifiers — the confirmed manual-entry shape)'
  );

  assert(getDocumentEditValue(safeDocumentEditModel, 'title') === null, 'getDocumentEditValue: a stored null title reads as null (a legitimate value)');
  assert(
    getDocumentEditValue(safeDocumentEditModel, 'code').conceptId === '312341000000104',
    'getDocumentEditValue: code reads the posted-shape .value object'
  );
  assert(
    getDocumentEditValue(safeDocumentEditModel, 'fileType') === undefined,
    'getDocumentEditValue: an unknown editKey reads as undefined (cannot-read), distinct from stored null'
  );
  assert(getDocumentEditValue(null, 'title') === undefined, 'getDocumentEditValue: a missing model reads as undefined');

  const sourceModel = {
    ...safeDocumentEditModel,
    documentId: 'doc-2',
    title: 'Skin lesion clinic letter',
    recordDate: '2026-05-13',
    code: {
      label: 'Clinical letter',
      value: { conceptId: '823671000000101', description: 'Clinical letter', descriptionId: '2470601000000117' },
    },
  };
  const { overrides, unapplied } = buildDocumentEditOverrides(
    [
      { editKey: 'title', entryId: 'doc-2' },
      { editKey: 'recordDate', entryId: 'doc-2' },
      { editKey: 'authoredByOrganisation', entryId: 'doc-2' },
    ],
    { 'doc-2': sourceModel }
  );
  assert(
    overrides.title === 'Skin lesion clinic letter' && overrides.recordDate === '2026-05-13',
    "buildDocumentEditOverrides reads each picked value from the source copy's own edit model"
  );
  assert(
    overrides.authoredByOrganisation.organisationName === 'Teddington Memorial Hospital' &&
      overrides.authorOrganisationOption === 'other',
    "picking the Author also carries the source copy's authorOrganisationOption (they travel together in the form)"
  );
  assert(unapplied.length === 0, 'nothing lands in unapplied when every pick is readable');

  const applied = buildDocumentEditRequest(apiBase, safeDocumentEditModel, overrides);
  assert(
    applied && applied.body.title === 'Skin lesion clinic letter' && applied.body.recordDate === '2026-05-13',
    'the overrides round-trip into a sendable request against the kept copy'
  );

  const partial = buildDocumentEditOverrides(
    [
      { editKey: 'created', entryId: 'doc-2' },
      { editKey: 'title', entryId: 'doc-3' },
      { editKey: 'code', entryId: 'doc-4' },
    ],
    { 'doc-2': sourceModel, 'doc-4': { ...sourceModel, code: null } }
  );
  assert(
    Object.keys(partial.overrides).length === 0 && partial.unapplied.length === 3,
    'unreadable picks are never guessed into overrides'
  );
  assert(
    partial.unapplied.find((u) => u.editKey === 'created').reason === 'not-writable' &&
      partial.unapplied.find((u) => u.editKey === 'title').reason === 'no-edit-model' &&
      partial.unapplied.find((u) => u.editKey === 'code').reason === 'source-value-missing',
    'each unapplied pick carries the specific reason (not-writable / no-edit-model / source-value-missing)'
  );

  const nullTitle = buildDocumentEditOverrides([{ editKey: 'title', entryId: 'doc-5' }], {
    'doc-5': { ...sourceModel, title: null },
  });
  assert(
    'title' in nullTitle.overrides && nullTitle.overrides.title === null && nullTitle.unapplied.length === 0,
    'a null source title IS applied (the one writable field where null is a legitimate stored value)'
  );

  // Preview fallbacks (2026-07-08, after a live all-picks-refused failure):
  // a reimport copy's edit model can hold null structured values even
  // though its preview displays fine. The preview's document.typeCode is
  // the exact posted code shape, and its document.recordDate is ISO — both
  // confirmed on every real payload seen; nothing else gets a fallback.
  const degradedModel = { ...sourceModel, code: { label: 'x', value: null }, recordDate: null };
  const previewForFallback = {
    'doc-2': {
      document: {
        typeCode: { conceptId: '25781000000108', description: 'Out of hours report', descriptionId: '2326201000000118', originalCodes: [] },
        recordDate: '2026-02-22',
        documentDate: '22 Feb 2026',
      },
    },
  };
  const fallback = buildDocumentEditOverrides(
    [
      { editKey: 'code', entryId: 'doc-2' },
      { editKey: 'recordDate', entryId: 'doc-2' },
    ],
    { 'doc-2': degradedModel },
    previewForFallback
  );
  assert(
    fallback.unapplied.length === 0 &&
      fallback.overrides.code.conceptId === '25781000000108' &&
      fallback.overrides.code.descriptionId === '2326201000000118' &&
      fallback.overrides.code.originalCodes === undefined,
    "a null edit-model code falls back to the preview's typeCode (exact posted shape, originalCodes never leaked)"
  );
  assert(
    fallback.overrides.recordDate === '2026-02-22',
    "a null edit-model recordDate falls back to the preview's ISO recordDate"
  );
  const noPreviewFallback = buildDocumentEditOverrides(
    [
      { editKey: 'code', entryId: 'doc-2' },
      { editKey: 'documentDate', entryId: 'doc-2' },
      { editKey: 'authoredByOrganisation', entryId: 'doc-2' },
    ],
    {
      'doc-2': { ...degradedModel, documentDate: null, authoredByOrganisation: null, manualAuthoredByOrganisation: null },
    }
  );
  assert(
    noPreviewFallback.unapplied.length === 3 &&
      noPreviewFallback.unapplied.every((u) => u.reason === 'source-value-missing'),
    'without a preview (existing callers) and no evidence anywhere, the null-value refusal is unchanged — full backward compatibility'
  );
  const noFallbackForDocDate = buildDocumentEditOverrides(
    [{ editKey: 'documentDate', entryId: 'doc-2' }],
    { 'doc-2': { ...degradedModel, documentDate: null } },
    previewForFallback
  );
  assert(
    noFallbackForDocDate.unapplied.length === 1 && noFallbackForDocDate.unapplied[0].reason === 'source-value-missing',
    'documentDate (display-formatted in the preview) gets NO fallback — refused, never guessed'
  );

  // Organisation evidence chain (2026-07-08, after a live Author refusal on
  // a GP2GP pair): structured value → manual text → preview displayed
  // author. Name-with-null-identifiers is a CONFIRMED stored shape (the
  // first real edit model captured stored exactly that), so the text
  // fallbacks fill a blank required field rather than fabricating
  // identifiers.
  assert(
    resolveDocumentOrganisation(safeDocumentEditModel, null).organisationIdentifierValue === '36LAA',
    "resolveDocumentOrganisation prefers the edit model's structured value when present"
  );
  const manualOrg = resolveDocumentOrganisation(
    { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: 'OOH - SW London' },
    null
  );
  assert(
    manualOrg.organisationName === 'OOH - SW London' &&
      manualOrg.organisationIdentifierType === null &&
      manualOrg.organisationIdentifierValue === null,
    'falls back to the manually-typed organisation text, with explicit null identifiers (the confirmed manual-entry shape)'
  );
  const previewOrg = resolveDocumentOrganisation(
    { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: null },
    { document: { authoredByText: 'Kingston Hospital' } }
  );
  assert(
    previewOrg.organisationName === 'Kingston Hospital' && previewOrg.organisationIdentifierValue === null,
    "falls back to the preview's displayed author text when the edit form holds nothing at all"
  );
  const titleOrg = resolveDocumentOrganisation(
    { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: null },
    {
      document: {
        authoredByText: null,
        title: 'Type: Clinical letter Author Org: Kingston Hospital Custodian Org: Park Road Surgery 07 May 2025',
      },
    }
  );
  assert(
    titleOrg.organisationName === 'Kingston Hospital' && titleOrg.organisationIdentifierValue === null,
    'falls back to the "Author Org:" segment GP2GP flattens into the genericised title — label-bounded, so clean of the trailing custodian/date text'
  );
  assert(
    resolveDocumentOrganisation(
      { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: '  ' },
      { document: { authoredByText: '', title: 'An ordinary title with no labelled segments' } }
    ) === null,
    'returns null only when no organisation name exists anywhere — never an empty/whitespace name, never custodian text'
  );

  const authorFallback = buildDocumentEditOverrides(
    [{ editKey: 'authoredByOrganisation', entryId: 'doc-2' }],
    { 'doc-2': { ...sourceModel, authoredByOrganisation: null, manualAuthoredByOrganisation: null } },
    { 'doc-2': { document: { authoredByText: 'Kingston Hospital' } } }
  );
  assert(
    authorFallback.unapplied.length === 0 &&
      authorFallback.overrides.authoredByOrganisation.organisationName === 'Kingston Hospital' &&
      authorFallback.overrides.authorOrganisationOption === 'other',
    "a picked Author with no structured value applies via the evidence chain, carrying the source's authorOrganisationOption (defaulting to 'other')"
  );
  const authorNoEvidence = buildDocumentEditOverrides(
    [{ editKey: 'authoredByOrganisation', entryId: 'doc-2' }],
    { 'doc-2': { ...sourceModel, authoredByOrganisation: null, manualAuthoredByOrganisation: null } },
    { 'doc-2': { document: { authoredByText: null } } }
  );
  assert(
    authorNoEvidence.unapplied.length === 1 && authorNoEvidence.unapplied[0].reason === 'source-value-missing',
    'a picked Author still refuses when no name exists anywhere on the source copy'
  );

  const keeperBlankOrg = buildDocumentEditRequest(
    apiBase,
    { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: 'OOH - SW London' },
    {}
  );
  assert(
    keeperBlankOrg && keeperBlankOrg.body.authoredByOrganisation.organisationName === 'OOH - SW London',
    "a kept copy whose org exists only as manual text still builds — the blank required field can't block edits to other fields"
  );
  assert(
    buildDocumentEditRequest(
      apiBase,
      { ...safeDocumentEditModel, authoredByOrganisation: null, manualAuthoredByOrganisation: null },
      {}
    ) === null,
    'a kept copy with no org name anywhere (and no override) still refuses — the POST requires an organisation'
  );

  const comparisonRows = buildDocumentFieldComparison({ entries: [{ id: 'a' }, { id: 'b' }] }, {}).rows;
  assert(
    comparisonRows.find((r) => r.label === 'Title').editKey === 'title' &&
      comparisonRows.find((r) => r.label === 'Record date').editKey === 'recordDate' &&
      comparisonRows.find((r) => r.label === 'Author').editKey === 'authoredByOrganisation',
    'comparison rows with a confirmed write mapping expose their editKey'
  );
  assert(
    comparisonRows.find((r) => r.label === 'Created').editKey === null &&
      comparisonRows.find((r) => r.label === 'File size').editKey === null &&
      comparisonRows.find((r) => r.label === 'Clinical specialty').editKey === null,
    'system-derived and never-live-tested rows stay editKey-less (reference-only)'
  );
  assert(
    ['Created', 'Filed', 'File type', 'File size'].every(
      (l) => comparisonRows.find((r) => r.label === l).systemManaged === true
    ),
    'Created/Filed/File type/File size rows are flagged systemManaged (audit fields — the kept copy retains its own)'
  );
  assert(
    ['Title', 'Type', 'Document date', 'Author', 'Clinical specialty', 'Record date'].every(
      (l) => comparisonRows.find((r) => r.label === l).systemManaged === false
    ),
    'no pickable row is ever flagged systemManaged'
  );

  // clinicalSpecialty arrives as a plain string on some real payloads and
  // an object on others (live finding 2026-07-08: visible value
  // "Dermatology" rendered as "[object Object]").
  const specialtyRow = (shape) =>
    buildDocumentFieldComparison(
      { entries: [{ id: 'a' }, { id: 'b' }] },
      {
        a: { document: { clinicalSpecialty: shape } },
        b: { document: { clinicalSpecialty: null } },
      }
    ).rows.find((r) => r.label === 'Clinical specialty');
  assert(
    specialtyRow('Dermatology').values[0].value === 'Dermatology',
    'a plain-string clinicalSpecialty passes through unchanged'
  );
  assert(
    specialtyRow({ description: 'Dermatology' }).values[0].value === 'Dermatology' &&
      specialtyRow({ label: 'Dermatology' }).values[0].value === 'Dermatology' &&
      specialtyRow({ value: { description: 'Dermatology' } }).values[0].value === 'Dermatology',
    'an object-shaped clinicalSpecialty unwraps via its known text keys (description/label/name, incl. nested .value)'
  );
  assert(
    specialtyRow({ id: 42 }).values[0].value === '(present — format not recognised; check in Medicus)',
    'an unrecognised object shape says so explicitly — never "[object Object]", never masquerading as "(none)"'
  );
  assert(
    specialtyRow({ description: 'Dermatology' }).differs === true,
    'differs is computed on the unwrapped text, not the raw object'
  );
}

console.log('\n--- splitDocumentGroupsByFileType (document over-merge disambiguation) ---');
{
  // Reproduces the real test-patient-1 finding (2026-07-07): two genuinely
  // unrelated documents sharing a date and both resolving to the same
  // generic type label ("Clinical letter") wrongly merged into one 4-entry
  // group, because the grouping key is only (kind, date, code).
  const mergedDocGroup = {
    kind: 'document',
    date: 'Wed 07 May 2025',
    code: 'Clinical letter',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [
      {
        id: 'doc1-orig',
        kind: 'document',
        date: 'Wed 07 May 2025',
        code: 'Clinical letter',
        rawText: 'Clinical letter 07 May 2025 Kingston Hospital',
        recordedBy: null,
        recordedByOrganisation: 'Kingston Hospital',
        idTime: 100,
      },
      {
        id: 'doc1-dup',
        kind: 'document',
        date: 'Wed 07 May 2025',
        code: 'Clinical letter',
        rawText:
          'Other digital signal Type: Clinical letter Custodian Org: Park Road Surgery 07 May 2025 Kingston Hospital',
        recordedBy: null,
        recordedByOrganisation: 'Kingston Hospital',
        idTime: 200,
      },
      {
        id: 'doc2-orig',
        kind: 'document',
        date: 'Wed 07 May 2025',
        code: 'Clinical letter',
        rawText: 'Clinical letter 07 May 2025 Kingston Hospital',
        recordedBy: null,
        recordedByOrganisation: 'Kingston Hospital',
        idTime: 150,
      },
      {
        id: 'doc2-dup',
        kind: 'document',
        date: 'Wed 07 May 2025',
        code: 'Clinical letter',
        rawText:
          'Other digital signal Type: Clinical letter Custodian Org: Park Road Surgery 07 May 2025 Kingston Hospital',
        recordedBy: null,
        recordedByOrganisation: 'Kingston Hospital',
        idTime: 250,
      },
    ],
  };
  const fileTypeByEntryId = {
    'doc1-orig': 'pdf',
    'doc1-dup': 'pdf',
    'doc2-orig': 'rtf',
    'doc2-dup': 'rtf',
  };
  const { groups: split, documentGroupsSplit } = splitDocumentGroupsByFileType([mergedDocGroup], fileTypeByEntryId);
  assert(documentGroupsSplit === 1, 'one over-merged group is reported as split');
  assert(split.length === 2, 'the 4-entry group splits into two 2-entry groups');
  const pdfGroup = split.find((g) => g.entries.some((e) => e.id === 'doc1-orig'));
  const rtfGroup = split.find((g) => g.entries.some((e) => e.id === 'doc2-orig'));
  assert(
    !!pdfGroup &&
      pdfGroup.entries.length === 2 &&
      pdfGroup.entries.every((e) => ['doc1-orig', 'doc1-dup'].includes(e.id)),
    'pdf-type entries land together, not mixed with the rtf pair'
  );
  assert(
    !!rtfGroup &&
      rtfGroup.entries.length === 2 &&
      rtfGroup.entries.every((e) => ['doc2-orig', 'doc2-dup'].includes(e.id)),
    'rtf-type entries land together, not mixed with the pdf pair'
  );
  assert(
    pdfGroup.keeperEntryId === 'doc1-orig',
    'keeper recomputed per sub-group (earliest idTime within just that pair)'
  );
  assert(rtfGroup.keeperEntryId === 'doc2-orig', 'keeper recomputed per sub-group, independent of the other pair');
  assert(
    pdfGroup.tier === TIER.REVIEW && rtfGroup.tier === TIER.REVIEW,
    'document tier cap still applies after splitting'
  );
}

{
  // Unknown fileType (fetch failed, or never fetched) must never be guessed
  // into a known bucket — and a bucket left with fewer than 2 members
  // (including a lone known-fileType entry) is dropped, matching
  // groupAndTier's own "needs >=2 to exist as a candidate" rule.
  const group = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [
      {
        id: 'a1',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'x',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 1,
      },
      {
        id: 'a2',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'x',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 2,
      },
      {
        id: 'b1',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'y',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 3,
      },
      {
        id: 'unk',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'z',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 4,
      },
    ],
  };
  const fileTypeByEntryId = { a1: 'pdf', a2: 'pdf', b1: 'rtf' }; // 'unk' deliberately absent
  const { groups: split, documentGroupsSplit } = splitDocumentGroupsByFileType([group], fileTypeByEntryId);
  assert(
    documentGroupsSplit === 1,
    'a group with 2+ known distinct fileTypes is still reported as split even if only one bucket survives'
  );
  assert(
    split.length === 1 && split[0].entries.length === 2,
    'the lone rtf entry and the unknown entry are dropped, not guessed into the pdf pair'
  );
  assert(
    split[0].entries.every((e) => ['a1', 'a2'].includes(e.id)),
    'only the genuine pdf pair survives'
  );
}

{
  // A group with fewer than 2 distinct KNOWN fileTypes (all same, or only
  // one entry has a known value) is left completely untouched.
  const sameTypeGroup = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [
      {
        id: 'x',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'x',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 1,
      },
      {
        id: 'y',
        kind: 'document',
        date: 'd',
        code: 'c',
        rawText: 'x',
        recordedBy: null,
        recordedByOrganisation: null,
        idTime: 2,
      },
    ],
  };
  const { groups: noOp, documentGroupsSplit: noOpSplit } = splitDocumentGroupsByFileType([sameTypeGroup], {
    x: 'pdf',
    y: 'pdf',
  });
  assert(
    noOp.length === 1 && noOp[0] === sameTypeGroup,
    'a group where all known fileTypes match passes through unchanged (same object reference)'
  );
  assert(noOpSplit === 0, 'documentGroupsSplit stays 0 when nothing needed splitting');

  const { groups: nonDoc } = splitDocumentGroupsByFileType([{ kind: 'note', entries: [] }], {});
  assert(nonDoc.length === 1 && nonDoc[0].kind === 'note', 'non-document groups are never touched');
}

{
  // fileSize discrimination (2026-07-07): reproduces the real-world scenario
  // the user described — a patient contacts NHS 111 and several separate
  // referral letters arrive in one batch, same received/record date, same
  // fileType (all PDFs), but genuinely different documents. fileType alone
  // can't tell them apart; fileSize can.
  function docEntry(id, idTime) {
    return {
      id,
      kind: 'document',
      date: 'Mon 07 Jul 2025',
      code: 'Clinical letter',
      rawText: 'text',
      recordedBy: null,
      recordedByOrganisation: null,
      idTime,
    };
  }
  const fourEntryGroup = {
    kind: 'document',
    date: 'Mon 07 Jul 2025',
    code: 'Clinical letter',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [docEntry('a1', 100), docEntry('a2', 200), docEntry('b1', 150), docEntry('b2', 250)],
  };
  const allPdf = { a1: 'pdf', a2: 'pdf', b1: 'pdf', b2: 'pdf' };

  {
    // Same fileType throughout, but two distinct fileSizes — should still
    // split into two 2-entry groups, even though fileType alone (the old
    // behaviour) would never have triggered a split here.
    const sizes = { a1: '938.46 KB', a2: '938.46 KB', b1: '22.12 KB', b2: '22.12 KB' };
    const { groups: split, documentGroupsSplit } = splitDocumentGroupsByFileType([fourEntryGroup], allPdf, sizes);
    assert(documentGroupsSplit === 1, 'a same-fileType group with two distinct fileSizes is still reported as split');
    assert(split.length === 2, 'splits into two 2-entry groups by fileSize');
    const groupA = split.find((g) => g.entries.some((e) => e.id === 'a1'));
    assert(
      groupA.entries.length === 2 && groupA.entries.every((e) => ['a1', 'a2'].includes(e.id)),
      'the two same-size entries land together, not mixed with the other size'
    );
  }

  {
    // Same fileType AND same fileSize throughout — genuinely one document
    // duplicated, not several different ones. Must NOT split.
    const sizes = { a1: '938.46 KB', a2: '938.46 KB', b1: '938.46 KB', b2: '938.46 KB' };
    const { groups: noOp, documentGroupsSplit } = splitDocumentGroupsByFileType([fourEntryGroup], allPdf, sizes);
    assert(
      noOp.length === 1 && noOp[0] === fourEntryGroup,
      'identical fileType AND fileSize throughout passes through unchanged'
    );
    assert(documentGroupsSplit === 0, 'documentGroupsSplit stays 0 when size also matches throughout');
  }

  {
    // fileSize genuinely unknown for every entry (e.g. the field name guess
    // turns out wrong, or the API just doesn't return it for these docs) —
    // must degrade to the old fileType-only behaviour, never guess a size
    // match, and never crash.
    const { groups: fallback, documentGroupsSplit } = splitDocumentGroupsByFileType([fourEntryGroup], allPdf, {});
    assert(
      fallback.length === 1 && fallback[0] === fourEntryGroup,
      'unknown fileSize for every entry degrades to the old fileType-only pass-through, not a guessed split'
    );
    assert(documentGroupsSplit === 0, 'no split reported when size data is entirely unavailable');

    const { groups: noArgFallback } = splitDocumentGroupsByFileType([fourEntryGroup], allPdf);
    assert(
      noArgFallback.length === 1 && noArgFallback[0] === fourEntryGroup,
      'omitting fileSizeByEntryId entirely (existing callers) behaves identically — full backward compatibility'
    );
  }

  {
    // Mixed: two entries share a known, matching fileSize; the other two
    // have no known fileSize at all. The known-size pair should still split
    // out correctly, and the unknown-size pair must never be guessed into
    // that size bucket (they form their own bucket of two, since they at
    // least still share fileType).
    const sizes = { a1: '938.46 KB', a2: '938.46 KB' };
    const { groups: split, documentGroupsSplit } = splitDocumentGroupsByFileType([fourEntryGroup], allPdf, sizes);
    assert(documentGroupsSplit === 1, 'a partially-known-size group is still reported as split');
    const knownSizePair = split.find((g) => g.entries.some((e) => e.id === 'a1'));
    assert(
      knownSizePair.entries.length === 2 && knownSizePair.entries.every((e) => ['a1', 'a2'].includes(e.id)),
      'the two known-matching-size entries land together'
    );
    const unknownSizePair = split.find((g) => g.entries.some((e) => e.id === 'b1'));
    assert(
      unknownSizePair &&
        unknownSizePair.entries.length === 2 &&
        unknownSizePair.entries.every((e) => ['b1', 'b2'].includes(e.id)),
      'the two unknown-size entries land together (fileType-only fallback for that pair), never guessed into the known-size bucket'
    );
  }
}

{
  // flattenDocumentEntries — pure conversion of the real
  // `clinical/document/entries/{documentId}` shape (confirmed live
  // 2026-07-08, test patient 1, 07 May 2025 pair) into pseudo note-kind
  // entries. Real example: code "Abstinent from drug misuse", text
  // "Abstinent from drug misuse: abstinent from cannabis".
  const flattened = flattenDocumentEntries('doc-1', 'Wed 07 May 2025', [
    {
      id: '0196d92a-f3bb-7000-95b7-9bcadf7286c8',
      type: 'note',
      code: 'Abstinent from drug misuse',
      text: 'Abstinent from drug misuse: abstinent from cannabis',
      isMarkedIncorrect: false,
    },
    // Observation-type entry (real example) — no `code` field at all, and
    // `observation` isn't in this tool's comparable-entries pool — skipped.
    {
      id: '0196d92a-719d-7000-a02f-d0a864fe0977',
      type: 'observation',
      text: 'Alcohol units consumed per week • 0 Alcohol units',
    },
    // Marked-incorrect note — already resolved, not worth flagging.
    { id: 'note-incorrect', type: 'note', code: 'Some code', text: 'Some code: text', isMarkedIncorrect: true },
  ]);
  assert(flattened.length === 1, 'only the genuine, non-incorrect note-type entry survives');
  assert(flattened[0].kind === 'note', 'a document-linked entry becomes a note-kind pseudo-entry');
  assert(flattened[0].code === 'Abstinent from drug misuse', "code is read from the entry's own code field");
  assert(
    flattened[0].rawText === 'abstinent from cannabis',
    'rawText strips the "{code}: " prefix from text, recovering the real note content'
  );
  assert(
    flattened[0].date === 'Wed 07 May 2025',
    "date is the CALLER's supplied documentDate (the document's own journal-entry date), not fetched or guessed per-entry"
  );
  assert(
    flattened[0].recordedBy === null && flattened[0].recordedByOrganisation === null,
    'recordedBy/recordedByOrganisation are null — not present on this endpoint'
  );
  assert(
    flattened[0].fromDocumentLinkedElement === true && flattened[0].linkedDocumentId === 'doc-1',
    'the pseudo-entry is tagged with its origin for UI traceability'
  );

  const noPrefixMatch = flattenDocumentEntries('doc-2', 'd', [
    { id: 'x', type: 'note', code: 'Some code', text: 'Freeform text not matching the expected prefix shape' },
  ]);
  assert(
    noPrefixMatch[0].rawText === 'Freeform text not matching the expected prefix shape',
    'text not matching the "{code}: " prefix falls back to the full text unchanged, never guessed/truncated wrongly'
  );

  const noEntries = flattenDocumentEntries('doc-3', 'd', null);
  assert(
    Array.isArray(noEntries) && noEntries.length === 0,
    'a missing/null entries array produces no pseudo-entries, never throws'
  );
}

{
  // findDocumentLinkedDuplicates — the actual matching pass. A document's
  // linked note (recovered via on-demand fetch) that shares (kind, date,
  // code) with a real freestanding entry in the same patient's journal
  // forms a candidate group, tagged documentLinked.
  const freestandingDuplicate = {
    kind: 'note',
    id: 'free-1',
    code: 'Abstinent from drug misuse',
    rawText: 'abstinent from cannabis',
    recordedBy: 'Dr Test',
    recordedByOrganisation: 'Test Surgery',
    date: 'Wed 07 May 2025',
    encounterId: null,
    fromTransferEncounter: false,
    // Deliberately an EARLIER idTime than the document-linked entry below —
    // proves the keeper-forcing override actually overrides the generic
    // UUIDv7 tie-breaker, not just coincidentally agrees with it.
    idTime: 100,
  };
  const unrelatedEntry = {
    kind: 'note',
    id: 'unrelated-1',
    code: 'Annual review',
    rawText: 'Routine check',
    recordedBy: 'Dr Test',
    recordedByOrganisation: 'Test Surgery',
    date: 'Wed 07 May 2025',
    encounterId: null,
    fromTransferEncounter: false,
    idTime: 101,
  };
  const documentLinkedDataByDocumentId = {
    'doc-1': {
      documentDate: 'Wed 07 May 2025',
      entries: [
        {
          id: 'linked-1',
          type: 'note',
          code: 'Abstinent from drug misuse',
          text: 'Abstinent from drug misuse: abstinent from cannabis',
        },
      ],
    },
  };

  const matched = findDocumentLinkedDuplicates([freestandingDuplicate, unrelatedEntry], documentLinkedDataByDocumentId);
  assert(matched.linkedEntriesGenerated === 1, 'reports how many pseudo-entries were generated, even before matching');
  assert(
    matched.groups.length === 1,
    'the document-linked entry matches the freestanding duplicate into exactly one group'
  );
  assert(matched.groups[0].documentLinked === true, 'the resulting group is tagged documentLinked');
  assert(
    matched.groups[0].entries.some((e) => e.fromDocumentLinkedElement) &&
      matched.groups[0].entries.some((e) => e.id === 'free-1'),
    'the group contains both the pseudo-entry and the real freestanding entry it matched'
  );
  assert(
    matched.groups[0].keeperEntryId === 'linked-1',
    'the document-linked entry is FORCED as keeper — it is the genuine original still attached to its source document, and must never be the one offered for removal, regardless of which member has the earlier UUIDv7 timestamp'
  );
  assert(
    matched.groups[0].entries.find((e) => e.id === 'linked-1').isKeeper === true &&
      matched.groups[0].entries.find((e) => e.id === 'free-1').isKeeper === false,
    'isKeeper flags on the returned entries match the forced keeper, not the generic tie-breaker result'
  );

  const noMatch = findDocumentLinkedDuplicates([unrelatedEntry], documentLinkedDataByDocumentId);
  assert(noMatch.linkedEntriesGenerated === 1, 'still reports generated count even when nothing matches');
  assert(
    noMatch.groups.length === 0,
    'a document-linked entry with no matching freestanding entry forms no group (a single member never groups)'
  );

  const noData = findDocumentLinkedDuplicates([freestandingDuplicate], {});
  assert(
    noData.linkedEntriesGenerated === 0 && noData.groups.length === 0,
    'no document-linked data at all produces no pseudo-entries and no groups, never throws'
  );

  const emptyEntries = findDocumentLinkedDuplicates([freestandingDuplicate], {
    'doc-1': { documentDate: 'Wed 07 May 2025', entries: [] },
  });
  assert(
    emptyEntries.linkedEntriesGenerated === 0,
    'a document whose entries call returns [] (confirmed real shape for a reimport-duplicate copy) generates nothing — the exact case that motivated fetching every document, not just already-grouped ones'
  );
}

console.log('\n--- normText null/junk-only parity + note field comparison (2026-07-08 real pair) ---');
{
  assert(
    JSON.stringify(normText(null)) === JSON.stringify({ text: '', wrapped: false }),
    'normText(null) returns the same {text, wrapped} shape as every other path (was a bare string — spreading it gave text:undefined)'
  );
  assert(
    normText('{Episodicity : code=255217005, displayName=First}').text === '' &&
      normText('{Episodicity : code=255217005, displayName=First}').wrapped === true,
    'a note whose whole body is a bare {Episodicity...} block normalises to empty, flagged wrapped'
  );

  // Reproduces the real pair (note/overview 019c22bf-387d... original with
  // note:null vs 019c22bf-3895... reimport copy whose whole note body is the
  // flattened episodicity block) — same code, same recordedBy, two separate
  // encounters. Mis-tiered REVIEW before the normText null-shape fix.
  const journal = [
    {
      title: 'Tue 01 Jan 2008',
      items: [
        encounter(
          'enc-ep-1',
          'Dr Julian Bradley',
          [noteEntry('019c22bf-387d-702b-ab37-e7a683b36973', 'Perianal abscess', null, 'Dr Julian Bradley', null)],
          false
        ),
        encounter(
          'enc-ep-2',
          'Dr Julian Bradley',
          [
            noteEntry(
              '019c22bf-3895-7032-a22a-aa0557e17e69',
              'Perianal abscess',
              '{Episodicity : code=255217005, displayName=First}',
              'Dr Julian Bradley',
              null
            ),
          ],
          false
        ),
      ],
    },
  ];
  const analysis = analyzeJournal(journal);
  const pair = analysis.groups.find((g) => g.code === 'Perianal abscess');
  assert(!!pair, 'the null-note + episodicity-block-note pair forms a candidate group');
  assert(
    pair && pair.tier === TIER.EXACT,
    'the pair tiers EXACT — the only difference is GP2GP junk metadata, same author (was mis-tiering REVIEW)'
  );

  assert(
    buildNoteOverviewUrl('https://abc.api.england.medicus.health', 'note-1') ===
      'https://abc.api.england.medicus.health/clinical/data/note/overview/note-1',
    'buildNoteOverviewUrl targets the confirmed clinical/data/note/overview/{noteId} URL'
  );
  assert(buildNoteOverviewUrl(null, 'note-1') === null, 'buildNoteOverviewUrl refuses a missing apiBase');
  assert(buildNoteOverviewUrl('https://abc.api', null) === null, 'buildNoteOverviewUrl refuses a missing noteId');

  // Field comparison built from the two real overview payloads (2026-07-08).
  const originalOverview = {
    noteId: 'a',
    noteSNOMEDctCode: { conceptId: '82127005', description: 'Perianal abscess', descriptionId: '136225013' },
    note: null,
    recordDate: '2008-01-01',
    created: '2026-02-03 09:04:43',
    createdInOriginalSystemDateTime: '2026-01-20 01:11:30',
    recordedBy: 'Dr Julian Bradley',
    isMarkedAsIncorrect: false,
    linkedProblems: [{ problemCodeDescription: 'Perianal abscess', significance: 'Major' }],
  };
  const duplicateOverview = {
    ...originalOverview,
    noteId: 'b',
    note: '{Episodicity : code=255217005, displayName=First}',
    linkedProblems: [],
  };
  const noteComparison = buildNoteFieldComparison({ entries: [{ id: 'a' }, { id: 'b' }] }, {
    a: originalOverview,
    b: duplicateOverview,
  });
  const noteRow = (label) => noteComparison.rows.find((r) => r.label === label);
  assert(noteRow('Code').differs === false, 'Code matches on both copies');
  assert(noteRow('Note text').differs === true, 'Note text differs (null vs the flattened episodicity block)');
  assert(
    noteRow('Linked problems').values[0].value === 'Perianal abscess (Major)' &&
      noteRow('Linked problems').values[1].value === null &&
      noteRow('Linked problems').differs === true,
    'Linked problems differ — the original keeps its problem linkage, the reimport copy lost it'
  );
  assert(noteRow('Created').differs === false, 'Created matches on both copies');
  assert(
    noteRow('Marked incorrect').values[0].value === null,
    'Marked incorrect shows nothing (not a scary "no") when false'
  );
  const noComparison = buildNoteFieldComparison({ entries: [{ id: 'a' }, { id: 'b' }] }, {});
  assert(
    noComparison.rows.every((r) => r.values.every((v) => v.value === null)),
    'a missing overview shows blank values for that copy, never guessed'
  );
}

console.log('\n--- sortGroupsByJournalOrder (documentLinked groups adjacent to their document task) ---');
{
  // Journal order: a note pair early, a document mid-list, another note
  // pair late. The documentLinked group's pseudo-entry is NOT in the
  // journal list — it must slot in via its linkedDocumentId.
  const journalEntries = [
    { id: 'n1' },
    { id: 'n1-dup' },
    { id: 'doc-1' },
    { id: 'n2' },
    { id: 'n2-dup' },
  ];
  const earlyGroup = { entries: [{ id: 'n1' }, { id: 'n1-dup' }] };
  const lateGroup = { entries: [{ id: 'n2' }, { id: 'n2-dup' }] };
  const linkedGroup = {
    documentLinked: true,
    entries: [
      { id: 'pseudo-1', fromDocumentLinkedElement: true, linkedDocumentId: 'doc-1' },
      { id: 'n2' },
    ],
  };
  // Concatenation order mirrors the real caller: main groups first,
  // documentLinked groups appended at the end.
  const sorted = sortGroupsByJournalOrder([earlyGroup, lateGroup, linkedGroup], journalEntries);
  assert(sorted[0] === earlyGroup, 'the earliest-journal-position group sorts first');
  assert(
    sorted[1] === linkedGroup,
    "a documentLinked group slots in at its source document's journal position (via linkedDocumentId), not at the bottom"
  );
  assert(sorted[2] === lateGroup, 'later journal entries follow');

  const unlocatable = { entries: [{ id: 'ghost' }] };
  const withGhost = sortGroupsByJournalOrder([unlocatable, earlyGroup], journalEntries);
  assert(
    withGhost[0] === earlyGroup && withGhost[1] === unlocatable,
    'a group with no locatable member sorts last, never guessed into a position'
  );

  const tied = sortGroupsByJournalOrder([lateGroup, linkedGroup, earlyGroup], []);
  assert(
    tied[0] === lateGroup && tied[1] === linkedGroup && tied[2] === earlyGroup,
    'with no journal entries at all every group is unlocatable — original order fully preserved (stable)'
  );
  assert(
    sortGroupsByJournalOrder(null, null).length === 0,
    'null groups input degrades to an empty list, never throws'
  );
}

{
  // buildDocumentFieldComparison — field-by-field comparison for document
  // REVIEW groups, replacing the blob word-diff which only ever surfaced
  // Title/Type. Fixture modelled on the real "Document 2" pair reported by
  // the user (2026-07-08, test patient 1, 07 May 2025 clinical letter).
  const docGroup = {
    kind: 'document',
    date: '07 May 2025',
    code: 'Clinical letter',
    tier: TIER.REVIEW,
    entries: [{ id: 'doc2-original' }, { id: 'doc2-duplicate' }],
  };
  const previewByEntryId = {
    'doc2-original': {
      document: {
        title: null,
        typeCode: { description: 'clinical letter' },
        documentDate: '07 May 2025',
        authoredByText: 'Kingston Hospital',
        clinicalSpecialty: 'Dermatology',
        recordDate: '13 May 2025',
        createdDate: '13 May 2025, 08:55',
        filedDateTime: '22 May 2025, 03:22',
        filedBy: 'Ms Theresa Bailey',
      },
      fileType: 'rtf',
      fileSize: '22.12 KB',
    },
    'doc2-duplicate': {
      document: {
        title: 'Type: Clinical letter Author Org: Kingston Hospital Custodian Org: Park Road Surgery',
        typeCode: { description: 'Other digital signal' },
        documentDate: '07 May 2025',
        authoredByText: 'Kingston Hospital',
        clinicalSpecialty: null,
        recordDate: '07 May 2025',
        createdDate: '03 Feb 2026, 09:04',
        filedDateTime: '20 Jan 2026, 01:11',
        filedBy: null,
      },
      fileType: 'rtf',
      fileSize: '22.12 KB',
    },
  };

  const { rows } = buildDocumentFieldComparison(docGroup, previewByEntryId);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));

  assert(byLabel['Title'].differs === true, 'Title differs (null vs the genericised-title encoding)');
  assert(byLabel['Type'].differs === true, 'Type differs ("clinical letter" vs "Other digital signal")');
  assert(byLabel['Document date'].differs === false, 'Document date matches on both copies');
  assert(byLabel['Author'].differs === false, 'Author matches on both copies');
  assert(byLabel['Clinical specialty'].differs === true, 'Clinical specialty differs (populated vs null)');
  assert(byLabel['Record date'].differs === true, 'Record date differs (13 May vs 07 May — the reimport collapse)');
  assert(byLabel['Created'].differs === true, 'Created differs (real vs batch-reimport timestamp)');
  assert(
    byLabel['Filed'].differs === true,
    'Filed differs (real vs batch-reimport timestamp, including the "by" author)'
  );
  assert(byLabel['File type'].differs === false, 'File type matches on both copies');
  assert(byLabel['File size'].differs === false, 'File size matches on both copies');

  assert(
    byLabel['Filed'].values[0].value === '22 May 2025, 03:22 by Ms Theresa Bailey',
    'Filed value combines filedDateTime and filedBy into one "by {person}" string when filedBy is present'
  );
  assert(
    byLabel['Filed'].values[1].value === '20 Jan 2026, 01:11',
    'Filed value falls back to filedDateTime alone when filedBy is absent, never guessing an author'
  );

  const missingPreview = buildDocumentFieldComparison(docGroup, { 'doc2-original': previewByEntryId['doc2-original'] });
  const missingRow = missingPreview.rows.find((r) => r.label === 'Title');
  assert(
    missingRow.values[1].value === null,
    'an entry with no fetched preview at all shows a blank value for that column, never guessed'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
