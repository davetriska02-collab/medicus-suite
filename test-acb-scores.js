// test-acb-scores.js — ACB scorer unit tests
// Run with: node test-acb-scores.js
'use strict';

const { computeACB } = require('./engine/acb-scores.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── Individual drug scores ─────────────────────────────────────────────────
console.log('\n--- Individual drug scores ---');
{
  const r = computeACB(['amitriptyline']);
  assert(r.perDrug.length === 1, 'amitriptyline yields one entry');
  assert(r.perDrug[0].score === 3, 'amitriptyline scores 3');
  assert(r.total === 3, 'amitriptyline total = 3');
}
{
  const r = computeACB(['oxybutynin']);
  assert(r.perDrug[0].score === 3, 'oxybutynin scores 3');
}
{
  // Brand name: Vesicare → solifenacin
  const r = computeACB(['Vesicare 5mg tablets']);
  assert(r.perDrug.length === 1, 'Vesicare yields one entry');
  assert(r.perDrug[0].score === 3, 'Vesicare scores 3 (solifenacin)');
  assert(r.perDrug[0].matchedTerm === 'vesicare', 'Vesicare matchedTerm is "vesicare"');
}
{
  // medrev-005: amoxapine (tricyclic) — ACB score 2
  const r = computeACB(['amoxapine 50mg tablets']);
  assert(r.perDrug.length === 1, 'amoxapine yields one entry');
  assert(r.perDrug[0].score === 2, 'amoxapine scores 2');
  assert(r.perDrug[0].matchedTerm === 'amoxapine', 'amoxapine matchedTerm is "amoxapine"');
}
{
  const r = computeACB(['cetirizine']);
  assert(r.perDrug[0].score === 1, 'cetirizine scores 1');
}
{
  const r = computeACB(['loratadine']);
  assert(r.perDrug[0].score === 1, 'loratadine scores 1');
}

// ── Case-insensitivity ─────────────────────────────────────────────────────
console.log('\n--- Case-insensitivity ---');
{
  const r = computeACB(['AMITRIPTYLINE 10mg tablets']);
  assert(r.perDrug[0].score === 3, 'AMITRIPTYLINE (uppercase) scores 3');
}
{
  const r = computeACB(['Oxybutynin Hydrochloride 5mg']);
  assert(r.perDrug[0].score === 3, 'Mixed-case Oxybutynin scores 3');
}

// ── Total summation and alert flag ─────────────────────────────────────────
console.log('\n--- Total summation and alert ---');
{
  const r = computeACB(['amitriptyline', 'oxybutynin', 'cetirizine']);
  // 3 + 3 + 1 = 7
  assert(r.total === 7, 'amitriptyline(3) + oxybutynin(3) + cetirizine(1) = 7');
  assert(r.alert === true, 'total 7 → alert=true');
}
{
  const r = computeACB(['cetirizine', 'loratadine']);
  // 1 + 1 = 2
  assert(r.total === 2, 'cetirizine(1) + loratadine(1) = 2');
  assert(r.alert === false, 'total 2 → alert=false (below threshold)');
}
{
  // Exactly 3 — boundary
  const r = computeACB(['amitriptyline']);
  assert(r.total === 3, 'amitriptyline total = 3');
  assert(r.alert === true, 'total 3 → alert=true (at threshold)');
}

// ── Longest-match-wins (no double counting) ────────────────────────────────
console.log('\n--- Longest-match-wins (no double counting) ---');
{
  // "chlorphenamine maleate" contains "chlorphenamine" (score 3) but also
  // contains no shorter term that would double-count. Should yield score 3 × 1.
  const r = computeACB(['chlorphenamine maleate 4mg tablets']);
  assert(r.perDrug.length === 1, 'chlorphenamine maleate → exactly 1 entry (no double count)');
  assert(r.total === 3, 'chlorphenamine maleate total = 3');
}
{
  // A drug that happens to contain a term from a different entry — e.g.
  // "prednisolone" (score 1). Should match only once.
  const r = computeACB(['prednisolone 5mg']);
  assert(r.perDrug.length === 1, 'prednisolone → exactly 1 entry');
  assert(r.perDrug[0].score === 1, 'prednisolone scores 1');
}

// ── Unknown drug → score 0 ────────────────────────────────────────────────
console.log('\n--- Unknown drug ---');
{
  const r = computeACB(['omeprazole 20mg']);
  assert(r.perDrug.length === 0, 'omeprazole not in ACB table → no entry');
  assert(r.total === 0, 'omeprazole total = 0');
  assert(r.alert === false, 'omeprazole alert = false');
}
{
  const r = computeACB([]);
  assert(r.total === 0, 'empty drug list → total = 0');
  assert(r.alert === false, 'empty drug list → alert = false');
}

// ── Object input (label property) ────────────────────────────────────────
console.log('\n--- Object input (label property) ---');
{
  const r = computeACB([{ label: 'Amitriptyline 10mg' }, { label: 'Furosemide 40mg' }]);
  assert(r.perDrug.length === 2, 'two matched drugs from label objects');
  assert(r.total === 4, 'amitriptyline(3) + furosemide(1) = 4');
}

// ── Brand names (Detrusitol, Ditropan, Emselex, Adasuve, Tegretol) ───────
console.log('\n--- UK brand names ---');
{
  const r = computeACB(['Detrusitol 2mg tablets']);
  assert(r.perDrug.length === 1, 'Detrusitol (tolterodine brand) yields 1 entry');
  assert(r.perDrug[0].score === 3, 'Detrusitol scores 3');
}
{
  const r = computeACB(['Ditropan 5mg tablets']);
  assert(r.perDrug.length === 1, 'Ditropan (oxybutynin brand) yields 1 entry');
  assert(r.perDrug[0].score === 3, 'Ditropan scores 3');
}
{
  // medrev-002: darifenacin (urological antimuscarinic) — ACB score 3
  const r = computeACB(['darifenacin 7.5mg tablets']);
  assert(r.perDrug.length === 1, 'darifenacin yields 1 entry');
  assert(r.perDrug[0].score === 3, 'darifenacin scores 3');
}
{
  // medrev-002: Emselex — UK brand of darifenacin
  const r = computeACB(['Emselex 7.5mg prolonged-release tablets']);
  assert(r.perDrug.length === 1, 'Emselex (darifenacin brand) yields 1 entry');
  assert(r.perDrug[0].score === 3, 'Emselex scores 3');
  assert(r.perDrug[0].matchedTerm === 'emselex', 'Emselex matchedTerm is "emselex"');
}
{
  // medrev-003: carbamazepine — ACB score 2 (Boustani 2012)
  const r = computeACB(['carbamazepine 200mg tablets']);
  assert(r.perDrug.length === 1, 'carbamazepine yields 1 entry');
  assert(r.perDrug[0].score === 2, 'carbamazepine scores 2');
}
{
  // medrev-003: Tegretol — UK brand of carbamazepine
  const r = computeACB(['Tegretol Prolonged Release 400mg tablets']);
  assert(r.perDrug.length === 1, 'Tegretol (carbamazepine brand) yields 1 entry');
  assert(r.perDrug[0].score === 2, 'Tegretol scores 2');
  assert(r.perDrug[0].matchedTerm === 'tegretol', 'Tegretol matchedTerm is "tegretol"');
}
{
  // medrev-003: Carbagen SR — UK brand of carbamazepine SR
  const r = computeACB(['Carbagen SR 200mg tablets']);
  assert(r.perDrug.length === 1, 'Carbagen SR (carbamazepine brand) yields 1 entry');
  assert(r.perDrug[0].score === 2, 'Carbagen scores 2');
  assert(r.perDrug[0].matchedTerm === 'carbagen', 'Carbagen matchedTerm is "carbagen"');
}
{
  // medrev-004: loxapine — dibenzoxazepine antipsychotic, ACB score 3 (confidence medium)
  const r = computeACB(['loxapine 25mg capsules']);
  assert(r.perDrug.length === 1, 'loxapine yields 1 entry');
  assert(r.perDrug[0].score === 3, 'loxapine scores 3');
}
{
  // medrev-004: Adasuve — UK brand of loxapine (inhaled)
  const r = computeACB(['Adasuve 9.1mg inhalation powder']);
  assert(r.perDrug.length === 1, 'Adasuve (loxapine brand) yields 1 entry');
  assert(r.perDrug[0].score === 3, 'Adasuve scores 3');
  assert(r.perDrug[0].matchedTerm === 'adasuve', 'Adasuve matchedTerm is "adasuve"');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
