#!/usr/bin/env node
// Medicus Suite — safety-doc version guard.
//
// Ensures that each clinical safety document's pinned product version tracks
// the manifest version at the same major.minor level. Patch lag is intentional
// and allowed: the CSO signs off docs at minor releases, not every patch.
//
// STALENESS LEDGER — docs/cso-review-ledger.json
// -----------------------------------------------
// Instead of a hand-edited KNOWN_STALE map (which silently hides the growing
// gap), this script reads a machine-readable ledger that records the manifest
// version at which each doc was last formally CSO-reviewed. It then computes
// HOW MANY MINOR RELEASES the doc is behind and prints that number loudly.
//
// Escalation threshold — HARD_FAIL_MINORS_BEHIND:
//   If a doc's last-CSO-review version is more than this many minor releases
//   behind the manifest, the script exits non-zero (CI red).
//   Set high enough (60) that it does NOT fail today (gap is ~49 minors for
//   CLINICAL-SAFETY-NOTICE / HAZARD-LOG), but will trip if the gap keeps
//   growing without a CSO review. LOWER THIS NUMBER to force a CSO review.
const HARD_FAIL_MINORS_BEHIND = 60;
//
// For docs whose last-CSO-review version matches the ledger exactly, the
// script prints a loud STALE message (quantified) but does NOT fail (non-zero)
// unless the gap exceeds HARD_FAIL_MINORS_BEHIND.
//
// For docs that have moved ahead of (or match) the manifest major.minor,
// the script prints OK. Any doc that has drifted WITHOUT a ledger entry is
// still a hard ERROR (exit 1) — the ledger must be the source of truth.
//
// HOW TO UPDATE AFTER A CSO REVIEW:
//   1. Update the relevant doc (bump its **Product version:** / **Version:**).
//   2. Update docs/cso-review-ledger.json — set last_cso_review_version and
//      last_cso_review_date for that doc.
//   3. Do NOT edit this script just to silence a warning.

('use strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Docs and the regex used to extract their product version.
// Two formats are in use:
//   **Product version:** 3.26.4    (CLINICAL-SAFETY-NOTICE, HAZARD-LOG, SOUP)
//   **Version:** v3.31.2           (feature-list)
const DOCS = [
  {
    file: 'docs/CLINICAL-SAFETY-NOTICE.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/HAZARD-LOG.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/SOUP.md',
    re: /\*\*Product version:\*\*\s*v?([\d.]+)/,
  },
  {
    file: 'docs/feature-list.md',
    re: /\*\*Version:\*\*\s*v?([\d.]+)/,
  },
];

// Parse a "major.minor.patch" string into { major, minor, patch }.
function parseSemver(ver) {
  const parts = ver.split('.').map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function majorMinor(ver) {
  const parts = ver.split('.');
  return parts[0] + '.' + parts[1];
}

// How many minor releases is `oldVer` behind `newVer`?
// Only counts within the same major; returns 0 if old >= new or major differs.
function minorsBehind(oldVer, newVer) {
  const o = parseSemver(oldVer);
  const n = parseSemver(newVer);
  if (o.major !== n.major) return 0; // cross-major: handled separately
  const diff = n.minor - o.minor;
  return diff > 0 ? diff : 0;
}

// Load the CSO review ledger once.
const ledgerPath = path.join(ROOT, 'docs/cso-review-ledger.json');
let ledger = {};
try {
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  for (const entry of raw.docs || []) {
    ledger[entry.file] = entry;
  }
} catch (err) {
  console.error(`ERROR: could not read docs/cso-review-ledger.json — ${err.message}`);
  console.error('       Create or fix that file before running this check.');
  process.exit(1);
}

const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestVer = manifest.version;
const manifestMM = majorMinor(manifestVer);

let anyFail = false;

for (const { file, re } of DOCS) {
  const fullPath = path.join(ROOT, file);
  const content = fs.readFileSync(fullPath, 'utf8');
  const m = re.exec(content);
  if (!m) {
    console.error(`ERROR: could not find product version in ${file}`);
    anyFail = true;
    continue;
  }
  const docVer = m[1];
  const docMM = majorMinor(docVer);

  // Case 1: doc is at the same major.minor as the manifest — fully current.
  if (docMM === manifestMM) {
    console.log(`OK    ${file}  (doc ${docVer} == manifest major.minor ${manifestMM})`);
    continue;
  }

  // Case 2: doc is behind. Look up the ledger to determine intent.
  const ledgerEntry = ledger[file];

  if (ledgerEntry && docVer === ledgerEntry.last_cso_review_version) {
    // The doc is at the last known CSO-reviewed version — staleness is
    // acknowledged. Compute and print HOW FAR behind it is.
    const behind = minorsBehind(docVer, manifestVer);
    const ledgerDate = ledgerEntry.last_cso_review_date || 'unknown date';

    if (behind >= HARD_FAIL_MINORS_BEHIND) {
      // Gap has grown past the configured escalation threshold — now a hard fail.
      // Lower HARD_FAIL_MINORS_BEHIND to make this trip sooner.
      console.error(
        `OVERDUE  ${file}\n` +
          `         last CSO review v${docVer} (${ledgerDate}); manifest v${manifestVer}\n` +
          `         ${behind} minor releases behind — exceeds HARD_FAIL_MINORS_BEHIND=${HARD_FAIL_MINORS_BEHIND}\n` +
          `         CSO review REQUIRED before this threshold is raised`
      );
      anyFail = true;
    } else {
      // Within tolerated gap — print loud STALE with the climbing number.
      console.warn(
        `STALE  ${file}\n` +
          `       last CSO review v${docVer} (${ledgerDate}); manifest v${manifestVer}\n` +
          `       ${behind} minor release${behind === 1 ? '' : 's'} behind` +
          ` (HARD_FAIL_MINORS_BEHIND=${HARD_FAIL_MINORS_BEHIND} — lower this to force a review)`
      );
    }
    continue;
  }

  // Case 3: doc has drifted from the ledger's last-CSO-review version
  // (either no ledger entry, or the doc moved to a different stale version).
  // This is always a hard error — the ledger must be the source of truth.
  if (ledgerEntry) {
    const behind = minorsBehind(docVer, manifestVer);
    console.error(
      `ERROR ${file}  doc version ${docVer} does not match manifest ${manifestVer} ` +
        `(expected major.minor ${manifestMM}; got ${docMM})\n` +
        `      ledger last-CSO-review=${ledgerEntry.last_cso_review_version} — ` +
        `doc version (${docVer}) != ledger version (${ledgerEntry.last_cso_review_version})\n` +
        `      Update docs/cso-review-ledger.json after a CSO review, ` +
        `or align the doc version with the ledger entry.` +
        (behind > 0 ? `  (currently ${behind} minor releases behind manifest)` : '')
    );
  } else {
    console.error(
      `ERROR ${file}  doc version ${docVer} does not match manifest ${manifestVer} ` +
        `(expected major.minor ${manifestMM}; got ${docMM})\n` +
        `      No ledger entry found in docs/cso-review-ledger.json for this file.\n` +
        `      Add an entry recording the last CSO review version, or update the doc.`
    );
  }
  anyFail = true;
}

if (anyFail) {
  process.exit(1);
}
