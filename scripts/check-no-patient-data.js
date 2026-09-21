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
 *      review remain the backbone. A resolved base whose diff cannot be
 *      read (oversized diff, git error) fails closed — skipping that scan
 *      would hide a real number.
 *
 * Quoted diff paths (`+++ "b/foo bar.js"`) are scanned. An unparsed `+++`
 * line is never treated as an allowlisted file.
 *
 * Run locally (diffs against origin/main): node scripts/check-no-patient-data.js
 * Override base:                            BASE_REF=origin/dev node scripts/...
 */

const { execFileSync } = require('child_process');

const FORBIDDEN_DIRS = ['uploads/', 'data/sars/', 'output/'];

// Files allowed to contain checksum-valid 10-digit numbers in ADDED lines
// (e.g. synthetic fixtures that deliberately exercise NHS-number handling).
// Keep this SHORT and justify every entry — each is a hole in the guard.
const NHS_ADD_ALLOWLIST = new Set([
  // This guard's own regression test deliberately embeds synthetic Modulus-11
  // numbers to prove detection works — they are not patient data.
  'test-no-patient-data-guard.js',
  // SNOMED descriptionId/conceptId values are 10-digit terminology
  // identifiers, and some coincidentally pass the NHS Modulus-11 check.
  // These files carry terminology IDs only — no patient identifiers.
  'rules/document-types.json',
  'rules/lab-code-info.json',
  'test-problem-description-cleanup.js',
  'test-snomed-retirement.js',
]);

// Never NHS-scan these (binaries / vendored bundles / lockfiles).
const SKIP_NHS_SCAN = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp4|wasm|map)$/i,
  /(^|\/)package-lock\.json$/,
  /(^|\/)scripts\/check-no-patient-data\.js$/, // documents the regex itself
];

const NHS_RE = /\b(\d{3})[ -]?(\d{3})[ -]?(\d{4})\b/g;

// execFileSync's default 1 MiB cap throws ENOBUFS on a large PR diff. The old
// catch treated that as an empty diff and skipped the NHS scan entirely.
const DEFAULT_DIFF_MAX_BUFFER = 64 * 1024 * 1024;

function diffMaxBuffer() {
  const raw = process.env.CHECK_NO_PATIENT_DATA_MAX_BUFFER;
  if (raw == null || raw === '') return DEFAULT_DIFF_MAX_BUFFER;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024) {
    throw new Error('CHECK_NO_PATIENT_DATA_MAX_BUFFER must be an integer >= 1024');
  }
  return n;
}

function git(args, maxBuffer) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: maxBuffer || DEFAULT_DIFF_MAX_BUFFER,
    windowsHide: true,
  });
}

// Refs are passed as a single git argument. Reject option-looking or
// shell-looking values so BASE_REF cannot smuggle extra git flags.
function isSafeRef(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9_./~^+@-]+$/.test(ref) && !ref.startsWith('-');
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

function fatalDiffReadError(err) {
  const code = err && (err.code || err.message || 'error');
  const why = String(code).split('\n')[0].slice(0, 200);
  return `NHS scan could not read the diff (${why}). Refusing to skip the scan.`;
}

// Git C-quoting (quote.c): octal bytes and a few letter escapes, ASCII source.
function unescapeGitQuoted(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\') {
      const cp = s.charCodeAt(i);
      if (cp > 0x7f) return null;
      bytes.push(cp);
      continue;
    }
    const n = s[++i];
    if (n === undefined) return null;
    if (n === '\\') bytes.push(0x5c);
    else if (n === '"') bytes.push(0x22);
    else if (n === 'n') bytes.push(0x0a);
    else if (n === 't') bytes.push(0x09);
    else if (n === 'r') bytes.push(0x0d);
    else if (n === 'a') bytes.push(0x07);
    else if (n === 'b') bytes.push(0x08);
    else if (n === 'v') bytes.push(0x0b);
    else if (n === 'f') bytes.push(0x0c);
    else if (n >= '0' && n <= '7') {
      let oct = n;
      for (let k = 0; k < 2 && i + 1 < s.length && s[i + 1] >= '0' && s[i + 1] <= '7'; k++) {
        oct += s[++i];
      }
      const val = parseInt(oct, 8);
      if (val > 255) return null;
      bytes.push(val);
    } else return null;
  }
  return Buffer.from(bytes).toString('utf8');
}

// `+++ ` header → repo path, or null when the path cannot be trusted
// (/dev/null, broken quoting). Null is NOT an allowlist hit — added lines
// under it are still scanned.
//
// Git writes `+++ b/path` for a modification and `+++ b/path\t` for a new
// file (empty timestamp field). The tab must not become part of the path,
// or NHS_ADD_ALLOWLIST never matches a newly added allowlisted file.
function parseDiffNewPath(headerLine) {
  if (!headerLine.startsWith('+++ ')) return null;
  let rest = headerLine.slice(4);
  const tab = rest.indexOf('\t');
  if (tab !== -1) rest = rest.slice(0, tab);
  if (rest === '/dev/null') return null;
  if (rest.startsWith('"')) {
    if (rest.length < 2 || !rest.endsWith('"')) return null;
    rest = unescapeGitQuoted(rest.slice(1, -1));
    if (rest == null) return null;
  }
  if (rest.startsWith('b/')) return rest.slice(2);
  return rest || null;
}

function fileExemptFromNhsScan(file) {
  if (!file) return false;
  if (NHS_ADD_ALLOWLIST.has(file)) return true;
  return SKIP_NHS_SCAN.some((re) => re.test(file));
}

function formatNhsHit(hit) {
  const where = hit.file || '<unparsed diff path>';
  return (
    `POSSIBLE NHS NUMBER: ${where}:${hit.line} adds "${hit.token}" (passes Modulus-11). ` +
    'If this is synthetic, use a checksum-invalid 10-digit number. ' +
    'Allowlist a file only when it must contain checksum-valid terminology ids (see NHS_ADD_ALLOWLIST).'
  );
}

function findNhsHitsInDiff(diff) {
  const hits = [];
  if (!diff) return hits;
  let curFile = null;
  let newLine = 0;
  for (const raw of String(diff).split('\n')) {
    // Drop a trailing CR so a CRLF diff still word-bounds the last token.
    const lineRaw = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (lineRaw.startsWith('diff --git ')) {
      curFile = null;
      newLine = 0;
      continue;
    }
    if (lineRaw.startsWith('+++ ')) {
      curFile = parseDiffNewPath(lineRaw);
      newLine = 0;
      continue;
    }
    if (lineRaw.startsWith('@@')) {
      const m = lineRaw.match(/\+(\d+)/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (lineRaw.startsWith('+') && !lineRaw.startsWith('+++')) {
      const line = lineRaw.slice(1);
      if (!fileExemptFromNhsScan(curFile)) {
        NHS_RE.lastIndex = 0;
        let m;
        while ((m = NHS_RE.exec(line)) !== null) {
          const digits = m[1] + m[2] + m[3];
          if (isValidNhsNumber(digits)) {
            hits.push({ file: curFile, line: newLine, token: m[0] });
          }
        }
      }
      newLine++;
    }
  }
  return hits;
}

// Exported for the regression test; CLI run is guarded at the bottom.
module.exports = {
  isValidNhsNumber,
  isForbiddenPath,
  FORBIDDEN_DIRS,
  parseDiffNewPath,
  findNhsHitsInDiff,
  formatNhsHit,
  fatalDiffReadError,
  isSafeRef,
  fileExemptFromNhsScan,
  DEFAULT_DIFF_MAX_BUFFER,
};

function main() {
  const errors = [];

  // --- Check 1: forbidden paths (whole tree) -----------------------------------
  const tracked = git(['ls-files'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of tracked) {
    if (isForbiddenPath(f)) {
      errors.push(`FORBIDDEN PATH: ${f} is under a patient-data directory and must never be committed.`);
    }
  }

  // --- Check 2: checksum-valid NHS numbers in ADDED lines ----------------------
  function resolveBase() {
    const base = process.env.BASE_REF || 'origin/main';
    if (!isSafeRef(base)) return { error: `Refusing base ref ${JSON.stringify(base)}.` };
    try {
      git(['rev-parse', '--verify', base]);
      return { base };
    } catch {
      // Try to fetch it (CI shallow clones often lack the base ref).
      const branch = base.replace(/^origin\//, '');
      if (!isSafeRef(branch)) return { error: `Refusing base ref ${JSON.stringify(base)}.` };
      try {
        git(['fetch', '--no-tags', '--quiet', 'origin', branch]);
        git(['rev-parse', '--verify', base]);
        return { base };
      } catch {
        return { base: null };
      }
    }
  }

  const resolved = resolveBase();
  if (resolved.error) {
    errors.push(resolved.error);
  } else if (!resolved.base) {
    console.warn(
      '⚠️  Patient-data guard: could not resolve a base ref — skipping NHS-number diff scan (path check still ran).'
    );
  } else {
    // -U0: no context lines, so we only see actually-added content.
    let diff = null;
    try {
      diff = git(['diff', '--no-color', '-U0', `${resolved.base}...HEAD`], diffMaxBuffer());
    } catch (err) {
      errors.push(fatalDiffReadError(err));
    }
    if (diff != null) {
      for (const hit of findNhsHitsInDiff(diff)) errors.push(formatNhsHit(hit));
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
