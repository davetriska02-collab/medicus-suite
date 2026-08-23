// Medicus Suite — pill/tile colour-palette consumption + CSS sync test
// Run with:  node test-pill-palette-sync.js
//
// The JS key list is a single source (shared/pill-palette.js). CSS cannot
// import JS, so --swatch-* tokens in panel.css stay independently defined
// and this test still pins them to the shared key list.

'use strict';
const fs = require('fs');
const path = require('path');

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

const { SWATCH_KEYS, TILE_COLOUR_KEYS } = require('./shared/pill-palette.js');
require('./shared/reception-pathway-utils.js');
const { TILE_COLOUR_KEYS: fromRpu } = require('./shared/reception-pathway-utils.js');

const ppSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/shared/pill-prefs.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, 'side-panel/panel.css'), 'utf8');
const tokenCounts = {};
for (const m of cssSrc.matchAll(/--swatch-([a-z]+):/g)) {
  tokenCounts[m[1]] = (tokenCounts[m[1]] || 0) + 1;
}
const tokenNames = Object.keys(tokenCounts).sort();

console.log('\n--- pill/tile palette sync ---');

check(
  JSON.stringify(SWATCH_KEYS) === JSON.stringify(TILE_COLOUR_KEYS),
  `SWATCH_KEYS === TILE_COLOUR_KEYS  (${JSON.stringify(SWATCH_KEYS)})`
);
check(SWATCH_KEYS === fromRpu, 'reception-pathway-utils TILE_COLOUR_KEYS is the shared array (same object)');
check(ppSrc.includes('globalThis.PillPalette'), 'pill-prefs.js consumes PillPalette');
check(!/export const SWATCH_KEYS = \[/.test(ppSrc), 'pill-prefs.js no longer defines the key list');

check(SWATCH_KEYS.includes('default'), "palette includes 'default' (no-colour)");
const colourKeys = SWATCH_KEYS.filter((k) => k !== 'default').sort();
for (const k of colourKeys) {
  check(tokenCounts[k] >= 2, `--swatch-${k} defined in light + dark`);
}
check(
  JSON.stringify(tokenNames) === JSON.stringify(colourKeys),
  `panel.css --swatch-* tokens match the non-default keys  (${JSON.stringify(tokenNames)})`
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exitCode = 1;
