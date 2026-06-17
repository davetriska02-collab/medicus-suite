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
  const fnMatch = src.match(/const revertRetiredChipLabels = \(chips, shippedChips\) => \{[\s\S]*?\n {2}\};/);
  if (!tableMatch || !fnMatch) return null;
  const sandbox = {};
  vm.runInNewContext(
    tableMatch[0] + '\n' + fnMatch[0] + '\nthis.RETIRED = RETIRED_CHIP_LABELS;\nthis.revert = revertRetiredChipLabels;',
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
      'queue.resultUrgent': { enabled: true, label: 'Urgent: {name}', kind: 'red', actions: [] },
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
      'queue.resultUrgent': { enabled: true, label: 'MY OWN LABEL', kind: 'red', actions: [] },
    };
    content.revert(stored, shippedChips);
    check(stored['queue.resultUrgent'].label === 'MY OWN LABEL', 'revert: a genuine custom label is left untouched');
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
        actions: [],
      },
    };
    content.revert(stored, shippedChips);
    check(
      stored['queue.resultRuleUrgent'].label === '{name} — {rule}' &&
        stored['queue.resultRuleUrgent'].enabled === false,
      'revert: label fixed while the user’s enabled:false customisation is preserved'
    );
  }
}

// ── Result-rule abnormalText backfill migration (lock-step + behaviour) ───────
// The resultRules migration is append-only by id, so a builtin the user already holds
// never receives newly-shipped abnormalText positive flags. backfillBuiltinAbnormalText
// (added v3.77.10) patches those onto held builtins. It is purely additive (abnormalText
// only ever ADDS a review). This pins: the two copies are in lock-step; the listed ids are
// shipped builtins carrying abnormalText; and the backfill adds-but-never-clobbers.
function extractBackfill(file) {
  const src = fs.readFileSync(file, 'utf8');
  const listMatch = src.match(/const RESULT_RULES_GAINED_ABNORMALTEXT = \[[\s\S]*?\];/);
  const fnMatch = src.match(
    /const backfillBuiltinAbnormalText = \(resultRules, shippedResultRules\) => \{[\s\S]*?\n {2}\};/
  );
  if (!listMatch || !fnMatch) return null;
  const sandbox = {};
  vm.runInNewContext(
    listMatch[0] +
      '\n' +
      fnMatch[0] +
      '\nthis.ids = RESULT_RULES_GAINED_ABNORMALTEXT;\nthis.backfill = backfillBuiltinAbnormalText;',
    sandbox
  );
  return { ids: sandbox.ids, backfill: sandbox.backfill };
}

const contentBF = extractBackfill(contentPath);
const optionsBF = extractBackfill(optionsPath);
check(!!contentBF, 'backfillBuiltinAbnormalText + id list extracted from content.js');
check(!!optionsBF, 'backfillBuiltinAbnormalText + id list extracted from options.js');

if (contentBF && optionsBF) {
  check(
    JSON.stringify(contentBF.ids) === JSON.stringify(optionsBF.ids),
    'content.js and options.js RESULT_RULES_GAINED_ABNORMALTEXT are identical (lock-step)'
  );

  const shippedRR = require(path.join(__dirname, 'defaults.json')).resultRules || [];

  // Every backfill id must be a shipped builtin that actually carries a non-empty abnormalText.
  for (const id of contentBF.ids) {
    const r = shippedRR.find((x) => x.id === id);
    check(
      r && r.builtin === true && Array.isArray(r.abnormalText) && r.abnormalText.length > 0,
      `backfill id "${id}" is a shipped builtin with a non-empty abnormalText`
    );
  }

  // Behaviour: a held OLD builtin lacking abnormalText receives the shipped set.
  {
    const held = [{ id: 'msu-culture', builtin: true, kind: 'text', normalText: ['no growth'] }];
    contentBF.backfill(held, shippedRR);
    const shippedMsu = shippedRR.find((r) => r.id === 'msu-culture');
    check(
      Array.isArray(held[0].abnormalText) &&
        JSON.stringify(held[0].abnormalText) === JSON.stringify(shippedMsu.abnormalText),
      'backfill: a held old builtin without abnormalText receives the shipped abnormalText'
    );
  }
  // A held builtin with the user's OWN abnormalText is NOT clobbered.
  {
    const held = [
      { id: 'msu-culture', builtin: true, kind: 'text', normalText: ['no growth'], abnormalText: ['my own flag'] },
    ];
    contentBF.backfill(held, shippedRR);
    check(
      JSON.stringify(held[0].abnormalText) === JSON.stringify(['my own flag']),
      'backfill: a held rule with an existing abnormalText is left untouched'
    );
  }
  // A non-builtin rule sharing the id is NOT touched (only builtins are backfilled).
  {
    const held = [{ id: 'msu-culture', builtin: false, kind: 'text', normalText: ['no growth'] }];
    contentBF.backfill(held, shippedRR);
    check(held[0].abnormalText === undefined, 'backfill: a non-builtin sharing the id is not touched');
  }
  // Empty / null held set is a safe no-op (no throw).
  {
    let threw = false;
    try {
      contentBF.backfill([], shippedRR);
      contentBF.backfill(null, shippedRR);
    } catch (e) {
      threw = true;
    }
    check(!threw, 'backfill: empty/null held set is a safe no-op');
  }
}

// ── Result-rule label/threshold revert migration (lock-step + behaviour) ──────
// v17 surfaced each numeric trigger in the result-chip label and lowered the Hb critical
// red 100→80 (CSO-approved). The resultRules merge is append-by-id only, so a held builtin
// keeps its OLD label/threshold forever. revertRetiredResultRuleFields un-sticks them, but
// ATOMICALLY per id: it only updates a rule when EVERY listed field still equals a retired
// value (the user hasn't customised it), so it never clobbers a user edit and never leaves a
// label that disagrees with the live threshold. This pins lock-step + that behaviour.
function extractRRFields(file) {
  const src = fs.readFileSync(file, 'utf8');
  const tableMatch = src.match(/const RETIRED_RESULTRULE_FIELDS = \{[\s\S]*?\n {2}\};/);
  const fnMatch = src.match(
    /const revertRetiredResultRuleFields = \(resultRules, shippedResultRules\) => \{[\s\S]*?\n {2}\};/
  );
  if (!tableMatch || !fnMatch) return null;
  const sandbox = {};
  vm.runInNewContext(
    tableMatch[0] +
      '\n' +
      fnMatch[0] +
      '\nthis.table = RETIRED_RESULTRULE_FIELDS;\nthis.revert = revertRetiredResultRuleFields;',
    sandbox
  );
  return { table: sandbox.table, revert: sandbox.revert };
}

const contentRR = extractRRFields(contentPath);
const optionsRR = extractRRFields(optionsPath);
check(!!contentRR, 'RETIRED_RESULTRULE_FIELDS + revertRetiredResultRuleFields extracted from content.js');
check(!!optionsRR, 'RETIRED_RESULTRULE_FIELDS + revertRetiredResultRuleFields extracted from options.js');

if (contentRR && optionsRR) {
  // Lock-step: the two tables must be identical.
  check(
    JSON.stringify(contentRR.table) === JSON.stringify(optionsRR.table),
    'content.js and options.js RETIRED_RESULTRULE_FIELDS tables are identical (lock-step)'
  );

  const shippedRR2 = require(path.join(__dirname, 'defaults.json')).resultRules || [];

  // Every id must be a shipped builtin, and every retired value must be OLD — the CURRENT
  // shipped value must NOT appear in any retired list (else we'd thrash a live default).
  for (const id of Object.keys(contentRR.table)) {
    const r = shippedRR2.find((x) => x.id === id);
    check(r && r.builtin === true, `RETIRED_RESULTRULE id "${id}" is a shipped builtin`);
    if (!r) continue;
    for (const field of Object.keys(contentRR.table[id])) {
      check(
        contentRR.table[id][field].indexOf(r[field]) === -1,
        `current shipped ${field} for "${id}" (${JSON.stringify(r[field])}) is NOT in its retired list`
      );
    }
  }

  // The specific regression: Hb retires the old label AND the old red 100, and is now ≤80.
  check(
    (contentRR.table['base-low-haemoglobin'] || {}).red &&
      contentRR.table['base-low-haemoglobin'].red.indexOf(100) !== -1,
    'base-low-haemoglobin retires the old red threshold 100'
  );
  check(
    (shippedRR2.find((r) => r.id === 'base-low-haemoglobin') || {}).red === 80,
    'current shipped base-low-haemoglobin red is 80 (CSO-lowered from 100)'
  );

  // Behaviour: a held builtin still at the OLD label+red is brought fully up to date.
  {
    const held = [
      {
        id: 'base-low-haemoglobin',
        builtin: true,
        kind: 'threshold',
        comparator: 'below',
        label: 'Critical low haemoglobin',
        red: 100,
        unit: 'g/L',
      },
    ];
    contentRR.revert(held, shippedRR2);
    const shipped = shippedRR2.find((r) => r.id === 'base-low-haemoglobin');
    check(
      held[0].label === shipped.label && held[0].red === 80,
      'revert: held old Hb rule gets the new numbered label AND red 80'
    );
  }
  // A label-only rule (no red entry) gets its number-bearing label.
  {
    const held = [
      { id: 'base-high-inr', builtin: true, kind: 'threshold', comparator: 'above', label: 'High INR', red: 8 },
    ];
    contentRR.revert(held, shippedRR2);
    check(
      held[0].label === shippedRR2.find((r) => r.id === 'base-high-inr').label && held[0].red === 8,
      'revert: held old INR rule gets the numbered label, red untouched'
    );
  }
  // ATOMIC: a user-customised label means the WHOLE rule is left alone (incl. its red).
  {
    const held = [
      {
        id: 'base-low-haemoglobin',
        builtin: true,
        kind: 'threshold',
        comparator: 'below',
        label: 'MY OWN HB LABEL',
        red: 100,
        unit: 'g/L',
      },
    ];
    contentRR.revert(held, shippedRR2);
    check(
      held[0].label === 'MY OWN HB LABEL' && held[0].red === 100,
      'revert: a user-customised label leaves the entire rule untouched (atomic, no desync)'
    );
  }
  // ATOMIC: old label but a user-customised red → leave alone (don't relabel to a wrong number).
  {
    const held = [
      {
        id: 'base-low-haemoglobin',
        builtin: true,
        kind: 'threshold',
        comparator: 'below',
        label: 'Critical low haemoglobin',
        red: 90,
        unit: 'g/L',
      },
    ];
    contentRR.revert(held, shippedRR2);
    check(
      held[0].label === 'Critical low haemoglobin' && held[0].red === 90,
      'revert: old label but custom red is left untouched (atomic — no label/threshold desync)'
    );
  }
  // A non-builtin sharing the id is not touched.
  {
    const held = [
      { id: 'base-high-inr', builtin: false, kind: 'threshold', comparator: 'above', label: 'High INR', red: 8 },
    ];
    contentRR.revert(held, shippedRR2);
    check(held[0].label === 'High INR', 'revert: a non-builtin sharing the id is not touched');
  }
  // EDITABLE-FLAGS CONTRACT (Nick's request): a clinician who renames a built-in chip
  // label — e.g. strips a redundant "high" — must keep that rename across suite updates.
  // The label they typed is NOT a retired default, so revert leaves the whole rule alone
  // even though the rule is otherwise still at shipped thresholds. Pins that the
  // user-override-wins guarantee holds for an arbitrary custom label, not just the
  // specific strings already in the retired table.
  {
    const held = [
      {
        id: 'base-high-potassium',
        builtin: true,
        kind: 'threshold',
        comparator: 'above',
        label: 'Critical K+ (≥6.5)',
        red: 6.5,
        unit: 'mmol/L',
      },
    ];
    contentRR.revert(held, shippedRR2);
    check(
      held[0].label === 'Critical K+ (≥6.5)',
      'editable flags: a clinician-renamed built-in label survives the shipped-defaults merge'
    );
  }
  // Empty / null held set is a safe no-op.
  {
    let threw = false;
    try {
      contentRR.revert([], shippedRR2);
      contentRR.revert(null, shippedRR2);
    } catch (e) {
      threw = true;
    }
    check(!threw, 'revert: empty/null held set is a safe no-op');
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
