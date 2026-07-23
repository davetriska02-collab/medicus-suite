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
  findOutdatedProblems,
  detectLateralityHint,
  descriptionAlreadySpecifiesLaterality,
  descendantAlternatives,
  crossConceptAlternatives,
  detectPathologyHint,
  descriptionAlreadyMentionsHint,
  hintExpandedAlternatives,
  significantWords,
} = require('./content-scripts/problem-description-cleanup.js');

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

console.log('--- findOutdatedProblems ---');
const summaryProblems = [
  { id: 'p1', problemCodeDescription: 'Attention deficit disorder' },
  { id: 'p2', problemCodeDescription: '[X]Depression NOS' },
  { id: 'p3', problemCodeDescription: 'Torticollis - symptom' },
  { id: 'p4', problemCodeDescription: 'Fracture of radius NOS' },
  { id: 'p5', problemCodeDescription: 'Glandular fever' },
];
const outdated = findOutdatedProblems(summaryProblems);
check(outdated.length === 2, 'flags exactly the 2 legacy-style entries (got ' + outdated.length + ')');
check(
  outdated.map((p) => p.id).join(',') === 'p2,p4',
  'flags the right ones (p2 "[X]Depression NOS", p4 "Fracture of radius NOS")'
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
