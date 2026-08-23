// Medicus Suite — module lifecycle contract test (audit C3/0.2, 2026-07-18)
// Run with: node test-module-lifecycle.js
//
// The shell's module loader (side-panel/module-loader.js) tears a module down
// ONLY via the function its init() RETURNS — an exported cleanup that init
// forgets to return is dead code, and every listener/timer init registered
// leaks for the panel's lifetime (this is exactly how the Record tab leaked:
// four listeners per visit, each firing a background full-record fetch on
// every tab switch, forever). This test asserts the contract STATICALLY for
// every real module in panel.js's MODULES map: the init source must end by
// returning a function (either `return cleanup` / `return () => ...` or an
// arrow to a named cleanup), so the contract can't silently break again.
//
// Static source check (not a runtime import): modules pull in chrome.* APIs,
// CSS-adjacent DOM and sibling ES modules at import time, so importing them
// in bare Node would need a heavy jsdom+chrome mock. The source-level check
// is deliberate — it is the same style as test-tour-steps.js's selector guard
// and catches the failure mode that shipped (a missing `return cleanup;`).

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
const { pathToFileURL } = require('url');

(async () => {
const { TAB_CATALOG } = await import(pathToFileURL(path.join(ROOT, 'side-panel', 'tab-catalog.js')).href);
const modulePaths = TAB_CATALOG.filter((t) => t.kind === 'module').map((t) => './modules/' + t.entry);
check(modulePaths.length >= 15, `found ${modulePaths.length} module entries in tab-catalog.js`);

// Pull the body of `export async function init(` (to the matching close brace
// at depth 0) and assert it contains a `return <fn>` that yields a function:
// `return cleanup;`, `return () =>`, or `return function`.
function initBody(src) {
  const m = src.match(/export\s+(?:async\s+)?function\s+init\s*\(/);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i + 1, j);
    }
  }
  return null;
}

const RETURNS_FN_RE = /return\s+(cleanup\b|\(\s*\)\s*=>|function\b|async\s*\(\s*\)\s*=>)/;

for (const rel of modulePaths) {
  const full = path.join(ROOT, 'side-panel', rel.replace('./', ''));
  const src = fs.readFileSync(full, 'utf8');
  const body = initBody(src);
  check(body !== null, `${rel}: init() found`);
  if (body === null) continue;
  check(RETURNS_FN_RE.test(body), `${rel}: init() returns a cleanup function (loader contract)`);
}

// Regression pin for the shipped failure: record.js specifically.
{
  const rec = fs.readFileSync(path.join(ROOT, 'side-panel/modules/record/record.js'), 'utf8');
  check(RETURNS_FN_RE.test(initBody(rec) || ''), 'record.js init returns cleanup (audit C3 regression pin)');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
