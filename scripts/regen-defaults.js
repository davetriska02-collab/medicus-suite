#!/usr/bin/env node
// Medicus Suite — regenerate the derived Triage Lens defaults copies.
//
// The Triage Lens shipped config lives in THREE places that must stay identical
// as parsed objects:
//   1. defaults.json                              (root — the SOURCE OF TRUTH,
//                                                  loaded at runtime via getURL)
//   2. content-scripts/triage-lens/defaults.json  (derived copy)
//   3. EMBEDDED_DEFAULTS template literal in
//      content-scripts/triage-lens/content.js      (derived synchronous fallback)
//
// EDIT ONLY the root defaults.json, then run:  node scripts/regen-defaults.js
// This regenerates (2) and (3) from (1). Run with --check to verify they are in
// sync without writing (used by the test suite / CI) — exits non-zero on drift.
//
// Hand-editing the embedded literal is error-prone (the backslashes are doubled
// for the template literal); this script removes the need to ever do it by hand.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'defaults.json');
const CS = path.join(__dirname, '..', 'content-scripts', 'triage-lens', 'defaults.json');
const CONTENT = path.join(__dirname, '..', 'content-scripts', 'triage-lens', 'content.js');
const START = 'const EMBEDDED_DEFAULTS = `';
const END = '`;';

// Compact JSON with non-ASCII escaped as \uXXXX (matches the embedded style),
// then backslashes doubled, backticks escaped, and template-literal
// interpolation starts (${) escaped so the string survives being embedded in
// a template literal.
function buildEmbeddedLiteral(obj) {
  const compact = JSON.stringify(obj).replace(/[\u0080-\uffff]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return compact.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function currentEmbeddedLiteral(src) {
  const start = src.indexOf(START);
  if (start < 0) throw new Error('EMBEDDED_DEFAULTS marker not found in content.js');
  const from = start + START.length;
  const end = src.indexOf(END, from);
  if (end < 0) throw new Error('EMBEDDED_DEFAULTS closing backtick not found');
  return { literal: src.slice(from, end), from, end };
}

const check = process.argv.includes('--check');
const rootRaw = fs.readFileSync(ROOT, 'utf8');
const obj = JSON.parse(rootRaw);
const wantLiteral = buildEmbeddedLiteral(obj);
const src = fs.readFileSync(CONTENT, 'utf8');
const { literal: haveLiteral, from, end } = currentEmbeddedLiteral(src);
const csRaw = fs.existsSync(CS) ? fs.readFileSync(CS, 'utf8') : null;

const problems = [];
if (csRaw !== rootRaw) problems.push('content-scripts/triage-lens/defaults.json differs from root defaults.json');
if (haveLiteral !== wantLiteral) problems.push('EMBEDDED_DEFAULTS in content.js is out of sync with defaults.json');

if (check) {
  if (problems.length) {
    console.error('Defaults are OUT OF SYNC:\n  - ' + problems.join('\n  - ') +
      '\n\nRun: node scripts/regen-defaults.js');
    process.exit(1);
  }
  console.log('Defaults in sync (root == content-scripts copy == EMBEDDED_DEFAULTS).');
  process.exit(0);
}

// Write mode
fs.writeFileSync(CS, rootRaw);
if (haveLiteral !== wantLiteral) {
  fs.writeFileSync(CONTENT, src.slice(0, from) + wantLiteral + src.slice(end));
}
console.log(problems.length ? 'Regenerated derived defaults copies.' : 'Already in sync — nothing to do.');
