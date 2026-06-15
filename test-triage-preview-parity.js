// Guards the Triage Lens preview↔runtime parity fix (audit A1/A2).
//
// Before: the Options preview (triage-lens/options.js) had its OWN compileRule
// with a different object shape and a silent `catch(e){}` that dropped invalid
// regexes with no feedback — so the preview could tell a clinician a rule fires
// (or not) differently from what actually fires on the live page. Now both the
// content script and the preview delegate to the shared matcher in
// content-scripts/triage-lens/rule-match.js (window.TriageLensMatch), and
// compile errors are surfaced, not swallowed.
//
// This test (a) exercises the shared matcher directly, and (b) asserts via
// source inspection that BOTH content.js and options.js route through the
// shared matcher (no private divergent copy), so they cannot drift.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const M = require('./content-scripts/triage-lens/rule-match.js');

function rule(over) {
  return { id: 'r1', label: 'R1', enabled: true, regex: false, patterns: ['cough'], ...over };
}

// ── 1. Plain-text mode is a word STEM (leading \b only) ───────────────────────
console.log('--- plain-text stem matching ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));
  check(!!c && Array.isArray(c._compiled) && c._compiled.length === 1, 'compiles one pattern');
  check(M.ruleMatchesText(c, 'patient has a cough'), 'matches the exact word');
  check(M.ruleMatchesText(c, 'coughing for 3 days'), 'matches the stem (coughing)');
  check(!M.ruleMatchesText(c, 'no respiratory symptoms'), 'does not match unrelated text');
  check(M.ruleMatchesText(c, 'COUGH'), 'case-insensitive');
}

// ── 2. Regex mode keeps both word boundaries ──────────────────────────────────
console.log('--- regex mode ---');
{
  const c = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));
  check(M.ruleMatchesText(c, 'severe chest pain today'), 'regex rule matches');
  check(!M.ruleMatchesText(c, 'chest pains'), 'both \\b: "chest pains" not matched in regex mode');
}

// ── 3. Disabled / empty rules compile to null ─────────────────────────────────
console.log('--- null cases ---');
{
  check(M.compileRule(rule({ enabled: false })) === null, 'disabled rule → null');
  check(M.compileRule(rule({ patterns: [] })) === null, 'no patterns → null');
  check(M.compileRule(rule({ patterns: ['', '  '] })) === null, 'only blank patterns → null');
  check(M.compileRule(null) === null, 'null rule → null');
  check(M.ruleMatchesText(null, 'x') === false, 'ruleMatchesText null-safe');
}

// ── 4. Invalid regex is SURFACED in _errors, not swallowed; valid patterns still fire
console.log('--- invalid regex surfaced, not swallowed ---');
{
  // Mixed: one bad regex + one good one. Good one still compiles; error recorded.
  const c = M.compileRule(rule({ regex: true, patterns: ['valid', '(unclosed'] }));
  check(!!c && c._compiled.length === 1, 'good pattern still compiles when a sibling is invalid');
  check(Array.isArray(c._errors) && c._errors.length === 1, 'the invalid pattern is recorded in _errors');
  check(/unclosed/.test(c._errors[0]), '_errors message names the offending pattern');
  check(M.ruleMatchesText(c, 'this is valid'), 'the valid pattern still fires');

  // All patterns invalid → null (rule cannot fire), behaviour matches content.js.
  const allBad = M.compileRule(rule({ regex: true, patterns: ['(', '['] }));
  check(allBad === null, 'all-invalid rule → null (never fires)');
}

// ── 5. Parity: both content.js and options.js delegate to the shared matcher ──
console.log('--- source parity: single source of truth ---');
{
  const content = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/content.js'), 'utf8');
  const opts = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/options.js'), 'utf8');
  // Both must route compilation through the shared matcher…
  check(
    /window\.TriageLensMatch\.compileRule/.test(content),
    'content.js compiles via window.TriageLensMatch.compileRule'
  );
  check(
    /window\.TriageLensMatch\.compileRule/.test(opts),
    'options.js preview compiles via window.TriageLensMatch.compileRule'
  );
  // …and matching.
  check(
    /window\.TriageLensMatch\.ruleMatchesText/.test(content),
    'content.js matches via window.TriageLensMatch.ruleMatchesText'
  );
  check(
    /window\.TriageLensMatch\.ruleMatchesText/.test(opts),
    'options.js preview matches via window.TriageLensMatch.ruleMatchesText'
  );
  // Neither file may keep its own pattern-compiling RegExp loop (the old fork).
  check(!/new RegExp\(wrapped/.test(opts), 'options.js no longer has its own divergent compile loop');
  // The preview no longer swallows compile errors silently.
  check(/_errors/.test(opts), 'options.js surfaces compile errors (_errors), not catch(e){}');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
