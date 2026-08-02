// Medicus Suite — Rota storage-key anti-drift guard
// Run with: node test-rota-store.js
//
// rota/shared/store.js owns the canonical list of chrome.storage.local keys the
// Rota module writes (its KEYS object literal). shared/io/rota-io.js is what
// puts those keys into suite backups. If the app gains a rota.* key and the io
// file is not updated, that data silently escapes every backup — this test
// turns that into a CI failure.
//
// Parsing (not importing) store.js on purpose: it is an ES module in a subtree
// with its own "type":"module" package.json, and importing it would drag in
// chrome.storage / localStorage. A text scan of the KEYS literal is enough.

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
  }
}

const STORE_PATH = path.join(__dirname, 'rota', 'shared', 'store.js');
const src = fs.readFileSync(STORE_PATH, 'utf8');

// Extract the `const KEYS = { … };` object literal, then every quoted value in it.
const block = src.match(/const\s+KEYS\s*=\s*\{([\s\S]*?)\}\s*;/);
check(!!block, 'rota/shared/store.js exposes a `const KEYS = { … };` literal');
if (!block) {
  console.error('\n--- Results: cannot continue without the KEYS literal ---\n');
  process.exit(1);
}

const storeKeys = new Set();
const rx = /:\s*'([^']+)'/g;
let m;
while ((m = rx.exec(block[1])) !== null) storeKeys.add(m[1]);

const { ROTA_KEYS } = require('./shared/io/rota-io.js');
const ioKeys = new Set(ROTA_KEYS);

console.log('\n--- Rota storage-key coverage ---');
console.log(`  Keys declared in rota/shared/store.js: ${storeKeys.size}`);
console.log(`  Keys covered by shared/io/rota-io.js:  ${ioKeys.size}`);

check(storeKeys.size >= 8, `store.js KEYS scan is non-trivially large (got ${storeKeys.size})`);
check(
  [...storeKeys].every((k) => k.startsWith('rota.')),
  'every store.js key is namespaced rota.*'
);

const missing = [...storeKeys].filter((k) => !ioKeys.has(k));
const extra = [...ioKeys].filter((k) => !storeKeys.has(k));

if (missing.length) {
  console.error('\n  NOT BACKED UP (add to ROTA_KEYS + rotaExport/rotaImport in shared/io/rota-io.js):');
  missing.forEach((k) => console.error(`    ${k}`));
}
if (extra.length) {
  console.error('\n  Covered but no longer written by the app (stale entry in rota-io.js):');
  extra.forEach((k) => console.error(`    ${k}`));
}

check(missing.length === 0, 'every rota/shared/store.js key is covered by shared/io/rota-io.js');
check(extra.length === 0, 'shared/io/rota-io.js declares no keys the app does not use');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
