// Viewer Phase 1 — LTC feature unit tests (Charlson + analyte selection)
// Run with:  node test-viewer-phase1.js
// All tests must pass before shipping.
//
// visualiser-core.js runs browser globals (pdfjsLib, document, chrome) at the
// top level, so it cannot be require()'d in Node. Instead we read it as text,
// extract the pure pieces we need (CHARLSON_WEIGHTS, NEG_RE, computeCharlson),
// and evaluate them in an isolated vm sandbox.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

const SRC = fs.readFileSync(path.join(__dirname, 'visualiser-core.js'), 'utf8');

// ── extract source slices ──────────────────────────────────────────────────

// Grab from `const NAME = [` / `function NAME(` up to a sentinel that marks the
// end of the declaration in the source. We slice between known anchors.
function slice(startRe, endNeedle) {
  const m = SRC.match(startRe);
  if (!m) throw new Error('start anchor not found: ' + startRe);
  const start = m.index;
  const end = SRC.indexOf(endNeedle, start);
  if (end < 0) throw new Error('end needle not found: ' + endNeedle);
  return SRC.slice(start, end);
}

// CHARLSON_WEIGHTS: from its declaration to the closing `];` that precedes the
// HIGH_RISK_DRUGS comment.
const charlsonWeightsSrc = slice(/const CHARLSON_WEIGHTS = \[/, '\n// High-risk drugs');

// NEG_RE: single line.
const negReSrc = (SRC.match(/const NEG_RE = .*;/) || [])[0];
if (!negReSrc) throw new Error('NEG_RE not found');

// computeCharlson: from its declaration to the comment that follows it.
const computeCharlsonSrc = slice(/function computeCharlson\(/, '\n// Per-condition tracked analyte');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(charlsonWeightsSrc + '\n' + negReSrc + '\n' + computeCharlsonSrc, sandbox);
// Expose for the test harness.
vm.runInContext('this.CHARLSON_WEIGHTS = CHARLSON_WEIGHTS; this.computeCharlson = computeCharlson; this.NEG_RE = NEG_RE;', sandbox);

const computeCharlson = sandbox.computeCharlson;
const NEG_RE = sandbox.NEG_RE;

// ── Charlson tests ──────────────────────────────────────────────────────────

console.log('computeCharlson:');

let r;

r = computeCharlson([{ name: 'Type 2 diabetes mellitus' }], [], '60');
assert(r.comorbidityScore === 1, 'diabetes alone → comorbidityScore 1');
assert(r.ageScore === 2, 'age 60 → ageScore 2');
assert(r.total === 3, 'diabetes + age 60 → total 3');

r = computeCharlson([{ name: 'Type 2 diabetes mellitus' }, { name: 'Old stroke' }], [], '60');
assert(r.comorbidityScore === 2, 'diabetes + stroke → comorbidityScore 2');

// Real-world single-problem metastatic cancer must be caught, and the lower
// malignancy(2) tier suppressed so the score is 6, not 8.
r = computeCharlson([{ name: 'Metastatic breast carcinoma' }], [], '');
assert(r.comorbidityScore === 6, 'metastatic breast carcinoma → 6 (malignancy suppressed)');

// ...but the benign non-cancer 'metastatic calcification' must NOT score.
r = computeCharlson([{ name: 'Metastatic calcification' }], [], '');
assert(r.items.every(it => it.label !== 'Metastatic solid tumour'), "'metastatic calcification' → no metastatic item");

// Tightened HIV terms must NOT fire on 'HIV test requested' / 'HIV negative'.
r = computeCharlson([{ name: 'HIV test requested' }], [], '');
assert(r.items.every(it => it.label !== 'AIDS / HIV'), "'HIV test requested' → no AIDS/HIV item");

r = computeCharlson([{ name: 'Family history of bowel cancer' }], [], '70');
assert(r.comorbidityScore === 0, 'family history of cancer → comorbidityScore 0 (negation guard)');
assert(r.items.length === 0, 'family history of cancer → no items');

r = computeCharlson([{ name: 'COPD' }], [], '');
assert(r.ageScore === 0 && r.ageKnown === false, "age '' → ageScore 0, ageKnown false");

r = computeCharlson([], [], '49');
assert(r.ageScore === 0, "age '49' → ageScore 0");

r = computeCharlson([], [], '50');
assert(r.ageScore === 1 && r.total === 1, "age '50' → ageScore 1, total 1");

r = computeCharlson([], [], '80');
assert(r.ageScore === 4, "age '80' → ageScore 4");

r = computeCharlson([], [], '');
assert(r.total === 0 && Array.isArray(r.items) && r.items.length === 0, 'empty input → total 0, items []');

// ── analyte longest-match selection ─────────────────────────────────────────
// Replicate the exact selection expression used in computeConditionSummaries.

console.log('analyte longest-match selection:');

function pickAnalyteKey(analytes, analyteTerms) {
  const keys = Object.keys(analytes || {});
  const matches = keys.filter(k => analyteTerms.some(t => k.toLowerCase().includes(t)));
  return matches.sort((a, b) => b.length - a.length)[0];
}

const analytes = {
  'Systolic blood pressure': [],
  'Diastolic blood pressure': [],
};
const picked = pickAnalyteKey(analytes, ['systolic blood pressure']);
assert(picked === 'Systolic blood pressure', "'systolic blood pressure' term → picks 'Systolic blood pressure'");

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
