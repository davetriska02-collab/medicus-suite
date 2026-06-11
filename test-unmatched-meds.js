// Medicus Suite — Unmatched medications audit tests
// Run with: node test-unmatched-meds.js
//
// Exercises listUnmatchedMedications() in engine/rules-engine.js.
// Verifies that:
//   - A med matched by a generic term is NOT listed (generic covers qualified forms)
//   - An unknown brand name IS listed
//   - A med suppressed by an exclude term IS listed (exclude = not covered)
//   - A disabled rule does NOT count as coverage
//   - Deduplication is case-insensitive
//   - Empty medications → empty list

'use strict';
const engine = require('./engine/rules-engine.js');
const { listUnmatchedMedications } = engine;

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else       { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function med(name, startDate) {
  return { name, startDate: startDate || null };
}

function drugRule(id, matchTerms, excludeTerms, enabled) {
  const rule = {
    id,
    type: 'drug-monitoring',
    drug: { match: matchTerms, exclude: excludeTerms || [] },
    tests: [],
  };
  if (enabled === false) rule.enabled = false;
  return rule;
}

// ── 1. Generic term covers qualified generic forms ────────────────────────────

console.log('\n--- generic term covers qualified forms ---');

{
  // A rule matching "lithium" should cover "Lithium carbonate 400mg tablets"
  const rules = [ drugRule('lithium-001', ['lithium']) ];
  const meds  = [ med('Lithium carbonate 400mg tablets'), med('Lithium citrate oral solution') ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(unmatched.length === 0, '"lithium" rule covers "Lithium carbonate 400mg tablets"');
  check(!unmatched.some(n => /lithium/i.test(n)), 'no lithium variant in unmatched list');
}

// ── 2. Unknown brand is listed ────────────────────────────────────────────────

console.log('\n--- unknown brand is listed ---');

{
  // A rule matching "methotrexate" will NOT match "Methofar" (hypothetical brand)
  const rules = [ drugRule('mtx-001', ['methotrexate']) ];
  const meds  = [ med('methotrexate 2.5mg tablets'), med('Methofar 2.5mg tablets') ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(unmatched.some(n => n === 'Methofar 2.5mg tablets'),
    '"Methofar" (unrecognised brand) is in the unmatched list');
  check(!unmatched.some(n => /methotrexate/i.test(n)),
    '"methotrexate" itself is NOT in the unmatched list (matched by rule)');
}

// ── 3. Excluded med is listed ─────────────────────────────────────────────────

console.log('\n--- excluded med is in unmatched list ---');

{
  // A rule matching "methotrexate" but excluding "injection" means
  // "methotrexate 50mg/2ml injection" is excluded and should appear as unmatched.
  const rules = [ drugRule('mtx-001', ['methotrexate'], ['injection']) ];
  const meds  = [
    med('methotrexate 2.5mg tablets'),    // matched (no exclude)
    med('methotrexate 50mg/2ml injection'), // excluded — not covered
  ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(unmatched.some(n => /injection/i.test(n)),
    'excluded med (injection) appears in unmatched list');
  check(!unmatched.some(n => n === 'methotrexate 2.5mg tablets'),
    'non-excluded form is NOT in unmatched list');
}

// ── 4. Disabled rule does not count as coverage ───────────────────────────────

console.log('\n--- disabled rule does not count ---');

{
  const rules = [ drugRule('mtx-001', ['methotrexate'], [], false) ]; // disabled
  const meds  = [ med('methotrexate 2.5mg tablets') ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(unmatched.some(n => /methotrexate/i.test(n)),
    'med covered only by a disabled rule appears as unmatched');
}

{
  // One disabled, one enabled — enabled rule provides coverage
  const rules = [
    drugRule('mtx-001', ['methotrexate'], [], false),  // disabled
    drugRule('mtx-002', ['methotrexate'], [], true),   // enabled
  ];
  const meds = [ med('methotrexate 2.5mg tablets') ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(!unmatched.some(n => /methotrexate/i.test(n)),
    'enabled rule provides coverage even if another disabled rule also matches');
}

// ── 5. Deduplication ─────────────────────────────────────────────────────────

console.log('\n--- deduplication ---');

{
  const rules = [ drugRule('mtx-001', ['methotrexate']) ];
  const meds  = [
    med('Aspirin 75mg tablets'),
    med('ASPIRIN 75mg Tablets'),  // same med, different case
    med('aspirin 75mg tablets'),  // third variant
  ];
  const unmatched = listUnmatchedMedications(meds, rules);
  // All three are unmatched (no aspirin rule), but deduplication keeps only one
  const aspirinEntries = unmatched.filter(n => /aspirin/i.test(n));
  check(aspirinEntries.length === 1, 'case-insensitive dedup: only one aspirin entry');
}

// ── 6. Empty meds → empty list ────────────────────────────────────────────────

console.log('\n--- empty input ---');

{
  const rules = [ drugRule('mtx-001', ['methotrexate']) ];
  check(listUnmatchedMedications([], rules).length === 0, 'empty meds → empty list');
  check(listUnmatchedMedications(null, rules).length === 0, 'null meds → empty list');
}

{
  const meds = [ med('Aspirin 75mg tablets') ];
  check(listUnmatchedMedications(meds, []).length === 1, 'empty rules → all meds unmatched');
  check(listUnmatchedMedications(meds, null).length === 1, 'null rules → all meds unmatched');
}

// ── 7. Alphabetical stable order ─────────────────────────────────────────────

console.log('\n--- output is alphabetically sorted ---');

{
  const rules = [];
  const meds  = [ med('Warfarin 5mg'), med('Aspirin 75mg'), med('Digoxin 62.5mcg') ];
  const unmatched = listUnmatchedMedications(meds, rules);
  check(unmatched[0] === 'Aspirin 75mg' && unmatched[1] === 'Digoxin 62.5mcg' && unmatched[2] === 'Warfarin 5mg',
    'output is sorted alphabetically (case-insensitive)');
}

// ── 8. Non-drug-monitoring rules do not count ─────────────────────────────────

console.log('\n--- non-drug-monitoring rules ignored ---');

{
  const qofRule = { id: 'qof-001', type: 'qof-indicator', enabled: true };
  const meds = [ med('Aspirin 75mg') ];
  const unmatched = listUnmatchedMedications(meds, [qofRule]);
  check(unmatched.length === 1, 'qof-indicator rule does not count as drug coverage');
}

// ── 9. drug-no-monitoring suppresses from unmatched list ─────────────────────

console.log('\n--- drug-no-monitoring type suppresses unmatched list ---');

{
  const noMonRule = {
    id: 'no-mon-001',
    type: 'drug-no-monitoring',
    enabled: true,
    drug: { match: ['clopidogrel', 'tamsulosin'] },
  };
  const meds = [
    med('Clopidogrel 75mg tablets'),
    med('Tamsulosin 400microgram modified-release capsules'),
    med('Aspirin 75mg tablets'),
  ];
  const unmatched = listUnmatchedMedications(meds, [noMonRule]);
  check(!unmatched.some(n => /clopidogrel/i.test(n)), 'clopidogrel suppressed by drug-no-monitoring rule');
  check(!unmatched.some(n => /tamsulosin/i.test(n)), 'tamsulosin suppressed by drug-no-monitoring rule');
  check(unmatched.some(n => /aspirin/i.test(n)), 'aspirin still unmatched (not in no-monitoring rule)');
}

{
  // Disabled drug-no-monitoring rule must NOT suppress
  const noMonRuleDisabled = {
    id: 'no-mon-002',
    type: 'drug-no-monitoring',
    enabled: false,
    drug: { match: ['clopidogrel'] },
  };
  const meds = [ med('Clopidogrel 75mg tablets') ];
  const unmatched = listUnmatchedMedications(meds, [noMonRuleDisabled]);
  check(unmatched.some(n => /clopidogrel/i.test(n)), 'disabled drug-no-monitoring rule does not suppress');
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
