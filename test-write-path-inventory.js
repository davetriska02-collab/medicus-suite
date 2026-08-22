// Medicus Suite — write-path inventory (CSN §6.1 completeness guard)
// Run with: node test-write-path-inventory.js
//
// docs/CLINICAL-SAFETY-NOTICE.md §6.1 claims: "If a capability is not in this
// table, the software cannot do it." Every Medicus-record write POST in product
// source must therefore carry a CSN W-id, and every W1–W21 row must still be
// present in the notice. This test walks the write-capable trees, greps
// `method: 'POST'` / `method: "POST"`, and fails CI on any unmatched hit
// (named as file:line) or a missing `| Wnn |` table row.
//
// DOM macros (W7, W8) and some booking shims have no method:POST of their own
// but are still write surfaces — they are mapped and existence-checked even
// so. W3 is a consequence of W1/W2 (bookingConfirmationRecipients on the
// create-appointment payload) and has no separate POST file.
//
// Allowlisted POSTs are named here with a reason: they are not Medicus
// session write surfaces (proxy / non-clinical store) and must not silently
// grow a new clinical write without a W-id.

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

const ROOT = __dirname;
const POST_RE = /method:\s*['"]POST['"]/;
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'scripts', '_skill']);

function relPosix(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function isTestFile(name) {
  return /^test-.*\.js$/.test(name);
}

function listJsFiles(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !isTestFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── Scan trees (product write surfaces only) ─────────────────────────────────

const SCAN_FILES = [];
for (const rel of ['content-scripts', 'shared', path.join('side-panel', 'modules')]) {
  SCAN_FILES.push(...listJsFiles(path.join(ROOT, rel)));
}
for (const rel of ['engine/record-duplicate-parser.js', 'duplicate-checker.js']) {
  const abs = path.join(ROOT, ...rel.split('/'));
  if (fs.existsSync(abs)) SCAN_FILES.push(abs);
}
SCAN_FILES.sort();

// ── Allowlist: POST that is not a CSN W-row ──────────────────────────────────
// Must still be named here. A new allowlist entry is a deliberate exception,
// not a default — anything else needs a W-id.

const ALLOWLIST = {
  'shared/txn-transport.js':
    'optional Transactional API proxy POST; intended-purpose says this path is read-only for patient data (isWrite writes are refused). Not a Medicus session write surface.',
  'content-scripts/task-presence.js': 'Supabase task_presence upsert, not a Medicus clinical write.',
};

// ── Expected file → W-id map (a file may map to several W-ids) ───────────────

const FILE_TO_WIDS = {
  'side-panel/modules/slots/booking-api.js': ['W1'],
  'shared/booking-core.js': ['W1', 'W2', 'W12', 'W15'],
  'content-scripts/booking-inline.js': ['W2'],
  'shared/task-api.js': ['W4'],
  'content-scripts/task-inline.js': ['W5'],
  'content-scripts/document-file-inline.js': ['W6'],
  'content-scripts/triage-lens/lab-file-button.js': ['W7'],
  'content-scripts/triage-lens/routine-rx-button.js': ['W8'],
  'content-scripts/problem-description-cleanup.js': ['W9', 'W19'],
  'content-scripts/problem-bulk-end.js': ['W10'],
  'duplicate-checker.js': ['W11'],
  'engine/record-duplicate-parser.js': ['W11'],
  'side-panel/modules/shared/booking-panel.js': ['W12'],
  'side-panel/modules/shared/booking-panel-core.js': ['W12'],
  'content-scripts/allergy-cleanup.js': ['W13'],
  'shared/appointment-organise-core.js': ['W14', 'W15', 'W16'],
  'content-scripts/problem-nesting.js': ['W17'],
  'content-scripts/contacts-api.js': ['W18'],
  'content-scripts/document-codes-to-problems.js': ['W20'],
  'content-scripts/task-bulk-action.js': ['W21'],
  'content-scripts/privacy-officer-bulk-acknowledge.js': ['W21'],
  'content-scripts/eps-cancellation-bulk-discard.js': ['W21'],
};

// W7/W8 are DOM macros (may have no method:POST). W12 panel files and the
// W1 slots shim may only re-export booking-core. W21 companions instantiate
// the shared bulk-action engine. All must still exist on disk.
const EXISTENCE_EVEN_WITHOUT_POST = [
  'side-panel/modules/slots/booking-api.js',
  'content-scripts/triage-lens/lab-file-button.js',
  'content-scripts/triage-lens/routine-rx-button.js',
  'side-panel/modules/shared/booking-panel.js',
  'side-panel/modules/shared/booking-panel-core.js',
  'content-scripts/privacy-officer-bulk-acknowledge.js',
  'content-scripts/eps-cancellation-bulk-discard.js',
];

function findPostHits(absFile) {
  const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((text, i) => {
    if (POST_RE.test(text)) hits.push(i + 1);
  });
  return hits;
}

// ── 1. Every scanned POST is allowlisted or mapped ───────────────────────────

console.log('\n--- scanned method:POST hits ---');
const unmatched = [];
let hitCount = 0;
for (const abs of SCAN_FILES) {
  const rel = relPosix(abs);
  const hits = findPostHits(abs);
  if (!hits.length) continue;
  hitCount += hits.length;
  const allowReason = ALLOWLIST[rel];
  const wids = FILE_TO_WIDS[rel];
  for (const line of hits) {
    const loc = `${rel}:${line}`;
    if (allowReason) {
      check(true, `${loc} allowlisted — ${allowReason}`);
    } else if (wids && wids.length) {
      check(true, `${loc} → ${wids.join(', ')}`);
    } else {
      unmatched.push(loc);
      check(false, `unmapped Medicus-record write POST at ${loc} — assign a CSN W-id`);
    }
  }
}
check(hitCount > 0, `scanner found ${hitCount} method:POST hit(s) in the write-path trees`);

// ── 2. CSN §6.1 table rows W1–W21 ────────────────────────────────────────────

console.log('\n--- CSN §6.1 W-id table rows ---');
const csnPath = path.join(ROOT, 'docs', 'CLINICAL-SAFETY-NOTICE.md');
check(fs.existsSync(csnPath), 'docs/CLINICAL-SAFETY-NOTICE.md exists');
const csn = fs.existsSync(csnPath) ? fs.readFileSync(csnPath, 'utf8') : '';

function csnHasRow(id) {
  return csn.includes(`| ${id} |`);
}

for (let n = 1; n <= 16; n++) {
  const id = 'W' + n;
  check(csnHasRow(id), `CSN §6.1 has table row | ${id} |`);
}
for (let n = 17; n <= 21; n++) {
  const id = 'W' + n;
  check(csnHasRow(id), `CSN §6.1 has required table row | ${id} |`);
}

// ── 3. Every mapped product file still exists ────────────────────────────────

console.log('\n--- mapped product files exist ---');
for (const rel of Object.keys(FILE_TO_WIDS).sort()) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `${rel} exists (mapped → ${FILE_TO_WIDS[rel].join(', ')})`);
}

console.log('\n--- DOM-macro / shim files exist even without method:POST ---');
for (const rel of EXISTENCE_EVEN_WITHOUT_POST) {
  const abs = path.join(ROOT, ...rel.split('/'));
  check(fs.existsSync(abs), `${rel} exists`);
}

// Self-check: every W-id except W3 has ≥1 mapped file in this inventory.
console.log('\n--- inventory map covers W1–W21 ---');
const widsWithFiles = new Set();
for (const wids of Object.values(FILE_TO_WIDS)) {
  wids.forEach((w) => widsWithFiles.add(w));
}
check(true, 'W3 is a consequence of W1/W2 — no separate POST file required');
for (let n = 1; n <= 21; n++) {
  if (n === 3) continue;
  const id = 'W' + n;
  check(widsWithFiles.has(id), `${id} has ≥1 mapped product file in this inventory`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  if (unmatched.length) {
    console.error('\nUnmapped method:POST (file:line) — assign a CSN W-id or an allowlist reason:');
    unmatched.forEach((loc) => console.error(`  ${loc}`));
  }
  console.error(
    '\nCSN §6.1 completeness claim failed. A new Medicus-record write POST needs a W-id ' +
      'in this test AND a `| Wnn |` row in docs/CLINICAL-SAFETY-NOTICE.md; a missing row ' +
      'means the notice no longer lists every write the software can do.'
  );
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
