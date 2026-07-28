// Medicus Suite — allergy-cleanup widget ("Find evidence?" on the Allergies
// card) tests
// Run with: node test-allergy-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure wording
// seam is exercised — the citation/provenance text builders. These lines are
// a safety contract, not cosmetics (see docs/plans/ALLERGY-CLEANUP-2026-07-28.md,
// safety rule 3): a bare substance mention must never be phrased as a
// documented reaction, a missing author must never be invented, the GP2GP
// import caveat must travel inside the pasteable text, and the quoted
// snippet must stay verbatim apart from whitespace collapsing.

'use strict';

const {
  buildCitationText,
  provenanceText,
  formatEvidenceDate,
  sourceTypeWord,
  attributionText,
} = require('./content-scripts/allergy-cleanup.js');

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

console.log('--- buildCitationText: over-claiming guard ---');
const withReaction = {
  date: '2019-03-12',
  sourceType: 'note',
  recordedBy: 'Dr Smith',
  recordedByOrganisation: null,
  snippet: 'widespread urticarial rash after amoxicillin',
  matchedReactionTerms: ['rash', 'urticaria'],
  isGp2gpImport: false,
};
const c1 = buildCitationText(withReaction);
check(
  c1.startsWith('Reaction documented in note of 12 Mar 2019 (Dr Smith): '),
  'reaction terms -> "Reaction documented" lead'
);
check(c1.includes('"widespread urticarial rash after amoxicillin"'), 'snippet quoted verbatim');
check(c1.endsWith('— found via Medicus Suite evidence review.'), 'provenance-of-the-citation trailer present');

const mentionOnly = Object.assign({}, withReaction, { matchedReactionTerms: [] });
check(
  buildCitationText(mentionOnly).startsWith('Mention found in '),
  'no reaction terms -> "Mention found" lead, never "Reaction documented"'
);
check(
  !buildCitationText(mentionOnly).includes('Reaction documented'),
  'substance-only mention never claims a documented reaction'
);

console.log('--- buildCitationText: authorship & GP2GP caveat ---');
const noAuthor = Object.assign({}, withReaction, { recordedBy: null, recordedByOrganisation: null });
check(!buildCitationText(noAuthor).includes('('), 'no author and no caveat -> parenthetical omitted, not invented');

const gp2gp = Object.assign({}, withReaction, { isGp2gpImport: true });
check(
  buildCitationText(gp2gp).includes('(Dr Smith — imported via GP2GP — original authorship at previous practice)'),
  'GP2GP caveat travels inside the pasteable parenthetical'
);
const gp2gpNoAuthor = Object.assign({}, gp2gp, { recordedBy: null });
check(
  buildCitationText(gp2gpNoAuthor).includes('(imported via GP2GP — original authorship at previous practice)'),
  'GP2GP caveat survives a missing author'
);

console.log('--- buildCitationText: snippet whitespace-only normalisation ---');
const multiline = Object.assign({}, withReaction, { snippet: 'rash\n  after   amoxicillin' });
check(
  buildCitationText(multiline).includes('"rash after amoxicillin"'),
  'interior whitespace collapsed to one line, no word changed'
);

console.log('--- formatEvidenceDate ---');
check(formatEvidenceDate({ date: '2019-03-12' }) === '12 Mar 2019', 'ISO date renders as "12 Mar 2019"');
check(
  formatEvidenceDate({ date: null, dateRaw: 'Tue 12 Mar 2019' }) === 'Tue 12 Mar 2019',
  'falls back to dateRaw verbatim'
);
check(formatEvidenceDate({}) === 'an undated entry', 'no date at all -> explicit "an undated entry", never blank');

console.log('--- sourceTypeWord ---');
check(sourceTypeWord('encounter-entry') === 'consultation entry', 'internal label never leaks into a citation');
check(sourceTypeWord('mystery-type') === 'record entry', 'unknown sourceType -> generic prose');

console.log('--- attributionText ---');
check(
  attributionText({ recordedBy: 'Dr Smith', recordedByOrganisation: 'Riverside Practice' }) ===
    'Dr Smith, Riverside Practice',
  'who + org'
);
check(
  attributionText({ recordedBy: null, recordedByOrganisation: 'Riverside Practice' }) === 'Riverside Practice',
  'org only'
);
check(attributionText({}) === '', 'nothing -> empty, caller omits');

console.log('--- provenanceText ---');
check(provenanceText(null) === '', 'null provenance -> empty string');
check(
  provenanceText({ date: '2019-03-12', recordedBy: 'Dr Smith', recordedByOrganisation: null, isGp2gpImport: false }) ===
    'Earliest mention: 12 Mar 2019 — Dr Smith',
  'dated, attributed provenance line'
);
check(
  provenanceText({ date: '2019-03-12', recordedBy: null, recordedByOrganisation: null, isGp2gpImport: false }) ===
    'Earliest mention: 12 Mar 2019 — author not recorded',
  'missing author stated explicitly, not invented'
);
check(
  provenanceText({
    date: '2019-03-12',
    recordedBy: 'Dr Smith',
    recordedByOrganisation: null,
    isGp2gpImport: true,
  }).endsWith('(imported via GP2GP — original authorship at previous practice)'),
  'GP2GP provenance carries the import caveat'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
