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

// ── validateResultRule: text rule — valid ─────────────────────────────────────
console.log('\n--- validateResultRule: text rule valid cases ---');
{
  // Minimal valid text rule
  const errs = validateResultRule({
    id: 'rule_msu',
    enabled: false,
    builtin: false,
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU', 'urine culture'] },
    normalText: ['no growth'],
    normalLabel: 'No growth',
  });
  assert(errs.length === 0, 'complete valid text rule returns no errors');
}
{
  // normalLabel is optional — omitting it is valid
  const errs = validateResultRule({
    kind: 'text',
    label: 'Culture review',
    analyte: { match: ['culture'] },
    normalText: ['no growth', 'no significant growth'],
  });
  assert(errs.length === 0, 'text rule without normalLabel → still valid');
}
{
  // Multiple match and normalText entries are valid
  const errs = validateResultRule({
    kind: 'text',
    label: 'MSU / blood culture needs review',
    analyte: { match: ['MSU', 'blood culture', 'HVS'] },
    normalText: ['no growth', 'no significant growth', 'no organisms isolated'],
    normalLabel: 'Negative',
  });
  assert(errs.length === 0, 'text rule with multiple match and normalText strings → valid');
}

// ── validateResultRule: text rule — missing normalText ────────────────────────
console.log('\n--- validateResultRule: text rule — missing / bad normalText ---');
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    // normalText missing entirely
  });
  assert(errs.length > 0, 'text rule missing normalText → error');
  assert(
    errs.some(e => e.toLowerCase().includes('normaltext')),
    'error mentions "normalText"'
  );
}
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: [], // empty array
  });
  assert(errs.length > 0, 'text rule with empty normalText → error');
}
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: ['', '   '], // only empty strings
  });
  assert(errs.length > 0, 'text rule with only empty normalText strings → error');
}
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: 'no growth', // not an array
  });
  assert(errs.length > 0, 'text rule normalText as string (not array) → error');
}

// ── validateResultRule: text rule — missing label ─────────────────────────────
console.log('\n--- validateResultRule: text rule — missing / bad label ---');
{
  const errs = validateResultRule({
    kind: 'text',
    label: '',
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
  });
  assert(errs.length > 0, 'text rule empty label → error');
}
{
  const errs = validateResultRule({
    kind: 'text',
    // label omitted
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
  });
  assert(errs.length > 0, 'text rule missing label → error');
}
{
  // label over 60 chars
  const errs = validateResultRule({
    kind: 'text',
    label: 'A'.repeat(61),
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
  });
  assert(errs.length > 0, 'text rule label > 60 chars → error');
}

// ── validateResultRule: text rule — missing analyte.match ─────────────────────
console.log('\n--- validateResultRule: text rule — missing analyte.match ---');
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    // analyte missing
    normalText: ['no growth'],
  });
  assert(errs.length > 0, 'text rule missing analyte → error');
}
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: [] },
    normalText: ['no growth'],
  });
  assert(errs.length > 0, 'text rule empty analyte.match → error');
}

// ── validateResultRule: text rule — bad normalLabel type ──────────────────────
console.log('\n--- validateResultRule: text rule — bad normalLabel type ---');
{
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
    normalLabel: 42, // must be string or omitted
  });
  assert(errs.length > 0, 'text rule normalLabel as number → error');
  assert(
    errs.some(e => e.toLowerCase().includes('normallabel')),
    'error mentions "normalLabel"'
  );
}
{
  // null normalLabel is allowed (treated as omitted)
  const errs = validateResultRule({
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
    normalLabel: null,
  });
  assert(errs.length === 0, 'text rule normalLabel null → valid (treated as omitted)');
}

// ── validateResultRule: text rule — abnormalText (flag-if-present) ────────────
console.log('\n--- validateResultRule: text rule — abnormalText ---');
{
  // abnormalText-only text rule (no normalText) is valid — flags a specific finding.
  const errs = validateResultRule({
    kind: 'text',
    label: 'Bowel screening: no response',
    analyte: { match: ['bcs:fob', 'bowel cancer screening'] },
    abnormalText: ['no response to bowel cancer screening'],
  });
  assert(errs.length === 0, 'abnormalText-only text rule (no normalText) → valid');
}
{
  // Both normalText and abnormalText present → valid.
  const errs = validateResultRule({
    kind: 'text',
    label: 'Culture',
    analyte: { match: ['culture'] },
    normalText: ['no growth'],
    abnormalText: ['scanty growth'],
  });
  assert(errs.length === 0, 'text rule with both normalText and abnormalText → valid');
}
{
  // Neither normalText nor abnormalText → error (cannot classify anything).
  const errs = validateResultRule({
    kind: 'text',
    label: 'Empty',
    analyte: { match: ['bcs:fob'] },
  });
  assert(errs.length > 0, 'text rule with neither normalText nor abnormalText → error');
  assert(
    errs.some(e => e.toLowerCase().includes('normaltext') || e.toLowerCase().includes('abnormaltext')),
    'error mentions the required classification lists'
  );
}
{
  // abnormalText present but empty, and no normalText → still an error.
  const errs = validateResultRule({
    kind: 'text',
    label: 'Empty arrays',
    analyte: { match: ['bcs:fob'] },
    abnormalText: [],
  });
  assert(errs.length > 0, 'empty abnormalText with no normalText → error');
}
{
  // abnormalText as a string (not an array) → error.
  const errs = validateResultRule({
    kind: 'text',
    label: 'Bad abnormalText',
    analyte: { match: ['bcs:fob'] },
    abnormalText: 'no response to bowel cancer screening',
  });
  assert(errs.length > 0, 'abnormalText as string (not array) → error');
  assert(
    errs.some(e => e.toLowerCase().includes('abnormaltext')),
    'error mentions "abnormalText"'
  );
}
{
  // abnormalText satisfies the "at least one list" requirement even when normalText is absent.
  const errs = validateResultRule({
    kind: 'text',
    label: 'Non-responder',
    analyte: { match: ['bcs:fob'] },
    abnormalText: ['no response', 'non-responder'],
    normalLabel: 'n/a', // allowed even on an abnormalText-only rule
  });
  assert(errs.length === 0, 'abnormalText satisfies the required-list check; normalLabel still allowed');
}

// ── validateResultRule: unknown kind → rejected ───────────────────────────────
console.log('\n--- validateResultRule: unknown kind rejected ---');
{
  const errs = validateResultRule({
    kind: 'regex',
    label: 'Some rule',
    analyte: { match: ['MSU'] },
  });
  assert(errs.length > 0, 'unknown kind "regex" → error');
  assert(
    errs.some(e => e.toLowerCase().includes('kind')),
    'error mentions "kind"'
  );
}
{
  const errs = validateResultRule({
    kind: 'THRESHOLD', // wrong case
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
  });
  assert(errs.length > 0, 'kind "THRESHOLD" (wrong case) → error (must be exact string)');
}
{
  const errs = validateResultRule({
    kind: 'numeric',
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
  });
  assert(errs.length > 0, 'unknown kind "numeric" → error');
}

// ── validateResultRule: numeric rules still validate normally ──────────────────
console.log('\n--- validateResultRule: numeric rules still validate normally with kind absent or explicit ---');
{
  // kind absent — should be treated as threshold and pass
  const errs = validateResultRule(validRule());
  assert(errs.length === 0, 'kind absent → threshold path, valid rule passes');
}
{
  // kind explicit 'threshold'
  const errs = validateResultRule(validRule({ kind: 'threshold' }));
  assert(errs.length === 0, "kind 'threshold' explicit → valid rule passes");
}
{
  // threshold rule must still reject bad comparator even when kind is explicit
  const errs = validateResultRule(validRule({ kind: 'threshold', comparator: 'equal' }));
  assert(errs.length > 0, "kind 'threshold' with bad comparator → error");
}

// ── resultRuleSchemaPrompt: documents both text and threshold kinds ────────────
console.log('\n--- resultRuleSchemaPrompt: covers both kinds ---');
{
  const prompt = resultRuleSchemaPrompt();
  // Existing checks (duplicated here for completeness with text-rule additions)
  assert(prompt.toLowerCase().includes('disabled') || prompt.toLowerCase().includes('disable'),
    'prompt mentions "disabled"');
  assert(prompt.toLowerCase().includes('review'), 'prompt mentions "review"');
  // Text-rule specific checks
  assert(
    prompt.includes('text') || prompt.toLowerCase().includes("kind:'text'") || prompt.includes('"text"'),
    'prompt mentions text kind'
  );
  assert(
    prompt.toLowerCase().includes('normallabel') || prompt.toLowerCase().includes('normal label') ||
    prompt.toLowerCase().includes('normaltext') || prompt.toLowerCase().includes('normal text') ||
    prompt.includes('no growth'),
    'prompt mentions text-rule fields (normalText/normalLabel) or example phrase "no growth"'
  );
  assert(
    prompt.toLowerCase().includes('msu') || prompt.toLowerCase().includes('urine culture') ||
    prompt.toLowerCase().includes('microbiology') || prompt.toLowerCase().includes('culture'),
    'prompt gives a microbiology / culture example for text rules'
  );
  assert(
    prompt.toLowerCase().includes('abnormaltext'),
    'prompt documents the abnormalText (flag-if-present) field'
  );
}

// ── analyte.exclude (optional) validation ────────────────────────────────────
console.log('\n--- analyte.exclude validation ---');
{
  assert(
    validateResultRule(validRule({ analyte: { match: ['potassium'], exclude: ['urine'] } })).length === 0,
    'exclude: array of strings is valid'
  );
  assert(
    validateResultRule(validRule({ analyte: { match: ['potassium'] } })).length === 0,
    'exclude: omitted is valid (optional)'
  );
  assert(
    validateResultRule(validRule({ analyte: { match: ['potassium'], exclude: [] } })).length === 0,
    'exclude: empty array is valid'
  );
  assert(
    validateResultRule(validRule({ analyte: { match: ['potassium'], exclude: 'urine' } })).length > 0,
    'exclude: a string (not array) is rejected'
  );
  assert(
    validateResultRule(validRule({ analyte: { match: ['potassium'], exclude: ['urine', 5] } })).length > 0,
    'exclude: non-string members are rejected'
  );
  // exclude is documented in the authoring prompt
  const prompt = resultRuleSchemaPrompt();
  assert(prompt.toLowerCase().includes('exclude'), 'prompt documents the exclude field');
}

// ── suppressIfProblem (optional) validation ──────────────────────────────────
console.log('\n--- suppressIfProblem validation ---');
{
  const withSuppress = (s) => validRule({ suppressIfProblem: s });
  assert(
    validateResultRule(withSuppress({ match: ['diabetes mellitus'], exclude: ['non-diabetic'] })).length === 0,
    'suppressIfProblem: {match, exclude} is valid'
  );
  assert(
    validateResultRule(withSuppress({ match: ['diabetes mellitus'] })).length === 0,
    'suppressIfProblem: match alone is valid'
  );
  assert(validateResultRule(validRule({})).length === 0, 'suppressIfProblem: omitted is valid (optional)');
  assert(
    validateResultRule(withSuppress({ exclude: ['x'] })).length > 0,
    'suppressIfProblem: missing match is rejected'
  );
  assert(
    validateResultRule(withSuppress({ match: [] })).length > 0,
    'suppressIfProblem: empty match is rejected'
  );
  assert(
    validateResultRule(withSuppress(['diabetes'])).length > 0,
    'suppressIfProblem: array (not object) is rejected'
  );
  assert(
    validateResultRule(withSuppress({ match: ['dm'], exclude: 'non-diabetic' })).length > 0,
    'suppressIfProblem: string exclude (not array) is rejected'
  );
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
