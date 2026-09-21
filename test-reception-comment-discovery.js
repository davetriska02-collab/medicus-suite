// Medicus Suite — behavioural test for the quick-actions composer's
// Internal-comment textarea discovery (findCommentBox).
// Run with: node test-reception-comment-discovery.js
//
// content-scripts/reception-quick-actions.js is a browser IIFE (not
// requireable), so this file vm-extracts the real discovery functions verbatim
// (same pattern as test-queue-injection-smoke.js extracting from content.js)
// and drives them against small purpose-built fake textareas — no jsdom, per
// this repo's convention (the only runtime devDeps are eslint/prettier).
//
// WHY: until v3.264.19 findCommentBox returned the FIRST visible textarea
// whose aria-label/placeholder contained /comment/i — with two plausible
// comment boxes on screen it silently guessed, and this widget writes clinical
// free text (H-049: a wrong-field write is worse than no write). Discovery now
// runs three tiers (internal-comment hint → nearby "Internal comment" label →
// generic /comment/i hint), each of which only wins with exactly ONE match;
// 2+ matches in the winning tier is ambiguous and FAILS CLOSED (null, with
// _findAmbiguous raised so the insert path can show a visible error). This
// file pins that behaviour.
//
// EXTRACTED VERBATIM: getTaskInfo, visible, COMMENT_HINT_RE,
// INTERNAL_COMMENT_RE, EXCLUDE_SEL, hintOf, labelledInternalComment,
// _findAmbiguous, ambiguousFind, findCommentBox.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// ============================================================
// vm-extract the discovery functions from reception-quick-actions.js
// ============================================================
const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'reception-quick-actions.js'), 'utf8');

function extract(re, label) {
  const m = src.match(re);
  check(!!m, `${label} extracted from reception-quick-actions.js`);
  return m ? m[0] : '';
}

console.log('Extraction: pulling findCommentBox + its deps out of reception-quick-actions.js');
const parts = [
  extract(/function getTaskInfo\(\) \{[\s\S]*?\n {2}\}/, 'getTaskInfo'),
  extract(/function visible\(el\) \{[\s\S]*?\n {2}\}/, 'visible'),
  extract(/var COMMENT_HINT_RE = .*;/, 'COMMENT_HINT_RE'),
  extract(/var INTERNAL_COMMENT_RE = .*;/, 'INTERNAL_COMMENT_RE'),
  extract(/var EXCLUDE_SEL = .*;/, 'EXCLUDE_SEL'),
  extract(/function hintOf\(el\) \{[\s\S]*?\n {2}\}/, 'hintOf'),
  extract(/function labelledInternalComment\(ta\) \{[\s\S]*?\n {2}\}/, 'labelledInternalComment'),
  extract(/var _findAmbiguous = false;/, '_findAmbiguous'),
  extract(/function ambiguousFind\(tier, matches\) \{[\s\S]*?\n {2}\}/, 'ambiguousFind'),
  extract(/function findCommentBox\(\) \{[\s\S]*?\n {2}\}/, 'findCommentBox'),
];

// ============================================================
// Fake DOM — only what the extracted functions actually touch
// ============================================================
// visible(): offsetParent / getClientRects; hintOf(): getAttribute; exclusion:
// closest(EXCLUDE_SEL); labelledInternalComment(): previousElementSibling
// chains (textContent) on the textarea and its parentElement.

function fakeTextarea(opts) {
  opts = opts || {};
  return {
    tagName: 'TEXTAREA',
    closest() {
      return opts.excluded ? {} : null;
    },
    offsetParent: opts.hidden ? null : {},
    getClientRects() {
      return opts.hidden ? [] : [{ width: 300 }];
    },
    getAttribute(name) {
      if (name === 'aria-label') return opts.aria || null;
      if (name === 'placeholder') return opts.placeholder || null;
      return null;
    },
    parentElement: opts.parentElement || null,
    previousElementSibling: opts.prevSib || null,
  };
}

function labelSib(text) {
  return { textContent: text, previousElementSibling: null };
}

let textareas = [];
const sandbox = {
  console,
  location: { pathname: '/ab12/tasks/data/medical-request/overview/12345678-1234-1234-1234-123456789abc' },
  localStorage: { getItem: () => null },
  document: {
    querySelectorAll() {
      return textareas;
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(parts.join('\n\n'), sandbox, { filename: 'reception-quick-actions-extract.js' });
check(typeof sandbox.findCommentBox === 'function', 'findCommentBox compiled and callable');

function find(list) {
  textareas = list;
  return sandbox.findCommentBox();
}

// ============================================================
// 1. Unique matches are still found (no regression in the happy paths)
// ============================================================
console.log('\n1. unique matches are found');

const fixtureShape = fakeTextarea({ aria: 'Internal comment', placeholder: 'Add an internal comment' });
check(find([fixtureShape]) === fixtureShape, 'single "Internal comment"-hinted textarea is found (fixture shape)');
check(sandbox._findAmbiguous === false, 'no ambiguity flagged on a unique strong match');

const weakOnly = fakeTextarea({ placeholder: 'Add a comment' });
check(find([weakOnly, fakeTextarea({ placeholder: 'Search' })]) === weakOnly, 'unique generic comment hint is found');

const labelledOnly = fakeTextarea({ prevSib: labelSib('Internal comment') });
check(find([labelledOnly, fakeTextarea({})]) === labelledOnly, 'unique "Internal comment"-labelled textarea is found');

// ============================================================
// 2. Signal strength ordering
// ============================================================
console.log('\n2. stronger signals outrank weaker ones');

const strong = fakeTextarea({ aria: 'Internal comment' });
const weak = fakeTextarea({ placeholder: 'Comments for pharmacy' });
check(find([weak, strong]) === strong, 'internal-comment hint beats a generic comment hint, regardless of DOM order');

const labelled = fakeTextarea({ prevSib: labelSib('Internal comment') });
check(
  find([weak, labelled]) === labelled,
  'an "Internal comment" label beats a generic comment hint (a labelled box is the real target)'
);

// ============================================================
// 3. Ambiguity FAILS CLOSED (the v3.264.19 fix — old code guessed first)
// ============================================================
console.log('\n3. ambiguous matches fail closed');

const weakA = fakeTextarea({ placeholder: 'Add a comment' });
const weakB = fakeTextarea({ aria: 'Comments for the pharmacy' });
check(find([weakA, weakB]) === null, 'two generic comment hints → null, no guessing');
check(sandbox._findAmbiguous === true, "ambiguity is flagged for the insert path's visible error");

check(
  find([fakeTextarea({ aria: 'Internal comment' }), fakeTextarea({ placeholder: 'Internal comment' })]) === null,
  'two internal-comment hints → null'
);
check(
  find([
    fakeTextarea({ aria: 'Internal comment' }),
    fakeTextarea({ placeholder: 'Internal comment' }),
    fakeTextarea({ prevSib: labelSib('Internal comment') }),
  ]) === null,
  'ambiguity in a stronger tier does NOT fall through to a weaker unique match'
);
check(
  find([
    fakeTextarea({ prevSib: labelSib('Internal comment') }),
    fakeTextarea({ prevSib: labelSib('Internal comment') }),
  ]) === null,
  'two "Internal comment"-labelled textareas → null'
);

check(
  find([fixtureShape]) === fixtureShape && sandbox._findAmbiguous === false,
  'ambiguity flag resets on the next successful find'
);

// ============================================================
// 4. Exclusions and gates still apply before the tiers
// ============================================================
console.log('\n4. exclusions and gates');

const inDialog = fakeTextarea({ aria: 'Add a comment', excluded: true });
const onPage = fakeTextarea({ placeholder: 'Add a comment' });
check(find([inDialog, onPage]) === onPage, 'a dialog/widget textarea does not make the page match ambiguous');

const hiddenTa = fakeTextarea({ aria: 'Add a comment', hidden: true });
check(find([hiddenTa, onPage]) === onPage, 'a hidden textarea does not make the page match ambiguous');

check(find([fakeTextarea({ placeholder: 'Notes' })]) === null, 'no comment signal at all → null');
check(sandbox._findAmbiguous === false, 'a plain not-found is NOT flagged as ambiguous');

sandbox.location.pathname = '/dashboard';
check(find([fixtureShape]) === null, 'off a task-overview page → null (presence gate)');
sandbox.location.pathname = '/ab12/tasks/data/medical-request/overview/12345678-1234-1234-1234-123456789abc';

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
