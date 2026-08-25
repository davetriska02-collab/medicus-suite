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
  isConvertEligible,
  isEndableClassification,
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
  uniqueIds,
  payloadIds,
  toggleSelectedIds,
  dragIdsFor,
  isAdditiveClick,
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
  // findOrRegisterConversionEntry (allergy-cleanup.js) registers an ad-hoc
  // convertById entry when the tile's generalised "Convert…" action is used
  // on a row the scan never flagged — it must stay in its real lane, not
  // jump to Convert (see liveLaneKey's own comment).
  const adHocFlags = {
    junkById: {},
    convertById: { a1: { id: 'a1', description: 'Allergy to peanut', rule: null, adHoc: true } },
    dualById: {},
  };
  check(liveLaneKey('a1', adHocFlags) === 'active', 'ad-hoc-registered convert entry stays in its real lane');
}

console.log('--- isConvertEligible: which tiles open the review card on a single click ---');
check(isConvertEligible('a1', flags) === true, 'clean Active row is eligible');
check(isConvertEligible('c1', flags) === true, 'scan-flagged convert row is eligible');
check(isConvertEligible('d1', flags) === true, 'dual-coded row is eligible');
check(isConvertEligible('j1', flags) === true, 'non-NKA junk row IS eligible — may be a real allergy, badly coded');
check(isConvertEligible('c2', flags) === false, 'confirmed not-an-allergy row is NOT eligible — heads for End');
check(isConvertEligible('nka1', flags) === false, 'NKA sentinel row is NOT eligible — nothing to convert it to');
check(isConvertEligible('nka2', flags) === false, 'second NKA copy is also NOT eligible');
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

console.log('--- NKA concept helper / end staging (RELAXED 2026-08-23 — every allergy is endable) ---');
check(isNkaConcept(NKA_CONCEPT_ID, 'anything') === true, 'NKA by conceptId');
check(isNkaConcept(null, 'No known allergies') === true, 'NKA by description');
check(isNkaConcept('419076005', 'Allergic reaction') === false, 'generic junk is not NKA');
check(isEndableClassification('j1', flags) === true, 'junk is endable');
check(isEndableClassification('c2', flags) === true, 'not-an-allergy is endable');
check(isEndableClassification('a1', flags) === true, 'a clean, genuine allergy is endable too — no more hard block');
check(isEndableClassification('c1', flags) === true, 'a convertible substance is endable too');
check(isEndableClassification('d1', flags) === true, 'a dual-coded row is endable too');
check(isEndableClassification('nka1', flags) === true, 'an NKA row is endable — including as the LAST copy');
{
  // The only remaining guard: a row THIS session already confirmed ended
  // (junk/convert entries track `.ended` once a write succeeds) cannot be
  // re-staged.
  const alreadyEndedFlags = {
    junkById: { j1: Object.assign({}, junkPenicillin, { ended: true }) },
    convertById: {},
    dualById: {},
  };
  check(isEndableClassification('j1', alreadyEndedFlags) === false, 'a row already ended this session is not re-endable');
}
check(canStageEnd('a1', flags).ok === true, 'can stage a genuine allergy');
check(canStageEnd('j1', flags).ok === true, 'can stage a junk row');
check(canStageEnd('c2', flags).ok === true, 'can stage not-an-allergy');
check(canStageEnd('c1', flags).ok === true, 'can stage a convertible substance');
check(canStageEnd('d1', flags).ok === true, 'can stage a dual-coded row');
check(canStageEnd('nka1', flags).ok === true, 'can stage one NKA copy');
check(canStageEnd('nka2', flags).ok === true, 'can stage the OTHER NKA copy too — both at once, no last-copy block');
{
  const onlyFlags = { junkById: { nka1: junkNka }, convertById: {}, dualById: {} };
  check(canStageEnd('nka1', onlyFlags).ok === true, 'the SOLE NKA copy can now be staged too');
}
{
  const first = stageEnd(emptyDraft(), 'j1', flags);
  check(first.error === null && first.draft.endIds.join() === 'j1', 'stage junk end');
  const again = stageEnd(first.draft, 'j1', flags);
  check(again.draft.endIds.join() === 'j1', 'staging twice is a no-op');
  const nka = stageEnd(emptyDraft(), 'nka1', flags);
  const both = stageEnd(nka.draft, 'nka2', flags);
  check(
    both.error === null && both.draft.endIds.sort().join() === 'nka1,nka2',
    'BOTH NKA copies can be staged together — ending the last one is no longer blocked'
  );
  const genuine = stageEnd(emptyDraft(), 'a1', flags);
  check(genuine.error === null && genuine.draft.endIds.join() === 'a1', 'a genuine allergy IS staged now');
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
  const endThenTidy = stageTidy(stageEnd(emptyDraft(), 'j1', flags).draft, 'd1', flags);
  check(endThenTidy.draft.endIds.join() === 'j1' && endThenTidy.draft.tidyIds.join() === 'd1', 'end + tidy coexist');
  // A dual-coded row can now be ENDED too (relaxed 2026-08-23) — doing so
  // swaps it out of the tidy stage, since stageEnd clears any pending tidy
  // for the same id (a row can only be staged for one outcome at a time).
  const swap = stageEnd(s.draft, 'd1', flags);
  check(
    swap.error === null && swap.draft.endIds.join() === 'd1' && swap.draft.tidyIds.length === 0,
    'dual-coded CAN be ended now, and doing so clears its pending tidy stage'
  );
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

console.log('--- multi-select helpers ---');
{
  check(uniqueIds(['a', 'a', 'b']).join(',') === 'a,b', 'uniqueIds drops dupes');
  check(payloadIds({ allergyId: 'j1', ids: ['j2', 'j1'] }, 'allergyId').join(',') === 'j1,j2', 'payloadIds keeps the dragged id first');
  check(toggleSelectedIds([], 'j1', true).join(',') === 'j1', 'additive click on empty starts a set');
  check(dragIdsFor(['j1', 'j2'], 'j2').join(',') === 'j1,j2', 'drag of a selected tile carries the set');
  check(dragIdsFor(['j1'], 'x').join(',') === 'x', 'drag of an unselected tile is only itself');
  check(isAdditiveClick({ ctrlKey: true }) && !isAdditiveClick({}), 'Ctrl-click is additive, plain click is not');
  const multi = readDropPayload({
    dataTransfer: { getData: () => JSON.stringify({ allergyId: 'j1', ids: ['j1', 'j2'] }) },
  });
  check(multi && multi.ids.join(',') === 'j1,j2', 'readDropPayload keeps the multi-select id list');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
