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
  hasAttachedDocumentMismatch,
  isRemovableKind,
  buildRemovalRequest,
  buildInvestigationReportGroups,
  buildInvestigationReportRemovalRequest,
  canRemoveInvestigationReports,
  stripJournalFilterParams,
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
  splitDocumentGroupsByContentHash,
  hasJunkTitlePrefix,
  accurxAttachmentUrl,
  hasCreatedAfterFiled,
  findSuspiciousDocuments,
  findFileMatchedDuplicates,
  buildCareRecordJournalUrl,
  buildDocumentDownloadUrl,
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

function flatInvestigationRequestItem(id, items, requestedBy, requestingOrganisation) {
  return {
    type: 'investigation-request',
    data: {
      id,
      entryType: 'investigation-request',
      investigationRequestItems: items,
      requestedBy,
      requestingOrganisation,
    },
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

// Confirmed real shape (2026-08-22, three HAR captures against one patient):
// `item.data.investigationGroups[].results[]`, one entry per reported
// analyte. conceptId is the stable match key — free-text description/label
// is confirmed to vary across copies of the same duplicated result.
function investigationResult(id, conceptId, resultLabel, resultValue, resultUnit, orderingDateString, reportId) {
  return {
    id,
    investigationResultCode: { conceptId, description: resultLabel },
    investigationResultLabel: resultLabel,
    investigationReportId: reportId,
    resultValue,
    resultUnit: resultUnit || null,
    orderingDateString,
    requiresUrgentReview: false,
  };
}

function investigationGroup(label, results) {
  return { label, results };
}

function flatInvestigationItem(itemId, groups) {
  return {
    type: 'investigation',
    data: { id: itemId, investigationGroups: groups },
  };
}

// Live-confirmed 2026-07-17: a nested prescription entry has NO recordedBy/
// recordedByOrganisation field (see record-duplicate-parser.js header) —
// deliberately omitted here, not just unused, to mirror the real shape.
function nestedPrescriptionEntry(id, productName, dosageText, issueQuantity) {
  return { entryType: 'prescription', id, productName, dosageText, issueQuantity };
}

// requestingOrganisation live-confirmed 2026-07-17 as a real field.
function nestedInvestigationRequestEntry(id, items, requestedBy, requestingOrganisation) {
  return {
    entryType: 'investigation-request',
    id,
    investigationRequestItems: items,
    requestedBy,
    requestingOrganisation,
  };
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
assert(!byCode['Medication review'].emptyWrapperOnly, 'Group B (real free text) is not flagged emptyWrapperOnly');
assert(
  !byCode['Pigmented naevus'].emptyWrapperOnly,
  'Group C (wrapper + real prose survives stripping) is not flagged emptyWrapperOnly'
);

console.log(
  '\n--- note-kind empty-wrapper cap (live-confirmed 2026-07-17, docs/learnings-vaccination-note-duplicates.md) ---'
);
{
  // Real motivating case: three different vaccines given the same day, each
  // recorded as a note entry whose ENTIRE body is the content-free
  // Episodicity problem-review wrapper — no vaccine-specific text survives
  // normText's stripping, so "identical text" carries zero real signal.
  const vaccineDayGroups = [
    {
      title: 'Tue 19 Jun 2007',
      items: [
        flatNoteItem(
          'vax-1',
          'Immunisations',
          '{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}',
          'Dr J R Jones',
          null
        ),
        flatNoteItem(
          'vax-2',
          'Immunisations',
          '{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}',
          'Mrs Janine McGilly',
          null
        ),
        flatNoteItem(
          'vax-3',
          'Immunisations',
          '{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}',
          'Ms Clare Lower',
          null
        ),
      ],
    },
  ];
  const vaccineResult = analyzeJournal(vaccineDayGroups);
  const vaccineGroup = vaccineResult.groups.find((g) => g.kind === 'note' && g.code === 'Immunisations');
  assert(!!vaccineGroup, 'Three same-day, same-code, wrapper-only note entries still form a candidate group');
  assert(
    vaccineGroup.tier === TIER.REVIEW,
    'A HIGH-would-be note group (different recordedBy) whose ENTIRE text is the content-free wrapper is capped down to REVIEW'
  );
  assert(vaccineGroup.emptyWrapperOnly === true, 'The group is flagged emptyWrapperOnly so the UI can explain why');

  // Control: SAME recordedBy too — must NOT be capped. This is deliberately
  // the live-confirmed 2026-07-08 "Perianal abscess" shape (see the
  // "2026-07-08 real pair" test below) — an empty-wrapper match with
  // matching authors is a genuine dual-render duplicate, not a false
  // positive, and the cap must not touch it.
  const sameAuthorDayGroups = [
    {
      title: 'Tue 19 Jun 2007',
      items: [
        flatNoteItem(
          'vax-a',
          'Immunisations',
          '{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}',
          'Dr Test',
          null
        ),
        flatNoteItem(
          'vax-b',
          'Immunisations',
          '{Episodicity : code=303350001, displayName=Ongoing, originalText=Review}',
          'Dr Test',
          null
        ),
      ],
    },
  ];
  const sameAuthorResult = analyzeJournal(sameAuthorDayGroups);
  const sameAuthorGroup = sameAuthorResult.groups.find((g) => g.kind === 'note');
  assert(
    sameAuthorGroup.tier === TIER.EXACT,
    'Matching recordedBy + empty wrapper still tiers EXACT — the cap only fires on the HIGH (different-author) combination'
  );
  assert(
    sameAuthorGroup.emptyWrapperOnly === false,
    'EXACT-tier groups are never flagged emptyWrapperOnly (the cap never fired)'
  );
}

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

console.log('\n--- linkedProblems: dedup within one encounter AND across encounters (fixed 2026-07-17) ---');
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
      // A second, separate encounter linking the SAME real problem (same
      // problem.id) — live-confirmed 2026-07-17
      // (docs/learnings-vaccination-note-duplicates.md, a real
      // "Immunisations" problem linked from 6 encounters on one day) that
      // this is NOT a duplicate-record candidate: it's one real problem
      // referenced twice, not two problem-list records. A group used to
      // form here with both entries sharing prob-asthma's id, which broke
      // the removal UI (keeperEntryId equals every entry's id, so "N
      // duplicate copies" always computed to 0 with no member left to
      // toggle) — see the CHANGELOG entry for the full trace.
      encounter('enc-p2', 'Dr Test', [], false, [], [asthmaProblem]),
    ],
  },
];
const problemsResult = analyzeJournal(linkedProblemsDayGroups);
const asthmaGroup = problemsResult.groups.find((g) => g.kind === 'problem' && g.code === 'Asthma');
assert(!asthmaGroup, 'The SAME real problem linked from two different encounters does NOT form a candidate group');
assert(
  problemsResult.summary.suppressedProblemLinkageTotal === 1,
  'The same-record linkage is tracked in the suppressed-problem-linkage diagnostic, not silently dropped'
);
assert(
  problemsResult.suppressedProblemLinkage[0].linkageCount === 2,
  'The suppression record carries how many linkage occurrences were collapsed'
);

// Control: TWO DIFFERENT problem-list records sharing the same code/date —
// a genuine reimport-duplicate candidate — must still form a real group.
const asthmaProblemA = problemRef('prob-asthma-a', 'Asthma');
const asthmaProblemB = problemRef('prob-asthma-b', 'Asthma');
const distinctProblemsDayGroups = [
  {
    title: 'Mon 01 Jan 2024',
    items: [
      encounter('enc-pa', 'Dr Test', [], false, [], [asthmaProblemA]),
      encounter('enc-pb', 'Dr Test', [], false, [], [asthmaProblemB]),
    ],
  },
];
const distinctProblemsResult = analyzeJournal(distinctProblemsDayGroups);
const distinctAsthmaGroup = distinctProblemsResult.groups.find((g) => g.kind === 'problem' && g.code === 'Asthma');
assert(!!distinctAsthmaGroup, 'Two DISTINCT problem records sharing the same code/date still form a candidate group');
assert(
  distinctAsthmaGroup && distinctAsthmaGroup.entries.length === 2,
  'The genuine-duplicate case is unaffected by the same-record linkage fix'
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

console.log('\n--- requestingOrganisation live-confirmed 2026-07-17 (previously read as hardcoded null) ---');
const invReqOrgDayGroups = [
  {
    title: 'Wed 10 Jan 2024',
    items: [
      flatInvestigationRequestItem('ir-org-1', ['FBC', 'U&E'], 'Dr Test', 'Test Surgery'),
      flatInvestigationRequestItem('ir-org-2', ['FBC', 'U&E'], 'Dr Test', 'Other Practice'),
    ],
  },
];
const invReqOrgResult = analyzeJournal(invReqOrgDayGroups);
const invReqOrgGroup = invReqOrgResult.groups.find((g) => g.kind === 'investigation-request');
assert(
  invReqOrgGroup && invReqOrgGroup.recordedByOrganisationVaries === true,
  'requestingOrganisation is actually read now — differing values are reflected in recordedByOrganisationVaries'
);

console.log('\n--- Nested prescription/investigation-request entries (live-confirmed 2026-07-17) ---');
const nestedRxInvReqDayGroups = [
  {
    title: 'Fri 18 Jul 2025',
    items: [
      encounter('enc-rx-a', 'Dr Test', [
        nestedPrescriptionEntry(
          'rx-nested-a',
          'Amoxicillin 250mg capsules',
          'Take one three times a day',
          '21 capsule'
        ),
      ]),
      encounter('enc-rx-b', 'Dr Test', [
        nestedPrescriptionEntry(
          'rx-nested-b',
          'Amoxicillin 250mg capsules',
          'Take one three times a day',
          '21 capsule'
        ),
      ]),
      encounter('enc-ir-a', 'Dr Test', [
        nestedInvestigationRequestEntry('ir-nested-a', ['FBC', 'U&E'], 'Dr Test', 'Test Surgery'),
      ]),
      encounter('enc-ir-b', 'Dr Test', [
        nestedInvestigationRequestEntry('ir-nested-b', ['FBC', 'U&E'], 'Dr Test', 'Test Surgery'),
      ]),
    ],
  },
];
const nestedRxInvReqResult = analyzeJournal(nestedRxInvReqDayGroups);
const nestedRxGroup = nestedRxInvReqResult.groups.find(
  (g) => g.kind === 'prescription' && g.code === 'Amoxicillin 250mg capsules'
);
assert(!!nestedRxGroup, 'Two nested prescription entries in separate encounters form a candidate group');
assert(
  nestedRxGroup && nestedRxGroup.tier === TIER.EXACT,
  'Identical nested prescription duplicates tier EXACT (no recordedBy field to vary — never blocks EXACT)'
);
const nestedIrGroup = nestedRxInvReqResult.groups.find((g) => g.kind === 'investigation-request');
assert(!!nestedIrGroup, 'Two nested investigation-request entries in separate encounters form a candidate group');
assert(
  nestedIrGroup && nestedIrGroup.tier === TIER.EXACT,
  'Identical nested investigation-request duplicates tier EXACT'
);

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
  assert(
    buildDocumentEditDetailsUrl(apiBase, null) === null,
    'buildDocumentEditDetailsUrl refuses a missing documentId'
  );

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
  const manualOrgOnly = buildDocumentEditRequest(
    apiBase,
    { ...safeDocumentEditModel, authoredByOrganisation: null },
    {}
  );
  assert(
    manualOrgOnly &&
      manualOrgOnly.body.authoredByOrganisation.organisationName === 'Teddington Memorial Hospital' &&
      manualOrgOnly.body.authoredByOrganisation.organisationIdentifierValue === null,
    'a model with no structured authoredByOrganisation.value falls back to its manual org text (name with null identifiers — the confirmed manual-entry shape)'
  );

  assert(
    getDocumentEditValue(safeDocumentEditModel, 'title') === null,
    'getDocumentEditValue: a stored null title reads as null (a legitimate value)'
  );
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
        typeCode: {
          conceptId: '25781000000108',
          description: 'Out of hours report',
          descriptionId: '2326201000000118',
          originalCodes: [],
        },
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
      'doc-2': {
        ...degradedModel,
        documentDate: null,
        authoredByOrganisation: null,
        manualAuthoredByOrganisation: null,
      },
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

console.log('\n--- splitDocumentGroupsByContentHash (content-hash verification, 2026-08-22) ---');
{
  function hashDocEntry(id) {
    return {
      id,
      kind: 'document',
      date: 'Sun 29 Dec 2024',
      code: 'Immunisation record',
      rawText: 'text',
      recordedBy: null,
      recordedByOrganisation: null,
      idTime: 1,
    };
  }

  // The real motivating case: six historical vaccination documents dumped
  // by one bad GP2GP reimport onto a single date, all sharing fileType AND
  // fileSize (auto-generated from the same template) — genuinely two
  // duplicated pairs plus two entirely distinct vaccines. A content hash is
  // the only thing that can tell them apart once size+type already agree.
  const sixVaccineGroup = {
    kind: 'document',
    date: 'Sun 29 Dec 2024',
    code: 'Immunisation record',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    sameFileTypeAndSize: true,
    entries: [
      hashDocEntry('flu-1'),
      hashDocEntry('flu-2'),
      hashDocEntry('pneumo-1'),
      hashDocEntry('pneumo-2'),
      hashDocEntry('tetanus'),
      hashDocEntry('shingles'),
    ],
  };
  const hashByEntryId = {
    'flu-1': 'hash-a',
    'flu-2': 'hash-a',
    'pneumo-1': 'hash-b',
    'pneumo-2': 'hash-b',
    tetanus: 'hash-c',
    shingles: 'hash-d',
  };
  const {
    groups: split,
    documentGroupsSplitByContentHash,
    checkResults: sixVaccineCheckResults,
  } = splitDocumentGroupsByContentHash([sixVaccineGroup], hashByEntryId);
  assert(documentGroupsSplitByContentHash === 1, 'the over-merged six-document group is reported as split');
  assert(
    split.length === 2,
    'only the two genuinely byte-identical pairs survive as groups — the singletons are dropped'
  );
  const fluGroup = split.find((g) => g.entries.some((e) => e.id === 'flu-1'));
  const pneumoGroup = split.find((g) => g.entries.some((e) => e.id === 'pneumo-1'));
  assert(
    !!fluGroup && fluGroup.entries.length === 2 && fluGroup.entries.every((e) => ['flu-1', 'flu-2'].includes(e.id)),
    'the two byte-identical flu documents land together'
  );
  assert(
    !!pneumoGroup &&
      pneumoGroup.entries.length === 2 &&
      pneumoGroup.entries.every((e) => ['pneumo-1', 'pneumo-2'].includes(e.id)),
    'the two byte-identical pneumococcal documents land together, kept apart from the flu pair'
  );
  assert(
    fluGroup.contentHashConfirmed === true && pneumoGroup.contentHashConfirmed === true,
    'a surviving group whose members share a genuinely known hash is marked contentHashConfirmed'
  );
  assert(
    !split.some((g) => g.entries.some((e) => ['tetanus', 'shingles'].includes(e.id))),
    'the two genuinely unique vaccines (tetanus, shingles) never appear in any surviving group at all'
  );

  // checkResults reports exactly what happened to the ORIGINAL six-document
  // group — real gap fixed 2026-08-22: a checked group used to just vanish
  // or shrink with no trace, so a caller had no way to tell "checked, found
  // nothing" from "never checked at all".
  assert(sixVaccineCheckResults.length === 1, 'one checked group produces one checkResults entry');
  const sixVaccineOutcome = sixVaccineCheckResults[0];
  assert(
    sixVaccineOutcome.checkedEntryIds.length === 6,
    'checkResults records every entry id that was actually part of the check'
  );
  assert(
    sixVaccineOutcome.confirmedGroupEntryIds.length === 2 &&
      sixVaccineOutcome.confirmedGroupEntryIds.some((ids) => ids.sort().join() === ['flu-1', 'flu-2'].join()) &&
      sixVaccineOutcome.confirmedGroupEntryIds.some((ids) => ids.sort().join() === ['pneumo-1', 'pneumo-2'].join()),
    'checkResults lists both confirmed duplicate clusters explicitly, by entry id'
  );
  assert(
    sixVaccineOutcome.uniqueEntryIds.sort().join() === ['shingles', 'tetanus'].join(),
    'checkResults explicitly names the entries PROVEN unique (a real, known, non-matching hash) — never silently dropped with no trace'
  );
  assert(
    sixVaccineOutcome.unresolvedEntryIds.length === 0,
    'no unresolved entries here — every entry had a known hash'
  );

  // The exact scenario reported live (2026-08-22): a same-size/type group
  // is checked and NOT ONE pair turns out byte-identical — every one of
  // n>2 documents has its own distinct hash. Previously this just made the
  // group vanish (0 surviving sub-groups, since every bucket has exactly 1
  // member) with nothing else to show — checkResults must still report the
  // outcome explicitly so the caller can render "checked N, found none
  // identical" rather than silence.
  const allUniqueGroup = {
    kind: 'document',
    date: 'Sun 29 Dec 2024',
    code: 'Immunisation record',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    sameFileTypeAndSize: true,
    entries: [hashDocEntry('v1'), hashDocEntry('v2'), hashDocEntry('v3'), hashDocEntry('v4')],
  };
  const {
    groups: allUniqueSplit,
    documentGroupsSplitByContentHash: allUniqueSplitCount,
    checkResults: allUniqueCheckResults,
  } = splitDocumentGroupsByContentHash([allUniqueGroup], {
    v1: 'hash-1',
    v2: 'hash-2',
    v3: 'hash-3',
    v4: 'hash-4',
  });
  assert(allUniqueSplitCount === 1, 'a group where nothing matches is still reported as split (it was processed)');
  assert(allUniqueSplit.length === 0, 'zero surviving groups when every document turns out to have a distinct hash');
  assert(
    allUniqueCheckResults.length === 1 && allUniqueCheckResults[0].confirmedGroupEntryIds.length === 0,
    'checkResults confirms zero duplicate clusters were found — an explicit negative, not an empty array with no explanation'
  );
  assert(
    allUniqueCheckResults[0].uniqueEntryIds.sort().join() === ['v1', 'v2', 'v3', 'v4'].join(),
    'checkResults names all four documents as individually proven unique, even though no group card survives to show them on'
  );

  // The critical caveat (explicit product decision, 2026-08-22): a group
  // NOT already confirmed sameFileTypeAndSize must be left completely
  // untouched, even with hash data that would otherwise split it — GP2GP/
  // export/reimport can legitimately convert a genuine duplicate to a
  // different file type or filename, so an unconfirmed group must never be
  // second-guessed by a hash comparison that could just be reflecting that
  // legitimate conversion.
  const unconfirmedGroup = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [hashDocEntry('u1'), hashDocEntry('u2')],
  };
  const { groups: untouched, documentGroupsSplitByContentHash: untouchedSplitCount } = splitDocumentGroupsByContentHash(
    [unconfirmedGroup],
    { u1: 'hash-x', u2: 'hash-y' } // clearly different hashes
  );
  assert(
    untouched.length === 1 && untouched[0] === unconfirmedGroup,
    'a group without a confirmed sameFileTypeAndSize flag passes through completely unchanged, regardless of hash data'
  );
  assert(untouchedSplitCount === 0, 'no split reported for a group never eligible for hash verification');

  // A member with no known hash (fetch not yet run, or failed) pools into
  // its own bucket rather than being excluded, dropped, or guessed onto
  // either side.
  const partialHashGroup = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    sameFileTypeAndSize: true,
    entries: [hashDocEntry('k1'), hashDocEntry('k2'), hashDocEntry('unk1'), hashDocEntry('unk2')],
  };
  const { groups: partial } = splitDocumentGroupsByContentHash([partialHashGroup], {
    k1: 'hash-known',
    k2: 'hash-known',
    // unk1/unk2 deliberately absent — hash not yet fetched
  });
  assert(partial.length === 2, 'known-matching pair and unknown-hash pair both survive as separate groups');
  const knownPair = partial.find((g) => g.entries.some((e) => e.id === 'k1'));
  const unknownPair = partial.find((g) => g.entries.some((e) => e.id === 'unk1'));
  assert(
    !!knownPair && knownPair.contentHashConfirmed === true,
    'the genuinely known-matching pair is marked contentHashConfirmed'
  );
  assert(
    !!unknownPair && unknownPair.contentHashConfirmed === false,
    'the unknown-hash pair survives together but is NOT marked confirmed — hash absence is never treated as a match'
  );

  // Fewer than 2 distinct KNOWN hashes (all agree, or too few known at all)
  // — must not split, since nothing has actually been proven different yet.
  const agreeingGroup = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    sameFileTypeAndSize: true,
    entries: [hashDocEntry('m1'), hashDocEntry('m2')],
  };
  const {
    groups: agreeing,
    documentGroupsSplitByContentHash: agreeingSplitCount,
    checkResults: agreeingResults,
  } = splitDocumentGroupsByContentHash([agreeingGroup], { m1: 'same-hash', m2: 'same-hash' });
  assert(
    agreeing.length === 1 && agreeing[0] === agreeingGroup,
    'a group whose known hashes all agree passes through unchanged (genuinely confirmed duplicate, nothing to split)'
  );
  assert(agreeingSplitCount === 0, 'no split reported when nothing disagrees');
  assert(
    agreeing[0].contentHashConfirmed === true,
    'a real fix (2026-08-22): a no-split "everyone genuinely agrees" group is still marked contentHashConfirmed, so the UI shows the byte-identical confirmation instead of silently showing the same button again'
  );
  assert(
    agreeingResults.length === 1 &&
      agreeingResults[0].confirmedGroupEntryIds.length === 1 &&
      agreeingResults[0].uniqueEntryIds.length === 0,
    'a no-split confirmed-identical group still emits checkResults so the UI can show the outcome without recomputing buckets'
  );

  const { groups: noHashData } = splitDocumentGroupsByContentHash([sixVaccineGroup], {});
  assert(
    noHashData.length === 1 && noHashData[0] === sixVaccineGroup,
    'no hash data fetched at all (check not yet run) leaves the group untouched, never guessed'
  );
  assert(
    !noHashData[0].contentHashConfirmed,
    'no hash data at all must NOT be marked confirmed — nothing was actually learned'
  );

  const { groups: nonDocPassthrough } = splitDocumentGroupsByContentHash([{ kind: 'note', entries: [] }], {});
  assert(
    nonDocPassthrough.length === 1 && nonDocPassthrough[0].kind === 'note',
    'non-document groups are never touched'
  );
}

console.log('\n--- sameFileTypeAndSize flag propagation ---');
{
  // splitDocumentGroupsByFileType: confirmed same only when at least 2
  // members genuinely have BOTH a known fileType and a known fileSize that
  // agree — feeds splitDocumentGroupsByContentHash's own gate.
  const confirmedGroup = {
    kind: 'document',
    date: 'd',
    code: 'c',
    tier: TIER.REVIEW,
    gp2gpWrapper: false,
    recordedByVaries: false,
    recordedByOrganisationVaries: false,
    keeperEntryId: null,
    entries: [
      { id: 'p1', kind: 'document', date: 'd', code: 'c', rawText: 'x', recordedBy: null, idTime: 1 },
      { id: 'p2', kind: 'document', date: 'd', code: 'c', rawText: 'x', recordedBy: null, idTime: 2 },
    ],
  };
  const { groups: confirmed } = splitDocumentGroupsByFileType(
    [confirmedGroup],
    { p1: 'pdf', p2: 'pdf' },
    { p1: '10 KB', p2: '10 KB' }
  );
  assert(
    confirmed[0].sameFileTypeAndSize === true,
    'both fileType and fileSize known and agreeing marks the group sameFileTypeAndSize'
  );

  const { groups: typeOnly } = splitDocumentGroupsByFileType([confirmedGroup], { p1: 'pdf', p2: 'pdf' }, {});
  assert(
    typeOnly[0].sameFileTypeAndSize === false,
    'fileType known but fileSize entirely unknown does NOT count as confirmed — no evidence size actually matches'
  );

  // findFileMatchedDuplicates: always confirmed by construction (its
  // bucket key requires both fileType and fileSize truthy).
  const fileMatchEntries = [
    { id: 'fm1', kind: 'document', date: 'd1', code: 'c', rawText: 'x', recordedBy: null, idTime: 1 },
    { id: 'fm2', kind: 'document', date: 'd2', code: 'c', rawText: 'x', recordedBy: null, idTime: 2 },
  ];
  const { groups: fileMatched } = findFileMatchedDuplicates(
    fileMatchEntries,
    [],
    { fm1: 'pdf', fm2: 'pdf' },
    { fm1: '10 KB', fm2: '10 KB' },
    {},
    {}
  );
  assert(
    fileMatched.length === 1 && fileMatched[0].sameFileTypeAndSize === true,
    'a cross-record file-matched group is always confirmed sameFileTypeAndSize by construction'
  );
}

console.log('\n--- Note/consultation entries carry sibling attachment ids from flattenJournal (2026-07-13) ---');
{
  const attachDayGroups = [
    {
      title: 'Tue 05 Aug 2025',
      items: [
        encounter(
          'enc-att-1',
          'Mr Docman PCTI',
          [
            noteEntry('note-att-1', 'Seen in pain clinic', 'Mr Docman PCTI', 'Mr Docman PCTI', null),
            nestedDocumentEntry(
              'doc-att-1',
              'Attachment',
              'DCA File Doctor Care Anywhere Virtual GP consultation notes'
            ),
          ],
          false
        ),
        encounter(
          'enc-att-2',
          'Mr Docman PCTI',
          [
            noteEntry('note-att-2', 'Seen in pain clinic', 'Mr Docman PCTI', 'Mr Docman PCTI', null),
            nestedDocumentEntry(
              'doc-att-2',
              'Attachment',
              'DCA File Doctor Care Anywhere Virtual GP consultation notes'
            ),
          ],
          false
        ),
        // Control: a note with no sibling attachment in its heading at all.
        encounter(
          'enc-att-3',
          'Dr Test',
          [noteEntry('note-att-plain', 'Unrelated note', 'plain text, no attachment', 'Dr Test', null)],
          false
        ),
      ],
    },
  ];
  const attachResult = analyzeJournal(attachDayGroups);
  const byAttachId = Object.fromEntries(attachResult.entries.map((e) => [e.id, e]));
  assert(
    Array.isArray(byAttachId['note-att-1'].attachedDocumentIds) &&
      byAttachId['note-att-1'].attachedDocumentIds[0] === 'doc-att-1',
    'a note entry captures its sibling document id from the same heading'
  );
  assert(
    Array.isArray(byAttachId['note-att-2'].attachedDocumentIds) &&
      byAttachId['note-att-2'].attachedDocumentIds[0] === 'doc-att-2',
    'a second, independent consultation captures its OWN sibling document id, not the other one'
  );
  assert(
    byAttachId['note-att-plain'].attachedDocumentIds === undefined,
    'a note with no sibling document in its heading has no attachedDocumentIds field at all'
  );

  const attGroup = attachResult.groups.find((g) => g.kind === 'note' && g.code === 'Seen in pain clinic');
  assert(
    !!attGroup && attGroup.tier === TIER.EXACT,
    'identical note text/author across two consultations still tiers EXACT at the pure groupAndTier stage — ' +
      'the attachment mismatch check is a later, on-demand cross-check (applyOnDemandCrossChecks in ' +
      'duplicate-checker.js), not part of groupAndTier itself, same layering as fileType/fileSize for documents'
  );
}

console.log('\n--- hasAttachedDocumentMismatch (2026-07-13) ---');
{
  function noteGroupEntry(id, attachedDocumentIds) {
    return {
      id,
      kind: 'note',
      date: 'Tue 05 Aug 2025',
      code: 'Seen in pain clinic',
      rawText: 'Mr Docman PCTI',
      recordedBy: 'Mr Docman PCTI',
      recordedByOrganisation: null,
      attachedDocumentIds,
    };
  }
  function noteGroup(entries) {
    return {
      kind: 'note',
      date: 'Tue 05 Aug 2025',
      code: 'Seen in pain clinic',
      tier: TIER.EXACT,
      gp2gpWrapper: false,
      recordedByVaries: false,
      recordedByOrganisationVaries: false,
      keeperEntryId: null,
      entries,
    };
  }

  {
    // Known, differing (fileType,fileSize) attachments — the real bug case
    // (2026-07-13 live example): identical note text/author, genuinely
    // different underlying attached documents.
    const group = noteGroup([noteGroupEntry('n1', ['d1']), noteGroupEntry('n2', ['d2'])]);
    const fileTypes = { d1: 'pdf', d2: 'pdf' };
    const fileSizes = { d1: '10.44 KB', d2: '58.20 KB' };
    assert(
      hasAttachedDocumentMismatch(group, fileTypes, fileSizes) === true,
      "differing known (fileType,fileSize) between two members' attachments is flagged as a mismatch"
    );
  }

  {
    // Known, matching attachments — genuinely the same document duplicated
    // alongside a genuinely duplicated note. Must NOT flag.
    const group = noteGroup([noteGroupEntry('n1', ['d1']), noteGroupEntry('n2', ['d2'])]);
    const fileTypes = { d1: 'pdf', d2: 'pdf' };
    const fileSizes = { d1: '10.44 KB', d2: '10.44 KB' };
    assert(
      hasAttachedDocumentMismatch(group, fileTypes, fileSizes) === false,
      'matching known (fileType,fileSize) attachments across members is NOT flagged — a real duplicate note+attachment pair'
    );
  }

  {
    // One member's attachment known, the other's unknown (fetch failed, or
    // this document type has no fileType field) — conservative
    // pass-through, never guesses a mismatch off incomplete data. Same
    // knownKeys.size < 2 rule splitDocumentGroupsByFileType already uses.
    const group = noteGroup([noteGroupEntry('n1', ['d1']), noteGroupEntry('n2', ['d2'])]);
    const fileTypes = { d1: 'pdf' };
    const fileSizes = { d1: '10.44 KB' };
    assert(
      hasAttachedDocumentMismatch(group, fileTypes, fileSizes) === false,
      'one member with an unknown attachment signature is never treated as a mismatch'
    );
  }

  {
    // No attachedDocumentIds on either member at all — the overwhelming
    // majority case (plain freestanding note duplicates). Must behave
    // exactly as before this feature existed.
    const group = noteGroup([noteGroupEntry('n1', undefined), noteGroupEntry('n2', undefined)]);
    assert(
      hasAttachedDocumentMismatch(group, {}, {}) === false,
      'notes with no attachment at all are never flagged — existing note-duplicate behaviour is unchanged'
    );
  }

  {
    // Multiple attachments per member — composite signature must be
    // order-independent (sorted+joined), so the same SET of attachments in
    // a different array order still compares as equal, not a false mismatch.
    const group = noteGroup([noteGroupEntry('n1', ['d1', 'd2']), noteGroupEntry('n2', ['d2', 'd1'])]);
    const fileTypes = { d1: 'pdf', d2: 'xml' };
    const fileSizes = { d1: '10.44 KB', d2: '2.00 KB' };
    assert(
      hasAttachedDocumentMismatch(group, fileTypes, fileSizes) === false,
      'the same set of multiple attachments in a different order is not falsely flagged as a mismatch'
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
  const noteComparison = buildNoteFieldComparison(
    { entries: [{ id: 'a' }, { id: 'b' }] },
    {
      a: originalOverview,
      b: duplicateOverview,
    }
  );
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

console.log('\n--- hasJunkTitlePrefix / hasCreatedAfterFiled (cross-record file-match markers) ---');
{
  assert(
    hasJunkTitlePrefix(
      'tiff: 1C60D211-3115-4EAE-B2C3-86C905926DCB.tiff - Type: Admin Letter Author Org: Adur Health Partnership Custodian Org: Park Road Surgery'
    ) === true,
    'a raw filename/GUID fragment before the first recognised label is flagged as a junk prefix (real live example)'
  );
  assert(
    hasJunkTitlePrefix('Type: Referral letter Author Org: Kingston Hospital') === false,
    'a title with no content before its first recognised label is not flagged'
  );
  assert(
    hasJunkTitlePrefix('An ordinary, non-generic document title') === false,
    'a title with no recognised labels at all is not flagged (a normal, non-generic document)'
  );
  assert(hasJunkTitlePrefix(null) === false, 'a null title is not flagged, never throws');
  assert(hasJunkTitlePrefix(42) === false, 'a non-string title is not flagged, never throws');

  assert(
    hasCreatedAfterFiled('2026-02-23 15:11:10', '2026-02-23 06:05:21') === true,
    'a creation time after the filing time is flagged as a reimport anomaly'
  );
  assert(
    hasCreatedAfterFiled('2026-02-23 06:05:21', '2026-02-23 15:11:10') === false,
    'a normal created-before-filed ordering is not flagged'
  );
  assert(
    hasCreatedAfterFiled(null, '2026-02-23 15:11:10') === false,
    'a missing createdDate never guesses — not flagged'
  );
  assert(
    hasCreatedAfterFiled('not a date', '2026-02-23 15:11:10') === false,
    'an unparseable date never guesses — not flagged'
  );
}

console.log('\n--- findSuspiciousDocuments (zero-fetch trigger for the opt-in second pass, 2026-07-08) ---');
{
  // Two documents created within the same minute (id-timestamp), a third
  // created minutes later — the shared-minute pair should flag, the lone
  // one should not (from timestamp alone).
  const t0 = Date.parse('2026-02-23T06:05:00Z');
  const near = { id: 'near-1', kind: 'document', idTime: t0, title: null };
  const nearToo = { id: 'near-2', kind: 'document', idTime: t0 + 30000, title: null }; // same minute
  const farAway = { id: 'far-1', kind: 'document', idTime: t0 + 10 * 60000, title: null }; // 10 min later
  const junkTitled = {
    id: 'junk-1',
    kind: 'document',
    idTime: t0 + 20 * 60000,
    title: 'tiff: GUID.tiff - Type: Admin Letter Author Org: Y',
  };
  const clean = { id: 'clean-1', kind: 'document', idTime: t0 + 30 * 60000, title: 'Type: Referral letter' };

  const flagged = findSuspiciousDocuments([near, nearToo, farAway, junkTitled, clean]);
  const byId = Object.fromEntries(flagged.map((f) => [f.id, f]));
  assert(
    byId['near-1'] && byId['near-1'].sharedCreationMinute === true,
    'near-1 flagged: shares its creation minute with near-2'
  );
  assert(
    byId['near-2'] && byId['near-2'].sharedCreationMinute === true,
    'near-2 flagged: shares its creation minute with near-1'
  );
  assert(!byId['far-1'], 'far-1 is NOT flagged — its creation minute is unique and its title is clean');
  assert(
    byId['junk-1'] && byId['junk-1'].titleJunkPrefix === true,
    'junk-1 flagged: junk title prefix, even with a unique creation minute'
  );
  assert(!byId['clean-1'], 'clean-1 is NOT flagged — clean title, unique creation minute');
  assert(
    byId['near-1'].titleJunkPrefix === false && byId['junk-1'].sharedCreationMinute === false,
    'each flagged entry reports which specific marker(s) fired, not just a bare true'
  );

  assert(findSuspiciousDocuments([]).length === 0, 'no documents produces no flags');
  assert(findSuspiciousDocuments(null).length === 0, 'null input degrades to no flags, never throws');
  assert(
    findSuspiciousDocuments([{ id: 'no-time', kind: 'document', idTime: null, title: null }]).length === 0,
    'an entry with no decodable id-timestamp and a clean title is never flagged'
  );

  // End-to-end: analyzeJournal wires findSuspiciousDocuments in for free,
  // and a document's raw `title` (not just the concatenated rawText blob)
  // is retained on the flattened entry — needed for the junk-prefix check.
  const dayGroups = [
    {
      title: 'Mon 1 Jan 2024',
      items: [
        flatDocumentItem('junk-doc', 'Other digital signal', 'tiff: GUID.tiff - Type: Admin Letter Author Org: Y', {}),
      ],
    },
  ];
  const analysis = analyzeJournal(dayGroups);
  assert(
    analysis.summary.suspiciousDocumentsTotal === 1 && analysis.suspiciousDocuments[0].id === 'junk-doc',
    'analyzeJournal surfaces suspiciousDocuments/summary.suspiciousDocumentsTotal for free, with no candidate group required'
  );
  const docEntry = analysis.entries.find((e) => e.id === 'junk-doc');
  assert(
    docEntry.title === 'tiff: GUID.tiff - Type: Admin Letter Author Org: Y',
    'a document entry retains its own raw title field (not just the concatenated rawText blob)'
  );
}

console.log('\n--- findFileMatchedDuplicates (cross-record file-size/type duplicate detection, 2026-07-08) ---');
{
  // Real motivating case (test patient 5): documents duplicated across
  // DIFFERENT journal dates — the primary (kind, date, code) key can never
  // catch these. Two documents, different dates, different codes, but the
  // SAME (fileType, fileSize) — the one signal that can't be corrupted by a
  // reimport relabelling pass.
  const docA = {
    id: 'doc-a',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Admin Letter',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 100,
    title: 'tiff: GUID.tiff - Type: Admin Letter Author Org: Y',
  };
  const docB = {
    id: 'doc-b',
    kind: 'document',
    date: 'Fri 15 Mar 2024',
    code: 'Clinical letter',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 200,
    title: 'Type: Clinical letter Author Org: Y',
  };
  const docC = {
    id: 'doc-c',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Admin Letter',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 50,
    title: null,
  };
  const fileType = { 'doc-a': 'tiff', 'doc-b': 'tiff', 'doc-c': 'pdf' };
  const fileSize = { 'doc-a': '245.11 KB', 'doc-b': '245.11 KB', 'doc-c': '10 KB' };
  const created = { 'doc-a': '2026-02-23 15:11:10' };
  const filed = { 'doc-a': '2026-02-23 06:05:21' };

  const { groups, clustersChecked } = findFileMatchedDuplicates(
    [docA, docB, docC],
    [],
    fileType,
    fileSize,
    created,
    filed
  );
  assert(
    clustersChecked === 1,
    'only the tiff/245.11KB bucket has 2+ members and counts as a checked cluster — the lone pdf/10KB document never reaches that stage'
  );
  assert(groups.length === 1, 'only the cluster with 2+ members forms a group — a lone document never groups');
  const g = groups[0];
  assert(
    g.kind === 'document' && g.tier === TIER.REVIEW && g.fileMatched === true,
    'the group is document-kind, tier REVIEW, tagged fileMatched'
  );
  assert(
    g.gp2gpWrapper === false,
    'gp2gpWrapper is always false for a file-matched group (not a text-wrapper concept)'
  );
  assert(
    g.entries
      .map((e) => e.id)
      .sort()
      .join(',') === 'doc-a,doc-b',
    'the matched cluster contains exactly the two same-fileType/fileSize documents'
  );
  assert(
    g.date === '2 dates',
    'a cluster spanning different journal dates reports a date COUNT, never a guessed single date'
  );
  assert(
    g.code === 'tiff · 245.11 KB',
    'code displays the matching evidence itself (fileType · fileSize), since there is no shared textual code'
  );
  assert(
    g.keeperEntryId === 'doc-a',
    'keeper is the earliest-idTime member of the MATCHED pair (doc-a=100 < doc-b=200), independent of doc-c'
  );
  const entryA = g.entries.find((e) => e.id === 'doc-a');
  const entryB = g.entries.find((e) => e.id === 'doc-b');
  assert(entryA.isKeeper === true && entryB.isKeeper === false, 'isKeeper flags match the computed keeper');
  assert(entryA.titleJunkPrefix === true, "doc-a's junk-prefixed title is flagged on its entry");
  assert(entryB.titleJunkPrefix === false, "doc-b's clean title is not flagged");
  assert(
    entryA.createdAfterFiled === true,
    "doc-a's created-after-filed anomaly is flagged from the caller-supplied maps"
  );
  assert(entryB.createdAfterFiled === false, 'doc-b has no known created/filed data, so no anomaly is guessed');

  const sameDate = findFileMatchedDuplicates(
    [
      {
        id: 'x',
        kind: 'document',
        date: 'Mon 1 Jan',
        recordedBy: 'A',
        recordedByOrganisation: 'Org1',
        idTime: 1,
        title: null,
      },
      {
        id: 'y',
        kind: 'document',
        date: 'Mon 1 Jan',
        recordedBy: 'B',
        recordedByOrganisation: 'Org2',
        idTime: 2,
        title: null,
      },
    ],
    [],
    { x: 'pdf', y: 'pdf' },
    { x: '1KB', y: '1KB' },
    {},
    {}
  );
  assert(
    sameDate.groups[0].date === 'Mon 1 Jan',
    'a cluster where every member shares one date reports that single date, not a count'
  );
  assert(
    sameDate.groups[0].recordedByVaries === true && sameDate.groups[0].recordedByOrganisationVaries === true,
    'recordedBy/recordedByOrganisation variance is computed the same way buildGroupRecord does'
  );

  const missingFields = findFileMatchedDuplicates(
    [
      { id: 'p', kind: 'document', date: 'd', idTime: 1 },
      { id: 'q', kind: 'document', date: 'd', idTime: 2 },
    ],
    [],
    { p: 'pdf' }, // q has no known fileType
    { p: '1KB', q: '1KB' },
    {},
    {}
  );
  assert(
    missingFields.groups.length === 0 && missingFields.clustersChecked === 0,
    'entries with an unknown fileType or fileSize are excluded from matching entirely — never guessed into a cluster'
  );

  // Dedup: a cluster that's already EXACTLY one existing group is not
  // re-reported as a new group.
  const alreadyGrouped = [{ kind: 'document', entries: [{ id: 'm' }, { id: 'n' }] }];
  const dedup = findFileMatchedDuplicates(
    [
      { id: 'm', kind: 'document', date: 'd', idTime: 1 },
      { id: 'n', kind: 'document', date: 'd', idTime: 2 },
    ],
    alreadyGrouped,
    { m: 'pdf', n: 'pdf' },
    { m: '1KB', n: '1KB' },
    {},
    {}
  );
  assert(
    dedup.groups.length === 0 && dedup.clustersChecked === 1,
    'a cluster whose member set already equals one existing group is skipped — checked, but not re-reported'
  );

  // Partial coverage: a cluster spanning documents that landed in DIFFERENT
  // existing groups (or none) IS still reported — the whole point of this
  // pass is surfacing what the primary grouping structurally could not see.
  const partiallyGrouped = [{ kind: 'document', entries: [{ id: 'm' }, { id: 'other' }] }];
  const partial = findFileMatchedDuplicates(
    [
      { id: 'm', kind: 'document', date: 'd1', idTime: 1 },
      { id: 'n', kind: 'document', date: 'd2', idTime: 2 },
    ],
    partiallyGrouped,
    { m: 'pdf', n: 'pdf' },
    { m: '1KB', n: '1KB' },
    {},
    {}
  );
  assert(
    partial.groups.length === 1 &&
      partial.groups[0].entries
        .map((e) => e.id)
        .sort()
        .join(',') === 'm,n',
    'a cluster only partially covered by an existing (different-membership) group is still surfaced as new'
  );

  assert(
    findFileMatchedDuplicates([], [], {}, {}, {}, {}).groups.length === 0,
    'no document entries at all produces no groups, never throws'
  );
  assert(
    findFileMatchedDuplicates(null, null, {}, {}, {}, {}).groups.length === 0,
    'null document entries degrades to no groups, never throws'
  );
}

console.log('\n--- accurxAttachmentUrl / accurx URL-attachment false-positive fix (live-reported 2026-07-17) ---');
{
  assert(
    accurxAttachmentUrl('Record Attachment', 'URL: https://example.com/photo1') === 'https://example.com/photo1',
    'extracts the URL from a matching Record Attachment + "URL: " title'
  );
  assert(
    accurxAttachmentUrl('record attachment', 'url: https://example.com/PHOTO1') === 'https://example.com/photo1',
    'case-insensitive on both the type label and the URL prefix; extracted value is lowercased for comparison'
  );
  assert(
    accurxAttachmentUrl('Admin Letter', 'URL: https://example.com/x') === null,
    'a different Type never matches, however URL-shaped the title is'
  );
  assert(
    accurxAttachmentUrl('Record Attachment', 'Two week wait referral') === null,
    'a Record Attachment whose title is not "URL: ..." never matches'
  );
  assert(accurxAttachmentUrl('Record Attachment', null) === null, 'a null title never matches, never throws');
  assert(accurxAttachmentUrl(null, 'URL: https://example.com/x') === null, 'a null code never matches, never throws');

  // Real motivating case: accurx delivers a patient message plus several
  // photo links as separate ".txt"/"Record Attachment" documents. The
  // previous GP system's export templating means these often share BOTH
  // fileType and fileSize even though the actual URL (and therefore the
  // real attachment) differs.
  const urlA = {
    id: 'accurx-a',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Record Attachment',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 1,
    title: 'URL: https://accurx.nhs.uk/p/photo-1',
  };
  const urlB = {
    id: 'accurx-b',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Record Attachment',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 2,
    title: 'URL: https://accurx.nhs.uk/p/photo-2',
  };
  const urlC = {
    id: 'accurx-c',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Record Attachment',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 3,
    title: 'URL: https://accurx.nhs.uk/p/photo-3',
  };
  const sameFileType = { 'accurx-a': 'txt', 'accurx-b': 'txt', 'accurx-c': 'txt' };
  const sameFileSize = { 'accurx-a': '1.2 KB', 'accurx-b': '1.2 KB', 'accurx-c': '1.2 KB' };

  const differingUrls = findFileMatchedDuplicates([urlA, urlB, urlC], [], sameFileType, sameFileSize, {}, {});
  assert(
    differingUrls.groups.length === 0,
    'three accurx URL-attachments sharing fileType/fileSize but each pointing at a DIFFERENT URL never form a candidate group'
  );
  assert(
    differingUrls.accurxUrlMismatchAvoided === 3,
    'all 3 entries are counted as kept apart by the URL-mismatch refinement'
  );

  // Control: a genuine re-send of the SAME link (same fileType/fileSize AND
  // same URL) must still be caught as a real duplicate — the fix must not
  // blanket-exclude every accurx attachment, only ones that actually differ.
  const urlD = { ...urlA, id: 'accurx-d' };
  const genuineDuplicate = findFileMatchedDuplicates(
    [urlA, urlD],
    [],
    { 'accurx-a': 'txt', 'accurx-d': 'txt' },
    { 'accurx-a': '1.2 KB', 'accurx-d': '1.2 KB' },
    {},
    {}
  );
  assert(
    genuineDuplicate.groups.length === 1 && genuineDuplicate.groups[0].entries.length === 2,
    'two accurx URL-attachments sharing fileType/fileSize AND the same URL still group as a genuine duplicate'
  );
  assert(genuineDuplicate.accurxUrlMismatchAvoided === 0, 'no mismatch avoided when the URLs actually match');

  // Mixed bucket: differing-URL accurx entries must not disturb an unrelated
  // genuine same-fileType/fileSize document pair sharing the same base key
  // by coincidence (accurx entries route to a disjoint key space).
  const plainX = {
    id: 'plain-x',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Admin Letter',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 4,
    title: 'Type: Admin Letter',
  };
  const plainY = {
    id: 'plain-y',
    kind: 'document',
    date: 'Mon 1 Jan 2024',
    code: 'Admin Letter',
    recordedBy: 'X',
    recordedByOrganisation: null,
    idTime: 5,
    title: 'Type: Admin Letter',
  };
  const mixed = findFileMatchedDuplicates(
    [urlA, urlB, plainX, plainY],
    [],
    { ...sameFileType, 'plain-x': 'txt', 'plain-y': 'txt' },
    { ...sameFileSize, 'plain-x': '1.2 KB', 'plain-y': '1.2 KB' },
    {},
    {}
  );
  assert(
    mixed.groups.length === 1 &&
      mixed.groups[0].entries
        .map((e) => e.id)
        .sort()
        .join(',') === 'plain-x,plain-y',
    'a genuine non-accurx duplicate pair sharing the same fileType/fileSize as the split-apart accurx entries still groups normally'
  );
}

console.log('\n--- sortGroupsByJournalOrder (documentLinked groups adjacent to their document task) ---');
{
  // Journal order: a note pair early, a document mid-list, another note
  // pair late. The documentLinked group's pseudo-entry is NOT in the
  // journal list — it must slot in via its linkedDocumentId.
  const journalEntries = [{ id: 'n1' }, { id: 'n1-dup' }, { id: 'doc-1' }, { id: 'n2' }, { id: 'n2-dup' }];
  const earlyGroup = { entries: [{ id: 'n1' }, { id: 'n1-dup' }] };
  const lateGroup = { entries: [{ id: 'n2' }, { id: 'n2-dup' }] };
  const linkedGroup = {
    documentLinked: true,
    entries: [{ id: 'pseudo-1', fromDocumentLinkedElement: true, linkedDocumentId: 'doc-1' }, { id: 'n2' }],
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

console.log('\n--- External links (buildCareRecordJournalUrl / buildDocumentDownloadUrl) ---');
{
  const apiBase = 'https://e38a9f.api.england.medicus.health';
  assert(
    buildCareRecordJournalUrl(apiBase, '01923611-438d-709c-b6f5-ba80da283466') ===
      'https://england.medicus.health/e38a9f/patient/patient/care-record/01923611-438d-709c-b6f5-ba80da283466?careRecordTab=journal',
    'buildCareRecordJournalUrl matches the confirmed real capture exactly: site code moves from subdomain to first path segment'
  );
  assert(buildCareRecordJournalUrl(null, 'patient-1') === null, 'buildCareRecordJournalUrl refuses a missing apiBase');
  assert(buildCareRecordJournalUrl(apiBase, null) === null, 'buildCareRecordJournalUrl refuses a missing patientId');
  assert(
    buildCareRecordJournalUrl('https://not-the-expected-shape.example.com', 'patient-1') === null,
    'buildCareRecordJournalUrl refuses rather than guesses when apiBase does not match the confirmed {code}.api.england.medicus.health shape'
  );
  assert(
    buildCareRecordJournalUrl('https://e38a9f.api.OTHER.domain.com', 'patient-1') === null,
    'buildCareRecordJournalUrl refuses a non-england.medicus.health domain rather than guessing the transform still applies'
  );

  assert(
    buildDocumentDownloadUrl(apiBase, '019c5688-49cf-71e5-bb2a-b6927a3fc63a') ===
      'https://e38a9f.api.england.medicus.health/clinical/document/download-file/019c5688-49cf-71e5-bb2a-b6927a3fc63a?convertToPDF=0',
    'buildDocumentDownloadUrl matches the confirmed real capture exactly — on the API host, not the UI host'
  );
  assert(buildDocumentDownloadUrl(null, 'file-1') === null, 'buildDocumentDownloadUrl refuses a missing apiBase');
  assert(buildDocumentDownloadUrl(apiBase, null) === null, 'buildDocumentDownloadUrl refuses a missing fileId');
}

console.log('\n--- Investigation (lab result) duplicate detection (2026-08-22) ---');
{
  // The confirmed real cluster this feature was built from: same conceptId,
  // same specimenCollectionDate to the minute, same resultValue, distinct
  // investigationReportIds (the live capture had 14 copies; three suffice
  // here to prove the group forms and everything remains a member). Single-
  // analyte reports, so matchedCount === totalCount === 1 for every report —
  // trivially a full match, which is exactly right (Medicus itself shows
  // this as one report card, not one per analyte — see
  // buildInvestigationReportGroups).
  const invDupDayGroups = [
    {
      title: 'Tue 11 Jan 2005',
      items: [
        flatInvestigationItem('inv-report-1', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-1',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-a'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-2', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-2',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-b'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-3', [
          investigationGroup('U&Es', [
            // Same conceptId, different free-text label — real finding:
            // description varies ("CREATININE" vs "Serum creatinine") across
            // copies of the same duplicated result; conceptId doesn't.
            investigationResult(
              'inv-res-3',
              '1000731000000107',
              'CREATININE',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-c'
            ),
          ]),
        ]),
      ],
    },
  ];
  const invDupResult = analyzeJournal(invDupDayGroups);
  assert(
    !invDupResult.groups.some((g) => g.kind === 'investigation'),
    'Investigation groups no longer appear in the generic groups list — rolled up into investigationReportGroups instead'
  );
  assert(
    invDupResult.investigationReportGroups.length === 1,
    'Three same-concept, same-minute, same-value investigation results roll up into one report-level candidate group'
  );
  const invDupGroup = invDupResult.investigationReportGroups[0];
  assert(invDupGroup.reportIds.length === 3, 'All three distinct reports are members of the report group');
  assert(
    invDupGroup.fullMatch === true,
    'Every result in every report is accounted for — a full, safe-to-remove match'
  );
  assert(
    invDupResult.summary.investigationReportGroupsTotal === 1 &&
      invDupResult.summary.investigationFullMatchReportGroupsTotal === 1,
    'Summary counts reflect one report group, one of which is a full match'
  );

  // Legitimate same-day, different-time, different-value pair (the real
  // 2026-08-20 AKI-recheck creatinine example) — must NOT collide into one
  // candidate group just because both fall on the same calendar day.
  const sameDayDifferentTimeDayGroups = [
    {
      title: 'Thu 20 Aug 2026',
      items: [
        flatInvestigationItem('inv-report-4', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-4',
              '1000731000000107',
              'Serum creatinine',
              '116',
              'µmol/L',
              '2026-08-20 11:00:00',
              'report-d'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-5', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-5',
              '1000731000000107',
              'Serum creatinine',
              '115',
              'µmol/L',
              '2026-08-20 19:42:00',
              'report-e'
            ),
          ]),
        ]),
      ],
    },
  ];
  const sameDayResult = analyzeJournal(sameDayDifferentTimeDayGroups);
  assert(
    sameDayResult.investigationReportGroups.length === 0,
    'A same-day, different-time, different-value repeat test never forms a report group — exact collection minute is the grouping key, not the calendar day'
  );

  // Genuinely ambiguous case: same concept, same EXACT collection minute,
  // but a DIFFERENT result value — must be suppressed, not surfaced at a
  // lower tier for manual review (explicit "unambiguous clusters only"
  // product decision).
  const ambiguousDayGroups = [
    {
      title: 'Sun 1 Jun 2005',
      items: [
        flatInvestigationItem('inv-report-6', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-6',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-06-01 09:00:00',
              'report-f'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-7', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-7',
              '1000731000000107',
              'Serum creatinine',
              '150',
              'µmol/L',
              '2005-06-01 09:00:00',
              'report-g'
            ),
          ]),
        ]),
      ],
    },
  ];
  const ambiguousResult = analyzeJournal(ambiguousDayGroups);
  assert(
    ambiguousResult.investigationReportGroups.length === 0,
    'Same concept + same exact collection minute but a DIFFERENT result value is suppressed, not surfaced as a report group'
  );
  assert(
    ambiguousResult.summary.suppressedInvestigationAmbiguousTotal === 1,
    'The ambiguous exclusion is tracked in the suppressed-investigation-ambiguous diagnostic, not silently dropped'
  );

  // A result with no collection timestamp at all must be skipped rather
  // than grouped under a shared null-date key.
  const noTimestampDayGroups = [
    {
      title: 'Tue 11 Jan 2005',
      items: [
        flatInvestigationItem('inv-report-8', [
          investigationGroup('U&Es', [
            investigationResult('inv-res-8', '1000731000000107', 'Serum creatinine', '97', 'µmol/L', null, 'report-h'),
          ]),
        ]),
        flatInvestigationItem('inv-report-9', [
          investigationGroup('U&Es', [
            investigationResult('inv-res-9', '1000731000000107', 'Serum creatinine', '97', 'µmol/L', null, 'report-i'),
          ]),
        ]),
      ],
    },
  ];
  const noTimestampResult = analyzeJournal(noTimestampDayGroups);
  assert(
    noTimestampResult.investigationReportGroups.length === 0,
    'Results with no collection timestamp are skipped entirely, never grouped under a shared null-date key'
  );

  // No write contract exists for a single investigation RESULT (Medicus's
  // own removal operates at report level) — investigation must stay a
  // read-only recommendation via the generic per-entry contract table;
  // report-level removal has its own dedicated function, tested below.
  assert(
    isRemovableKind('investigation') === false,
    'investigation has no generic per-entry write contract — report-level removal is a separate, dedicated path'
  );

  // Only one occurrence at all — never a candidate group (shared <2-member rule).
  const singleResultDayGroups = [
    {
      title: 'Tue 11 Jan 2005',
      items: [
        flatInvestigationItem('inv-report-10', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-10',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-j'
            ),
          ]),
        ]),
      ],
    },
  ];
  const singleResult = analyzeJournal(singleResultDayGroups);
  assert(
    singleResult.investigationReportGroups.length === 0,
    'A single investigation result, with nothing to compare against, never forms a report group'
  );

  // Multi-analyte FULL match: two reports, each with two analytes
  // (creatinine + sodium), every analyte matching between them — the
  // "displayed as Medicus does" case: one card covering the whole panel,
  // safe to offer for report-level removal.
  const fullMatchDayGroups = [
    {
      title: 'Wed 12 Mar 2025',
      items: [
        flatInvestigationItem('inv-report-11', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-11a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-k'
            ),
            investigationResult(
              'inv-res-11b',
              '1000761000000109',
              'Serum sodium',
              '140',
              'mmol/L',
              '2025-03-12 09:00:00',
              'report-k'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-12', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-12a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-l'
            ),
            investigationResult(
              'inv-res-12b',
              '1000761000000109',
              'Serum sodium',
              '140',
              'mmol/L',
              '2025-03-12 09:00:00',
              'report-l'
            ),
          ]),
        ]),
      ],
    },
  ];
  const fullMatchResult = analyzeJournal(fullMatchDayGroups);
  assert(
    fullMatchResult.investigationReportGroups.length === 1,
    'Two reports whose every analyte matches roll up into one report group'
  );
  const fullMatchGroup = fullMatchResult.investigationReportGroups[0];
  assert(
    fullMatchGroup.analyteGroups.length === 2,
    'Both analytes (creatinine and sodium) are part of the report group'
  );
  assert(fullMatchGroup.fullMatch === true, 'Both reports are fully accounted for — safe to remove');

  // Multi-analyte PARTIAL match: two reports share a matching creatinine,
  // but their sodium DIFFERS — this report pair must still surface (the
  // creatinine match is real evidence) but must NOT be flagged as safe to
  // bulk-remove, since one of the two reports may hold genuinely unique
  // data the other doesn't.
  const partialMatchDayGroups = [
    {
      title: 'Wed 12 Mar 2025',
      items: [
        flatInvestigationItem('inv-report-13', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-13a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-m'
            ),
            investigationResult(
              'inv-res-13b',
              '1000761000000109',
              'Serum sodium',
              '140',
              'mmol/L',
              '2025-03-12 09:00:00',
              'report-m'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-14', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-14a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-n'
            ),
            investigationResult(
              'inv-res-14b',
              '1000761000000109',
              'Serum sodium',
              '138',
              'mmol/L',
              '2025-03-12 09:00:00',
              'report-n'
            ),
          ]),
        ]),
      ],
    },
  ];
  const partialMatchResult = analyzeJournal(partialMatchDayGroups);
  assert(
    partialMatchResult.investigationReportGroups.length === 1,
    'A partially-matching report pair still surfaces as a candidate group (the creatinine match is real evidence)'
  );
  const partialMatchGroup = partialMatchResult.investigationReportGroups[0];
  assert(
    partialMatchGroup.analyteGroups.length === 1,
    'Only the analyte that actually matches (creatinine) is part of the group — sodium differs, so it is excluded entirely'
  );
  assert(
    partialMatchGroup.fullMatch === false,
    'A report where not every result is matched is NOT flagged as safe to bulk-remove'
  );
  assert(
    partialMatchResult.summary.investigationReportGroupsTotal === 1 &&
      partialMatchResult.summary.investigationFullMatchReportGroupsTotal === 0,
    'Summary counts distinguish a surfaced-but-not-safe group from a full-match one'
  );

  // Keeper selection: the earliest-created report (by UUIDv7 id timestamp
  // of its own member results) is picked as the one to keep, same
  // tie-breaker principle as every other kind's keeperEntryId — real
  // UUIDv7 ids from confirmed live captures (2005-era vs 2026-era).
  const keeperDayGroups = [
    {
      title: 'Tue 11 Jan 2005',
      items: [
        flatInvestigationItem('inv-report-15', [
          investigationGroup('U&Es', [
            investigationResult(
              '019236e3-e6b4-72a3-a219-00f42d2c075b',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-o'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-16', [
          investigationGroup('U&Es', [
            investigationResult(
              '01a02250-4f82-717b-b1c2-6c2dd20f3c5b',
              '1000731000000107',
              'Serum creatinine',
              '97',
              'µmol/L',
              '2005-01-11 14:15:00',
              'report-p'
            ),
          ]),
        ]),
      ],
    },
  ];
  const keeperResult = analyzeJournal(keeperDayGroups);
  assert(
    keeperResult.investigationReportGroups[0].keeperReportId === 'report-o',
    'The report whose member result has the earlier UUIDv7 timestamp is picked as the keeper'
  );
}

console.log('\n--- buildInvestigationReportRemovalRequest (report-level write contract) ---');
{
  const apiBase = 'https://e38a9f.api.england.medicus.health';
  const req = buildInvestigationReportRemovalRequest(apiBase, 'report-a', 'Removing duplicate report');
  assert(
    req.url === 'https://e38a9f.api.england.medicus.health/clinical/investigation/mark-incorrect-and-hidden',
    'Posts to the confirmed live-captured endpoint'
  );
  assert(req.method === 'POST', 'Uses POST');
  assert(
    req.body.investigationReportId === 'report-a' &&
      req.body.reason === 'Removing duplicate report' &&
      req.body.isConfirmedRemoval === true,
    'Body matches the confirmed real capture exactly: investigationReportId + reason + isConfirmedRemoval'
  );
  assert(buildInvestigationReportRemovalRequest(null, 'report-a', 'reason') === null, 'Refuses a missing apiBase');
  assert(buildInvestigationReportRemovalRequest(apiBase, null, 'reason') === null, 'Refuses a missing reportId');
  assert(buildInvestigationReportRemovalRequest(apiBase, 'report-a', '') === null, 'Refuses a blank reason');
  assert(
    buildInvestigationReportRemovalRequest(apiBase, 'report-a', '   ') === null,
    'Refuses a whitespace-only reason'
  );
}

console.log('\n--- fullMatch fails closed on unread/unflattened results ---');
{
  // Two reports share a matching creatinine, but report-q also holds a
  // result with no collection timestamp. Flatten skips that result; the
  // raw census must still count it so fullMatch cannot be true.
  const mixedTimestampDayGroups = [
    {
      title: 'Wed 12 Mar 2025',
      items: [
        flatInvestigationItem('inv-report-17', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-17a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-q'
            ),
            investigationResult('inv-res-17b', '1000761000000109', 'Serum sodium', '140', 'mmol/L', null, 'report-q'),
          ]),
        ]),
        flatInvestigationItem('inv-report-18', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-18a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-r'
            ),
          ]),
        ]),
      ],
    },
  ];
  const mixedTimestamp = analyzeJournal(mixedTimestampDayGroups);
  assert(
    mixedTimestamp.investigationReportGroups.length === 1,
    'A pair that shares one readable matching analyte still surfaces'
  );
  assert(
    mixedTimestamp.investigationReportGroups[0].fullMatch === false,
    'A report with a result flatten skipped (no collection timestamp) is never fullMatch'
  );
  assert(
    mixedTimestamp.investigationReportGroups[0].skippedCountByReport['report-q'] >= 1,
    'The skipped unread result is counted against the report that holds it'
  );
  assert(
    canRemoveInvestigationReports(mixedTimestamp.investigationReportGroups[0], 'report-r') === false,
    'Execute-time gate refuses a cluster that is not a fullMatch'
  );

  const missingConceptDayGroups = [
    {
      title: 'Wed 12 Mar 2025',
      items: [
        flatInvestigationItem('inv-report-19', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-19a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-s'
            ),
            investigationResult('inv-res-19b', null, 'Uncoded analyte', '1', 'x', '2025-03-12 09:00:00', 'report-s'),
          ]),
        ]),
        flatInvestigationItem('inv-report-20', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-20a',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-t'
            ),
          ]),
        ]),
      ],
    },
  ];
  const missingConcept = analyzeJournal(missingConceptDayGroups);
  assert(
    missingConcept.investigationReportGroups[0].fullMatch === false,
    'A report with a result flatten skipped (no conceptId) is never fullMatch'
  );

  const fullMatchGroup = analyzeJournal([
    {
      title: 'Wed 12 Mar 2025',
      items: [
        flatInvestigationItem('inv-report-21', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-21',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-u'
            ),
          ]),
        ]),
        flatInvestigationItem('inv-report-22', [
          investigationGroup('U&Es', [
            investigationResult(
              'inv-res-22',
              '1000731000000107',
              'Serum creatinine',
              '90',
              'µmol/L',
              '2025-03-12 09:00:00',
              'report-v'
            ),
          ]),
        ]),
      ],
    },
  ]).investigationReportGroups[0];
  assert(
    canRemoveInvestigationReports(fullMatchGroup, fullMatchGroup.keeperReportId || 'report-u') === true,
    'Execute-time gate allows a genuine fullMatch whose keeper is in the cluster'
  );
  assert(
    canRemoveInvestigationReports(fullMatchGroup, 'not-in-cluster') === false,
    'Execute-time gate refuses a keeper id that is not one of the clustered reports'
  );
  assert(canRemoveInvestigationReports(fullMatchGroup, null) === false, 'Execute-time gate refuses a missing keeper');
}

console.log('\n--- stripJournalFilterParams (read-time journal URL defence) ---');
{
  const filtered =
    'https://e38a9f.api.england.medicus.health/clinical/data/patient-journal/overview/__PATIENT_UUID__?year[]=2005&type[]=investigation&initialCat=year';
  const stripped = stripJournalFilterParams(filtered);
  assert(
    !stripped.includes('year[]') && !stripped.includes('type[]') && !stripped.includes('initialCat'),
    'Strips the confirmed journal-tab filter params'
  );
  assert(
    stripped.includes('/clinical/data/patient-journal/overview/__PATIENT_UUID__'),
    'Keeps the journal overview path and patient placeholder'
  );
  assert(stripJournalFilterParams(null) === null, 'A missing URL is returned unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
