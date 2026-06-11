#!/usr/bin/env node
// Medicus Suite — verify vendored library integrity.
//
// Reads vendor-versions.json and checks each library's sha256 against the
// file on disk. Also ensures no uncatalogued files exist in vendor/.
//
// Usage:
//   node scripts/verify-vendor.js          # check mode (used by CI)
//   node scripts/verify-vendor.js --write  # recompute and update sha256 fields
//
// On failure, exits 1 with a clear listing of all problems.
// On success, exits 0 with a one-line summary.
//
// Run after a deliberate vendor upgrade:
//   node scripts/verify-vendor.js --write
//   (then update version/upstream_url/library fields by hand in vendor-versions.json)

'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const MANIFEST    = path.join(ROOT, 'vendor-versions.json');
const VENDOR_DIR  = path.join(ROOT, 'vendor');
const WRITE_MODE  = process.argv.includes('--write');

// ─── Schema enforcement ───────────────────────────────────────────────────────
const REQUIRED_FIELDS = ['filename', 'library', 'version', 'upstream_url', 'license', 'sha256'];

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─── Load manifest ────────────────────────────────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  console.error('ERROR: Cannot read vendor-versions.json:', e.message);
  process.exit(1);
}

const { libraries } = manifest;
if (!Array.isArray(libraries) || libraries.length === 0) {
  console.error('ERROR: vendor-versions.json has no libraries[] array.');
  process.exit(1);
}

const problems = [];

// ─── 1. Schema check + checksum verification ─────────────────────────────────
for (const entry of libraries) {
  // Schema enforcement
  for (const field of REQUIRED_FIELDS) {
    if (!entry[field]) {
      problems.push(`Schema: entry for "${entry.filename || '(unnamed)'}" is missing required field "${field}"`);
    }
  }
  if (problems.length) continue; // skip further checks for malformed entries

  const absPath = path.join(ROOT, entry.filename);
  if (!fs.existsSync(absPath)) {
    problems.push(`Missing file: ${entry.filename} (listed in vendor-versions.json but not on disk)`);
    continue;
  }

  const actual = sha256File(absPath);
  if (actual !== entry.sha256) {
    problems.push(
      `Checksum mismatch: ${entry.filename}\n` +
      `  recorded: ${entry.sha256}\n` +
      `  actual:   ${actual}\n` +
      `  Run: node scripts/verify-vendor.js --write after a deliberate upgrade, and update version/upstream_url by hand.`
    );
  }
}

// ─── 2. Reverse check: no uncatalogued files in vendor/ ─────────────────────
const catalogued = new Set(libraries.map(e => path.resolve(ROOT, e.filename)));
let vendorFiles;
try {
  vendorFiles = fs.readdirSync(VENDOR_DIR)
    .filter(f => !f.startsWith('.'))
    .map(f => path.resolve(VENDOR_DIR, f));
} catch (e) {
  problems.push(`Cannot read vendor/ directory: ${e.message}`);
  vendorFiles = [];
}

for (const f of vendorFiles) {
  if (!catalogued.has(f)) {
    problems.push(`Uncatalogued vendor file: ${path.relative(ROOT, f)} (not recorded in vendor-versions.json)`);
  }
}

// ─── 3. Pairing check: pdf.min.js and pdf.worker.min.js must match version ──
const pdfMain   = libraries.find(e => e.filename === 'vendor/pdf.min.js');
const pdfWorker = libraries.find(e => e.filename === 'vendor/pdf.worker.min.js');
if (pdfMain && pdfWorker && pdfMain.version !== pdfWorker.version) {
  problems.push(
    `PDF.js version mismatch: pdf.min.js=${pdfMain.version} vs pdf.worker.min.js=${pdfWorker.version} — they must be identical.`
  );
}

// ─── Write mode: recompute sha256 fields ────────────────────────────────────
if (WRITE_MODE) {
  let updated = 0;
  for (const entry of libraries) {
    const absPath = path.join(ROOT, entry.filename);
    if (!fs.existsSync(absPath)) continue;
    const newHash = sha256File(absPath);
    if (newHash !== entry.sha256) {
      entry.sha256 = newHash;
      updated++;
    }
  }
  manifest.generated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`vendor-versions.json updated (${updated} hash(es) changed). Update version/upstream_url by hand.`);
  process.exit(0);
}

// ─── Report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(
    `Vendor integrity check FAILED (${problems.length} problem(s)):\n\n` +
    problems.map((p, i) => `  [${i + 1}] ${p}`).join('\n\n') +
    '\n'
  );
  process.exit(1);
}

const count = libraries.length;
console.log(`Vendor integrity OK — ${count} file(s) verified (sha256 matches, no uncatalogued files, PDF.js versions paired).`);
process.exit(0);
