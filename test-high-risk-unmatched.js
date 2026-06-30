// Medicus Suite — High-risk unmatched-medication guard tests
// Run with: node test-high-risk-unmatched.js
//
// Exercises flagHighRiskUnmatched() in engine/rules-engine.js — the blind-spot
// guard that elevates a monitored-class drug which matched NO rule (odd brand,
// exclude, or disabled rule) out of the flat "unmatched" list into a red alert.
//
// Verifies that:
//   - A high-risk drug with no rule is flagged, with the right class label
//   - A non-high-risk unmatched drug (e.g. paracetamol) is NOT flagged
//   - An excluded high-risk drug is flagged and carries its reason/excludedBy
//   - Matching is case-insensitive substring (generic stem covers brand+strength)
//   - A brand-only name with no generic stem is NOT flagged (documented limit)
//   - Empty / null input → empty list
//   - End-to-end: listUnmatchedMedicationsDetailed → flagHighRiskUnmatched

'use strict';
const engine = require('./engine/rules-engine.js');
const { flagHighRiskUnmatched, listUnmatchedMedicationsDetailed } = engine;

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

function detail(name, reason, excludedBy) {
  return { name, reason: reason || 'no-rule', excludedBy: excludedBy || null };
}

// ── 1. High-risk drug with no rule is flagged, with class label ───────────────

console.log('\n--- high-risk drug with no rule is flagged ---');

{
  const flagged = flagHighRiskUnmatched([
    detail('Amiodarone 200mg tablets'),
    detail('Lithium carbonate 400mg M/R tablets'),
    detail('Methotrexate 2.5mg tablets'),
  ]);
  check(flagged.length === 3, 'all three high-risk meds flagged');
  const byName = Object.fromEntries(flagged.map((f) => [f.name, f]));
  check(byName['Amiodarone 200mg tablets']?.riskClass === 'Antiarrhythmic', 'amiodarone classed Antiarrhythmic');
  check(byName['Lithium carbonate 400mg M/R tablets']?.riskClass === 'Lithium', 'lithium salt classed Lithium');
  check(
    byName['Methotrexate 2.5mg tablets']?.riskClass === 'DMARD / immunosuppressant',
    'methotrexate classed DMARD / immunosuppressant'
  );
  check(byName['Lithium carbonate 400mg M/R tablets']?.matchedStem === 'lithium', 'matchedStem recorded');
}

// ── 2. Non-high-risk unmatched drug is NOT flagged ────────────────────────────

console.log('\n--- benign unmatched drug is not flagged ---');

{
  const flagged = flagHighRiskUnmatched([
    detail('Paracetamol 500mg tablets'),
    detail('Amoxicillin 250mg capsules'),
    detail('Senna 7.5mg tablets'),
  ]);
  check(flagged.length === 0, 'no benign meds flagged (paracetamol/amoxicillin/senna)');
}

// ── 3. Excluded high-risk drug is flagged and carries reason/excludedBy ────────

console.log('\n--- excluded high-risk drug carries its reason ---');

{
  const flagged = flagHighRiskUnmatched([
    detail('methotrexate 50mg/2ml injection', 'excluded', { ruleId: 'mtx-001', term: 'injection' }),
  ]);
  check(flagged.length === 1, 'excluded high-risk drug is flagged');
  check(flagged[0].reason === 'excluded', 'reason "excluded" preserved');
  check(flagged[0].excludedBy && flagged[0].excludedBy.term === 'injection', 'excludedBy detail preserved');
}

// ── 4. Case-insensitive substring (stem covers brand + strength + salt) ────────

console.log('\n--- case-insensitive substring matching ---');

{
  const flagged = flagHighRiskUnmatched([
    detail('SODIUM VALPROATE 500mg gastro-resistant tablets'),
    detail('Warfarin Sodium 3mg Tablets'),
    detail('spironolactone 25mg/5ml oral suspension'),
  ]);
  const classes = flagged.map((f) => f.riskClass);
  check(
    flagged.length === 3,
    'valproate (via "valproate"), warfarin and spironolactone all flagged regardless of case'
  );
  check(
    classes.includes('Aldosterone antagonist (potassium)'),
    'spironolactone classed Aldosterone antagonist (potassium)'
  );
  check(classes.includes('Oral anticoagulant'), 'warfarin classed Oral anticoagulant');
}

// ── 5. Brand-only name with no generic stem is NOT flagged (documented limit) ──

console.log('\n--- brand-only name without a generic stem is not flagged ---');

{
  // "Jaylamine" is a hypothetical brand with no generic in the name — the guard
  // cannot classify it from the name alone, and must not guess.
  const flagged = flagHighRiskUnmatched([detail('Jaylamine 100mg tablets')]);
  check(flagged.length === 0, 'unrecognised brand-only name is not flagged (no false positive)');
}

// ── 6. Empty / null input → empty list ────────────────────────────────────────

console.log('\n--- empty / null input ---');

{
  check(flagHighRiskUnmatched([]).length === 0, 'empty array → empty list');
  check(flagHighRiskUnmatched(null).length === 0, 'null → empty list');
  check(flagHighRiskUnmatched(undefined).length === 0, 'undefined → empty list');
}

// ── 7. End-to-end through the real unmatched pipeline ─────────────────────────

console.log('\n--- end-to-end: listUnmatchedMedicationsDetailed → flagHighRiskUnmatched ---');

{
  // Only a methotrexate rule exists. An unrecognised amiodarone brand and a plain
  // ramipril both go unmatched; only the amiodarone is high-risk-classed.
  const rules = [{ id: 'mtx-001', type: 'drug-monitoring', drug: { match: ['methotrexate'] }, tests: [] }];
  const meds = [
    { name: 'methotrexate 2.5mg tablets' }, // matched → not unmatched
    { name: 'Cordarone X 200mg tablets' }, // amiodarone BRAND only → unmatched, not classifiable
    { name: 'Amiodarone 100mg tablets' }, // generic → unmatched AND high-risk
    { name: 'Ramipril 5mg capsules' }, // unmatched but benign here
  ];
  const unmatchedDetailed = listUnmatchedMedicationsDetailed(meds, rules);
  const flagged = flagHighRiskUnmatched(unmatchedDetailed);
  check(
    !unmatchedDetailed.some((u) => /methotrexate/i.test(u.name)),
    'matched methotrexate is not in the unmatched list'
  );
  check(
    flagged.length === 1 && /amiodarone/i.test(flagged[0].name),
    'only the generic amiodarone is flagged high-risk (brand-only Cordarone is not)'
  );
}

// ── 8. W1: possibleDuplicateOf cross-reference against matched meds ───────────

console.log('\n--- W1: possibleDuplicateOf cross-reference ---');

{
  // The duplicate-form case the GP panel converged on: an odd lithium SALT whose
  // name still carries the "lithium" stem goes unmatched (the rule only lists
  // carbonate) while a generic lithium IS matched on the same patient. With the
  // matched-med list passed, the flag must point at the sibling.
  // (NB: a brand with NO generic stem in its name — Priadel, Camcolit — cannot
  // be classified at all; that is the documented brand-only limit, tested below.)
  const rules = [{ id: 'li-001', type: 'drug-monitoring', drug: { match: ['lithium carbonate'] }, tests: [] }];
  const meds = [
    { name: 'Lithium carbonate 400mg tablets' }, // matched
    { name: 'Lithium citrate 520mg/5ml oral solution' }, // unmatched + high-risk (stem 'lithium')
  ];
  const unmatchedDetailed = listUnmatchedMedicationsDetailed(meds, rules);
  const flagged = flagHighRiskUnmatched(
    unmatchedDetailed,
    meds.map((m) => m.name)
  );
  check(
    flagged.length === 1 && /lithium citrate/i.test(flagged[0].name),
    'unmatched lithium citrate (carrying the lithium stem) is flagged high-risk'
  );
  check(
    flagged[0].possibleDuplicateOf === 'Lithium carbonate 400mg tablets',
    'possibleDuplicateOf points at the matched lithium carbonate sibling'
  );
}

{
  // The methotrexate-injection case: a parenteral MTX dropped by an injectable
  // exclude still carries the 'methotrexate' stem, so it is high-risk-classed,
  // and an oral MTX matched on the same patient is the likely sibling.
  const rules = [
    {
      id: 'mtx-oral',
      type: 'drug-monitoring',
      drug: { match: ['methotrexate'], exclude: ['injection'] },
      tests: [],
    },
  ];
  const meds = [
    { name: 'Methotrexate 2.5mg tablets' }, // matched
    { name: 'Methotrexate 10mg/0.2ml injection' }, // excluded → unmatched + high-risk
  ];
  const unmatchedDetailed = listUnmatchedMedicationsDetailed(meds, rules);
  const flagged = flagHighRiskUnmatched(
    unmatchedDetailed,
    meds.map((m) => m.name)
  );
  check(
    flagged.length === 1 && flagged[0].reason === 'excluded',
    'excluded MTX injection is flagged high-risk and carries reason=excluded'
  );
  check(
    flagged[0].possibleDuplicateOf === 'Methotrexate 2.5mg tablets',
    'possibleDuplicateOf points at the matched oral methotrexate sibling'
  );
}

{
  // No sibling: a genuinely lone unmonitored high-risk drug must NOT claim a
  // duplicate (the alert must stay loud, not be softened into a false reassurance).
  const rules = [{ id: 'mtx-001', type: 'drug-monitoring', drug: { match: ['methotrexate'] }, tests: [] }];
  const meds = [{ name: 'Amiodarone 100mg tablets' }, { name: 'Methotrexate 2.5mg tablets' }];
  const unmatchedDetailed = listUnmatchedMedicationsDetailed(meds, rules);
  const flagged = flagHighRiskUnmatched(
    unmatchedDetailed,
    meds.map((m) => m.name)
  );
  check(
    flagged.length === 1 && /amiodarone/i.test(flagged[0].name) && flagged[0].possibleDuplicateOf === null,
    'a lone unmonitored amiodarone has possibleDuplicateOf === null'
  );
}

{
  // Backward compatibility: called WITHOUT the matched-med list, possibleDuplicateOf
  // must be null (and the rest of the shape unchanged) so existing callers are safe.
  const detailed = [detail('Amiodarone 100mg tablets')];
  const flagged = flagHighRiskUnmatched(detailed);
  check(
    flagged.length === 1 && flagged[0].possibleDuplicateOf === null,
    'omitting allMedNames keeps possibleDuplicateOf null (back-compat)'
  );
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
