// Medicus Suite — allergy-junk-code-cleanup ("Bulk remove?" for
// import-artefact allergy codes) tests
// Run with: node test-allergy-junk-code-cleanup.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: exact-conceptId matching against rules/allergy-junk-codes.json,
// resolving an overview-allergy response's own conceptId (allergyCode vs
// substance, whichever is populated), the end-allergy POST payload shape
// confirmed via the real captured HAR (2026-07-29), which flagged entries
// are safe to bulk-select, and filtering the cheap clinical-summary/summary
// allergies[] list down to active, non-draft candidates.

'use strict';

const {
  findJunkCodeEntry,
  resolveAllergyConceptId,
  buildEndAllergyPayload,
  isEndable,
  activeNonDraftAllergies,
  reactionDescriptions,
  buildCautionMessage,
} = require('./content-scripts/allergy-junk-code-cleanup.js');
const allergyJunkCodes = require('./rules/allergy-junk-codes.json');

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
  check(allergyJunkCodes.codes.length === 4, 'exactly the four confirmed junk codes are configured so far');
  const noKnown = allergyJunkCodes.codes.find((c) => c.conceptId === '716186003');
  check(
    !!noKnown && noKnown.description === 'No known allergies' && noKnown.category === 'import-artefact',
    '716186003 "No known allergies" is present (confirmed live via overview-allergy, 2026-07-29), category import-artefact'
  );
  check(
    typeof noKnown.reasonEnded === 'string' && noKnown.reasonEnded.length > 0,
    '716186003 has a non-empty reasonEnded'
  );
  const hoNonDrug = allergyJunkCodes.codes.find((c) => c.conceptId === '161611007');
  check(
    !!hoNonDrug && hoNonDrug.description === 'H/O: non-drug allergy' && hoNonDrug.category === 'import-artefact',
    '161611007 "H/O: non-drug allergy" is present (confirmed by the user, 2026-07-29), category import-artefact'
  );
  check(
    typeof hoNonDrug.reasonEnded === 'string' && hoNonDrug.reasonEnded.length > 0,
    '161611007 has a non-empty reasonEnded'
  );
  const atopy = allergyJunkCodes.codes.find((c) => c.conceptId === '115665000');
  check(
    !!atopy && atopy.description === 'Atopy' && atopy.category === 'too-generic',
    '115665000 "Atopy" is present (confirmed by the user, 2026-07-29), category too-generic'
  );
  check(typeof atopy.reasonEnded === 'string' && atopy.reasonEnded.length > 0, '115665000 has a non-empty reasonEnded');
  const allergicReaction = allergyJunkCodes.codes.find((c) => c.conceptId === '419076005');
  check(
    !!allergicReaction &&
      allergicReaction.description === 'Allergic reaction' &&
      allergicReaction.category === 'too-generic',
    '419076005 "Allergic reaction" is present (confirmed by the user, 2026-07-29), category too-generic'
  );
  check(
    typeof allergicReaction.reasonEnded === 'string' && allergicReaction.reasonEnded.length > 0,
    '419076005 has a non-empty reasonEnded'
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

console.log('--- resolveAllergyConceptId: real overview-allergy response shapes (2026-07-29 HAR captures) ---');
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
    'real "No known allergies" capture resolves correctly (descriptionId null is fine, conceptId is what matters)'
  );
  check(resolveAllergyConceptId({ allergyCode: null, substance: null }) === null, 'neither populated -> null');
  check(resolveAllergyConceptId(null) === null, 'null overview -> null, never throws');
  check(resolveAllergyConceptId(undefined) === null, 'undefined overview -> null, never throws');
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
    'matches the real captured payload shape exactly: {allergyId, endDate, reasonEnded} (got ' +
      JSON.stringify(payload) +
      ')'
  );
  check(
    !('recordedByOrganisation' in payload) && !('patientId' in payload),
    'no recordedByOrganisation or patientId field — confirmed live this endpoint never needs them, unlike change-allergy'
  );
  check(
    buildEndAllergyPayload('id-1', '2026-07-29', undefined).reasonEnded === null,
    'a missing reasonEnded falls back to null, never undefined (both confirmed optional per the user)'
  );
  check(
    buildEndAllergyPayload('id-1', '2026-07-29', '').reasonEnded === null,
    'an empty-string reasonEnded also falls back to null'
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
    reactionDescriptions({ allergyReactions: [{ conceptId: '39579001', description: 'Anaphylaxis' }] }).length === 1 &&
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
    'real "No known allergies" capture (empty array) -> empty list, not an error'
  );
  check(reactionDescriptions({ allergyReactions: null }).length === 0, 'null allergyReactions -> empty list');
  check(reactionDescriptions(null).length === 0, 'null overview -> empty list, never throws');
  check(reactionDescriptions(undefined).length === 0, 'undefined overview -> empty list, never throws');
  check(
    reactionDescriptions({ allergyReactions: [{ conceptId: '1' }, { conceptId: '2', description: 'Rash' }] }).length ===
      1,
    'a reaction entry with no description is skipped, not a blank string'
  );
}

console.log(
  '--- buildCautionMessage: catches a genuine allergy recorded under a junk code (2026-07-29, explicit user request) ---'
);
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
    'a coded reaction ALONE (2026-07-29, explicit user request: "the absence of a coded reaction is probably a helpful signal") -> cautioned, even with everything else blank'
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
    'the message names WHICH field(s) triggered it, not just a bare flag'
  );
  check(
    buildCautionMessage({ severity: null, certainty: null, additionalInformation: '   ', allergyReactions: [] }) ===
      null,
    'whitespace-only additionalInformation does not count as populated'
  );
  check(buildCautionMessage(null) === null, 'null overview -> null, never throws');
  check(buildCautionMessage(undefined) === null, 'undefined overview -> null, never throws');
  check(buildCautionMessage({}) === null, 'empty overview object -> null');
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
  check(result.length === 2, 'draft, null, and id-less entries are excluded (got ' + result.length + ')');
  check(
    result.every((a) => a.id === 'a1' || a.id === 'a2'),
    'only the two genuine active entries survive'
  );
  check(activeNonDraftAllergies(null).length === 0, 'null allergies -> empty array, never throws');
  check(activeNonDraftAllergies(undefined).length === 0, 'undefined allergies -> empty array, never throws');
  check(activeNonDraftAllergies([]).length === 0, 'empty allergies -> empty array');
}

console.log('--- real 2026-07-29 patient scenario: 5 duplicate "No known allergies" entries ---');
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
  check(candidates.length === 5, 'all five real duplicate entries pass the active/non-draft filter');
  // Simulating what runScan() does once each candidate's overview-allergy
  // conceptId is resolved (all five would resolve to 716186003 in reality).
  const flagged = candidates.filter((c) => !!findJunkCodeEntry('716186003', allergyJunkCodes.codes));
  check(flagged.length === 5, 'every one of the five would be flagged for bulk-end');
}

console.log(
  '--- too-generic codes: the real peanut-allergy example (2026-07-29) — flagged, but PROTECTED by caution, never bulk-endable ---'
);
{
  // Real motivating case reported by the user: a genuine peanut allergy
  // coded under 419076005 "Allergic reaction" with the actual allergen
  // recorded only as free-text "peanut" in additionalInformation.
  const peanutOverview = {
    allergyCode: { conceptId: '419076005', description: 'Allergic reaction', descriptionId: null },
    substance: null,
    additionalInformation: 'peanut',
    severity: null,
    certainty: null,
    allergyReactions: [],
  };
  const conceptId = resolveAllergyConceptId(peanutOverview);
  const junkEntry = findJunkCodeEntry(conceptId, allergyJunkCodes.codes);
  check(
    !!junkEntry && junkEntry.category === 'too-generic',
    '419076005 IS matched against the junk-codes list (it is too generic on its own) — got ' + JSON.stringify(junkEntry)
  );
  const caution = buildCautionMessage(peanutOverview);
  check(
    caution !== null && /additional info recorded/.test(caution),
    'but buildCautionMessage catches the "peanut" free text and protects it — never silently bulk-ended (got "' +
      caution +
      '")'
  );
}
{
  // Contrast case: the SAME too-generic code with genuinely nothing else
  // attached — this one IS safe to offer for bulk-end, same as the
  // import-artefact codes.
  const genuinelyEmptyOverview = {
    allergyCode: { conceptId: '115665000', description: 'Atopy', descriptionId: null },
    substance: null,
    additionalInformation: null,
    severity: null,
    certainty: null,
    allergyReactions: [],
  };
  const junkEntry = findJunkCodeEntry(resolveAllergyConceptId(genuinelyEmptyOverview), allergyJunkCodes.codes);
  check(!!junkEntry && junkEntry.category === 'too-generic', '115665000 "Atopy" matches the junk-codes list too');
  check(
    buildCautionMessage(genuinelyEmptyOverview) === null,
    'a genuinely empty "Atopy" entry (no clinical detail at all) is NOT cautioned — safe for "Select all"'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
