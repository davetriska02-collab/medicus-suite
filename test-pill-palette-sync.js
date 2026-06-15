// Medicus Suite — pill/tile colour-palette drift-guard test
// Run with:  node test-pill-palette-sync.js
//
// PURPOSE: The user-colour swatch palette is referenced from three places that
// cannot import one another (different module systems / a stylesheet):
//   1. side-panel/modules/shared/pill-prefs.js  — SWATCH_KEYS (ESM)
//   2. shared/reception-pathway-utils.js         — TILE_COLOUR_KEYS (UMD/classic)
//   3. side-panel/panel.css                      — the --swatch-* design tokens
// Slots and Reception keep their own organise-mode logic (Reception's is richer:
// alpha sort, id validation, prototype-pollution guard — deliberately NOT merged
// onto the simpler shared helper), but the PALETTE itself must stay in lock-step.
// This test fails if the three drift apart, forcing a synchronised edit — the
// same convert-drift-into-CI-failure pattern as test-clinical-thresholds-sync.js.

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
    process.exitCode = 1;
  }
}

// 1. SWATCH_KEYS from the ESM pill-prefs.js (vm-extract the array literal).
const ppSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/shared/pill-prefs.js'), 'utf8');
const ppMatch = ppSrc.match(/export const SWATCH_KEYS = (\[[^\]]*\]);/);
check(!!ppMatch, 'SWATCH_KEYS extracted from pill-prefs.js');
let SWATCH_KEYS = [];
if (ppMatch) {
  const sb = {};
  vm.runInNewContext('this.k = ' + ppMatch[1] + ';', sb);
  SWATCH_KEYS = sb.k;
}

// 2. TILE_COLOUR_KEYS from the require-able UMD reception util.
const { TILE_COLOUR_KEYS } = require('./shared/reception-pathway-utils.js');

// 3. --swatch-* token names from panel.css (collect unique, both blocks present).
const cssSrc = fs.readFileSync(path.join(__dirname, 'side-panel/panel.css'), 'utf8');
const tokenCounts = {};
for (const m of cssSrc.matchAll(/--swatch-([a-z]+):/g)) {
  tokenCounts[m[1]] = (tokenCounts[m[1]] || 0) + 1;
}
const tokenNames = Object.keys(tokenCounts).sort();

console.log('\n--- pill/tile palette sync ---');

// The two key lists must be identical (same elements, same order).
check(
  JSON.stringify(SWATCH_KEYS) === JSON.stringify(TILE_COLOUR_KEYS),
  `SWATCH_KEYS === TILE_COLOUR_KEYS  (${JSON.stringify(SWATCH_KEYS)})`
);

// 'default' means "no colour" and intentionally has NO --swatch token.
const colourKeys = SWATCH_KEYS.filter((k) => k !== 'default').sort();
check(SWATCH_KEYS.includes('default'), "palette includes 'default' (no-colour)");

// Every non-default key has a --swatch-<key> token, defined in BOTH themes (≥2).
for (const k of colourKeys) {
  check(tokenCounts[k] >= 2, `--swatch-${k} defined in light + dark`);
}

// No orphan tokens (a --swatch-* with no matching key).
check(
  JSON.stringify(tokenNames) === JSON.stringify(colourKeys),
  `panel.css --swatch-* tokens match the non-default keys  (${JSON.stringify(tokenNames)})`
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exitCode = 1;
