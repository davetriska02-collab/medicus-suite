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
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
