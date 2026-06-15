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

const splitLinesSrc = extractFn('splitLines');
const buildComboConditionSrc = extractFn('buildComboCondition');
const buildComboRuleFromFormSrc = extractFn('buildComboRuleFromForm');

assert(!!splitLinesSrc, 'splitLines found in options.js');
assert(!!buildComboConditionSrc, 'buildComboCondition found in options.js');
assert(!!buildComboRuleFromFormSrc, 'buildComboRuleFromForm found in options.js');

const sandbox = {};
vm.runInNewContext(
  [
    splitLinesSrc,
    buildComboConditionSrc,
    buildComboRuleFromFormSrc,
    'this.splitLines = splitLines;',
    'this.buildComboCondition = buildComboCondition;',
    'this.buildComboRuleFromForm = buildComboRuleFromForm;',
  ].join('\n'),
  sandbox
);
const { buildComboCondition, buildComboRuleFromForm } = sandbox;
assert(typeof buildComboCondition === 'function', 'buildComboCondition extracted and callable');
assert(typeof buildComboRuleFromForm === 'function', 'buildComboRuleFromForm extracted and callable');

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

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
