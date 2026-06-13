// test-result-rules.js — unit tests for validateResultRule and resultRuleSchemaPrompt
// Run with: node test-result-rules.js
'use strict';

const { validateResultRule, resultRuleSchemaPrompt, RESULT_RULE_FIELDS } = require('./engine/result-rules.js');

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function validRule(overrides) {
  return Object.assign(
    {
      id: 'rule_placeholder',
      enabled: false,
      builtin: false,
      label: 'High potassium',
      analyte: { match: ['potassium'] },
      comparator: 'above',
      amber: 5.5,
      red: 6.0,
      unit: 'mmol/L',
    },
    overrides
  );
}

function hasError(errs, fragment) {
  return errs.some(e => e.toLowerCase().includes(fragment.toLowerCase()));
}

// ── validateResultRule: valid rule passes ─────────────────────────────────────
console.log('\n--- validateResultRule: valid rule passes ---');
{
  const errs = validateResultRule(validRule());
  assert(errs.length === 0, 'complete valid rule returns no errors');
}
{
  // Only amber set (red null) — still valid
  const errs = validateResultRule(validRule({ red: null }));
  assert(errs.length === 0, 'valid rule with only amber (red null) passes');
}
{
  // Only red set (amber null) — still valid
  const errs = validateResultRule(validRule({ amber: null }));
  assert(errs.length === 0, 'valid rule with only red (amber null) passes');
}
{
  // Below comparator with valid ordering: amber 130, red 125
  const errs = validateResultRule(
    validRule({ comparator: 'below', amber: 130, red: 125 })
  );
  assert(errs.length === 0, 'valid below rule with red <= amber passes');
}
{
  // id/enabled/builtin are allowed/ignored
  const errs = validateResultRule(validRule({ id: 'any', enabled: true, builtin: true }));
  assert(errs.length === 0, 'id/enabled/builtin fields ignored — no errors');
}
{
  // unit omitted — allowed
  const r = validRule();
  delete r.unit;
  const errs = validateResultRule(r);
  assert(errs.length === 0, 'unit omitted → still valid');
}

// ── validateResultRule: missing label ─────────────────────────────────────────
console.log('\n--- validateResultRule: missing / bad label ---');
{
  const errs = validateResultRule(validRule({ label: '' }));
  assert(errs.length > 0, 'empty label → error');
  assert(hasError(errs, 'label'), 'error mentions "label"');
}
{
  const errs = validateResultRule(validRule({ label: null }));
  assert(errs.length > 0, 'null label → error');
}
{
  const errs = validateResultRule(validRule({ label: 123 }));
  assert(errs.length > 0, 'non-string label → error');
}
{
  // label exactly at limit should pass; over limit should error
  const longLabel = 'A'.repeat(61);
  const errs = validateResultRule(validRule({ label: longLabel }));
  assert(errs.length > 0, '61-char label → error (over 60)');
  assert(hasError(errs, 'label'), 'error mentions "label"');
}
{
  const okLabel = 'A'.repeat(60);
  const errs = validateResultRule(validRule({ label: okLabel }));
  assert(errs.length === 0, '60-char label → valid (at limit)');
}

// ── validateResultRule: missing / bad analyte.match ───────────────────────────
console.log('\n--- validateResultRule: missing / bad analyte.match ---');
{
  const errs = validateResultRule(validRule({ analyte: null }));
  assert(errs.length > 0, 'null analyte → error');
  assert(hasError(errs, 'analyte'), 'error mentions "analyte"');
}
{
  const errs = validateResultRule(validRule({ analyte: {} }));
  assert(errs.length > 0, 'analyte with no match → error');
  assert(hasError(errs, 'match'), 'error mentions "match"');
}
{
  // match is not an array
  const errs = validateResultRule(validRule({ analyte: { match: 'potassium' } }));
  assert(errs.length > 0, 'non-array analyte.match → error');
  assert(hasError(errs, 'match'), 'error mentions "match"');
}
{
  // empty array
  const errs = validateResultRule(validRule({ analyte: { match: [] } }));
  assert(errs.length > 0, 'empty analyte.match array → error');
}
{
  // array of only empty strings
  const errs = validateResultRule(validRule({ analyte: { match: ['', '  '] } }));
  assert(errs.length > 0, 'analyte.match with only empty strings → error');
}

// ── validateResultRule: missing comparator ────────────────────────────────────
console.log('\n--- validateResultRule: missing / bad comparator ---');
{
  const errs = validateResultRule(validRule({ comparator: undefined }));
  assert(errs.length > 0, 'missing comparator → error');
  assert(hasError(errs, 'comparator'), 'error mentions "comparator"');
}
{
  const errs = validateResultRule(validRule({ comparator: 'equal' }));
  assert(errs.length > 0, '"equal" comparator → error');
  assert(hasError(errs, 'comparator'), 'error mentions "comparator"');
}
{
  const errs = validateResultRule(validRule({ comparator: '' }));
  assert(errs.length > 0, 'empty comparator → error');
}

// ── validateResultRule: neither amber nor red ─────────────────────────────────
console.log('\n--- validateResultRule: neither amber nor red ---');
{
  const errs = validateResultRule(validRule({ amber: null, red: null }));
  assert(errs.length > 0, 'both amber and red null → error');
  assert(hasError(errs, 'amber') || hasError(errs, 'red'), 'error mentions threshold field');
}
{
  const errs = validateResultRule(validRule({ amber: undefined, red: undefined }));
  assert(errs.length > 0, 'both amber and red undefined → error');
}
{
  // Non-finite value for amber
  const errs = validateResultRule(validRule({ amber: NaN }));
  assert(errs.length > 0, 'NaN amber → error');
}
{
  const errs = validateResultRule(validRule({ red: Infinity }));
  assert(errs.length > 0, 'Infinity red → error');
}

// ── validateResultRule: ordering — above, red < amber → error ─────────────────
console.log('\n--- validateResultRule: bad ordering for above comparator ---');
{
  // above: red must be >= amber; here red (5.0) < amber (5.5) → error
  const errs = validateResultRule(validRule({ comparator: 'above', amber: 5.5, red: 5.0 }));
  assert(errs.length > 0, 'above: red < amber → ordering error');
  assert(hasError(errs, 'red') || hasError(errs, 'amber') || hasError(errs, 'above'), 'error mentions relevant field');
}
{
  // above: red === amber → valid (boundary)
  const errs = validateResultRule(validRule({ comparator: 'above', amber: 5.5, red: 5.5 }));
  assert(errs.length === 0, 'above: red === amber → valid (equal is ok)');
}

// ── validateResultRule: ordering — below, red > amber → error ─────────────────
console.log('\n--- validateResultRule: bad ordering for below comparator ---');
{
  // below: red must be <= amber; here red (130) > amber (125) → error
  const errs = validateResultRule(validRule({ comparator: 'below', amber: 125, red: 130 }));
  assert(errs.length > 0, 'below: red > amber → ordering error');
  assert(hasError(errs, 'red') || hasError(errs, 'amber') || hasError(errs, 'below'), 'error mentions relevant field');
}
{
  // below: red === amber → valid (boundary)
  const errs = validateResultRule(validRule({ comparator: 'below', amber: 125, red: 125 }));
  assert(errs.length === 0, 'below: red === amber → valid (equal is ok)');
}

// ── validateResultRule: non-object input ──────────────────────────────────────
console.log('\n--- validateResultRule: non-object input ---');
{
  const errs = validateResultRule(null);
  assert(errs.length > 0, 'null input → error');
  assert(hasError(errs, 'object'), 'error mentions "object"');
}
{
  const errs = validateResultRule('a string');
  assert(errs.length > 0, 'string input → error');
}
{
  const errs = validateResultRule(42);
  assert(errs.length > 0, 'number input → error');
}
{
  const errs = validateResultRule(undefined);
  assert(errs.length > 0, 'undefined input → error');
}

// ── resultRuleSchemaPrompt: returns non-empty string ─────────────────────────
console.log('\n--- resultRuleSchemaPrompt ---');
{
  const prompt = resultRuleSchemaPrompt();
  assert(typeof prompt === 'string', 'resultRuleSchemaPrompt returns a string');
  assert(prompt.length > 0, 'prompt is non-empty');
  assert(prompt.toLowerCase().includes('disabled') || prompt.toLowerCase().includes('disable'),
    'prompt mentions "disabled" (imported rules arrive disabled)');
  assert(prompt.toLowerCase().includes('review'),
    'prompt mentions "review" (clinician must review before enabling)');
  assert(prompt.toLowerCase().includes('json'),
    'prompt mentions "JSON" (output format instruction)');
  assert(prompt.includes('"potassium"') || prompt.includes('potassium'),
    'prompt includes example analyte (potassium)');
  assert(prompt.includes('"above"') || prompt.includes('above'),
    'prompt covers the above comparator');
  assert(prompt.includes('"below"') || prompt.includes('below'),
    'prompt covers the below comparator');
  assert(prompt.includes('amber') || prompt.includes('5.5'),
    'prompt gives amber threshold example');
  assert(prompt.includes('red') || prompt.includes('6.0'),
    'prompt gives red threshold example');
  assert(!prompt.trimStart().startsWith('```'),
    'prompt does not start with a markdown fence (output only JSON instruction)');
}

// ── RESULT_RULE_FIELDS exported ───────────────────────────────────────────────
console.log('\n--- RESULT_RULE_FIELDS ---');
{
  assert(Array.isArray(RESULT_RULE_FIELDS), 'RESULT_RULE_FIELDS is an array');
  assert(RESULT_RULE_FIELDS.length > 0, 'RESULT_RULE_FIELDS is non-empty');
  assert(RESULT_RULE_FIELDS.includes('label'), 'RESULT_RULE_FIELDS includes "label"');
  assert(RESULT_RULE_FIELDS.includes('analyte'), 'RESULT_RULE_FIELDS includes "analyte"');
  assert(RESULT_RULE_FIELDS.includes('comparator'), 'RESULT_RULE_FIELDS includes "comparator"');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
