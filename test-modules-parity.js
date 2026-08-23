// Medicus Suite — MODULES-map parity (architecture plan Phase 0.2)
// Run with: node test-modules-parity.js
//
// panel.js and pop-out/pop-out.js each keep a MODULES map. The HTML navs are
// already parity-tested (test-tab-help-coverage.js); the JS maps were not.
// A module present in one shell's map and absent from the other silently
// doesn't load in that shell. This test parses both maps the same way
// test-module-lifecycle.js does and asserts the same keys, modulo the
// documented panel-only set (about — and the full-tab openers, which are
// deliberately absent from both maps).

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

const ROOT = __dirname;

function extractModuleKeys(src) {
  // Top-level MODULES keys only: `today: {` / `'patient-alerts': {` / `about: null`.
  // Nested `js:` / `css:` are ignored because their values are not `{` or `null`.
  const start = src.indexOf('const MODULES = {');
  check(start !== -1, 'found const MODULES = {');
  if (start === -1) return [];
  const from = src.slice(start);
  let depth = 0;
  let end = -1;
  for (let i = from.indexOf('{'); i < from.length; i++) {
    if (from[i] === '{') depth++;
    else if (from[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = end === -1 ? from : from.slice(0, end + 1);
  return [...block.matchAll(/^\s+(?:'([a-z-]+)'|([a-z]+))\s*:\s*(?:\{|null)/gm)].map(
    (m) => m[1] || m[2]
  );
}

const panelSrc = fs.readFileSync(path.join(ROOT, 'side-panel', 'panel.js'), 'utf8');
const popoutSrc = fs.readFileSync(path.join(ROOT, 'pop-out', 'pop-out.js'), 'utf8');

const panelKeys = extractModuleKeys(panelSrc);
const popoutKeys = extractModuleKeys(popoutSrc);

check(panelKeys.length >= 15, `panel.js MODULES has ${panelKeys.length} keys`);
check(popoutKeys.length >= 15, `pop-out.js MODULES has ${popoutKeys.length} keys`);

const PANEL_ONLY = new Set(['about']);
const panelReal = panelKeys.filter((k) => !PANEL_ONLY.has(k));

const missingInPopout = panelReal.filter((k) => !popoutKeys.includes(k));
const extraInPopout = popoutKeys.filter((k) => !panelReal.includes(k));

check(
  missingInPopout.length === 0,
  missingInPopout.length === 0
    ? 'every real panel MODULES key is in pop-out.js'
    : `panel MODULES keys missing from pop-out: ${missingInPopout.join(', ')}`
);
check(
  extraInPopout.length === 0,
  extraInPopout.length === 0
    ? 'no extra pop-out MODULES keys'
    : `pop-out MODULES keys not in panel: ${extraInPopout.join(', ')}`
);

// Full-tab openers must stay out of both maps (boot-restore guard).
for (const id of ['visualiser', 'duplicate-checker', 'rota-app']) {
  check(!panelKeys.includes(id), `panel MODULES does not contain full-tab opener "${id}"`);
  check(!popoutKeys.includes(id), `pop-out MODULES does not contain full-tab opener "${id}"`);
}

check(panelKeys.includes('about'), 'panel MODULES includes about (inline, panel-only)');
check(!popoutKeys.includes('about'), 'pop-out MODULES omits about (panel-only)');

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
