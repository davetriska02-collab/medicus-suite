// Medicus Suite — sibling-import rule (architecture plan Phase 3.5)
// Run with: node test-sibling-imports.js
//
// A side-panel module may import another module's *-core / *-store / *-ledger
// / *-api files and anything under modules/shared/. It must NOT import another
// module's entry file (<name>/<name>.js) — that couples teardown/init to a
// sibling tab (the sentinel → followups.js inversion).

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

const MOD_ROOT = path.join(__dirname, 'side-panel', 'modules');
const ALLOWED_SUFFIX = /-(core|store|ledger|api)\.js$/;
const IMPORT_RE = /from\s+['"](\.\.\/[a-z0-9-]+\/[a-z0-9.-]+\.js)['"]/g;

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const violations = [];
for (const abs of listJs(MOD_ROOT)) {
  const rel = path.relative(MOD_ROOT, abs).split(path.sep).join('/');
  const fromMod = rel.split('/')[0];
  const src = fs.readFileSync(abs, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1]; // ../other/file.js
    const parts = spec.replace(/^\.\.\//, '').split('/');
    const toMod = parts[0];
    const file = parts.slice(1).join('/');
    if (toMod === 'shared') continue;
    if (toMod === fromMod) continue;
    if (ALLOWED_SUFFIX.test(file)) continue;
    // entry file = <mod>/<mod>.js
    if (file === `${toMod}.js`) {
      violations.push(`${rel} imports ${spec}`);
    }
  }
}

check(
  violations.length === 0,
  violations.length === 0
    ? 'no module imports another module’s entry file'
    : `entry-file imports:\n    ${violations.join('\n    ')}`
);

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
