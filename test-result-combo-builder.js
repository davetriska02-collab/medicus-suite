// test-result-combo-builder.js — unit tests for the combo-rule builder pure
// helpers (buildComboCondition / buildComboRuleFromForm) that assemble a
// kind:'combo' result rule from the inspector's builder form fields.
// Run with: node test-result-combo-builder.js
'use strict';

// As with test-result-inspector-helpers.js, the builder helpers live inside the
// options.js IIFE and are not require()-able. They are PURE (no DOM / chrome), so
// we extract them straight from source and run them in a vm — guarding the click-
// to-build → rule-object assembly against drift. The REAL engine validator is
// importable, so we prove the emitted object validates ([] = valid) and that
// malformed variants are rejected.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { validateResultRule } = require('./engine/result-rules.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

// ── Extract the three pure helpers from options.js source (no mirror) ─────────
const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'options.js'), 'utf8');

function extractFn(name) {
  // Matches "function <name>(...) { ... \n  }" — the 2-space-indented closing brace
  // that the file uses for these top-of-IIFE helpers.
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = src.match(re);
  return m ? m[0] : null;
}

function extractConstArrow(name) {
  // Matches "const <name> = (...) => { ... \n  };" — the 2-space-indented closing
  // "};" the file uses for these top-of-IIFE const-arrow helpers.
  const re = new RegExp('const ' + name + ' = \\([\\s\\S]*?\\n  \\};');
  const m = src.match(re);
  return m ? m[0] : null;
}

const splitLinesSrc = extractFn('splitLines');
const buildComboConditionSrc = extractFn('buildComboCondition');
const buildComboRuleFromFormSrc = extractFn('buildComboRuleFromForm');
const rrComboCondSummarySrc = extractConstArrow('rrComboCondSummary');
const rrComboImportPreviewSrc = extractConstArrow('rrComboImportPreview');

assert(!!splitLinesSrc, 'splitLines found in options.js');
assert(!!buildComboConditionSrc, 'buildComboCondition found in options.js');
assert(!!buildComboRuleFromFormSrc, 'buildComboRuleFromForm found in options.js');
assert(!!rrComboCondSummarySrc, 'rrComboCondSummary found in options.js');
assert(!!rrComboImportPreviewSrc, 'rrComboImportPreview found in options.js');

const sandbox = {};
vm.runInNewContext(
  [
    splitLinesSrc,
    buildComboConditionSrc,
    buildComboRuleFromFormSrc,
    rrComboCondSummarySrc,
    rrComboImportPreviewSrc,
    'this.splitLines = splitLines;',
    'this.buildComboCondition = buildComboCondition;',
    'this.buildComboRuleFromForm = buildComboRuleFromForm;',
    'this.rrComboCondSummary = rrComboCondSummary;',
    'this.rrComboImportPreview = rrComboImportPreview;',
  ].join('\n'),
  sandbox
);
const { buildComboCondition, buildComboRuleFromForm, rrComboImportPreview } = sandbox;
assert(typeof buildComboCondition === 'function', 'buildComboCondition extracted and callable');
assert(typeof buildComboRuleFromForm === 'function', 'buildComboRuleFromForm extracted and callable');
assert(typeof rrComboImportPreview === 'function', 'rrComboImportPreview extracted and callable');

// ── buildComboCondition — single condition assembly ──────────────────────────
console.log('\nbuildComboCondition — numeric / text condition assembly\n');
{
  // Numeric (the pus-cells condition)
  const num = buildComboCondition({
    match: 'pus cells\nwhite cells',
    specimen: 'urine\nmsu',
    type: 'numeric',
    comparator: 'above',
    value: '40',
  });
  assert(!num.error, 'numeric condition builds without error');
  assert(num.condition.comparator === 'above', 'numeric comparator carried');
  assert(num.condition.value === 40 && typeof num.condition.value === 'number', 'value coerced to finite number 40');
  assert(JSON.stringify(num.condition.analyte.match) === JSON.stringify(['pus cells', 'white cells']), 'match split');
  assert(JSON.stringify(num.condition.analyte.specimen) === JSON.stringify(['urine', 'msu']), 'specimen split');
  assert(num.condition.contains === undefined, 'numeric condition has no contains');

  // Text (the culture / no-growth condition)
  const txt = buildComboCondition({
    match: 'culture\nmsu',
    specimen: 'urine',
    type: 'text',
    contains: 'no growth\nno significant growth',
  });
  assert(!txt.error, 'text condition builds without error');
  assert(
    JSON.stringify(txt.condition.contains) === JSON.stringify(['no growth', 'no significant growth']),
    'contains split'
  );
  assert(
    txt.condition.comparator === undefined && txt.condition.value === undefined,
    'text condition has no numeric form'
  );

  // exclude only included when present
  assert(num.condition.analyte.exclude === undefined, 'no exclude → omitted');
  const withEx = buildComboCondition({ match: 'culture', type: 'text', contains: 'no growth', exclude: 'mixed' });
  assert(JSON.stringify(withEx.condition.analyte.exclude) === JSON.stringify(['mixed']), 'exclude included when set');

  // error paths
  assert(!!buildComboCondition({ match: '', type: 'numeric', value: '40' }).error, 'empty match → error');
  assert(!!buildComboCondition({ match: 'x', type: 'numeric', value: '' }).error, 'numeric with blank value → error');
  assert(!!buildComboCondition({ match: 'x', type: 'numeric', value: 'abc' }).error, 'numeric non-finite → error');
  assert(!!buildComboCondition({ match: 'x', type: 'text', contains: '' }).error, 'text with no contains → error');
}

// ── buildComboRuleFromForm — the flagship pus-cells / culture combo ───────────
console.log('\nbuildComboRuleFromForm — sterile-pyuria flagship + contract shape\n');

const flagshipForm = {
  label: 'Sterile pyuria (pus cells, no growth)',
  level: 'amber',
  conditions: [
    { match: 'pus cell', specimen: 'urine', type: 'numeric', comparator: 'above', value: '40' },
    { match: 'culture', type: 'text', contains: 'no growth' },
  ],
};

{
  const { rule, error } = buildComboRuleFromForm(flagshipForm);
  assert(!error, 'flagship form builds without error');

  // Exact contract shape
  assert(typeof rule.id === 'string' && rule.id.length > 0, 'rule.id is a non-empty string');
  assert(rule.enabled === false, 'enabled === false (imports disabled)');
  assert(rule.builtin === false, 'builtin === false (user-authored)');
  assert(rule.kind === 'combo', "kind === 'combo'");
  assert(rule.label === 'Sterile pyuria (pus cells, no growth)', 'label carried through');
  assert(rule.level === 'amber', "level === 'amber' (default)");
  assert(Array.isArray(rule.conditions) && rule.conditions.length === 2, 'two conditions');

  const [a, b] = rule.conditions;
  // Condition A — numeric pus cells above 40, urine
  assert(
    JSON.stringify(a) ===
      JSON.stringify({
        analyte: { match: ['pus cell'], specimen: ['urine'] },
        comparator: 'above',
        value: 40,
      }),
    'condition A is the exact numeric pus-cell shape'
  );
  // Condition B — text culture contains no growth
  assert(
    JSON.stringify(b) ===
      JSON.stringify({
        analyte: { match: ['culture'] },
        contains: ['no growth'],
      }),
    'condition B is the exact text culture shape'
  );

  // The whole top-level key set is exactly the contract (no stray keys)
  assert(
    JSON.stringify(Object.keys(rule).sort()) ===
      JSON.stringify(['builtin', 'conditions', 'enabled', 'id', 'kind', 'label', 'level']),
    'top-level keys are exactly the contract set'
  );

  // ENGINE validates the emitted rule
  assert(validateResultRule(rule).length === 0, 'validateResultRule(rule) === [] (engine accepts it)');
}

// ── level handling + defaults ────────────────────────────────────────────────
console.log('\nbuildComboRuleFromForm — level + id handling\n');
{
  const red = buildComboRuleFromForm({ ...flagshipForm, level: 'red' });
  assert(red.rule.level === 'red', "level 'red' carried");
  assert(validateResultRule(red.rule).length === 0, 'red combo validates');

  const noLevel = buildComboRuleFromForm({ label: 'L', conditions: flagshipForm.conditions });
  assert(noLevel.rule.level === 'amber', 'missing level → amber default');

  const junkLevel = buildComboRuleFromForm({ ...flagshipForm, level: 'purple' });
  assert(junkLevel.rule.level === 'amber', 'invalid level → amber default');

  const givenId = buildComboRuleFromForm({ ...flagshipForm, id: 'rrule_fixed' });
  assert(givenId.rule.id === 'rrule_fixed', 'provided id preserved');
  const r1 = buildComboRuleFromForm(flagshipForm).rule.id;
  const r2 = buildComboRuleFromForm(flagshipForm).rule.id;
  assert(r1 !== r2, 'generated ids are unique per build');
}

// ── malformed forms → error (and would fail engine validation) ───────────────
console.log('\nbuildComboRuleFromForm — malformed variants rejected\n');
{
  assert(!!buildComboRuleFromForm({ label: '', conditions: flagshipForm.conditions }).error, 'blank label → error');
  assert(
    !!buildComboRuleFromForm({ label: 'x'.repeat(61), conditions: flagshipForm.conditions }).error,
    'label > 60 chars → error'
  );
  assert(
    !!buildComboRuleFromForm({ label: 'L', conditions: [flagshipForm.conditions[0]] }).error,
    'fewer than 2 conditions → error'
  );
  assert(!!buildComboRuleFromForm({ label: 'L', conditions: [] }).error, 'no conditions → error');
  const badCond = buildComboRuleFromForm({
    label: 'L',
    conditions: [{ match: '', type: 'numeric', value: '40' }, flagshipForm.conditions[1]],
  });
  assert(!!badCond.error && /Condition 1/.test(badCond.error), 'bad condition surfaces with its index');

  // Prove the engine ALSO rejects a hand-malformed combo (numeric AND text on one cond)
  const bothForms = {
    id: 'x',
    enabled: false,
    builtin: false,
    kind: 'combo',
    label: 'bad',
    level: 'amber',
    conditions: [
      { analyte: { match: ['a'] }, comparator: 'above', value: 1, contains: ['x'] },
      { analyte: { match: ['b'] }, contains: ['y'] },
    ],
  };
  assert(validateResultRule(bothForms).length > 0, 'engine rejects a condition that is numeric AND text');
}

// ── Manual editor parity — a combo built from the main #rrKind form validates ─
console.log('\nmanual editor — combo built from the main rule form validates []\n');
{
  // The footer Save (saveCurrentResultRule, combo branch) hands buildComboRuleFromForm
  // exactly this shape: the existing rule id + #rrLabel + #rrComboLevel + the condition
  // cards read back via readConditionForms(). Prove that round-trips to a valid rule and
  // that the editor's Enabled checkbox can flip enabled true without breaking validation.
  const manual = buildComboRuleFromForm({
    id: 'rrule_existing',
    label: 'Sterile pyuria (manual)',
    level: 'red',
    conditions: flagshipForm.conditions,
  });
  assert(!manual.error, 'manual-form combo builds without error');
  assert(manual.rule.id === 'rrule_existing', 'manual edit preserves the existing rule id (in-place update)');
  assert(validateResultRule(manual.rule).length === 0, 'manual-form combo validates [] (engine accepts it)');
  const enabledByUser = { ...manual.rule, enabled: true };
  assert(
    validateResultRule(enabledByUser).length === 0,
    'combo with enabled:true (honoured #rrEnabled) still validates'
  );
}

// ── LLM-import preview summary helper (GAP A) ─────────────────────────────────
console.log('\nrrComboImportPreview — combo preview summary string\n');
{
  const rule = {
    label: 'Sterile pyuria',
    kind: 'combo',
    level: 'amber',
    conditions: [
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 40 },
      { analyte: { match: ['culture'] }, contains: ['no growth'] },
    ],
  };
  const s = rrComboImportPreview(rule);
  assert(s.includes('Sterile pyuria'), 'preview includes the label');
  assert(s.includes('Combo (amber)'), 'preview names the kind + level');
  assert(s.includes('2 conditions, all must match'), 'preview states condition count + AND semantics');
  assert(s.includes('will import DISABLED'), 'preview states it imports DISABLED');
  assert(/pus cells ≥ 40/.test(s) && /culture ∋/.test(s), 'preview appends a per-condition summary');
  assert(s.includes(' AND '), 'per-condition summary is joined with AND');

  const red = rrComboImportPreview({ ...rule, level: 'red' });
  assert(red.includes('Combo (red)'), 'red level reflected in preview');
  const single = rrComboImportPreview({ label: 'x', conditions: [rule.conditions[0]] });
  assert(single.includes('1 condition, all must match'), 'singular "condition" for a one-condition rule');
  const noLabel = rrComboImportPreview({ conditions: rule.conditions });
  assert(noLabel.startsWith('Untitled —'), 'missing label falls back to Untitled');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
