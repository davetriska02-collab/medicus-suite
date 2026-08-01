// Medicus Suite — Contact candidate-matching pure-logic tests
// Run with: node test-contact-match.js
//
// engine/contact-match.js ranks real-Medicus-patient candidates against one of the index
// patient's own manual (unlinked) contacts. This file pins the weighting discipline the GP
// building this explicitly required: name+address dominate, phone/email are capped low and
// never decisive (shared family emails, children's records wrongly carrying a parent's own
// contact details), and a gender or age mismatch is a shrug, never a hard penalty.

'use strict';

const CM = require('./engine/contact-match.js');

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
// 1 — nameSimilarity
// ============================================================
console.log('1: nameSimilarity');
{
  check(CM.nameSimilarity('Jane Smith', 'Jane Smith') === 1, 'identical names score 1');
  check(
    CM.nameSimilarity('Mrs Jane Smith', 'Jane Smith') >= 0.9,
    'a title prefix does not depress an otherwise-exact match'
  );
  check(CM.nameSimilarity('Jane Smith', 'John Doe') < 0.3, 'unrelated names score low');
}

// ============================================================
// 1a — containment is TOKEN-granular, not raw substring
// ============================================================
// Raw substring containment ('john smith'.includes('smith')) scored 0.9 — the top non-exact tier —
// for name pairs that are not the same person at all: 'Ann'/'Annette', 'Rose'/'Ambrose', and worst
// of all a surname-only manual contact ('Smith') against any household member ('John Smith'),
// which with the same-address weight added produced an 85 "strong" badge for every same-surname
// person at that address. Containment now has to hold at whole-token granularity, and a
// single-token containment is deliberately denied the 0.9 tier entirely.
console.log('1a: containment requires whole-token overlap');
{
  check(CM.nameSimilarity('Ann', 'Annette') < 0.9, '"Ann" is not a containment match for "Annette"');
  check(CM.nameSimilarity('Ann', 'Annette') < 0.3, '"Ann" vs "Annette" scores as the unrelated names they are');
  check(CM.nameSimilarity('Rose', 'Ambrose') < 0.3, '"Rose" is not buried-substring-matched inside "Ambrose"');
  check(
    CM.nameSimilarity('Ann Jones', 'Annette Jones') < 0.9,
    'a mid-name substring does not earn the containment tier even when the surname matches'
  );

  // Surname-only: a real shape (manual contacts are free text and often just "Smith"), but far too
  // weak to sit in the same tier as a genuine middle-name/compound-surname containment.
  check(
    CM.nameSimilarity('Smith', 'John Smith') < 0.9,
    'a surname-only manual contact does NOT reach the 0.9 containment tier against a full name'
  );
  check(
    CM.nameSimilarity('Smith', 'John Smith') <= 0.6,
    'a single-token containment is capped at the weaker Jaccard band, not promoted'
  );
  check(
    CM.nameSimilarity('John', 'John Smith') <= 0.6,
    'the same cap applies to a forename-only manual contact, not just surnames'
  );

  // The positives the feature exists for — these must stay in the containment tier.
  check(
    CM.nameSimilarity('John Bates Smith', 'John Smith') >= 0.9,
    "a real middle name still matches the patient's two-part name at the containment tier"
  );
  check(
    CM.nameSimilarity('John Smith', 'John Michael Bates Smith') >= 0.9,
    'containment works in either argument order, with any number of middle tokens'
  );
  check(
    CM.nameSimilarity('Mary Smith-Jones', 'Mary Smith Jones') >= 0.9,
    'a double-barrelled surname matches the same name recorded without the hyphen'
  );
  check(
    CM.nameSimilarity('John Smith', 'John Jones') < 0.9,
    'sharing only a forename is not containment — one token of the shorter name is absent'
  );
}

// ============================================================
// 1a(ii) — the surname-only + same-address badge regression
// ============================================================
console.log('1a(ii): surname-only + same address no longer badges "strong"');
{
  const manualContact = { name: 'Smith' }; // free-text manual contact recorded as just a surname
  const candidate = { patientId: 'p9', displayName: 'John Smith', atSameAddress: true };
  const result = CM.scoreCandidate(manualContact, candidate);
  check(
    result.tier !== 'strong',
    `a bare surname at the same address is not "strong" (got ${result.tier} @ ${result.score})`
  );
  check(result.score < 70, `score (${result.score}) stays below the strong threshold`);

  // ...while the middle-name case it was conflated with still is strong.
  const middleName = CM.scoreCandidate(
    { name: { first: 'John', middle: 'Bates', last: 'Smith' } },
    { patientId: 'p10', displayName: 'John Smith', atSameAddress: true }
  );
  check(middleName.tier === 'strong', 'a middle-name manual contact at the same address is still "strong"');
}

// ============================================================
// 1b — nameSearchQueries
// ============================================================
console.log('1b: nameSearchQueries');
{
  check(
    CM.nameSearchQueries('Jane Smith').length === 1 && CM.nameSearchQueries('Jane Smith')[0] === 'Jane Smith',
    'an already-unambiguous 2-token name returns just itself, no extra variants'
  );

  const q = CM.nameSearchQueries('John Bates Smith');
  check(q.includes('John Bates Smith'), 'always keeps the original full name as a baseline');
  check(q.includes('John Smith'), '"first + last only" variant drops the middle token — covers a real middle name');
  check(
    q.includes('John Bates Smith') && q.length === 2,
    '"first + everything else combined" variant coincides with the full name here (one middle token) — deduped to 2 total, not 3'
  );

  const q4 = CM.nameSearchQueries('John Michael Bates Smith');
  check(q4.includes('John Smith'), 'first + last only still drops ALL middle tokens with two middle names');
  check(
    q4.includes('John Michael Bates Smith'),
    'first + everything-else-combined keeps every middle token joined as one surname'
  );
  check(
    q4.length === 2,
    'with no title to strip, "first + everything else" is textually identical to the original — dedupes to 2, not 3'
  );

  // A leading title DOES make "first + everything else" diverge from the untouched original (the
  // title-stripped reconstruction vs. the raw string that still has "Mrs" in it) — the one case
  // where all three variants are genuinely distinct.
  const titled = CM.nameSearchQueries('Mrs John Bates Smith');
  check(
    titled.includes('Mrs John Bates Smith'),
    'the untouched original (including any title) is always kept as a baseline variant'
  );
  check(
    titled.includes('John Smith'),
    'a leading title is stripped before the first/last split, so it never gets treated as the first name'
  );
  check(
    titled.includes('John Bates Smith') && titled.length === 3,
    'title-stripped "first + everything else" differs from the untouched original here, so all 3 variants survive dedup'
  );

  check(CM.nameSearchQueries('').length === 0, 'empty name returns no queries');
  check(CM.nameSearchQueries(null).length === 0, 'is defensive against null');
  check(CM.nameSearchQueries('   ').length === 0, 'whitespace-only name returns no queries');
}

// ============================================================
// 2 — scoreCandidate: name + address dominate
// ============================================================
console.log('2: exact name + same address scores strong');
{
  const manualContact = { name: { first: 'Jane', last: 'Smith' }, phones: { mobile: '07911111111' } };
  const candidate = { patientId: 'p1', displayName: 'Jane Smith', atSameAddress: true, genderIdentity: 'Female' };
  const result = CM.scoreCandidate(manualContact, candidate, {
    manualRelationshipGuess: { baseId: 'mother' },
    indexPatientAge: 20,
  });
  check(result.tier === 'strong', 'exact name + same address + plausible age/gender for "mother" scores strong');
  check(result.score >= 70, `score (${result.score}) is >= the strong threshold`);
}

// ============================================================
// 3 — phone/email cannot dominate a poor name match (the explicit product caution)
// ============================================================
console.log('3: shared family email / wrong-record phone cannot rescue a bad name match');
{
  const manualContact = {
    name: { first: 'Jane', last: 'Smith' },
    email: 'family@example.com',
    phones: { mobile: '07911111111' },
  };
  const candidate = {
    patientId: 'p2',
    displayName: 'Someone Else Entirely',
    atSameAddress: false,
    email: 'family@example.com', // shared family email — the exact scenario the GP flagged
    phones: { mobile: '07911111111' }, // e.g. a child's record wrongly carrying a parent's own number
  };
  const result = CM.scoreCandidate(manualContact, candidate);
  check(
    result.tier === 'weak',
    `a name mismatch keeps the score weak (got ${result.score}) even with a phone+email hit`
  );
  check(result.score < 40, 'phone(5) + email(5) alone cannot reach the "possible" threshold (40) on their own');
}

// ============================================================
// 4 — gender mismatch is neutral, never zero
// ============================================================
console.log('4: gender mismatch never zeroes the signal');
{
  const manualContact = { name: { first: 'Alex', last: 'Jones' } };
  const matchingGender = CM.scoreCandidate(
    manualContact,
    { displayName: 'Alex Jones', genderIdentity: 'Female' },
    { manualRelationshipGuess: { baseId: 'mother' } }
  );
  const mismatchedGender = CM.scoreCandidate(
    manualContact,
    { displayName: 'Alex Jones', genderIdentity: 'Male' },
    { manualRelationshipGuess: { baseId: 'mother' } }
  );
  check(mismatchedGender.score < matchingGender.score, 'a gender mismatch scores lower than a match');
  check(
    mismatchedGender.score >= matchingGender.score - CM.WEIGHTS.gender / 2 - 1,
    'a gender mismatch only ever costs half the gender weight, never the full weight or more (never a hard filter)'
  );
}

// ============================================================
// 5 — age implausibility costs only the small age component
// ============================================================
console.log('5: implausible age for the relationship only costs the age weight');
{
  const manualContact = { name: { first: 'Pat', last: 'Doe' } };
  const plausible = CM.scoreCandidate(
    manualContact,
    { displayName: 'Pat Doe', age: 45 },
    { manualRelationshipGuess: { baseId: 'mother' }, indexPatientAge: 20 }
  );
  const implausible = CM.scoreCandidate(
    manualContact,
    { displayName: 'Pat Doe', age: 10 },
    { manualRelationshipGuess: { baseId: 'mother' }, indexPatientAge: 20 }
  );
  const diff = plausible.score - implausible.score;
  check(diff > 0, 'a candidate too young to be "Mother" scores lower than a plausible-age one');
  check(
    diff <= CM.WEIGHTS.age + 1,
    `the gap (${diff}) is bounded by the age weight (${CM.WEIGHTS.age}) alone, not a broader penalty`
  );
}

// ============================================================
// 6 — rankCandidates orders correctly
// ============================================================
console.log('6: rankCandidates sorts descending by score');
{
  const manualContact = { name: { first: 'Jane', last: 'Smith' } };
  const candidates = [
    { patientId: 'weak', displayName: 'Totally Different' },
    { patientId: 'strong', displayName: 'Jane Smith', atSameAddress: true },
  ];
  const ranked = CM.rankCandidates(manualContact, candidates);
  check(ranked[0].candidate.patientId === 'strong', 'the best match is ranked first');
  check(ranked[0].score >= ranked[1].score, 'scores are in descending order');
}

// ============================================================
// 7 — rankCandidates flags an ambiguous top result
// ============================================================
// Two people can be genuinely indistinguishable on the evidence available (father and son, same
// name, same address). Before this, both scored e.g. 90/"strong", ranked in input order, and the
// caller had nothing to tell it the ordering was arbitrary. `tied`/`margin` on the top result are
// purely additive — the existing per-result shape is unchanged.
console.log('7: rankCandidates exposes tie/margin on the top result');
{
  const manualContact = { name: { first: 'John', last: 'Smith' } };

  const indistinguishable = CM.rankCandidates(manualContact, [
    { patientId: 'father', displayName: 'John Smith', atSameAddress: true },
    { patientId: 'son', displayName: 'John Smith', atSameAddress: true },
  ]);
  check(indistinguishable[0].tied === true, 'two identically-scoring candidates flag the top result as tied');
  check(indistinguishable[0].margin === 0, 'an exact tie reports margin 0');
  check(
    indistinguishable[0].score === indistinguishable[1].score && indistinguishable[0].tier === 'strong',
    'both really are the same score and tier — the ordering between them carries no information'
  );

  // Near-tie: separated only by the email weight (5), the smallest single signal in the model.
  const nearTie = CM.rankCandidates({ name: { first: 'John', last: 'Smith' }, email: 'j@example.com' }, [
    { patientId: 'plain', displayName: 'John Smith', atSameAddress: true },
    { patientId: 'email', displayName: 'John Smith', atSameAddress: true, email: 'j@example.com' },
  ]);
  check(nearTie[0].candidate.patientId === 'email', 'the email hit still wins the sort');
  check(nearTie[0].margin === CM.WEIGHTS.email, `margin is the real point gap (got ${nearTie[0].margin})`);
  check(nearTie[0].tied === true, 'a gap of one weak signal is still flagged as ambiguous');

  const clear = CM.rankCandidates(manualContact, [
    { patientId: 'other', displayName: 'Totally Different' },
    { patientId: 'match', displayName: 'John Smith', atSameAddress: true },
  ]);
  check(clear[0].candidate.patientId === 'match', 'the clear winner ranks first');
  check(clear[0].tied === false, 'a clear winner is not flagged as tied');
  check(clear[0].margin === clear[0].score - clear[1].score, 'margin equals top score minus runner-up score');
  check(clear[0].margin > 5, `the gap (${clear[0].margin}) is wider than the tie margin`);

  const alone = CM.rankCandidates(manualContact, [{ patientId: 'only', displayName: 'John Smith' }]);
  check(alone[0].tied === false, 'a sole candidate has nothing to tie with');
  check(alone[0].margin === null, 'a sole candidate reports margin null — there is no runner-up to measure against');

  check(CM.rankCandidates(manualContact, []).length === 0, 'an empty candidate list still returns an empty array');

  // The existing result shape is untouched — content-script callers read these keys.
  const shape = clear[0];
  check(
    shape.candidate &&
      typeof shape.score === 'number' &&
      typeof shape.tier === 'string' &&
      Array.isArray(shape.signals),
    'candidate/score/tier/signals are all still present and unchanged in type'
  );
  check(clear[1].tied === undefined, 'the flags are added only to the top result, not to every entry');
}

// ============================================================
// 8 — non-British name-derivation matching (engine/name-derivations.js integration)
// ============================================================
// Unit coverage for the derivation logic itself lives in test-name-derivations.js — this section
// only pins that contact-match.js actually WIRES it in correctly (nameSimilarity treating
// gendered pairs as equivalent tokens; scoreCandidate's patronymic-father bonus), plus the
// negative case that matters most: an ordinary English family sharing an inherited "-son"
// surname must never get a spurious patronymic boost.
console.log('8: non-British name-derivation matching');
{
  check(
    CM.nameSimilarity('Anna Kowalska', 'Anna Kowalski') >= 0.9,
    'a Balto-Slavic gendered-surname pair scores as the same person, not a mismatch'
  );
  check(
    CM.nameSimilarity('Jan Novak', 'Jan Novakova') >= 0.9,
    'Czech unstripped male vs -ová appended female form also reaches the containment tier'
  );
  check(
    CM.nameSimilarity('Anna Kowalska', 'Anna Nowicka') < 0.9,
    'two DIFFERENT Polish families sharing only the female suffix shape do not falsely match'
  );

  // Patronymic father bonus — the manual contact's own free text has nothing to go on (no shared
  // surname exists in this naming system at all), so the signal has to come from the index
  // patient's own name instead.
  const fatherCandidate = { patientId: 'p20', displayName: 'Björn Einarsson', atSameAddress: false };
  const withoutIndexName = CM.scoreCandidate(
    { name: 'Unknown Father' },
    fatherCandidate,
    { manualRelationshipGuess: { baseId: 'father' } } // no indexPatientName supplied
  );
  const withIndexName = CM.scoreCandidate({ name: 'Unknown Father' }, fatherCandidate, {
    manualRelationshipGuess: { baseId: 'father' },
    indexPatientName: 'Karl Björnsson',
  });
  check(
    withIndexName.score > withoutIndexName.score,
    `the patronymic bonus raises the score once indexPatientName is supplied (${withoutIndexName.score} -> ${withIndexName.score})`
  );
  check(
    withIndexName.tier === 'strong' || withIndexName.tier === 'possible',
    `a correctly patronymic-matched father candidate is at least "possible" (got ${withIndexName.tier} @ ${withIndexName.score})`
  );

  // Only fires for 'father' — patronymics never encode the mother's name in either naming system
  // this covers.
  const motherGuess = CM.scoreCandidate({ name: 'Unknown Mother' }, fatherCandidate, {
    manualRelationshipGuess: { baseId: 'mother' },
    indexPatientName: 'Karl Björnsson',
  });
  check(
    motherGuess.score === withoutIndexName.score,
    'the same indexPatientName produces no bonus at all when the relationship being guessed is "mother", not "father"'
  );

  // The core false-positive risk: an ordinary English family's shared, INHERITED "-son" surname
  // must never be treated as a fresh per-generation patronymic.
  const englishFather = { patientId: 'p21', displayName: 'James Wilson', atSameAddress: false };
  const englishBonus = CM.scoreCandidate({ name: 'Unknown Father' }, englishFather, {
    manualRelationshipGuess: { baseId: 'father' },
    indexPatientName: 'Anna Wilson',
  });
  const englishNoBonus = CM.scoreCandidate({ name: 'Unknown Father' }, englishFather, {
    manualRelationshipGuess: { baseId: 'father' },
  });
  check(
    englishBonus.score === englishNoBonus.score,
    'an ordinary English "-son" family surname never triggers the patronymic bonus, even when a first name would coincidentally line up'
  );
}

// ============================================================
// 9 — gendered-surname derivation must not fire on ordinary British names
// ============================================================
// The derivation logic buys real matches for Balto-Slavic families, but it is worth NOTHING if it
// also pairs unrelated British names — a false name signal is 55 of the 100 points, which is
// exactly enough to promote "another person at this address" to a "strong" badge and point the GP
// at the wrong patient. Two separate guards are pinned here: the suffix/stem rules themselves, and
// the fact that derivation only ever applies to the SURNAME-position token — given names are
// compared by plain (fold-)equality, because "Martina" and "Martin" are two different people.
console.log('9: gendered-surname derivation never fires on ordinary British names');
{
  // The headline scenario: a sibling at the same address, badged "strong" as the manual contact.
  const household = CM.scoreCandidate(
    { name: 'Martina Brown' },
    { patientId: 'p30', displayName: 'Martin Brown', atSameAddress: true }
  );
  check(
    household.tier !== 'strong',
    `"Martina Brown" vs "Martin Brown" at the same address is not "strong" (got ${household.tier} @ ${household.score})`
  );
  check(household.score < 70, `the same-household sibling scores below the strong threshold (${household.score})`);

  const britishFalsePairs = [
    ['Martin', 'Martina'],
    ['Martin', 'Martinez'],
    ['Colin', 'Collins'],
    ['Robin', 'Roberts'],
    ['Austin', 'Austen'],
    ['Jenkin', 'Jenkins'],
    ['Griffin', 'Griffiths'],
    ['Georgina', 'George'],
    ['Christina', 'Christopher'],
    ['Carolina', 'Caroline'],
  ];
  for (const [a, b] of britishFalsePairs) {
    check(
      CM.nameSimilarity(`John ${a}`, `John ${b}`) < 0.9,
      `"${a}"/"${b}" in surname position does not reach the containment tier`
    );
  }

  // Derivation is surname-only: the same Balto-Slavic pairing that legitimately matches in surname
  // position must NOT match when the tokens sit in the given-name slot.
  check(
    CM.nameSimilarity('Ivanova Smith', 'Ivanov Smith') < 0.9,
    'a gendered-surname pairing in the GIVEN-name position is not treated as the same name'
  );
  check(
    CM.nameSimilarity('Anna Ivanova', 'Anna Ivanov') >= 0.9,
    '...while the identical pairing in surname position still matches'
  );

  // The genuine positives, both argument orders, still land in the containment tier.
  const genuine = [
    ['Anna Kowalska', 'Anna Kowalski'],
    ['Jan Novak', 'Jan Novakova'],
    ['Ona Kazlauskienė', 'Ona Kazlauskas'],
    ['Ivan Medvedev', 'Ivan Medvedeva'],
  ];
  for (const [a, b] of genuine) {
    check(CM.nameSimilarity(a, b) >= 0.9, `"${a}" vs "${b}" still matches at the containment tier`);
    check(CM.nameSimilarity(b, a) >= 0.9, `"${b}" vs "${a}" matches in the reverse order too`);
  }
  const kowalski = CM.scoreCandidate(
    { name: 'Anna Kowalska' },
    { patientId: 'p31', displayName: 'Anna Kowalski', atSameAddress: true }
  );
  check(kowalski.tier === 'strong', 'a genuine gendered pair at the same address is still badged "strong"');
}

// ============================================================
// 10 — the patronymic father bonus is bounded, corroborated, gendered and labelled
// ============================================================
// The bonus replaced the name signal with a flat 1.0 — ABOVE the 0.9 an exact whole-token
// containment earns — so a derivation, which is a guess about a naming system, outranked hard
// evidence and reached "strong" (70) on its own with nothing else agreeing. It also fired for
// female candidates and for ordinary "-son" surnames via 3-letter stems.
console.log('10: the patronymic father bonus is capped, corroborated, gendered and labelled');
{
  const nameSignalOf = (r) => r.signals.find((s) => s.id === 'name');
  const fatherOpts = { manualRelationshipGuess: { baseId: 'father' }, indexPatientName: 'Karl Björnsson' };

  const patronymicOnly = CM.scoreCandidate(
    { name: 'Unknown Father' },
    { patientId: 'p40', displayName: 'Björn Einarsson' },
    fatherOpts
  );
  check(
    nameSignalOf(patronymicOnly).value <= 0.9,
    `the derived bonus never exceeds the 0.9 an exact containment earns (got ${nameSignalOf(patronymicOnly).value})`
  );
  check(
    patronymicOnly.tier !== 'strong',
    `a patronymic-only hit with nothing corroborating it stays below "strong" (got ${patronymicOnly.tier} @ ${patronymicOnly.score})`
  );
  check(
    patronymicOnly.tier === 'possible',
    'it is still surfaced as "possible" — the derivation is real evidence, just not decisive on its own'
  );

  // Labelled, so the UI could caveat it. Additive only — the existing signal shape is untouched.
  check(nameSignalOf(patronymicOnly).derivation === 'patronymic', 'the name signal is labelled as a derivation');
  check(
    typeof nameSignalOf(patronymicOnly).weight === 'number' && typeof nameSignalOf(patronymicOnly).value === 'number',
    'the existing id/weight/value shape of the signal entry is unchanged'
  );
  check(patronymicOnly.signals.length === 6, 'the signals array still has exactly its six existing entries');
  const plain = CM.scoreCandidate({ name: 'Jane Smith' }, { patientId: 'p41', displayName: 'Jane Smith' });
  check(
    nameSignalOf(plain).derivation === undefined,
    'an ordinary name signal carries no derivation label at all — the field is additive'
  );

  // Corroboration lifts the same candidate: the derivation was never the problem, standing alone was.
  const corroborated = CM.scoreCandidate(
    { name: 'Unknown Father' },
    { patientId: 'p42', displayName: 'Björn Einarsson', atSameAddress: true },
    fatherOpts
  );
  check(
    corroborated.tier === 'strong',
    `the same derivation WITH an address match is still "strong" (got ${corroborated.tier} @ ${corroborated.score})`
  );

  // (c) A recorded-female candidate is never anyone's patronymic father.
  const femaleCandidate = { patientId: 'p43', displayName: 'Karla Smith', genderIdentity: 'Female' };
  const female = CM.scoreCandidate({ name: 'Unknown Father' }, femaleCandidate, {
    manualRelationshipGuess: { baseId: 'father' },
    indexPatientName: 'Anna Karlsdottir',
  });
  check(nameSignalOf(female).value === 0, 'a recorded-female candidate gets no father bonus at all');
  check(nameSignalOf(female).derivation === undefined, 'and no derivation label either');
  const unrecordedGender = CM.scoreCandidate(
    { name: 'Unknown Father' },
    { patientId: 'p44', displayName: 'Karl Smith' },
    { manualRelationshipGuess: { baseId: 'father' }, indexPatientName: 'Anna Karlsdottir' }
  );
  check(
    nameSignalOf(unrecordedGender).derivation === 'patronymic',
    'an unrecorded gender still passes — absence of evidence is not evidence of absence'
  );

  // (d) Ordinary surnames must not derive a father through a 3-letter stem.
  const crossonCandidate = { patientId: 'p45', displayName: 'Cronan Byrne' };
  const crosson = CM.scoreCandidate({ name: 'Unknown Father' }, crossonCandidate, {
    manualRelationshipGuess: { baseId: 'father' },
    indexPatientName: 'Aoife Crosson',
  });
  const crossonNoIndex = CM.scoreCandidate({ name: 'Unknown Father' }, crossonCandidate, {
    manualRelationshipGuess: { baseId: 'father' },
  });
  check(
    crosson.score === crossonNoIndex.score,
    `"Crosson" derives no father, so "Cronan" gets no bonus (got ${crosson.score} vs ${crossonNoIndex.score})`
  );
  check(crosson.tier !== 'strong', `and certainly not a "strong" badge (got ${crosson.tier} @ ${crosson.score})`);
}

// ============================================================
// 11 — dropped diacritics and Unicode normalisation form
// ============================================================
// The headline case the whole name-handling effort exists for: a GP2GP import or a hand-typed
// contact drops the accents. "Anna Nováková" and "Anna Novakova" are the same person and must
// score as an exact match, not 0.33. Separately, the same name in NFD (combining marks) vs NFC
// (precomposed) has to tokenise identically — \p{L} does not match \p{M}, so NFD input was being
// shredded at the tokenising step before any comparison ran.
console.log('11: accent-dropped and NFD-normalised names compare as identical');
{
  check(CM.nameSimilarity('Anna Nováková', 'Anna Novakova') === 1, 'accent-dropped Czech name scores an exact match');
  check(CM.nameSimilarity('Hans Müller', 'Hans Muller') === 1, 'accent-dropped German name scores an exact match');
  check(
    CM.nameSimilarity('Björn Jónsson', 'Bjorn Jonsson') === 1,
    'accent-dropped Icelandic name scores an exact match'
  );

  const nfc = 'Anna Nováková'.normalize('NFC');
  const nfd = 'Anna Nováková'.normalize('NFD');
  const mixed = 'Anna'.normalize('NFD') + ' ' + 'Nováková'.normalize('NFC');
  check(nfc !== nfd, 'the two normalisation forms really are different strings (test is meaningful)');
  check(CM.nameSimilarity(nfc, nfd) === 1, 'NFC vs NFD of the identical name scores 1');
  check(CM.nameSimilarity(nfd, nfd) === 1, 'NFD vs itself scores 1');
  check(CM.nameSimilarity(mixed, nfc) === 1, 'a mixed-form name scores 1 against the composed form');
  check(CM.nameSimilarity(nfd, 'Anna Novakova') === 1, 'NFD vs the accent-dropped ASCII spelling also scores 1');

  // Fold-equality counts as an exact TOKEN match everywhere, not just for whole-name equality.
  check(
    CM.nameSimilarity('Anna Marie Nováková', 'Anna Novakova') >= 0.9,
    'a fold-equal surname token still satisfies whole-token containment'
  );
  check(
    CM.nameSimilarity('Anna Nováková', 'Beata Novakova') === CM.nameSimilarity('Anna Novakova', 'Beata Novakova'),
    'and scores identically in the Jaccard band, accented or not'
  );

  // No ordinary-ASCII regression.
  check(CM.nameSimilarity('Jane Smith', 'Jane Smith') === 1, 'plain ASCII exact match is unaffected');
  check(CM.nameSimilarity('Jane Smith', 'John Doe') < 0.3, 'unrelated ASCII names still score low');
  check(CM.nameSimilarity('Ann', 'Annette') < 0.3, 'the substring guard still holds');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
