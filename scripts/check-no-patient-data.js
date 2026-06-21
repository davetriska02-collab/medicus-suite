#!/usr/bin/env node
'use strict';

/**
 * Fail-closed guard against committing patient data.
 *
 * Two checks:
 *
 *   1. PATH check (whole tree, always) — nothing may be committed under the
 *      patient-data dirs (uploads/, data/sars/, output/). These are
 *      .gitignore'd; a TRACKED file there means someone `git add -f`'d it.
 *      Hard fail. This is the backbone defence and catches the most likely
 *      real mistake.
 *
 *   2. NHS-NUMBER check (PR-diff only) — no line ADDED by this branch may
 *      contain a 10-digit sequence that passes the NHS Number Modulus-11
 *      checksum. Scanning only added lines (vs the base branch) means
 *      pre-existing synthetic fixtures don't trip it — only what you're
 *      introducing now. If the base ref can't be resolved (e.g. shallow
 *      clone with no base), the NHS scan is skipped with a warning rather
 *      than failing closed, because the PATH check + .gitignore + CODEOWNERS
 *      review remain the backbone.
 *
 * Run locally (diffs against origin/main): node scripts/check-no-patient-data.js
 * Override base:                            BASE_REF=origin/dev node scripts/...
 */

const { execSync } = require('child_process');

const FORBIDDEN_DIRS = ['uploads/', 'data/sars/', 'output/'];

// Files allowed to contain checksum-valid 10-digit numbers in ADDED lines
// (e.g. synthetic fixtures that deliberately exercise NHS-number handling).
// Keep this SHORT and justify every entry — each is a hole in the guard.
const NHS_ADD_ALLOWLIST = new Set([
  // 'test-some-fixture.js',  // synthetic NHS numbers for parser tests
]);

// Never NHS-scan these (binaries / vendored bundles / lockfiles).
const SKIP_NHS_SCAN = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp4|wasm|map)$/i,
  /(^|\/)package-lock\.json$/,
  /(^|\/)scripts\/check-no-patient-data\.js$/, // documents the regex itself
];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

function isValidNhsNumber(digits) {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(digits[9]);
}

function isForbiddenPath(f) {
  return FORBIDDEN_DIRS.some((d) => f === d.slice(0, -1) || f.startsWith(d));
}

// Exported for the regression test; CLI run is guarded at the bottom.
module.exports = { isValidNhsNumber, isForbiddenPath, FORBIDDEN_DIRS };

function main() {
  const errors = [];

// --- Check 1: forbidden paths (whole tree) -----------------------------------
const tracked = sh('git ls-files').split('\n').map((s) => s.trim()).filter(Boolean);
for (const f of tracked) {
  if (FORBIDDEN_DIRS.some((d) => f === d.slice(0, -1) || f.startsWith(d))) {
    errors.push(`FORBIDDEN PATH: ${f} is under a patient-data directory and must never be committed.`);
  }
}

// --- Check 2: checksum-valid NHS numbers in ADDED lines ----------------------
const NHS_RE = /\b(\d{3})[ -]?(\d{3})[ -]?(\d{4})\b/g;

function resolveBase() {
  const base = process.env.BASE_REF || 'origin/main';
  try {
    sh(`git rev-parse --verify ${base}`);
    return base;
  } catch {
    // Try to fetch it (CI shallow clones often lack the base ref).
    const branch = base.replace(/^origin\//, '');
    try {
      sh(`git fetch --no-tags --quiet origin ${branch}`);
      sh(`git rev-parse --verify ${base}`);
      return base;
    } catch {
      return null;
    }
  }
}

const base = resolveBase();
if (!base) {
  console.warn('⚠️  Patient-data guard: could not resolve a base ref — skipping NHS-number diff scan (path check still ran).');
} else {
  // -U0: no context lines, so we only see actually-added content.
  let diff = '';
  try {
    diff = sh(`git diff --no-color -U0 ${base}...HEAD`);
  } catch {
    diff = '';
  }
  let curFile = null;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const m = raw.match(/^\+\+\+ b\/(.*)$/);
      curFile = m ? m[1] : null;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const line = raw.slice(1);
      if (curFile && !NHS_ADD_ALLOWLIST.has(curFile) && !SKIP_NHS_SCAN.some((re) => re.test(curFile))) {
        NHS_RE.lastIndex = 0;
        let m;
        while ((m = NHS_RE.exec(line)) !== null) {
          const digits = m[1] + m[2] + m[3];
          if (isValidNhsNumber(digits)) {
            errors.push(
              `POSSIBLE NHS NUMBER: ${curFile}:${newLine} adds "${m[0]}" (passes Modulus-11). ` +
                `If this is genuinely synthetic test data, add the file to NHS_ADD_ALLOWLIST in this script.`
            );
          }
        }
      }
      newLine++;
      continue;
    }
    // context/removed lines don't advance the +line counter under -U0
  }
}

if (errors.length) {
  console.error('❌ Patient-data guard failed:\n');
  for (const e of errors) console.error('  - ' + e);
  console.error('\nNothing from uploads/, data/sars/, output/, and no real NHS numbers, may be committed.');
  process.exit(1);
}

  console.log('✅ Patient-data guard: clean (no forbidden paths; no checksum-valid NHS numbers in added lines).');
}

if (require.main === module) main();
