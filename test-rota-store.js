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

// ── Third copy: rota/app/app.js SYNC_SCOPES ──────────────────────────────────
//
// The list of scopes replicated to the practice shared folder is a THIRD
// parallel copy of the same eight keys (store.js KEYS → rota-io.js ROTA_KEYS →
// app.js SYNC_SCOPES). It uses the unprefixed FIELD names ('staff'), not the
// storage keys ('rota.staff').
//
// The intended relationship is FULL EQUALITY, verified against the file as it
// stands: everything the app persists is also shared, including `audit` (the
// named who-did-what trail is deliberately synced — practices want one audit
// trail, not one per machine) and `settings` (safe-staffing policy is a
// practice-level setting, not a per-machine one). If a future change means a
// scope must be deliberately withheld from the shared folder, narrow this
// assertion explicitly and say why here — do not delete it.
//
// Parsed, not imported: app.js is ESM and touches document/chrome on import.

const APP_PATH = path.join(__dirname, 'rota', 'app', 'app.js');
const appSrc = fs.readFileSync(APP_PATH, 'utf8');
const syncBlock = appSrc.match(/const\s+SYNC_SCOPES\s*=\s*\[([\s\S]*?)\]\s*;/);
check(!!syncBlock, 'rota/app/app.js exposes a `const SYNC_SCOPES = [ … ];` literal');

if (syncBlock) {
  const syncScopes = new Set();
  const srx = /'([^']+)'/g;
  let sm;
  while ((sm = srx.exec(syncBlock[1])) !== null) syncScopes.add(sm[1]);

  console.log(`  Scopes synced by rota/app/app.js:      ${syncScopes.size}`);

  const syncAsKeys = new Set([...syncScopes].map((s) => `rota.${s}`));
  const notSynced = [...storeKeys].filter((k) => !syncAsKeys.has(k));
  const syncedButUnknown = [...syncAsKeys].filter((k) => !storeKeys.has(k));

  if (notSynced.length) {
    console.error('\n  NOT SHARED (missing from SYNC_SCOPES in rota/app/app.js):');
    notSynced.forEach((k) => console.error(`    ${k}`));
  }
  if (syncedButUnknown.length) {
    console.error('\n  Synced but not a real store key (stale entry in SYNC_SCOPES):');
    syncedButUnknown.forEach((k) => console.error(`    ${k}`));
  }

  check(notSynced.length === 0, 'every rota/shared/store.js key is in rota/app/app.js SYNC_SCOPES');
  check(syncedButUnknown.length === 0, 'SYNC_SCOPES names no scope the store does not own');
  check(
    syncScopes.size === storeKeys.size,
    `SYNC_SCOPES is the same size as store.js KEYS (${syncScopes.size} vs ${storeKeys.size})`
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
