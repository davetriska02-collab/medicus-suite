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
  decodeIdTimestamp,
  parseGenericDocumentTitle,
  resolveDocumentTypeLabel,
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
assert(docGroup && docGroup.tier === TIER.EXACT, 'Identical flat document duplicates tier EXACT');
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
  nestedDocResult.groups.some((g) => g.kind === 'document' && g.code === 'Discharge summary' && g.tier === TIER.EXACT),
  'Two nested document entries in separate encounters form an EXACT duplicate group'
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
assert(dualRenderDocGroup && dualRenderDocGroup.tier === TIER.EXACT, 'Flat+nested document dual-render tiers EXACT');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
