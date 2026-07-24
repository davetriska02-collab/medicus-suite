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
        { telephoneNumber: '01234567890', preferredTelephoneNumberForSms: false },
        { telephoneNumber: '07911111111', preferredTelephoneNumberForSms: true },
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

  const noPreferredFlag = {
    patientContactInformationSection: {
      patientEmailAddresses: [{ emailAddress: 'only@example.com', preferredEmailAddress: false }],
      patientTelephoneNumbers: [],
    },
  };
  check(
    CR.extractPreferredEmail(noPreferredFlag) === 'only@example.com',
    'extractPreferredEmail falls back to the first entry when none is flagged preferred'
  );
  check(
    CR.extractPreferredPhone(noPreferredFlag) === null,
    'extractPreferredPhone returns null when the list is empty'
  );
  check(
    CR.extractPreferredEmail(null) === null,
    'extractPreferredEmail is defensive against a missing patient-details object'
  );
  check(CR.extractPreferredEmail({}) === null, 'extractPreferredEmail is defensive against a missing section');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
