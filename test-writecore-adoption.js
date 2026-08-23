// Medicus Suite — WriteCore adoption guard (architecture plan Phase 0.5)
// Run with: node test-writecore-adoption.js
//
// shared/write-core.js exists so the v3.236.3 class of bug — announced
// success on a write that settled without throwing, but never landed — cannot
// be re-copied as a one-off. This test:
//   1. Pins the known Finalise canvases (allergy uses WriteCore; the others
//      are recorded as pending adoption with a reason).
//   2. Fails CI if a NEW file grows a user-facing Finalise control without
//      being added to the inventory (either as WriteCore-adopting or as a
//      documented pending/single-row exception).

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

function relPosix(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function listJs(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'vendor', '.git'].includes(entry.name)) continue;
      out.push(...listJs(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !/^test-/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Seed inventory — every known multi-row Finalise surface.
const INVENTORY = {
  'content-scripts/allergy-cleanup-canvas.js': {
    requireWriteCore: true,
    reason: 'canonical adopter (v3.236.3 extraction)',
  },
  'content-scripts/appointment-organise-canvas.js': {
    requireWriteCore: false,
    reason:
      'pending adoption — commit/landed-diff lives in shared/appointment-organise-core.js (W14–W16); migrate in a dedicated PR, do not invent confirm copy here',
  },
  'content-scripts/problem-nesting-canvas.js': {
    requireWriteCore: false,
    reason:
      'pending adoption — writes owned by content-scripts/problem-nesting.js (W17); canvas is view-only. Adopt WriteCore when the write bridge grows a landed-id diff',
  },
};

const FINALISE_UI_RE = />Finalise/;

const productJs = [
  ...listJs(path.join(ROOT, 'content-scripts')),
  ...listJs(path.join(ROOT, 'side-panel')),
  ...listJs(path.join(ROOT, 'shared')),
];

const found = [];
for (const abs of productJs) {
  const src = fs.readFileSync(abs, 'utf8');
  if (FINALISE_UI_RE.test(src)) found.push(relPosix(abs));
}

check(found.includes('content-scripts/allergy-cleanup-canvas.js'), 'allergy-cleanup-canvas.js still has a Finalise control');

const unexpected = found.filter((rel) => !INVENTORY[rel]);
check(
  unexpected.length === 0,
  unexpected.length === 0
    ? `every Finalise UI file is in the WriteCore inventory (${found.length})`
    : `new Finalise UI file(s) not in inventory — adopt WriteCore or add a reason: ${unexpected.join(', ')}`
);

for (const [rel, spec] of Object.entries(INVENTORY)) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `${rel} exists`);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const uses = /WriteCore/.test(src);
  if (spec.requireWriteCore) {
    check(uses, `${rel} references WriteCore (${spec.reason})`);
  } else {
    check(true, `${rel} pending — ${spec.reason}`);
    if (uses) {
      check(true, `${rel} now references WriteCore — promote requireWriteCore to true next pass`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
