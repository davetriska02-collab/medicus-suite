// Medicus Suite — shared/journal-problem-matching.js tests
// Run with: node test-journal-problem-matching.js
//
// Finds patient-journal 'note' entries that look like the same clinical
// event as a problem, for the "Clean up code" panel's read-only journal
// duplicate detection (content-scripts/problem-description-cleanup.js).
// Deliberately narrower than engine/record-duplicate-parser.js's
// flattenJournal — only entryType/type === 'note' entries — see the file's
// own header for why.

'use strict';

const {
  normaliseJournalDayTitle,
  daysBetween,
  extractJournalNoteCandidates,
  findJournalMatchesForProblem,
  findCodeTextMatches,
  resolveVerifiedDateMatch,
  sortJournalMatches,
  applyDateConfirmation,
} = require('./shared/journal-problem-matching.js');
const { matchProblemByName } = require('./shared/problem-text-linking.js');

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

console.log('--- normaliseJournalDayTitle ---');
check(normaliseJournalDayTitle('Thu 02 Jul 2026') === '2026-07-02', '"DayName DD Mon YYYY" -> "YYYY-MM-DD"');
check(normaliseJournalDayTitle('Friday 14 Jun 2025') === '2025-06-14', 'longer weekday token also handled');
check(normaliseJournalDayTitle('9 Sep 2024') === '2024-09-09', 'no weekday token, single-digit day still zero-padded');
check(normaliseJournalDayTitle('nonsense') === null, 'unparseable string -> null, never throws');
check(normaliseJournalDayTitle('') === null, 'empty string -> null');
check(normaliseJournalDayTitle(null) === null, 'null -> null, never throws');
check(normaliseJournalDayTitle(undefined) === null, 'undefined -> null, never throws');
check(normaliseJournalDayTitle('Thu 02 Foo 2026') === null, 'unrecognised month token -> null');

console.log('\n--- daysBetween ---');
check(daysBetween('2025-06-14', '2025-06-14') === 0, 'same date -> 0');
check(daysBetween('2025-06-01', '2025-06-14') === 13, 'later date -> positive day count');
check(daysBetween('2025-06-14', '2025-06-01') === 13, 'order-independent (absolute difference)');
check(daysBetween('2025-05-31', '2025-06-02') === 2, 'crosses a month boundary correctly');
check(daysBetween(null, '2025-06-14') === null, 'null first date -> null, never throws');
check(daysBetween('2025-06-14', null) === null, 'null second date -> null, never throws');
check(daysBetween('not-a-date', '2025-06-14') === null, 'unparseable date -> null, never throws');
check(daysBetween('2025-6-14', '2025-06-14') === null, 'non-zero-padded date rejected (strict YYYY-MM-DD format)');

// ── Fixture ──────────────────────────────────────────────────────────────
// A fabricated patientJournalRecords-shaped payload covering every tier.
const problem = {
  id: 'prob-1',
  description: 'Anxiety with depression',
  recordDate: '2025-06-14',
  additionalInformation: 'Patient referred urgently to cardiology for further assessment',
};

const dayGroups = [
  // Day 1: a nested note entry whose OWN entry.linkedProblems references
  // prob-1 directly -> the 'linked' tier. Text is deliberately UNRELATED
  // and the date deliberately doesn't match problem.recordDate, to prove
  // this tier is a pure per-entry structural fact, independent of both.
  {
    title: 'Sat 01 Feb 2025',
    items: [
      {
        type: 'encounter',
        id: 'enc-1',
        data: {
          linkedProblems: [],
          consultationTopics: [
            {
              linkedProblems: [],
              headings: [
                {
                  entries: [
                    {
                      entryType: 'note',
                      id: 'entry-linked',
                      clinicalCodeDescription: 'Completely unrelated wording',
                      linkedProblems: [{ id: 'prob-1', problemCodeDescription: 'Anxiety with depression' }],
                    },
                    // A prescription entry in the SAME encounter — must be
                    // excluded from candidates entirely (not a 'note').
                    {
                      entryType: 'prescription',
                      id: 'entry-rx',
                      productName: 'Sertraline 50mg tablets',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  },
  // Day 2 (matches problem.recordDate): a flat top-level note with text
  // IDENTICAL to the problem's description, NO linkedProblems at all ->
  // 'date-exact-text'.
  {
    title: 'Sat 14 Jun 2025',
    items: [
      {
        type: 'note',
        id: 'note-item-exact',
        data: {
          id: 'entry-exact',
          clinicalCodeDescription: 'Anxiety with depression',
          linkedProblems: [],
        },
      },
      // Same day, a document item — must be excluded (not a 'note' type).
      {
        type: 'document',
        id: 'doc-item',
        data: { id: 'entry-doc', documentTypeLabel: 'Letter', title: 'Referral letter' },
      },
    ],
  },
  // Day 3 (also matches problem.recordDate): a nested note entry, NO
  // linkedProblems, text a superset of the problem's significant words ->
  // 'date-partial-text'.
  {
    title: 'Sat 14 Jun 2025',
    items: [
      {
        type: 'encounter',
        id: 'enc-partial',
        data: {
          linkedProblems: [],
          consultationTopics: [
            {
              linkedProblems: [],
              headings: [
                {
                  entries: [
                    {
                      entryType: 'note',
                      id: 'entry-partial',
                      clinicalCodeDescription: 'Review of mixed anxiety with depression symptoms',
                      linkedProblems: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  },
  // Day 4: matching TEXT but a DIFFERENT date from problem.recordDate, NO
  // linkedProblems -> must be excluded entirely.
  {
    title: 'Mon 20 Jan 2025',
    items: [
      {
        type: 'note',
        id: 'note-item-wrong-date',
        data: { id: 'entry-wrong-date', clinicalCodeDescription: 'Anxiety with depression', linkedProblems: [] },
      },
    ],
  },
  // Day 5: same date as problem.recordDate but UNRELATED text, NO
  // linkedProblems -> excluded.
  {
    title: 'Sat 14 Jun 2025',
    items: [
      {
        type: 'note',
        id: 'note-item-unrelated',
        data: { id: 'entry-unrelated', clinicalCodeDescription: 'Routine blood pressure check', linkedProblems: [] },
      },
    ],
  },
  // Day 6, modelled on the real umbilical-hernia HAR capture (2026-08-12):
  // linkedProblems lives ONLY at topic level (encounter- and entry-level
  // both empty), and the entry's own text ALSO matches the problem's
  // description exactly. Deliberately a DIFFERENT date from
  // problem.recordDate, to prove this tier does NOT require a date match —
  // structural (topic-level) + textual corroboration is sufficient on its
  // own -> 'linked-exact-text'.
  {
    title: 'Wed 29 Jul 2009',
    items: [
      {
        type: 'encounter',
        id: 'enc-topic-linked-exact',
        data: {
          linkedProblems: [],
          consultationTopics: [
            {
              linkedProblems: [{ id: 'prob-1', problemCodeDescription: 'Anxiety with depression' }],
              headings: [
                {
                  entries: [
                    {
                      entryType: 'note',
                      id: 'entry-topic-linked-exact',
                      clinicalCodeDescription: 'Anxiety with depression',
                      linkedProblems: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  },
  // Day 7 — REGRESSION CASE, modelled on the real "Obesity" HAR capture
  // (2026-08-12): ONE consultation topic, linkedProblems populated at
  // TOPIC level only, with MULTIPLE sibling note entries underneath it —
  // exactly one ("entry-topic-linked-partial") has wording related to the
  // problem, the rest ("entry-topic-sibling-1/2") are unrelated notes from
  // the same visit (alcohol/smoking-style entries in the real case) that
  // must NOT be surfaced just because they share a consultation topic with
  // the genuinely-linked one.
  {
    title: 'Fri 25 Jan 2008',
    items: [
      {
        type: 'encounter',
        id: 'enc-topic-linked-multi',
        data: {
          linkedProblems: [],
          consultationTopics: [
            {
              linkedProblems: [{ id: 'prob-1', problemCodeDescription: 'Anxiety with depression' }],
              headings: [
                {
                  entries: [
                    {
                      entryType: 'note',
                      id: 'entry-topic-linked-partial',
                      clinicalCodeDescription: 'Review of anxiety with depression symptoms today',
                      linkedProblems: [],
                    },
                    {
                      entryType: 'note',
                      id: 'entry-topic-sibling-1',
                      clinicalCodeDescription: 'Alcohol consumption',
                      linkedProblems: [],
                    },
                    {
                      entryType: 'note',
                      id: 'entry-topic-sibling-2',
                      clinicalCodeDescription: 'Never smoked tobacco',
                      linkedProblems: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  },
  // Day 8 — fuzzy-SUPPRESSION check: on its own this would satisfy the fuzzy
  // fallback (note text matches problem.additionalInformation exactly,
  // within the date tolerance) but must NOT appear in results, because the
  // primary pass above already found 5 matches — the fuzzy fallback only
  // ever runs when the primary pass found NOTHING.
  {
    title: 'Wed 25 Jun 2025',
    items: [
      {
        type: 'note',
        id: 'note-item-fuzzy-suppressed',
        data: {
          id: 'entry-fuzzy-suppressed',
          clinicalCodeDescription: 'Nothing to do with the problem code',
          note: 'Patient referred urgently to cardiology for further assessment',
          linkedProblems: [],
        },
      },
    ],
  },
];

console.log('\n--- extractJournalNoteCandidates: only note entries included, entry vs topic linkage kept separate ---');
{
  const candidates = extractJournalNoteCandidates(dayGroups);
  const ids = candidates.map((c) => c.entryId);
  check(ids.indexOf('entry-rx') === -1, 'prescription entry excluded');
  check(ids.indexOf('entry-doc') === -1, 'document item excluded');
  check(ids.indexOf('entry-linked') !== -1, 'nested note entry (entry-level linked fixture) included');
  check(ids.indexOf('entry-exact') !== -1, 'flat top-level note item included');
  check(ids.indexOf('entry-partial') !== -1, 'nested note entry (partial-text fixture) included');

  const entryLinked = candidates.find((c) => c.entryId === 'entry-linked');
  check(
    !!entryLinked && entryLinked.entryLinkedProblemIds.indexOf('prob-1') === 0,
    'entry-level linkedProblems captured on entryLinkedProblemIds'
  );
  check(
    !!entryLinked && entryLinked.wideLinkedProblemIds.length === 0,
    'entry-level fixture has no topic/encounter linkage'
  );

  const topicLinked = candidates.find((c) => c.entryId === 'entry-topic-linked-exact');
  check(
    !!topicLinked && topicLinked.wideLinkedProblemIds.indexOf('prob-1') !== -1,
    'topic-level linkedProblems captured on wideLinkedProblemIds, not entryLinkedProblemIds'
  );
  check(
    !!topicLinked && topicLinked.entryLinkedProblemIds.length === 0,
    'topic-only fixture has empty entryLinkedProblemIds (matches the real hernia/Obesity captures)'
  );

  const siblings = candidates.filter((c) => c.entryId.indexOf('entry-topic-sibling') === 0);
  check(siblings.length === 2, 'both unrelated siblings in the multi-entry topic are still extracted as candidates');
  check(
    siblings.every((c) => c.wideLinkedProblemIds.indexOf('prob-1') !== -1),
    'siblings correctly inherit the TOPIC-level linkedProblems flag (this is the raw data — filtering happens in findJournalMatchesForProblem, not here)'
  );

  check(
    candidates.every((c) => c.entryId),
    'every candidate has an entryId'
  );
}

console.log('\n--- findJournalMatchesForProblem: tiering ---');
{
  const results = findJournalMatchesForProblem(problem, dayGroups, matchProblemByName);
  const byId = {};
  results.forEach((r) => {
    byId[r.entryId] = r;
  });

  check(
    !!byId['entry-linked'] && byId['entry-linked'].tier === 'linked',
    'entry-level linkedProblems -> linked tier, regardless of text or date'
  );
  check(
    !!byId['entry-exact'] && byId['entry-exact'].tier === 'date-exact-text',
    'same date, byte-identical text, no structural link -> date-exact-text'
  );
  check(
    !!byId['entry-partial'] && byId['entry-partial'].tier === 'date-partial-text',
    'same date, every significant word present, no structural link -> date-partial-text'
  );
  check(!byId['entry-wrong-date'], 'matching text but different date, no structural link -> excluded entirely');
  check(!byId['entry-unrelated'], 'same date but unrelated text, no structural link -> excluded');
  check(!byId['entry-rx'] && !byId['entry-doc'], 'non-note entries never appear in results');
  check(
    !!byId['entry-topic-linked-exact'] && byId['entry-topic-linked-exact'].tier === 'linked-exact-text',
    'topic-level linkedProblems + exact text match -> linked-exact-text, despite a non-matching date'
  );

  console.log('\n--- findJournalMatchesForProblem: Obesity-flood REGRESSION (2026-08-12 live bug) ---');
  check(
    !!byId['entry-topic-linked-partial'] && byId['entry-topic-linked-partial'].tier === 'linked-partial-text',
    'the ONE entry in the multi-entry topic whose text actually relates to the problem is surfaced (linked-partial-text)'
  );
  check(
    !byId['entry-topic-sibling-1'] && !byId['entry-topic-sibling-2'],
    'REGRESSION: the two unrelated sibling entries in the SAME topic are correctly excluded — topic-level linkage alone is no longer sufficient (this is the exact real-world "Obesity" flood: 11 topic-linked entries, only 1 a genuine duplicate)'
  );

  check(results.length === 5, `exactly 5 matches expected, got ${results.length}`);
  check(
    results[0].tier === 'linked' &&
      results[1].tier === 'linked-exact-text' &&
      results[2].tier === 'linked-partial-text' &&
      results[3].tier === 'date-exact-text' &&
      results[4].tier === 'date-partial-text',
    'results sorted: linked, linked-exact-text, linked-partial-text, date-exact-text, date-partial-text'
  );
  check(
    !byId['entry-fuzzy-suppressed'],
    'fuzzy fallback SUPPRESSED: a candidate that would otherwise satisfy the fuzzy criteria does not appear because the primary pass already found matches'
  );
}

console.log(
  '\n--- findJournalMatchesForProblem: fuzzy fallback, additionalInformation pairing (2026-08-12, only runs when the primary pass finds nothing) ---'
);
{
  // description deliberately shares no words with any candidate's note
  // below, so these entries can ONLY match via the additionalInformation
  // pairing (tier 2), never the code-text pairing (tier 1) — isolates the
  // fall-through behaviour from the precedence test further down.
  const fuzzyProblem = {
    id: 'prob-fuzzy',
    description: 'A description sharing no words with any candidate below',
    recordDate: '2020-05-10',
    additionalInformation: 'Patient referred urgently to cardiology for further assessment',
  };
  const fuzzyDayGroups = [
    // 10 days after recordDate (within the 30-day tolerance) — note's own
    // clinicalCodeDescription is unrelated, but its `note` field matches
    // additionalInformation exactly -> fuzzy-additional-info-exact.
    {
      title: 'Sun 20 May 2020',
      items: [
        {
          type: 'note',
          id: 'note-item-fuzzy-exact',
          data: {
            id: 'entry-fuzzy-exact',
            clinicalCodeDescription: 'Completely unrelated code text',
            note: 'Patient referred urgently to cardiology for further assessment',
            linkedProblems: [],
          },
        },
      ],
    },
    // 20 days after recordDate, note text a superset of additionalInformation's
    // significant words -> fuzzy-additional-info-partial.
    {
      title: 'Wed 30 May 2020',
      items: [
        {
          type: 'note',
          id: 'note-item-fuzzy-partial',
          data: {
            id: 'entry-fuzzy-partial',
            clinicalCodeDescription: 'Also unrelated',
            note: 'Discussed: patient referred urgently to cardiology for further assessment today',
            linkedProblems: [],
          },
        },
      ],
    },
    // 40 days after recordDate — BEYOND the 30-day tolerance, otherwise
    // identical to the exact-match case above -> must be excluded.
    {
      title: 'Fri 19 Jun 2020',
      items: [
        {
          type: 'note',
          id: 'note-item-too-far',
          data: {
            id: 'entry-too-far',
            clinicalCodeDescription: 'Unrelated',
            note: 'Patient referred urgently to cardiology for further assessment',
            linkedProblems: [],
          },
        },
      ],
    },
    // Within tolerance, but no `note` field at all -> nothing to compare,
    // must be excluded.
    {
      title: 'Mon 11 May 2020',
      items: [
        {
          type: 'note',
          id: 'note-item-no-note-field',
          data: { id: 'entry-no-note-field', clinicalCodeDescription: 'Unrelated', linkedProblems: [] },
        },
      ],
    },
  ];

  const fuzzyResults = findJournalMatchesForProblem(fuzzyProblem, fuzzyDayGroups, matchProblemByName);
  const fuzzyById = {};
  fuzzyResults.forEach((r) => {
    fuzzyById[r.entryId] = r;
  });

  check(
    !!fuzzyById['entry-fuzzy-exact'] && fuzzyById['entry-fuzzy-exact'].tier === 'fuzzy-additional-info-exact',
    "within date tolerance, additionalInformation exactly matches the entry's own note field -> fuzzy-additional-info-exact"
  );
  check(
    !!fuzzyById['entry-fuzzy-partial'] && fuzzyById['entry-fuzzy-partial'].tier === 'fuzzy-additional-info-partial',
    "within date tolerance, note field is a superset of additionalInformation's significant words -> fuzzy-additional-info-partial"
  );
  check(!fuzzyById['entry-too-far'], 'beyond the date tolerance window -> excluded even with identical note text');
  check(!fuzzyById['entry-no-note-field'], 'candidate with no note field -> excluded, nothing to compare');
  check(fuzzyResults.length === 2, `exactly 2 fuzzy matches expected, got ${fuzzyResults.length}`);

  const noInfoProblem = { id: 'prob-fuzzy', description: 'X', recordDate: '2020-05-10', additionalInformation: null };
  check(
    findJournalMatchesForProblem(noInfoProblem, fuzzyDayGroups, matchProblemByName).length === 0,
    'no additionalInformation AND a description with no matchable significant words -> fuzzy fallback runs but finds nothing (not a false match)'
  );
}

console.log(
  '\n--- findJournalMatchesForProblem: fuzzy fallback, code-text pairing (2026-08-13, "contains the text of the problem code") ---'
);
{
  const codeTextProblem = {
    id: 'prob-fuzzy-code',
    description: 'Chronic kidney disease stage 3',
    recordDate: '2021-03-01',
    additionalInformation: 'Seen for annual review of long term condition',
  };
  const codeTextDayGroups = [
    // 14 days after recordDate, within tolerance: note CONTAINS the
    // problem's own code text (every significant word present, word-
    // boundary) but is not byte-identical to it -> fuzzy-code-text-partial.
    {
      title: 'Mon 15 Mar 2021',
      items: [
        {
          type: 'note',
          id: 'note-item-code-text-partial',
          data: {
            id: 'entry-code-text-partial',
            clinicalCodeDescription: 'Unrelated code text',
            note: 'Review of chronic kidney disease stage 3, stable today',
            linkedProblems: [],
          },
        },
      ],
    },
    // 15 days after recordDate: note text byte-identical (after
    // normalising) to the problem's own code text -> fuzzy-code-text-exact.
    {
      title: 'Tue 16 Mar 2021',
      items: [
        {
          type: 'note',
          id: 'note-item-code-text-exact',
          data: {
            id: 'entry-code-text-exact',
            clinicalCodeDescription: 'Unrelated',
            note: 'Chronic kidney disease stage 3',
            linkedProblems: [],
          },
        },
      ],
    },
    // 16 days after recordDate: note text matches BOTH the code text AND
    // additionalInformation -> PRECEDENCE — must resolve to a
    // fuzzy-code-text-* tier (checked first), never fuzzy-additional-info-*.
    {
      title: 'Wed 17 Mar 2021',
      items: [
        {
          type: 'note',
          id: 'note-item-both',
          data: {
            id: 'entry-both',
            clinicalCodeDescription: 'Unrelated',
            note: 'Chronic kidney disease stage 3 — seen for annual review of long term condition',
            linkedProblems: [],
          },
        },
      ],
    },
  ];

  const codeTextResults = findJournalMatchesForProblem(codeTextProblem, codeTextDayGroups, matchProblemByName);
  const codeTextById = {};
  codeTextResults.forEach((r) => {
    codeTextById[r.entryId] = r;
  });

  check(
    !!codeTextById['entry-code-text-partial'] &&
      codeTextById['entry-code-text-partial'].tier === 'fuzzy-code-text-partial',
    "note field contains every significant word of the problem's own code text -> fuzzy-code-text-partial"
  );
  check(
    !!codeTextById['entry-code-text-exact'] && codeTextById['entry-code-text-exact'].tier === 'fuzzy-code-text-exact',
    "note field byte-identical (normalised) to the problem's own code text -> fuzzy-code-text-exact"
  );
  check(
    !!codeTextById['entry-both'] && codeTextById['entry-both'].tier.indexOf('fuzzy-code-text') === 0,
    'PRECEDENCE: a note matching BOTH pairings resolves to the code-text tier (checked first), not additional-info'
  );
  check(codeTextResults.length === 3, `exactly 3 fuzzy matches expected, got ${codeTextResults.length}`);
}

console.log(
  "\n--- findCodeTextMatches / resolveVerifiedDateMatch / sortJournalMatches (2026-08-13: day-group date is sometimes wrong, verify via the note's own true recordDate) ---"
);
{
  const verifyProblem = {
    id: 'prob-verify',
    description: 'Chronic kidney disease stage 3',
    recordDate: '2021-03-01',
    onsetDate: '2020-11-15',
  };
  const verifyDayGroups = [
    // Text matches, NOT structurally linked, day-group date does NOT match
    // problem.recordDate -> exactly the "would otherwise be silently
    // dropped" case findCodeTextMatches exists to catch.
    {
      title: 'Fri 25 Jun 2021', // day-group date, far from both recordDate and onsetDate
      items: [
        {
          type: 'note',
          id: 'note-item-needs-verify',
          data: {
            id: 'entry-needs-verify',
            clinicalCodeDescription: 'Chronic kidney disease stage 3',
            linkedProblems: [],
          },
        },
      ],
    },
    // Text matches AND day-group date already matches recordDate -> already
    // covered by 'date-exact-text', should be flagged alreadyDateMatched.
    {
      title: 'Mon 01 Mar 2021',
      items: [
        {
          type: 'note',
          id: 'note-item-already-dated',
          data: {
            id: 'entry-already-dated',
            clinicalCodeDescription: 'Chronic kidney disease stage 3',
            linkedProblems: [],
          },
        },
      ],
    },
    // Text matches AND entry-level linked -> already covered by 'linked',
    // should be flagged alreadyStructurallyLinked.
    {
      title: 'Sat 01 Jan 2000', // deliberately irrelevant date
      items: [
        {
          type: 'note',
          id: 'note-item-already-linked',
          data: {
            id: 'entry-already-linked',
            clinicalCodeDescription: 'Chronic kidney disease stage 3',
            linkedProblems: [{ id: 'prob-verify', problemCodeDescription: 'Chronic kidney disease stage 3' }],
          },
        },
      ],
    },
    // Text does NOT match -> excluded from findCodeTextMatches entirely.
    {
      title: 'Tue 01 Jun 2021',
      items: [
        {
          type: 'note',
          id: 'note-item-unrelated-text',
          data: { id: 'entry-unrelated-text', clinicalCodeDescription: 'Ingrowing toenail', linkedProblems: [] },
        },
      ],
    },
  ];

  const codeMatches = findCodeTextMatches(verifyProblem, verifyDayGroups, matchProblemByName);
  const codeMatchesById = {};
  codeMatches.forEach((c) => {
    codeMatchesById[c.entryId] = c;
  });

  check(!!codeMatchesById['entry-needs-verify'], 'text-matched candidate found');
  check(
    codeMatchesById['entry-needs-verify'].alreadyStructurallyLinked === false &&
      codeMatchesById['entry-needs-verify'].alreadyDateMatched === false,
    'candidate not already covered by any cheaper tier -> worth spending a verification fetch on'
  );
  check(
    !!codeMatchesById['entry-already-dated'] && codeMatchesById['entry-already-dated'].alreadyDateMatched === true,
    'candidate whose day-group date already matches recordDate is flagged alreadyDateMatched (no fetch needed)'
  );
  check(
    !!codeMatchesById['entry-already-linked'] &&
      codeMatchesById['entry-already-linked'].alreadyStructurallyLinked === true,
    'candidate that is entry-level linked is flagged alreadyStructurallyLinked (no fetch needed)'
  );
  check(!codeMatchesById['entry-unrelated-text'], 'candidate with non-matching text excluded entirely');

  console.log('--- resolveVerifiedDateMatch ---');
  const needsVerifyCandidate = codeMatchesById['entry-needs-verify'];
  check(
    resolveVerifiedDateMatch(verifyProblem, needsVerifyCandidate, '2021-03-10').tier === 'verified-date-exact-text',
    'verified recordDate within tolerance of problem.recordDate -> verified-date-exact-text (exact text confidence)'
  );
  check(
    resolveVerifiedDateMatch(verifyProblem, needsVerifyCandidate, '2020-11-20') !== null,
    'verified recordDate within tolerance of problem.ONSETDATE (not recordDate) -> still matches — Nick\'s "chiefly recordDate and onsetDate", tried as alternatives'
  );
  check(
    resolveVerifiedDateMatch(verifyProblem, needsVerifyCandidate, '2019-01-01') === null,
    'verified recordDate outside tolerance of BOTH recordDate and onsetDate -> null'
  );
  check(
    resolveVerifiedDateMatch(verifyProblem, needsVerifyCandidate, null) === null,
    'no verified date -> null, never throws'
  );
  check(resolveVerifiedDateMatch(verifyProblem, null, '2021-03-10') === null, 'no candidate -> null, never throws');

  const partialTextCandidate = {
    entryId: 'entry-partial-confidence',
    encounterId: null,
    clinicalCodeDescription: 'Some longer text',
    confidence: 'partial',
  };
  check(
    resolveVerifiedDateMatch(verifyProblem, partialTextCandidate, '2021-03-10').tier === 'verified-date-partial-text',
    "candidate's own confidence ('partial') carried through to the tier name"
  );

  console.log('--- sortJournalMatches ---');
  const unsorted = [
    { entryId: 'b', tier: 'date-exact-text', date: '2021-01-01' },
    { entryId: 'a', tier: 'linked', date: '2021-01-01' },
    { entryId: 'c', tier: 'verified-date-partial-text', date: '2021-01-01' },
    { entryId: 'd', tier: 'linked-partial-text', date: '2021-01-01' },
    { entryId: 'e', tier: 'verified-date-exact-text', date: '2021-01-01' },
  ];
  const sorted = sortJournalMatches(unsorted).map((m) => m.tier);
  check(
    JSON.stringify(sorted) ===
      JSON.stringify([
        'linked',
        'linked-partial-text',
        'verified-date-exact-text',
        'verified-date-partial-text',
        'date-exact-text',
      ]),
    'verified-date-* tiers rank between the linked-* family and the plain date-*-text tiers'
  );
  check(JSON.stringify(sortJournalMatches(null)) === '[]', 'null input -> empty array, never throws');
}

console.log('\n--- applyDateConfirmation: multi-match disambiguation (2026-08-14, modelled on a REAL live case) ---');
{
  // Real data, patient 019dde9e... (redacted problem id): a "Paediatric
  // surveillance admin" problem, recordDate === onsetDate === '1994-06-10'.
  // 4 journal entries all carry the identical clinicalCodeDescription and
  // are all topic-linked to the problem — indistinguishable on every
  // existing tier signal. Only entry-6's own TRUE recordDate (fetched via
  // note/overview, not the day-group title) exactly matches the problem.
  const paediatricProblem = { id: 'prob-paed', recordDate: '1994-06-10', onsetDate: '1994-06-10' };
  const paediatricMatches = [
    {
      entryId: 'entry-1997',
      tier: 'linked',
      date: '1997-09-19',
      clinicalCodeDescription: 'Paediatric surveillance admin',
    },
    {
      entryId: 'entry-aug94',
      tier: 'linked',
      date: '1994-08-10',
      clinicalCodeDescription: 'Paediatric surveillance admin',
    },
    {
      entryId: 'entry-jun22',
      tier: 'linked',
      date: '1994-06-22',
      clinicalCodeDescription: 'Paediatric surveillance admin',
    },
    {
      entryId: 'entry-jun10',
      tier: 'linked',
      date: '1994-06-10',
      clinicalCodeDescription: 'Paediatric surveillance admin',
    },
  ];
  // Real captured recordDates from note/overview — 'created' (a bulk-
  // migration timestamp, identical across all 4 real entries) deliberately
  // has no equivalent here, since applyDateConfirmation never reads it.
  const paediatricVerifiedDates = {
    'entry-1997': '1997-09-19',
    'entry-aug94': '1994-08-10',
    'entry-jun22': '1994-06-22',
    'entry-jun10': '1994-06-10',
  };

  const disambiguated = applyDateConfirmation(paediatricProblem, paediatricMatches, paediatricVerifiedDates);
  const byId = {};
  disambiguated.forEach((m) => {
    byId[m.entryId] = m;
  });

  check(
    byId['entry-jun10'].dateConfirmed === true && byId['entry-jun10'].confirmedDate === '1994-06-10',
    'REAL CASE: the entry whose own recordDate exactly matches the problem is flagged dateConfirmed'
  );
  check(
    !byId['entry-1997'].dateConfirmed && !byId['entry-aug94'].dateConfirmed && !byId['entry-jun22'].dateConfirmed,
    'REAL CASE: the other 3 identically-worded siblings are NOT flagged, despite sharing tier/text with the confirmed one'
  );
  check(
    disambiguated[0].entryId === 'entry-jun10',
    'the confirmed entry sorts FIRST, ahead of its identically-tiered siblings'
  );

  console.log('--- applyDateConfirmation: matches via onsetDate, not just recordDate ---');
  const onsetOnlyProblem = { id: 'prob-2', recordDate: '2020-01-01', onsetDate: '2019-06-15' };
  const onsetOnlyMatches = [{ entryId: 'e1', tier: 'linked', date: '2020-01-01', clinicalCodeDescription: 'X' }];
  const onsetResult = applyDateConfirmation(onsetOnlyProblem, onsetOnlyMatches, { e1: '2019-06-15' });
  check(
    onsetResult[0].dateConfirmed === true,
    'verified recordDate matching problem.onsetDate (not recordDate) also confirms — Nick\'s "chiefly recordDate and onsetDate", tried as alternatives'
  );

  console.log('--- applyDateConfirmation: edge cases ---');
  const noVerifiedDates = applyDateConfirmation(paediatricProblem, paediatricMatches, {});
  check(
    noVerifiedDates.every((m) => !m.dateConfirmed),
    'no verified dates supplied -> nothing flagged, never throws'
  );
  const closeButNotExact = applyDateConfirmation(paediatricProblem, paediatricMatches, { 'entry-jun22': '1994-06-22' });
  check(
    !closeButNotExact.find((m) => m.entryId === 'entry-jun22').dateConfirmed,
    'EXACT equality required, not the ±30-day fuzzy tolerance used elsewhere — 12 days off is not confirmed'
  );
  check(
    JSON.stringify(
      applyDateConfirmation(null, paediatricMatches, paediatricVerifiedDates).map((m) => m.dateConfirmed)
    ) === JSON.stringify([undefined, undefined, undefined, undefined]),
    'null problem -> nothing flagged, never throws (still returns the sorted list)'
  );
  check(JSON.stringify(applyDateConfirmation(paediatricProblem, null, {})) === '[]', 'null matches -> empty array');
  check(
    applyDateConfirmation(paediatricProblem, paediatricMatches, paediatricVerifiedDates) !== paediatricMatches,
    'returns a NEW array — does not mutate the input matches array'
  );
  check(
    paediatricMatches.every((m) => m.dateConfirmed === undefined),
    'the original match objects are also left unmutated'
  );
}

console.log('\n--- findJournalMatchesForProblem: edge cases never throw ---');
{
  check(
    JSON.stringify(findJournalMatchesForProblem(null, dayGroups, matchProblemByName)) === '[]',
    'null problem -> empty array'
  );
  check(
    JSON.stringify(findJournalMatchesForProblem({ id: 'x' }, [], matchProblemByName)) === '[]',
    'empty dayGroups -> empty array'
  );
  check(
    JSON.stringify(findJournalMatchesForProblem({ id: 'x' }, null, matchProblemByName)) === '[]',
    'null dayGroups -> empty array, never throws'
  );
  const noDateProblem = { id: 'prob-1', description: 'Anxiety with depression', recordDate: null };
  const results = findJournalMatchesForProblem(noDateProblem, dayGroups, matchProblemByName);
  const tiers = results.map((r) => r.tier).sort();
  check(
    JSON.stringify(tiers) === JSON.stringify(['linked', 'linked-exact-text', 'linked-partial-text']),
    'no recordDate on the problem -> only structurally-linked tiers can match (date-only tiers skipped, never a false match)'
  );
  check(
    JSON.stringify(findJournalMatchesForProblem(problem, dayGroups, null)) !== undefined,
    'missing matchProblemByName function -> does not throw'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed === 0 ? 0 : 1);
