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
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
