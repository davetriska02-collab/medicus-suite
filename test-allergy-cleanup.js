// Medicus Suite — allergy-cleanup ("Clean up allergies?") tests
// Run with: node test-allergy-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised — this consolidates test-allergy-junk-code-cleanup.js and
// test-allergy-duplicate-merge.js (both retired alongside their content
// scripts, see allergy-cleanup.js's own header comment) into one file
// covering the merged module: exact-conceptId junk matching against
// rules/allergy-junk-codes.json, classifying a batch of already-fetched
// overview-allergy responses into flagged junk entries, resolving an
// overview-allergy response's own conceptId, grouping the cheap
// clinical-summary/summary allergies[] list by exact text AND by SNOMED
// concept-ancestry, picking a default merge keeper, unwrapping UI-select
// shaped fields, extracting per-field value choices across a duplicate
// group, building the merged change-allergy POST payload, the end-allergy
// payload shape (both for junk removal and for merged-away duplicates), and
// the onset-date display-to-ISO conversion confirmed via the real HAR36
// merge-failure bug.

'use strict';

const {
  MERGE_REASON_ENDED,
  MERGEABLE_FIELDS,
  findJunkCodeEntry,
  resolveAllergyConceptId,
  buildEndAllergyPayload,
  isEndable,
  normalizeAllergyDescription,
  activeNonDraftAllergies,
  reactionDescriptions,
  buildCautionMessage,
  combinedCaution,
  classifyJunkEntries,
  hasBothCodeTypes,
  classifyDualCodedEntries,
  buildClearLegacyCodePayload,
  findConversionRule,
  classifyConvertibleEntries,
  normalizedConceptSearchResults,
  rankSubstanceResults,
  extractAllergenAndReactionHint,
  pickReactionSeed,
  groupDuplicateAllergies,
  isSameAllergenConcept,
  groupRelatedAllergies,
  pickDefaultKeeperId,
  filterActiveEntries,
  additionalInfoTextIsUnedited,
  unwrapSelectValue,
  unwrapRecordedByOrganisation,
  fieldValuesByEntry,
  buildAllergyProvenanceFields,
  buildMergeChangeAllergyPayload,
  buildConversionChangeAllergyPayload,
  normalizeOnsetDateForSubmit,
} = require('./content-scripts/allergy-cleanup.js');
const allergyJunkCodes = require('./rules/allergy-junk-codes.json');
const allergySubstanceConversion = require('./rules/allergy-substance-conversion.json');

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

console.log('--- rules/allergy-junk-codes.json: the imported codes list itself ---');
{
  check(Array.isArray(allergyJunkCodes.codes), 'codes is an array');
  check(allergyJunkCodes.codes.length === 5, 'exactly the five confirmed junk codes are configured so far');
  const noKnown = allergyJunkCodes.codes.find((c) => c.conceptId === '716186003');
  check(
    !!noKnown && noKnown.description === 'No known allergies' && noKnown.category === 'import-artefact',
    '716186003 "No known allergies" is present, category import-artefact'
  );
  check(
    typeof noKnown.reasonEnded === 'string' && noKnown.reasonEnded.length > 0,
    '716186003 has a non-empty reasonEnded'
  );
  const hoNonDrug = allergyJunkCodes.codes.find((c) => c.conceptId === '161611007');
  check(
    !!hoNonDrug && hoNonDrug.description === 'H/O: non-drug allergy' && hoNonDrug.category === 'import-artefact',
    '161611007 "H/O: non-drug allergy" is present, category import-artefact'
  );
  const atopy = allergyJunkCodes.codes.find((c) => c.conceptId === '115665000');
  check(
    !!atopy && atopy.description === 'Atopy' && atopy.category === 'too-generic',
    '115665000 "Atopy" is present, category too-generic'
  );
  const allergicReaction = allergyJunkCodes.codes.find((c) => c.conceptId === '419076005');
  check(
    !!allergicReaction &&
      allergicReaction.description === 'Allergic reaction' &&
      allergicReaction.category === 'too-generic',
    '419076005 "Allergic reaction" is present, category too-generic'
  );
  const pollen = allergyJunkCodes.codes.find((c) => c.conceptId === '300910009');
  check(
    !!pollen && pollen.description === 'Allergy to pollen' && pollen.category === 'low-prescribing-relevance',
    '300910009 "Allergy to pollen" is present, category low-prescribing-relevance (added 2026-08-02)'
  );
  check(
    typeof pollen.caution === 'string' && /hay fever/.test(pollen.caution),
    'the pollen entry carries a static per-code caution string mentioning hay fever'
  );
}

console.log('--- findJunkCodeEntry: exact conceptId match only ---');
{
  const entry = findJunkCodeEntry('716186003', allergyJunkCodes.codes);
  check(!!entry && entry.description === 'No known allergies', 'a configured conceptId resolves to its entry');
  check(findJunkCodeEntry('12345', allergyJunkCodes.codes) === null, 'an unconfigured conceptId -> null');
  check(findJunkCodeEntry(null, allergyJunkCodes.codes) === null, 'null conceptId -> null, never throws');
  check(findJunkCodeEntry('716186003', null) === null, 'null junkCodes -> null, never throws');
  check(findJunkCodeEntry('716186003', []) === null, 'empty junkCodes -> null');
  check(
    findJunkCodeEntry('716186003', [null, undefined, { conceptId: '716186003', description: 'x' }]).description === 'x',
    'malformed entries in the list are skipped, not fatal'
  );
}

console.log('--- resolveAllergyConceptId: real overview-allergy response shapes ---');
{
  check(
    resolveAllergyConceptId({
      allergyCode: { conceptId: '294505008', description: 'Amoxicillin allergy', descriptionId: '2476309016' },
      substance: null,
    }) === '294505008',
    'pre-defined-allergies type: reads allergyCode.conceptId (real "Amoxicillin allergy" capture)'
  );
  check(
    resolveAllergyConceptId({
      allergyCode: null,
      substance: { conceptId: '774586009', description: 'Amoxicillin', descriptionId: '2820561000001116' },
    }) === '774586009',
    'substances type: reads substance.conceptId when allergyCode is null'
  );
  check(
    resolveAllergyConceptId({
      allergyCode: { conceptId: '716186003', description: 'No known allergies', descriptionId: null },
      substance: null,
    }) === '716186003',
    'real "No known allergies" capture resolves correctly'
  );
  check(resolveAllergyConceptId({ allergyCode: null, substance: null }) === null, 'neither populated -> null');
  check(resolveAllergyConceptId(null) === null, 'null overview -> null, never throws');
  check(resolveAllergyConceptId(undefined) === null, 'undefined overview -> null, never throws');

  // Real HAR46 capture, 2026-08-02: a GP2GP-imported entry with BOTH fields
  // populated -- allergyCodeType says which one is actually authoritative.
  const dualCoded = {
    allergyCode: { conceptId: '292954005', description: 'ALLERGY PENICILLIN', descriptionId: null },
    substance: { conceptId: '153075001000027106', description: 'Penicillin V 250mg capsule', descriptionId: null },
    allergyCodeType: 'substances',
  };
  check(
    resolveAllergyConceptId(dualCoded) === '153075001000027106',
    'real HAR46 dual-coded capture: allergyCodeType "substances" wins even though allergyCode is ALSO populated -- ' +
      'the old behaviour would have wrongly returned the stale legacy code here'
  );
  const dualCodedPreDefined = Object.assign({}, dualCoded, { allergyCodeType: 'pre-defined-allergies' });
  check(
    resolveAllergyConceptId(dualCodedPreDefined) === '292954005',
    'the same dual-coded shape resolves to allergyCode instead when allergyCodeType says pre-defined-allergies is authoritative'
  );
  const dualCodedNoType = { allergyCode: { conceptId: '1' }, substance: { conceptId: '2' } };
  check(
    resolveAllergyConceptId(dualCodedNoType) === '1',
    'both populated but no allergyCodeType to disambiguate -> falls back to allergyCode, unchanged prior behaviour'
  );
}

console.log('--- hasBothCodeTypes / classifyDualCodedEntries: real HAR46 "legacy code alongside substance" case ---');
{
  const overview = {
    allergyCode: { conceptId: '292954005', description: 'ALLERGY PENICILLIN', descriptionId: null },
    substance: { conceptId: '153075001000027106', description: 'Penicillin V 250mg capsule', descriptionId: null },
    allergyCodeType: 'substances',
  };
  check(hasBothCodeTypes(overview) === true, 'the real HAR46 shape is detected as dual-coded');
  check(
    hasBothCodeTypes({ allergyCode: { conceptId: '1' }, substance: null }) === false,
    'only allergyCode populated -> not dual-coded'
  );
  check(
    hasBothCodeTypes({ allergyCode: null, substance: { conceptId: '1' } }) === false,
    'only substance populated -> not dual-coded'
  );
  check(hasBothCodeTypes(null) === false, 'null overview -> false, never throws');

  const candidates = [
    { id: 'penicillin-both', allergyCodeDescription: 'ALLERGY PENICILLIN', isDraft: false },
    { id: 'normal-entry', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'junk-entry', allergyCodeDescription: 'No known allergies', isDraft: false },
  ];
  const overviewsById = {
    'penicillin-both': overview,
    'normal-entry': { allergyCode: null, substance: { conceptId: '774586009' }, allergyCodeType: 'substances' },
    'junk-entry': overview, // pathological: same dual-coded shape, but excluded as junk below
  };
  const flagged = classifyDualCodedEntries(candidates, overviewsById, new Set(['junk-entry']));
  check(flagged.length === 1, 'only the genuinely dual-coded, non-junk-excluded entry is flagged');
  check(
    flagged[0].legacyCode.conceptId === '292954005' && flagged[0].substance.conceptId === '153075001000027106',
    'the flagged entry carries both the legacy code and the current substance for display'
  );
  check(flagged[0].authoritative === 'substances', 'the authoritative allergyCodeType is carried through too');
  check(classifyDualCodedEntries([], {}, new Set()).length === 0, 'no candidates -> no flags');
  check(classifyDualCodedEntries(null, {}, new Set()).length === 0, 'null candidates -> no flags, never throws');
}

console.log('--- buildClearLegacyCodePayload: real HAR46 shape, only the stale field is ever nulled ---');
{
  const prefill = {
    allergyCode: { label: 'ALLERGY PENICILLIN', value: { conceptId: '292954005', description: 'ALLERGY PENICILLIN' } },
    substance: {
      label: 'Penicillin V 250mg capsule',
      value: { conceptId: '153075001000027106', description: 'Penicillin V 250mg capsule' },
    },
    allergyCodeType: 'substances',
    additionalInformation: null,
    severity: 'Moderate',
    certainty: 'Certain',
    allergyReactions: [],
    onsetDate: null,
    recordDate: '1990-11-09',
    recordedAtAnotherOrganisation: false,
    recordedByStaff: null,
    linkedProblemIds: [],
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    endDate: null,
    linkedClinicalCase: null,
  };
  const payload = buildClearLegacyCodePayload(prefill);
  check(payload.allergyCode === null, 'the stale legacy allergyCode is cleared');
  check(
    payload.substance && payload.substance.conceptId === '153075001000027106',
    'the already-authoritative substance is unwrapped and kept, unchanged'
  );
  check(payload.allergyCodeType === 'substances', 'allergyCodeType itself is untouched');
  check(
    payload.severity === 'Moderate' && payload.certainty === 'Certain' && payload.recordDate === '1990-11-09',
    'every clinical/provenance field passes through completely unchanged -- this only ever nulls the one stale field'
  );

  const prefillOtherWay = Object.assign({}, prefill, { allergyCodeType: 'pre-defined-allergies' });
  const payloadOtherWay = buildClearLegacyCodePayload(prefillOtherWay);
  check(
    payloadOtherWay.substance === null &&
      payloadOtherWay.allergyCode &&
      payloadOtherWay.allergyCode.conceptId === '292954005',
    'symmetric case: when pre-defined-allergies is authoritative instead, the stale SUBSTANCE is cleared and allergyCode is kept'
  );
}

console.log('--- buildEndAllergyPayload: matches the real captured end-allergy POST body ---');
{
  const payload = buildEndAllergyPayload(
    '0192356d-11e7-729c-9e24-bcd54e9781df',
    '2026-07-29',
    'this is not an allergy'
  );
  check(
    payload.allergyId === '0192356d-11e7-729c-9e24-bcd54e9781df' &&
      payload.endDate === '2026-07-29' &&
      payload.reasonEnded === 'this is not an allergy',
    'matches the real captured payload shape exactly: {allergyId, endDate, reasonEnded}'
  );
  check(
    !('recordedByOrganisation' in payload) && !('patientId' in payload),
    'no recordedByOrganisation or patientId field — this endpoint never needs them, unlike change-allergy'
  );
  check(
    buildEndAllergyPayload('id-1', '2026-07-29', undefined).reasonEnded === null,
    'a missing reasonEnded falls back to null'
  );
  check(
    buildEndAllergyPayload('id-1', '2026-07-29', '').reasonEnded === null,
    'an empty-string reasonEnded also falls back to null'
  );
  const mergePayload = buildEndAllergyPayload('019fae65-0843-7240-bbf1-83ffcf8d24ed', '2026-07-29', MERGE_REASON_ENDED);
  check(
    mergePayload.reasonEnded === MERGE_REASON_ENDED,
    'the same builder is used for merged-away duplicates, always with the fixed merge reason'
  );
}

console.log('--- isEndable ---');
{
  check(isEndable({ ended: false }) === true, 'not yet ended -> endable');
  check(isEndable({ ended: true }) === false, 'already ended -> not endable');
  check(isEndable(null) === false, 'null entry -> not endable, never throws');
  check(isEndable(undefined) === false, 'undefined entry -> not endable, never throws');
}

console.log('--- reactionDescriptions: real overview-allergy allergyReactions shapes ---');
{
  check(
    reactionDescriptions({ allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }] })[0] ===
      'Anaphylaxis',
    'real "Anaphylaxis" capture resolves to its description'
  );
  check(
    reactionDescriptions({
      allergyReactions: [
        { conceptId: '39579001', description: 'Anaphylaxis' },
        { conceptId: '271807003', description: 'Skin rash' },
      ],
    }).join(',') === 'Anaphylaxis,Skin rash',
    'multiple reactions are all returned, in order'
  );
  check(
    reactionDescriptions({ allergyReactions: [] }).length === 0,
    'real "No known allergies" capture (empty array) -> empty list'
  );
  check(reactionDescriptions(null).length === 0, 'null overview -> empty list, never throws');
  check(
    reactionDescriptions({ allergyReactions: [{ conceptId: '1' }, { conceptId: '2', description: 'Rash' }] }).length ===
      1,
    'a reaction entry with no description is skipped, not a blank string'
  );
}

console.log('--- buildCautionMessage: catches a genuine allergy recorded under a junk code ---');
{
  check(
    buildCautionMessage({ severity: null, certainty: null, additionalInformation: null, allergyReactions: [] }) ===
      null,
    'the expected case (real "No known allergies" capture: all four blank/empty) -> no caution'
  );
  check(
    buildCautionMessage({ severity: 'Severe', certainty: null, additionalInformation: null, allergyReactions: [] }) !==
      null,
    'severity alone populated -> cautioned'
  );
  check(
    buildCautionMessage({ severity: null, certainty: 'Likely', additionalInformation: null, allergyReactions: [] }) !==
      null,
    'certainty alone populated -> cautioned'
  );
  check(
    buildCautionMessage({
      severity: null,
      certainty: null,
      additionalInformation: 'reacted with hives',
      allergyReactions: [],
    }) !== null,
    'additionalInformation alone populated -> cautioned'
  );
  check(
    buildCautionMessage({
      severity: null,
      certainty: null,
      additionalInformation: null,
      allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }],
    }) !== null,
    'a coded reaction ALONE -> cautioned, even with everything else blank'
  );
  check(
    /reaction: Anaphylaxis/.test(
      buildCautionMessage({
        severity: null,
        certainty: null,
        additionalInformation: null,
        allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }],
      })
    ),
    'the message names the actual reaction(s), not just "reaction recorded"'
  );
  var fullMsg = buildCautionMessage({
    severity: 'Severe',
    certainty: 'Likely',
    additionalInformation: null,
    allergyReactions: [],
  });
  check(
    /severity: Severe/.test(fullMsg) && /certainty: Likely/.test(fullMsg),
    'the message names WHICH field(s) triggered it'
  );
  check(
    buildCautionMessage({ severity: null, certainty: null, additionalInformation: '   ', allergyReactions: [] }) ===
      null,
    'whitespace-only additionalInformation does not count as populated'
  );
  check(buildCautionMessage(null) === null, 'null overview -> null, never throws');
  check(buildCautionMessage({}) === null, 'empty overview object -> null');
}

console.log(
  '--- combinedCaution: per-CODE static caution (e.g. "low-prescribing-relevance") vs per-INSTANCE clinical detail ---'
);
{
  const pollenJunkEntry = {
    conceptId: '300910009',
    caution: 'This code indicates hay fever, so may be more appropriate as a problem code rather than an allergy.',
  };
  const emptyOverview = { severity: null, certainty: null, additionalInformation: null, allergyReactions: [] };
  check(
    combinedCaution(pollenJunkEntry, emptyOverview) === pollenJunkEntry.caution,
    'a per-code caution fires even with a completely empty overview — ALWAYS shown, unlike the per-instance signal'
  );
  const detailedOverview = { severity: 'Mild', certainty: null, additionalInformation: null, allergyReactions: [] };
  check(
    combinedCaution(pollenJunkEntry, detailedOverview) === pollenJunkEntry.caution,
    'a per-code caution WINS outright when instance detail is ALSO present -- never concatenated with the generic ' +
      'per-instance message, which is specific to the too-generic use case and would be actively wrong here ' +
      '(this code is a genuine, precisely-coded allergy already -- "may be a genuine allergy" does not apply)'
  );
  const plainJunkEntry = { conceptId: '419076005' }; // no `caution` field, e.g. "too-generic" entries
  check(
    combinedCaution(plainJunkEntry, emptyOverview) === null,
    'a junk entry with no per-code caution and no instance detail -> no caution at all'
  );
  check(
    combinedCaution(plainJunkEntry, detailedOverview) === buildCautionMessage(detailedOverview),
    'a junk entry with no per-code caution falls back to the per-instance signal alone, unchanged from before'
  );
  check(combinedCaution(null, emptyOverview) === null, 'null junkEntry -> falls back to instance-only, never throws');
}

console.log(
  '--- classifyJunkEntries: real scenario — "Allergy to pollen" is ALWAYS cautioned, even with nothing else recorded ---'
);
{
  const candidates = [{ id: 'pollen-entry', allergyCodeDescription: 'Allergy to pollen', isDraft: false }];
  const overviewsById = {
    'pollen-entry': {
      allergyCode: { conceptId: '300910009', description: 'Allergy to pollen', descriptionId: null },
      substance: null,
      additionalInformation: null,
      severity: null,
      certainty: null,
      allergyReactions: [],
    },
  };
  const flagged = classifyJunkEntries(candidates, overviewsById, allergyJunkCodes.codes);
  check(flagged.length === 1, '300910009 is matched against the junk-codes list');
  check(
    flagged[0].caution !== null && /hay fever/.test(flagged[0].caution),
    'flagged with its static per-code caution even though this instance carries no clinical detail at all — ' +
      'unlike "too-generic" entries, this is never bulk-safe regardless of what\'s attached'
  );
}
{
  // Real live case, 2026-08-02: a patient's "Allergy to pollen" entry ALSO
  // had additionalInformation: "Hay fever" -- before the fix, the row showed
  // reasonEnded, then "Additional info: Hay fever", then a caution that
  // restated hay fever a THIRD time and wrongly implied the code itself
  // might be hiding a different real allergen ("may be a genuine allergy
  // filed under this code, not import noise").
  const candidates = [{ id: 'pollen-with-detail', allergyCodeDescription: 'Allergy to pollen', isDraft: false }];
  const overviewsById = {
    'pollen-with-detail': {
      allergyCode: { conceptId: '300910009', description: 'Allergy to pollen', descriptionId: null },
      substance: null,
      additionalInformation: 'Hay fever',
      severity: null,
      certainty: null,
      allergyReactions: [],
    },
  };
  const flagged = classifyJunkEntries(candidates, overviewsById, allergyJunkCodes.codes);
  const pollenEntry = allergyJunkCodes.codes.find((c) => c.conceptId === '300910009');
  check(
    flagged[0].caution === pollenEntry.caution,
    'the caution shown is EXACTLY the per-code message, not padded with the generic per-instance sentence, even ' +
      'though this real patient also had matching additionalInformation'
  );
}

console.log('--- normalizeAllergyDescription ---');
{
  check(normalizeAllergyDescription('Amoxicillin') === 'amoxicillin', 'lowercased');
  check(normalizeAllergyDescription('  Amoxicillin  ') === 'amoxicillin', 'trimmed');
  check(normalizeAllergyDescription(null) === '', 'null -> empty string, never throws');
  check(normalizeAllergyDescription(undefined) === '', 'undefined -> empty string, never throws');
}

console.log('--- activeNonDraftAllergies: narrows the cheap clinical-summary/summary list ---');
{
  const raw = [
    { id: 'a1', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'a2', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: 'a3', allergyCodeDescription: 'Draft entry', isDraft: true },
    null,
    { id: '', allergyCodeDescription: 'No id', isDraft: false },
  ];
  const result = activeNonDraftAllergies(raw);
  check(result.length === 2, 'draft, null, and id-less entries are excluded');
  check(
    result.every((a) => a.id === 'a1' || a.id === 'a2'),
    'only the two genuine active entries survive'
  );
  check(activeNonDraftAllergies(null).length === 0, 'null allergies -> empty array, never throws');
  check(activeNonDraftAllergies([]).length === 0, 'empty allergies -> empty array');
}

console.log('--- classifyJunkEntries: real 2026-07-29 patient scenario, 5 duplicate "No known allergies" entries ---');
{
  // Real capture, HAR 33: a patient's clinical-summary/summary allergies[]
  // held FIVE identical "No known allergies" entries, all active/non-draft.
  const fiveInARow = [
    { id: '0192356d-11e7-729c-9e24-bcd54e9781df', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: '0192356d-1243-703e-8b79-a3cfdb98ba37', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: '0192356d-13bf-7392-a214-1f5942e56556', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: '0192356d-143a-7228-b34d-6d3a1b7cd615', allergyCodeDescription: 'No known allergies', isDraft: false },
    { id: '0192356d-164f-71f8-81bd-ed1cc13968d6', allergyCodeDescription: 'No known allergies', isDraft: false },
  ];
  const candidates = activeNonDraftAllergies(fiveInARow);
  const overviewsById = {};
  candidates.forEach((c) => {
    overviewsById[c.id] = {
      allergyCode: { conceptId: '716186003', description: 'No known allergies', descriptionId: null },
      substance: null,
      additionalInformation: null,
      severity: null,
      certainty: null,
      allergyReactions: [],
    };
  });
  const flagged = classifyJunkEntries(candidates, overviewsById, allergyJunkCodes.codes);
  check(flagged.length === 5, 'every one of the five real duplicate entries is flagged for bulk-end');
  check(
    flagged.every((f) => f.conceptId === '716186003' && f.caution === null),
    'all five resolve to the correct conceptId and carry no caution (genuinely empty junk)'
  );
  check(
    flagged.every((f) => typeof f.reasonEnded === 'string' && f.reasonEnded.length > 0),
    'each flagged entry carries the configured reasonEnded, ready to POST'
  );
}

console.log(
  '--- classifyJunkEntries: too-generic codes, real peanut-allergy example — flagged, but caution-protected ---'
);
{
  // Real motivating case: a genuine peanut allergy coded under 419076005
  // "Allergic reaction" with the actual allergen recorded only as free-text
  // "peanut" in additionalInformation.
  const candidates = [{ id: 'peanut-entry', allergyCodeDescription: 'Allergic reaction', isDraft: false }];
  const overviewsById = {
    'peanut-entry': {
      allergyCode: { conceptId: '419076005', description: 'Allergic reaction', descriptionId: null },
      substance: null,
      additionalInformation: 'peanut',
      severity: null,
      certainty: null,
      allergyReactions: [],
    },
  };
  const flagged = classifyJunkEntries(candidates, overviewsById, allergyJunkCodes.codes);
  check(flagged.length === 1, '419076005 IS matched against the junk-codes list (it is too generic on its own)');
  check(
    flagged[0].caution !== null && /additional info recorded/.test(flagged[0].caution),
    'but the flagged entry carries a caution from the "peanut" free text — never silently bulk-endable'
  );
}
{
  // Contrast case: the SAME too-generic code with genuinely nothing else
  // attached — this one IS safe to offer for bulk-end.
  const candidates = [{ id: 'atopy-entry', allergyCodeDescription: 'Atopy', isDraft: false }];
  const overviewsById = {
    'atopy-entry': {
      allergyCode: { conceptId: '115665000', description: 'Atopy', descriptionId: null },
      substance: null,
      additionalInformation: null,
      severity: null,
      certainty: null,
      allergyReactions: [],
    },
  };
  const flagged = classifyJunkEntries(candidates, overviewsById, allergyJunkCodes.codes);
  check(
    flagged.length === 1 && flagged[0].caution === null,
    'a genuinely empty "Atopy" entry is flagged with no caution — safe for "Select all"'
  );
}
{
  check(classifyJunkEntries([], {}, allergyJunkCodes.codes).length === 0, 'no candidates -> no flags');
  check(
    classifyJunkEntries(null, {}, allergyJunkCodes.codes).length === 0,
    'null candidates -> no flags, never throws'
  );
  const nonJunk = [{ id: 'x', allergyCodeDescription: 'Amoxicillin', isDraft: false }];
  check(
    classifyJunkEntries(nonJunk, { x: { allergyCode: { conceptId: '774586009' } } }, allergyJunkCodes.codes).length ===
      0,
    'a genuine allergy (not on the junk list) is never flagged'
  );
}

console.log('--- rules/allergy-substance-conversion.json: the imported entries list itself ---');
{
  check(Array.isArray(allergySubstanceConversion.entries), 'entries is an array');
  check(
    allergySubstanceConversion.entries.length === 314,
    'exactly 314 reviewed legacy codes are configured (got ' + allergySubstanceConversion.entries.length + ')'
  );
  const ids = allergySubstanceConversion.entries.map((e) => e.conceptId);
  check(new Set(ids).size === ids.length, 'no duplicate conceptIds');
  check(
    !allergySubstanceConversion.entries.some((e) => e.conceptId === '416098002'),
    '"Medicine allergy" (416098002) is deliberately excluded -- belongs on allergy-junk-codes.json instead'
  );
  const chloroquine = allergySubstanceConversion.entries.find((e) => e.conceptId === '312958000');
  check(
    !!chloroquine &&
      chloroquine.kind === 'substance-plus-reaction' &&
      chloroquine.substance.conceptId === '775187003' &&
      chloroquine.reaction.text === 'retinopathy',
    '312958000 "Chloroquine retinopathy" decomposes to substance 775187003 + reaction hint "retinopathy"'
  );
  const sulpha = allergySubstanceConversion.entries.find((e) => e.conceptId === '91939003');
  check(
    !!sulpha && sulpha.kind === 'not-convertible' && sulpha.substance === null,
    '91939003 "Allergy to sulpha drugs" is not-convertible, no substance'
  );
  const glutenEnteropathy = allergySubstanceConversion.entries.find((e) => e.conceptId === '91867008');
  check(
    !!glutenEnteropathy && glutenEnteropathy.kind === 'not-an-allergy' && /coeliac/i.test(glutenEnteropathy.notes),
    '91867008 "Adult gluten-induced enteropathy" is not-an-allergy, notes explain why'
  );
  check(
    !allergySubstanceConversion.entries.some((e) => e.conceptId === '294505008'),
    '"Amoxicillin allergy" (294505008) was never in the reviewed sweep -- correctly absent, falls to manual search'
  );
}

console.log('--- findConversionRule: exact conceptId match only ---');
{
  const rule = findConversionRule('312958000', allergySubstanceConversion.entries);
  check(!!rule && rule.description === 'Chloroquine retinopathy', 'a configured conceptId resolves to its entry');
  check(
    findConversionRule('294505008', allergySubstanceConversion.entries) === null,
    'an unconfigured conceptId -> null (falls to manual search)'
  );
  check(findConversionRule(null, allergySubstanceConversion.entries) === null, 'null conceptId -> null, never throws');
  check(findConversionRule('312958000', null) === null, 'null rules -> null, never throws');
}

console.log('--- classifyConvertibleEntries: pre-defined-allergy detection, junk-exclusion, rule lookup ---');
{
  const candidates = [
    { id: 'amox', allergyCodeDescription: 'Amoxicillin allergy', isDraft: false },
    { id: 'chloroquine-entry', allergyCodeDescription: 'Chloroquine retinopathy', isDraft: false },
    { id: 'already-substance', allergyCodeDescription: 'Amoxicillin', isDraft: false },
    { id: 'junk-entry', allergyCodeDescription: 'No known allergies', isDraft: false },
  ];
  const overviewsById = {
    amox: { allergyCodeType: 'pre-defined-allergies', allergyCode: { conceptId: '294505008' } },
    'chloroquine-entry': { allergyCodeType: 'pre-defined-allergies', allergyCode: { conceptId: '312958000' } },
    'already-substance': { allergyCodeType: 'substances', substance: { conceptId: '774586009' } },
    'junk-entry': { allergyCodeType: 'pre-defined-allergies', allergyCode: { conceptId: '716186003' } },
  };
  const junkIds = new Set(['junk-entry']);
  const flagged = classifyConvertibleEntries(candidates, overviewsById, allergySubstanceConversion.entries, junkIds);
  check(
    flagged.length === 2,
    'only the two genuine pre-defined-allergy, non-junk entries are flagged (got ' + flagged.length + ')'
  );
  check(
    !flagged.some((f) => f.id === 'already-substance'),
    'an already substance-coded entry (allergyCodeType: "substances") is never flagged as convertible'
  );
  check(
    !flagged.some((f) => f.id === 'junk-entry'),
    'a junk-flagged entry is excluded even though it IS pre-defined-allergies type'
  );
  const amoxFlag = flagged.find((f) => f.id === 'amox');
  check(
    !!amoxFlag && amoxFlag.rule === null,
    '"Amoxicillin allergy" has no rules-file entry -> rule: null, manual search only'
  );
  const chloroquineFlag = flagged.find((f) => f.id === 'chloroquine-entry');
  check(
    !!chloroquineFlag && chloroquineFlag.rule && chloroquineFlag.rule.kind === 'substance-plus-reaction',
    '"Chloroquine retinopathy" resolves its full rule, including kind'
  );
  check(classifyConvertibleEntries([], {}, [], new Set()).length === 0, 'no candidates -> no flags');
  check(classifyConvertibleEntries(null, {}, [], new Set()).length === 0, 'null candidates -> no flags, never throws');
}

console.log('--- normalizedConceptSearchResults: real SNOMED constrained-search response shape ---');
{
  const raw = [
    {
      value: {
        conceptId: 774586009,
        description: 'Amoxicillin',
        descriptionId: '2820561000001116',
        parentConceptIds: [419199007],
      },
    },
    { value: { conceptId: '774586009', description: 'Amoxicillin', descriptionId: '2820561000001116' } }, // dup
    { value: { conceptId: '42357111000001105', description: 'Amoxicillin 250mg capsules' } }, // no descriptionId
    { value: {} }, // malformed -- no conceptId
    null,
  ];
  const results = normalizedConceptSearchResults(raw);
  check(
    results.length === 2,
    'deduped by descriptionId, malformed/no-conceptId entries dropped (got ' + results.length + ')'
  );
  check(
    results[0].conceptId === '774586009' && typeof results[0].conceptId === 'string',
    'conceptId coerced to string'
  );
  check(results[1].descriptionId === null, 'a result with no descriptionId at all falls back to null, not undefined');
  check(
    results[0].parentConceptIds.length === 1 && results[0].parentConceptIds[0] === '419199007',
    'parentConceptIds carried through and coerced to strings (from outputParentConceptIds=1, no extra fetch needed)'
  );
  check(
    Array.isArray(results[1].parentConceptIds) && results[1].parentConceptIds.length === 0,
    'a result with no parentConceptIds at all falls back to an empty array, never undefined'
  );
  check(normalizedConceptSearchResults([]).length === 0, 'empty results -> empty array');
  check(normalizedConceptSearchResults(null).length === 0, 'null results -> empty array, never throws');
}

console.log(
  '--- rankSubstanceResults: reorders toward the VTM candidate without discarding anything (real 2026-08-02 "iodine" case) ---'
);
{
  // Shape modelled on the real live gap: an "iodine" search returned the
  // correct VTM-ish candidate, just not first -- buried among salt/dose
  // -specific siblings.
  const iodineResults = [
    { conceptId: '387100002', description: 'Iodine tincture 2.5% cutaneous solution', parentConceptIds: [] },
    { conceptId: '77340008', description: 'Iodine', parentConceptIds: [] }, // exact match, plain, 77-prefixed
    { conceptId: '12345678901', description: 'Potassium iodide', parentConceptIds: ['77340008'] }, // child of the VTM
  ];
  const ranked = rankSubstanceResults(iodineResults, 'iodine');
  check(ranked.length === 3, 'nothing is discarded, only reordered');
  check(
    ranked[0].conceptId === '77340008',
    'the exact-match, plain-named, 77-prefixed, ancestor-of-a-sibling candidate ranks first (got ' +
      ranked.map((r) => r.conceptId).join(', ') +
      ')'
  );
  check(
    ranked.some((r) => r.conceptId === '387100002') && ranked.some((r) => r.conceptId === '12345678901'),
    'the dose-specific and child candidates are still present, just ranked lower'
  );

  // A result with NO siblings at all (single candidate) should still rank
  // fine on exact-match + plain-name alone -- ancestor-of-sibling can never
  // fire with only one result.
  const solo = rankSubstanceResults(
    [{ conceptId: '1', description: 'Amoxicillin', parentConceptIds: [] }],
    'Amoxicillin'
  );
  check(solo.length === 1 && solo[0].conceptId === '1', 'a single-result search is returned unchanged');

  check(rankSubstanceResults([], 'x').length === 0, 'empty results -> empty array');
  check(rankSubstanceResults(null, 'x').length === 0, 'null results -> empty array, never throws');
}

console.log('--- pickReactionSeed: priority order (rule hint > pattern hint > additionalInformation) ---');
{
  check(
    pickReactionSeed('retinopathy', 'contact dermatitis', 'shivering') === 'retinopathy',
    'a curated rule hint always wins when present'
  );
  check(
    pickReactionSeed(null, 'contact dermatitis', 'shivering') === 'contact dermatitis',
    'falls to the pattern-extracted hint when there is no rule hint'
  );
  check(
    pickReactionSeed(null, null, 'shivering') === 'shivering',
    "real 2026-08-02 case: falls all the way to the patient's own additionalInformation as a last resort -- " +
      '"Adverse reaction to iodine" has no rule or pattern reaction hint, but additionalInformation literally said "shivering"'
  );
  check(pickReactionSeed(null, null, null) === '', 'nothing available anywhere -> empty string, never null/undefined');
  check(pickReactionSeed('  ', '  ', 'shivering') === 'shivering', 'whitespace-only hints are treated as absent');
  check(pickReactionSeed(undefined, undefined, undefined) === '', 'all undefined -> empty string, never throws');
}

console.log(
  '--- extractAllergenAndReactionHint: real 2026-08-02 live-testing examples, none of which are in the rules file ---'
);
{
  check(
    !allergySubstanceConversion.entries.some((e) => /elastoplast|iodine/i.test(e.description)),
    'sanity check: none of these examples are actually in the reviewed rules file (confirms the fallback path is what matters here)'
  );
  const elastoplast = extractAllergenAndReactionHint('Elastoplast contact dermatitis');
  check(
    elastoplast.substanceHint === 'Elastoplast' && elastoplast.reactionHint === 'contact dermatitis',
    'bare-juxtaposition fallback splits "Elastoplast contact dermatitis" into allergen + reaction correctly (got ' +
      JSON.stringify(elastoplast) +
      ')'
  );
  const iodine = extractAllergenAndReactionHint('Adverse reaction to iodine');
  check(
    iodine.substanceHint === 'iodine' && iodine.reactionHint === null,
    '"Adverse reaction to X" strips to the allergen alone, no specific reaction guessed (got ' +
      JSON.stringify(iodine) +
      ')'
  );
  const cat = extractAllergenAndReactionHint('Cat allergy');
  check(
    cat.substanceHint === 'Cat' && cat.reactionHint === null,
    '"X allergy" strips the suffix, no reaction guessed (got ' + JSON.stringify(cat) + ')'
  );
  const shellfish = extractAllergenAndReactionHint('Shellfish allergy');
  check(
    shellfish.substanceHint === 'Shellfish' && shellfish.reactionHint === null,
    '"Shellfish allergy" -> "Shellfish"'
  );
  const chloroquine = extractAllergenAndReactionHint('Chloroquine retinopathy');
  check(
    chloroquine.substanceHint === 'Chloroquine' && chloroquine.reactionHint === 'retinopathy',
    'bare juxtaposition matches the ACTUAL reviewed answer for this real code (312958000, in the rules file) -- a ' +
      'good cross-check that the heuristic is reasonable, not just a coincidence for the live examples above'
  );
  const induced = extractAllergenAndReactionHint('Allopurinol-induced DRESS syndrome');
  check(
    induced.substanceHint === 'Allopurinol' && induced.reactionHint === 'DRESS syndrome',
    '"X-induced Y" splits on the hyphen, not the bare-juxtaposition fallback'
  );
  const allergyTo = extractAllergenAndReactionHint('Allergy to penicillin');
  check(
    allergyTo.substanceHint === 'penicillin' && allergyTo.reactionHint === null,
    '"Allergy to X" strips the prefix'
  );
  const single = extractAllergenAndReactionHint('Atopy');
  check(
    single.substanceHint === 'Atopy' && single.reactionHint === null,
    'a single word with nothing to split -> passed through as-is, no reaction guessed'
  );
  check(
    extractAllergenAndReactionHint('').substanceHint === '' && extractAllergenAndReactionHint('').reactionHint === null,
    'empty description -> empty hint, never throws'
  );
  check(extractAllergenAndReactionHint(null).substanceHint === '', 'null description -> empty hint, never throws');
}

console.log('--- buildAllergyProvenanceFields: shared passthrough used by BOTH payload builders ---');
{
  const prefillOwnStaff = {
    recordedAtAnotherOrganisation: false,
    recordedByStaff: '0192351f-fd60-711f-bf55-176f0c1e5f1b',
    recordedByOrganisation: null,
    recordedByPractitioner: null,
    recordDate: '2024-11-08',
    endDate: null,
    linkedProblemIds: [],
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    linkedClinicalCase: { defaultClinicalCaseId: null },
  };
  const fields = buildAllergyProvenanceFields(prefillOwnStaff);
  check(fields.recordedByStaff === '0192351f-fd60-711f-bf55-176f0c1e5f1b', 'recordedByStaff carried through');
  check(
    !('recordedByOrganisation' in fields),
    'recordedByOrganisation NOT set when recordedAtAnotherOrganisation is false'
  );
  check(fields.recordDate === '2024-11-08', 'recordDate carried through');

  const prefillBlankOrg = Object.assign({}, prefillOwnStaff, {
    recordedAtAnotherOrganisation: true,
    recordedByStaff: null,
    recordedByPractitioner: 'Mrs Patricia Day',
  });
  const blankOrgFields = buildAllergyProvenanceFields(prefillBlankOrg);
  check(
    blankOrgFields.recordedByOrganisation && blankOrgFields.recordedByOrganisation.organisationName === 'Unknown',
    'a genuinely blank recordedByOrganisation falls back to "Unknown", not a guess'
  );
  check(!('recordedByStaff' in blankOrgFields), 'recordedByStaff NOT set when recordedAtAnotherOrganisation is true');
}

console.log('--- buildConversionChangeAllergyPayload: the OPPOSITE invariant to buildMergeChangeAllergyPayload ---');
{
  const prefill = {
    allergyCode: {
      label: 'Amoxicillin allergy',
      value: { conceptId: '294505008', description: 'Amoxicillin allergy' },
    },
    substance: null,
    additionalInformation: 'reacted with hives',
    severity: 'severe',
    certainty: 'certain',
    allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }],
    onsetDate: '2001-01-01',
    allergyCodeType: 'pre-defined-allergies',
    linkedProblemIds: [],
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: false,
    endDate: null,
    recordedAtAnotherOrganisation: false,
    recordDate: '2024-11-08',
    recordedByStaff: '0192351f-fd60-711f-bf55-176f0c1e5f1b',
    linkedClinicalCase: { defaultClinicalCaseId: null },
  };
  const newSubstance = { conceptId: '774586009', description: 'Amoxicillin', descriptionId: '2820561000001116' };
  const payload = buildConversionChangeAllergyPayload(prefill, newSubstance, null);
  check(payload.allergyCode === null, 'allergyCode is always null after conversion');
  check(payload.substance === newSubstance, 'substance is the picked concept');
  check(payload.allergyCodeType === 'substances', 'allergyCodeType is always "substances" after conversion');
  check(
    payload.severity === 'severe' &&
      payload.certainty === 'certain' &&
      payload.additionalInformation === 'reacted with hives',
    'clinical fields carried through UNCHANGED from the prefill -- conversion never edits them'
  );
  check(
    payload.allergyReactions.length === 1 && payload.allergyReactions[0].description === 'Anaphylaxis',
    'existing reactions carried through unchanged when no new reaction is picked'
  );
  check(payload.recordDate === '2024-11-08', 'provenance carried through via the shared helper');

  const newReaction = { conceptId: '29555009', description: 'Retinopathy', descriptionId: '123' };
  const withReaction = buildConversionChangeAllergyPayload(prefill, newSubstance, [newReaction]);
  check(
    withReaction.allergyReactions.length === 1 && withReaction.allergyReactions[0] === newReaction,
    'a picked reaction REPLACES the prefill reactions entirely (decompose case), not appended'
  );
  check(
    withReaction.severity === 'severe',
    'severity/certainty still untouched even when a reaction IS picked -- only allergyCode/substance/allergyCodeType/allergyReactions ever change'
  );

  const shivering = { conceptId: '73453007', description: 'Shivering', descriptionId: '1' };
  const bradycardia = { conceptId: '48867003', description: 'Bradycardia', descriptionId: '2' };
  const withTwoReactions = buildConversionChangeAllergyPayload(prefill, newSubstance, [shivering, bradycardia]);
  check(
    withTwoReactions.allergyReactions.length === 2 &&
      withTwoReactions.allergyReactions[0] === shivering &&
      withTwoReactions.allergyReactions[1] === bradycardia,
    'MULTIPLE picked reactions are all carried through, in order -- a real allergy can have more than one distinct reaction'
  );
  check(
    buildConversionChangeAllergyPayload(prefill, newSubstance, []).allergyReactions.length === 1,
    'an empty reactions array behaves exactly like none picked -- falls back to the prefill reactions unchanged'
  );
  check(
    buildConversionChangeAllergyPayload(prefill, newSubstance, null).allergyReactions.length === 1,
    'null newReactions -> falls back to the prefill reactions unchanged, never throws'
  );
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
}
{
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

console.log(
  '--- isSameAllergenConcept: real 2026-07-30 termbrowser investigation (peanut vs peanut-anaphylaxis vs arachis oil) ---'
);
{
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
    'Arachis oil allergy (294317009) does NOT count as the same allergen as Peanut allergy — sits under a completely ' +
      'separate "Fixed oil" hierarchy with no ancestor link to Peanut (substance) at all'
  );
  check(!isSameAllergenConcept(null, [], '91935009', []), 'a missing conceptId on either side never matches');
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
  check(!group.some((e) => e.id === 'oil'), 'Arachis oil allergy is NOT pulled in — correctly distinct');
  const anaphylaxisEntry = group.find((e) => e.id === 'anaphylaxis');
  check(anaphylaxisEntry.groupedBy === 'concept', 'the anaphylaxis entry is marked groupedBy: "concept"');
  check(
    anaphylaxisEntry.relatedToDescription === 'Peanut allergy',
    "the anaphylaxis entry names which other entry's description it relates to"
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
}

console.log('--- filterActiveEntries: "Remove from merge" support, 2026-08-02 explicit request ---');
{
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  check(
    filterActiveEntries(entries, new Set(['b']))
      .map((e) => e.id)
      .join(',') === 'a,c',
    'a Set of removed ids filters out exactly those entries, preserving order'
  );
  check(
    filterActiveEntries(entries, ['b', 'c'])
      .map((e) => e.id)
      .join(',') === 'a',
    'a plain array of removed ids also works, not just a Set'
  );
  check(filterActiveEntries(entries, new Set()).length === 3, 'an empty removed set returns everything unchanged');
  check(filterActiveEntries(entries, null).length === 3, 'null removedIds -> nothing removed, never throws');
  check(filterActiveEntries(null, new Set(['a'])).length === 0, 'null entries -> empty array, never throws');
  check(filterActiveEntries([], new Set()).length === 0, 'empty entries -> empty array');
}

console.log(
  '--- additionalInfoTextIsUnedited: safe-to-reseed check for "Remove from merge" (2026-08-02 follow-up) ---'
);
{
  check(
    additionalInfoTextIsUnedited('reacted with hives', 'reacted with hives') === true,
    'box content exactly matches what it was loaded from -> safe to re-seed'
  );
  check(
    additionalInfoTextIsUnedited('reacted with hives AND swelling', 'reacted with hives') === false,
    'the clinician has typed something different -> NEVER safe to silently overwrite'
  );
  check(additionalInfoTextIsUnedited('', '') === true, 'both blank -> still unedited, safe');
  check(
    additionalInfoTextIsUnedited('something typed', '') === false,
    'typed text over an originally-blank box -> not safe to overwrite'
  );
  check(additionalInfoTextIsUnedited(null, null) === true, 'null/null treated the same as blank/blank, never throws');
  check(
    additionalInfoTextIsUnedited(undefined, 'x') === false,
    'undefined box content vs a real loaded value -> not a match'
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
    'a plain object passes through unchanged'
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
  const reactionValues = fieldValuesByEntry(entries, 'allergyReactions');
  check(
    Object.keys(reactionValues).length === 1 && reactionValues.e2.length === 1,
    'allergyReactions: only entries with a non-empty array are included'
  );
  check(Object.keys(fieldValuesByEntry(entries, 'onsetDate')).length === 0, 'a field nobody has -> empty map');
  check(Object.keys(fieldValuesByEntry(null, 'severity')).length === 0, 'null entries -> empty map, never throws');
}

console.log('--- buildMergeChangeAllergyPayload: matches the real captured change-allergy contract ---');
{
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
    'allergyCode is unwrapped to the flat POST shape'
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
    'recordedByOrganisation is NOT set when recordedAtAnotherOrganisation is false'
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
    'a genuinely blank recordedByOrganisation falls back to the agreed "Unknown" placeholder, not a guess'
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

console.log('--- MERGE_REASON_ENDED / MERGEABLE_FIELDS ---');
{
  check(
    MERGE_REASON_ENDED ===
      'Multiple allergy entries for same allergen - merged into single entry for clarity and to reduce dangerous / distracting clutter on clinical record',
    'matches the wording the user explicitly specified, verbatim'
  );
  check(
    MERGEABLE_FIELDS.length === 5 &&
      ['severity', 'certainty', 'additionalInformation', 'allergyReactions', 'onsetDate'].every((f) =>
        MERGEABLE_FIELDS.includes(f)
      ),
    'exactly the five clinical fields — allergyCode/substance/recordDate/recordedBy* are deliberately never per-field mergeable'
  );
}

console.log(
  '--- normalizeOnsetDateForSubmit: real HAR36 merge-failure bug (overview display format -> edit-allergy ISO format) ---'
);
{
  check(
    normalizeOnsetDateForSubmit('24 Jul 2012') === '2012-07-24',
    'real failing HAR36 value converts to the ISO shape change-allergy actually accepts'
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
