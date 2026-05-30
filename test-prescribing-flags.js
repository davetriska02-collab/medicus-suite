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

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
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

const texts = (items) => items.map(i => i.text);

console.log('\n--- NSAID + anticoagulant ---');
let r = evaluate(['Ibuprofen 400mg tablets', 'Apixaban 5mg tablets'], 60);
check(texts(r).includes('NSAID + anticoagulant'), 'fires for ibuprofen + apixaban');
check(r.every(i => i.severity === 'amber'), 'flagged amber');

r = evaluate(['Naproxen 500mg', 'Warfarin 3mg'], 72);
check(texts(r).includes('NSAID + anticoagulant'), 'fires for naproxen + warfarin');

console.log('\n--- topical NSAID should NOT count ---');
r = evaluate(['Ibuprofen gel', 'Apixaban 5mg tablets'], 60);
check(!texts(r).includes('NSAID + anticoagulant'), 'topical ibuprofen gel + anticoagulant does NOT fire');

console.log('\n--- NSAID + antiplatelet ---');
r = evaluate(['Diclofenac 50mg', 'Clopidogrel 75mg'], 55);
check(texts(r).includes('NSAID + antiplatelet'), 'fires for diclofenac + clopidogrel');
r = evaluate(['Diclofenac 50mg', 'Apixaban 5mg', 'Aspirin 75mg'], 55);
check(texts(r).includes('NSAID + anticoagulant') && !texts(r).includes('NSAID + antiplatelet'),
  'anticoag branch takes precedence over antiplatelet (no double-flag)');

console.log('\n--- triple whammy ---');
r = evaluate(['Naproxen 250mg', 'Ramipril 5mg', 'Furosemide 40mg'], 68);
check(texts(r).some(t => t.startsWith('Triple whammy')), 'fires for NSAID + ACEi + loop diuretic');
r = evaluate(['Losartan 50mg', 'Indapamide 2.5mg'], 68);
check(!texts(r).some(t => t.startsWith('Triple whammy')), 'ARB + diuretic WITHOUT NSAID does not fire');

console.log('\n--- benzodiazepine / Z-drug in the elderly ---');
r = evaluate(['Zopiclone 7.5mg'], 84);
check(texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'zopiclone fires at age 84');
r = evaluate(['Diazepam 2mg'], 65);
check(!texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'does NOT fire under 80');
r = evaluate(['Zopiclone 7.5mg'], null);
check(!texts(r).includes('Benzodiazepine/Z-drug in age ≥80'), 'does NOT fire when age unknown (needs known ≥80)');

console.log('\n--- clean list ---');
r = evaluate(['Amlodipine 5mg', 'Atorvastatin 20mg', 'Paracetamol 1g'], 70);
check(r.length === 0, 'no flags for an unremarkable list');
r = evaluate([], 70);
check(r.length === 0, 'no flags for empty med list');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
