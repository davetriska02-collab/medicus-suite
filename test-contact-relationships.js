// Medicus Suite — Contact relationship vocabulary pure-logic tests
// Run with: node test-contact-relationships.js
//
// engine/contact-relationships.js is the pure core behind the Contacts linking tool's canonical
// relationship vocabulary (rules/contact-relationships.json): lookups, tier/modifier validity,
// label formatting, gender-aware reciprocal inversion, and free-text-to-canonical matching. This
// file pins coverage (every relationship has alias terms except 'other'), inversion round-trips,
// and the ambiguous-inversion fail-closed behaviour (Care tier + unknown gender).

'use strict';

const CR = require('./engine/contact-relationships.js');
const DATA = require('./rules/contact-relationships.json');

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

// ============================================================
// 1 — fixture sanity
// ============================================================
console.log('1: fixture sanity');
{
  check(
    Array.isArray(DATA.relationships) && DATA.relationships.length === 32,
    'shipped JSON has exactly 32 relationships'
  );
  check(Array.isArray(DATA.tiers) && DATA.tiers.length === 8, 'shipped JSON has 8 tiers');
  check(Array.isArray(DATA.modifiers) && DATA.modifiers.length === 3, 'shipped JSON has 3 modifiers (ex/step/half)');
}

// ============================================================
// 2 — ALIAS_TERMS coverage
// ============================================================
console.log('2: ALIAS_TERMS coverage');
{
  for (const rel of DATA.relationships) {
    if (rel.id === 'other') continue; // deliberately alias-free — the free-text escape hatch
    check(
      Array.isArray(CR.ALIAS_TERMS[rel.id]) && CR.ALIAS_TERMS[rel.id].length > 0,
      `ALIAS_TERMS has a non-empty entry for "${rel.id}"`
    );
  }
  const shippedIds = new Set(DATA.relationships.map((r) => r.id));
  for (const key of Object.keys(CR.ALIAS_TERMS)) {
    check(shippedIds.has(key), `ALIAS_TERMS key "${key}" corresponds to a real shipped relationship id`);
  }
}

// ============================================================
// 3 — validModifiersForBase / formatLabel
// ============================================================
console.log('3: validModifiersForBase / formatLabel');
{
  check(CR.validModifiersForBase('sister').sort().join(',') === 'half,step', 'sister accepts step and half');
  check(CR.validModifiersForBase('husband').join(',') === 'ex', 'husband accepts only ex');
  check(CR.validModifiersForBase('cousin').length === 0, 'cousin accepts no modifiers');
  check(CR.formatLabel('mother', 'step') === 'Step-mother', 'formatLabel builds "Step-mother"');
  check(CR.formatLabel('husband', 'ex') === 'Ex-husband', 'formatLabel builds "Ex-husband"');
  check(CR.formatLabel('brother', 'half') === 'Half-brother', 'formatLabel builds "Half-brother"');
  check(CR.formatLabel('brother', null) === 'Brother', 'formatLabel with no modifier returns the plain label');
  check(CR.formatLabel('brother', 'ex') === 'Brother', 'formatLabel ignores a modifier invalid for the base tier');
}

// ============================================================
// 4 — invertRelationship
// ============================================================
console.log('4: invertRelationship');
{
  check(
    CR.invertRelationship({ baseId: 'partner' }).baseId === 'partner',
    'partner inverts to partner (unambiguous string reciprocal)'
  );
  const motherToSon = CR.invertRelationship({ baseId: 'mother', indexGender: 'Male' });
  check(motherToSon.baseId === 'son' && !motherToSon.ambiguous, 'mother + male index patient inverts to son');
  const motherToDaughter = CR.invertRelationship({ baseId: 'mother', indexGender: 'Female' });
  check(
    motherToDaughter.baseId === 'daughter' && !motherToDaughter.ambiguous,
    'mother + female index patient inverts to daughter'
  );
  const motherUnknownGender = CR.invertRelationship({ baseId: 'mother', indexGender: null });
  check(motherUnknownGender.ambiguous === true, 'mother + unknown index gender is ambiguous, never guessed');
  const stepMother = CR.invertRelationship({ baseId: 'mother', modifierId: 'step', indexGender: 'Female' });
  check(
    stepMother.baseId === 'daughter' && stepMother.modifierId === 'step',
    'Step- modifier carries across the inversion unchanged'
  );

  for (const careId of ['legal-guardian', 'foster-carer', 'carer', 'care-home-staff']) {
    const inv = CR.invertRelationship({ baseId: careId, indexGender: 'Female' });
    check(inv.ambiguous === true, `${careId} (Care tier) never auto-reverses (reciprocal: null)`);
  }
}

// ============================================================
// 4b — composeViaHub
// ============================================================
console.log('4b: composeViaHub');
{
  // X is hub's mother, B is hub's daughter -> X is B's grandmother.
  const gm = CR.composeViaHub({ baseId: 'mother' }, { baseId: 'daughter' });
  check(gm && gm.baseId === 'grandmother' && gm.modifierId === null, 'parent-of-hub + child-of-hub -> grandmother');
  const gf = CR.composeViaHub({ baseId: 'father' }, { baseId: 'son' });
  check(gf && gf.baseId === 'grandfather', 'father-of-hub + son-of-hub -> grandfather');

  // Reversed direction — X is hub's child, B is hub's parent -> X is B's grandchild.
  const gs = CR.composeViaHub({ baseId: 'son' }, { baseId: 'mother' });
  check(gs && gs.baseId === 'grandson', 'child-of-hub + parent-of-hub -> grandson (reversed direction)');
  const gd = CR.composeViaHub({ baseId: 'daughter' }, { baseId: 'father' });
  check(gd && gd.baseId === 'granddaughter', 'child-of-hub + parent-of-hub -> granddaughter (reversed direction)');

  // In-law — X is hub's parent, B is hub's partner -> X is B's parent-in-law.
  const mil = CR.composeViaHub({ baseId: 'mother' }, { baseId: 'husband' });
  check(mil && mil.baseId === 'mother-in-law', 'parent-of-hub + partner-of-hub -> mother-in-law');
  const fil = CR.composeViaHub({ baseId: 'father' }, { baseId: 'wife' });
  check(fil && fil.baseId === 'father-in-law', 'parent-of-hub + partner-of-hub -> father-in-law');

  // In-law reversed — X is hub's partner, B is hub's parent -> X is B's child-in-law.
  const sil = CR.composeViaHub({ baseId: 'husband' }, { baseId: 'mother' });
  check(sil && sil.baseId === 'son-in-law', 'husband-of-hub (word resolves gender on its own) -> son-in-law');
  const dil = CR.composeViaHub({ baseId: 'wife' }, { baseId: 'father' });
  check(dil && dil.baseId === 'daughter-in-law', 'wife-of-hub (word resolves gender on its own) -> daughter-in-law');

  // Gender-neutral partner word needs the soft gender hint for the reversed in-law case.
  const partnerNoGender = CR.composeViaHub({ baseId: 'partner' }, { baseId: 'mother' });
  check(partnerNoGender === null, 'gender-neutral partner-of-hub with no gender hint -> null, never guessed');
  const partnerMale = CR.composeViaHub({ baseId: 'partner' }, { baseId: 'mother' }, 'Male');
  check(partnerMale && partnerMale.baseId === 'son-in-law', 'gender-neutral partner-of-hub + male hint -> son-in-law');
  const partnerFemale = CR.composeViaHub({ baseId: 'civil-partner' }, { baseId: 'father' }, 'Female');
  check(
    partnerFemale && partnerFemale.baseId === 'daughter-in-law',
    'gender-neutral civil-partner-of-hub + female hint -> daughter-in-law'
  );

  // Explicitly unsafe combinations — must return null, never a guess.
  check(
    CR.composeViaHub({ baseId: 'daughter' }, { baseId: 'daughter' }) === null,
    'child-of-hub + child-of-hub (sibling) -> null, half/full ambiguity not resolvable from one hop'
  );
  check(
    CR.composeViaHub({ baseId: 'husband' }, { baseId: 'daughter' }) === null,
    'partner-of-hub + child-of-hub (step-parent) -> null, partner could independently already be the parent'
  );
  check(
    CR.composeViaHub({ baseId: 'mother' }, { baseId: 'mother' }) === null,
    'parent-of-hub + parent-of-hub -> null, not even a meaningful relationship'
  );
  check(
    CR.composeViaHub({ baseId: 'mother', modifierId: 'step' }, { baseId: 'daughter' }) === null,
    'a Step- modified hop never composes — checked on X'
  );
  check(
    CR.composeViaHub({ baseId: 'mother' }, { baseId: 'daughter', modifierId: 'half' }) === null,
    'a Half- modified hop never composes — checked on B'
  );
  check(CR.composeViaHub(null, { baseId: 'daughter' }) === null, 'a missing edge is a safe no-op, not a throw');
}

// ============================================================
// 5 — normaliseFreeText
// ============================================================
console.log('5: normaliseFreeText');
{
  check(CR.normaliseFreeText('Mother').baseId === 'mother', 'exact label match');
  check(CR.normaliseFreeText('mum').baseId === 'mother', 'alias match: mum -> mother');
  check(
    CR.normaliseFreeText('Step-mother').baseId === 'mother' &&
      CR.normaliseFreeText('Step-mother').modifierId === 'step',
    'Step-mother -> mother + step modifier'
  );
  check(
    CR.normaliseFreeText('half sister').baseId === 'sister' &&
      CR.normaliseFreeText('half sister').modifierId === 'half',
    'half sister -> sister + half modifier'
  );
  check(
    CR.normaliseFreeText('ex-husband').baseId === 'husband' && CR.normaliseFreeText('ex-husband').modifierId === 'ex',
    'ex-husband -> husband + ex modifier'
  );
  check(
    CR.normaliseFreeText('Test relationship') === null,
    'unmatched free text returns null (routes to needs-review, never guessed)'
  );
  check(CR.normaliseFreeText('') === null, 'empty text returns null');

  // ── Adversarial: the stated invariant is "falls back to needs review, never a WRONG category" ──
  // A possessive names a THIRD party's relative, so the relationship word present in the text is
  // the wrong answer for this contact, not a partial one. These all used to return a confident
  // (0.85) category that would be pre-filled onto a real record write.
  check(
    CR.normaliseFreeText("Son's wife") === null,
    '"Son\'s wife" -> null (needs review), never a confident "wife" — a possessive names someone else\'s relative'
  );
  check(
    CR.normaliseFreeText("Mother's carer") === null,
    '"Mother\'s carer" -> null (needs review), never a confident "carer"'
  );
  check(
    CR.normaliseFreeText("Daughter's friend") === null,
    '"Daughter\'s friend" -> null (needs review), never a confident "friend"'
  );
  check(
    CR.normaliseFreeText('Sons wife') === null,
    'the apostrophe-less possessive ("Sons wife") is caught too — normaliseText strips the apostrophe before matching'
  );
  check(
    CR.normaliseFreeText('Carer for his mother') === null,
    'an alias merely APPEARING inside a longer phrase is not a match — the alias must be the whole remainder'
  );

  // "Other half" is a shipped partner alias (rules/contact-relationships.json). It was unreachable:
  // the Half- modifier stripper ran first, ate "half", and left "other" — which then exact-matched
  // the unrelated "Other" label at confidence 1.
  const otherHalf = CR.normaliseFreeText('Other half');
  check(otherHalf && otherHalf.baseId === 'partner', '"Other half" resolves to partner, as the shipped alias intends');
  check(
    otherHalf && otherHalf.modifierId === null,
    '"Other half" carries no Half- modifier — the word is part of the alias'
  );
  check(CR.normaliseFreeText('Other').baseId === 'other', 'plain "Other" still exact-matches the Other label');

  // Same root cause as "Other half": the any-word scan let an EARLIER-indexed relationship win on a
  // substring of a longer shipped alias — "Foster mother" matched mother's alias before ever
  // reaching foster-carer's own "foster mother" entry.
  check(
    CR.normaliseFreeText('Foster mother').baseId === 'foster-carer',
    '"Foster mother" resolves to foster-carer, not mother — the whole-remainder rule stops a substring winning'
  );

  // Single tokens that merely look possessive must not be over-caught.
  check(
    CR.normaliseFreeText('Wife').baseId === 'wife',
    'a plain "Wife" still matches — possessive detection needs a following word'
  );
}

// ============================================================
// 6 — findExistingReciprocal / findExistingForwardLink / suggestForwardFromReciprocal
// ============================================================
console.log('6: existing-link detection (shared between the wizard and the canvas)');
{
  const indexDetails = {
    patientLinkedContactsSection: {
      patientContacts: [{ linkedPatientId: 'mother-id', patientContactRelationship: 'Mother' }],
    },
    patientContactsSection: {
      patientContacts: [{ patientContactPatientId: 'sister-id', patientContactRelationship: 'Sister' }],
    },
  };

  check(
    CR.findExistingReciprocal(indexDetails, 'mother-id').patientContactRelationship === 'Mother',
    'findExistingReciprocal finds an entry that already lists the index patient'
  );
  check(
    CR.findExistingReciprocal(indexDetails, 'unrelated-id') === null,
    'findExistingReciprocal returns null when nothing matches'
  );
  check(
    CR.findExistingReciprocal(null, 'mother-id') === null,
    'findExistingReciprocal is defensive against a missing patient-details object'
  );

  check(
    CR.findExistingForwardLink(indexDetails, 'sister-id').patientContactRelationship === 'Sister',
    'findExistingForwardLink finds an already-real-linked entry'
  );
  check(
    CR.findExistingForwardLink(indexDetails, 'mother-id') === null,
    'findExistingForwardLink does not match a patientLinkedContactsSection-only entry'
  );

  const suggestion = CR.suggestForwardFromReciprocal(
    { patientContactRelationship: 'Mother' },
    'Female' // the CANDIDATE's own gender — they are the "child" in the recorded relationship
  );
  check(
    suggestion && suggestion.baseId === 'daughter',
    'suggestForwardFromReciprocal inverts using the candidate’s gender'
  );
  check(
    CR.suggestForwardFromReciprocal({ patientContactRelationship: 'Test relationship' }, 'Female') === null,
    'suggestForwardFromReciprocal returns null when the recorded text does not normalise'
  );
  check(
    CR.suggestForwardFromReciprocal(null, 'Female') === null,
    'suggestForwardFromReciprocal returns null with no reciprocal entry'
  );
}

// ============================================================
// 7 — extractPreferredEmail / extractPreferredPhone
// ============================================================
console.log('7: extractPreferredEmail / extractPreferredPhone');
{
  const withPreferred = {
    patientContactInformationSection: {
      patientEmailAddresses: [
        { emailAddress: 'old@example.com', preferredEmailAddress: false },
        { emailAddress: 'preferred@example.com', preferredEmailAddress: true },
      ],
      patientTelephoneNumbers: [
        { telephoneNumberId: 'phone-old-id', telephoneNumber: '01234567890', preferredTelephoneNumberForSms: false },
        {
          telephoneNumberId: 'phone-preferred-id',
          telephoneNumber: '07911111111',
          preferredTelephoneNumberForSms: true,
          notes: "mum's mobile",
        },
      ],
    },
  };
  check(
    CR.extractPreferredEmail(withPreferred) === 'preferred@example.com',
    'extractPreferredEmail picks the entry flagged preferred over the first one'
  );
  check(
    CR.extractPreferredPhone(withPreferred) === '07911111111',
    'extractPreferredPhone picks the entry flagged preferred for SMS over the first one'
  );
  check(
    CR.extractPreferredPhoneNote(withPreferred) === "mum's mobile",
    "extractPreferredPhoneNote surfaces the free-text note on the same preferred entry — confirmed live 2026-07-25: this is exactly how a number that actually belongs to someone else (e.g. a parent's mobile left on a child's own record) gets flagged"
  );
  check(
    CR.extractPreferredPhoneId(withPreferred) === 'phone-preferred-id',
    'extractPreferredPhoneId identifies the SAME entry extractPreferredPhone/extractPreferredPhoneNote read from — a caller editing the flagged number must target the number the warning is actually about'
  );

  const noPreferredFlag = {
    patientContactInformationSection: {
      patientEmailAddresses: [{ emailAddress: 'only@example.com', preferredEmailAddress: false }],
      patientTelephoneNumbers: [{ telephoneNumber: '01234567890', preferredTelephoneNumberForSms: false }],
    },
  };
  check(
    CR.extractPreferredEmail(noPreferredFlag) === 'only@example.com',
    'extractPreferredEmail falls back to the first entry when none is flagged preferred'
  );
  check(
    CR.extractPreferredPhoneNote(noPreferredFlag) === null,
    'extractPreferredPhoneNote returns null when the (only) entry has no notes field'
  );

  const emptyPhones = {
    patientContactInformationSection: { patientEmailAddresses: [], patientTelephoneNumbers: [] },
  };
  check(CR.extractPreferredPhone(emptyPhones) === null, 'extractPreferredPhone returns null when the list is empty');
  check(
    CR.extractPreferredPhoneNote(emptyPhones) === null,
    'extractPreferredPhoneNote returns null when the list is empty'
  );
  check(
    CR.extractPreferredPhoneId(emptyPhones) === null,
    'extractPreferredPhoneId returns null when the list is empty'
  );
  check(
    CR.extractPreferredEmail(null) === null,
    'extractPreferredEmail is defensive against a missing patient-details object'
  );
  check(CR.extractPreferredEmail({}) === null, 'extractPreferredEmail is defensive against a missing section');
  check(
    CR.extractPreferredPhoneId(null) === null,
    'extractPreferredPhoneId is defensive against a missing patient-details object'
  );
  check(
    CR.extractPreferredPhoneNote(null) === null,
    'extractPreferredPhoneNote is defensive against a missing patient-details object'
  );
}

// ============================================================
// 8 — isDeceasedRelationshipText
// ============================================================
console.log('8: isDeceasedRelationshipText');
{
  check(CR.isDeceasedRelationshipText('Mother (RIP)') === true, '"Mother (RIP)" is recognised as deceased');
  check(CR.isDeceasedRelationshipText('Mother (rip)') === true, 'match is case-insensitive');
  check(CR.isDeceasedRelationshipText('Father - deceased') === true, '"deceased" is also recognised');
  check(CR.isDeceasedRelationshipText("Father (dec'd)") === true, '"dec\'d" is also recognised');
  check(CR.isDeceasedRelationshipText('Sadly passed away last year') === true, '"passed away" is also recognised');
  check(CR.isDeceasedRelationshipText('Mother') === false, 'a plain relationship is not flagged');
  check(
    CR.isDeceasedRelationshipText('Ripley') === false,
    'word-bounded — does not fire on an unrelated word containing "rip"'
  );
  check(CR.isDeceasedRelationshipText('') === false, 'empty text is not flagged');
  check(CR.isDeceasedRelationshipText(null) === false, 'is defensive against null');
  check(CR.isDeceasedRelationshipText(undefined) === false, 'is defensive against undefined');
}

// ============================================================
// 9 — isUkMobileNumber
// ============================================================
console.log('9: isUkMobileNumber');
{
  check(CR.isUkMobileNumber('07911 123456') === true, 'plain 07 mobile with a space is recognised');
  check(CR.isUkMobileNumber('07911123456') === true, 'plain 07 mobile with no spaces is recognised');
  check(CR.isUkMobileNumber('+44 7911 123456') === true, '+44 international format is recognised');
  check(CR.isUkMobileNumber('0044 7911 123456') === true, '0044 international format is recognised');
  check(CR.isUkMobileNumber('44 7911 123456') === true, 'bare 44 country code (no +) is recognised');
  check(CR.isUkMobileNumber('020 8943 3013') === false, 'a London landline is not recognised as mobile');
  check(CR.isUkMobileNumber('0121 496 0000') === false, 'a Birmingham landline is not recognised as mobile');
  check(CR.isUkMobileNumber('01632 960000') === false, 'an 01 landline is not recognised as mobile');
  check(CR.isUkMobileNumber('0800 123 4567') === false, 'a freephone number is not recognised as mobile');
  check(CR.isUkMobileNumber('0791112345') === false, 'one digit short of a valid mobile is rejected');
  check(CR.isUkMobileNumber('079111234567') === false, 'one digit too many is rejected');
  check(CR.isUkMobileNumber('') === false, 'empty string is not a mobile');
  check(CR.isUkMobileNumber(null) === false, 'is defensive against null');
  check(CR.isUkMobileNumber(undefined) === false, 'is defensive against undefined');
}

// ============================================================
// 10 — isLikelyDuplicateAddress / findDuplicateAddressGroups
// ============================================================
console.log('10: isLikelyDuplicateAddress / findDuplicateAddressGroups');
{
  const exact1 = { line1: 'Flat 1', line2: '26 High Street', locality: 'Teddington', postalCode: 'TW11 0AU' };
  const exact2 = { line1: 'Flat 1', line2: '26 High Street', locality: 'Teddington', postalCode: 'TW11 0AU' };
  check(CR.isLikelyDuplicateAddress(exact1, exact2) === true, 'byte-for-byte identical addresses are duplicates');

  // The user's own worked examples.
  const extraLocality1 = { line1: 'Flat 1', line2: '26 High Street', locality: 'Teddington', postalCode: 'TW11 0AU' };
  const extraLocality2 = {
    line1: 'Flat 1',
    line2: '26 High Street',
    locality: 'London',
    administrativeArea: 'Teddington',
    postalCode: 'TW11 0AU',
  };
  check(
    CR.isLikelyDuplicateAddress(extraLocality1, extraLocality2) === true,
    'one copy gaining an extra locality token ("London") is still recognised as the same address'
  );

  const splitLines1 = { line1: 'Flat 1, 26 High Street', line2: 'Teddington', postalCode: 'TW11 0AU' };
  const splitLines2 = { line1: 'Flat 1', line2: '26 High Street', line3: 'Teddington', postalCode: 'TW11 0AU' };
  check(
    CR.isLikelyDuplicateAddress(splitLines1, splitLines2) === true,
    'the same text split across a different number of address lines is still recognised as the same address'
  );

  const differentPostcode = {
    line1: 'Flat 1',
    line2: '26 High Street',
    locality: 'Teddington',
    postalCode: 'TW11 0AZ',
  };
  check(
    CR.isLikelyDuplicateAddress(exact1, differentPostcode) === false,
    'a different postcode is NEVER a duplicate, however similar the rest of the text looks'
  );

  const genuinelyDifferent = {
    line1: 'Flat 2',
    line2: '26 High Street',
    locality: 'Teddington',
    postalCode: 'TW11 0AU',
  };
  check(
    CR.isLikelyDuplicateAddress(exact1, genuinelyDifferent) === false,
    'a different flat number at the same postcode is not flagged — text overlap alone is not enough'
  );

  const noPostcodeA = { line1: 'Flat 1', line2: '26 High Street', locality: 'Teddington', postalCode: '' };
  const noPostcodeB = { line1: 'Flat 1', line2: '26 High Street', locality: 'Teddington', postalCode: '' };
  check(
    CR.isLikelyDuplicateAddress(noPostcodeA, noPostcodeB) === false,
    'a missing postcode on either side is never flagged, however similar the text — too uncertain to risk it'
  );

  check(CR.isLikelyDuplicateAddress(null, exact1) === false, 'a missing address is a safe no-op, not a throw');

  // ── Three further false-positive classes, each verified by execution before being fixed ────────
  // A deleted address is a real loss, so every one of these must fail closed.

  // 1. An ALPHANUMERIC flat designator is still a designator. Under the old /^\d+$/ numeric test,
  //    "1a"/"1b" fell into the fuzzy WORD bag and diluted away to a match.
  const flat1a = {
    line1: 'Flat 1a',
    line2: 'Rosewood Court',
    line3: 'Camden',
    locality: 'London',
    postalCode: 'NW1 1AA',
  };
  const flat1b = {
    line1: 'Flat 1b',
    line2: 'Rosewood Court',
    line3: 'Camden',
    locality: 'London',
    postalCode: 'NW1 1AA',
  };
  check(
    CR.isLikelyDuplicateAddress(flat1a, flat1b) === false,
    'an alphanumeric flat designator ("Flat 1a" vs "Flat 1b") is a real difference, not fuzzy word noise'
  );

  // 2. A SET comparison of numbers ignores WHICH number went where — both of these reduce to
  //    {3, 12}, two genuinely different addresses at the same postcode.
  const numbersSwapped1 = { line1: '12 High Street', line2: 'Flat 3', postalCode: 'AB1 2CD' };
  const numbersSwapped2 = { line1: '3 High Street', line2: 'Flat 12', postalCode: 'AB1 2CD' };
  check(
    CR.isLikelyDuplicateAddress(numbersSwapped1, numbersSwapped2) === false,
    'the same numbers in different positions ("12 High Street, Flat 3" vs "3 High Street, Flat 12") are not a duplicate'
  );

  // 3. A lone LETTER is the other way a unit inside one building is written — in a long address it
  //    diluted to 0.75 in the Jaccard, over the 0.7 threshold.
  const unitLetterA = {
    line1: 'Flat A',
    line2: 'Riverside Court',
    line3: '12 High Street',
    locality: 'London',
    postalCode: 'NW1 1AA',
  };
  const unitLetterB = {
    line1: 'Flat B',
    line2: 'Riverside Court',
    line3: '12 High Street',
    locality: 'London',
    postalCode: 'NW1 1AA',
  };
  check(
    CR.isLikelyDuplicateAddress(unitLetterA, unitLetterB) === false,
    'a single-letter unit designator ("Flat A" vs "Flat B") must match exactly — it cannot dilute in the Jaccard'
  );

  // ── …and the fix must not overtighten: genuine duplicates still match ─────────────────────────
  // The SAME address, reformatted — different punctuation, different case, split across a different
  // number of lines, and its two locality-ish lines recorded in the opposite order.
  const reformatted1 = { line1: 'Flat 1, 26 High Street,', line2: 'Teddington, London', postalCode: 'TW11 0AU' };
  const reformatted2 = {
    line1: 'FLAT 1',
    line2: '26 HIGH STREET',
    line3: 'London',
    locality: 'Teddington',
    postalCode: 'tw11 0au',
  };
  check(
    CR.isLikelyDuplicateAddress(reformatted1, reformatted2) === true,
    'the same address reformatted (punctuation, case, line splits, reordered locality lines) is still a duplicate'
  );

  // A unit designator that AGREES on both sides is not a difference — it must not block a match.
  const unitLetterSameA = unitLetterA;
  const unitLetterSameB = {
    line1: 'Flat A, Riverside Court',
    line2: '12 High Street',
    line3: 'London',
    administrativeArea: 'Camden',
    postalCode: 'NW1 1AA',
  };
  check(
    CR.isLikelyDuplicateAddress(unitLetterSameA, unitLetterSameB) === true,
    'a matching unit designator plus one extra locality token is still recognised as the same address'
  );

  // findDuplicateAddressGroups over a whole patientAddresses-shaped array.
  const patientAddresses = [
    { addressId: 'a1', address: exact1 },
    { addressId: 'a2', address: extraLocality2 },
    { addressId: 'a3', address: genuinelyDifferent },
  ];
  const groups = CR.findDuplicateAddressGroups(patientAddresses);
  check(groups.length === 1, 'exactly one duplicate group found among three addresses, two of which match');
  check(
    groups[0].length === 2 && groups[0].includes(0) && groups[0].includes(1),
    'the duplicate group contains the two matching indexes (0 and 1), not the genuinely different third address'
  );
  check(CR.findDuplicateAddressGroups([]).length === 0, 'an empty address list produces no groups');
  check(
    CR.findDuplicateAddressGroups([{ addressId: 'a1', address: exact1 }]).length === 0,
    'a single address can never be a duplicate of itself'
  );
}

// ============================================================
// 11 — chooseAddressToKeep
// ============================================================
console.log('11: chooseAddressToKeep');
{
  const sparse = { line1: 'Flat 1', line2: '26 High Street', postalCode: 'TW11 0AU' };
  const complete = {
    line1: 'Flat 1',
    line2: '26 High Street',
    locality: 'Teddington',
    administrativeArea: 'Middlesex',
    postalCode: 'TW11 0AU',
  };

  check(
    CR.chooseAddressToKeep([
      { address: sparse, isCorrespondenceAddress: false },
      { address: complete, isCorrespondenceAddress: true },
    ]) === 1,
    'the correspondence address is always kept, even over a more complete non-correspondence duplicate'
  );
  check(
    CR.chooseAddressToKeep([
      { address: complete, isCorrespondenceAddress: true },
      { address: sparse, isCorrespondenceAddress: false },
    ]) === 0,
    'correspondence-address preference holds regardless of which position it appears in'
  );

  check(
    CR.chooseAddressToKeep([
      { address: sparse, isCorrespondenceAddress: false },
      { address: complete, isCorrespondenceAddress: false },
    ]) === 1,
    'with neither flagged as correspondence, the more complete address (more filled-in fields) is kept'
  );

  check(
    CR.chooseAddressToKeep([
      { address: sparse, isCorrespondenceAddress: false },
      { address: sparse, isCorrespondenceAddress: false },
    ]) === 0,
    'a genuine tie (identical completeness, neither correspondence) deterministically keeps the first'
  );

  check(CR.chooseAddressToKeep([]) === -1, 'an empty list returns -1 (nothing to keep)');
  check(CR.chooseAddressToKeep(null) === -1, 'is defensive against null');
}

// ============================================================
// 12 — buildChangeAddressBody
// ============================================================
console.log('12: buildChangeAddressBody');
{
  const body = CR.buildChangeAddressBody({
    addressId: 'addr-1',
    address: {
      line1: 'The Park Road Surgery',
      line2: '37 Park Road',
      line3: null,
      locality: 'Teddington',
      administrativeArea: null,
      postalCode: 'TW11 0AU',
      country: null,
    },
    description: null,
    accessNotes: null,
    isCorrespondenceAddress: true,
  });
  // Exact shape confirmed via HAR capture 2026-07-30.
  check(
    JSON.stringify(body) ===
      JSON.stringify({
        address: {
          line1: 'The Park Road Surgery',
          line2: '37 Park Road',
          line3: null,
          locality: 'Teddington',
          administrativeArea: null,
          postalCode: 'TW11 0AU',
          country: 'GBR',
          pafAddressKey: null,
        },
        description: null,
        accessNotes: null,
        id: 'addr-1',
        isCorrespondenceAddress: true,
      }),
    'produces the exact HAR-confirmed body shape, defaulting a missing country to GBR'
  );

  const preserved = CR.buildChangeAddressBody({
    addressId: 'addr-2',
    address: { line1: '1 High St', postalCode: 'AB1 2CD', country: 'GBR' },
    description: 'Gate code 1234',
    accessNotes: 'Ring twice',
    isCorrespondenceAddress: false,
  });
  check(
    preserved.description === 'Gate code 1234' && preserved.accessNotes === 'Ring twice',
    'an existing description/accessNotes is carried through unchanged, not dropped by the full-replace'
  );
  check(
    preserved.isCorrespondenceAddress === false,
    'isCorrespondenceAddress can be explicitly set false, not just true'
  );
  check(
    preserved.address.country === 'GBR',
    'an already-present country is kept as-is, not overwritten by the GBR default'
  );

  const empty = CR.buildChangeAddressBody();
  check(empty.address.line1 === null && empty.id === null, 'a missing input is a safe no-op, not a throw');
}

// ============================================================
// 13 — emailOwnerHint / findSharedContactInfo
// ============================================================
console.log('13: emailOwnerHint / findSharedContactInfo');
{
  check(
    CR.emailOwnerHint('sarah.jones82@gmail.com', 'Sarah Jones', 'Ethan Jones') === 'a',
    'email local-part matching only the first name (with trailing digits stripped) hints "a"'
  );
  check(
    CR.emailOwnerHint('sarah.jones82@gmail.com', 'Ethan Jones', 'Sarah Jones') === 'b',
    'same check, names swapped -> hints "b"'
  );
  check(
    CR.emailOwnerHint('sarah.jones82@gmail.com', 'Sarah Smith', 'Sarah Jones') === 'b',
    'both names share "sarah", but "Sarah Jones" also matches the surname token — the fuller match wins, not a naive any-token check'
  );
  check(
    CR.emailOwnerHint('sarah@gmail.com', 'Sarah Smith', 'Sarah Jones') === null,
    'an equally partial match on both sides (first name only, no surname in the local part) -> no hint, a genuine tie'
  );
  check(
    CR.emailOwnerHint('info@surgery.example', 'Sarah Jones', 'Ethan Jones') === null,
    'a generic local part matching neither name -> no hint'
  );
  check(CR.emailOwnerHint('', 'Sarah Jones', 'Ethan Jones') === null, 'empty email -> no hint, not a throw');

  const mother = {
    name: 'Sarah Jones',
    phones: [{ telephoneNumber: '07911 111111', telephoneNumberType: 'Mobile' }],
    emails: [{ emailAddress: 'sarah.jones82@gmail.com', emailAddressType: 'Personal' }],
  };
  const child = {
    name: 'Ethan Jones',
    phones: [{ telephoneNumber: '07911 111111', telephoneNumberType: 'Mobile' }],
    emails: [{ emailAddress: 'sarah.jones82@gmail.com', emailAddressType: 'Personal' }],
  };
  const shared = CR.findSharedContactInfo(mother, child);
  check(shared && shared.phones.length === 1, 'a shared Mobile number is detected');
  check(
    shared && shared.emails.length === 1 && shared.emails[0].ownerHint === 'a',
    'a shared non-Home email is detected, with an ownership hint pointing at the mother'
  );

  const homeSharedOnly = {
    name: 'A',
    phones: [{ telephoneNumber: '020 8943 3013', telephoneNumberType: 'Home' }],
    emails: [],
  };
  const homeSharedOnly2 = {
    name: 'B',
    phones: [{ telephoneNumber: '020 8943 3013', telephoneNumberType: 'Home' }],
    emails: [],
  };
  check(
    CR.findSharedContactInfo(homeSharedOnly, homeSharedOnly2) === null,
    'a shared Home number is never flagged — a household landline is normal, not suspicious'
  );

  // Live-caught bug: email DOES carry a type field in this API (emailAddressType), contrary to an
  // earlier assumption in this file — the same "Home" carve-out that already applied to phones now
  // applies to email too. The user's own real-world example: the same address stored as Home on
  // one record and Work on the other.
  check(
    CR.findSharedContactInfo(
      { name: 'A', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Home' }] },
      { name: 'B', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Home' }] }
    ) === null,
    'a shared Home-typed email is never flagged, same carve-out as Home phones'
  );
  check(
    CR.findSharedContactInfo(
      { name: 'A', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Home' }] },
      { name: 'B', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Work' }] }
    ) === null,
    'the SAME email stored as Home on one record and Work on the other is still excluded — either side being Home is enough to rule it out'
  );
  check(
    CR.findSharedContactInfo(
      { name: 'A', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Work' }] },
      { name: 'B', phones: [], emails: [{ emailAddress: 'family@example.com', emailAddressType: 'Personal' }] }
    ) !== null,
    'a genuinely non-Home email shared on both sides IS still flagged'
  );

  check(
    CR.findSharedContactInfo(
      { name: 'A', phones: [{ telephoneNumber: '07911 111111', telephoneNumberType: 'Mobile' }], emails: [] },
      { name: 'B', phones: [{ telephoneNumber: '07922 222222', telephoneNumberType: 'Mobile' }], emails: [] }
    ) === null,
    'genuinely different numbers -> null, not flagged'
  );

  check(CR.findSharedContactInfo(null, child) === null, 'a missing patient/contact is a safe no-op, not a throw');
  check(
    CR.findSharedContactInfo({ name: 'A', phones: [], emails: [] }, { name: 'B', phones: [], emails: [] }) === null,
    'nobody with any phone/email at all -> null'
  );
}

// ============================================================
// 14 — isLikelyDuplicatePhone / findDuplicatePhoneGroups / choosePhoneToKeep
// ============================================================
console.log('14: isLikelyDuplicatePhone / findDuplicatePhoneGroups / choosePhoneToKeep');
{
  // The real motivating example, 2026-08-20: the same number, once with its area code, once
  // without — a real, recurring GP2GP-import pattern, not a hypothetical.
  check(
    CR.isLikelyDuplicatePhone('020 8977 5481', '8977 5481') === true,
    'the area-code-dropped duplicate is recognised (the real reported case)'
  );
  check(
    CR.isLikelyDuplicatePhone('8977 5481', '020 8977 5481') === true,
    'order-independent — the shorter number can be either argument'
  );
  check(CR.isLikelyDuplicatePhone('020 8977 5481', '020 8977 5481') === true, 'byte-for-byte identical -> duplicate');
  check(
    CR.isLikelyDuplicatePhone('020-8977-5481', '02089775481') === true,
    'formatting punctuation (dashes, spaces) is ignored, not just an exact-string comparison'
  );
  check(
    CR.isLikelyDuplicatePhone('+44 20 8977 5481', '8977 5481') === true,
    'a country code prefix on one side is handled the same way as a dropped area code — no special-casing needed, just extra leading digits'
  );
  check(
    CR.isLikelyDuplicatePhone('020 8977 5481', '020 8977 5482') === false,
    'a genuinely different number of the same length is never a duplicate'
  );
  check(
    CR.isLikelyDuplicatePhone('020 8977 5481', '5481') === false,
    'a too-short shared suffix (below the minimum length) is NOT treated as evidence of a duplicate, however it lines up'
  );
  check(CR.isLikelyDuplicatePhone(null, '8977 5481') === false, 'a missing number is a safe no-op, not a throw');
  check(CR.isLikelyDuplicatePhone('', '') === false, 'two empty strings are not a duplicate — nothing to compare');

  const patientTelephoneNumbers = [
    { telephoneNumberId: 't1', telephoneNumberType: 'Home', telephoneNumber: '020 8977 5481' },
    { telephoneNumberId: 't2', telephoneNumberType: 'Mobile', telephoneNumber: '07770 000001' },
    { telephoneNumberId: 't3', telephoneNumberType: 'Work', telephoneNumber: '8977 5481' },
  ];
  const phoneGroups = CR.findDuplicatePhoneGroups(patientTelephoneNumbers);
  check(phoneGroups.length === 1, 'exactly one duplicate group found among three numbers, two of which match');
  check(
    phoneGroups[0].length === 2 && phoneGroups[0].includes(0) && phoneGroups[0].includes(2),
    'the duplicate group contains the two matching indexes (0 and 2), not the genuinely different mobile number'
  );
  check(CR.findDuplicatePhoneGroups([]).length === 0, 'an empty phone list produces no groups');
  check(
    CR.findDuplicatePhoneGroups([{ telephoneNumberId: 't1', telephoneNumber: '020 8977 5481' }]).length === 0,
    'a single number can never be a duplicate of itself'
  );

  check(
    CR.choosePhoneToKeep([
      { telephoneNumber: '8977 5481', preferredTelephoneNumberForSms: false },
      { telephoneNumber: '020 8977 5481', preferredTelephoneNumberForSms: true },
    ]) === 1,
    'the SMS-preferred number is always kept, even over a more complete non-preferred duplicate'
  );
  check(
    CR.choosePhoneToKeep([
      { telephoneNumber: '8977 5481', preferredTelephoneNumberForSms: false },
      { telephoneNumber: '020 8977 5481', preferredTelephoneNumberForSms: false },
    ]) === 1,
    'with neither SMS-preferred, the more complete (longer digit string) number is kept — the real motivating case'
  );
  check(
    CR.choosePhoneToKeep([
      { telephoneNumber: '020 8977 5481', preferredTelephoneNumberForSms: false },
      { telephoneNumber: '020 8977 5481', preferredTelephoneNumberForSms: false },
    ]) === 0,
    'a genuine tie (identical digits, neither preferred) deterministically keeps the first'
  );
  check(CR.choosePhoneToKeep([]) === -1, 'an empty list returns -1 (nothing to keep)');
  check(CR.choosePhoneToKeep(null) === -1, 'is defensive against null');
}

// ============================================================
// 15 — isLikelyDuplicateEmail / findDuplicateEmailGroups / chooseEmailToKeep
// ============================================================
console.log('15: isLikelyDuplicateEmail / findDuplicateEmailGroups / chooseEmailToKeep');
{
  check(
    CR.isLikelyDuplicateEmail('Bob@Example.com', 'bob@example.com') === true,
    'case differences are recognised as the same address'
  );
  check(
    CR.isLikelyDuplicateEmail('  bob@example.com  ', 'bob@example.com') === true,
    'surrounding whitespace is trimmed before comparing'
  );
  check(
    CR.isLikelyDuplicateEmail('bob@example.com', 'bob@example.com') === true,
    'byte-for-byte identical -> duplicate'
  );
  check(
    CR.isLikelyDuplicateEmail('bob@example.com', 'bob.smith@example.com') === false,
    'a genuinely different local part is never a duplicate — no dot-insensitivity/plus-addressing guessing'
  );
  check(CR.isLikelyDuplicateEmail(null, 'bob@example.com') === false, 'a missing email is a safe no-op, not a throw');
  check(CR.isLikelyDuplicateEmail('', '') === false, 'two empty strings are not a duplicate — nothing to compare');

  const patientEmailAddresses = [
    { emailAddressId: 'e1', emailAddressType: 'Personal', emailAddress: 'grundyn@yahoo.co.uk' },
    { emailAddressId: 'e2', emailAddressType: 'Work', emailAddress: 'other@example.com' },
    { emailAddressId: 'e3', emailAddressType: 'Personal', emailAddress: 'GrundyN@Yahoo.co.uk' },
  ];
  const emailGroups = CR.findDuplicateEmailGroups(patientEmailAddresses);
  check(emailGroups.length === 1, 'exactly one duplicate group found among three addresses, two of which match');
  check(
    emailGroups[0].length === 2 && emailGroups[0].includes(0) && emailGroups[0].includes(2),
    'the duplicate group contains the two matching indexes (0 and 2), not the genuinely different work address'
  );
  check(CR.findDuplicateEmailGroups([]).length === 0, 'an empty email list produces no groups');
  check(
    CR.findDuplicateEmailGroups([{ emailAddressId: 'e1', emailAddress: 'grundyn@yahoo.co.uk' }]).length === 0,
    'a single address can never be a duplicate of itself'
  );

  check(
    CR.chooseEmailToKeep([
      { emailAddress: 'GrundyN@Yahoo.co.uk', preferredEmailAddress: false },
      { emailAddress: 'grundyn@yahoo.co.uk', preferredEmailAddress: true },
    ]) === 1,
    'the preferred email address is always kept'
  );
  check(
    CR.chooseEmailToKeep([
      { emailAddress: 'GrundyN@Yahoo.co.uk', preferredEmailAddress: false },
      { emailAddress: 'grundyn@yahoo.co.uk', preferredEmailAddress: false },
    ]) === 0,
    'with neither preferred, a genuine tie deterministically keeps the first'
  );
  check(CR.chooseEmailToKeep([]) === -1, 'an empty list returns -1 (nothing to keep)');
  check(CR.chooseEmailToKeep(null) === -1, 'is defensive against null');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
