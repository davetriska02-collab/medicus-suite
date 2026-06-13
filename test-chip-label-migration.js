// test-chip-label-migration.js — guards the retired-chip-label migration
// Run with: node test-chip-label-migration.js
//
// v3.75.0 changed the urgent result-chip labels from "Urgent: {name}" to "{name}", but
// mergeShippedDefaults bakes the whole shipped chip map into each saved config, so the
// stored OLD label shadowed the new default for existing users. v3.75.2 added
// RETIRED_CHIP_LABELS + revertRetiredChipLabels to un-stick those. This test pins:
//   1. the revert logic behaves (reverts a retired label, leaves customisations alone),
//   2. the content-script and options-page tables are in lock-step,
//   3. the table retires OLD values, not the CURRENT shipped defaults,
//   4. defaults.json's schema "version" is high enough for the migration to actually run.

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

// Extract `const RETIRED_CHIP_LABELS = {...};` and `const revertRetiredChipLabels = ...;`
// from a source file and evaluate them in a sandbox.
function extractMigration(file) {
  const src = fs.readFileSync(file, 'utf8');
  const tableMatch = src.match(/const RETIRED_CHIP_LABELS = \{[\s\S]*?\n {2}\};/);
  const fnMatch = src.match(
    /const revertRetiredChipLabels = \(chips, shippedChips\) => \{[\s\S]*?\n {2}\};/
  );
  if (!tableMatch || !fnMatch) return null;
  const sandbox = {};
  vm.runInNewContext(
    tableMatch[0] +
      '\n' +
      fnMatch[0] +
      '\nthis.RETIRED = RETIRED_CHIP_LABELS;\nthis.revert = revertRetiredChipLabels;',
    sandbox
  );
  return { table: sandbox.RETIRED, revert: sandbox.revert };
}

const contentPath = path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js');
const optionsPath = path.join(__dirname, 'content-scripts', 'triage-lens', 'options.js');

const content = extractMigration(contentPath);
const options = extractMigration(optionsPath);

check(!!content, 'RETIRED_CHIP_LABELS + revertRetiredChipLabels extracted from content.js');
check(!!options, 'RETIRED_CHIP_LABELS + revertRetiredChipLabels extracted from options.js');

if (content && options) {
  // 2. Lock-step: the two tables must be identical.
  check(
    JSON.stringify(content.table) === JSON.stringify(options.table),
    'content.js and options.js RETIRED_CHIP_LABELS tables are identical (lock-step)'
  );

  // The shipped defaults (current) — root defaults.json is the source of truth.
  const defaults = require(path.join(__dirname, 'defaults.json'));
  const shippedChips = defaults.systemChips || {};

  // 4. defaults schema version must be >= 10 (the bump that makes the v3.75.2 migration run).
  check(
    (defaults.version || 0) >= 10,
    `defaults.json "version" is >= 10 so mergeShippedDefaults runs (got ${defaults.version})`
  );

  // 3. The table retires OLD values — the CURRENT shipped label must NOT be listed as retired.
  for (const id of Object.keys(content.table)) {
    const cur = shippedChips[id] && shippedChips[id].label;
    check(!!cur, `shipped default exists for retired chip id "${id}"`);
    check(
      cur && content.table[id].indexOf(cur) === -1,
      `current shipped label for "${id}" (${JSON.stringify(cur)}) is NOT in its retired list`
    );
  }

  // The specific regression: the urgent chips retired the "Urgent:" prefix.
  check(
    (content.table['queue.resultUrgent'] || []).includes('Urgent: {name}'),
    'queue.resultUrgent retires the old "Urgent: {name}" label'
  );
  check(
    shippedChips['queue.resultUrgent'] && shippedChips['queue.resultUrgent'].label === '{name}',
    'current shipped queue.resultUrgent label is "{name}"'
  );

  // 1. Behaviour — revert un-sticks a stored OLD label back to the current shipped label.
  {
    const stored = {
      'queue.resultUrgent': { enabled: true, label: 'Urgent: {name}', kind: 'red', actions: [] }
    };
    content.revert(stored, shippedChips);
    check(
      stored['queue.resultUrgent'].label === '{name}',
      'revert: a stored "Urgent: {name}" is reverted to the current "{name}"'
    );
  }
  {
    // A genuine user customisation (label they typed) must be left untouched.
    const stored = {
      'queue.resultUrgent': { enabled: true, label: 'MY OWN LABEL', kind: 'red', actions: [] }
    };
    content.revert(stored, shippedChips);
    check(
      stored['queue.resultUrgent'].label === 'MY OWN LABEL',
      'revert: a genuine custom label is left untouched'
    );
  }
  {
    // A chip not in the retired table is untouched even if its label looks unusual.
    const stored = { 'queue.child': { enabled: true, label: 'whatever', kind: 'info', actions: [] } };
    content.revert(stored, shippedChips);
    check(stored['queue.child'].label === 'whatever', 'revert: chips not in the table are untouched');
  }
  {
    // The disable-state customisation survives a label revert.
    const stored = {
      'queue.resultRuleUrgent': {
        enabled: false,
        label: 'Urgent: {name} — {rule}',
        kind: 'red',
        actions: []
      }
    };
    content.revert(stored, shippedChips);
    check(
      stored['queue.resultRuleUrgent'].label === '{name} — {rule}' &&
        stored['queue.resultRuleUrgent'].enabled === false,
      'revert: label fixed while the user’s enabled:false customisation is preserved'
    );
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
