// Medicus Suite — allergy-duplicate-merge ("Review duplicates?" for merging
// duplicate allergy entries) tests
// Run with: node test-allergy-duplicate-merge.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: grouping the cheap clinical-summary/summary allergies[] list by
// exact description text, picking the default keeper (earliest recordDate),
// unwrapping UI-select-shaped fields (allergyCode/substance/
// recordedByOrganisation) the same way already proven for problems,
// extracting per-field value choices across a duplicate group, building the
// merged change-allergy POST payload confirmed via the real captured HAR
// (2026-07-29), and the end-allergy payload used for the merged-away
// duplicates (always the fixed, explicit-user-worded safety reason, never a
// caller-supplied one).

'use strict';

const {
  MERGE_REASON_ENDED,
  MERGEABLE_FIELDS,
  normalizeAllergyDescription,
  activeNonDraftAllergies,
  groupDuplicateAllergies,
  resolveAllergyConceptId,
  isSameAllergenConcept,
  groupRelatedAllergies,
  pickDefaultKeeperId,
  unwrapSelectValue,
  unwrapRecordedByOrganisation,
  fieldValuesByEntry,
  normalizeOnsetDateForSubmit,
  buildMergeChangeAllergyPayload,
  buildEndAllergyPayload,
} = require('./content-scripts/allergy-duplicate-merge.js');

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

console.log('--- MERGE_REASON_ENDED: the exact explicit user wording ---');
{
  check(
    MERGE_REASON_ENDED ===
      'Multiple allergy entries for same allergen - merged into single entry for clarity and to reduce dangerous / distracting clutter on clinical record',
    'matches the wording the user explicitly specified, verbatim (got "' + MERGE_REASON_ENDED + '")'
  );
}

console.log('--- MERGEABLE_FIELDS: the five clinical fields, nothing else ---');
{
  check(
    MERGEABLE_FIELDS.length === 5 &&
      ['severity', 'certainty', 'additionalInformation', 'allergyReactions', 'onsetDate'].every((f) =>
        MERGEABLE_FIELDS.includes(f)
      ),
    'exactly the five clinical fields — allergyCode/substance/recordDate/recordedBy* are deliberately never per-field mergeable'
  );
}

console.log('--- normalizeAllergyDescription ---');
{
  check(normalizeAllergyDescription('Amoxicillin') === 'amoxicillin', 'lowercased');
  check(normalizeAllergyDescription('  Amoxicillin  ') === 'amoxicillin', 'trimmed');
  check(normalizeAllergyDescription(null) === '', 'null -> empty string, never throws');
  check(normalizeAllergyDescription(undefined) === '', 'undefined -> empty string, never throws');
}

console.log('--- activeNonDraftAllergies ---');
{
  const raw = [
    { id: 'a1', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'a2', allergyCodeDescription: 'Draft', isDraft: true },
    null,
    { id: '', allergyCodeDescription: 'No id', isDraft: false },
  ];
  check(activeNonDraftAllergies(raw).length === 1, 'draft, null, and id-less entries excluded');
  check(activeNonDraftAllergies(null).length === 0, 'null -> empty array, never throws');
}

console.log('--- groupDuplicateAllergies: real 2026-07-29 example (HAR32, converting one to "Amoxicillin") ---');
{
  const afterConversion = [
    { id: '01930af7-644f-7262-80f2-02dc79530d80', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: '019fae65-0843-7240-bbf1-83ffcf8d24ed', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: '019fae66-2e81-705b-9a98-80b96fefc52d', allergyCodeDescription: 'Sulfasalazine allergy', isDraft: false },
  ];
  const groups = groupDuplicateAllergies(afterConversion);
  check(groups.length === 1, 'exactly one duplicate group found (Sulfasalazine allergy is solo, not a group)');
  check(groups[0].length === 2, 'the Amoxicillin group has both real entries');
  check(
    groups[0].every((e) => e.allergyCodeDescription === 'Amoxicillin'),
    'both entries in the group share the description'
  );
}
{
  // Real capture, HAR 33: five identical "No known allergies" entries.
  const fiveInARow = [
    { id: 'i1', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: 'i2', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: 'i3', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: 'i4', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: 'i5', allergyCodeDescription: 'No known allergies', isDraft: false },
  ];
  check(groupDuplicateAllergies(fiveInARow)[0].length === 5, 'a group of 5 identical entries is returned as one group');
}
{
  check(
    groupDuplicateAllergies([{ id: 'solo', allergyCodeDescription: 'Penicillin', isDraft: false }]).length === 0,
    'a solo entry is never a duplicate group'
  );
  check(groupDuplicateAllergies([]).length === 0, 'empty list -> no groups');
  check(groupDuplicateAllergies(null).length === 0, 'null -> no groups, never throws');
  check(
    groupDuplicateAllergies([
      { id: 'a', allergyCodeDescription: 'Amoxicillin', isDraft: false },
      { id: 'b', allergyCodeDescription: '  amoxicillin  ', isDraft: false },
    ])[0].length === 2,
    'matching is case-insensitive and whitespace-trimmed'
  );
}

console.log("--- resolveAllergyConceptId: overview-allergy is FLAT (unlike edit-allergy's {label,value} wrap) ---");
{
  check(
    resolveAllergyConceptId({ allergyCode: { conceptId: '91935009' } }) === '91935009',
    'allergyCode.conceptId resolved'
  );
  check(
    resolveAllergyConceptId({ substance: { conceptId: '387458008' } }) === '387458008',
    'falls back to substance.conceptId when allergyCode is absent'
  );
  check(resolveAllergyConceptId({ allergyCode: null, substance: null }) === null, 'both blank -> null');
  check(resolveAllergyConceptId(null) === null, 'null overview -> null, never throws');
}

console.log(
  '--- isSameAllergenConcept: real 2026-07-30 termbrowser investigation (peanut vs peanut-anaphylaxis vs arachis oil) ---'
);
{
  // 241933001 "Peanut-induced anaphylaxis" IS-A DIRECTLY 91935009 "Allergy
  // to peanut" — confirmed live via the public termbrowser API.
  check(
    isSameAllergenConcept('241933001', ['91935009', '609328004'], '91935009', ['138875005']),
    'a direct IS-A ancestor relationship counts as the same allergen'
  );
  check(
    isSameAllergenConcept('91935009', [], '91935009', []),
    'identical conceptId always counts, even with no ancestor data'
  );
  check(
    !isSameAllergenConcept('294317009', ['294315001', '414285001', '1371398000'], '91935009', [
      '91934008',
      '409136006',
    ]),
    'Arachis oil allergy (294317009) does NOT count as the same allergen as Peanut allergy — confirmed live: its Causative Agent ' +
      '(Arachis oil) sits under a completely separate "Fixed oil" hierarchy with no ancestor link to Peanut (substance) at all'
  );
  check(!isSameAllergenConcept(null, [], '91935009', []), 'a missing conceptId on either side never matches');
  check(
    !isSameAllergenConcept('91935009', [], null, []),
    'a missing conceptId on either side never matches (other side)'
  );
}

console.log('--- groupRelatedAllergies: text-only degenerates to groupDuplicateAllergies (empty concept map) ---');
{
  const entries = [
    { id: 'a', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'b', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'c', allergyCodeDescription: 'Sulfasalazine allergy', isDraft: false },
  ];
  const groups = groupRelatedAllergies(entries, {});
  check(
    groups.length === 1 && groups[0].length === 2,
    'with no concept info, grouping matches groupDuplicateAllergies exactly'
  );
  check(
    groups[0].every((e) => e.groupedBy === 'text'),
    'both entries marked groupedBy: "text"'
  );
}

console.log(
  '--- groupRelatedAllergies: real scenario — 6 "Peanut allergy" + 1 "Peanut-induced anaphylaxis" + 1 "Allergy to Arachis oil" ---'
);
{
  const allergies = [
    { id: 'p1', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'p2', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'p3', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'p4', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'p5', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'p6', allergyCodeDescription: 'Peanut allergy', isDraft: false },
    { id: 'anaphylaxis', allergyCodeDescription: 'Peanut-induced anaphylaxis', isDraft: false },
    { id: 'oil', allergyCodeDescription: 'Allergy to Arachis oil', isDraft: false },
  ];
  const conceptInfo = {
    p1: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    p2: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    p3: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    p4: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    p5: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    p6: { conceptId: '91935009', ancestorConceptIds: ['91934008', '409136006'] },
    anaphylaxis: { conceptId: '241933001', ancestorConceptIds: ['91935009', '91934008', '609328004'] },
    oil: { conceptId: '294317009', ancestorConceptIds: ['294315001', '414285001', '1371398000'] },
  };
  const groups = groupRelatedAllergies(allergies, conceptInfo);
  check(groups.length === 1, 'exactly one group — the arachis oil entry is correctly left out');
  const group = groups[0];
  check(
    group.length === 7,
    'the group has all 7 same-allergen entries (6 peanut allergy + 1 anaphylaxis), not the arachis oil one'
  );
  check(
    !group.some((e) => e.id === 'oil'),
    'Arachis oil allergy is NOT pulled in — correctly distinct despite the textual/topical similarity'
  );
  const anaphylaxisEntry = group.find((e) => e.id === 'anaphylaxis');
  check(
    anaphylaxisEntry.groupedBy === 'concept',
    'the anaphylaxis entry is marked groupedBy: "concept" (different text, SNOMED-related)'
  );
  check(
    anaphylaxisEntry.relatedToDescription === 'Peanut allergy',
    "the anaphylaxis entry names which other entry's description it relates to, for the review UI to explain"
  );
  const peanutEntry = group.find((e) => e.id === 'p1');
  check(peanutEntry.groupedBy === 'text', 'the plain "Peanut allergy" entries are marked groupedBy: "text"');
}

console.log('--- pickDefaultKeeperId: earliest recordDate wins (explicit user preference) ---');
{
  check(
    pickDefaultKeeperId([
      { id: 'later', recordDate: '2025-01-01' },
      { id: 'earliest', recordDate: '2024-11-08' },
      { id: 'middle', recordDate: '2024-12-25' },
    ]) === 'earliest',
    'the genuinely earliest recordDate is picked regardless of list order'
  );
  check(
    pickDefaultKeeperId([
      { id: 'no-date', recordDate: null },
      { id: 'has-date', recordDate: '2024-11-08' },
    ]) === 'has-date',
    'an entry WITH a date beats one with none'
  );
  check(
    pickDefaultKeeperId([
      { id: 'no-date-1', recordDate: null },
      { id: 'no-date-2', recordDate: null },
    ]) === 'no-date-1',
    'when nothing has a date, the first list entry is kept (stable, not arbitrary)'
  );
  check(pickDefaultKeeperId([]) === null, 'empty entries -> null');
  check(pickDefaultKeeperId(null) === null, 'null entries -> null, never throws');
  check(
    pickDefaultKeeperId([{ id: 'x', recordDate: '2024-01-01' }, null]) === 'x',
    'a null entry in the list is skipped, not fatal'
  );
}

console.log('--- unwrapSelectValue: real edit-allergy prefill shape (allergyCode) ---');
{
  check(
    unwrapSelectValue({
      label: 'Amoxicillin allergy',
      value: { conceptId: '294505008', description: 'Amoxicillin allergy', descriptionId: '2476309016' },
    }).conceptId === '294505008',
    'unwraps the real {label, value:{...}} shape confirmed on edit-allergy prefill'
  );
  check(
    unwrapSelectValue({ conceptId: '774586009', description: 'Amoxicillin' }).conceptId === '774586009',
    'a plain (unwrapped) object passes through unchanged'
  );
  check(unwrapSelectValue(null) === null, 'null -> null, never throws');
  check(unwrapSelectValue(undefined) === null, 'undefined -> null, never throws');
}

console.log('--- unwrapRecordedByOrganisation: same shape/logic already proven for problems ---');
{
  check(
    unwrapRecordedByOrganisation({ label: 'Park Road Surgery', value: { organisationName: 'Park Road Surgery' } })
      .organisationName === 'Park Road Surgery',
    'unwraps the wrapped UI-select shape'
  );
  check(
    unwrapRecordedByOrganisation({ organisationName: 'prev GP', organisationIdentifierType: null }).organisationName ===
      'prev GP',
    'a plain object (real captured change-allergy payload shape) passes through unchanged'
  );
  check(unwrapRecordedByOrganisation(null) === null, 'null -> null, never throws');
}

console.log('--- fieldValuesByEntry: real overview-allergy shapes ---');
{
  const entries = [
    { id: 'e1', overview: { severity: 'Severe', certainty: null, additionalInformation: null, allergyReactions: [] } },
    {
      id: 'e2',
      overview: {
        severity: null,
        certainty: 'Likely',
        additionalInformation: 'reacted with hives',
        allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }],
      },
    },
    { id: 'e3', overview: null },
  ];
  check(
    Object.keys(fieldValuesByEntry(entries, 'severity')).length === 1 &&
      fieldValuesByEntry(entries, 'severity').e1 === 'Severe',
    'only entries with a genuinely populated value for the field are included'
  );
  check(
    fieldValuesByEntry(entries, 'additionalInformation').e2 === 'reacted with hives',
    'additionalInformation resolved correctly'
  );
  const reactionValues = fieldValuesByEntry(entries, 'allergyReactions');
  check(
    Object.keys(reactionValues).length === 1 && reactionValues.e2.length === 1,
    'allergyReactions: only entries with a non-empty reactions array are included (e1 has [], excluded)'
  );
  check(Object.keys(fieldValuesByEntry(entries, 'onsetDate')).length === 0, 'a field nobody has -> empty map');
  check(Object.keys(fieldValuesByEntry(null, 'severity')).length === 0, 'null entries -> empty map, never throws');
}

console.log('--- buildMergeChangeAllergyPayload: matches the real captured change-allergy contract ---');
{
  // Real prefill shape (HAR32 entry 15, "Amoxicillin allergy" being edited),
  // trimmed to the fields this function actually reads.
  const prefill = {
    allergyCode: {
      label: 'Amoxicillin allergy',
      value: { conceptId: '294505008', description: 'Amoxicillin allergy', descriptionId: '2476309016' },
    },
    substance: null,
    additionalInformation: null,
    severity: 'severe',
    certainty: 'certain',
    allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis', descriptionId: '66382015' }],
    onsetDate: '2001-01-01',
    allergyCodeType: 'pre-defined-allergies',
    isDraft: false,
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    linkedProblemIds: [],
    endDate: null,
    recordedAtAnotherOrganisation: false,
    recordDate: '2024-11-08',
    recordedByOrganisation: null,
    recordedByPractitioner: null,
    recordedByStaff: '0192351f-fd60-711f-bf55-176f0c1e5f1b',
    linkedClinicalCase: { options: [], defaultClinicalCaseId: null, requiresClinicalCase: false },
  };
  const payload = buildMergeChangeAllergyPayload(prefill, {});
  check(
    payload.allergyCode && payload.allergyCode.conceptId === '294505008',
    'allergyCode is unwrapped from the {label,value} shape to the flat POST shape'
  );
  check(payload.substance === null, 'substance stays null when not populated');
  check(
    payload.severity === 'severe' && payload.certainty === 'certain',
    'unmerged fields fall back to the prefill value'
  );
  check(
    payload.recordedByStaff === '0192351f-fd60-711f-bf55-176f0c1e5f1b',
    'recordedByStaff carried through when recordedAtAnotherOrganisation is false'
  );
  check(
    !('recordedByOrganisation' in payload),
    'recordedByOrganisation is NOT set when recordedAtAnotherOrganisation is false (matches the real captured HAR32 payload exactly)'
  );
  check(payload.recordDate === '2024-11-08', 'recordDate always inherited from the keeper prefill, never mergeable');
  check(payload.clinicalCaseId === null, 'clinicalCaseId resolved from linkedClinicalCase.defaultClinicalCaseId');

  const merged = buildMergeChangeAllergyPayload(prefill, {
    severity: 'moderate',
    additionalInformation: 'from the other entry',
  });
  check(merged.severity === 'moderate', 'a chosen field value overrides the keeper prefill value');
  check(merged.additionalInformation === 'from the other entry', 'additionalInformation override works too');
  check(merged.certainty === 'certain', 'a field NOT chosen still falls back to the keeper prefill value');
}

console.log('--- buildMergeChangeAllergyPayload: real captured "prev GP"/blank-organisation case (HAR35) ---');
{
  const prefillBlankOrg = {
    allergyCode: {
      label: 'No known allergies',
      value: { conceptId: '716186003', description: 'No known allergies', descriptionId: null },
    },
    substance: null,
    additionalInformation: null,
    severity: null,
    certainty: null,
    allergyReactions: [],
    onsetDate: null,
    allergyCodeType: 'pre-defined-allergies',
    linkedProblemIds: [],
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    endDate: null,
    recordedAtAnotherOrganisation: true,
    recordDate: '2014-10-01',
    recordedByOrganisation: null,
    recordedByPractitioner: 'Mrs Patricia Day',
    recordedByStaff: null,
    linkedClinicalCase: null,
  };
  const payload = buildMergeChangeAllergyPayload(prefillBlankOrg, {});
  check(
    payload.recordedByOrganisation && payload.recordedByOrganisation.organisationName === 'Unknown',
    'a genuinely blank recordedByOrganisation falls back to the agreed "Unknown" placeholder, not a guess (got ' +
      JSON.stringify(payload.recordedByOrganisation) +
      ')'
  );
  check(payload.recordedByPractitioner === 'Mrs Patricia Day', 'recordedByPractitioner carried through unchanged');
  check(!('recordedByStaff' in payload), 'recordedByStaff NOT set when recordedAtAnotherOrganisation is true');

  const prefillWrappedOrg = Object.assign({}, prefillBlankOrg, {
    recordedByOrganisation: {
      label: 'Park Road Surgery',
      value: {
        organisationName: 'Park Road Surgery',
        organisationIdentifierType: 'nhs-england-ods-code',
        organisationIdentifierValue: 'H84002',
      },
    },
  });
  const payloadWrapped = buildMergeChangeAllergyPayload(prefillWrappedOrg, {});
  check(
    payloadWrapped.recordedByOrganisation.organisationName === 'Park Road Surgery',
    'a genuinely POPULATED (wrapped) recordedByOrganisation is unwrapped and used, never replaced with "Unknown"'
  );
}

console.log('--- buildEndAllergyPayload: always the fixed merge reason, matches the real end-allergy contract ---');
{
  const payload = buildEndAllergyPayload('019fae65-0843-7240-bbf1-83ffcf8d24ed', '2026-07-29', MERGE_REASON_ENDED);
  check(
    payload.allergyId === '019fae65-0843-7240-bbf1-83ffcf8d24ed' &&
      payload.endDate === '2026-07-29' &&
      payload.reasonEnded === MERGE_REASON_ENDED,
    'matches the real captured end-allergy payload shape: {allergyId, endDate, reasonEnded}'
  );
  check(!('recordedByOrganisation' in payload), 'no organisation field — end-allergy never needs one, confirmed live');
}

console.log(
  '--- normalizeOnsetDateForSubmit: real HAR36 merge-failure bug (overview display format -> edit-allergy ISO format) ---'
);
{
  check(
    normalizeOnsetDateForSubmit('24 Jul 2012') === '2012-07-24',
    'real failing HAR36 value ("24 Jul 2012") converts to the ISO shape change-allergy actually accepts'
  );
  check(
    normalizeOnsetDateForSubmit('01 Jan 2001') === '2001-01-01',
    'real captured HAR32 overview-allergy value converts correctly'
  );
  check(
    normalizeOnsetDateForSubmit('23 Apr 2001') === '2001-04-23',
    'real captured HAR34 overview-allergy value converts correctly'
  );
  check(normalizeOnsetDateForSubmit('1 Jul 2012') === '2012-07-01', 'single-digit day is zero-padded');
  check(normalizeOnsetDateForSubmit(null) === null, 'null passes through unchanged');
  check(
    normalizeOnsetDateForSubmit('2012-07-24') === '2012-07-24',
    'an already-ISO value passes through unchanged, not double-converted'
  );
  check(
    normalizeOnsetDateForSubmit('some unrecognised format') === 'some unrecognised format',
    'an unrecognised shape passes through unchanged rather than guessing'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
