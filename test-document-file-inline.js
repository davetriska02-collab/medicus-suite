// Medicus Suite — document-file-inline (save triage attachment as document) tests
// Run with: node test-document-file-inline.js
//
// Live Medicus and the DOM it injects into aren't available here, so only the
// pure logic is exercised: which attachments are eligible to file, which of
// the two CONFIRMED real SNOMED documentType codes applies to a given
// filename (image -> "Medical photograph", pdf/doc/docx -> "Patient/Carer
// Correspondence" — see docs/learnings-triage-attachment-to-document.md), the
// title default, and the create-payload shape.

'use strict';

const {
  filterEligibleAttachments,
  titleFromFilename,
  buildFormPayload,
  documentTypeForFilename,
  DOCUMENT_TYPES,
  IMAGE_EXT_RE,
  DOCFILE_EXT_RE,
} = require('./content-scripts/document-file-inline.js');

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

console.log('--- documentTypeForFilename: the two confirmed real codes ---');
{
  check(
    documentTypeForFilename('rash.jpg').conceptId === '820241000000102',
    'image -> Medical photograph (820241000000102)'
  );
  check(
    documentTypeForFilename('rash.jpg').description === 'Medical photograph',
    'image -> description matches the confirmed capture'
  );
  check(
    documentTypeForFilename('letter.pdf').conceptId === '163181000000107',
    'pdf -> Patient/Carer Correspondence (163181000000107)'
  );
  check(
    documentTypeForFilename('letter.pdf').description === 'Patient/Carer Correspondence',
    'pdf -> description matches the confirmed capture'
  );
  check(documentTypeForFilename('report.doc') === DOCUMENT_TYPES.document, 'doc -> the same confirmed document type');
  check(documentTypeForFilename('report.docx') === DOCUMENT_TYPES.document, 'docx -> the same confirmed document type');
  check(documentTypeForFilename('notes.txt') === null, 'an extension with no confirmed code -> null, not a guess');
  check(documentTypeForFilename('') === null, 'empty filename -> null');
  check(documentTypeForFilename(null) === null, 'null filename -> null, never throws');
}

console.log('--- filterEligibleAttachments: matches every extension content.js detects ---');
{
  const all = [
    { href: 'https://x/doc/1', filename: 'wound-photo.jpg' },
    { href: 'https://x/doc/2', filename: 'referral-letter.pdf' },
    { href: 'https://x/doc/3', filename: 'rash.PNG' },
    { href: 'https://x/doc/4', filename: 'notes.docx' },
    { href: 'https://x/doc/5', filename: 'scan.heic' },
    { href: 'https://x/doc/6', filename: 'letter.doc' },
    { href: 'https://x/doc/7', filename: 'unrelated.txt' }, // not in extractInitialRequest's own regex either
  ];
  const out = filterEligibleAttachments(all);
  check(out.length === 6, `every pdf/doc/docx/image attachment is eligible, txt is not (got ${out.length})`);
  check(
    !out.some((a) => /\.txt$/i.test(a.filename)),
    'the one extension with no confirmed documentType code is excluded'
  );
}

console.log('--- filterEligibleAttachments: edge cases ---');
{
  check(filterEligibleAttachments(null).length === 0, 'non-array input -> empty array, never throws');
  check(filterEligibleAttachments(undefined).length === 0, 'undefined input -> empty array');
  check(filterEligibleAttachments([]).length === 0, 'empty list -> empty list');
  check(filterEligibleAttachments([{ filename: 'no-href.jpg' }]).length === 0, 'an entry with no href is dropped');
  check(
    filterEligibleAttachments([{ href: 'https://x/doc/1', filename: '' }]).length === 0,
    'a blank filename with a non-matching href is dropped'
  );
  // extractInitialRequest falls back to matching against the href when
  // filename/textContent is empty — the filter must honour that too.
  const hrefOnly = filterEligibleAttachments([{ href: 'https://x/doc/1.jpg', filename: '' }]);
  check(hrefOnly.length === 1, 'falls back to matching the href when filename is empty');
  const hrefOnlyPdf = filterEligibleAttachments([{ href: 'https://x/doc/1.pdf', filename: '' }]);
  check(hrefOnlyPdf.length === 1, 'href fallback also works for pdf/doc extensions');
}

console.log('--- titleFromFilename ---');
{
  check(titleFromFilename('wound-photo.jpg') === 'wound-photo', 'strips the extension');
  check(titleFromFilename('a.b.c.png') === 'a.b.c', 'only the last extension is stripped');
  check(titleFromFilename('') === 'Attachment', 'empty filename -> fallback label');
  check(titleFromFilename(null) === 'Attachment', 'null filename -> fallback label');
  check(titleFromFilename('noextension') === 'noextension', 'no extension -> filename unchanged');
}

console.log('--- buildFormPayload: matches the confirmed clinical/document/create contract ---');
{
  const payload = buildFormPayload({
    patientId: 'patient-uuid',
    documentDate: '2026-07-20',
    title: 'Wound photo from triage',
    documentType: DOCUMENT_TYPES.image,
    reviewerAssigneeId: 'team-uuid',
    reviewerAssigneeType: 'team',
  });
  check(payload.patientId === 'patient-uuid', 'patientId passed through');
  check(payload.title === 'Wound photo from triage', 'title passed through');
  check(
    payload.documentDate === '2026-07-20' && payload.recordDate === '2026-07-20',
    'documentDate mirrors recordDate'
  );
  check(payload.documentType === DOCUMENT_TYPES.image, 'documentType passed through from the caller, not hardcoded');
  check(payload.authorOrganisationOption === 'local', 'authorOrganisationOption defaults to local');
  check(payload.nextStep === 'file-into-patient-record', 'nextStep skips the review-routing workflow');
  check(
    payload.reviewerAssigneeId === 'team-uuid' && payload.reviewerAssigneeType === 'team',
    'reviewer fields passed through from the live form-load default, not hardcoded'
  );
  check(payload.linkedProblemIds.length === 0, 'linkedProblemIds defaults to an empty array (not null)');
  check(
    payload.hiddenFromPatientFacingServices === false && payload.confidentialFromThirdParties === false,
    "visibility flags default to false, matching Medicus's own form defaults"
  );
  check(
    payload.authoredByPractitioner === null,
    'authoredByPractitioner left unset — a patient submission, not staff-authored'
  );

  const pdfPayload = buildFormPayload({
    patientId: 'patient-uuid',
    documentDate: '2026-07-20',
    title: 'Referral letter',
    documentType: DOCUMENT_TYPES.document,
    reviewerAssigneeId: 'team-uuid',
    reviewerAssigneeType: 'team',
  });
  check(
    pdfPayload.documentType.description === 'Patient/Carer Correspondence',
    'a pdf/doc create uses the Patient/Carer Correspondence type when asked'
  );
}

console.log('--- extension regexes sanity ---');
{
  check(IMAGE_EXT_RE.test('photo.jpeg'), 'jpeg matches IMAGE_EXT_RE');
  check(IMAGE_EXT_RE.test('photo.JPG'), 'case-insensitive');
  check(!IMAGE_EXT_RE.test('letter.pdf'), 'pdf does not match IMAGE_EXT_RE');
  check(DOCFILE_EXT_RE.test('letter.pdf'), 'pdf matches DOCFILE_EXT_RE');
  check(DOCFILE_EXT_RE.test('report.DOCX'), 'docx matches DOCFILE_EXT_RE, case-insensitive');
  check(!DOCFILE_EXT_RE.test('notes.txt'), 'txt matches neither regex');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
