// Medicus Suite — problem-nesting-canvas ("Organise problems" canvas overlay)
// tests
// Run with: node test-problem-nesting-canvas.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: date-key parsing/sorting, the left-pane tree builder (including
// the "suggested-but-already-a-real-parent" edge case), the tray's live
// filtering and actionable/blocked partition, the SVG connector-path math,
// and the drag-payload provenance check. See test-problem-nesting.js for the
// scan/commit/cycle-guard logic this file's window.ProblemNesting bridge
// wraps — none of that is re-tested here.

'use strict';

const {
  dateSortKey,
  compareDatesDesc,
  resolveDisplayDate,
  truncateText,
  buildProblemTree,
  flattenTreeIds,
  filterLiveSuggestions,
  suggestionCandidateTitleText,
  buildLinkedProblemPairs,
  buildSuggestionPairs,
  elbowFlagPoint,
  groupLinkedPairsIntoSets,
  linkSetLaneX,
  linkSetColor,
  buildElbowConnectorPath,
  computeLinkBusX,
  relativeRect,
  readDropPayload,
  uniqueIds,
  payloadIds,
  toggleSelectedIds,
  dragIdsFor,
  isAdditiveClick,
  buildPendingLink,
  significanceLaneKey,
  partitionProblemsBySignificance,
  buildLaneTrees,
  annotateTreeSuggestions,
  classifyDrop,
  canProposeEnd,
  canStageEnd,
  emptyDraft,
  hasDraftChanges,
  stageEnd,
  unstageEnd,
  stageSignificance,
  overlayInfoById,
  problemsNotEnded,
  endedProblemList,
  orderEndsForCommit,
  summariseDraft,
  effectiveLaneKey,
} = require('./content-scripts/problem-nesting-canvas.js');

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

console.log('--- dateSortKey: "DD Mon YYYY" (onsetDate) AND ISO "YYYY-MM-DD" (recordDate) ---');
{
  check(dateSortKey('20 Apr 2020') === '2020-04-20', 'two-digit day parsed');
  check(dateSortKey('5 Jul 2009') === '2009-07-05', 'single-digit day zero-padded');
  check(dateSortKey(null) === null, 'null -> null');
  check(dateSortKey(undefined) === null, 'undefined -> null');
  check(dateSortKey('') === null, 'empty string -> null');
  // recordDate comes back from slideover/overview ALREADY in ISO shape
  // (confirmed live 2026-08-08, HAR 48: "recordDate":"2025-01-15" on the
  // SAME response as "onsetDate":"20 Apr 2006") — both formats must parse,
  // since a real problem's two date fields use two different formats.
  check(dateSortKey('2025-01-15') === '2025-01-15', 'already-ISO shape (recordDate) parsed too, unchanged');
  check(dateSortKey('2020-04-20') === '2020-04-20', 'ISO shape passes through as its own sort key');
  check(dateSortKey('20 Foo 2020') === null, 'unrecognised month abbreviation -> null');
  check(dateSortKey('garbage') === null, 'garbage -> null, never throws');
  // The real bug Nick found live 2026-08-20: a partial onset date (month +
  // year only, no day — a real shape Medicus stores for an imported/
  // historic record) fell through both regexes and sorted as fully
  // undated, below every dated entry regardless of year.
  check(dateSortKey('Dec 2008') === '2008-12', 'partial "Mon YYYY" onset date parses to a YYYY-MM key, not null');
  check(dateSortKey('Jan 1999') === '1999-01', 'partial date works for any month, not just the reported example');
  check(
    dateSortKey('Foo 2020') === null,
    'unrecognised month abbreviation on a partial date -> null, same as a full date'
  );
  // The real bug Nick found live 2026-08-27: a YEAR-ONLY onset date (a
  // "since 2012" prostate-cancer problem) sorted as the OLDEST entry in the
  // canvas — older than problems from the 1990s. Same failure mode as the
  // month-only fix above, one level less specific, not covered by that fix.
  check(dateSortKey('2012') === '2012', 'a bare year with no month parses to a YYYY key, not null');
  check(dateSortKey('12345') === null, 'a 5-digit string is not a bare year — never guessed at');
}

console.log('--- compareDatesDesc: descending, undated always last ---');
{
  check(compareDatesDesc('20 Apr 2020', '5 Jul 2009') < 0, 'later date sorts first (descending)');
  check(compareDatesDesc('5 Jul 2009', '20 Apr 2020') > 0, 'earlier date sorts after');
  check(compareDatesDesc('20 Apr 2020', '20 Apr 2020') === 0, 'identical dates tie');
  check(compareDatesDesc(null, '20 Apr 2020') > 0, 'undated sorts after a dated entry');
  check(compareDatesDesc('20 Apr 2020', null) < 0, 'dated entry sorts before an undated one');
  check(compareDatesDesc(null, null) === 0, 'two undated entries tie');
  // The real bug Nick found live 2026-08-08: onsetDate and recordDate come
  // back from Medicus in TWO DIFFERENT formats on the SAME problem — a
  // straight string comparison (or a parser that only recognised one shape)
  // silently mis-sorted these against each other.
  check(
    compareDatesDesc('2025-01-15', '20 Apr 2020') < 0,
    'ISO-format date (2025) correctly sorts before a mixed-format-compared UK-style date (2020) — no longer both forced through one parser shape'
  );
  check(
    compareDatesDesc('1 Jan 2019', '2025-01-15') > 0,
    'a UK-style date correctly sorts after an ISO date from the same comparison, regardless of which side is which format'
  );
  // The partial-date fix, 2026-08-20: a "Mon YYYY" entry must sort within
  // its correct year — nowhere near the true undated ("sorts after
  // everything") position it fell into before dateSortKey recognised it.
  check(compareDatesDesc('Dec 2008', null) < 0, 'a partial date still sorts before a genuinely undated entry');
  check(compareDatesDesc('Dec 2008', '1 Jan 1990') < 0, 'a partial date correctly sorts before an older FULL date');
  check(
    compareDatesDesc('1 Jan 2020', 'Dec 2008') < 0,
    'a newer full date correctly sorts before an older partial date'
  );
  check(
    compareDatesDesc('Dec 2008', '15 Dec 2008') > 0,
    'a partial date sorts fractionally after a specifically-dated entry in the SAME month (least-specific-first within a tie)'
  );
  // The year-only fix, 2026-08-27: a bare "YYYY" entry must sort within its
  // correct year — nowhere near the true undated position, and this is the
  // real live case: a 2012 problem was landing below 1990s-dated ones.
  check(compareDatesDesc('2012', null) < 0, 'a year-only date still sorts before a genuinely undated entry');
  check(compareDatesDesc('2012', '1 Jan 1990') < 0, 'a year-only date correctly sorts before an older FULL date');
  check(
    compareDatesDesc('1 Jan 2020', '2012') < 0,
    'a newer full date correctly sorts before an older year-only date'
  );
  check(
    compareDatesDesc('2012', '15 Jun 2012') > 0,
    'a year-only date sorts fractionally after a specifically-dated entry in the SAME year (least-specific-first within a tie)'
  );
  check(
    compareDatesDesc('2012', 'Jun 2012') > 0,
    'a year-only date sorts fractionally after a month-only entry in the SAME year — least specific sorts latest'
  );
}

console.log('--- resolveDisplayDate: onset, falling back to record date when onset is blank ---');
{
  check(
    resolveDisplayDate({ onsetDate: '1 Jan 2020', recordDate: '1 Jan 2019' }) === '1 Jan 2020',
    'onset date preferred when present'
  );
  check(
    resolveDisplayDate({ onsetDate: null, recordDate: '1 Jan 2019' }) === '1 Jan 2019',
    'record date used when onset is blank'
  );
  check(resolveDisplayDate({ onsetDate: null, recordDate: null }) === null, 'both blank -> null');
  check(resolveDisplayDate(null) === null, 'no info at all -> null, never throws');
}

console.log('--- truncateText: single-line tile hint, keeps tiles compact ---');
{
  check(truncateText('short note', 70) === 'short note', 'short text passes through unchanged');
  check(truncateText('a'.repeat(80), 70).length === 70, 'long text truncated to the limit (including the ellipsis)');
  check(truncateText('a'.repeat(80), 70).endsWith('…'), 'truncated text ends with an ellipsis');
  check(truncateText('  ', 70) === null, 'whitespace-only text -> null, not an empty bubble');
  check(truncateText(null, 70) === null, 'null -> null');
  check(truncateText('exact', 5) === 'exact', 'text exactly at the limit is not truncated');
}

console.log('--- buildProblemTree: roots, nesting, sort order ---');
{
  const problems = [
    { id: 'ihd', description: 'Ischaemic heart disease' },
    { id: 'aspirin', description: 'Over the counter aspirin therapy' },
    { id: 'beta', description: 'Beta blocker not indicated' },
    { id: 'stent', description: 'Insertion of coronary artery stent' },
    { id: 'cancer', description: 'Breast cancer' },
  ];
  const infoById = {
    ihd: { onsetDate: '1 Jul 2009' },
    aspirin: { onsetDate: '1 Mar 2012' },
    beta: { onsetDate: null, recordDate: '1 Nov 2010', additionalInformation: '  Not currently indicated  ' },
    stent: { onsetDate: '1 Jul 2009' },
    cancer: { onsetDate: '1 Jan 2021', linkedProblemIds: ['ihd'] },
  };
  const parentMap = { aspirin: 'ihd', beta: 'ihd', stent: 'ihd' };
  const tree = buildProblemTree(problems, infoById, parentMap);
  check(tree.length === 2, 'two roots: cancer (no parent) and ihd (has children, no parent of its own)');
  check(
    tree[1].children.find((c) => c.id === 'beta').displayDate === '1 Nov 2010',
    'a child with no onset date falls back to record date for both display and sort'
  );
  check(
    tree[1].children.find((c) => c.id === 'beta').additionalInformation === '  Not currently indicated  ',
    "additionalInformation carried through onto the tree node untrimmed (trimming is the render layer's job, via truncateText)"
  );
  check(
    tree[0].additionalInformation === null,
    'a problem with no additionalInformation on record -> null, not undefined or empty string'
  );
  check(tree[0].id === 'cancer', 'roots sorted descending by date — 2021 cancer before 2009 ihd');
  check(tree[1].id === 'ihd', 'ihd is the second root');
  check(tree[1].children.length === 3, 'ihd has all three children attached');
  check(
    tree[1].children.map((c) => c.id).join(',') === 'aspirin,beta,stent',
    'children sorted descending by date (Mar 2012, Nov 2010, Jul 2009) — ties (stent) keep insertion order'
  );
  check(tree[0].parentId === null, 'a root node carries parentId: null — nothing to unlink');
  check(
    Array.isArray(tree[0].linkedProblemIds) && tree[0].linkedProblemIds[0] === 'ihd',
    'linkedProblemIds carried through onto the tree node from infoById'
  );
  check(
    Array.isArray(tree[1].linkedProblemIds) && tree[1].linkedProblemIds.length === 0,
    'a problem with no linkedProblemIds on record defaults to an empty array, never undefined'
  );
  check(
    tree[1].children.every((c) => c.parentId === 'ihd'),
    "every child node's own parentId points at its real, rendered parent — the field the tile's Remove-link button reads"
  );

  console.log('--- buildProblemTree: 3-deep nesting (mastectomy -> capsular contracture example) ---');
  const deep = [
    { id: 'cancer2', description: 'Malignant neoplasm of female breast' },
    { id: 'mastectomy', description: 'Total mastectomy' },
    { id: 'capsular', description: 'Capsular contracture of breast' },
  ];
  const deepInfo = {
    cancer2: { onsetDate: '1 Jan 2013' },
    mastectomy: { onsetDate: '1 Feb 2013' },
    capsular: { onsetDate: '1 Jan 2018' },
  };
  const deepParents = { mastectomy: 'cancer2', capsular: 'mastectomy' };
  const deepTree = buildProblemTree(deep, deepInfo, deepParents);
  check(deepTree.length === 1 && deepTree[0].id === 'cancer2', 'single root at depth 0');
  check(deepTree[0].children[0].id === 'mastectomy', 'mastectomy nested at depth 1');
  check(deepTree[0].children[0].children[0].id === 'capsular', 'capsular contracture nested at depth 2');

  console.log(
    '--- buildProblemTree: a problem carrying an unconfirmed suggestion still renders as an ordinary root (2026-08-19: no more tray to hide it in) ---'
  );
  const edge = [
    { id: 'x', description: 'X' },
    { id: 'c1', description: 'Child of X' },
  ];
  const edgeInfo = { x: { onsetDate: '1 Jan 2020' }, c1: { onsetDate: '1 Jan 2019' } };
  const edgeParents = { c1: 'x' };
  const withRealChildren = buildProblemTree(edge, edgeInfo, edgeParents);
  check(
    withRealChildren.length === 1 && withRealChildren[0].id === 'x' && withRealChildren[0].children.length === 1,
    'X renders as a root with its real child regardless of any suggestion status — buildProblemTree no longer takes a suggestion set at all'
  );
  const childless = buildProblemTree([{ id: 'y', description: 'Y' }], { y: { onsetDate: '1 Jan 2020' } }, {});
  check(
    childless.length === 1 && childless[0].id === 'y',
    'a childless problem with no parent renders as its own root too — suggestion-only hiding was removed entirely (annotateTreeSuggestions now attaches candidate data onto the SAME tile instead of a separate tray card)'
  );
}

console.log('--- flattenTreeIds ---');
{
  const tree = buildProblemTree(
    [
      { id: 'a', description: 'A' },
      { id: 'b', description: 'B' },
    ],
    {},
    { b: 'a' },
    new Set()
  );
  const ids = flattenTreeIds(tree);
  check(ids instanceof Set && ids.size === 2 && ids.has('a') && ids.has('b'), 'both root and nested child flattened');
  check(flattenTreeIds([]).size === 0, 'empty tree -> empty set, never throws');
}

console.log('--- filterLiveSuggestions: mirrors the old per-card filtering, once for the whole tray ---');
{
  const problems = [
    { id: 'child1', description: 'Child 1' },
    { id: 'parentA', description: 'Parent A' },
  ];
  const base = [
    { childId: 'child1', childDescription: 'Child 1', parentOptions: [{ id: 'parentA', description: 'Parent A' }] },
  ];
  check(
    filterLiveSuggestions(base, problems, {}, () => false).length === 1,
    'a valid, still-live suggestion passes through'
  );
  check(
    filterLiveSuggestions(base, [{ id: 'parentA', description: 'Parent A' }], {}, () => false).length === 0,
    'child removed as a duplicate this session (no longer in problems) -> dropped'
  );
  check(
    filterLiveSuggestions(base, problems, { child1: 'someoneElse' }, () => false).length === 0,
    'child already linked elsewhere this session (has a live parent) -> dropped'
  );
  check(
    filterLiveSuggestions(base, problems, {}, () => true).length === 0,
    'every candidate would create a cycle -> suggestion dropped entirely'
  );
  const multi = [
    {
      childId: 'child1',
      childDescription: 'Child 1',
      parentOptions: [
        { id: 'parentA', description: 'Parent A' },
        { id: 'parentB', description: 'Parent B' },
      ],
    },
  ];
  const narrowed = filterLiveSuggestions(
    multi,
    [
      { id: 'child1', description: 'Child 1' },
      { id: 'parentA', description: 'Parent A' },
      { id: 'parentB', description: 'Parent B' },
    ],
    {},
    (childId, parentId) => parentId === 'parentB'
  );
  check(
    narrowed.length === 1 && narrowed[0].parentOptions.length === 1 && narrowed[0].parentOptions[0].id === 'parentA',
    'parentOptions narrowed to only the still-live, non-cycle candidates — parentB dropped, parentA kept'
  );
}

console.log(
  '--- suggestionCandidateTitleText: per-candidate provenance copy, plain text for the flag tooltip (2026-08-19, moved off the card) ---'
);
{
  check(
    suggestionCandidateTitleText('Hypertension', 'snomed') === 'SNOMED marks this as a child of Hypertension',
    'a SNOMED-sourced candidate credits SNOMED'
  );
  check(
    suggestionCandidateTitleText('Cataract', 'override') ===
      "this practice's own reference list marks this as a child of Cataract",
    'an override-sourced candidate credits the practice reference list, never SNOMED'
  );
  check(
    suggestionCandidateTitleText('Something', undefined) === 'SNOMED marks this as a child of Something',
    'a missing source defaults to snomed (defensive — matches every candidate before this field existed)'
  );
  check(
    suggestionCandidateTitleText(null, 'snomed') === 'SNOMED marks this as a child of ',
    'null description -> empty, never throws'
  );
  check(
    /^<strong>|<\/strong>$/.test(suggestionCandidateTitleText('X', 'snomed')) === false,
    'plain text — no HTML markup (an SVG <title> element cannot render it, unlike the removed card-hint version)'
  );
}

console.log(
  '--- buildSuggestionPairs: directional pairs, tagged by kind (2026-08-19 — moved off the removed tray) ---'
);
{
  const entries = [
    { id: 'stent', suggestedIds: ['ihd'], textlinkId: null },
    { id: 'ecz', suggestedIds: [], textlinkId: 'ihd' },
    { id: 'multi', suggestedIds: ['a', 'b'], textlinkId: 'c' },
    { id: 'self', suggestedIds: ['self'], textlinkId: 'self' },
    { id: 'empty', suggestedIds: [], textlinkId: null },
  ];
  const pairs = buildSuggestionPairs(entries);
  check(
    pairs.some((p) => p.a === 'stent' && p.b === 'ihd' && p.kind === 'snomed'),
    'a SNOMED-ancestry candidate becomes a pair tagged "snomed"'
  );
  check(
    pairs.some((p) => p.a === 'ecz' && p.b === 'ihd' && p.kind === 'textlink'),
    'a text-link match becomes a pair tagged "textlink"'
  );
  check(
    pairs.filter((p) => p.a === 'multi').length === 3,
    'a tile with 2 SNOMED candidates AND a text-link match produces 3 separate pairs'
  );
  check(
    !pairs.some((p) => p.a === 'self' && p.b === 'self'),
    'a self-pointing id (SNOMED or text-link) is never turned into a pair'
  );
  check(
    JSON.stringify(buildSuggestionPairs(null)) === '[]' && JSON.stringify(buildSuggestionPairs([])) === '[]',
    'null/empty input -> [], never throws'
  );
  check(
    JSON.stringify(buildSuggestionPairs([{ id: 'x' }])) === '[]',
    'an entry with neither suggestedIds nor textlinkId contributes nothing'
  );
  check(
    pairs.find((p) => p.a === 'stent' && p.b === 'ihd').source === 'snomed',
    'a bare id with no "|source" suffix defaults to snomed provenance'
  );

  console.log('--- buildSuggestionPairs: "id|source" compound format (2026-08-19, for the flag tooltip) ---');
  const sourced = buildSuggestionPairs([{ id: 'x', suggestedIds: ['a|snomed', 'b|override', 'c'], textlinkId: null }]);
  check(
    sourced.find((p) => p.b === 'a').source === 'snomed' &&
      sourced.find((p) => p.b === 'b').source === 'override' &&
      sourced.find((p) => p.b === 'c').source === 'snomed',
    'each candidate carries its OWN source — explicit snomed, explicit override, and a bare id defaulting to snomed, all in the same call'
  );
  check(
    sourced.every((p) => p.b === 'a' || p.b === 'b' || p.b === 'c'),
    'the "|source" suffix is stripped from the pair\'s own b id — never leaks into the raw problem id'
  );
  const textlinkPair = buildSuggestionPairs([{ id: 'x', suggestedIds: [], textlinkId: 'y' }])[0];
  check(
    !('source' in textlinkPair),
    'a text-link pair carries no source field at all — only snomed-kind pairs need one'
  );
}

console.log('--- elbowFlagPoint: the flag marker sits at the midpoint of its OWN vertical bus segment ---');
{
  const rectA = { left: 0, right: 100, top: 100, bottom: 130, width: 100, height: 30 };
  const rectB = { left: 0, right: 100, top: 300, bottom: 330, width: 100, height: 30 };
  const point = elbowFlagPoint(rectA, rectB, 250);
  check(point.x === 250, 'flag sits ON the bus line (the laneX passed in), not offset from it');
  check(point.y === (115 + 315) / 2, 'flag sits at the vertical midpoint between the two tiles own centre-lines');
  check(elbowFlagPoint(null, rectB, 250) === null, 'missing rectA -> null, never throws');
  check(elbowFlagPoint(rectA, rectB, 'not-a-number') === null, 'non-numeric busX -> null, never throws');
}

console.log('--- buildElbowConnectorPath: elbow/bus routing for linked problems (2026-08-08 revision) ---');
{
  const rectA = { left: 0, right: 100, top: 0, width: 100, height: 20 };
  const rectB = { left: 20, right: 120, top: 100, width: 100, height: 20 };
  const d = buildElbowConnectorPath(rectA, rectB, 200);
  check(
    typeof d === 'string' && d === 'M 100 10 L 200 10 L 200 110 L 120 110',
    "arm out from A's right edge to the shared bus, down the bus, arm in to B's right edge"
  );
  check(buildElbowConnectorPath(null, rectB, 200) === null, 'missing rectA -> null, never throws');
  check(buildElbowConnectorPath(rectA, null, 200) === null, 'missing rectB -> null, never throws');
  check(buildElbowConnectorPath(rectA, rectB, null) === null, 'missing busX -> null, never throws');
  check(buildElbowConnectorPath(rectA, rectB, 'not a number') === null, 'non-numeric busX -> null, never throws');
}

console.log('--- computeLinkBusX: the shared vertical bus, clear of every tile, capped at the pane edge ---');
{
  const rects = [
    { right: 100 },
    { right: 340 }, // the widest tile — including one that isn't itself linked
    { right: 200 },
  ];
  check(
    computeLinkBusX(rects, 16) === 356,
    'clear of the WIDEST tile on screen, not just linked ones, plus the margin'
  );
  check(computeLinkBusX(rects) === 356, 'margin defaults to 16 when omitted');
  check(
    computeLinkBusX(rects, 16, 350) === 346,
    "capped at the tree pane's own right edge (minus a small buffer) so it never bleeds into the tray pane"
  );
  check(
    computeLinkBusX(rects, 16, 500) === 356,
    "a pane edge FAR to the right of the natural position doesn't push the bus out artificially"
  );
  check(computeLinkBusX([], 16) === null, 'no tiles at all -> null, never throws');
  check(computeLinkBusX(null, 16) === null, 'null input -> null, never throws');
}

console.log('--- buildLinkedProblemPairs: symmetric relationship, one line per link not two ---');
{
  // A and B both list each other (the confirmed live symmetric shape) —
  // must produce exactly ONE pair, not two.
  const symmetric = [
    { id: 'a', linkedIds: ['b'] },
    { id: 'b', linkedIds: ['a'] },
  ];
  const pairs = buildLinkedProblemPairs(symmetric);
  check(pairs.length === 1, 'a symmetric pair (both sides list each other) dedupes to ONE line, not two');
  check(
    (pairs[0].a === 'a' && pairs[0].b === 'b') || (pairs[0].a === 'b' && pairs[0].b === 'a'),
    'the single pair connects the right two ids, whichever order'
  );

  // A links to BOTH b and c — two distinct real links.
  const fanOut = [{ id: 'a', linkedIds: ['b', 'c'] }];
  check(buildLinkedProblemPairs(fanOut).length === 2, 'a problem linked to two different others produces two pairs');

  check(
    buildLinkedProblemPairs([{ id: 'a', linkedIds: ['a'] }]).length === 0,
    'a problem can never be linked to itself — self-reference dropped'
  );
  check(buildLinkedProblemPairs([{ id: 'a', linkedIds: [] }]).length === 0, 'no linked ids -> no pairs');
  check(buildLinkedProblemPairs([{ linkedIds: ['b'] }]).length === 0, 'an entry with no id of its own is skipped');
  check(buildLinkedProblemPairs(null).length === 0, 'null input -> empty, never throws');
  check(buildLinkedProblemPairs([]).length === 0, 'empty input -> empty, never throws');
}

console.log('--- groupLinkedPairsIntoSets: connected components, one lane/colour per genuine set ---');
{
  // Two COMPLETELY SEPARATE pairs (no shared problem) — the real bug Nick
  // found live: these were sharing one bus AND one colour, indistinguishable
  // from a single connected group.
  const disjoint = [
    { a: 'stemi', b: 'htn' },
    { a: 'hydroxy', b: 'ra' },
  ];
  const disjointSets = groupLinkedPairsIntoSets(disjoint);
  check(disjointSets.length === 2, 'two unrelated pairs -> two separate sets, each gets its own lane/colour');

  // A chain (A–B, B–C) IS one genuinely connected set, even though A and C
  // never appear in the same pair together.
  const chain = [
    { a: 'a', b: 'b' },
    { a: 'b', b: 'c' },
  ];
  check(groupLinkedPairsIntoSets(chain).length === 1, 'a chain (A-B, B-C) is ONE connected set, not two');
  check(groupLinkedPairsIntoSets(chain)[0].length === 2, 'the one set contains both edges of the chain');

  // A hub (A linked to both B and C, unrelated to the disjoint pair) — still
  // one set, plus the disjoint pair stays its own separate set.
  const mixed = [
    { a: 'hub', b: 'x' },
    { a: 'hub', b: 'y' },
    { a: 'p', b: 'q' },
  ];
  const mixedSets = groupLinkedPairsIntoSets(mixed);
  check(mixedSets.length === 2, 'a 3-edge hub set plus one unrelated pair -> two sets total');
  check(
    mixedSets.some((s) => s.length === 2) && mixedSets.some((s) => s.length === 1),
    'set sizes match: the hub set has both its edges, the unrelated pair is its own lone-edge set'
  );

  check(groupLinkedPairsIntoSets(null).length === 0, 'null input -> empty, never throws');
  check(groupLinkedPairsIntoSets([]).length === 0, 'empty input -> empty, never throws');
}

console.log('--- linkSetLaneX / linkSetColor: distinct lane and colour per set ---');
{
  check(linkSetLaneX(400, 0, 14) === 400, 'set 0 sits at the base position, no offset');
  check(linkSetLaneX(400, 1, 14) === 414, 'set 1 steps right by one lane width');
  check(linkSetLaneX(400, 3, 14) === 442, 'set 3 steps right by three lane widths');
  check(linkSetLaneX(400, 1) === 414, 'lane width defaults to 14 when omitted');
  check(linkSetLaneX(null, 1, 14) === null, 'missing baseX -> null, never throws');

  const c0 = linkSetColor(0);
  const c1 = linkSetColor(1);
  check(typeof c0 === 'string' && c0 !== c1, 'different set indices produce different colours');
  check(linkSetColor(0) === linkSetColor(0), 'the same index always produces the same colour (deterministic)');
  check(
    linkSetColor(5) === linkSetColor(0),
    'colours cycle once the palette is exhausted, rather than throwing or returning undefined'
  );
  check(typeof linkSetColor(-1) === 'string', 'a negative/invalid index never throws — falls back to a real colour');
}

console.log('--- relativeRect: subtracts the container origin ---');
{
  const rect = { left: 150, right: 250, top: 60, bottom: 90, width: 100, height: 30 };
  const container = { left: 50, top: 20 };
  const rel = relativeRect(rect, container);
  check(rel.left === 100 && rel.right === 200 && rel.top === 40 && rel.bottom === 70, 'origin subtracted correctly');
  check(rel.width === 100 && rel.height === 30, 'width/height pass through unchanged');
}

console.log('--- readDropPayload: proves the drag actually originated on this canvas ---');
{
  function fakeEvent(raw) {
    return {
      dataTransfer: {
        getData: () => raw,
      },
    };
  }
  check(
    readDropPayload(fakeEvent(JSON.stringify({ problemId: 'p1' })))?.problemId === 'p1',
    'valid same-shape payload reads through'
  );
  check(readDropPayload(fakeEvent('')) === null, 'empty string -> null');
  check(
    readDropPayload(fakeEvent('not json')) === null,
    'malformed JSON (e.g. foreign dragged text) -> null, never throws'
  );
  check(readDropPayload(fakeEvent(JSON.stringify({ somethingElse: 1 }))) === null, 'JSON missing problemId -> null');
  check(readDropPayload({ dataTransfer: null }) === null, 'no dataTransfer -> null, never throws');
  check(
    readDropPayload({
      dataTransfer: {
        getData: () => {
          throw new Error('boom');
        },
      },
    }) === null,
    'a throwing getData (e.g. unavailable outside a real drop event) -> null, never throws'
  );
}

console.log('--- buildProblemTree: parent-map CYCLES render instead of silently vanishing ---');
{
  // Server data CAN contain a cycle (Medicus's own parent picker isn't
  // cycle-guarded — only this extension's writes are). Every cycle member
  // has a live parent, so the naive roots pass skips them all; without the
  // rescue pass they'd disappear from the rendered problem list entirely.
  const problems = [{ id: 'a' }, { id: 'b' }];
  const infoById = { a: { onsetDate: '20 Apr 2020' }, b: { onsetDate: '5 Jul 2009' } };
  const cycleTree = buildProblemTree(problems, infoById, { a: 'b', b: 'a' });
  const cycleIds = flattenTreeIds(cycleTree);
  check(cycleIds.has('a') && cycleIds.has('b'), 'both members of a 2-cycle still render');
  check(cycleTree.length === 1, 'one cycle member is promoted to a root, not both');
  check(cycleTree[0].children.length === 1, 'the other member renders beneath it as an ordinary child');
  check(cycleTree[0].parentId === null, 'the promoted member no longer claims a parent (its edge was cut)');
  check(cycleTree[0].children[0].parentId === cycleTree[0].id, 'the kept edge still records its real parent');

  // A 3-cycle with an innocent child hanging off it — the whole component
  // must survive, and the hanger-on keeps its real parent.
  const bigger = [{ id: 'p' }, { id: 'q' }, { id: 'r' }, { id: 'kid' }];
  const biggerTree = buildProblemTree(bigger, {}, { p: 'q', q: 'r', r: 'p', kid: 'p' });
  const biggerIds = flattenTreeIds(biggerTree);
  check(
    ['p', 'q', 'r', 'kid'].every((id) => biggerIds.has(id)),
    'a 3-cycle plus its hanger-on child all still render'
  );
  check(biggerTree.length === 1, 'the 3-cycle collapses to a single promoted root');

  // A cycle NEXT TO healthy data must not disturb the healthy part.
  const mixed = [{ id: 'root' }, { id: 'child' }, { id: 'c1' }, { id: 'c2' }];
  const mixedTree = buildProblemTree(mixed, {}, { child: 'root', c1: 'c2', c2: 'c1' });
  const mixedIds = flattenTreeIds(mixedTree);
  check(mixedIds.size === 4, 'healthy root+child AND both cycle members all render');
  const healthyRoot = mixedTree.find((n) => n.id === 'root');
  check(healthyRoot && healthyRoot.children.length === 1, 'the healthy branch is untouched by the cycle rescue');
}

console.log('--- significance lanes / classifyDrop / canProposeEnd ---');
{
  check(significanceLaneKey('Major') === 'major', 'Major → major');
  check(significanceLaneKey('Minor') === 'minor', 'Minor → minor');
  check(significanceLaneKey('Unknown significance') === 'unknown', 'Unknown significance → unknown');
  check(significanceLaneKey('Unknown') === 'unknown', 'Unknown → unknown');
  check(significanceLaneKey('') === 'unknown', 'empty label is unresolved');
  check(significanceLaneKey(null) === 'unknown', 'null label is unresolved');

  const problems = [
    { id: 'maj', description: 'IHD' },
    { id: 'min', description: 'Eczema' },
    { id: 'unk', description: 'H/O stroke' },
    { id: 'child', description: 'Stent' },
  ];
  const info = {
    maj: { significance: 'Major', onsetDate: '1 Jan 2020' },
    min: { significance: 'Minor', onsetDate: '1 Jan 2021' },
    unk: { significance: 'Unknown significance', onsetDate: '1 Jan 2019' },
    child: { significance: 'Minor', onsetDate: '1 Jan 2022' },
  };
  const parts = partitionProblemsBySignificance(problems, info);
  check(parts.major.map((p) => p.id).join() === 'maj', 'major lane has the Major problem');
  check(
    parts.minor
      .map((p) => p.id)
      .sort()
      .join() === 'child,min',
    'minor lane has Minor + child'
  );
  check(parts.unknown.map((p) => p.id).join() === 'unk', 'unknown lane has the unresolved problem');

  const trees = buildLaneTrees(problems, info, { child: 'maj' });
  check(trees.major.length === 1 && trees.major[0].id === 'maj', 'major lane tree is IHD');
  check(trees.major[0].children.length === 0, 'minor child is not pulled into the major lane');
  const childNode = (function find(nodes) {
    for (const n of nodes || []) {
      if (n.id === 'child') return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  })(trees.minor);
  check(
    childNode && childNode.crossLaneParentDescription === 'IHD',
    'cross-lane child is annotated with the other-lane parent'
  );
  const allLaneIds = new Set([
    ...flattenTreeIds(trees.major),
    ...flattenTreeIds(trees.minor),
    ...flattenTreeIds(trees.unknown),
  ]);
  check(allLaneIds.size === 4, 'all four problems still appear across lanes');
}

console.log(
  '--- annotateTreeSuggestions: suggestion data attaches onto the SAME tree node (2026-08-19 — no more separate tray) ---'
);
{
  const tree = buildProblemTree(
    [
      { id: 'stent', description: 'Stent' },
      { id: 'ihd', description: 'IHD' },
      { id: 'ecz', description: 'Eczema' },
    ],
    { stent: { onsetDate: '1 Jan 2020' }, ihd: { onsetDate: '1 Jan 2019' }, ecz: { onsetDate: '1 Jan 2021' } },
    {}
  );
  const suggestionsByChildId = {
    stent: { childId: 'stent', childDescription: 'Stent', parentOptions: [{ id: 'ihd', description: 'IHD' }] },
  };
  const textLinkByProblemId = {
    ecz: { problemId: 'ecz', matchedProblemId: 'ihd', matchedDescription: 'IHD', confidence: 'exact' },
  };
  const annotated = annotateTreeSuggestions(tree, suggestionsByChildId, textLinkByProblemId);
  const stentNode = annotated.find((n) => n.id === 'stent');
  const eczNode = annotated.find((n) => n.id === 'ecz');
  const ihdNode = annotated.find((n) => n.id === 'ihd');
  check(
    stentNode.suggestedParentOptions && stentNode.suggestedParentOptions[0].id === 'ihd',
    'a SNOMED-ancestry suggestion attaches its candidate parent options onto the child node directly'
  );
  check(!stentNode.textLinkSuggestion, 'stent has no text-link suggestion of its own');
  check(
    eczNode.textLinkSuggestion && eczNode.textLinkSuggestion.matchedProblemId === 'ihd',
    'a "(Grouped with X)" suggestion attaches onto the subject node directly'
  );
  check(!eczNode.suggestedParentOptions, 'eczema has no SNOMED suggestion of its own');
  check(
    !ihdNode.suggestedParentOptions && !ihdNode.textLinkSuggestion,
    'a node with no suggestion of its own gets neither field'
  );
  check(
    annotateTreeSuggestions([], {}, {}).length === 0,
    'empty tree -> empty tree, never throws on empty lookup maps'
  );
}

{
  check(
    classifyDrop({ problemId: 'min' }, { type: 'lane', key: 'major' }, 'minor').kind === 'sig-major',
    'drop onto Major chrome proposes a significance change'
  );
  check(
    classifyDrop({ problemId: 'min' }, { type: 'lane', key: 'minor' }, 'minor') === null,
    'drop onto the problem’s own lane is a no-op'
  );
  check(
    classifyDrop({ problemId: 'min' }, { type: 'bin' }, 'minor').kind === 'end',
    'drop onto the End bin proposes an end'
  );
  check(
    classifyDrop({ problemId: 'min' }, { type: 'tile', id: 'maj' }, 'minor').kind === 'link',
    'drop onto another tile is still a nest/link'
  );
  check(
    classifyDrop({ problemId: 'min' }, { type: 'tile', id: 'min' }, 'minor') === null,
    'drop onto self is rejected'
  );
  check(canProposeEnd('min', { child: 'maj' }) === true, 'a leaf can be ended');
  check(canProposeEnd('maj', { child: 'maj' }) === false, 'a parent with a live child cannot be ended');
}

console.log('--- draft workspace: stage End + significance, then summarise ---');
{
  const parentMap = { child: 'parent' };
  const empty = emptyDraft();
  check(hasDraftChanges(empty) === false, 'empty draft has no changes');

  const leaf = stageEnd(empty, 'child', parentMap);
  check(leaf.error === null && leaf.draft.endIds.join() === 'child', 'a leaf stages into End');
  check(hasDraftChanges(leaf.draft) === true, 'a staged end is a draft change');

  const parentTooSoon = stageEnd(empty, 'parent', parentMap);
  check(parentTooSoon.error === 'has-children', 'a parent cannot stage until its children are also in End');

  const parentAfter = stageEnd(leaf.draft, 'parent', parentMap);
  check(
    parentAfter.error === null && parentAfter.draft.endIds.join() === 'child,parent',
    'parent stages once its child is already in End'
  );

  const unstageChild = unstageEnd(parentAfter.draft, 'child', parentMap);
  check(
    unstageChild.endIds.indexOf('child') === -1 && unstageChild.endIds.indexOf('parent') === -1,
    'unstaging a child also unstages the parent that depended on it'
  );

  const two = stageEnd(stageEnd(empty, 'a', {}).draft, 'b', {});
  check(two.draft.endIds.join() === 'a,b', 'several problems can sit in End at once');

  const info = { a: { significance: 'Minor' }, b: { significance: 'Major' } };
  const moved = stageSignificance(empty, 'a', 'major', 'minor', {});
  check(moved.sigById.a === 'major', 'significance stages without writing');
  check(effectiveLaneKey(info, moved, 'a') === 'major', 'effective lane follows the draft');
  check(effectiveLaneKey(info, empty, 'a') === 'minor', 'live lane is unchanged when nothing is staged');

  const back = stageSignificance(moved, 'a', 'minor', 'minor', {});
  check(!back.sigById.a, 'dropping back on the live lane clears the staged significance');

  const endThenSig = stageSignificance(two.draft, 'a', 'unknown', 'minor', {});
  check(endThenSig.endIds.indexOf('a') === -1, 'dragging an End tile onto a lane unstages the end');
  check(endThenSig.sigById.a === 'unknown', '…and stages the new significance');

  const overlay = overlayInfoById(info, moved);
  check(overlay.a.significance === 'Major', 'overlay info reports the staged grade');
  check(info.a.significance === 'Minor', 'the live snapshot is not mutated');

  const visible = problemsNotEnded([{ id: 'a' }, { id: 'b' }], two.draft);
  check(visible.length === 0, 'staged-end problems leave the lanes');
  const inBin = endedProblemList(
    [
      { id: 'a', description: 'A' },
      { id: 'b', description: 'B' },
    ],
    two.draft
  );
  check(inBin.map((p) => p.id).join() === 'a,b', 'End bin lists staged problems in drop order');

  const ordered = orderEndsForCommit(['parent', 'child'], { child: 'parent' });
  check(ordered.join() === 'child,parent', 'commit order is children before parents');

  const summary = summariseDraft(parentAfter.draft, { child: 'Stent', parent: 'IHD' });
  check(summary.count === 2 && summary.ends.length === 2, 'summary counts staged ends');
  check(summary.ends[0].description === 'Stent', 'summary carries descriptions');
}

console.log('--- flattenTreeIds: never recurses forever on a cyclic structure ---');
{
  // Belt-and-braces: buildProblemTree now guarantees an acyclic result, but
  // the walker must survive a cyclic input anyway rather than blowing the
  // stack.
  const a = { id: 'a', children: [] };
  const b = { id: 'b', children: [a] };
  a.children.push(b);
  const ids = flattenTreeIds([a]);
  check(ids.has('a') && ids.has('b') && ids.size === 2, 'cyclic node structure walked once, no infinite recursion');
}

console.log('--- buildPendingLink: re-parent disclosure (silent moves were the review finding) ---');
{
  const descById = { child: 'Angina', newParent: 'Diabetes', oldParent: 'Ischaemic heart disease' };
  const fresh = buildPendingLink('child', 'newParent', descById, {});
  check(fresh.kind === 'link' && fresh.childId === 'child' && fresh.parentId === 'newParent', 'plain link shape');
  check(fresh.previousParentId === null, 'no existing parent -> no move disclosure');
  check(fresh.childDescription === 'Angina' && fresh.parentDescription === 'Diabetes', 'descriptions resolved');

  const move = buildPendingLink('child', 'newParent', descById, { child: 'oldParent' });
  check(move.previousParentId === 'oldParent', 'existing parent is carried on the action');
  check(
    move.previousParentDescription === 'Ischaemic heart disease',
    'existing parent NAMED so the confirm bar can disclose the move'
  );

  // A dangling parent-map entry (parent merged away this session — not in
  // descById any more) is not a real move to warn about.
  const dangling = buildPendingLink('child', 'newParent', descById, { child: 'goneParent' });
  check(dangling.previousParentId === null, 'dangling previous parent (no longer a live problem) -> no disclosure');

  const unknownIds = buildPendingLink('x1', 'x2', {}, {});
  check(
    unknownIds.childDescription === 'x1' && unknownIds.parentDescription === 'x2',
    'unknown ids fall back to the raw id, never undefined'
  );
  check(fresh.linking === false && fresh.error === null, 'starts unconfirmed with no error');
}

console.log('--- buildPendingLink: nestAllowed (loop-blocked pairs still get the flat-link offer) ---');
{
  const pending = buildPendingLink('child', 'parent', { child: 'A', parent: 'B' }, {});
  check(pending.nestAllowed === true, 'nesting is allowed by default');
}

console.log(
  '\n--- v3.227.1 review-fix source locks (feedback truthfulness / per-choice consequences / card lifecycle) ---'
);
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'problem-nesting-canvas.js'), 'utf8');
  // Finding 6: the strip wrapper reports four distinct outcomes, and the
  // text-only confirm branch handles each — no more success announcements
  // over a no-op, no silent dead click when the bridge is missing.
  ['stripped', 'nothing-to-strip', 'unavailable', 'failed'].forEach(function (status) {
    check(src.includes("'" + status + "'"), 'stripTextLinkBoilerplate outcome "' + status + '" is distinguished');
  });
  check(
    src.includes('The import text was already removed'),
    'a no-op strip is announced as what it is, never as a fresh removal'
  );
  check(
    src.includes('The text-editing tool isn’t available on this page'),
    'a missing bridge is a visible error on the card, not a silent dead click'
  );
  // Finding 8: each confirm choice states its own consequence, and a
  // loop-blocked pair still gets the flat link (nest choice withheld).
  check(
    src.includes('would create a loop in the hierarchy, so only a flat link is offered'),
    'the loop-blocked drop offers the flat link with its own explanation instead of blocking the gesture'
  );
  check(
    /commitAs === 'flatlink' \|\| d\.nestAllowed === false/.test(src),
    'the commit path can never nest a pair whose confirm bar only offered the flat link'
  );
  check(
    src.includes('nesting will move it out of there'),
    'the re-parent disclosure is attached to the NEST choice, not to both buttons'
  );
  // Finding 10: an actioned card settles the SOURCE suggestion list via the
  // bridge — reopening the canvas must not resurrect it.
  check(
    src.includes('consumeTextLinkSuggestion') && src.includes('markTextLinkAlreadyRelated'),
    'actioned cards consume/convert the shared suggestion, surviving the per-open dismissed-set reset'
  );
  const nestingSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'problem-nesting.js'), 'utf8');
  check(
    nestingSrc.includes('consumeTextLinkSuggestion:') && nestingSrc.includes('markTextLinkAlreadyRelated:'),
    'the bridge actually exposes both lifecycle functions the canvas calls'
  );
  check(
    nestingSrc.includes('commitEndProblem: commitEndProblem'),
    'the bridge exposes commitEndProblem for the End bin'
  );
  check(src.includes('data-sig-lane') && src.includes('data-end-bin'), 'lanes and the End bin are drop targets');
  check(src.includes("kind === 'finalise'"), 'the confirm path finalises the staged canvas draft');
  check(src.includes('orderEndsForCommit'), 'finalise commits ends children-first');
  check(src.includes('ms-pnc-tile-checkbox') && src.includes('proposeLinkMany'), 'multi-select checkboxes and multi-nest confirm exist');
  check(
    (src.match(/readDropPayload\(e\) \|\| _dragPayload/g) || []).length >= 3,
    'drop handlers fall back to the in-memory payload when dataTransfer is empty'
  );
}

console.log('--- multi-select helpers ---');
{
  check(uniqueIds(['a', 'a', '', 'b']).join(',') === 'a,b', 'uniqueIds drops blanks and dupes');
  check(payloadIds({ problemId: 'a', ids: ['b', 'a'] }, 'problemId').join(',') === 'a,b', 'payloadIds keeps the dragged id first');
  check(payloadIds({ problemId: 'a' }, 'problemId').join(',') === 'a', 'payloadIds works without ids[]');
  check(toggleSelectedIds(['a'], 'b', true).join(',') === 'a,b', 'additive click adds');
  check(toggleSelectedIds(['a', 'b'], 'a', true).join(',') === 'b', 'additive click removes');
  check(toggleSelectedIds(['a', 'b'], 'c', false).join(',') === 'c', 'plain click replaces');
  check(dragIdsFor(['a', 'b'], 'a').join(',') === 'a,b', 'drag of a selected tile carries the set');
  check(dragIdsFor(['a', 'b'], 'c').join(',') === 'c', 'drag of an unselected tile is only itself');
  check(isAdditiveClick({ ctrlKey: true }) === true, 'Ctrl-click is additive');
  check(isAdditiveClick({ metaKey: true }) === true, '⌘-click is additive');
  check(isAdditiveClick({}) === false, 'plain click is not additive');
  const multi = readDropPayload({
    dataTransfer: { getData: () => JSON.stringify({ problemId: 'a', ids: ['a', 'b'] }) },
  });
  check(multi && multi.ids.join(',') === 'a,b', 'readDropPayload keeps the multi-select id list');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
