// Medicus Suite — Triage Lens defaults drift guard
// Run with: node test-triage-defaults.js
//
// Triage Lens ships its default config in TWO places that must stay identical:
//   1. content-scripts/triage-lens/defaults.json   (loaded by the options page)
//   2. EMBEDDED_DEFAULTS in content-scripts/triage-lens/content.js
//      (the synchronous fallback the content script uses before chrome.storage
//       resolves — a content script can't async-fetch JSON at load)
// The in-file SYS_CHIP_DEFAULTS map is now DERIVED from EMBEDDED_DEFAULTS, so
// those two are guaranteed in sync. This test pins the remaining file↔string
// duplication so it can't silently drift again.

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const dir = path.join(__dirname, 'content-scripts', 'triage-lens');
const fileDefaults = require(path.join(dir, 'defaults.json'));

// Extract the EMBEDDED_DEFAULTS template literal from content.js and evaluate it
// to its runtime string value (no interpolation in it), then JSON.parse.
const src = fs.readFileSync(path.join(dir, 'content.js'), 'utf8');
const m = src.match(/const EMBEDDED_DEFAULTS = `([\s\S]*?)`;/);
let embedded = null;
check(!!m, 'EMBEDDED_DEFAULTS literal found in content.js');
if (m) {
  const body = m[1];
  check(!body.includes('`') && !body.includes('${'),
        'EMBEDDED_DEFAULTS contains no backticks or ${ (safe to evaluate)');
  // eslint-disable-next-line no-new-func
  const strValue = Function('return `' + body + '`')();
  embedded = JSON.parse(strValue);
  check(true, 'EMBEDDED_DEFAULTS parses as JSON');
}

if (embedded) {
  // The two default sources must be byte-for-byte equivalent objects.
  let identical = true;
  try { assert.deepStrictEqual(embedded, fileDefaults); }
  catch (e) { identical = false; console.error('    ' + e.message.split('\n')[0]); }
  check(identical, 'content-scripts defaults.json and EMBEDDED_DEFAULTS are identical (no drift)');

  // The ROOT defaults.json is the copy actually loaded at runtime (via getURL)
  // but was previously NOT guarded here — pin it too so all three stay in lock-step.
  let rootMatches = true;
  try { assert.deepStrictEqual(require(path.join(__dirname, 'defaults.json')), fileDefaults); }
  catch (e) { rootMatches = false; console.error('    ' + e.message.split('\n')[0]); }
  check(rootMatches, 'root defaults.json matches content-scripts copy (no drift)');

  // The regenerator must reproduce the derived copies byte-for-byte. This guards
  // against hand-edits to EMBEDDED_DEFAULTS that drift from the source of truth.
  const { execFileSync } = require('child_process');
  let regenInSync = true;
  try { execFileSync('node', [path.join(__dirname, 'scripts', 'regen-defaults.js'), '--check'], { stdio: 'pipe' }); }
  catch (e) { regenInSync = false; console.error('    regen --check failed: ' + String(e.stdout || e.message).split('\n')[0]); }
  check(regenInSync, 'scripts/regen-defaults.js --check passes (derived copies reproducible)');

  // Read-time chips are gone from both sources.
  const fileKeys = Object.keys(fileDefaults.systemChips || {});
  const embKeys = Object.keys(embedded.systemChips || {});
  check(fileKeys.every(k => !/readTime/i.test(k)), 'defaults.json has no readTime chips');
  check(embKeys.every(k => !/readTime/i.test(k)), 'EMBEDDED_DEFAULTS has no readTime chips');

  // estimateReadTime helper and its callers are gone from content.js.
  check(!/estimateReadTime/.test(src), 'content.js no longer references estimateReadTime');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
