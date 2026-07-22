// Medicus Suite — problem-description-cleanup ("Fix description" for outdated
// SNOMED problem codes) tests
// Run with: node test-problem-description-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: detecting a legacy bracket/NOS-style description, stripping the
// legacy markers for a search query, filtering search results down to
// same-concept alternatives (the safety rule — never re-code to a different
// concept), and building the full edit-problem POST payload (a full replace,
// not a partial patch — see docs/learnings-problem-description-cleanup.md).

'use strict';

const {
  looksOutdated,
  stripLegacyMarkers,
  sameConceptAlternatives,
  buildEditProblemPayload,
  findOutdatedProblems,
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
check(looksOutdated('Attention deficit disorder') === false, 'plain modern description -> not outdated');
check(looksOutdated('Nostalgia for the 90s') === false, '"Nos" mid-word never false-positives (word boundary)');
check(looksOutdated('') === false, 'empty string -> not outdated');
check(looksOutdated(null) === false, 'null -> not outdated, never throws');
check(looksOutdated(undefined) === false, 'undefined -> not outdated, never throws');

console.log('--- stripLegacyMarkers ---');
check(stripLegacyMarkers('[X]Attention deficit disorder') === 'Attention deficit disorder', 'strips "[X]" prefix');
check(stripLegacyMarkers('Fracture of radius NOS') === 'Fracture of radius', 'strips trailing "NOS"');
check(stripLegacyMarkers('[X]Depression NOS') === 'Depression', 'strips BOTH prefix and suffix');
check(stripLegacyMarkers('Attention deficit disorder') === 'Attention deficit disorder', 'no markers -> unchanged');
check(stripLegacyMarkers(null) === '', 'null -> empty string, never throws');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
