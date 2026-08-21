// Medicus Suite — allergy-cleanup-canvas pure-helper tests
// Run with: node test-allergy-cleanup-canvas.js
'use strict';

const {
  NKA_CONCEPT_ID,
  CLASSIFICATION_LANES,
  isNkaConcept,
  truncateText,
  liveLaneKey,
  partitionAllergiesByLane,
  findDuplicateGroupIndex,
  sameDuplicateGroup,
  buildDuplicatePairs,
  isNotAnAllergy,
  isEndableClassification,
  countLiveNka,
  canStageEnd,
  canStageTidy,
  emptyDraft,
  hasDraftChanges,
  stageEnd,
  unstageEnd,
  stageTidy,
  unstageTidy,
  allergiesNotEnded,
  endedAllergyList,
  summariseDraft,
  diffFinaliseOutcome,
  classifyDrop,
  readDropPayload,
  relativeRect,
  buildElbowConnectorPath,
  computeLinkBusX,
  groupLinkedPairsIntoSets,
  linkSetLaneX,
  elbowFlagPoint,
} = require('./content-scripts/allergy-cleanup-canvas.js');

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

const junkPenicillin = {
  id: 'j1',
  description: 'Allergic reaction',
  conceptId: '419076005',
  caution: null,
};
const junkNka = {
  id: 'nka1',
  description: 'No known allergies',
  conceptId: NKA_CONCEPT_ID,
  caution: 'keep one',
};
const junkNka2 = {
  id: 'nka2',
  description: 'No known allergies',
  conceptId: NKA_CONCEPT_ID,
  caution: 'keep one',
};
const convertAmox = {
  id: 'c1',
  description: 'Amoxicillin allergy',
  conceptId: '294505008',
  rule: { kind: 'substance' },
};
const convertNotAllergy = {
  id: 'c2',
  description: 'History of atopy',
  conceptId: '1',
  rule: { kind: 'not-an-allergy', notes: 'consider removal' },
};
const dualPen = {
  id: 'd1',
  description: 'Penicillin',
  legacyCode: { description: 'ALLERGY PENICILLIN' },
  substance: { description: 'Phenoxymethylpenicillin' },
  tidied: false,
};
const cleanPeanut = { id: 'a1', description: 'Allergy to peanut' };

const flags = {
  junkById: { j1: junkPenicillin, nka1: junkNka, nka2: junkNka2 },
  convertById: { c1: convertAmox, c2: convertNotAllergy },
  dualById: { d1: dualPen },
};

const allergies = [
  cleanPeanut,
  { id: 'j1', description: 'Allergic reaction' },
  { id: 'nka1', description: 'No known allergies' },
  { id: 'nka2', description: 'No known allergies' },
  { id: 'c1', description: 'Amoxicillin allergy' },
  { id: 'c2', description: 'History of atopy' },
  { id: 'd1', description: 'Penicillin' },
];

const groups = [
  {
    key: 'g0',
    description: 'No known allergies',
    entries: [
      { id: 'nka1', description: 'No known allergies' },
      { id: 'nka2', description: 'No known allergies' },
    ],
  },
];

console.log('--- classification lanes ---');
check(CLASSIFICATION_LANES.join(',') === 'active,junk,convert,dual', 'lane keys');
check(liveLaneKey('a1', flags) === 'active', 'clean row is Active');
check(liveLaneKey('j1', flags) === 'junk', 'junk row is Junk');
check(liveLaneKey('c1', flags) === 'convert', 'pre-defined is Convert');
check(liveLaneKey('d1', flags) === 'dual', 'dual-coded is Dual');
{
  const parts = partitionAllergiesByLane(allergies, flags);
  check(parts.active.map((a) => a.id).join() === 'a1', 'Active holds only the clean row');
  check(
    parts.junk
      .map((a) => a.id)
      .sort()
      .join() === 'j1,nka1,nka2',
    'Junk holds junk + NKA'
  );
  check(
    parts.convert
      .map((a) => a.id)
      .sort()
      .join() === 'c1,c2',
    'Convert holds both convert rows'
  );
  check(parts.dual.map((a) => a.id).join() === 'd1', 'Dual holds the dual-coded row');
}

console.log('--- NKA / end staging ---');
check(isNkaConcept(NKA_CONCEPT_ID, 'anything') === true, 'NKA by conceptId');
check(isNkaConcept(null, 'No known allergies') === true, 'NKA by description');
check(isNkaConcept('419076005', 'Allergic reaction') === false, 'generic junk is not NKA');
check(isEndableClassification('j1', flags) === true, 'junk is endable');
check(isEndableClassification('c2', flags) === true, 'not-an-allergy is endable');
check(isEndableClassification('a1', flags) === false, 'clean allergy is not endable');
check(isEndableClassification('c1', flags) === false, 'convertible substance is not endable');
check(canStageEnd('a1', flags, allergies, []).error === 'not-endable', 'cannot stage a genuine allergy');
check(canStageEnd('j1', flags, allergies, []).ok === true, 'can stage a junk row');
check(canStageEnd('c2', flags, allergies, []).ok === true, 'can stage not-an-allergy');
check(canStageEnd('nka1', flags, allergies, []).ok === true, 'can stage one of two NKA copies');
check(canStageEnd('nka2', flags, allergies, ['nka1']).error === 'last-nka', 'cannot stage the last remaining NKA');
{
  const onlyNka = [{ id: 'nka1', description: 'No known allergies' }];
  const onlyFlags = { junkById: { nka1: junkNka }, convertById: {}, dualById: {} };
  check(canStageEnd('nka1', onlyFlags, onlyNka, []).error === 'last-nka', 'the sole NKA copy cannot be staged');
}
check(countLiveNka(allergies, flags, []) === 2, 'two live NKA');
check(countLiveNka(allergies, flags, ['nka1']) === 1, 'one live NKA after staging one');
{
  const first = stageEnd(emptyDraft(), 'j1', flags, allergies);
  check(first.error === null && first.draft.endIds.join() === 'j1', 'stage junk end');
  const again = stageEnd(first.draft, 'j1', flags, allergies);
  check(again.draft.endIds.join() === 'j1', 'staging twice is a no-op');
  const nka = stageEnd(emptyDraft(), 'nka1', flags, allergies);
  const last = stageEnd(nka.draft, 'nka2', flags, allergies);
  check(last.error === 'last-nka' && last.draft.endIds.join() === 'nka1', 'last NKA leaves the draft unchanged');
  const genuine = stageEnd(emptyDraft(), 'a1', flags, allergies);
  check(genuine.error === 'not-endable' && genuine.draft.endIds.length === 0, 'genuine allergy is not staged');
  const unstaged = unstageEnd(first.draft, 'j1');
  check(unstaged.endIds.length === 0, 'unstage end');
}

console.log('--- tidy staging ---');
check(canStageTidy('d1', flags) === true, 'dual-coded is tidyable');
check(canStageTidy('a1', flags) === false, 'clean row is not tidyable');
{
  const tidiedFlags = {
    junkById: {},
    convertById: {},
    dualById: { d1: Object.assign({}, dualPen, { tidied: true }) },
  };
  check(canStageTidy('d1', tidiedFlags) === false, 'already-tidied is not tidyable');
  const s = stageTidy(emptyDraft(), 'd1', flags);
  check(s.error === null && s.draft.tidyIds.join() === 'd1', 'stage tidy');
  const bad = stageTidy(emptyDraft(), 'a1', flags);
  check(bad.error === 'not-tidyable', 'cannot tidy a clean row');
  check(unstageTidy(s.draft, 'd1').tidyIds.length === 0, 'unstage tidy');
  const endThenTidy = stageTidy(stageEnd(emptyDraft(), 'j1', flags, allergies).draft, 'd1', flags);
  check(endThenTidy.draft.endIds.join() === 'j1' && endThenTidy.draft.tidyIds.join() === 'd1', 'end + tidy coexist');
  const swap = stageEnd(s.draft, 'd1', flags, allergies);
  check(swap.error === 'not-endable', 'dual-coded cannot be ended');
}

console.log('--- draft helpers ---');
check(hasDraftChanges(emptyDraft()) === false, 'empty draft has no changes');
{
  const d = { endIds: ['j1'], tidyIds: ['d1'] };
  check(hasDraftChanges(d) === true, 'draft with ends/tidies has changes');
  const visible = allergiesNotEnded(allergies, d);
  check(visible.every((a) => a.id !== 'j1') && visible.some((a) => a.id === 'a1'), 'ended rows leave the lanes');
  check(
    endedAllergyList(allergies, d)
      .map((a) => a.id)
      .join() === 'j1',
    'ended list follows draft order'
  );
  const sum = summariseDraft(d, { j1: 'Allergic reaction', d1: 'Penicillin' });
  check(sum.count === 2 && sum.ends[0].description === 'Allergic reaction', 'summarise names rows');
}

console.log('--- duplicate grouping / drop classification ---');
check(findDuplicateGroupIndex('nka1', groups) === 0, 'finds NKA group');
check(findDuplicateGroupIndex('a1', groups) === -1, 'clean row is not in a group');
check(sameDuplicateGroup('nka1', 'nka2', groups) === true, 'NKA copies are the same group');
check(sameDuplicateGroup('nka1', 'a1', groups) === false, 'unrelated tiles are not a group');
check(sameDuplicateGroup('nka1', 'nka1', groups) === false, 'self is never a group');
{
  const pairs = buildDuplicatePairs(groups);
  check(pairs.length === 1 && pairs[0].a === 'nka1' && pairs[0].b === 'nka2', 'one pair for a two-copy group');
}
check(
  classifyDrop({ allergyId: 'nka1' }, { type: 'tile', id: 'nka2' }, flags, groups).kind === 'merge',
  'tile-on-duplicate-tile is merge'
);
check(
  classifyDrop({ allergyId: 'nka1' }, { type: 'tile', id: 'a1' }, flags, groups) === null,
  'tile-on-unrelated-tile is a no-op (never guess a merge)'
);
check(
  classifyDrop({ allergyId: 'nka1' }, { type: 'tile', id: 'nka1' }, flags, groups) === null,
  'self-drop is a no-op'
);
check(classifyDrop({ allergyId: 'j1' }, { type: 'bin' }, flags, groups).kind === 'end', 'bin drop proposes end');
check(
  classifyDrop({ allergyId: 'd1' }, { type: 'lane', key: 'dual' }, flags, groups).kind === 'tidy',
  'drop on Dual-coded stages tidy'
);
check(
  classifyDrop({ allergyId: 'a1' }, { type: 'lane', key: 'dual' }, flags, groups) === null,
  'clean row dropped on Dual-coded is a no-op'
);
check(
  classifyDrop({ allergyId: 'd1' }, { type: 'lane', key: 'active' }, flags, groups).kind === 'unstage-tidy',
  'drop on Active unstages tidy'
);
check(
  classifyDrop({ allergyId: 'j1' }, { type: 'lane', key: 'junk' }, flags, groups) === null,
  'cannot reclassify by dropping onto Junk'
);
check(
  classifyDrop({ allergyId: 'j1' }, { type: 'lane', key: 'convert' }, flags, groups) === null,
  'cannot fake a convert'
);
check(isNotAnAllergy(convertNotAllergy) === true, 'not-an-allergy kind');
check(isNotAnAllergy(convertAmox) === false, 'substance kind is convertible');

console.log('--- drop payload / connectors ---');
check(readDropPayload({ dataTransfer: { getData: () => '' } }) === null, 'empty payload');
check(readDropPayload({ dataTransfer: { getData: () => 'not-json' } }) === null, 'plain text is not a payload');
check(
  readDropPayload({ dataTransfer: { getData: () => JSON.stringify({ problemId: 'x' }) } }) === null,
  'problem payload rejected'
);
check(
  readDropPayload({ dataTransfer: { getData: () => JSON.stringify({ allergyId: 'j1' }) } }).allergyId === 'j1',
  'allergy payload accepted'
);
{
  const a = { top: 10, left: 10, width: 40, height: 20, right: 50, bottom: 30 };
  const c = { top: 0, left: 0, width: 200, height: 100, right: 200, bottom: 100 };
  const rel = relativeRect(a, c);
  check(rel.top === 10 && rel.right === 50, 'relativeRect');
  const path = buildElbowConnectorPath(rel, { top: 50, left: 10, width: 40, height: 20, right: 50 }, 80);
  check(path.indexOf('L 80') !== -1, 'elbow path uses the bus x');
  check(computeLinkBusX([rel], 16, 200) === 66, 'bus sits 16px past the widest tile');
  const sets = groupLinkedPairsIntoSets([
    { a: 'nka1', b: 'nka2' },
    { a: 'x', b: 'y' },
  ]);
  check(sets.length === 2, 'unrelated pairs are two sets');
  check(linkSetLaneX(80, 1, 14) === 94, 'set lanes step right');
  const pt = elbowFlagPoint(rel, { top: 50, left: 10, width: 40, height: 20, right: 50 }, 80);
  check(pt.x === 80 && pt.y === 40, 'flag sits on the bus midpoint');
}
check(truncateText('abcdefghijklmnopqrstuvwxyz', 10) === 'abcdefghi…', 'truncate');
check(truncateText('  short  ', 70) === 'short', 'truncate keeps short text');

console.log('--- diffFinaliseOutcome: success is only what the bridge confirms ---');
{
  const all = diffFinaliseOutcome(['j1', 'c2'], ['d1'], [{ id: 'j1' }, { id: 'c2' }], [{ id: 'd1' }]);
  check(all.allWritten === true && all.written === 3 && all.failed === 0, 'everything confirmed -> allWritten');
  const partial = diffFinaliseOutcome(['j1', 'c2'], ['d1'], [{ id: 'j1' }], []);
  check(partial.allWritten === false, 'a missing confirmation is a failure');
  check(partial.written === 1 && partial.failed === 2, 'partial counts written vs failed');
  check(partial.failedEnds.length === 1 && partial.failedEnds[0] === 'c2', 'failed end ids are the unconfirmed ones');
  check(partial.failedTidies.length === 1 && partial.failedTidies[0] === 'd1', 'failed tidy ids kept');
  const skipped = diffFinaliseOutcome(['j1'], [], [], []);
  check(
    skipped.allWritten === false && skipped.failed === 1,
    'a skipped commit (empty ended list) is never reported as success'
  );
  const none = diffFinaliseOutcome([], [], [], []);
  check(none.allWritten === true && none.wanted === 0, 'nothing wanted -> vacuously all written');
  const nullSafe = diffFinaliseOutcome(['j1'], null, null, null);
  check(nullSafe.failed === 1 && nullSafe.failedEnds[0] === 'j1', 'null lists never throw');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
