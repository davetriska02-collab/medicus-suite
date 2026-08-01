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
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
