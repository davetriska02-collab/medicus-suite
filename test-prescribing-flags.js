// Medicus Suite — STOPP/START prescribing-flag tests
// Run with: node test-prescribing-flags.js
//
// vm-extracts the pure evaluatePrescribingFlags(meds, age) helper from
// content.js (same Layer-2 pattern as test-monitoring-chip.js) and asserts the
// deterministic combination checks fire / don't fire correctly.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
const fnMatch = src.match(/function evaluatePrescribingFlags\(meds, age\) \{[\s\S]*?\n  \}/);
check(!!fnMatch, 'evaluatePrescribingFlags extracted from content.js');

let evaluate = null;
if (fnMatch) {
  const sandbox = {};
  vm.runInNewContext(fnMatch[0] + '\nthis.evaluatePrescribingFlags = evaluatePrescribingFlags;', sandbox);
  evaluate = sandbox.evaluatePrescribingFlags;
  check(typeof evaluate === 'function', 'extracted helper is callable');
}

const texts = (items) => items.map((i) => i.text);

console.log('\n--- NSAID + anticoagulant ---');
let r = evaluate(['Ibuprofen 400mg tablets', 'Apixaban 5mg tablets'], 60);
check(texts(r).includes('NSAID + anticoagulant'), 'fires for ibuprofen + apixaban');
check(
  r.every((i) => i.severity === 'amber'),
  'flagged amber'
);

r = evaluate(['Naproxen 500mg', 'Warfarin 3mg'], 72);
check(texts(r).includes('NSAID + anticoagulant'), 'fires for naproxen + warfarin');

console.log('\n--- extended UK oral NSAID coverage (The Keeper completion) ---');
// Previously-missing UK oral NSAIDs must now fire the NSAID combos, else a
// patient on one silently never triggers any NSAID prescribing flag.
for (const nsaid of [
  'Tiaprofenic acid 300mg',
  'Tolfenamic acid 200mg',
  'Dexketoprofen 25mg',
  'Fenoprofen 300mg',
  'Tenoxicam 20mg',
  'Sulindac 200mg',
  'Nabumetone 500mg',
  // 2026-06-11 Keeper: previously absent from the NSAIDS regex entirely.
  'Etodolac 600mg SR',
  'Flurbiprofen 100mg',
  // covered by the 'ibuprofen'/'ketoprofen' substrings — locks that coverage.
  'Dexibuprofen 400mg',
]) {
  r = evaluate([nsaid, 'Apixaban 5mg tablets'], 60);
  check(texts(r).includes('NSAID + anticoagulant'), `fires for ${nsaid.split(' ')[0]} + apixaban`);
}

console.log('\n--- topical NSAID should NOT count ---');
r = evaluate(['Ibuprofen gel', 'Apixaban 5mg tablets'], 60);
check(!texts(r).includes('NSAID + anticoagulant'), 'topical ibuprofen gel + anticoagulant does NOT fire');

console.log('\n--- NSAID + antiplatelet ---');
r = evaluate(['Diclofenac 50mg', 'Clopidogrel 75mg'], 55);
check(texts(r).includes('NSAID + antiplatelet'), 'fires for diclofenac + clopidogrel');
r = evaluate(['Diclofenac 50mg', 'Apixaban 5mg', 'Aspirin 75mg'], 55);
check(
  texts(r).includes('NSAID + anticoagulant') && !texts(r).includes('NSAID + antiplatelet'),
  'anticoag branch takes precedence over antiplatelet (no double-flag)'
);

console.log('\n--- triple whammy ---');
r = evaluate(['Naproxen 250mg', 'Ramipril 5mg', 'Furosemide 40mg'], 68);
check(
  texts(r).some((t) => t.startsWith('Triple whammy')),
  'fires for NSAID + ACEi + loop diuretic'
);
r = evaluate(['Losartan 50mg', 'Indapamide 2.5mg'], 68);
check(!texts(r).some((t) => t.startsWith('Triple whammy')), 'ARB + diuretic WITHOUT NSAID does not fire');
// 2026-06-11 Keeper: cilazapril added to ACEI_ARB (legacy UK ACEi on repeats).
r = evaluate(['Ibuprofen 400mg', 'Cilazapril 1mg', 'Bendroflumethiazide 2.5mg'], 70);
check(
  texts(r).some((t) => t.startsWith('Triple whammy')),
  'fires for NSAID + cilazapril + thiazide'
);
// 2026-06-11 Keeper: frusemide (old UK spelling) added to DIURETIC.
r = evaluate(['Naproxen 250mg', 'Ramipril 5mg', 'Frusemide 40mg'], 68);
check(
  texts(r).some((t) => t.startsWith('Triple whammy')),
  'fires for NSAID + ACEi + frusemide (old spelling)'
);

console.log('\n--- benzodiazepine / Z-drug in the elderly ---');
r = evaluate(['Zopiclone 7.5mg'], 84);
check(texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'zopiclone fires at age 84');
r = evaluate(['Diazepam 2mg'], 65);
check(!texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'does NOT fire under 80');
r = evaluate(['Zopiclone 7.5mg'], null);
check(!texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'does NOT fire when age unknown (needs known ≥80)');

console.log('\n--- PINCER #1: NSAID in age ≥65 without gastroprotection (KD-32 resolution) ---');
// Fires: systemic NSAID + age 70, no PPI/H2-blocker
r = evaluate(['Ibuprofen 400mg'], 70);
check(
  texts(r).includes('NSAID in age ≥65 without gastroprotection'),
  'PINCER #1 fires: NSAID + age 70, no gastroprotection'
);
check(
  r.find((i) => i.text === 'NSAID in age ≥65 without gastroprotection')?.severity === 'amber',
  'PINCER #1 flagged amber'
);

// Does NOT fire when PPI present
r = evaluate(['Ibuprofen 400mg', 'Omeprazole 20mg'], 70);
check(!texts(r).includes('NSAID in age ≥65 without gastroprotection'), 'PINCER #1 suppressed by omeprazole');

// Does NOT fire when H2-blocker present
r = evaluate(['Naproxen 500mg', 'Famotidine 20mg'], 70);
check(
  !texts(r).includes('NSAID in age ≥65 without gastroprotection'),
  'PINCER #1 suppressed by famotidine (H2-blocker)'
);

// Does NOT fire when age < 65
r = evaluate(['Ibuprofen 400mg'], 60);
check(!texts(r).includes('NSAID in age ≥65 without gastroprotection'), 'PINCER #1 does NOT fire at age 60');

// Does NOT fire when age unknown (fail-closed)
r = evaluate(['Ibuprofen 400mg'], null);
check(
  !texts(r).includes('NSAID in age ≥65 without gastroprotection'),
  'PINCER #1 does NOT fire when age null (fail-closed)'
);

// Does NOT fire for topical NSAID
r = evaluate(['Ibuprofen gel 5%'], 70);
check(!texts(r).includes('NSAID in age ≥65 without gastroprotection'), 'PINCER #1 does NOT fire for topical NSAID');

// Fires at the threshold age (65)
r = evaluate(['Diclofenac 50mg'], 65);
check(texts(r).includes('NSAID in age ≥65 without gastroprotection'), 'PINCER #1 fires at the threshold age 65');

// Combined: NSAID + anticoag + age ≥65 + no gastroprotection → both rules fire independently
// NSAID+anticoag (drug interaction) and NSAID≥65 without gastroprotection (PINCER#1) are distinct
// risks — both are valid and clinically actionable simultaneously.
r = evaluate(['Ibuprofen 400mg', 'Warfarin 5mg'], 70);
check(
  texts(r).includes('NSAID + anticoagulant') && texts(r).includes('NSAID in age ≥65 without gastroprotection'),
  'NSAID+anticoag+age70+no_gastropro: both anticoag rule and PINCER#1 fire (intentional double-flag)'
);
r = evaluate(['Ibuprofen 400mg', 'Warfarin 5mg', 'Omeprazole 20mg'], 70);
check(
  texts(r).includes('NSAID + anticoagulant') && !texts(r).includes('NSAID in age ≥65 without gastroprotection'),
  'NSAID+anticoag+age70+omeprazole: anticoag rule fires, PINCER#1 suppressed by PPI'
);

console.log('\n--- clean list ---');
r = evaluate(['Amlodipine 5mg', 'Atorvastatin 20mg', 'Paracetamol 1g'], 70);
check(r.length === 0, 'no flags for an unremarkable list');
r = evaluate([], 70);
check(r.length === 0, 'no flags for empty med list');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
