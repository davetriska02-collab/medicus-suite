// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Queue Pharmacy First chip must not first-match-win on male/ambiguous UTI.

'use strict';

const { matchPathways, pharmacyFirstEligibility, queuePharmacyFirstSafe, redFlagGaps } = require('./engine/reception-match.js');
const doc = require('./rules/reception-pathways.json');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const PATHWAYS = doc.pathways || [];

console.log('\n--- queue Pharmacy First safety ---');
{
  const text = 'burning when passing urine uti';
  const matched = matchPathways(text, PATHWAYS);
  const urinary = matched.find((p) => p.id === 'urinary');
  const pf = pharmacyFirstEligibility(urinary, 45);
  const gaps = redFlagGaps(urinary, text);
  check(pf.eligible === true, 'age 45 on urinary is age-eligible for Pharmacy First');
  check(matched.some((p) => p.id === 'gu-male'), 'generic UTI also matches gu-male');
  check(queuePharmacyFirstSafe(matched, gaps) === false, 'dual GU match blocks the queue PF chip');
}
{
  const text = 'sore throat for three days';
  const matched = matchPathways(text, PATHWAYS);
  const top = matched[0];
  const pf = pharmacyFirstEligibility(top, 20);
  const gaps = redFlagGaps(top, text);
  check(top && top.id === 'sore-throat', 'sore throat is the top match');
  check(pf.eligible === true, 'age 20 on sore-throat is age-eligible');
  check(queuePharmacyFirstSafe(matched, gaps) === true, 'unambiguous PF pathway can still show the chip when no red flag volunteered');
}
{
  const text = 'urinary symptoms for two days';
  const matched = matchPathways(text, PATHWAYS);
  const urinary = matched.find((p) => p.id === 'urinary');
  const gaps = redFlagGaps(urinary, text);
  check(matched.some((p) => p.id === 'urinary'), 'urinary-symptoms wording matches urinary');
  check(queuePharmacyFirstSafe(matched, gaps) === false, 'unanswered rf-male-child on a UTI row blocks the queue PF chip');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
