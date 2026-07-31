// Medicus Suite — H-049 WORDING-CONTROL source test for the GP → reception
// quick-actions composer widget.
// Run with: node test-reception-quick-actions-ui.js
//
// content-scripts/reception-quick-actions.js is a browser IIFE (not requireable),
// and until v3.204.0 nothing in CI loaded it at all — which meant every WORDING
// control in hazard H-049(e) (docs/HAZARD-LOG.md) lived in an uncovered file.
// This test source-greps the widget (the test-chip-contract.js style of guard)
// and pins:
//   1. the safety strings H-049(e) quotes verbatim are present and contiguous;
//   2. no UI string literal claims completion ("Done", "Sent", "Booked" — the
//      words H-049 deliberately never uses; a click on Submit is not a
//      successful submit, so the widget must never assert one);
//   3. the mechanical safety invariants that are grep-visible: Submit is
//      highlighted never clicked, the insert is append-only, and focus() never
//      scroll-jacks the page after an insert.

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
    process.exitCode = 1;
  }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'reception-quick-actions.js'), 'utf8');

// ============================================================
// 1. H-049(e) safety strings — present, contiguous, verbatim
// ============================================================
console.log('1. H-049(e) safety wording present and contiguous');

check(src.includes('Insert into comment'), 'button substring "Insert into comment" is exact and contiguous');
check(src.includes('writes text only — books nothing'), 'header states "writes text only — books nothing"');
check(/not yet submitted/i.test(src), 'the un-submitted state is named ("not yet submitted")');
check(src.includes('reception sees nothing'), 'pending reminder states the consequence ("reception sees nothing")');
check(src.includes('Pick an action first'), 'disabled Insert explains itself ("Pick an action first")');

// ============================================================
// 2. No completion claim in any UI string literal
// ============================================================
// Extract single-quoted string literals from the source (the file is
// single-quote-only, enforced by Prettier) and assert none claims completion.
// Scoped to literals so the comment block's prose can discuss the rule freely.
console.log('\n2. no UI string claims completion');

const literals = src.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
check(literals.length > 50, `extracted a plausible number of string literals (got ${literals.length})`);
const BANNED = /\b(Done|Sent|Booked|Submitted)\b/; // capitalised claim-words; "not yet submitted" stays legal
const offenders = literals.filter((l) => BANNED.test(l));
check(
  offenders.length === 0,
  `no string literal claims completion (Done/Sent/Booked/Submitted)${offenders.length ? ': ' + offenders.join(', ') : ''}`
);

// ============================================================
// 3. Grep-visible mechanical invariants
// ============================================================
console.log('\n3. mechanical safety invariants');

// Submit is highlighted, never clicked: the only .click() in the file is the
// keyboard-activation forward on the widget's own header toggle.
const clickCalls = src.match(/\.click\(\)/g) || [];
check(clickCalls.length <= 1, `at most one .click() call in the file (got ${clickCalls.length})`);
check(!/submit[^\n]*\.click\(\)/i.test(src), 'no .click() is ever applied to a submit control');
check(/highlight\(submit\)/.test(src), "the card's Submit control is highlighted after an insert");

// Append-only write: the textarea is only ever assigned through appendToComment.
check(/QA\.appendToComment\(ta\.value,/.test(src), 'the comment write goes through QA.appendToComment(ta.value, …)');

// The insert must not scroll-jack: focus() after an insert uses preventScroll.
check(/ta\.focus\(\{ preventScroll: true \}\)/.test(src), 'post-insert focus() uses { preventScroll: true }');

// The pending reminder is stateful, not timed: no setTimeout may clear s.pending.
check(!/setTimeout[\s\S]{0,200}?s\.pending\s*=\s*false/.test(src), 'no timer ever clears the pending reminder');

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
