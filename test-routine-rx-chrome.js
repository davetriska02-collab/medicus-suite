// Medicus Suite — Routine-Rx chrome source lock
// Run with: node test-routine-rx-chrome.js
//
// Pins the v3.247.0 ghost-pill restyle of content-scripts/triage-lens/
// routine-rx-button.js (+ optional routine-rx-button.css). Behaviour of the
// four-step macro stays in test-routine-rx-macro.js; this file only greps
// chrome: no teal FAB, no emoji on the button, no POST, pill tokens if CSS
// has shipped. CSS is listed in the manifest but may not be on disk yet —
// missing CSS is a skip, not a fail.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const JS_PATH = path.join(__dirname, 'content-scripts', 'triage-lens', 'routine-rx-button.js');
const CSS_PATH = path.join(__dirname, 'content-scripts', 'triage-lens', 'routine-rx-button.css');

const js = fs.readFileSync(JS_PATH, 'utf8');

// Drop block then line comments so retired-chrome notes can mention ⚡ / ✎.
// `(^|[^:])` keeps `https://` intact.
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n--- JS chrome source lock ---');

check(!/#0d6e5e/i.test(js), 'JS has no teal #0d6e5e');
check(/chrx-btn/.test(js), 'chrx-btn class is still the button host');
check(!/method:\s*['"]POST['"]/.test(js), "JS has no method: 'POST'");

const jsCode = withoutComments(js);
check(!/[⚡✎]/.test(jsCode), 'no ⚡ or ✎ in button copy (comments allowed)');

console.log('\n--- CSS chrome source lock ---');

if (!fs.existsSync(CSS_PATH)) {
  check(true, 'routine-rx-button.css not on disk yet — CSS checks skipped');
} else {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  check(!/#0d6e5e/i.test(css), 'CSS has no teal #0d6e5e');
  check(/#1e3a5f/.test(css), 'CSS uses ghost-pill navy #1e3a5f (same as #ms-rfc-pill)');
  check(/#2563eb/.test(css), 'CSS uses ghost-pill accent #2563eb (same as #ms-rfc-pill)');
  check(/999px|--r-pill/.test(css), 'CSS pill radius is 999px or --r-pill');
  check(/prefers-reduced-motion/.test(css), 'CSS respects prefers-reduced-motion');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
