// Medicus Suite — Backup key-coverage regression test
// Run with: node test-backup-coverage.js
//
// Purpose: every chrome.storage.local key used by app code must be captured
// by a shared/io/*-io.js file or be on an explicit allowlist.
//
// USED keys: scanned from app source (side-panel/, pop-out/, shared/, options/,
//   engine/, content-scripts/, sentinel-options/, service-worker.js).
//   Extraction: string literals matching /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/
//   present in files that reference chrome.storage.local.
//
// COVERED keys: same literal extraction from shared/io/*.js.
//
// ALLOWLIST: transient or admin-managed keys not appropriate for user backup.

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

// ── File collectors ──────────────────────────────────────────────────────────

function listFilesRecursive(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip vendor/ subtrees and docs/
      if (['vendor', 'docs', 'icons'].includes(entry.name)) continue;
      out.push(...listFilesRecursive(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// App source directories (per the task spec).
const APP_DIRS = ['side-panel', 'pop-out', 'shared', 'options', 'engine', 'content-scripts', 'sentinel-options'];
const APP_FILES = [
  // Top-level JS
  path.join(ROOT, 'service-worker.js'),
];
for (const d of APP_DIRS) {
  APP_FILES.push(...listFilesRecursive(path.join(ROOT, d), ['.js']));
}

// IO files (shared/io/*.js) — source of truth for COVERED keys.
const IO_DIR = path.join(ROOT, 'shared', 'io');
const IO_FILES = listFilesRecursive(IO_DIR, ['.js']);

// ── Key-string extraction ────────────────────────────────────────────────────
// A storage key looks like "suite.display" or "capacity.presets" — one or more
// dot-separated segments starting with a lowercase letter.  We match literals
// inside single or double quotes in JS source.
//
// We scan whole files that reference chrome.storage.local; the KEY_PREFIXES
// filter below is what keeps out unrelated dot-path literals in those files
// (e.g. chip IDs in triage-lens/content.js like 'record.age', 'queue.child').
// A new storage key under a NEW top-level prefix therefore requires adding the
// prefix here — the USED-size sanity check at the bottom guards against the
// scan going silently empty, not against a missing prefix.
//
// Non-key filters (strings that shape-match but are not storage keys):
const NON_KEY_SUFFIXES = ['.js', '.json', '.css', '.html', '.png', '.svg'];
const NON_KEY_SUBSTRINGS = ['/'];
// Known top-level storage key prefixes — only strings whose first segment
// matches one of these are candidates.
const KEY_PREFIXES = [
  'sentinel',
  'capacity',
  'triage',
  'triagelens',
  'slots',
  'submissions',
  'popout',
  'referrals',
  'suite',
  'condor',
  'config',
  'day',
  'knowledge',
  'sweep',
];

function hasKeyPrefix(k) {
  const first = k.split('.')[0];
  return KEY_PREFIXES.includes(first);
}

function extractKeyLiterals(src) {
  const keys = new Set();
  const rx = /['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"]/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    const k = m[1];
    if (NON_KEY_SUFFIXES.some((s) => k.endsWith(s))) continue;
    if (NON_KEY_SUBSTRINGS.some((s) => k.includes(s))) continue;
    if (!hasKeyPrefix(k)) continue;
    keys.add(k);
  }
  return keys;
}

// ── Collect USED keys (files that reference chrome.storage.local) ────────────
// Skip io files and test files to avoid polluting the used set with coverage
// keys (io files define what IS covered, so listing them as "used" is circular).

const USED = new Set();
const usedSourceFiles = [];

for (const f of APP_FILES) {
  if (path.basename(f).startsWith('test-')) continue; // test scripts
  if (f.startsWith(IO_DIR)) continue; // io files
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes('chrome.storage.local')) continue; // no storage access
  const keys = extractKeyLiterals(src);
  if (keys.size) {
    usedSourceFiles.push(path.relative(ROOT, f));
    keys.forEach((k) => USED.add(k));
  }
}

// ── Collect COVERED keys (from io files) ─────────────────────────────────────

const COVERED = new Set();
for (const f of IO_FILES) {
  const src = fs.readFileSync(f, 'utf8');
  extractKeyLiterals(src).forEach((k) => COVERED.add(k));
}

// ── Allowlist — transient / admin-managed keys not appropriate for user backup ─
// Each entry must have a comment stating why it is excluded from backup.

const ALLOWLIST = new Set([
  // Transient runtime state (documented in shared/io/request-monitor-io.js):
  'suite.requestMonitor.state', // live poll state object — not user config
  'suite.requestMonitor.notifMap', // service-worker notification tracking map — transient
  'suite.requestMonitor.authError', // transient auth error flag — not user config

  // OS window handle — session-transient (documented in shared/io/popout-io.js):
  'popout.windowId',

  // Transient print payload — written on "Print reception handout", read by
  // handout.html, overwritten on every print. Not user config (documented in
  // side-panel/modules/sweep/sweep.js):
  'sweep.handout',

  // Transient batch-output payload — written on "Generate batch", read once by
  // batch-handout.html, overwritten on every generate. Not user config (mirrors
  // sweep.handout; see side-panel/modules/sweep/sweep.js):
  'sweep.batchPack',

  // Transient print payload — written on "Print patient summary", read by
  // passport.html, overwritten on every print. Not user config (mirrors the
  // sweep.handout convention — see side-panel/modules/sentinel/sentinel.js):
  'sentinel.passport',

  // Admin-managed via practice-profile.json, not user-writable backup:
  'suite.practiceProfile', // applied-profile metadata (version etc.)
  'suite.practiceProfile.notifiedVersions', // which profile versions have been notified
  'suite.practiceProfile.publisher', // Publisher-PC UI state for the practice-profile publish flow — not user config

  // Transient release metadata (update-checker — expires after 24h, not user config):
  'suite.update.latestVersion',
  'suite.update.releaseUrl',
  'suite.update.releaseNotes',
  'suite.update.downloadUrl',
  'suite.update.checkedAt',
  'suite.update.error',
  'suite.update.etag',

  // Diagnostic update-check outcome written by service-worker.js — timestamps and
  // error strings only, no patient data. Transient; not user config:
  'suite.updateCheck.status',

  // Legacy migration key — the bare 'config' key was the old triagelens.config
  // location. The triage IO migrates it on import; only read during migration.
  'config',

  // Ephemeral extraction-health telemetry — rolling per-view extraction counts
  // used for live drift detection. Machine/session-local by design; restoring it
  // would import a stale baseline and mask real drift (documented in
  // shared/extraction-health.js and shared/io/sentinel-io.js):
  'sentinel.extractionBaseline',

  // Locally-discovered referral endpoint URL only (no PHI after audit M1).
  // Rediscovered on visiting the referrals page; never exported to backup.
  // referrals.config IS covered via referrals-io.
  'referrals.discovery',
]);

// ── Audit ─────────────────────────────────────────────────────────────────────

console.log('\n--- Backup key-coverage audit ---');
console.log(`  App source files with chrome.storage.local: ${usedSourceFiles.length}`);
console.log(`  USED keys found: ${USED.size}`);
console.log(`  COVERED keys in io files: ${COVERED.size}`);
console.log(`  Allowlist size: ${ALLOWLIST.size}`);

const UNCOVERED_REAL = [];
for (const k of USED) {
  if (!COVERED.has(k) && !ALLOWLIST.has(k)) {
    UNCOVERED_REAL.push(k);
  }
}

if (UNCOVERED_REAL.length > 0) {
  console.error('\n  UNCOVERED storage keys (data-loss risk — add to io file or allowlist):');
  UNCOVERED_REAL.forEach((k) => console.error(`    ${k}`));
}

check(
  UNCOVERED_REAL.length === 0,
  `all used storage keys are covered by an io file or the allowlist (${USED.size} used, ${COVERED.size} covered, ${ALLOWLIST.size} allowlisted)`
);

// Sanity: USED and COVERED sets must be non-empty (guards against scan silently failing).
check(USED.size >= 10, `USED set is non-trivially large (got ${USED.size})`);
check(COVERED.size >= 10, `COVERED set is non-trivially large (got ${COVERED.size})`);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
