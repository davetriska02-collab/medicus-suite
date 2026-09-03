// test-outstanding-investigations.js — outstanding investigation requests
// Run with: node test-outstanding-investigations.js
//
// Fixtures below are the REAL patient-journal investigation-request entries
// from HAR 109 (2026-08-26, journal page load), for the same patient as HAR
// 107 (scaphoid X-ray, confirmed outstanding via a dedicated GET
// .../investigation-request/overview/{id} with isAwaitingResults: true,
// isFulfilled: false) and HAR 108 (a bloods panel, confirmed fully resulted
// the same way). Both journal entries share the exact request `id` the
// dedicated overview endpoint used, and the item counts match exactly.
'use strict';

const { outstandingInvestigationRequests } = require('./shared/outstanding-investigations.js');

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

// Real journal entries (nested under an encounter, HAR 109), trimmed to the
// fields the parser reads.
const SCAPHOID_XRAY = {
  entryType: 'investigation-request',
  id: '01a03503-0f19-7141-8449-5b755eafe2c2',
  investigationRequestItems: ['SCAPHOID  LT X-ray'],
  isAwaitingResults: true,
  requestedBy: 'Dr Nicholas Grundy',
  requestingOrganisation: 'Park Road Surgery',
  requestedDate: '24 Aug 2026',
  isMarkedIncorrect: false,
};
const LARGE_BLOODS_PANEL_OUTSTANDING = {
  entryType: 'investigation-request',
  id: '01a03506-8a61-72b4-a5cd-6e539b157476',
  investigationRequestItems: [
    'Bone Profile (Calcium Studies)',
    'C-Reactive Protein Blood',
    'Ferritin Blood',
    'Folate Blood',
    'Full Blood Count',
    'HbA1C (Glycated Haemoglobin)',
    'Lipids Blood',
    'Liver Function',
    'Thyroid Stimulating Hormone',
    'Urea and Electrolytes WITH Potassium',
    'Vitamin B12 ',
    'Vitamin D (25-hydroxy)',
  ],
  isAwaitingResults: true,
  requestedBy: 'Dr Nicholas Grundy',
  requestingOrganisation: 'Park Road Surgery',
  requestedDate: '24 Aug 2026',
  isMarkedIncorrect: false,
  isRetrospectivelyAmended: true,
};
const RESULTED_BLOODS_PANEL = {
  entryType: 'investigation-request',
  id: '01973a09-d3e4-7315-8776-1db2385a9005',
  investigationRequestItems: [
    'Full Blood Count',
    'HbA1C (Glycated Haemoglobin)',
    'Lipids Blood',
    'Liver Function',
    'Thyroid Stimulating Hormone',
    'Urea and Electrolytes WITH Potassium',
  ],
  isAwaitingResults: false, // confirmed live: every item on this request has isFulfilled: true
  requestedBy: 'Dr Alexandra Patton',
  requestingOrganisation: 'Park Road Surgery',
  requestedDate: '04 Jun 2025',
  isMarkedIncorrect: false,
};

function journalWith(nestedEntries, flatEntries) {
  const dayItems = [];
  if (nestedEntries && nestedEntries.length) {
    dayItems.push({
      type: 'encounter',
      data: {
        consultationTopics: [{ headings: [{ entries: nestedEntries }] }],
      },
    });
  }
  (flatEntries || []).forEach((e) => dayItems.push({ type: 'investigation-request', ...e }));
  return { patientJournalRecords: [{ title: 'Mon 24 Aug 2026', items: dayItems }] };
}

console.log('\n--- real data: outstanding vs resulted ---');
{
  const journal = journalWith([SCAPHOID_XRAY, RESULTED_BLOODS_PANEL]);
  const out = outstandingInvestigationRequests(journal);
  assert(out.length === 1, 'resulted bloods panel excluded, only the X-ray is outstanding');
  assert(out[0].id === SCAPHOID_XRAY.id, 'the outstanding one is the X-ray');
  assert(out[0].items.length === 1 && out[0].items[0] === 'SCAPHOID  LT X-ray', 'item text preserved verbatim');
  assert(out[0].requestedBy === 'Dr Nicholas Grundy', 'requestedBy preserved');
  assert(out[0].requestedDate === '24 Aug 2026', 'requestedDate preserved');
}

console.log('\n--- real data: a 12-item outstanding panel ---');
{
  const journal = journalWith([LARGE_BLOODS_PANEL_OUTSTANDING]);
  const out = outstandingInvestigationRequests(journal);
  assert(out.length === 1, 'one outstanding request');
  assert(out[0].items.length === 12, 'all 12 requested items preserved');
  assert(out[0].items.includes('Vitamin D (25-hydroxy)'), 'spot-check one item name');
}

console.log('\n--- shape robustness ---');
{
  const flatJournal = journalWith([], [SCAPHOID_XRAY]);
  const out = outstandingInvestigationRequests(flatJournal);
  assert(out.length === 1 && out[0].id === SCAPHOID_XRAY.id, 'flat (non-nested) entries are also walked');
}
{
  const marked = { ...SCAPHOID_XRAY, isMarkedIncorrect: true };
  const out = outstandingInvestigationRequests(journalWith([marked]));
  assert(out.length === 0, 'isMarkedIncorrect entries are excluded even if awaiting results');
}
{
  // The same request appearing twice (e.g. a flat AND nested copy, or a
  // duplicate journal render) must not double-count.
  const journal = journalWith([SCAPHOID_XRAY], [SCAPHOID_XRAY]);
  const out = outstandingInvestigationRequests(journal);
  assert(out.length === 1, 'the same request id is de-duplicated across flat + nested');
}
{
  const noItems = { ...SCAPHOID_XRAY, investigationRequestItems: undefined };
  const out = outstandingInvestigationRequests(journalWith([noItems]));
  assert(
    Array.isArray(out[0].items) && out[0].items.length === 0,
    'missing investigationRequestItems -> empty array, not a crash'
  );
}
{
  assert(outstandingInvestigationRequests(null).length === 0, 'null journal -> empty array, not a crash');
  assert(outstandingInvestigationRequests({}).length === 0, 'journal with no patientJournalRecords -> empty array');
}

console.log('\n--- sort: oldest-requested first ---');
{
  const newer = { ...SCAPHOID_XRAY, id: 'newer-id', requestedDate: '25 Aug 2026' };
  const older = { ...SCAPHOID_XRAY, id: 'older-id', requestedDate: '01 Jan 2026' };
  const out = outstandingInvestigationRequests(journalWith([newer, older]));
  assert(out[0].id === 'older-id' && out[1].id === 'newer-id', 'oldest request comes first');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
