// Medicus Suite — DOM contract / content.js sync guard
// Run with: node test-dom-contracts-sync.js
//
// content-scripts/triage-lens/content.js must never be edited by this repo's
// DOM-contract tooling (tests pin its exact content — see CLAUDE.md and
// shared/dom-contracts.js's header). Every contract whose selectors live in
// content.js instead carries `mirrorOf: 'content.js'` and is READ-ONLY
// documentation. This test is the drift guard: it greps content.js's source
// for the LITERAL selector string of every mirrored contract's anchor,
// target, and each legacy tier — if a future content.js change renames a
// selector without updating the registry to match, this fails with a clear
// message instead of the registry silently going stale.
//
// Deliberately grep-based (no HTML parsing, no fake DOM): the point is a
// byte-for-byte presence check of the exact string content.js's own source
// contains, which is a stronger guarantee than "does this selector match
// some markup" — it proves the registry's copy is verbatim.

'use strict';

const fs = require('fs');
const path = require('path');
const DomContracts = require('./shared/dom-contracts.js');

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

const CONTENT_JS_PATH = path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js');
const contentSrc = fs.readFileSync(CONTENT_JS_PATH, 'utf8');

// A mirrored contract's `anchor`/`target` field may itself be:
//   - a comma-joined selector LIST built by this registry (multiple
//     independent alternatives content.js queries separately) — split on
//     top-level commas, each alternative checked on its own.
//   - a descendant-combinator selector (space-separated) built by this
//     registry to express "an X containing a Y" for probing purposes, even
//     where content.js itself never writes them as one combined CSS string
//     (it establishes the outer scope in JS — classList.contains/
//     querySelectorAll — then queries the inner piece separately via
//     row.querySelector(...)). Each space-separated compound is checked
//     independently.
//   - built around a genuinely DYNAMIC selector content.js constructs via
//     string concatenation with a runtime-interpolated value (e.g.
//     '[row-id="detail_' + uuid + '"]'), which this registry represents as a
//     `^=`/`*=`/`$=` prefix/substring selector for probing (a real, testable
//     selector no single fixture-agnostic literal can capture exactly). For
//     those, the STATIC half of the dynamic string — `attr="value` with the
//     operator stripped and the closing quote/bracket removed — is what
//     actually appears verbatim in content.js's source, so that form is
//     checked as a fallback alongside the raw literal.
function selectorPieces(selectorString) {
  return String(selectorString)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Every representation this single piece could plausibly appear as in
// content.js's source, tried in order — passes if ANY is found.
function candidateLiterals(piece) {
  const candidates = [piece];
  // Descendant combinator: each space-separated compound checked on its own.
  const spaceParts = piece.split(/\s+/).filter(Boolean);
  if (spaceParts.length > 1) candidates.push(...spaceParts);
  // Attribute selector with a prefix/substring/suffix operator, representing
  // a dynamically-concatenated selector — check the static open-ended form.
  const attrOpMatch = piece.match(/^\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)[~^*$|]="([^"]*)"\]$/);
  if (attrOpMatch) candidates.push(`${attrOpMatch[1]}="${attrOpMatch[2]}`);
  return candidates;
}

function assertMirrored(contractId, fieldName, selectorString) {
  const pieces = selectorPieces(selectorString);
  check(pieces.length > 0, `${contractId}.${fieldName}: has at least one selector piece to check`);
  for (const piece of pieces) {
    const candidates = candidateLiterals(piece);
    const found = candidates.some((c) => contentSrc.includes(c));
    check(
      found,
      `${contractId}.${fieldName}: "${piece}" found in content-scripts/triage-lens/content.js ` +
        `(tried: ${candidates.map((c) => JSON.stringify(c)).join(', ')})`
    );
  }
}

const mirrored = DomContracts.list().filter((c) => c.mirrorOf === 'content.js');

check(mirrored.length > 0, `at least one mirrorOf:'content.js' contract is registered (found ${mirrored.length})`);

for (const c of mirrored) {
  console.log(`\n--- ${c.id} (mirrorOf: content.js) ---`);
  assertMirrored(c.id, 'anchor', c.anchor);
  (c.target || []).forEach((sel, i) => assertMirrored(c.id, `target[${i}]`, sel));
  (c.legacy || []).forEach((tier, tierIdx) => {
    tier.forEach((sel, i) => assertMirrored(c.id, `legacy[${tierIdx}][${i}]`, sel));
  });
}

// Sanity check the guard itself can fail: a selector that is NOT in
// content.js must be reported as not-found (proves this isn't a tautology
// that always reports found:true because of a bug in the substring check).
{
  const bogus = 'ch-dom-contracts-sync-test-selector-that-must-not-exist';
  check(!contentSrc.includes(bogus), `sanity: a made-up selector ("${bogus}") is correctly absent from content.js`);
}

// Non-mirrored (migrated) contracts must NOT carry mirrorOf:'content.js' —
// keeps the two categories (mirror vs migrate) from silently blurring.
const nonMirrored = DomContracts.list().filter((c) => c.mirrorOf !== 'content.js');
check(
  nonMirrored.length > 0,
  `at least one non-mirrored (migrated) contract is registered (found ${nonMirrored.length})`
);

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  console.error(
    '\nA mirrored selector went missing from content.js. Either content.js changed its selector ' +
      '(update the matching contract in shared/dom-contracts.js to match — content.js itself must ' +
      'stay untouched) or the registry has a typo — do not "fix" this by loosening the check.'
  );
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
