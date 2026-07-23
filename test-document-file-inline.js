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
  findAttachmentsInOverview,
  patientIdFromOverview,
  resolveAttachmentUrl,
  filterDocumentTypes,
  priorityColor,
  findDocumentTypeByConceptId,
  DOCUMENT_TYPES,
  IMAGE_EXT_RE,
  DOCFILE_EXT_RE,
} = require('./content-scripts/document-file-inline.js');
const documentTypesData = require('./rules/document-types.json');

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
  // A button-rendered attachment (communication-thread tasks, confirmed live
  // 2026-07-20) has no href at all — it must stay eligible (resolved later via
  // the task-overview API), not be dropped, as long as its filename resolves.
  check(
    filterEligibleAttachments([{ href: '', filename: 'no-href.jpg' }]).length === 1,
    'a href-less entry with a resolvable filename is eligible (button-rendered attachment)'
  );
  check(
    filterEligibleAttachments([{ href: '', filename: 'no-href.txt' }]).length === 0,
    'a href-less entry with an unrecognised extension is still dropped'
  );
  check(
    filterEligibleAttachments([{ href: '', filename: '' }]).length === 0,
    'no href AND no filename — nothing to key off — is dropped'
  );
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

console.log('--- findAttachmentsInOverview: walks the task-overview JSON for the confirmed attachment shape ---');
{
  // Real shape confirmed via live capture 2026-07-20 (communication-thread
  // task, docs/learnings-triage-attachment-to-document.md §8): the SAME
  // attachment object appears twice (patientRequest AND operativeChannel
  // branches of the first communication) — must dedupe by id.
  const overview = {
    data: {
      patientId: 'patient-uuid',
      communicationThread: {
        communications: [
          {
            patientRequest: {
              attachments: [
                {
                  id: 'att-1',
                  fileName: 'thisisnotaphoto.png',
                  fileSize: 12765,
                  contentType: 'image/png',
                  fileURI: '/communication/data/online-message/download-attachment/att-1?convertToPDF=0',
                },
              ],
            },
            operativeChannel: {
              attachments: [
                {
                  id: 'att-1',
                  fileName: 'thisisnotaphoto.png',
                  fileSize: 12765,
                  contentType: 'image/png',
                  fileURI: '/communication/data/online-message/download-attachment/att-1?convertToPDF=0',
                },
              ],
            },
          },
          { patientMessage: { attachments: [] }, operativeChannel: { attachments: [] } },
        ],
      },
    },
  };
  const found = findAttachmentsInOverview(overview);
  check(
    found.length === 1,
    `the duplicated attachment across patientRequest/operativeChannel dedupes by id (got ${found.length})`
  );
  check(found[0].filename === 'thisisnotaphoto.png', 'filename read from fileName');
  check(
    found[0].fileURI === '/communication/data/online-message/download-attachment/att-1?convertToPDF=0',
    'fileURI carried through unchanged — never reconstructed'
  );
  check(found[0].fileSize === 12765 && found[0].contentType === 'image/png', 'fileSize/contentType carried through');

  check(findAttachmentsInOverview({}).length === 0, 'empty object -> no attachments, never throws');
  check(findAttachmentsInOverview(null).length === 0, 'null -> no attachments, never throws');
  check(
    findAttachmentsInOverview({ a: { b: { c: 1 } } }).length === 0,
    'a tree with no attachment-shaped object -> []'
  );
  check(
    findAttachmentsInOverview({ x: { fileName: 'a.png' } }).length === 0,
    'an object with fileName but no fileURI/id is NOT treated as an attachment (partial shape, never guessed)'
  );

  const twoDistinct = findAttachmentsInOverview({
    a: { id: '1', fileName: 'one.png', fileURI: '/x/1' },
    b: { nested: { id: '2', fileName: 'two.pdf', fileURI: '/x/2' } },
  });
  check(twoDistinct.length === 2, 'two genuinely distinct attachments at different tree depths are both found');
}

console.log('--- patientIdFromOverview: every known response shape ---');
{
  check(
    patientIdFromOverview({ data: { patientId: 'p1' } }) === 'p1',
    'data.patientId (confirmed: communication-thread)'
  );
  check(patientIdFromOverview({ data: { patient: { id: 'p2' } } }) === 'p2', 'data.patient.id');
  check(patientIdFromOverview({ patient: { id: 'p3' } }) === 'p3', 'patient.id');
  check(patientIdFromOverview({ patientId: 'p4' }) === 'p4', 'top-level patientId');
  check(patientIdFromOverview({}) === null, 'no matching shape -> null, not a guess');
  check(patientIdFromOverview(null) === null, 'null input -> null, never throws');
}

console.log('--- resolveAttachmentUrl: already-resolved passes through; unresolved matched by filename ---');
{
  check(
    resolveAttachmentUrl({ href: 'https://x/doc/1.jpg', filename: 'a.jpg' }, [], 'https://base') ===
      'https://x/doc/1.jpg',
    'an attachment with an href already (real <a> in the DOM) passes through unchanged'
  );
  const resolved = [{ id: 'att-1', filename: 'thisisnotaphoto.png', fileURI: '/communication/data/x/att-1' }];
  check(
    resolveAttachmentUrl(
      { href: '', filename: 'thisisnotaphoto.png' },
      resolved,
      'https://e38a9f.api.medicus.health'
    ) === 'https://e38a9f.api.medicus.health/communication/data/x/att-1',
    'a href-less attachment resolves to base + fileURI, matched by filename'
  );
  check(
    resolveAttachmentUrl({ href: '', filename: 'not-in-list.png' }, resolved, 'https://base') === null,
    'no matching filename in the resolved list -> null, never a guessed URL'
  );
  check(
    resolveAttachmentUrl({ href: '', filename: 'x.png' }, [], 'https://base') === null,
    'empty resolved list -> null'
  );
  check(
    resolveAttachmentUrl({ href: '', filename: 'x.png' }, null, 'https://base') === null,
    'null resolved list -> null, never throws'
  );
}

console.log('--- rules/document-types.json: the imported SNOMED picklist itself ---');
{
  check(Array.isArray(documentTypesData.entries), 'entries is an array');
  check(documentTypesData.entries.length === 1768, `1768 active entries (got ${documentTypesData.entries.length})`);
  check(
    documentTypesData.entries.every((e) => Number.isInteger(e.docPriority) && e.docPriority >= 1 && e.docPriority <= 6),
    'every entry carries a docPriority in the 1-6 scale'
  );
  const dupeIds = documentTypesData.entries.length - new Set(documentTypesData.entries.map((e) => e.conceptId)).size;
  check(dupeIds === 0, `no duplicate conceptIds (found ${dupeIds})`);
  const image = documentTypesData.entries.find((e) => e.conceptId === DOCUMENT_TYPES.image.conceptId);
  check(
    !!image &&
      image.description === DOCUMENT_TYPES.image.description &&
      image.descriptionId === DOCUMENT_TYPES.image.descriptionId,
    'the confirmed "Medical photograph" code is present and byte-identical to the hard-coded default'
  );
  const doc = documentTypesData.entries.find((e) => e.conceptId === DOCUMENT_TYPES.document.conceptId);
  check(
    !!doc &&
      doc.description === DOCUMENT_TYPES.document.description &&
      doc.descriptionId === DOCUMENT_TYPES.document.descriptionId,
    'the confirmed "Patient/Carer Correspondence" code is present and byte-identical to the hard-coded default'
  );
}

console.log('--- filterDocumentTypes: case-insensitive substring search, capped ---');
{
  const entries = [
    { conceptId: '1', description: 'Medical photograph' },
    { conceptId: '2', description: 'Discharge summary' },
    { conceptId: '3', description: 'Patient/Carer Correspondence' },
    { conceptId: '4', description: 'Radiology report' },
  ];
  check(filterDocumentTypes(entries, '', 40).length === 0, 'empty query -> no results (search does not browse all)');
  check(filterDocumentTypes(entries, '   ', 40).length === 0, 'whitespace-only query -> no results');
  check(filterDocumentTypes(null, 'report', 40).length === 0, 'null entries -> no results, never throws');
  const photo = filterDocumentTypes(entries, 'photo', 40);
  check(photo.length === 1 && photo[0].conceptId === '1', 'substring match on description');
  const caseInsensitive = filterDocumentTypes(entries, 'PHOTO', 40);
  check(caseInsensitive.length === 1 && caseInsensitive[0].conceptId === '1', 'search is case-insensitive');
  const correspondence = filterDocumentTypes(entries, 'correspond', 40);
  check(
    correspondence.length === 1 && correspondence[0].conceptId === '3',
    'matches mid-word substrings, not just prefixes'
  );
  check(filterDocumentTypes(entries, 'zzz-no-match', 40).length === 0, 'no match -> empty array');
  const capped = filterDocumentTypes(entries, 'e', 2);
  check(capped.length === 2, `limit is honoured (got ${capped.length})`);
  // Against the real 1768-entry list: a broad query stays capped, a narrow one doesn't exceed real matches.
  const broad = filterDocumentTypes(documentTypesData.entries, 'report', 40);
  check(broad.length <= 40, `real-list broad query capped at 40 (got ${broad.length})`);
  check(broad.length > 0, 'real-list broad query "report" finds at least one match');
}

console.log('--- filterDocumentTypes: ranks matches by docPriority (best first), then alphabetically ---');
{
  const scored = [
    { conceptId: '1', description: 'Care plan review', docPriority: 4 },
    { conceptId: '2', description: 'Care plan summary', docPriority: 1 },
    { conceptId: '3', description: 'Care plan letter', docPriority: 2 },
    { conceptId: '4', description: 'Care plan appendix', docPriority: 2 },
  ];
  const ranked = filterDocumentTypes(scored, 'care plan', 40);
  check(
    ranked.map((e) => e.conceptId).join(',') === '2,4,3,1',
    `docPriority 1 first, ties broken alphabetically, worst last (got ${ranked.map((e) => e.conceptId).join(',')})`
  );
  const unscored = [
    { conceptId: '1', description: 'Care plan no score' },
    { conceptId: '2', description: 'Care plan scored', docPriority: 5 },
  ];
  const rankedUnscored = filterDocumentTypes(unscored, 'care plan', 40);
  check(
    rankedUnscored[0].conceptId === '2',
    'an entry with a docPriority score ranks above one with none, never crashes'
  );
}

console.log('--- priorityColor: green(1) to red(6) sliding scale ---');
{
  check(typeof priorityColor(1) === 'string' && priorityColor(1) !== priorityColor(6), '1 and 6 are different colours');
  check(priorityColor(1) !== priorityColor(3), '1 and 3 are different colours (not just a two-tone split)');
  for (let p = 1; p <= 6; p++) {
    check(/^#[0-9a-f]{6}$/i.test(priorityColor(p)), `priorityColor(${p}) returns a hex colour`);
  }
  check(priorityColor(0) === priorityColor(7), 'out-of-range values clamp rather than throwing/returning undefined');
  check(priorityColor(undefined) === priorityColor(7), 'a missing/undefined score is treated as the worst tier');
  check(priorityColor(null) === priorityColor(7), 'a null score is treated as the worst tier, never throws');
}

console.log('--- findDocumentTypeByConceptId ---');
{
  const entries = [
    { conceptId: '1', description: 'A' },
    { conceptId: '2', description: 'B' },
  ];
  check(findDocumentTypeByConceptId(entries, '2').description === 'B', 'finds by conceptId');
  check(findDocumentTypeByConceptId(entries, 'nope') === null, 'no match -> null');
  check(findDocumentTypeByConceptId(null, '1') === null, 'null entries -> null, never throws');
  check(findDocumentTypeByConceptId(entries, null) === null, 'null conceptId -> null, never throws');
  check(
    findDocumentTypeByConceptId(documentTypesData.entries, DOCUMENT_TYPES.image.conceptId).description ===
      'Medical photograph',
    'finds the confirmed "Medical photograph" entry in the real 1768-entry list'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
